import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ACESSORIOS,
  CAMADA_DO_ACESSORIO,
  CARGOS,
  CORES_ROUPA,
  HAIR_COLORS,
  SKIN_TONES,
  DEFAULT_ROSTER,
  cargoDe,
  DESTAQUES_PERMITIDOS,
  ESTILOS_CABELO,
  HAIR_STYLE_INDEX,
  LIMITS,
  mergeWithDefaults,
  oQueFacoPadrao,
  validateRoster,
  type Personagem,
  type Roster,
} from "./roster.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** cópia do padrão com um Personagem alterado */
function withChange(key: string, change: (a: Personagem) => void): Roster {
  const r = structuredClone(DEFAULT_ROSTER);
  change(r.personagens.find((a) => a.key === key)!);
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

test("o elenco padrão tem 12 Personagens com chaves e matrículas únicas, 6 F e 6 M", () => {
  const list = DEFAULT_ROSTER.personagens;
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

test("roupa fora da lista é rejeitada; qualquer roupa casual vale para qualquer papel", () => {
  expectError(
    withChange("dev", (a) => ((a as { roupa: string }).roupa = "terno")),
    /dev.*roupa/,
  );
  assert.equal(validateRoster(withChange("lider", (a) => (a.roupa = "moletom", delete a.corInterna))).ok, true);
});

test("cores são ids das listas (sem hex): pele, cabelo, roupa e calça desconhecidos são rejeitados", () => {
  expectError(
    withChange("dev", (a) => (a.pele = "pele-7")),
    /\(dev\)\.pele: cor desconhecida/,
  );
  expectError(
    withChange("dev", (a) => (a.cabelo.cor = "azul")),
    /cabelo\.cor/,
  );
  expectError(
    withChange("dev", (a) => (a.corRoupa = "marinho")),
    /corRoupa/,
  );
  expectError(
    withChange("dev", (a) => delete (a as Partial<Personagem>).corCalca),
    /corCalca/,
  );
});

test("camiseta por baixo só vale para camisa aberta e jaqueta", () => {
  expectError(
    withChange("dev", (a) => (a.corInterna = "nevoa")),
    /\(dev\)\.corInterna: só vale/,
  );
  expectError(
    withChange("lider", (a) => (a.corInterna = "rosa")),
    /lider.*corInterna/,
  );
  // jaqueta sem a cor de baixo continua valendo (a tela usa névoa)
  assert.equal(validateRoster(withChange("lider", (a) => delete a.corInterna)).ok, true);
});

test("todo id de cor aponta para um token --rh-* da marca", () => {
  const tokens = fs.readFileSync(path.join(ROOT, "web", "src", "marca", "tokens.css"), "utf8");
  for (const s of [...SKIN_TONES, ...HAIR_COLORS, ...CORES_ROUPA]) assert.ok(tokens.includes(`--${s.token}:`), s.token);
});

test("DESTAQUES_PERMITIDOS: só o convidado tem (o crachá de visitante)", () => {
  assert.deepEqual(DESTAQUES_PERMITIDOS("lider"), []);
  assert.deepEqual(DESTAQUES_PERMITIDOS("dev"), []);
  assert.deepEqual(DESTAQUES_PERMITIDOS("convidado"), ["cracha-visitante"]);
});

test("destaque fora da regra é rejeitado", () => {
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
  (sujo.personagens[0] as Personagem & { senha?: string }).senha = "x";
  (sujo.personagens[0].cabelo as Personagem["cabelo"] & { brilho?: boolean }).brilho = true;
  const res = validateRoster(sujo);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.roster, DEFAULT_ROSTER);
    assert.notEqual(res.roster.personagens[0], sujo.personagens[0]);
  }
  const merged = mergeWithDefaults({ personagens: [{ key: "dev", senha: "x" }, { key: "novo", senha: "y" }] });
  assert.equal("senha" in merged.personagens.find((a) => a.key === "dev")!, false);
  assert.equal("senha" in merged.personagens.find((a) => a.key === "novo")!, false);
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
  assert.equal(validateRoster(withChange("revisor", (a) => (a.apelido = "BENÊZÃ"))).ok, true);
  expectError(
    withChange("revisor", (a) => (a.apelido = "BENEDIT")),
    /apelido/,
  );
});

test("chave repetida, cor inválida e matrícula fora do formato são rejeitados", () => {
  expectError(
    withChange("dev-2", (a) => (a.key = "dev")),
    /key repetida/,
  );
  expectError(
    withChange("dev", (a) => (a.pele = "marrom")),
    /pele/,
  );
  expectError(
    withChange("dev", (a) => (a.matricula = "RH-4")),
    /matricula/,
  );
});

test("mergeWithDefaults completa campos faltando e mantém o que foi salvo", () => {
  const merged = mergeWithDefaults({
    versao: 1,
    atualizadoEm: "2026-10-03T12:00:00.000Z",
    personagens: [{ key: "dev", nome: "Kauã M.", cabelo: { cor: "castanho" } }],
  });
  const dev = merged.personagens.find((a) => a.key === "dev")!;
  assert.equal(merged.personagens.length, 12);
  assert.equal(dev.nome, "Kauã M.");
  assert.equal(dev.apelido, "KAUÃ");
  assert.deepEqual(dev.cabelo, { estilo: "raspado", cor: "castanho" });
  assert.equal(validateRoster(merged).ok, true);
  assert.deepEqual(mergeWithDefaults("lixo"), DEFAULT_ROSTER);
});

test("data/elenco.example.json é igual ao DEFAULT_ROSTER", () => {
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "elenco.example.json"), "utf8"));
  assert.deepEqual(example, DEFAULT_ROSTER);
});

test("mergeWithDefaults põe o crachá de visitante no convidado salvo sem destaque", () => {
  const semDestaque = (key: string, extra: Partial<Personagem> = {}) => {
    const a: Partial<Personagem> = { ...structuredClone(DEFAULT_ROSTER.personagens.find((x) => x.key === key)!), ...extra };
    delete a.destaque;
    return a;
  };
  const merged = mergeWithDefaults({
    versao: 1,
    atualizadoEm: "2026-10-03T12:00:00.000Z",
    personagens: [semDestaque("explore"), semDestaque("curinga", { key: "visita", matricula: "RH-0099", agentTypes: ["x"] })],
  });
  assert.equal(merged.personagens.find((a) => a.key === "explore")!.destaque, "cracha-visitante");
  assert.equal(merged.personagens.find((a) => a.key === "visita")!.destaque, "cracha-visitante");
  assert.equal(validateRoster(merged).ok, true);
});

test("o cargo do padrão combina com o gênero (cargoDe)", () => {
  for (const a of DEFAULT_ROSTER.personagens) assert.equal(cargoDe(a.papel, a.genero, a.cargo), a.cargo, a.key);
  assert.equal(cargoDe("dev", "masculino", "Desenvolvedora"), "Desenvolvedor");
  assert.equal(cargoDe("convidado", "masculino", "Exploradora"), "Explorador");
  assert.equal(cargoDe("convidado", "feminino", "Generalista"), "Generalista");
  assert.equal(cargoDe("lider", "feminino", "Líder"), "Líder");
  assert.equal(cargoDe("convidado", "feminino", "Astronauta"), "Astronauta");
  assert.ok(Object.keys(CARGOS).includes("documentador"));
});

test("emoji no nome ou no apelido é rejeitado", () => {
  expectError(withChange("dev", (a) => (a.nome = "Kauã 🚀")), /\(dev\)\.nome: sem emoji/);
  expectError(withChange("dev", (a) => (a.apelido = "KAUÃ🙂")), /\(dev\)\.apelido: sem emoji/);
});

test("no máximo 1 acessório por camada; barba (pelos) convive com óculos", () => {
  expectError(withChange("dev", (a) => (a.acessorios = ["headset", "bone"])), /no máximo 1 acessório na camada cabeca/);
  expectError(withChange("planejador", (a) => (a.acessorios = ["prancheta", "caneca"])), /camada mao/);
  assert.ok(validateRoster(withChange("documentador", (a) => (a.acessorios = ["lapis", "barba", "oculos"]))).ok);
  for (const a of ACESSORIOS) assert.ok(CAMADA_DO_ACESSORIO[a], a);
  assert.equal(CAMADA_DO_ACESSORIO.barba, "pelos");
});

test('todo Personagem do padrão tem "O que eu faço": frase e 2 a 3 responsabilidades dentro dos limites', () => {
  for (const a of DEFAULT_ROSTER.personagens) {
    assert.ok(a.oQueFaco.length > 0 && a.oQueFaco.length <= LIMITS.oQueFaco, a.key);
    assert.ok(a.responsabilidades.length >= LIMITS.responsabilidadesMin && a.responsabilidades.length <= LIMITS.responsabilidadesMax, a.key);
    for (const r of a.responsabilidades) assert.ok(r.length > 0 && r.length <= LIMITS.responsabilidade, `${a.key}: ${r}`);
  }
  assert.deepEqual(DEFAULT_ROSTER.personagens.find((a) => a.key === "testador")!.responsabilidades, [
    "testar cada mudança",
    "achar erros antes de você",
    "avisar o dev quando algo quebra",
  ]);
});

test('"O que eu faço": frase longa, sem frase, com emoji e responsabilidades fora de 2 a 3 são rejeitados', () => {
  expectError(withChange("dev", (a) => (a.oQueFaco = "x".repeat(LIMITS.oQueFaco + 1))), /\(dev\)\.oQueFaco: precisa ter/);
  expectError(withChange("dev", (a) => (a.oQueFaco = "   ")), /\(dev\)\.oQueFaco/);
  expectError(withChange("dev", (a) => (a.oQueFaco = "Faço código 🚀")), /\(dev\)\.oQueFaco: sem emoji/);
  expectError(withChange("dev", (a) => (a.responsabilidades = ["só uma"])), /\(dev\)\.responsabilidades: precisa ter de 2 a 3/);
  expectError(withChange("dev", (a) => (a.responsabilidades = ["a", "b", "c", "d"])), /\(dev\)\.responsabilidades: precisa ter de 2 a 3/);
  expectError(withChange("dev", (a) => (a.responsabilidades = ["ok", "y".repeat(LIMITS.responsabilidade + 1)])), /\(dev\)\.responsabilidades\[1\]/);
  expectError(withChange("dev", (a) => delete (a as Partial<Personagem>).responsabilidades), /\(dev\)\.responsabilidades/);
});

test('mergeWithDefaults: elenco antigo sem "O que eu faço" ganha o padrão; o salvo é mantido', () => {
  const antigo = structuredClone(DEFAULT_ROSTER) as unknown as { personagens: Record<string, unknown>[] };
  for (const a of antigo.personagens) {
    delete a.oQueFaco;
    delete a.responsabilidades;
  }
  antigo.personagens.find((a) => a.key === "revisor")!.oQueFaco = "Leio e aprovo.";
  // extra de um elenco antigo (sem padrão próprio): ganha o texto do papel
  antigo.personagens.push({ ...structuredClone(DEFAULT_ROSTER.personagens[3]), key: "dev-3", variacaoDe: "dev", matricula: "RH-0013", oQueFaco: undefined, responsabilidades: undefined });
  const m = mergeWithDefaults(antigo);
  const res = validateRoster(m);
  assert.ok(res.ok, !res.ok ? res.erros.join(" | ") : "");
  const dev = DEFAULT_ROSTER.personagens.find((a) => a.key === "dev")!;
  assert.equal(m.personagens.find((a) => a.key === "lider")!.oQueFaco, DEFAULT_ROSTER.personagens[0].oQueFaco);
  assert.equal(m.personagens.find((a) => a.key === "revisor")!.oQueFaco, "Leio e aprovo.");
  assert.deepEqual(m.personagens.find((a) => a.key === "dev-3")!.responsabilidades, dev.responsabilidades);
  assert.equal(oQueFacoPadrao("papel-inventado").responsabilidades.length, 2);
});
