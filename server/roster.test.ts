import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { DEFAULT_ROSTER, type Roster } from "../shared/roster.ts";
import { loadRoster, saveRoster } from "./roster.ts";

let dir: string;
let file: string;
const warn = console.warn;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agpocket-roster-"));
  file = path.join(dir, "agzinhos.json");
  console.warn = () => {}; // os avisos de saneamento são esperados aqui
});

afterEach(() => {
  console.warn = warn;
  fs.rmSync(dir, { recursive: true, force: true });
});

const backups = () => fs.readdirSync(dir).filter((n) => /^agzinhos\.invalido-.+\.json$/.test(n));

function withChange(change: (r: Roster) => void): Roster {
  const r = structuredClone(DEFAULT_ROSTER);
  change(r);
  return r;
}

test("arquivo ausente cai no padrão", () => {
  assert.deepEqual(loadRoster(file), DEFAULT_ROSTER);
  assert.deepEqual(backups(), []);
});

test("JSON quebrado cai no padrão e gera backup com o conteúdo original", () => {
  fs.writeFileSync(file, '{"versao":1,');
  assert.deepEqual(loadRoster(file), DEFAULT_ROSTER);
  const [copia] = backups();
  assert.ok(copia, "faltou o backup");
  assert.equal(fs.readFileSync(path.join(dir, copia), "utf8"), '{"versao":1,');
});

test("AGzinho inválido volta ao padrão, os outros ficam, e há backup", () => {
  const salvo = withChange((r) => {
    r.agzinhos.find((a) => a.key === "dev")!.roupa = "terno"; // inválido
    r.agzinhos.find((a) => a.key === "testador")!.falas[0] = "Testei tudo, chefe."; // válido
  });
  fs.writeFileSync(file, JSON.stringify(salvo));
  const r = loadRoster(file);
  assert.deepEqual(
    r.agzinhos.find((a) => a.key === "dev"),
    DEFAULT_ROSTER.agzinhos.find((a) => a.key === "dev"),
  );
  assert.equal(r.agzinhos.find((a) => a.key === "testador")!.falas[0], "Testei tudo, chefe.");
  assert.equal(backups().length, 1);
});

test("AGzinho extra inválido é removido; extra válido fica", () => {
  const extra = { ...structuredClone(DEFAULT_ROSTER.agzinhos[1]), key: "planejador-2", variacaoDe: "planejador", matricula: "AG-0013" };
  const salvo = withChange((r) => {
    r.agzinhos.push(extra);
    r.agzinhos.push({ ...extra, key: "ruim", matricula: "AG-0014", cordao: "#FF8A00" });
  });
  fs.writeFileSync(file, JSON.stringify(salvo));
  const keys = loadRoster(file).agzinhos.map((a) => a.key);
  assert.ok(keys.includes("planejador-2"));
  assert.ok(!keys.includes("ruim"));
  assert.equal(backups().length, 1);
});

test("save seguido de load devolve o mesmo elenco", async () => {
  const r = withChange((x) => {
    x.atualizadoEm = "2026-10-03T12:00:00.000Z";
    x.agzinhos[0].falas[0] = "Reunião de 5 minutos!";
  });
  await saveRoster(r, file);
  assert.deepEqual(loadRoster(file), r);
  assert.deepEqual(backups(), []);
});

test("duas gravações seguidas mantêm a última", async () => {
  const a = withChange((x) => (x.atualizadoEm = "2026-10-03T10:00:00.000Z"));
  const b = withChange((x) => (x.atualizadoEm = "2026-10-03T11:00:00.000Z"));
  await Promise.all([saveRoster(a, file), saveRoster(b, file)]);
  assert.equal(loadRoster(file).atualizadoEm, b.atualizadoEm);
  assert.deepEqual(
    fs.readdirSync(dir).filter((n) => n.endsWith(".tmp")),
    [],
  );
});

test(".tmp antigo de outro processo é limpo no load", () => {
  fs.writeFileSync(path.join(dir, "agzinhos.json.99999.tmp"), "lixo");
  loadRoster(file);
  assert.deepEqual(
    fs.readdirSync(dir).filter((n) => n.endsWith(".tmp")),
    [],
  );
});
