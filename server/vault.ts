// Leitura do vault do time (Obsidian): missões em 20-Missoes/ e contagem de atas novas em 00-Inbox/.
// Aqui ficam só as funções puras (sem I/O no parse); o observador de pastas está em vaultWatcher.ts.
//
// Privacidade: 10-Reunioes/ nunca é aberta. A ata do Inbox só tem o frontmatter olhado (o corpo é
// confidencial), e nota com `confidencial: true` nunca vira missão.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Missao, MissaoStatus } from "../shared/types.ts";

// ---------------------------------------------------------------- limites

export const MAX_ITENS = 20;
export const MAX_TEXTO_ITEM = 140;
export const MAX_OBJETIVO = 300;
const MAX_NOME = 120;

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
    const m = /^\s*([A-Za-z0-9_-]+)\s*:(.*)$/.exec(linhas[i]);
    if (!m) continue;
    const nomeChave = m[1].toLowerCase();
    const valor = m[2].trim();
    if (nomeChave === "tags") continue; // tags: [..] (lista inline); [[link]] em outros campos vale
    out[nomeChave] = limparValor(valor);
  }
  return out;
}

/** o texto depois do frontmatter (texto inteiro se não houver) */
function corpoDe(texto: string): string[] {
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

function chave(s: string): string {
  return semAcento(s).trim().toLowerCase();
}

function ehVerdade(valor: string | undefined): boolean {
  return valor !== undefined && ["true", "yes", "sim", "1"].includes(chave(valor));
}

function normalizarStatus(valor: string | undefined): MissaoStatus {
  const k = chave(valor ?? "");
  if (k === "em andamento") return "em andamento";
  if (k === "concluida") return "concluída";
  return "a fazer";
}

function cortar(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

/** [[nota]] → nota, [[nota|apelido]] → apelido, [texto](url) → texto, URL solta some */
function semLinks(s: string): string {
  return s
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** linhas de corpo sem comentário HTML e sem bloco de código, com a marca de "linha de código" removida */
function linhasDeTexto(corpo: string[]): string[] {
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
function secao(linhas: string[], titulo: RegExp): string[] | null {
  const i = linhas.findIndex((l) => titulo.test(l));
  if (i < 0) return null;
  const fim = linhas.findIndex((l, j) => j > i && /^##\s/.test(l));
  return linhas.slice(i + 1, fim < 0 ? undefined : fim);
}

const SEM_TITULO_PADRAO = (s: string) => /\{\{.*\}\}/.test(s);

// ---------------------------------------------------------------- missão

export function parseMissao(nomeArquivo: string, texto: string, mtime: number): Missao | null {
  // primeiro o frontmatter: a decisão de privacidade vem antes de qualquer uso do corpo
  const fm = lerFrontmatter(texto);
  if (!fm) return null;
  if (chave(fm.tipo ?? "") !== "missao") return null;
  if (ehVerdade(fm.confidencial)) return null;

  const id = nomeArquivo.replace(/\.md$/i, "");
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
    if (itens.length < MAX_ITENS) itens.push({ texto: cortar(semLinks(m[2]) || m[2].trim(), MAX_TEXTO_ITEM), feita });
  }

  const objetivo = cortar(semLinks((secao(linhas, /^##\s+Objetivo\b/i) ?? []).join(" ")), MAX_OBJETIVO);

  const classeBruta = chave(fm.classe ?? "");
  const classe: Missao["classe"] = classeBruta === "time" || classeBruta === "humano" ? classeBruta : "duvida";
  const data = /^\d{4}-\d{2}-\d{2}/.exec(fm.data ?? "")?.[0] ?? /^\d{4}-\d{2}-\d{2}/.exec(id)?.[0] ?? "";

  return {
    id,
    nome,
    status: normalizarStatus(fm.status),
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

/** "/time ... Missão [[nota]]" → "nota" (só [0-9A-Za-z-]); qualquer outra coisa → null */
export function missaoDoPrompt(prompt: string): string | null {
  const p = prompt.normalize("NFC");
  const ehTime = /^\s*\/time(\s|$)/i.test(p) || /<command-name>\s*\/?time\s*<\/command-name>/i.test(p);
  if (!ehTime) return null;
  const m = /Miss(?:ão|ao)\s*\[\[([^\]]*)\]\]/i.exec(p);
  if (!m) return null;
  const nome = m[1].trim();
  return /^[0-9A-Za-z-]{1,120}$/.test(nome) ? nome : null;
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
