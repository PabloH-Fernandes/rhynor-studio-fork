// Testes das regras do vestiário (lógica pura, sem DOM): npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROSTER } from "../../../shared/roster";
import type { Acessorio, AGzinho, Roster } from "../../../shared/types";
import {
  acessorioDaCamada,
  acessoriosPorCamada,
  agzinhoDe,
  aplicarRascunhos,
  chavesSujas,
  conflitos,
  contarCaracteres,
  elencoMaisNovo,
  copiarVisual,
  errosPorCampo,
  lerErro,
  mensagemDeErro,
  mesmoAGzinho,
  opcoesDestaque,
  prepararEnvio,
  regraRoupa,
  trocarAcessorio,
  trocarGenero,
  trocarResponsabilidade,
  trocarRoupa,
} from "./vestiarioLogic";


const elenco = (): Roster => structuredClone(DEFAULT_ROSTER);
const ag = (r: Roster, key: string): AGzinho => structuredClone(agzinhoDe(r, key)!);

describe("roupa e destaque", () => {
  it("roupa única vira texto com a regra", () => {
    assert.equal(regraRoupa("lider"), "Terno: exclusivo do líder");
    assert.match(regraRoupa("revisor") ?? "", /^Blazer:/);
    assert.equal(regraRoupa("dev"), null);
  });

  it("destaques: convidado só o crachá; terno com gravata; polo sem destaque", () => {
    assert.deepEqual(opcoesDestaque("convidado", "polo").map((o) => o.valor), ["cracha-visitante"]);
    assert.deepEqual(opcoesDestaque("lider", "terno").map((o) => o.valor), [undefined, "gravata-dourada"]);
    assert.deepEqual(opcoesDestaque("dev", "polo"), []);
  });

  it("trocar roupa tira destaque que não combina e mantém o do convidado", () => {
    const bia = { ...ag(elenco(), "dev"), destaque: "blazer-cinza" as const };
    assert.equal(trocarRoupa(bia, "polo").destaque, undefined);
    assert.equal(trocarRoupa(ag(elenco(), "explore"), "camisa").destaque, "cracha-visitante");
  });
});

describe("acessórios por camada", () => {
  it("agrupa todos os acessórios, com capacetes, colete, prancheta e caneca", () => {
    const g = acessoriosPorCamada();
    assert.deepEqual(g.cabeca, ["headset", "capacete-branco", "capacete-amarelo", "lapis"]);
    assert.deepEqual(g.tronco, ["colete"]);
    assert.deepEqual(g.mao, ["prancheta", "caneca"]);
  });

  it("um por camada: trocar substitui só aquela camada", () => {
    const lista: Acessorio[] = ["lapis", "barba"];
    assert.deepEqual(trocarAcessorio(lista, "cabeca", "capacete-amarelo"), ["capacete-amarelo", "barba"]);
    assert.deepEqual(trocarAcessorio(lista, "pelos", null), ["lapis"]);
    assert.deepEqual(trocarAcessorio(lista, "rosto", "oculos"), ["oculos", "lapis", "barba"]);
    assert.deepEqual(trocarAcessorio(lista, "tronco", "colete"), ["colete", "lapis", "barba"]);
    assert.equal(acessorioDaCamada(["oculos", "barba"], "rosto"), "oculos");
    assert.equal(acessorioDaCamada(["oculos", "barba"], "pelos"), "barba");
  });

  it("resultado na ordem de ACESSORIOS (não fica sujo só por ordem)", () => {
    const out = trocarAcessorio(["barba"], "tronco", "colete");
    assert.deepEqual(out, ["colete", "barba"]);
  });
});

describe("gênero e cargo", () => {
  it("trocar o gênero troca o cargo", () => {
    const bia = ag(elenco(), "dev");
    assert.equal(trocarGenero(bia, "masculino").cargo, "Desenvolvedor");
    assert.equal(trocarGenero(ag(elenco(), "lider"), "feminino").cargo, "Líder");
    assert.equal(trocarGenero(ag(elenco(), "explore"), "masculino").cargo, "Explorador");
  });
});

describe("rascunhos, sujo e envio", () => {
  it("rascunho igual ao salvo não está sujo, mesmo com acessórios em outra ordem", () => {
    const base = elenco();
    const davi = ag(base, "documentador");
    davi.acessorios = [...davi.acessorios].reverse();
    assert.ok(mesmoAGzinho(davi, agzinhoDe(base, "documentador")));
    assert.deepEqual(chavesSujas(base, { documentador: davi }), []);
  });

  it("muda só o AGzinho editado e mantém o resto", () => {
    const base = elenco();
    const bia = { ...ag(base, "dev"), apelido: " bea " };
    assert.deepEqual(chavesSujas(base, { dev: bia }), ["dev"]);
    const novo = aplicarRascunhos(base, { dev: bia });
    assert.equal(agzinhoDe(novo, "dev")?.apelido, "BEA");
    assert.equal(agzinhoDe(novo, "lider"), agzinhoDe(base, "lider"));
  });

  it("prepararEnvio valida (apelido vazio) e aceita um visual novo", () => {
    const base = elenco();
    const ruim = prepararEnvio(base, { dev: { ...ag(base, "dev"), apelido: "  " } });
    assert.equal(ruim.ok, false);
    const bom = prepararEnvio(base, { "general-purpose": { ...ag(base, "general-purpose"), acessorios: ["capacete-amarelo", "colete"] } });
    assert.ok(bom.ok);
  });

  it("voltar ao padrão copia só o visual e os nomes", () => {
    const base = elenco();
    const mudado = { ...ag(base, "dev"), nome: "Outra", acessorios: ["caneca" as const], falas: ["a", "b", "c"] };
    const volta = copiarVisual(mudado, agzinhoDe(DEFAULT_ROSTER, "dev")!);
    assert.equal(volta.nome, "Beatriz Lima");
    assert.deepEqual(volta.acessorios, ["headset"]);
    assert.deepEqual(volta.falas, ["a", "b", "c"]);
    // destaque ausente no padrão some do rascunho
    const guto = copiarVisual({ ...ag(base, "dev"), destaque: "blazer-cinza" }, agzinhoDe(DEFAULT_ROSTER, "dev")!);
    assert.equal("destaque" in guto, false);
  });

  it("elencoMaisNovo compara atualizadoEm (resposta do PUT antes do WS não volta ao antigo)", () => {
    const velho = elenco();
    const novo = { ...elenco(), atualizadoEm: "2026-10-04T12:00:00.000Z" };
    assert.equal(elencoMaisNovo(velho, novo), true);
    assert.equal(elencoMaisNovo(novo, velho), false);
    assert.equal(elencoMaisNovo(novo, { ...novo }), false);
  });

  it("conflito só onde o outro navegador mudou algo que você editou", () => {
    const base = elenco();
    const remoto = elenco();
    agzinhoDe(remoto, "dev")!.apelido = "BI";
    agzinhoDe(remoto, "lider")!.apelido = "GUGU";
    const rascunhos = { dev: { ...ag(base, "dev"), nome: "Bia L." }, testador: { ...ag(base, "testador"), nome: "Rafa M." } };
    assert.deepEqual(conflitos(base, remoto, rascunhos), ["dev"]);
    assert.deepEqual(conflitos(base, remoto, {}), []);
  });
});

describe("erros", () => {
  it("lê key, campo e texto do erro da validação", () => {
    const e = lerErro("agzinhos[3] (dev).apelido: precisa ter de 1 a 6 caracteres");
    assert.deepEqual([e.key, e.campo, e.texto], ["dev", "apelido", "precisa ter de 1 a 6 caracteres"]);
    assert.equal(lerErro("agzinhos[0] (x).cabelo.cor: cor inválida").campo, "cabelo.cor");
    assert.equal(lerErro("agzinhos[0] (x).acessorios[2]: acessório desconhecido").campo, "acessorios");
    assert.equal(lerErro("key repetida: dev").campo, undefined);
  });

  it("agrupa por campo e escreve a frase com o apelido", () => {
    const erros = ["agzinhos[3] (dev).apelido: precisa ter de 1 a 6 caracteres", "agzinhos[0] (lider).nome: precisa ser texto"];
    assert.deepEqual(errosPorCampo(erros, "dev"), { apelido: ["precisa ter de 1 a 6 caracteres"] });
    assert.equal(mensagemDeErro(erros[0], elenco()), "BIA · Apelido: precisa ter de 1 a 6 caracteres");
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
    const bom = prepararEnvio(base, { dev: { ...ag(base, "dev"), oQueFaco: "  Faço o programa.  ", responsabilidades: [" mudar ", "", "consertar"] } });
    assert.ok(bom.ok, !bom.ok ? bom.erros.join(" | ") : "");
    const bia = agzinhoDe(bom.roster, "dev")!;
    assert.equal(bia.oQueFaco, "Faço o programa.");
    assert.deepEqual(bia.responsabilidades, ["mudar", "consertar"]);
    const ruim = prepararEnvio(base, { dev: { ...ag(base, "dev"), responsabilidades: ["só uma", "  "] } });
    assert.equal(ruim.ok, false);
    if (!ruim.ok) assert.equal(mensagemDeErro(ruim.erros[0], base), "BIA · Sou responsável por: precisa ter de 2 a 3 itens");
  });

  it("caixa vazia no fim não deixa sujo; mudar a frase deixa; voltar ao padrão traz o texto", () => {
    const base = elenco();
    const dev = ag(base, "dev");
    assert.deepEqual(chavesSujas(base, { dev: { ...dev, responsabilidades: [...dev.responsabilidades, ""] } }), []);
    assert.deepEqual(chavesSujas(base, { dev: { ...dev, oQueFaco: "Outra frase." } }), ["dev"]);
    const volta = copiarVisual({ ...dev, oQueFaco: "Outra frase.", responsabilidades: ["a", "b"] }, agzinhoDe(DEFAULT_ROSTER, "dev")!);
    assert.equal(volta.oQueFaco, dev.oQueFaco);
    assert.deepEqual(volta.responsabilidades, dev.responsabilidades);
  });
});
