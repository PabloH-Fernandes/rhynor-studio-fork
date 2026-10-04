import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ACESSORIOS,
  CAMADA_DO_ACESSORIO,
  CARGOS,
  DEFAULT_ROSTER,
  cargoDe,
  DESTAQUES_PERMITIDOS,
  ESTILOS_CABELO,
  HAIR_STYLE_INDEX,
  mergeWithDefaults,
  validateRoster,
  type AGzinho,
  type Roster,
} from "./roster.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** cópia do padrão com um AGzinho alterado */
function withChange(key: string, change: (a: AGzinho) => void): Roster {
  const r = structuredClone(DEFAULT_ROSTER);
  change(r.agzinhos.find((a) => a.key === key)!);
  return r;
}

function expectError(r: Roster, pattern: RegExp) {
  const res = validateRoster(r);
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.erros.some((e) => pattern.test(e)), `nenhum erro bate com ${pattern}: ${res.erros.join(" | ")}`);
}

test("o elenco padrão passa na validação", () => {
  const res = validateRoster(DEFAULT_ROSTER);
  assert.equal(res.ok, true, res.ok ? "" : res.erros.join("\n"));
});

test("o elenco padrão tem 12 AGzinhos com chaves e matrículas únicas, 6 F e 6 M", () => {
  const list = DEFAULT_ROSTER.agzinhos;
  assert.equal(list.length, 12);
  assert.equal(new Set(list.map((a) => a.key)).size, 12);
  assert.equal(new Set(list.map((a) => a.matricula)).size, 12);
  assert.equal(list.filter((a) => a.genero === "feminino").length, 6);
  assert.equal(list.filter((a) => a.genero === "masculino").length, 6);
});

test("cada estilo de cabelo tem um desenho próprio (índices 0..8 sem repetir)", () => {
  const idx = ESTILOS_CABELO.map((e) => HAIR_STYLE_INDEX[e]);
  assert.deepEqual([...idx].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("terno fora do líder é rejeitado", () => {
  expectError(
    withChange("dev", (a) => (a.roupa = "terno")),
    /dev.*roupa/,
  );
});

test("blazer fora de planejador e revisor é rejeitado", () => {
  expectError(
    withChange("testador", (a) => (a.roupa = "blazer")),
    /testador.*roupa/,
  );
});

test("cordão laranja #FF8A00 é rejeitado (em qualquer caixa)", () => {
  expectError(
    withChange("dev", (a) => (a.cordao = "#ff8a00")),
    /cordao/,
  );
});

test("laranja #FF8A00 também é rejeitado na pele e no cabelo", () => {
  expectError(
    withChange("dev", (a) => (a.pele = "#FF8A00")),
    /pele/,
  );
  expectError(
    withChange("dev", (a) => (a.cabelo.cor = "#ff8a00")),
    /cabelo\.cor/,
  );
});

test("DESTAQUES_PERMITIDOS segue papel e roupa", () => {
  assert.deepEqual(DESTAQUES_PERMITIDOS("lider", "terno"), ["gravata-dourada"]);
  assert.deepEqual(DESTAQUES_PERMITIDOS("revisor", "blazer"), ["blazer-cinza"]);
  assert.deepEqual(DESTAQUES_PERMITIDOS("dev", "polo"), []);
  assert.deepEqual(DESTAQUES_PERMITIDOS("convidado", "camisa"), ["cracha-visitante"]);
});

test("destaque fora da regra é rejeitado", () => {
  expectError(
    withChange("dev", (a) => (a.destaque = "gravata-dourada")),
    /dev.*destaque/,
  );
  expectError(
    withChange("lider", (a) => (a.destaque = "blazer-cinza")),
    /lider.*destaque/,
  );
  expectError(
    withChange("dev", (a) => (a.destaque = "cracha-visitante")),
    /dev.*destaque/,
  );
  // convidado sem crachá de visitante
  expectError(
    withChange("explore", (a) => delete a.destaque),
    /explore.*destaque/,
  );
  // sem destaque continua valendo para quem não é convidado
  assert.equal(validateRoster(withChange("revisor", (a) => delete a.destaque)).ok, true);
});

test("validateRoster devolve um elenco limpo, sem campos desconhecidos", () => {
  const sujo = structuredClone(DEFAULT_ROSTER) as Roster & { extra?: number };
  sujo.extra = 1;
  (sujo.agzinhos[0] as AGzinho & { senha?: string }).senha = "x";
  (sujo.agzinhos[0].cabelo as AGzinho["cabelo"] & { brilho?: boolean }).brilho = true;
  const res = validateRoster(sujo);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.roster, DEFAULT_ROSTER);
    assert.notEqual(res.roster.agzinhos[0], sujo.agzinhos[0]);
  }
  const merged = mergeWithDefaults({ agzinhos: [{ key: "dev", senha: "x" }, { key: "novo", senha: "y" }] });
  assert.equal("senha" in merged.agzinhos.find((a) => a.key === "dev")!, false);
  assert.equal("senha" in merged.agzinhos.find((a) => a.key === "novo")!, false);
});

test("fala com mais de 28 caracteres é rejeitada", () => {
  expectError(
    withChange("dev", (a) => (a.falas[0] = "x".repeat(29))),
    /falas\[0\]/,
  );
});

test("fala com emoji é rejeitada", () => {
  expectError(
    withChange("dev", (a) => (a.falas[0] = "Compilou! \u{1F680}")),
    /emoji/,
  );
});

test("apelido acentuado de 6 letras passa; de 7 não", () => {
  assert.equal(validateRoster(withChange("revisor", (a) => (a.apelido = "LÚCIAS"))).ok, true);
  expectError(
    withChange("revisor", (a) => (a.apelido = "LUCIANA")),
    /apelido/,
  );
});

test("chave repetida, hex inválido e matrícula fora do formato são rejeitados", () => {
  expectError(
    withChange("dev-2", (a) => (a.key = "dev")),
    /key repetida/,
  );
  expectError(
    withChange("dev", (a) => (a.pele = "marrom")),
    /pele/,
  );
  expectError(
    withChange("dev", (a) => (a.matricula = "AG-4")),
    /matricula/,
  );
});

test("mergeWithDefaults completa campos faltando e mantém o que foi salvo", () => {
  const merged = mergeWithDefaults({
    versao: 1,
    atualizadoEm: "2026-10-03T12:00:00.000Z",
    agzinhos: [{ key: "dev", nome: "Bia Lima", cabelo: { cor: "#4a3021" } }],
  });
  const dev = merged.agzinhos.find((a) => a.key === "dev")!;
  assert.equal(merged.agzinhos.length, 12);
  assert.equal(dev.nome, "Bia Lima");
  assert.equal(dev.apelido, "BIA");
  assert.deepEqual(dev.cabelo, { estilo: "trancas", cor: "#4a3021" });
  assert.equal(validateRoster(merged).ok, true);
  assert.deepEqual(mergeWithDefaults("lixo"), DEFAULT_ROSTER);
});

test("data/agzinhos.example.json é igual ao DEFAULT_ROSTER", () => {
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "agzinhos.example.json"), "utf8"));
  assert.deepEqual(example, DEFAULT_ROSTER);
});

test("mergeWithDefaults põe o crachá de visitante no convidado salvo sem destaque", () => {
  const semDestaque = (key: string, extra: Partial<AGzinho> = {}) => {
    const a: Partial<AGzinho> = { ...structuredClone(DEFAULT_ROSTER.agzinhos.find((x) => x.key === key)!), ...extra };
    delete a.destaque;
    return a;
  };
  const merged = mergeWithDefaults({
    versao: 1,
    atualizadoEm: "2026-10-03T12:00:00.000Z",
    agzinhos: [semDestaque("explore"), semDestaque("curinga", { key: "visita", matricula: "AG-0099", agentTypes: ["x"] })],
  });
  assert.equal(merged.agzinhos.find((a) => a.key === "explore")!.destaque, "cracha-visitante");
  assert.equal(merged.agzinhos.find((a) => a.key === "visita")!.destaque, "cracha-visitante");
  assert.equal(validateRoster(merged).ok, true);
});

test("o cargo do padrão combina com o gênero (cargoDe)", () => {
  for (const a of DEFAULT_ROSTER.agzinhos) assert.equal(cargoDe(a.papel, a.genero, a.cargo), a.cargo, a.key);
  assert.equal(cargoDe("dev", "masculino", "Desenvolvedora"), "Desenvolvedor");
  assert.equal(cargoDe("convidado", "masculino", "Exploradora"), "Explorador");
  assert.equal(cargoDe("convidado", "feminino", "Generalista"), "Generalista");
  assert.equal(cargoDe("lider", "feminino", "Líder"), "Líder");
  assert.equal(cargoDe("convidado", "feminino", "Astronauta"), "Astronauta");
  assert.ok(Object.keys(CARGOS).includes("documentador"));
});

test("emoji no nome ou no apelido é rejeitado", () => {
  expectError(withChange("dev", (a) => (a.nome = "Bia 🚀")), /\(dev\)\.nome: sem emoji/);
  expectError(withChange("dev", (a) => (a.apelido = "BIA🙂")), /\(dev\)\.apelido: sem emoji/);
});

test("no máximo 1 acessório por camada; barba (pelos) convive com óculos", () => {
  expectError(withChange("dev", (a) => (a.acessorios = ["headset", "capacete-amarelo"])), /no máximo 1 acessório na camada cabeca/);
  expectError(withChange("planejador", (a) => (a.acessorios = ["prancheta", "caneca"])), /camada mao/);
  assert.ok(validateRoster(withChange("documentador", (a) => (a.acessorios = ["lapis", "barba", "oculos"]))).ok);
  for (const a of ACESSORIOS) assert.ok(CAMADA_DO_ACESSORIO[a], a);
  assert.equal(CAMADA_DO_ACESSORIO.barba, "pelos");
});
