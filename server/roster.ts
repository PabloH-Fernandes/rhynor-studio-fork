// Persistência do elenco dos Personagens em data/elenco.json.
// Sem o arquivo o escritório usa o DEFAULT_ROSTER; com erros, saneia Personagem por Personagem.
// A gravação é atômica (tmp + fsync + rename) e tenta de novo quando o OneDrive
// ou o antivírus seguram o arquivo por um instante (EPERM/EBUSY/EACCES no Windows).

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAMADA_DO_ACESSORIO,
  DEFAULT_ROSTER,
  personagemErrors,
  aplicarEditaveis,
  mergeWithDefaults,
  oQueFacoErrors,
  oQueFacoPadrao,
  validateRoster,
  type Personagem,
  type Roster,
  type RosterResult,
} from "../shared/roster.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(ROOT, "data");
export const ROSTER_FILE = path.join(DATA_DIR, "elenco.json");

export const RENAME_RETRIES = 5;
export const RENAME_BACKOFF_MS = 50; // 50, 100, 200, 400, 800
export const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Lê o elenco salvo, completa com os padrões e saneia Personagem por Personagem: o inválido volta
 * ao seu padrão e o extra inválido sai. Se precisou sanear (ou o JSON estava quebrado), guarda
 * uma cópia do arquivo em elenco.invalido-<data>.json e grava o elenco saneado no lugar
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
  if (!isObj(parsed) || !Array.isArray(parsed.personagens)) {
    return { roster: structuredClone(DEFAULT_ROSTER), notas: ["formato inesperado (sem a lista personagens); usando o elenco padrão"] };
  }
  const semKey = parsed.personagens.filter((a) => !isObj(a) || typeof a.key !== "string").length;
  if (semKey) notas.push(`${semKey} Personagem(s) sem key descartado(s)`);
  if (parsed.atualizadoEm !== undefined && Number.isNaN(Date.parse(String(parsed.atualizadoEm)))) notas.push("atualizadoEm inválido; usando a data padrão");

  const merged = mergeWithDefaults(parsed);
  // elenco de antes da regra de 1 acessório por camada: fica o primeiro de cada camada
  for (const a of merged.personagens) {
    if (!Array.isArray(a.acessorios)) continue;
    const vistas = new Set<string>();
    const fica = a.acessorios.filter((x) => {
      const c = Object.hasOwn(CAMADA_DO_ACESSORIO, x) ? CAMADA_DO_ACESSORIO[x] : undefined;
      if (!c) return true; // desconhecido: a validação aponta
      if (vistas.has(c)) return false;
      vistas.add(c);
      return true;
    });
    if (fica.length === a.acessorios.length) continue;
    notas.push(`${a.key}: ficou 1 acessório por camada (saiu ${a.acessorios.filter((x) => !fica.includes(x)).join(", ")})`);
    a.acessorios = fica;
  }
  const defaults = new Map(DEFAULT_ROSTER.personagens.map((a) => [a.key, a]));
  // "O que eu faço" inválido (editado à mão): só esse texto volta ao padrão, o visual fica
  for (const a of merged.personagens) {
    if (!oQueFacoErrors(a as unknown as Record<string, unknown>, a.key).length) continue;
    const pad = defaults.get(a.key) ?? oQueFacoPadrao(a.papel);
    notas.push(`${a.key}: "O que eu faço" voltou ao padrão`);
    a.oQueFaco = pad.oQueFaco;
    a.responsabilidades = [...pad.responsabilidades];
  }
  const personagens: Personagem[] = [];
  merged.personagens.forEach((a, i) => {
    const erros = personagemErrors(a, i);
    if (!erros.length) return void personagens.push(a);
    const def = defaults.get(a.key);
    notas.push(`${a.key}: ${def ? "voltou ao padrão" : "removido"} (${erros.join("; ")})`);
    if (def) personagens.push(structuredClone(def));
  });

  // matrícula repetida entre Personagens do padrão: os envolvidos voltam ao padrão antes de mexer nos extras
  const doPadrao = personagens.filter((a) => defaults.has(a.key));
  for (const [i, a] of personagens.entries()) {
    if (!defaults.has(a.key) || !doPadrao.some((b) => b !== a && b.matricula === a.matricula)) continue;
    notas.push(`${a.key}: voltou ao padrão (matrícula ${a.matricula} repetida em outro Personagem do padrão)`);
    personagens[i] = structuredClone(defaults.get(a.key)!);
  }

  // conflitos entre Personagens (key ou matrícula repetida, variação órfã): os extras saem, do último para o primeiro
  let result = validateRoster({ ...merged, personagens });
  while (!result.ok) {
    const extras = personagens.map((a, i) => (defaults.has(a.key) ? -1 : i)).filter((i) => i >= 0);
    const extra = extras.length ? extras[extras.length - 1] : -1;
    if (extra < 0) break;
    notas.push(`${personagens[extra].key}: removido (${result.erros.join("; ")})`);
    personagens.splice(extra, 1);
    result = validateRoster({ ...merged, personagens });
  }
  if (!result.ok) {
    notas.push(`elenco inválido, usando o padrão (${result.erros.join("; ")})`);
    return { roster: structuredClone(DEFAULT_ROSTER), notas };
  }
  return { roster: result.roster, notas };
}

/**
 * Corpo do PUT /api/roster sobre o elenco atual do servidor. Cada Personagem do corpo parte do atual
 * com a mesma key e só traz os CAMPOS_EDITAVEIS (inclusive o "O que eu faço" do crachá); papel, cargo (que segue o gênero), cordão,
 * matrícula, key e falas ficam como estão. O corpo tem de trazer exatamente as keys do elenco
 * atual: key desconhecida, faltando ou repetida é recusada (lista vazia também).
 */
export function aplicarPut(atual: Roster, corpo: unknown, agora = new Date()): RosterResult {
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
  if (!isObj(corpo) || !Array.isArray(corpo.personagens)) return { ok: false, erros: ["o elenco precisa ser um objeto com a lista personagens"] };
  const erros: string[] = [];
  const vindos = new Map<string, Record<string, unknown>>();
  corpo.personagens.forEach((a, i) => {
    if (!isObj(a) || typeof a.key !== "string") return void erros.push(`personagens[${i}]: precisa ter a key do Personagem`);
    if (vindos.has(a.key)) return void erros.push(`key repetida: ${a.key}`);
    vindos.set(a.key, a);
  });
  const conhecidas = new Set(atual.personagens.map((a) => a.key));
  for (const k of vindos.keys()) if (!conhecidas.has(k)) erros.push(`key desconhecida: ${k} (o vestiário não cria Personagens)`);
  for (const k of conhecidas) if (!vindos.has(k)) erros.push(`faltou o Personagem ${k} (mande o elenco inteiro)`);
  if (erros.length) return { ok: false, erros };
  const personagens = atual.personagens.map((a) => aplicarEditaveis(a, vindos.get(a.key)!));
  // sempre depois do atual, mesmo com dois PUTs no mesmo milissegundo
  const quando = Math.max(agora.getTime(), (Date.parse(atual.atualizadoEm) || 0) + 1);
  return validateRoster({ versao: 1, atualizadoEm: new Date(quando).toISOString(), personagens });
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

/** Grava `data` em `file` de forma atômica (tmp + fsync + rename com retry). */
export async function writeAtomic(file: string, data: string) {
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
