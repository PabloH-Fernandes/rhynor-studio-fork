import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaixaItem } from "../../shared/types";
import {
  ACOES_CAIXA,
  contarAcoes,
  copiarTexto,
  escolhidas,
  montarAprovacao,
  resumoDecisao,
  rotuloAprovar,
  rotuloDaAcao,
  semTarefas,
  textoDataReuniao,
  textoErroAprovacao,
  textoPrazo,
  textoProgresso,
  textoResponsavel,
  todasEscolhidas,
} from "./caixaLogic";

const ITEM: CaixaItem = {
  id: "2026-10-17-planejamento",
  titulo: "Planejamento",
  data: "2026-10-17",
  tarefas: [
    { n: 1, texto: "Montar a página", responsavel: "Responsável A", prazo: "2026-10-31" },
    { n: 3, texto: "Revisar o texto", responsavel: "", prazo: "" },
    { n: 4, texto: "Ligar o cadastro", responsavel: "Responsável B", prazo: "" },
  ],
};
const VAZIA: CaixaItem = { id: "2026-10-17-so-decisoes", titulo: "Só decisões", data: "", tarefas: [] };

test("as três ações têm ícone e rótulo em texto", () => {
  assert.deepEqual(
    ACOES_CAIXA.map((a) => [a.acao, a.icone, a.rotulo]),
    [
      ["time", "🤖", "Time faz"],
      ["eu", "🙋", "Eu faço"],
      ["ignorar", "🗑️", "Ignorar"],
    ],
  );
  assert.equal(rotuloDaAcao("eu"), "Eu faço");
});

test("Aprovar só vale com todas as tarefas escolhidas", () => {
  assert.equal(todasEscolhidas(ITEM, {}), false);
  assert.equal(todasEscolhidas(ITEM, { 1: "time", 3: "eu" }), false);
  assert.equal(todasEscolhidas(ITEM, { 1: "time", 3: "eu", 4: "ignorar" }), true);
  assert.equal(escolhidas(ITEM, { 1: "time", 99: "eu" }), 1, "número que não é da reunião não conta");
  assert.equal(rotuloAprovar(ITEM, {}), "Aprovar (escolha todas)");
  assert.equal(rotuloAprovar(ITEM, { 1: "time", 3: "eu", 4: "eu" }), "Aprovar");
  assert.equal(textoProgresso(ITEM, { 1: "time" }), "1 de 3 tarefas escolhidas");
  assert.equal(textoProgresso({ tarefas: [ITEM.tarefas[0]] }, { 1: "eu" }), "1 de 1 tarefa escolhida");
});

test("o corpo do POST usa o número da tarefa da nota, na ordem da lista", () => {
  assert.equal(montarAprovacao(ITEM, { 1: "time" }), null);
  assert.deepEqual(montarAprovacao(ITEM, { 4: "ignorar", 1: "time", 3: "eu" }), {
    reuniao: "2026-10-17-planejamento",
    decisoes: [
      { n: 1, acao: "time" },
      { n: 3, acao: "eu" },
      { n: 4, acao: "ignorar" },
    ],
  });
});

test("reunião sem tarefas: sem escolha e o botão vira Arquivar (aprova sem decisões)", () => {
  assert.equal(semTarefas(VAZIA), true);
  assert.equal(todasEscolhidas(VAZIA, {}), false);
  assert.equal(rotuloAprovar(VAZIA, {}), "Arquivar");
  assert.deepEqual(montarAprovacao(VAZIA, {}), { reuniao: "2026-10-17-so-decisoes", decisoes: [] });
});

test("resumo do que foi decidido", () => {
  const c = contarAcoes(ITEM, { 1: "time", 3: "time", 4: "ignorar" });
  assert.deepEqual(c, { time: 2, eu: 0, ignorar: 1 });
  assert.equal(resumoDecisao(c), "2 para o time, 1 ignorada");
  assert.equal(resumoDecisao({ time: 1, eu: 2, ignorar: 3 }), "1 para o time, 2 para você, 3 ignoradas");
  assert.equal(resumoDecisao({ time: 0, eu: 0, ignorar: 0 }), "");
});

test("textos de prazo, responsável e data", () => {
  assert.equal(textoPrazo("2026-10-31"), "prazo 31/10/2026");
  assert.equal(textoPrazo(""), "sem prazo");
  assert.equal(textoPrazo("2026-02-31"), "sem prazo");
  assert.equal(textoResponsavel({ responsavel: "Responsável A" }), "Responsável A");
  assert.equal(textoResponsavel({ responsavel: "  " }), "sem responsável");
  assert.equal(textoDataReuniao("2026-10-17"), "17/10/2026");
  assert.equal(textoDataReuniao(""), "");
});

test("mensagens de erro em português para cada status", () => {
  assert.match(textoErroAprovacao(409), /já foi aprovada/);
  assert.match(textoErroAprovacao(404), /Não achei/);
  assert.match(textoErroAprovacao(403), /recusou/);
  assert.match(textoErroAprovacao(415), /recusou/);
  assert.match(textoErroAprovacao(503), /npm run setup/);
  assert.match(textoErroAprovacao(500), /Tente de novo/);
});

test("copiarTexto usa a área de transferência e cai no plano B quando ela falha", async () => {
  const copiados: string[] = [];
  const bom = { writeText: async (t: string) => void copiados.push(t) };
  assert.equal(await copiarTexto("/time Missão [[x]]: y.", { clipboard: bom }), true);
  assert.deepEqual(copiados, ["/time Missão [[x]]: y."]);

  const bloqueado = { writeText: async () => Promise.reject(new Error("bloqueado")) };
  const plano: string[] = [];
  assert.equal(await copiarTexto("abc", { clipboard: bloqueado, fallback: (t) => (plano.push(t), true) }), true);
  assert.deepEqual(plano, ["abc"]);

  // sem área de transferência (página sem https): plano B direto
  assert.equal(await copiarTexto("abc", { clipboard: null, fallback: () => true }), true);
  // tudo falha: false, sem estourar
  assert.equal(await copiarTexto("abc", { clipboard: bloqueado, fallback: () => false }), false);
  assert.equal(
    await copiarTexto("abc", {
      clipboard: null,
      fallback: () => {
        throw new Error("sem execCommand");
      },
    }),
    false,
  );
});
