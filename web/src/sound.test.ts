import assert from "node:assert/strict";
import { test } from "node:test";
import type { EstadoSom } from "./sound";
import { destravarSom, eventoDoLote, instalarGestos, setAtivo, somDaTransicao, somFuncionando, tocar, tocarAtencao, tocarDing, tocarTeclado, tocarTecladoLimitado } from "./sound";

const e = (status: EstadoSom["status"], tasksDone = 0): EstadoSom => ({ status, tasksDone });

test("esperando novo toca o aviso", () => {
  assert.equal(somDaTransicao(e("trabalhando"), e("esperando")), "atencao");
  assert.equal(somDaTransicao(e("ocioso"), e("esperando")), "atencao");
});

test("continuar esperando, entrar em trabalhando ou ocioso não toca", () => {
  assert.equal(somDaTransicao(e("esperando"), e("esperando")), null);
  assert.equal(somDaTransicao(e("ocioso"), e("trabalhando")), null);
  assert.equal(somDaTransicao(e("trabalhando"), e("pensando")), null);
  assert.equal(somDaTransicao(e("trabalhando"), e("ocioso")), null);
});

test("tarefa concluída (tasksDone sobe) toca o ding", () => {
  assert.equal(somDaTransicao(e("trabalhando", 1), e("ocioso", 2)), "ding");
  assert.equal(somDaTransicao(e("trabalhando", 0), e("trabalhando", 1)), "ding");
  assert.equal(somDaTransicao(e("trabalhando", 2), e("trabalhando", 2)), null);
  assert.equal(somDaTransicao(e("trabalhando", 2), e("saindo", 3)), null);
});

test("esperando tem prioridade sobre o ding", () => {
  assert.equal(somDaTransicao(e("trabalhando", 0), e("esperando", 1)), "atencao");
});

test("esperando + saindo no mesmo passo ainda chama atenção; saindo sozinho não dá ding", () => {
  assert.equal(somDaTransicao(e("trabalhando", 1), e("saindo", 2)), null);
  assert.equal(somDaTransicao(e("esperando", 1), e("saindo", 1)), null);
});

test("tasksDone que desce (reset do servidor) ou fica em 0 não toca", () => {
  assert.equal(somDaTransicao(e("trabalhando", 5), e("trabalhando", 0)), null);
  assert.equal(somDaTransicao(e("ocioso", 0), e("ocioso", 0)), null);
});

test("eventoDoLote: o ! vence o ding e vazio não toca", () => {
  assert.equal(eventoDoLote([]), null);
  assert.equal(eventoDoLote([null, null]), null);
  assert.equal(eventoDoLote(["ding", null]), "ding");
  assert.equal(eventoDoLote(["ding", "atencao"]), "atencao");
  assert.equal(eventoDoLote(["atencao", "ding"]), "atencao");
});

test("snapshot inicial/reconexão (sem anterior) não toca", () => {
  assert.equal(somDaTransicao(undefined, e("esperando", 3)), null);
});

test("som desativado não toca", () => {
  assert.equal(somDaTransicao(e("trabalhando"), e("esperando"), false), null);
  assert.equal(somDaTransicao(e("trabalhando", 0), e("ocioso", 1), false), null);
});

test("sem AudioContext (Node) nada lança", async () => {
  const desfazer = instalarGestos();
  try {
    assert.doesNotThrow(() => {
      setAtivo(true);
      tocarAtencao();
      tocarDing();
      tocarTeclado();
      tocarTecladoLimitado(1000);
      tocarTecladoLimitado(1001);
      tocar("atencao");
      tocar("ding");
      setAtivo(false);
      tocarAtencao();
    });
    assert.equal(await destravarSom(), false);
    assert.equal(somFuncionando(), false);
  } finally {
    desfazer();
    setAtivo(true); // o estado do módulo vaza entre testes
  }
});
