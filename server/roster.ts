// Persistência do elenco dos AGzinhos em data/agzinhos.json.
// Sem o arquivo o escritório usa o DEFAULT_ROSTER; com erros, saneia AGzinho por AGzinho.
// A gravação é atômica (tmp + fsync + rename) e tenta de novo quando o OneDrive
// ou o antivírus seguram o arquivo por um instante (EPERM/EBUSY/EACCES no Windows).

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ROSTER, agzinhoErrors, mergeWithDefaults, validateRoster, type AGzinho, type Roster } from "../shared/roster.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(ROOT, "data");
export const ROSTER_FILE = path.join(DATA_DIR, "agzinhos.json");

const RENAME_RETRIES = 5;
const RENAME_BACKOFF_MS = 50; // 50, 100, 200, 400, 800
const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Lê o elenco salvo, completa com os padrões e saneia AGzinho por AGzinho: o inválido volta
 * ao seu padrão e o extra inválido sai. Se precisou sanear (ou o JSON estava quebrado), guarda
 * uma cópia do arquivo em agzinhos.invalido-<data>.json e grava o elenco saneado no lugar
 * (em segundo plano), para não gerar um backup novo a cada reinício. Nunca lança.
 */
export function loadRoster(file = ROSTER_FILE): Roster {
  cleanupTmp(path.dirname(file));
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[roster] não consegui ler ${file}, usando o elenco padrão:`, err);
    return structuredClone(DEFAULT_ROSTER);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const copia = backup(file);
    console.warn(`[roster] ${file} não é um JSON válido, usando o elenco padrão${copia ? ` (cópia em ${copia})` : ""}`);
    const roster = structuredClone(DEFAULT_ROSTER);
    if (copia) rewrite(roster, file);
    return roster;
  }

  const { roster, notas } = sanitize(parsed);
  if (notas.length) {
    const copia = backup(file);
    console.warn(`[roster] ${file} foi saneado${copia ? ` (cópia do original em ${copia})` : ""}:\n  - ${notas.join("\n  - ")}`);
    // sem a cópia do original não sobrescreve: o arquivo fica como está para você conferir
    if (copia) rewrite(roster, file);
  }
  return roster;
}

/** grava o elenco saneado sem segurar o boot; uma falha só vira aviso */
function rewrite(roster: Roster, file: string) {
  saveRoster(roster, file).catch((err) => console.warn(`[roster] não consegui regravar ${file} saneado:`, err));
}

/** Mescla com os padrões e conserta o que for preciso; `notas` diz o que mudou. */
export function sanitize(parsed: unknown): { roster: Roster; notas: string[] } {
  const notas: string[] = [];
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
  if (!isObj(parsed) || !Array.isArray(parsed.agzinhos)) {
    return { roster: structuredClone(DEFAULT_ROSTER), notas: ["formato inesperado (sem a lista agzinhos); usando o elenco padrão"] };
  }
  const semKey = parsed.agzinhos.filter((a) => !isObj(a) || typeof a.key !== "string").length;
  if (semKey) notas.push(`${semKey} AGzinho(s) sem key descartado(s)`);
  if (parsed.atualizadoEm !== undefined && Number.isNaN(Date.parse(String(parsed.atualizadoEm)))) notas.push("atualizadoEm inválido; usando a data padrão");

  const merged = mergeWithDefaults(parsed);
  const defaults = new Map(DEFAULT_ROSTER.agzinhos.map((a) => [a.key, a]));
  const agzinhos: AGzinho[] = [];
  merged.agzinhos.forEach((a, i) => {
    const erros = agzinhoErrors(a, i);
    if (!erros.length) return void agzinhos.push(a);
    const def = defaults.get(a.key);
    notas.push(`${a.key}: ${def ? "voltou ao padrão" : "removido"} (${erros.join("; ")})`);
    if (def) agzinhos.push(structuredClone(def));
  });

  // matrícula repetida entre AGzinhos do padrão: os envolvidos voltam ao padrão antes de mexer nos extras
  const doPadrao = agzinhos.filter((a) => defaults.has(a.key));
  for (const [i, a] of agzinhos.entries()) {
    if (!defaults.has(a.key) || !doPadrao.some((b) => b !== a && b.matricula === a.matricula)) continue;
    notas.push(`${a.key}: voltou ao padrão (matrícula ${a.matricula} repetida em outro AGzinho do padrão)`);
    agzinhos[i] = structuredClone(defaults.get(a.key)!);
  }

  // conflitos entre AGzinhos (key ou matrícula repetida, variação órfã): os extras saem, do último para o primeiro
  let result = validateRoster({ ...merged, agzinhos });
  while (!result.ok) {
    const extras = agzinhos.map((a, i) => (defaults.has(a.key) ? -1 : i)).filter((i) => i >= 0);
    const extra = extras.length ? extras[extras.length - 1] : -1;
    if (extra < 0) break;
    notas.push(`${agzinhos[extra].key}: removido (${result.erros.join("; ")})`);
    agzinhos.splice(extra, 1);
    result = validateRoster({ ...merged, agzinhos });
  }
  if (!result.ok) {
    notas.push(`elenco inválido, usando o padrão (${result.erros.join("; ")})`);
    return { roster: structuredClone(DEFAULT_ROSTER), notas };
  }
  return { roster: result.roster, notas };
}

/** Copia o arquivo para <nome>.invalido-<data>.json na mesma pasta; devolve o caminho ou null. */
function backup(file: string): string | null {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(path.dirname(file), `${path.basename(file, ".json")}.invalido-${stamp}.json`);
  try {
    fs.copyFileSync(file, dest);
    return dest;
  } catch (err) {
    console.warn(`[roster] não consegui copiar ${file} antes de sanear:`, err);
    return null;
  }
}

// as gravações entram numa fila: uma só termina o rename antes da próxima começar
let chain: Promise<unknown> = Promise.resolve();

/** Grava o elenco de forma atômica. As chamadas são serializadas na ordem em que chegam. */
export function saveRoster(roster: Roster, file = ROSTER_FILE): Promise<void> {
  const run = chain.then(() => writeAtomic(file, JSON.stringify(roster, null, 2) + "\n"));
  chain = run.catch(() => undefined); // uma falha não trava as próximas
  return run;
}

/** Resolve quando todas as gravações pedidas até agora terminaram (com sucesso ou não). */
export function flushRosterSaves(): Promise<void> {
  return chain.then(() => undefined);
}

async function writeAtomic(file: string, data: string) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fh = await fsp.open(tmp, "w");
  try {
    await fh.writeFile(data, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await renameWithRetry(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

async function renameWithRetry(from: string, to: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!RETRY_CODES.has(code) || attempt >= RENAME_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, RENAME_BACKOFF_MS * 2 ** (attempt - 1)));
    }
  }
}

/** Apaga .tmp que sobraram de gravações interrompidas (processo morto no meio). */
function cleanupTmp(dir: string) {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return; // pasta ainda não existe
  }
  const mine = `.${process.pid}.tmp`;
  for (const name of names) {
    if (!name.endsWith(".tmp") || name.endsWith(mine)) continue;
    try {
      fs.rmSync(path.join(dir, name), { force: true });
    } catch (err) {
      console.warn(`[roster] não consegui apagar ${name}:`, err);
    }
  }
}
