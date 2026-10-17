// Leitura determinística (sem IA) de uma ata bruta do 00-Inbox: título, data, notas, decisões e tarefas.
//
// Aceita dois formatos:
//  - o do Power Automate / Copilot (docs/power-automate-reunioes.md): `tipo: ata-bruta`, seção
//    `## Notas da reunião (Copilot)` e tarefas `- [ ] texto (responsável: Nome) (prazo: AAAA-MM-DD)`;
//  - o antigo, lido pelo /reuniao: `## Pauta`, `## Decisões`, `## Tarefas` com `- texto | responsável: X | prazo: Y`.
//
// Privacidade: cada responsável e cada falante `Nome:` vira "Responsável A, B..." (na ordem em que aparece).
// O mapa nome → letra vive só em memória, durante esta chamada. Nunca se inventa prazo nem responsável.
// Texto que parece transcrição, ou sem as seções esperadas, volta como `foraDoFormato` e não é lido
// (quem decide o que fazer com ele é o chamador: a ata fica no Inbox esperando o /reuniao).

import { ehDataValida } from "../shared/datas.ts";
import { chave, corpoDe, cortar, lerFrontmatter, linhasDeTexto, semLinks } from "./vault.ts";

export const MAX_ITENS_SECAO = 60;
const MAX_TEXTO = 300;
const MAX_TITULO = 120;

export interface TarefaLida {
  texto: string;
  /** "Responsável A" etc.; vazio se a ata não disse */
  responsavel: string;
  /** AAAA-MM-DD ou vazio (sem prazo ou prazo que não deu para entender) */
  prazo: string;
  /** havia um prazo escrito, mas inválido: vira dúvida na nota */
  prazoInvalido: boolean;
  feita: boolean;
}

export interface AtaLida {
  titulo: string;
  /** AAAA-MM-DD ou vazio (ausente ou inválida) */
  data: string;
  /** HH:MM ou vazio */
  hora: string;
  reuniaoId: string;
  ficticia: boolean;
  pauta: string[];
  notas: string[];
  decisoes: string[];
  duvidas: string[];
  tarefas: TarefaLida[];
}

export interface AtaForaDoFormato {
  foraDoFormato: true;
  motivo: string;
}

export type ResultadoAta = AtaLida | AtaForaDoFormato;

export function ehForaDoFormato(r: ResultadoAta): r is AtaForaDoFormato {
  return "foraDoFormato" in r;
}

// ---------------------------------------------------------------- anonimização

/** palavras que não identificam ninguém: não viram "nome" sozinhas */
const PARTICULAS = new Set(["dona", "seu", "sr", "sra", "dr", "dra", "prof", "profa", "professor", "professora", "de", "da", "do", "dos", "das", "e"]);

/** "Decisão:", "Prazo:"... começam com maiúscula e dois-pontos, mas não são pessoas */
const ROTULOS = new Set(
  [
    "decisao", "decisoes", "acao", "acoes", "nota", "notas", "obs", "observacao", "observacoes", "contexto", "resumo",
    "pauta", "tarefa", "tarefas", "prazo", "responsavel", "proximo passo", "proximos passos", "risco", "riscos",
    "pendencia", "pendencias", "duvida", "duvidas", "topico", "assunto", "status", "item", "importante", "atencao",
    "alerta", "lembrete", "resultado", "conclusao", "objetivo", "exemplo", "link", "local", "data", "hora",
    "participantes", "agenda", "encaminhamento", "encaminhamentos",
  ].map(chave),
);

function semAcentoUnidade(texto: string): string {
  // mesmo tamanho do original (letra acentuada vira a letra simples), para casar posições
  let out = "";
  for (const c of texto) {
    const b = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += b.length === c.length ? b : c;
  }
  return out;
}

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A, B... Z, depois Responsável 27, 28... */
function rotuloDe(indice: number): string {
  return indice < 26 ? `Responsável ${String.fromCharCode(65 + indice)}` : `Responsável ${indice + 1}`;
}

export class Anonimizador {
  private readonly rotulos = new Map<string, string>();
  private readonly nomes: { nome: string; rotulo: string }[] = [];
  private regex: RegExp | null = null;
  private porTermo = new Map<string, string>();

  /** devolve o rótulo da pessoa (cria na primeira vez). Papel entre parênteses não conta como nome. */
  registrar(bruto: string): string {
    const nome = bruto.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    const k = chave(nome);
    if (!k) return "";
    let rotulo = this.rotulos.get(k);
    if (!rotulo) {
      rotulo = rotuloDe(this.rotulos.size);
      this.rotulos.set(k, rotulo);
      this.nomes.push({ nome, rotulo });
      this.regex = null;
    }
    return rotulo;
  }

  private montar(): RegExp | null {
    this.porTermo = new Map();
    const termos: string[] = [];
    const guardar = (termo: string, rotulo: string) => {
      const k = semAcentoUnidade(termo).toLowerCase();
      if (k.length < 2 || this.porTermo.has(k)) return;
      this.porTermo.set(k, rotulo);
      termos.push(k);
    };
    for (const { nome, rotulo } of this.nomes) guardar(nome, rotulo);
    for (const { nome, rotulo } of this.nomes) {
      for (const parte of nome.split(" ")) {
        if (parte.length < 3 || !/^\p{Lu}/u.test(parte) || PARTICULAS.has(chave(parte))) continue;
        guardar(parte.replace(/[^\p{L}\p{N}]+$/u, ""), rotulo);
      }
    }
    if (termos.length === 0) return null;
    termos.sort((a, b) => b.length - a.length);
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${termos.map(escapar).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  }

  /** troca cada nome conhecido (inteiro, ou uma parte dele) pelo rótulo */
  aplicar(texto: string): string {
    if (this.nomes.length === 0) return texto;
    if (!this.regex) this.regex = this.montar();
    if (!this.regex) return texto;
    const original = texto.normalize("NFC");
    const plano = semAcentoUnidade(original).toLowerCase();
    let saida = "";
    let cursor = 0;
    for (const m of plano.matchAll(this.regex)) {
      const rotulo = this.porTermo.get(m[0]);
      if (!rotulo || m.index === undefined) continue;
      saida += original.slice(cursor, m.index) + rotulo;
      cursor = m.index + m[0].length;
    }
    return saida + original.slice(cursor);
  }
}

// ---------------------------------------------------------------- linhas

type Secao = "pauta" | "notas" | "decisoes" | "tarefas" | "duvidas" | "transcricao" | "outra";

function secaoDoTitulo(titulo: string): Secao {
  const k = chave(titulo);
  if (/^transcri/.test(k)) return "transcricao";
  if (/^pauta/.test(k)) return "pauta";
  if (/^decis/.test(k)) return "decisoes";
  if (/^(tarefas?|acoes|proximos passos|itens de acao)\b/.test(k)) return "tarefas";
  if (/^duvidas?/.test(k)) return "duvidas";
  if (/^(notas?|resumo|ata)\b/.test(k)) return "notas";
  return "outra";
}

const LINHA_FALANTE =
  /^\s*(?:[-*+]\s+)?(?:[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s+)?(\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){0,2})\s*:\s+\S/u;
const LINHA_HORARIO = /^\s*[[(]?\d{1,2}:\d{2}:\d{2}[\])]?(\s|$)/;

/** o nome de quem fala numa linha `Nome: texto`; null se a linha não é fala */
function falanteDe(linha: string): string | null {
  const m = LINHA_FALANTE.exec(linha);
  if (!m) return null;
  return ROTULOS.has(chave(m[1])) ? null : m[1].trim();
}

const SEM_VALOR = new Set(["", "-", "?", "n/a", "na", "nao informado", "sem responsavel", "sem prazo", "indefinido", "a definir", "tbd"]);

function limpaValor(v: string): string {
  const s = v.trim();
  return SEM_VALOR.has(chave(s)) ? "" : s;
}

/** AAAA-MM-DD ou dd/mm/aaaa → AAAA-MM-DD; "" se vazio; null se escrito mas inválido */
export function normalizarPrazo(bruto: string): string | null {
  const v = limpaValor(bruto);
  if (!v) return "";
  if (ehDataValida(v)) return v;
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (br) {
    const iso = `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
    if (ehDataValida(iso)) return iso;
  }
  return null;
}

interface TarefaBruta {
  texto: string;
  responsavel: string;
  prazo: string;
  feita: boolean;
}

const NADA = new Set(["nenhuma", "nenhum", "nada", "n/a", "sem tarefas", "nenhuma tarefa", "-"]);

/** `- [ ] texto (responsável: X) (prazo: Y)` ou `- texto | responsável: X | prazo: Y`; null se a linha não é tarefa */
function lerTarefa(linha: string): TarefaBruta | null {
  const m = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[( |x|X)\]\s*)?(.*)$/.exec(linha);
  if (!m) return null;
  const feita = m[1] !== undefined && m[1] !== " ";
  let resto = m[2];
  let responsavel: string | undefined;
  let prazo: string | undefined;

  resto = resto.replace(/\(\s*(respons[aá]vel|prazo)\s*:\s*((?:[^()]|\([^()]*\))*)\)/gi, (_t, k: string, v: string) => {
    if (chave(k) === "prazo") prazo ??= v;
    else responsavel ??= v;
    return " ";
  });

  const [primeiro, ...demais] = resto.split("|");
  const extras: string[] = [];
  for (const seg of demais) {
    const kv = /^\s*(respons[aá]vel|prazo|classe)\s*:\s*(.*)$/i.exec(seg);
    if (!kv) {
      extras.push(seg.trim());
      continue;
    }
    const k = chave(kv[1]);
    if (k === "prazo") prazo ??= kv[2];
    else if (k === "responsavel") responsavel ??= kv[2];
  }
  const texto = [primeiro, ...extras].join(" ").replace(/\s+/g, " ").trim();
  if (!texto || NADA.has(chave(texto))) return null;
  return { texto, responsavel: responsavel ?? "", prazo: prazo ?? "", feita };
}

function tiraMarcador(linha: string): string {
  return linha.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/, "").trim();
}

function ehVerdade(v: string | undefined): boolean {
  return v !== undefined && ["true", "yes", "sim", "1"].includes(chave(v));
}

/** reserva: o slug do nome do arquivo (ata-AAAA-MM-DD-HHmm-planejamento.md → "planejamento") */
function tituloDoArquivo(nomeArquivo: string): string {
  const base = nomeArquivo.replace(/\.(md|txt)$/i, "").replace(/^ata-(\d{4}-\d{2}-\d{2}-?)?(\d{4}-?)?/i, "");
  return base.replace(/[-_]+/g, " ").trim();
}

// ---------------------------------------------------------------- principal

/**
 * Lê a ata. Não lança erro: o que não der para ler volta como `{ foraDoFormato: true, motivo }`.
 * `nomeArquivo` só serve de reserva para o título quando o frontmatter e o `# título` não trazem.
 */
export function parseAta(texto: string, nomeArquivo: string): ResultadoAta {
  const fm = lerFrontmatter(texto);
  if (!fm) return { foraDoFormato: true, motivo: "Não tem o cabeçalho (frontmatter) fechado com ---." };

  const linhas = linhasDeTexto(corpoDe(texto));
  const anon = new Anonimizador();

  if (linhas.filter((l) => LINHA_HORARIO.test(l)).length >= 2) {
    return { foraDoFormato: true, motivo: "Parece uma transcrição (linhas com horário), e não um resumo." };
  }

  const pauta: string[] = [];
  const notas: string[] = [];
  const decisoes: string[] = [];
  const duvidas: string[] = [];
  const brutas: TarefaBruta[] = [];
  let tituloH1 = "";
  let secao: Secao | null = null;
  let viuSecaoDeConteudo = false;
  let corrida = 0;

  const destino: Partial<Record<Secao, string[]>> = { pauta, notas, decisoes, duvidas };
  for (const linha of linhas) {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(linha);
    if (h) {
      secao = secaoDoTitulo(h[1]);
      if (secao === "transcricao") {
        return { foraDoFormato: true, motivo: "Tem uma seção de transcrição: precisa do /reuniao." };
      }
      if (secao !== "outra") viuSecaoDeConteudo = true;
      corrida = 0;
      continue;
    }
    const h1 = /^#\s+(.+?)\s*#*\s*$/.exec(linha);
    if (h1) {
      tituloH1 ||= h1[1];
      continue;
    }
    if (!linha.trim()) continue;

    if (secao === "tarefas") {
      const t = lerTarefa(linha);
      if (t) {
        const rotulo = anon.registrar(limpaValor(t.responsavel));
        brutas.push({ ...t, responsavel: rotulo });
      }
      continue;
    }

    const falante = falanteDe(linha);
    if (falante) {
      anon.registrar(falante);
      corrida++;
      if (corrida >= 3) {
        return { foraDoFormato: true, motivo: "Parece uma transcrição (várias falas seguidas), e não um resumo." };
      }
    } else {
      corrida = 0;
    }

    const lista = secao ? destino[secao] : undefined;
    if (lista && lista.length < MAX_ITENS_SECAO) {
      const item = cortar(semLinks(tiraMarcador(linha)), MAX_TEXTO);
      if (item) lista.push(item);
    }
  }

  if (!viuSecaoDeConteudo) {
    return { foraDoFormato: true, motivo: "Não tem as seções esperadas (Notas, Pauta, Decisões ou Tarefas)." };
  }

  // data inválida ou ausente fica vazia: quem grava a nota usa o dia da leitura e registra a dúvida
  const dataFm = /^\d{4}-\d{2}-\d{2}/.exec((fm.data ?? "").trim())?.[0] ?? "";
  const data = ehDataValida(dataFm) ? dataFm : "";

  const horaFm = /^(\d{1,2}):(\d{2})$/.exec((fm.hora ?? "").trim());
  const hora = horaFm && Number(horaFm[1]) < 24 && Number(horaFm[2]) < 60 ? `${horaFm[1].padStart(2, "0")}:${horaFm[2]}` : "";

  const tituloBruto = semLinks(fm.titulo ?? "") || semLinks(tituloH1) || tituloDoArquivo(nomeArquivo);
  const titulo = cortar(anon.aplicar(tituloBruto), MAX_TITULO) || "Reunião sem título";

  const tarefas: TarefaLida[] = brutas.slice(0, MAX_ITENS_SECAO).map((b) => {
    const prazo = normalizarPrazo(b.prazo);
    return {
      texto: cortar(anon.aplicar(semLinks(b.texto)), MAX_TEXTO),
      responsavel: b.responsavel,
      prazo: prazo ?? "",
      prazoInvalido: prazo === null,
      feita: b.feita,
    };
  });

  return {
    titulo,
    data,
    hora,
    reuniaoId: cortar((fm.reuniao_id ?? "").replace(/[\r\n]/g, " ").trim(), 120),
    ficticia: ehVerdade(fm.ficticia),
    pauta: pauta.map((s) => anon.aplicar(s)),
    notas: notas.map((s) => anon.aplicar(s)),
    decisoes: decisoes.map((s) => anon.aplicar(s)),
    duvidas: duvidas.map((s) => anon.aplicar(s)),
    tarefas,
  };
}
