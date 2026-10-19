// Estimativas de tempo (data/estimativas.json): quantos minutos cada coisa "vale" no tempo economizado.
// Sem o arquivo, ou com valor inválido, usa os padrões e avisa no log (como o loadRoster). Nunca lança.
// Valor válido: número finito, de 0 a 10000 (negativo, texto, NaN e infinito são rejeitados).

import fs from "node:fs";
import path from "node:path";
import { ESTIMATIVAS_PADRAO, type Estimativas } from "../shared/resultados.ts";
import { DATA_DIR } from "./roster.ts";

export const ESTIMATIVAS_FILE = path.join(DATA_DIR, "estimativas.json");
export const MAX_MINUTOS = 10_000;
const CHAVES = Object.keys(ESTIMATIVAS_PADRAO) as (keyof Estimativas)[];

export interface ResultadoEstimativas {
  estimativas: Estimativas;
  /** o que foi trocado pelo padrão (uma frase por problema) */
  avisos: string[];
}

/** Confere o conteúdo lido do JSON: cada chave inválida ou ausente (com aviso, se inválida) volta ao padrão. */
export function validarEstimativas(bruto: unknown): ResultadoEstimativas {
  const estimativas: Estimativas = { ...ESTIMATIVAS_PADRAO };
  const avisos: string[] = [];
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return { estimativas, avisos: ["o arquivo precisa ser um objeto JSON; usei os padrões"] };
  }
  const obj = bruto as Record<string, unknown>;
  for (const k of CHAVES) {
    if (!(k in obj)) continue; // ausente: padrão, sem aviso
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_MINUTOS) estimativas[k] = v;
    else avisos.push(`"${k}" precisa ser um número de 0 a ${MAX_MINUTOS}; usei ${ESTIMATIVAS_PADRAO[k]}`);
  }
  return { estimativas, avisos };
}

/** Lê o arquivo. Sem arquivo: padrões, sem aviso. JSON quebrado ou valor inválido: padrões e aviso no log. */
export function loadEstimativas(file = ESTIMATIVAS_FILE, avisar: (msg: string) => void = (m) => console.warn(m)): Estimativas {
  let texto: string;
  try {
    texto = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") avisar(`[estimativas] não consegui ler ${file}, usando os padrões`);
    return { ...ESTIMATIVAS_PADRAO };
  }
  let json: unknown;
  try {
    json = JSON.parse(texto.replace(/^﻿/, ""));
  } catch {
    avisar(`[estimativas] ${file} não é um JSON válido, usando os padrões`);
    return { ...ESTIMATIVAS_PADRAO };
  }
  const r = validarEstimativas(json);
  for (const a of r.avisos) avisar(`[estimativas] ${a}`);
  return r.estimativas;
}

/**
 * Leitor para o servidor: relê o arquivo só quando ele muda (data e tamanho), então editar o
 * estimativas.json vale sem reiniciar, e o aviso sai uma vez por mudança (não a cada recálculo).
 */
export function criarLeitorEstimativas(file = ESTIMATIVAS_FILE, avisar?: (msg: string) => void): () => Estimativas {
  let assinatura = "";
  let atual: Estimativas = { ...ESTIMATIVAS_PADRAO };
  return () => {
    let ass = "ausente";
    try {
      const st = fs.statSync(file);
      ass = `${st.mtimeMs}:${st.size}`;
    } catch {
      // sem arquivo: padrões
    }
    if (ass !== assinatura) {
      assinatura = ass;
      atual = loadEstimativas(file, avisar);
    }
    return atual;
  };
}
