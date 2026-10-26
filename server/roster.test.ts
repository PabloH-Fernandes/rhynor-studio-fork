import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { DEFAULT_ROSTER, type Roster } from "../shared/roster.ts";
import { aplicarPut, flushRosterSaves, loadRoster, saveRoster } from "./roster.ts";

let dir: string;
let file: string;
const warn = console.warn;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-roster-"));
  file = path.join(dir, "elenco.json");
  console.warn = () => {}; // os avisos de saneamento são esperados aqui
});

afterEach(async () => {
  await flushRosterSaves(); // o load saneado regrava o arquivo em segundo plano
  console.warn = warn;
  fs.rmSync(dir, { recursive: true, force: true });
});

const backups = () => fs.readdirSync(dir).filter((n) => /^elenco\.invalido-.+\.json$/.test(n));

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

test("Personagem inválido volta ao padrão, os outros ficam, e há backup", () => {
  const salvo = withChange((r) => {
    (r.personagens.find((a) => a.key === "dev")! as { roupa: string }).roupa = "terno"; // inválido
    r.personagens.find((a) => a.key === "testador")!.falas[0] = "Testei tudo, chefe."; // válido
  });
  fs.writeFileSync(file, JSON.stringify(salvo));
  const r = loadRoster(file);
  assert.deepEqual(
    r.personagens.find((a) => a.key === "dev"),
    DEFAULT_ROSTER.personagens.find((a) => a.key === "dev"),
  );
  assert.equal(r.personagens.find((a) => a.key === "testador")!.falas[0], "Testei tudo, chefe.");
  assert.equal(backups().length, 1);
});

test("Personagem extra inválido é removido; extra válido fica", () => {
  const extra = { ...structuredClone(DEFAULT_ROSTER.personagens[1]), key: "planejador-2", variacaoDe: "planejador", matricula: "RH-0013" };
  const salvo = withChange((r) => {
    r.personagens.push(extra);
    r.personagens.push({ ...extra, key: "ruim", matricula: "RH-0014", corRoupa: "marinho" });
  });
  fs.writeFileSync(file, JSON.stringify(salvo));
  const keys = loadRoster(file).personagens.map((a) => a.key);
  assert.ok(keys.includes("planejador-2"));
  assert.ok(!keys.includes("ruim"));
  assert.equal(backups().length, 1);
});

test("save seguido de load devolve o mesmo elenco", async () => {
  const r = withChange((x) => {
    x.atualizadoEm = "2026-10-03T12:00:00.000Z";
    x.personagens[0].falas[0] = "Reunião de 5 minutos!";
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
  fs.writeFileSync(path.join(dir, "elenco.json.99999.tmp"), "lixo");
  loadRoster(file);
  assert.deepEqual(
    fs.readdirSync(dir).filter((n) => n.endsWith(".tmp")),
    [],
  );
});

test("depois de sanear, o arquivo é regravado e o próximo load não cria outro backup", async () => {
  fs.writeFileSync(file, JSON.stringify(withChange((r) => ((r.personagens.find((a) => a.key === "dev")! as { roupa: string }).roupa = "terno"))));
  const r = loadRoster(file);
  await flushRosterSaves();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), r);
  assert.deepEqual(loadRoster(file), r);
  assert.equal(backups().length, 1);
});

test("JSON quebrado também é regravado com o padrão (um backup só)", async () => {
  fs.writeFileSync(file, "{");
  loadRoster(file);
  await flushRosterSaves();
  assert.deepEqual(loadRoster(file), DEFAULT_ROSTER);
  assert.equal(backups().length, 1);
});

test("matrícula repetida entre Personagens do padrão: os dois voltam ao padrão e o extra fica", () => {
  const extra = { ...structuredClone(DEFAULT_ROSTER.personagens[1]), key: "planejador-2", variacaoDe: "planejador", matricula: "RH-0013" };
  const salvo = withChange((r) => {
    const dev = r.personagens.find((a) => a.key === "dev")!;
    dev.matricula = "RH-0005"; // a do testador
    dev.nome = "Kauã Editado";
    r.personagens.find((a) => a.key === "testador")!.nome = "Érica Editada";
    r.personagens.push(extra);
  });
  fs.writeFileSync(file, JSON.stringify(salvo));
  const r = loadRoster(file);
  const pick = (k: string) => r.personagens.find((a) => a.key === k);
  assert.deepEqual(pick("dev"), DEFAULT_ROSTER.personagens.find((a) => a.key === "dev"));
  assert.deepEqual(pick("testador"), DEFAULT_ROSTER.personagens.find((a) => a.key === "testador"));
  assert.ok(pick("planejador-2"), "o extra válido não devia sair");
});

// ---------------------------------------------------------------- PUT /api/roster (aplicarPut)

const corpo = (change: (r: Roster) => void = () => {}) => withChange(change);

test("PUT: aplica só os campos editáveis (roupa e cores inclusive) e mantém papel, matrícula e falas", () => {
  const r = aplicarPut(
    DEFAULT_ROSTER,
    corpo((c) => {
      const kaua = c.personagens.find((a) => a.key === "dev")!;
      kaua.apelido = "KAU";
      kaua.acessorios = ["bone"];
      kaua.roupa = "jaqueta";
      kaua.corRoupa = "vinho";
      kaua.corInterna = "creme";
      kaua.papel = "lider";
      kaua.matricula = "RH-9999";
      kaua.cargo = "Chefão";
      kaua.falas = ["x", "y", "z"];
    }),
  );
  assert.ok(r.ok, !r.ok ? r.erros.join(" | ") : "");
  const kaua = r.roster.personagens.find((a) => a.key === "dev")!;
  const padrao = DEFAULT_ROSTER.personagens.find((a) => a.key === "dev")!;
  assert.equal(kaua.apelido, "KAU");
  assert.deepEqual(kaua.acessorios, ["bone"]);
  assert.deepEqual([kaua.roupa, kaua.corRoupa, kaua.corInterna], ["jaqueta", "vinho", "creme"]);
  assert.deepEqual([kaua.papel, kaua.matricula, kaua.cargo, kaua.falas], [padrao.papel, padrao.matricula, padrao.cargo, padrao.falas]);
});

test("PUT: o cargo acompanha o gênero", () => {
  const r = aplicarPut(DEFAULT_ROSTER, corpo((c) => (c.personagens.find((a) => a.key === "dev")!.genero = "feminino")));
  assert.ok(r.ok);
  assert.equal(r.roster.personagens.find((a) => a.key === "dev")!.cargo, "Desenvolvedora");
});

test("PUT: lista vazia, key desconhecida, faltando ou repetida dão erro", () => {
  assert.equal(aplicarPut(DEFAULT_ROSTER, { personagens: [] }).ok, false);
  assert.equal(aplicarPut(DEFAULT_ROSTER, { nada: 1 }).ok, false);
  const extra = corpo((c) => c.personagens.push({ ...structuredClone(c.personagens[0]), key: "novo", matricula: "RH-0099" }));
  const r1 = aplicarPut(DEFAULT_ROSTER, extra);
  assert.ok(!r1.ok && r1.erros.some((e) => /key desconhecida: novo/.test(e)));
  const r2 = aplicarPut(DEFAULT_ROSTER, corpo((c) => c.personagens.pop()));
  assert.ok(!r2.ok && r2.erros.some((e) => /faltou o Personagem curinga/.test(e)));
  const r3 = aplicarPut(DEFAULT_ROSTER, corpo((c) => (c.personagens[1] = structuredClone(c.personagens[0]))));
  assert.ok(!r3.ok && r3.erros.some((e) => /key repetida: lider/.test(e)));
});

test("PUT: valores inválidos nos campos editáveis são recusados", () => {
  const r = aplicarPut(DEFAULT_ROSTER, corpo((c) => ((c.personagens[0] as { roupa: string }).roupa = "polo")));
  assert.equal(r.ok, false);
  const r2 = aplicarPut(DEFAULT_ROSTER, corpo((c) => (c.personagens[3].acessorios = ["headset", "gorro"])));
  assert.ok(!r2.ok && r2.erros.some((e) => /no máximo 1 acessório na camada cabeca/.test(e)));
});

test("PUT: atualizadoEm sempre avança, mesmo com relógio igual", () => {
  const agora = new Date(DEFAULT_ROSTER.atualizadoEm);
  const r = aplicarPut(DEFAULT_ROSTER, corpo(), agora);
  assert.ok(r.ok);
  assert.ok(Date.parse(r.roster.atualizadoEm) > Date.parse(DEFAULT_ROSTER.atualizadoEm));
});

test("load: elenco antigo com 2 acessórios na mesma camada fica com o primeiro", () => {
  fs.writeFileSync(file, JSON.stringify(withChange((r) => (r.personagens[3].acessorios = ["headset", "bone", "relogio"]))));
  const r = loadRoster(file);
  assert.deepEqual(r.personagens[3].acessorios, ["headset", "relogio"]);
  assert.equal(r.personagens[3].apelido, "KAUÃ");
});

test('PUT: aceita a frase e as responsabilidades do crachá ("O que eu faço")', () => {
  const r = aplicarPut(
    DEFAULT_ROSTER,
    corpo((c) => {
      const rafa = c.personagens.find((a) => a.key === "testador")!;
      rafa.oQueFaco = "Testo tudo antes de chegar em você.";
      rafa.responsabilidades = ["testar", "avisar"];
    }),
  );
  assert.ok(r.ok, !r.ok ? r.erros.join(" | ") : "");
  const rafa = r.roster.personagens.find((a) => a.key === "testador")!;
  assert.equal(rafa.oQueFaco, "Testo tudo antes de chegar em você.");
  assert.deepEqual(rafa.responsabilidades, ["testar", "avisar"]);
  const ruim = aplicarPut(DEFAULT_ROSTER, corpo((c) => (c.personagens.find((a) => a.key === "testador")!.responsabilidades = ["um só"])));
  assert.equal(ruim.ok, false);
});

test('load: arquivo antigo sem "O que eu faço" fica válido com o padrão, sem backup', () => {
  const antigo = JSON.parse(JSON.stringify(DEFAULT_ROSTER)) as { personagens: Record<string, unknown>[] };
  for (const a of antigo.personagens) {
    delete a.oQueFaco;
    delete a.responsabilidades;
  }
  antigo.personagens.find((a) => a.key === "dev")!.apelido = "BEA";
  fs.writeFileSync(file, JSON.stringify(antigo));
  const r = loadRoster(file);
  const bia = r.personagens.find((a) => a.key === "dev")!;
  assert.equal(bia.apelido, "BEA");
  assert.deepEqual(bia.responsabilidades, DEFAULT_ROSTER.personagens.find((a) => a.key === "dev")!.responsabilidades);
  assert.equal(backups().length, 0);
});

test('load: "O que eu faço" inválido volta ao padrão sem perder o visual', () => {
  const salvo = withChange((r) => {
    const bia = r.personagens.find((a) => a.key === "dev")!;
    bia.apelido = "BEA";
    bia.responsabilidades = ["só uma"];
  });
  fs.writeFileSync(file, JSON.stringify(salvo));
  const bia = loadRoster(file).personagens.find((a) => a.key === "dev")!;
  assert.equal(bia.apelido, "BEA");
  assert.deepEqual(bia.responsabilidades, DEFAULT_ROSTER.personagens.find((a) => a.key === "dev")!.responsabilidades);
  assert.equal(backups().length, 1);
});
