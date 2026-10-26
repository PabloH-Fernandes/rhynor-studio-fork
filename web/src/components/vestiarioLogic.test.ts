// Testes das regras do vestiário (lógica pura, sem DOM): npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROSTER } from "../../../shared/roster";
import type { Acessorio, Personagem, Roster } from "../../../shared/types";
import {
  acessorioDaCamada,
  acessoriosPorCamada,
  personagemDe,
  aplicarRascunhos,
  chavesSujas,
  conflitos,
  contarCaracteres,
  elencoMaisNovo,
  copiarVisual,
  errosPorCampo,
  lerErro,
  mensagemDeErro,
  mesmoPersonagem,
  opcoesDestaque,
  prepararEnvio,
  temCamisetaPorBaixo,
  trocarAcessorio,
  trocarGenero,
  trocarResponsabilidade,
  trocarRoupa,
} from "./vestiarioLogic";


const elenco = (): Roster => structuredClone(DEFAULT_ROSTER);
const pers = (r: Roster, key: string): Personagem => structuredClone(personagemDe(r, key)!);

describe("roupa e destaque", () => {
  it("só camisa aberta e jaqueta mostram a camiseta de baixo", () => {
    assert.equal(temCamisetaPorBaixo("jaqueta"), true);
    assert.equal(temCamisetaPorBaixo("camisa-aberta"), true);
    assert.equal(temCamisetaPorBaixo("moletom"), false);
  });

  it("destaques: convidado só o crachá; o time não tem", () => {
    assert.deepEqual(opcoesDestaque("convidado").map((o) => o.valor), ["cracha-visitante"]);
    assert.deepEqual(opcoesDestaque("lider"), []);
  });

  it("trocar roupa acerta a camiseta de baixo e mantém o crachá do convidado", () => {
    const helo = pers(elenco(), "lider"); // jaqueta com camiseta névoa
    const moletom = trocarRoupa(helo, "moletom");
    assert.equal(moletom.corInterna, undefined);
    assert.equal(trocarRoupa(moletom, "camisa-aberta").corInterna, "nevoa");
    assert.equal(trocarRoupa({ ...helo, corInterna: "vinho" }, "camisa-aberta").corInterna, "vinho");
    assert.equal(trocarRoupa({ ...pers(elenco(), "dev"), destaque: "cracha-visitante" }, "sueter").destaque, undefined);
    assert.equal(trocarRoupa(pers(elenco(), "explore"), "jaqueta").destaque, "cracha-visitante");
  });
});

describe("acessórios por camada", () => {
  it("agrupa todos os acessórios, com boné, gorro, cachecol, prancheta e caneca", () => {
    const g = acessoriosPorCamada();
    assert.deepEqual(g.cabeca, ["headset", "bone", "gorro", "lapis"]);
    assert.deepEqual(g.tronco, ["cachecol"]);
    assert.deepEqual(g.mao, ["prancheta", "caneca"]);
  });

  it("um por camada: trocar substitui só aquela camada", () => {
    const lista: Acessorio[] = ["lapis", "barba"];
    assert.deepEqual(trocarAcessorio(lista, "cabeca", "gorro"), ["gorro", "barba"]);
    assert.deepEqual(trocarAcessorio(lista, "pelos", null), ["lapis"]);
    assert.deepEqual(trocarAcessorio(lista, "rosto", "oculos"), ["oculos", "lapis", "barba"]);
    assert.deepEqual(trocarAcessorio(lista, "tronco", "cachecol"), ["cachecol", "lapis", "barba"]);
    assert.equal(acessorioDaCamada(["oculos", "barba"], "rosto"), "oculos");
    assert.equal(acessorioDaCamada(["oculos", "barba"], "pelos"), "barba");
  });

  it("resultado na ordem de ACESSORIOS (não fica sujo só por ordem)", () => {
    const out = trocarAcessorio(["barba"], "tronco", "cachecol");
    assert.deepEqual(out, ["cachecol", "barba"]);
  });
});

describe("gênero e cargo", () => {
  it("trocar o gênero troca o cargo", () => {
    const kaua = pers(elenco(), "dev");
    assert.equal(trocarGenero(kaua, "feminino").cargo, "Desenvolvedora");
    assert.equal(trocarGenero(pers(elenco(), "lider"), "feminino").cargo, "Líder");
    assert.equal(trocarGenero(pers(elenco(), "explore"), "feminino").cargo, "Exploradora");
  });
});

describe("rascunhos, sujo e envio", () => {
  it("rascunho igual ao salvo não está sujo, mesmo com acessórios em outra ordem", () => {
    const base = elenco();
    const otto = pers(base, "planejador");
    otto.acessorios = [...otto.acessorios].reverse();
    assert.ok(mesmoPersonagem(otto, personagemDe(base, "planejador")));
    assert.deepEqual(chavesSujas(base, { planejador: otto }), []);
  });

  it("muda só o Personagem editado e mantém o resto", () => {
    const base = elenco();
    const kaua = { ...pers(base, "dev"), apelido: " kau " };
    assert.deepEqual(chavesSujas(base, { dev: kaua }), ["dev"]);
    const novo = aplicarRascunhos(base, { dev: kaua });
    assert.equal(personagemDe(novo, "dev")?.apelido, "KAU");
    assert.equal(personagemDe(novo, "lider"), personagemDe(base, "lider"));
  });

  it("prepararEnvio valida (apelido vazio) e aceita um visual novo", () => {
    const base = elenco();
    const ruim = prepararEnvio(base, { dev: { ...pers(base, "dev"), apelido: "  " } });
    assert.equal(ruim.ok, false);
    const bom = prepararEnvio(base, { "general-purpose": { ...pers(base, "general-purpose"), acessorios: ["gorro", "cachecol"], roupa: "moletom", corInterna: undefined } });
    assert.ok(bom.ok);
  });

  it("voltar ao padrão copia só o visual e os nomes", () => {
    const base = elenco();
    const mudado = { ...pers(base, "dev"), nome: "Outra", acessorios: ["caneca" as const], falas: ["a", "b", "c"] };
    const volta = copiarVisual(mudado, personagemDe(DEFAULT_ROSTER, "dev")!);
    assert.equal(volta.nome, "Kauã Moreira");
    assert.deepEqual(volta.acessorios, ["headset"]);
    assert.deepEqual(volta.falas, ["a", "b", "c"]);
    // destaque ausente no padrão some do rascunho
    const voltou = copiarVisual({ ...pers(base, "dev"), destaque: "cracha-visitante", corInterna: "vinho" }, personagemDe(DEFAULT_ROSTER, "dev")!);
    assert.equal("destaque" in voltou, false);
    assert.equal("corInterna" in voltou, false);
  });

  it("elencoMaisNovo compara atualizadoEm (resposta do PUT antes do WS não volta ao antigo)", () => {
    const velho = elenco();
    const novo = { ...elenco(), atualizadoEm: "2026-10-26T12:00:00.000Z" };
    assert.equal(elencoMaisNovo(velho, novo), true);
    assert.equal(elencoMaisNovo(novo, velho), false);
    assert.equal(elencoMaisNovo(novo, { ...novo }), false);
  });

  it("conflito só onde o outro navegador mudou algo que você editou", () => {
    const base = elenco();
    const remoto = elenco();
    personagemDe(remoto, "dev")!.apelido = "KA";
    personagemDe(remoto, "lider")!.apelido = "HELO";
    const rascunhos = { dev: { ...pers(base, "dev"), nome: "Kauã M." }, testador: { ...pers(base, "testador"), nome: "Érica N." } };
    assert.deepEqual(conflitos(base, remoto, rascunhos), ["dev"]);
    assert.deepEqual(conflitos(base, remoto, {}), []);
  });
});

describe("erros", () => {
  it("lê key, campo e texto do erro da validação", () => {
    const e = lerErro("personagens[3] (dev).apelido: precisa ter de 1 a 6 caracteres");
    assert.deepEqual([e.key, e.campo, e.texto], ["dev", "apelido", "precisa ter de 1 a 6 caracteres"]);
    assert.equal(lerErro("personagens[0] (x).cabelo.cor: cor inválida").campo, "cabelo.cor");
    assert.equal(lerErro("personagens[0] (x).acessorios[2]: acessório desconhecido").campo, "acessorios");
    assert.equal(lerErro("key repetida: dev").campo, undefined);
  });

  it("agrupa por campo e escreve a frase com o apelido", () => {
    const erros = ["personagens[3] (dev).apelido: precisa ter de 1 a 6 caracteres", "personagens[0] (lider).nome: precisa ser texto"];
    assert.deepEqual(errosPorCampo(erros, "dev"), { apelido: ["precisa ter de 1 a 6 caracteres"] });
    assert.equal(mensagemDeErro(erros[0], elenco()), "KAUÃ · Apelido: precisa ter de 1 a 6 caracteres");
  });

  it("conta caracteres como a validação", () => {
    assert.equal(contarCaracteres("LÚCIA"), 5);
    assert.equal(contarCaracteres("Lúcia"), 5);
  });
});

describe('"O que eu faço" do crachá', () => {
  it("trocar um item mantém o lugar das caixas do meio e tira as vazias do fim", () => {
    assert.deepEqual(trocarResponsabilidade(["a", "b"], 2, "c"), ["a", "b", "c"]);
    assert.deepEqual(trocarResponsabilidade(["a", "b", "c"], 2, ""), ["a", "b"]);
    assert.deepEqual(trocarResponsabilidade(["a", "b", "c"], 1, ""), ["a", "", "c"]);
    assert.deepEqual(trocarResponsabilidade([], 1, "x"), ["", "x"]);
  });

  it("envio: frase e itens sem espaço nas pontas, caixa vazia some; menos de 2 itens é recusado", () => {
    const base = elenco();
    const bom = prepararEnvio(base, { dev: { ...pers(base, "dev"), oQueFaco: "  Faço o programa.  ", responsabilidades: [" mudar ", "", "consertar"] } });
    assert.ok(bom.ok, !bom.ok ? bom.erros.join(" | ") : "");
    const bia = personagemDe(bom.roster, "dev")!;
    assert.equal(bia.oQueFaco, "Faço o programa.");
    assert.deepEqual(bia.responsabilidades, ["mudar", "consertar"]);
    const ruim = prepararEnvio(base, { dev: { ...pers(base, "dev"), responsabilidades: ["só uma", "  "] } });
    assert.equal(ruim.ok, false);
    if (!ruim.ok) assert.equal(mensagemDeErro(ruim.erros[0], base), "KAUÃ · Sou responsável por: precisa ter de 2 a 3 itens");
  });

  it("caixa vazia no fim não deixa sujo; mudar a frase deixa; voltar ao padrão traz o texto", () => {
    const base = elenco();
    const dev = pers(base, "dev");
    assert.deepEqual(chavesSujas(base, { dev: { ...dev, responsabilidades: [...dev.responsabilidades, ""] } }), []);
    assert.deepEqual(chavesSujas(base, { dev: { ...dev, oQueFaco: "Outra frase." } }), ["dev"]);
    const volta = copiarVisual({ ...dev, oQueFaco: "Outra frase.", responsabilidades: ["a", "b"] }, personagemDe(DEFAULT_ROSTER, "dev")!);
    assert.equal(volta.oQueFaco, dev.oQueFaco);
    assert.deepEqual(volta.responsabilidades, dev.responsabilidades);
  });
});
