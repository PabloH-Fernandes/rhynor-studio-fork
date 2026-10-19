// Resultados: quanto o AG Pocket já ajudou, contado SÓ das notas do vault (a fonte da verdade). Nada de contador
// solto em memória: se apagar uma nota, o número cai; se reiniciar o servidor, o número é o mesmo.
//
// O que conta (cada coisa tem a sua data):
//   - Atas processadas: nota de reunião (10-Reunioes/, tipo reuniao). Lida sem IA (`processamento: sem-ia`, a
//     leitura automática) ou com IA (/reuniao, `origem: facilitator`). Reunião sem nenhum desses marcadores
//     (escrita à mão) é ignorada: não é ata processada e não soma minutos. Data = `processada_em`; nas notas do /reuniao,
//     que não têm `processada_em`, vale `data`.
//   - Tarefas aprovadas: as tarefas (`- [ ]`/`- [x]`) de missão com `aprovada_em` (gravado na aprovação da Caixa).
//     Só a missão conta: a tarefa "Time faz" também existe na reunião, mas aparece uma vez só (e missões repetidas
//     da mesma reunião com o mesmo texto também).
//   - Missões concluídas: `status: concluída`. Data = `concluida_em`; sem ela a missão entra só no total (sem data, "data aproximada").
//   - Pendências fechadas: linha `- [x] ... | concluída: AAAA-MM-DD` (reunião ou missão).
// Janelas: hoje, semana (os últimos 7 dias corridos, contando hoje) e total. Nota sem data só entra no total.
// Notas de demonstração (`ficticia: true`) contam, e o resultado avisa (`incluiFicticias`).
//
// Privacidade: sai daqui só número. Nenhum título, texto de tarefa ou nome vai para o painel.
// O servidor nunca roda o Claude. O observador segue o padrão do ObservadorPendencias: stat primeiro (cache por data e
// tamanho: nota que não mudou não é aberta de novo), fs.watch só agenda uma releitura (debounce) e um relógio de 30 s
// religa o watch e vira o "hoje" na virada do dia.

import express, { type Express } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { diaLocal, ehDataValida, somarDias } from "../shared/datas.ts";
import { ESTIMATIVAS_PADRAO, FRASE_ESTIMATIVA, formatarMinutos, type Estimativas, type Periodos, type Resultados } from "../shared/resultados.ts";
import { MAX_BYTES_NOTA, lerTarefasDaNota } from "./caixa.ts";
import { DATA_DIR, writeAtomic } from "./roster.ts";
import { exigirHostLocal, exigirPostSeguro } from "./seguranca.ts";
import { chave, lerFrontmatter, missaoReaberta, semLinks } from "./vault.ts";

const DEBOUNCE_MS = 800;
const INTERVALO_MS = 30_000;
/** teto de notas lidas por pasta: um vault enorme não trava o servidor */
const MAX_ARQUIVOS = 5000;

export type PastaResultados = "r" | "m";
const DIRETORIO: Record<PastaResultados, string> = { r: "10-Reunioes", m: "20-Missoes" };

export type TipoEvento = "ata-sem-ia" | "ata-com-ia" | "tarefa" | "missao" | "pendencia";

/** Uma coisa contável de uma nota, com o dia dela ("" = a nota não tem data). */
export interface Evento {
  tipo: TipoEvento;
  dia: string;
  ficticia: boolean;
  /** missão concluída que usou a data do arquivo */
  aproximada?: boolean;
  /** tarefa aprovada: a mesma chave em duas notas conta uma vez só */
  chave?: string;
  /** nome da nota de reunião (ata) ou da reunião de origem (tarefa e missão): liga a missão à reunião fictícia */
  reuniao?: string;
}

// ---------------------------------------------------------------- leitura de uma nota

/** o dia local de um instante ISO (`2026-10-19T14:30:00.000Z`) ou de uma data pura; "" se não der para entender */
export function diaDoInstante(valor: string | undefined): string {
  const v = (valor ?? "").trim();
  if (!v) return "";
  if (ehDataValida(v)) return v;
  // a data de dentro tem que existir (o Date "rola" 2026-02-31 para 03/03)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v) || !ehDataValida(v.slice(0, 10))) return "";
  return diaLocal(Date.parse(v)); // "" se a data não existe
}

function verdade(valor: string | undefined): boolean {
  return ["true", "yes", "sim", "1"].includes(chave(valor ?? ""));
}

const CONCLUIDA = /\|\s*conclu[ií]da\s*:\s*(\d{4}-\d{2}-\d{2})/i;

function textoParaChave(texto: string): string {
  return chave(semLinks(texto) || texto).replace(/\s+/g, " ");
}

/** Os eventos de uma nota (vazio se a nota não conta). `mtimeMs` é a data do arquivo. */
export function lerEventosDaNota(pasta: PastaResultados, nomeArquivo: string, texto: string, mtimeMs: number): Evento[] {
  const nota = nomeArquivo.replace(/\.md$/i, "").normalize("NFC");
  const fm = lerFrontmatter(texto);
  if (!fm) return [];
  const tipo = chave(fm.tipo ?? "");
  if (tipo !== (pasta === "r" ? "reuniao" : "missao")) return [];
  const ficticia = verdade(fm.ficticia);
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/);
  const tarefas = lerTarefasDaNota(linhas);
  const out: Evento[] = [];
  const reuniao = pasta === "m" ? cortarNome(semLinks(fm.reuniao ?? "")) : nota;

  // pendências fechadas: a marca `[x]` com a data que o painel grava
  for (const t of tarefas) {
    if (t.marca !== "x") continue;
    const m = CONCLUIDA.exec(linhas[t.indice]);
    if (m && ehDataValida(m[1])) out.push({ tipo: "pendencia", dia: m[1], ficticia, reuniao });
  }

  if (pasta === "r") {
    const semIa = chave(fm.processamento ?? "") === "sem-ia" || chave(fm.origem ?? "") === "leitura-automatica";
    // reunião escrita à mão (sem o marcador do /reuniao nem o da leitura automática) não é ata processada: não conta
    if (!semIa && chave(fm.origem ?? "") !== "facilitator") return out;
    // a leitura automática marca o instante; o /reuniao (sem processada_em) tem só a data da reunião
    const dia = semIa ? diaDoInstante(fm.processada_em) : diaDoInstante(fm.data) || diaDoInstante(fm.processada_em);
    out.push({ tipo: semIa ? "ata-sem-ia" : "ata-com-ia", dia, ficticia, reuniao });
    return out;
  }

  if (fm.aprovada_em !== undefined && fm.aprovada_em.trim() !== "") {
    const dia = diaDoInstante(fm.aprovada_em);
    for (const t of tarefas) {
      if (t.marca === "-") continue;
      out.push({ tipo: "tarefa", dia, ficticia, chave: `${reuniao || `m:${nota}`}|${textoParaChave(t.texto)}`, reuniao });
    }
  }
  if (chave(fm.status ?? "") === "concluida" && !missaoReaberta(fm, linhas)) {
    // sem `concluida_em` a data do arquivo NÃO vale (mudaria a cada edição): entra só no total, como nota sem data
    const dia = diaDoInstante(fm.concluida_em);
    out.push({ tipo: "missao", dia, ficticia, aproximada: dia === "", reuniao });
  }
  return out;
}

function cortarNome(s: string): string {
  return s.trim().normalize("NFC").slice(0, 120);
}

// ---------------------------------------------------------------- contagem

const zero = (): Periodos => ({ hoje: 0, semana: 0, total: 0 });

/** Soma os eventos nas janelas. `hoje` vem de fora (testes controlam o relógio). */
export function calcularResultados(eventos: readonly Evento[], hoje: string, estimativas: Estimativas = ESTIMATIVAS_PADRAO): Resultados {
  const semanaDesde = somarDias(hoje, -6);
  const atasSemIa = zero();
  const atasComIa = zero();
  const tarefasAprovadas = zero();
  const missoesConcluidas = zero();
  const pendenciasFechadas = zero();
  let missoesDataAproximada = 0;
  let semData = 0;
  let ficticias = 0;

  // reuniões de demonstração: a missão criada a partir delas também é de demonstração
  const reunioesFicticias = new Set(eventos.filter((e) => e.ficticia && (e.tipo === "ata-sem-ia" || e.tipo === "ata-com-ia") && e.reuniao).map((e) => e.reuniao));
  const vistas = new Set<string>();

  for (const e of eventos) {
    if (e.tipo === "tarefa" && e.chave !== undefined) {
      if (vistas.has(e.chave)) continue; // a mesma tarefa em duas notas conta uma vez
      vistas.add(e.chave);
    }
    const alvo =
      e.tipo === "ata-sem-ia" ? atasSemIa : e.tipo === "ata-com-ia" ? atasComIa : e.tipo === "tarefa" ? tarefasAprovadas : e.tipo === "missao" ? missoesConcluidas : pendenciasFechadas;
    alvo.total++;
    if (e.dia === "") semData++;
    else {
      if (e.dia === hoje) alvo.hoje++;
      if (e.dia >= semanaDesde && e.dia <= hoje) alvo.semana++;
    }
    if (e.tipo === "missao" && e.aproximada) missoesDataAproximada++;
    if (e.ficticia || (e.tipo !== "ata-sem-ia" && e.tipo !== "ata-com-ia" && e.reuniao && reunioesFicticias.has(e.reuniao))) ficticias++;
  }

  const atas: Periodos = {
    hoje: atasSemIa.hoje + atasComIa.hoje,
    semana: atasSemIa.semana + atasComIa.semana,
    total: atasSemIa.total + atasComIa.total,
  };
  const minutos = (k: keyof Periodos): number =>
    atas[k] * estimativas.ataProcessada +
    tarefasAprovadas[k] * estimativas.tarefaAprovada +
    missoesConcluidas[k] * estimativas.missaoConcluida +
    pendenciasFechadas[k] * estimativas.pendenciaFechada;

  return {
    hoje,
    semanaDesde,
    atas,
    atasSemIa,
    atasComIa,
    tarefasAprovadas,
    missoesConcluidas,
    pendenciasFechadas,
    tempoEconomizado: { hoje: minutos("hoje"), semana: minutos("semana"), total: minutos("total") },
    estimativas: { ...estimativas },
    missoesDataAproximada,
    semData,
    ficticias,
    incluiFicticias: ficticias > 0,
  };
}

// ---------------------------------------------------------------- resumo em .md

const dataBrCurta = (iso: string) => iso.split("-").reverse().join("/");

/** O texto do "Exportar resumo": simples, para colar num e-mail ou slide. */
export function montarResumoMd(r: Resultados): string {
  const linha = (rotulo: string, p: Periodos, f: (n: number) => string = String) => `| ${rotulo} | ${f(p.hoje)} | ${f(p.semana)} | ${f(p.total)} |`;
  const e = r.estimativas;
  const out = [
    "# Resumo de resultados do AG Pocket",
    "",
    `Dia: ${dataBrCurta(r.hoje)} · Semana: ${dataBrCurta(r.semanaDesde)} a ${dataBrCurta(r.hoje)} (últimos 7 dias)`,
    "",
    "| O que | Hoje | Semana | Total |",
    "|---|---:|---:|---:|",
    linha("Atas processadas", r.atas),
    linha("- lidas sem IA", r.atasSemIa),
    linha("- com IA (/reuniao)", r.atasComIa),
    linha("Tarefas aprovadas", r.tarefasAprovadas),
    linha("Missões concluídas", r.missoesConcluidas),
    linha("Pendências fechadas", r.pendenciasFechadas),
    linha("Tempo economizado (estimativa)", r.tempoEconomizado, formatarMinutos),
    "",
    `**${FRASE_ESTIMATIVA}**`,
    "",
    `Como estimamos: ata processada ${formatarMinutos(e.ataProcessada)}, tarefa aprovada ${formatarMinutos(e.tarefaAprovada)}, ` +
      `missão concluída ${formatarMinutos(e.missaoConcluida)}, pendência fechada ${formatarMinutos(e.pendenciaFechada)}. ` +
      "Os números vêm das notas do vault.",
  ];
  if (r.incluiFicticias) out.push("", "Atenção: estes números incluem dados de demonstração (fictícios).");
  if (r.missoesDataAproximada > 0) {
    out.push("", `${r.missoesDataAproximada} missão(ões) concluída(s) sem a data de conclusão (data aproximada): entram só no total.`);
  }
  if (r.semData > 0) out.push("", `${r.semData} item(ns) sem data entram só no total.`);
  out.push("");
  return out.join("\n");
}

// ---------------------------------------------------------------- observador

export interface ObservadorResultadosOpcoes {
  debounceMs?: number;
  /** 0 desliga a rede de segurança (testes) */
  intervaloMs?: number;
  /** não liga o fs.watch (testes) */
  semWatch?: boolean;
  now?: () => Date;
}

type Ouvinte = (r: Resultados) => void;

export class ObservadorResultados {
  private readonly resolver: () => string | null;
  private readonly estimativas: () => Estimativas;
  private readonly debounceMs: number;
  private readonly intervaloMs: number;
  private readonly semWatch: boolean;
  private readonly now: () => Date;

  private caminho: string | null = null;
  private watchers = new Map<PastaResultados, fs.FSWatcher>();
  private ouvintes = new Set<Ouvinte>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalo: ReturnType<typeof setInterval> | null = null;
  private emCurso: Promise<void> | null = null;
  private pendente = false;
  private parado = false;

  /** "r:nome.md" → último resultado bom (mantido se a leitura falhar) */
  private cache = new Map<string, { mtime: number; size: number; eventos: Evento[] }>();
  private resultados: Resultados;
  private assinatura = "";
  pronto: Promise<void> = Promise.resolve();

  constructor(resolver: () => string | null, estimativas: () => Estimativas = () => ESTIMATIVAS_PADRAO, opts: ObservadorResultadosOpcoes = {}) {
    this.resolver = resolver;
    this.estimativas = estimativas;
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
    this.intervaloMs = opts.intervaloMs ?? INTERVALO_MS;
    this.semWatch = opts.semWatch ?? false;
    this.now = opts.now ?? (() => new Date());
    this.resultados = calcularResultados([], diaLocal(this.now().getTime()), this.estimativas());
  }

  iniciar(): Promise<void> {
    this.parado = false;
    this.pronto = this.recarregar();
    if (this.intervaloMs > 0 && !this.intervalo) {
      this.intervalo = setInterval(() => void this.recarregar(), this.intervaloMs);
      this.intervalo.unref();
    }
    return this.pronto;
  }

  parar() {
    this.parado = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.intervalo) clearInterval(this.intervalo);
    this.intervalo = null;
    this.fecharWatch();
  }

  getResultados(): Resultados {
    return this.resultados;
  }

  subscribe(fn: Ouvinte): () => void {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  }

  /** Atas processadas num mês (AAAA-MM), sem IA e com IA, da última varredura (para a Transparência). Só leitura. */
  atasDoMes(mes: string): { semIa: number; comIa: number } {
    let semIa = 0;
    let comIa = 0;
    for (const c of this.cache.values()) {
      for (const e of c.eventos) {
        if (!e.dia.startsWith(`${mes}-`)) continue;
        if (e.tipo === "ata-sem-ia") semIa++;
        else if (e.tipo === "ata-com-ia") comIa++;
      }
    }
    return { semIa, comIa };
  }

  /** Releitura completa. Uma por vez: pedido no meio da leitura agenda outra logo depois. */
  recarregar(): Promise<void> {
    if (this.emCurso) {
      this.pendente = true;
      return this.emCurso;
    }
    const rodar = async () => {
      try {
        do {
          this.pendente = false;
          try {
            await this.ler();
          } catch (err) {
            console.warn("[resultados] erro ao ler reuniões e missões:", err instanceof Error ? err.message : err);
          }
        } while (this.pendente && !this.parado);
      } finally {
        this.emCurso = null;
      }
    };
    this.emCurso = rodar();
    return this.emCurso;
  }

  /** pede uma releitura em breve (junta vários avisos seguidos) */
  agendar() {
    if (this.parado) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.recarregar();
    }, this.debounceMs);
    this.timer.unref();
  }

  // ---------------------------------------------------------------- interno

  private fecharWatch() {
    for (const w of this.watchers.values()) {
      try {
        w.close();
      } catch {
        // já fechado
      }
    }
    this.watchers.clear();
  }

  private ligarWatch(pasta: PastaResultados, dir: string) {
    if (this.semWatch || this.parado || this.watchers.has(pasta)) return;
    try {
      const w = fs.watch(dir, { persistent: false }, () => this.agendar());
      w.on("error", () => {
        try {
          w.close();
        } catch {
          // já fechado
        }
        if (this.watchers.get(pasta) === w) this.watchers.delete(pasta); // o relógio de 30 s religa
      });
      this.watchers.set(pasta, w);
    } catch {
      // pasta ainda não existe: o relógio tenta de novo
    }
  }

  private async lerPasta(pasta: PastaResultados, dir: string) {
    this.ligarWatch(pasta, dir);
    let entradas: fs.Dirent[];
    try {
      entradas = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        for (const k of [...this.cache.keys()]) if (k.startsWith(`${pasta}:`)) this.cache.delete(k);
      }
      return; // outro erro (pasta ocupada): mantém
    }
    let nomes = entradas.filter((e) => e.isFile() && /.md$/i.test(e.name)).map((e) => e.name);
    if (nomes.length > MAX_ARQUIVOS) {
      console.warn(`[resultados] ${DIRETORIO[pasta]} tem ${nomes.length} notas; só as primeiras ${MAX_ARQUIVOS} entram na contagem`);
      nomes = nomes.slice(0, MAX_ARQUIVOS);
    }
    const vistos = new Set(nomes.map((n) => `${pasta}:${n}`));
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${pasta}:`) && !vistos.has(k)) this.cache.delete(k);
    for (const nome of nomes) {
      const k = `${pasta}:${nome}`;
      try {
        const arq = path.join(dir, nome);
        const st = await fsp.stat(arq);
        const mtime = Math.floor(st.mtimeMs);
        const antes = this.cache.get(k);
        if (antes && antes.mtime === mtime && antes.size === st.size) continue; // não abre de novo
        const texto = await lerInicio(arq, st.size);
        this.cache.set(k, { mtime, size: st.size, eventos: lerEventosDaNota(pasta, nome, texto, mtime) });
      } catch {
        // EBUSY, "só online" do OneDrive...: fica o valor anterior
      }
    }
  }

  private async ler() {
    const vault = this.resolver();
    if (vault !== this.caminho) {
      this.fecharWatch();
      this.cache.clear();
      this.caminho = vault;
    }
    if (vault) {
      for (const pasta of ["r", "m"] as const) await this.lerPasta(pasta, path.join(vault, DIRETORIO[pasta]));
    }
    const eventos = vault ? [...this.cache.values()].flatMap((c) => c.eventos) : [];
    this.resultados = calcularResultados(eventos, diaLocal(this.now().getTime()), this.estimativas());
    this.publicar();
  }

  private publicar() {
    const assinatura = JSON.stringify(this.resultados);
    if (assinatura === this.assinatura) return;
    this.assinatura = assinatura;
    for (const fn of this.ouvintes) {
      try {
        fn(this.resultados);
      } catch (err) {
        console.error("[resultados] erro num ouvinte:", err);
      }
    }
  }
}

/** a nota inteira; se passar do limite, só o começo (o frontmatter fica no começo) */
async function lerInicio(arquivo: string, tamanho: number): Promise<string> {
  if (tamanho <= MAX_BYTES_NOTA) return fsp.readFile(arquivo, "utf8");
  const fh = await fsp.open(arquivo, "r");
  try {
    const buf = Buffer.alloc(MAX_BYTES_NOTA);
    const { bytesRead } = await fh.read(buf, 0, MAX_BYTES_NOTA, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------- exportar

export const DIR_EXPORTACOES = path.join(DATA_DIR, "exportacoes");

export interface Exportacao {
  /** nome do arquivo gravado (dentro de data/exportacoes/) */
  arquivo: string;
  texto: string;
}

/** Grava o resumo em `<dir>/resultados-AAAA-MM-DD.md` (o do mesmo dia é substituído) e devolve o texto. */
export async function exportarResumo(r: Resultados, dir = DIR_EXPORTACOES): Promise<Exportacao> {
  const texto = montarResumoMd(r);
  const arquivo = `resultados-${r.hoje}.md`;
  await writeAtomic(path.join(dir, arquivo), texto);
  return { arquivo, texto };
}

// ---------------------------------------------------------------- rotas

export interface RotasResultadosDeps {
  resultados: ObservadorResultados;
  /** porta do servidor (para conferir o Host e o Origin) */
  porta: () => number;
  /** onde gravar o resumo (testes usam uma pasta temporária) */
  dirExportacoes?: string;
}

/** GET /api/resultados e POST /api/resultados/exportar */
export function registrarResultados(app: Express, deps: RotasResultadosDeps) {
  // o painel só LÊ: nada aqui chama o Claude
  app.get("/api/resultados", exigirHostLocal(deps.porta), async (_req, res) => {
    await Promise.race([deps.resultados.recarregar(), new Promise((r) => setTimeout(r, 3000).unref())]);
    res.json({ resultados: deps.resultados.getResultados() });
  });

  app.post("/api/resultados/exportar", exigirPostSeguro(deps.porta), express.json({ limit: "1kb" }), async (_req, res) => {
    try {
      await Promise.race([deps.resultados.recarregar(), new Promise((r) => setTimeout(r, 3000).unref())]);
      const e = await exportarResumo(deps.resultados.getResultados(), deps.dirExportacoes);
      res.json({ ok: true, arquivo: e.arquivo, texto: e.texto });
    } catch (err) {
      console.error("[resultados] erro ao exportar:", err instanceof Error ? err.message : err);
      res.status(500).json({ ok: false, erros: ["Não consegui salvar o resumo. Tente de novo."] });
    }
  });
}
