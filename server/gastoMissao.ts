// Grava na nota da missão só duas chaves do frontmatter: `tokens_total` (soma de tokens lidos do registro do Claude,
// NÃO é custo) e `tokens_atualizado_em`. Nada do corpo da nota é tocado.
// Cuidados: nota confidencial ou com frontmatter sem fechamento não é tocada; link simbólico não é seguido; se a nota
// mudou entre a leitura e a gravação (OneDrive, Obsidian), não grava (o chamador tenta de novo depois).

import fsp from "node:fs/promises";
import path from "node:path";
import { definirChave } from "./aprovacao.ts";
import { writeAtomic } from "./roster.ts";
import { lerFrontmatter, temConfidencialTrue } from "./vault.ts";

const MAX_BYTES_NOTA = 256 * 1024;
const CHAVE_TOTAL = "tokens_total";
const CHAVE_EM = "tokens_atualizado_em";

export type ResultadoNota = "gravou" | "pulou" | "conflito" | "inexistente";

export interface OpcoesNota {
  agora?: () => Date;
  /** só para teste: roda logo antes da conferência final (simula edição no meio) */
  antesDeGravar?: () => void | Promise<void>;
}

/** O id vem do prompt (já filtrado), mas aqui vale de novo: só nome de arquivo, nunca caminho. */
function idSeguro(id: string): boolean {
  return id.length > 0 && id.length <= 200 && id === path.basename(id) && !/[\\/<>|\u0000-\u001f]/.test(id) && !id.includes("..");
}

/** soma `delta` ao `tokens_total` da missão `<vault>/20-Missoes/<id>.md` */
export async function somarTokensNaMissao(vault: string, id: string, delta: number, opts: OpcoesNota = {}): Promise<ResultadoNota> {
  if (!idSeguro(id) || !Number.isFinite(delta) || delta <= 0) return "pulou";
  const arquivo = path.join(vault, "20-Missoes", `${id}.md`);
  let st;
  try {
    st = await fsp.lstat(arquivo);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return "inexistente";
    throw err;
  }
  if (!st.isFile() || st.size > MAX_BYTES_NOTA) return "pulou";

  const bruto = await fsp.readFile(arquivo, "utf8");
  const fm = lerFrontmatter(bruto);
  if (!fm || temConfidencialTrue(bruto)) return "pulou";

  const temBom = bruto.charCodeAt(0) === 0xfeff;
  const nl = bruto.includes("\r\n") ? "\r\n" : "\n";
  const linhas = (temBom ? bruto.slice(1) : bruto).split(/\r?\n/);
  let fim = linhas.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (linhas[0]?.trim() !== "---" || fim < 0) return "pulou";

  const antes = Number.parseInt((fm[CHAVE_TOTAL] ?? "").trim(), 10);
  const total = (Number.isFinite(antes) && antes > 0 ? antes : 0) + Math.floor(delta);
  fim = definirChave(linhas, fim, CHAVE_TOTAL, String(total));
  definirChave(linhas, fim, CHAVE_EM, (opts.agora ?? (() => new Date()))().toISOString());

  await opts.antesDeGravar?.();
  const agoraSt = await fsp.lstat(arquivo).catch(() => null);
  if (!agoraSt || !agoraSt.isFile() || agoraSt.size !== st.size || agoraSt.mtimeMs !== st.mtimeMs) return "conflito";
  await writeAtomic(arquivo, (temBom ? "﻿" : "") + linhas.join(nl));
  return "gravou";
}
