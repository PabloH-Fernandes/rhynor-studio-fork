// Leitura do vault do time (Obsidian): missões em 20-Missoes/ e contagem de atas novas em 00-Inbox/.
// Aqui ficam só as funções puras (sem I/O no parse); o observador de pastas está em vaultWatcher.ts.
//
// Privacidade: este módulo e o observador (vaultWatcher.ts) nunca abrem 10-Reunioes/. A ata do Inbox só
// tem o frontmatter olhado aqui (o corpo é confidencial), e nota com `confidencial: true` nunca vira missão.
// Quem lê o corpo da ata e grava em 10-Reunioes/ é a ingestão sem IA (ingestao.ts / reunioesVault.ts),
// só na máquina local (127.0.0.1): ela extrai título, data, frontmatter e a seção Tarefas, e nada disso
// vai para o painel nem para o Claude.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ehDataValida } from "../shared/datas.ts";
import type { Missao, MissaoStatus } from "../shared/types.ts";

// ---------------------------------------------------------------- limites

export const MAX_ITENS = 20;
export const MAX_TEXTO_ITEM = 140;
export const MAX_OBJETIVO = 300;
const MAX_NOME = 120;
/** quanto de uma linha entra na limpeza de links (as regex de link são quadráticas) */
const MAX_ENTRADA_LINK = 2000;
/** quanto de uma linha do frontmatter é olhado nas buscas por "confidencial" */
const MAX_LINHA_FM = 2000;

// ---------------------------------------------------------------- caminho do vault

/** "~" vira a pasta do usuário; só caminho absoluto é aceito (relativo = null). */
export function expandeCaminho(bruto: string, home: string): string | null {
  const s = bruto.trim();
  if (!s) return null;
  if (s === "~") return path.resolve(home);
  if (s.startsWith("~/") || s.startsWith("~\\")) return path.resolve(home, s.slice(2));
  if (!path.isAbsolute(s)) return null;
  return path.resolve(s);
}

/**
 * Onde fica o vault: process.env.AGPOCKET_VAULT e, se vazio, ~/.claude/settings.json → env.AGPOCKET_VAULT
 * (o servidor não herda o env do settings.json). Qualquer problema devolve null.
 */
export function resolverVault(
  env: Record<string, string | undefined>,
  home: string,
  lerArquivo: (p: string) => string = (p) => fs.readFileSync(p, "utf8"),
): string | null {
  let bruto = (env.AGPOCKET_VAULT ?? "").trim();
  if (!bruto) {
    try {
      const json: unknown = JSON.parse(lerArquivo(path.join(home, ".claude", "settings.json")).replace(/^﻿/, ""));
      const e = (json as { env?: unknown } | null)?.env;
      const v = e && typeof e === "object" ? (e as Record<string, unknown>).AGPOCKET_VAULT : undefined;
      if (typeof v === "string") bruto = v.trim();
    } catch {
      return null;
    }
  }
  return bruto ? expandeCaminho(bruto, home) : null;
}

/** atalho para o index.ts */
export function resolverVaultDoSistema(): string | null {
  return resolverVault(process.env, os.homedir());
}

// ---------------------------------------------------------------- frontmatter

function semBom(texto: string): string {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

function limparValor(bruto: string): string {
  let v = bruto.trim();
  // comentário só começa com # depois de espaço (ou no começo do valor)
  v = v.replace(/(^|\s)#.*$/, "").trim();
  const aspas = /^(["'])(.*)\1$/.exec(v);
  if (aspas) v = aspas[2].trim();
  return v;
}

/** Frontmatter como { chave: valor }; null se não houver ou se o bloco não fechar. */
export function lerFrontmatter(texto: string): Record<string, string> | null {
  const linhas = semBom(texto).split(/\r?\n/);
  if (linhas.length === 0 || linhas[0].trim() !== "---") return null;
  const fim = linhas.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (fim < 0) return null;
  const out: Record<string, string> = {};
  for (let i = 1; i < fim; i++) {
    const m = /^\s*["']?([A-Za-z0-9_-]+)["']?\s*:(.*)$/.exec(linhas[i]);
    if (!m) continue;
    const nomeChave = m[1].toLowerCase();
    const valor = m[2].trim();
    if (nomeChave === "tags") continue; // tags: [..] (lista inline); [[link]] em outros campos vale
    out[nomeChave] = limparValor(valor);
  }
  return out;
}

/** o texto depois do frontmatter (texto inteiro se não houver) */
export function corpoDe(texto: string): string[] {
  const linhas = semBom(texto).split(/\r?\n/);
  if (linhas[0]?.trim() === "---") {
    const fim = linhas.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (fim >= 0) return linhas.slice(fim + 1);
  }
  return linhas;
}

// ---------------------------------------------------------------- normalização

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function chave(s: string): string {
  return semAcento(s).trim().toLowerCase();
}

function ehVerdade(valor: string | undefined): boolean {
  return valor !== undefined && ["true", "yes", "sim", "1"].includes(chave(valor));
}

/**
 * Qualquer linha `confidencial:` com true/yes/sim/1 descarta a nota (chave repetida, `[true]`, aspas na chave,
 * `{confidencial: true}` em fluxo...): na dúvida, a nota fica de fora.
 */
export function temConfidencialTrue(texto: string): boolean {
  const linhas = semBom(texto).split(/\r?\n/);
  if (linhas[0]?.trim() !== "---") return false;
  for (let i = 1; i < linhas.length; i++) {
    if (linhas[i].trim() === "---") break;
    const l = linhas[i].slice(0, MAX_LINHA_FM);
    const m = /^\s*["']?confidencial["']?\s*:(.*)$/i.exec(l);
    if (m && /\b(true|yes|sim|1)\b/i.test(limparValor(m[1]))) return true;
    // fluxo: `{confidencial: true}` ou `{a: 1, "confidencial": "sim"}`
    if (/[{,]\s*["']?confidencial["']?\s*:\s*["']?\s*(true|yes|sim|1)\b/i.test(l)) return true;
  }
  return false;
}

/**
 * Linha do frontmatter que fala de `confidencial` antes do ":" de um jeito que o leitor simples não entende
 * (fluxo `{confidencial: false}`, item de lista...): a busca trata como confidencial (na dúvida, fechada).
 */
export function frontmatterMencionaConfidencial(texto: string): boolean {
  const linhas = semBom(texto).split(/\r?\n/);
  if (linhas[0]?.trim() !== "---") return false;
  for (let i = 1; i < linhas.length; i++) {
    if (linhas[i].trim() === "---") break;
    const l = linhas[i].slice(0, MAX_LINHA_FM);
    const dp = l.indexOf(":");
    const antes = dp < 0 ? l : l.slice(0, dp);
    if (!/confidencial/i.test(antes)) continue;
    if (dp >= 0 && /^\s*["']?confidencial["']?\s*$/i.test(antes)) continue; // chave simples: lerFrontmatter decide
    return true;
  }
  return false;
}

function normalizarStatus(valor: string | undefined): MissaoStatus {
  const k = chave(valor ?? "");
  if (k === "em andamento") return "em andamento";
  if (k === "concluida") return "concluída";
  return "a fazer";
}

export function cortar(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

/** [[nota]] → nota, [[nota|apelido]] → apelido, [texto](url) → texto, URL solta some */
export function semLinks(s: string, max = MAX_ENTRADA_LINK): string {
  // entrada cortada antes: as regex abaixo são quadráticas com uma linha enorme de "[" sem "]"
  return s
    .slice(0, max)
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** linhas de corpo sem comentário HTML e sem bloco de código, com a marca de "linha de código" removida */
export function linhasDeTexto(corpo: string[]): string[] {
  const junto = corpo.join("\n").replace(/<!--[\s\S]*?(-->|$)/g, "");
  const out: string[] = [];
  let emCodigo = false;
  for (const l of junto.split("\n")) {
    if (/^\s*(```|~~~)/.test(l)) {
      emCodigo = !emCodigo;
      continue;
    }
    if (!emCodigo) out.push(l);
  }
  return out;
}

/** linhas da seção `## <titulo>` até o próximo `## ` (null se a seção não existe) */
export function secao(linhas: string[], titulo: RegExp): string[] | null {
  const i = linhas.findIndex((l) => titulo.test(l));
  if (i < 0) return null;
  const fim = linhas.findIndex((l, j) => j > i && /^##\s/.test(l));
  return linhas.slice(i + 1, fim < 0 ? undefined : fim);
}

const SEM_TITULO_PADRAO = (s: string) => /\{\{.*\}\}/.test(s);

/**
 * Tira o sufixo de dados que o painel grava na linha da tarefa (`| prazo: 2026-10-31`,
 * `| concluída: 2026-10-20`; a nota de reunião também tem `| responsável:` e `| classe:`).
 * O texto mostrado no painel nunca leva esse trecho. Um "|" que não abre uma dessas chaves fica.
 */
export function textoSemSufixo(bruto: string): string {
  return bruto.replace(/\s*\|\s*(?:prazo|conclu[ií]da|respons[aá]vel|classe)\s*:.*$/i, "").trim();
}

// ---------------------------------------------------------------- missão

const LINHA_REABERTA = /^\s*[-*]\s+\[ \]\s+\S.*\|\s*conclu[ií]da\s*:\s*(\d{4}-\d{2}-\d{2})/i;

/**
 * Missão reaberta: `status: concluída`, mas ainda existe uma linha `- [ ]` com a marca `| concluída: AAAA-MM-DD`
 * (a marca que o painel grava; quem desmarcou a tarefa no Obsidian deixou a marca para trás). Derivado na leitura,
 * nunca regravado. Missão concluída à mão com `- [ ]` sem a marca NÃO é reaberta.
 */
export function missaoReaberta(fm: Record<string, string>, texto: string): boolean {
  if (chave(fm.status ?? "") !== "concluida") return false;
  // mesma entrada nos três leitores (Missões, Pendências, Resultados): só a seção "## Tarefas" do corpo,
  // sem comentário HTML nem bloco de código
  const tarefas = secao(linhasDeTexto(corpoDe(texto)), /^##\s+Tarefas\b/i) ?? [];
  return tarefas.some((l) => {
    const m = LINHA_REABERTA.exec(l);
    return m !== null && ehDataValida(m[1]);
  });
}

export function parseMissao(nomeArquivo: string, texto: string, mtime: number): Missao | null {
  // primeiro o frontmatter: a decisão de privacidade vem antes de qualquer uso do corpo
  const fm = lerFrontmatter(texto);
  if (!fm) return null;
  if (chave(fm.tipo ?? "") !== "missao") return null;
  if (ehVerdade(fm.confidencial) || temConfidencialTrue(texto)) return null;

  const id = nomeArquivo.replace(/\.md$/i, "").normalize("NFC");
  const linhas = linhasDeTexto(corpoDe(texto));

  let nome = "";
  for (const l of linhas) {
    const m = /^#\s+(.+?)\s*$/.exec(l);
    if (!m) continue;
    if (SEM_TITULO_PADRAO(m[1])) continue;
    nome = cortar(semLinks(m[1]), MAX_NOME);
    if (nome) break;
  }
  if (!nome) nome = id;

  const itens: Missao["itens"] = [];
  let feitas = 0;
  let total = 0;
  for (const l of secao(linhas, /^##\s+Tarefas\b/i) ?? []) {
    const m = /^\s*[-*]\s+\[( |x|X)\]\s+(\S.*)$/.exec(l);
    if (!m) continue;
    const feita = m[1] !== " ";
    total++;
    if (feita) feitas++;
    const textoItem = textoSemSufixo(m[2]) || m[2].trim();
    if (itens.length < MAX_ITENS) itens.push({ texto: cortar(semLinks(textoItem) || textoItem, MAX_TEXTO_ITEM), feita });
  }

  const objetivo = cortar(semLinks((secao(linhas, /^##\s+Objetivo\b/i) ?? []).join(" "), MAX_OBJETIVO * 4), MAX_OBJETIVO);

  const classeBruta = chave(fm.classe ?? "");
  const classe: Missao["classe"] = classeBruta === "time" || classeBruta === "humano" ? classeBruta : "duvida";
  const data = /^\d{4}-\d{2}-\d{2}/.exec(fm.data ?? "")?.[0] ?? /^\d{4}-\d{2}-\d{2}/.exec(id)?.[0] ?? "";

  return {
    id,
    nome,
    status: missaoReaberta(fm, texto) ? "em andamento" : normalizarStatus(fm.status),
    origem: chave(fm.origem ?? "") === "reuniao" ? "reuniao" : "manual",
    projeto: cortar(semLinks(fm.projeto ?? ""), MAX_NOME),
    reuniaoTitulo: cortar(semLinks(fm.reuniao_titulo ?? ""), MAX_NOME),
    classe,
    data,
    tarefas: { feitas, total },
    itens,
    objetivo,
    atualizadoEm: Number.isFinite(mtime) ? mtime : 0,
  };
}

// ---------------------------------------------------------------- ata nova

/** Só o frontmatter conta (o chamador lê os primeiros 4 KB). Sem fechamento = não é ata nova. */
export function ehAtaNova(texto: string): boolean {
  const fm = lerFrontmatter(texto);
  return fm !== null && chave(fm.status ?? "") === "nova";
}

// ---------------------------------------------------------------- prompt

/** "/time ... Missão [[nota]]" → "nota" (aceita espaço, _, acento e ponto; sem barra); qualquer outra coisa → null */
export function missaoDoPrompt(prompt: string): string | null {
  const p = prompt.normalize("NFC");
  const ehTime = /^\s*\/time(\s|$)/i.test(p) || /<command-name>\s*\/?time\s*<\/command-name>/i.test(p);
  if (!ehTime) return null;
  const m = /Miss(?:ão|ao)\s*\[\[([^\]]*)\]\]/i.exec(p);
  if (!m) return null;
  // só chave de comparação com o id da missão (nome do arquivo), nunca caminho: sem barra, <, > nem controle
  const nome = m[1].trim().replace(/\.md$/i, "");
  return /^[^\/\\<>|\u0000-\u001f]{1,200}$/.test(nome) ? nome : null;
}

/** "/reuniao" digitado ou o comando expandido (<command-name>reuniao</command-name>) */
export function ehComandoReuniao(prompt: string): boolean {
  return /^\s*\/reuniao(\s|$)/i.test(prompt) || /<command-name>\s*\/?reuniao\s*<\/command-name>/i.test(prompt);
}

// ---------------------------------------------------------------- missão atual

/**
 * A missão em que o time está agora.
 * (a) a missão pedida mais recente por /time numa sessão viva (`pedidas`: ids, da mais recente para a
 *     mais antiga), se existir e não estiver concluída;
 * (b) senão, a de status "em andamento" com atualizadoEm mais novo.
 * Só vale se veio de reunião (origem === "reuniao"); senão null.
 */
export function escolherAtual(missoes: Missao[], pedidas: string[]): Missao | null {
  let achada: Missao | null = null;
  for (const id of pedidas) {
    const m = missoes.find((x) => x.id === id);
    if (m && m.status !== "concluída") {
      achada = m;
      break;
    }
  }
  if (!achada) {
    for (const m of missoes) {
      if (m.status === "em andamento" && (!achada || m.atualizadoEm > achada.atualizadoEm)) achada = m;
    }
  }
  return achada && achada.origem === "reuniao" ? achada : null;
}
