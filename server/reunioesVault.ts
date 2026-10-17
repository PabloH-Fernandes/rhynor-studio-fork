// Notas de reunião em <vault>/10-Reunioes/ feitas pela leitura automática (sem IA).
//
// Privacidade: o servidor roda só na máquina local (127.0.0.1). Aqui ele grava a nota nova (flag `wx`, nunca
// sobrescreve) e, para não duplicar, lê só o frontmatter (reuniao_id e fonte) das notas que já existem.
// A nota nasce `confidencial: true` e o conteúdo nunca vai para o painel nem para o Claude.

import fsp from "node:fs/promises";
import path from "node:path";
import type { AtaLida } from "./ataParser.ts";
import { chave, lerFrontmatter } from "./vault.ts";

const BYTES_DO_CABECALHO = 4096;
const MAX_SLUG = 50;

/** o aviso que abre toda nota feita sem IA */
export const AVISO_SEM_IA =
  "> Lida automaticamente, **sem IA**. Quem era responsável ou falava na reunião virou \"Responsável A, B...\"; " +
  "nomes que não eram responsáveis podem ter ficado no texto: revise antes de mudar para `false`.";

// ---------------------------------------------------------------- nomes

/** minúsculas, sem acento, só a-z 0-9 e hífen, até 50 caracteres cortando num hífen; "reuniao" se ficar vazio */
export function slugDe(titulo: string): string {
  let s = chave(titulo)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length > MAX_SLUG) {
    const corte = s.slice(0, MAX_SLUG + 1);
    const i = corte.lastIndexOf("-");
    s = i > 0 ? corte.slice(0, i) : s.slice(0, MAX_SLUG);
  }
  return s || "reuniao";
}

/** valor seguro para o frontmatter (uma linha, sem `#` nem espaços soltos) */
export function valorSeguro(bruto: string): string {
  return bruto.replace(/[^\p{L}\p{N}._:-]+/gu, "-").replace(/^-+|-+$/g, "");
}

/** AAAA-MM-DD-<slug>, com -2, -3... se o nome já está em `usados` */
export function nomeLivre(data: string, slug: string, usados: ReadonlySet<string>): string {
  const base = `${data}-${slug}`;
  let nome = base;
  for (let k = 2; usados.has(nome); k++) nome = `${base}-${k}`;
  return nome;
}

// ---------------------------------------------------------------- texto da nota

export interface ContextoDaNota {
  /** AAAA-MM-DD da reunião (já com a reserva do dia da leitura) */
  data: string;
  /** nome do arquivo bruto do Inbox */
  fonte: string;
  /** quando a leitura aconteceu */
  processadaEm: Date;
  /** a ata não trazia data válida */
  dataSubstituida: boolean;
}

function itens(lista: readonly string[]): string[] {
  return lista.length > 0 ? lista.map((x) => `- ${x}`) : ["- nenhuma"];
}

/** Monta a nota de reunião (formato do /reuniao, passo 6) a partir da ata já anonimizada. */
export function montarNota(ata: AtaLida, ctx: ContextoDaNota): string {
  const duvidas = [...ata.duvidas.map((d) => `❓ ${d}`)];
  if (ctx.dataSubstituida) duvidas.push(`❓ A ata não trazia uma data válida: usei o dia da leitura (${ctx.data}).`);
  ata.tarefas.forEach((t, i) => {
    if (!t.responsavel) duvidas.push(`❓ Tarefa ${i + 1}: sem responsável.`);
    if (t.prazoInvalido) duvidas.push(`❓ Tarefa ${i + 1}: o prazo escrito na ata não deu para entender; ficou sem prazo.`);
    else if (!t.prazo) duvidas.push(`❓ Tarefa ${i + 1}: sem prazo.`);
  });

  const fm = [
    "---",
    "tipo: reuniao",
    "projeto:",
    `data: ${ctx.data}`,
    "status: rascunho",
    "origem: leitura-automatica",
    "processamento: sem-ia",
    `processada_em: ${ctx.processadaEm.toISOString()}`,
    "entrada: inbox",
    `fonte: ${valorSeguro(ctx.fonte)}`,
  ];
  const id = valorSeguro(ata.reuniaoId);
  if (id) fm.push(`reuniao_id: ${id}`);
  if (ata.ficticia) fm.push("ficticia: true");
  fm.push("tags: [reuniao]", "confidencial: true", "---");

  const tarefas = ata.tarefas.map(
    (t) => `- [${t.feita ? "x" : " "}] ${t.texto.replace(/\|/g, "/")} | responsável: ${t.responsavel} | prazo: ${t.prazo} | classe: ?`,
  );

  return [
    ...fm,
    "",
    `# ${ata.titulo.replace(/\s+/g, " ")}`,
    "",
    "> Nasce com `confidencial: true`. Só mude para `false` depois de conferir que não há nada sensível.",
    AVISO_SEM_IA,
    "",
    "## Pauta",
    ...itens([...ata.pauta, ...ata.notas]),
    "",
    "## Decisões",
    ...itens(ata.decisoes),
    "",
    "## Tarefas",
    ...(tarefas.length > 0 ? tarefas : ["- nenhuma"]),
    "",
    "## Dúvidas",
    ...itens(duvidas),
    "",
    "## Missões geradas",
    "- nenhuma",
    "",
    "Projeto:",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- ata arquivada

/**
 * Frontmatter da ata bruta depois de lida: `status: processada`, `reuniao: <nota>` e `confidencial: true`
 * sempre (troca o valor se a chave existe, acrescenta se faltar). Mantém CRLF e tira o BOM.
 * Sem frontmatter fechado devolve null (a ata nem deveria ter chegado aqui).
 */
export function marcarProcessada(texto: string, nota: string): string | null {
  const nl = texto.includes("\r\n") ? "\r\n" : "\n";
  const linhas = (texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto).split(/\r?\n/);
  if (linhas[0]?.trim() !== "---") return null;
  let fim = linhas.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (fim < 0) return null;
  const novos: [string, string][] = [
    ["status", "processada"],
    ["reuniao", nota],
    ["confidencial", "true"],
  ];
  for (const [k, v] of novos) {
    const re = new RegExp(`^\\s*${k}\\s*:`, "i");
    let achou = false;
    for (let i = 1; i < fim; i++) {
      if (re.test(linhas[i])) {
        linhas[i] = `${k}: ${v}`;
        achou = true;
      }
    }
    if (!achou) {
      linhas.splice(fim, 0, `${k}: ${v}`);
      fim++;
    }
  }
  return linhas.join(nl);
}

// ---------------------------------------------------------------- pasta 10-Reunioes

export interface IndiceDeReunioes {
  /** nomes de arquivo sem .md (de 10-Reunioes e 20-Missoes): para o nome ficar livre */
  nomes: Set<string>;
  porReuniaoId: Map<string, string>;
  porFonte: Map<string, string>;
}

async function nomesDe(dir: string): Promise<string[]> {
  try {
    return (await fsp.readdir(dir)).filter((n) => /\.md$/i.test(n)).map((n) => n.replace(/\.md$/i, ""));
  } catch {
    return [];
  }
}

/** Lê só o frontmatter (primeiros 4 KB) das notas de 10-Reunioes para achar reuniao_id e fonte já usados. */
export async function indexarReunioes(dirReunioes: string, dirMissoes: string): Promise<IndiceDeReunioes> {
  const indice: IndiceDeReunioes = { nomes: new Set(await nomesDe(dirMissoes)), porReuniaoId: new Map(), porFonte: new Map() };
  for (const nome of await nomesDe(dirReunioes)) {
    indice.nomes.add(nome);
    let fh: fsp.FileHandle | null = null;
    try {
      fh = await fsp.open(path.join(dirReunioes, `${nome}.md`), "r");
      const buf = Buffer.alloc(BYTES_DO_CABECALHO);
      const { bytesRead } = await fh.read(buf, 0, BYTES_DO_CABECALHO, 0);
      const fm = lerFrontmatter(buf.toString("utf8", 0, bytesRead));
      if (!fm) continue;
      if (fm.reuniao_id) indice.porReuniaoId.set(fm.reuniao_id, nome);
      if (fm.fonte) indice.porFonte.set(fm.fonte, nome);
    } catch {
      // arquivo ocupado ou só online: fica de fora do índice
    } finally {
      await fh?.close().catch(() => undefined);
    }
  }
  return indice;
}

/** a nota que já veio desta ata (mesmo reuniao_id ou mesma fonte), se existir */
export function notaExistente(indice: IndiceDeReunioes, ata: Pick<AtaLida, "reuniaoId">, fonte: string): string | null {
  const id = valorSeguro(ata.reuniaoId);
  return (id && indice.porReuniaoId.get(id)) || indice.porFonte.get(valorSeguro(fonte)) || null;
}

/**
 * Grava a nota nova sem sobrescrever nada (flag `wx`; se o nome foi tomado no meio do caminho, tenta o
 * próximo). Devolve o nome final, sem .md.
 */
export async function gravarNotaNova(dirReunioes: string, indice: IndiceDeReunioes, data: string, slug: string, texto: string): Promise<string> {
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    const nome = nomeLivre(data, slug, indice.nomes);
    try {
      await fsp.writeFile(path.join(dirReunioes, `${nome}.md`), texto, { encoding: "utf8", flag: "wx" });
      indice.nomes.add(nome);
      return nome;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      indice.nomes.add(nome);
    }
  }
  throw new Error("não achei um nome livre em 10-Reunioes");
}
