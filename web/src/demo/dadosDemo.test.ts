import assert from "node:assert/strict";
import { test } from "node:test";
import { ehResultados } from "../resultadosLogic";
import { APROVA_NO_MS, ATA_ID, CONTADOR_MS, COMANDO_DEMO, ataDemo, interpolarResultados, resultadosAntes, resultadosDepois, visaoDoPasso } from "./dadosDemo";

const HOJE = "2026-10-19";

test("os resultados da demo têm a forma esperada e a estimativa bate com a conta", () => {
  for (const r of [resultadosAntes(HOJE), resultadosDepois(HOJE)]) {
    assert.ok(ehResultados(r));
    assert.equal(r.incluiFicticias, true);
    assert.equal(r.atas.total, r.atasSemIa.total + r.atasComIa.total);
    assert.equal(r.tempoEconomizado.total, r.atas.total * r.estimativas.ataProcessada + r.missoesConcluidas.total * r.estimativas.missaoConcluida);
  }
});

test("depois tem mais que antes", () => {
  const a = resultadosAntes(HOJE);
  const d = resultadosDepois(HOJE);
  assert.ok(d.atas.hoje > a.atas.hoje);
  assert.ok(d.tempoEconomizado.total > a.tempoEconomizado.total);
  assert.ok(d.tarefasAprovadas.total > a.tarefasAprovadas.total);
});

test("interpolar: 0 é antes, 1 é depois, no meio fica entre os dois", () => {
  const a = resultadosAntes(HOJE);
  const d = resultadosDepois(HOJE);
  assert.deepEqual(interpolarResultados(a, d, 0).tempoEconomizado, a.tempoEconomizado);
  assert.deepEqual(interpolarResultados(a, d, 1).tempoEconomizado, d.tempoEconomizado);
  const m = interpolarResultados(a, d, 0.5).tempoEconomizado.total;
  assert.ok(m > a.tempoEconomizado.total && m < d.tempoEconomizado.total);
  // fora do intervalo ou inválido não estraga
  assert.deepEqual(interpolarResultados(a, d, 5).atas, d.atas);
  assert.deepEqual(interpolarResultados(a, d, -1).atas, a.atas);
  assert.deepEqual(interpolarResultados(a, d, NaN).atas, d.atas);
});

test("passo 1: a ata ainda não está na Caixa", () => {
  const v = visaoDoPasso(1, 0, HOJE);
  assert.equal(v.caixa.length, 0);
  assert.equal(v.aprovadas.length, 0);
  assert.deepEqual(v.resultados, resultadosAntes(HOJE));
});

test("passo 2: a ata aparece com as tarefas, sem escolhas", () => {
  const v = visaoDoPasso(2, 0, HOJE);
  assert.equal(v.caixa.length, 1);
  assert.equal(v.caixa[0].id, ATA_ID);
  assert.equal(v.caixa[0].tarefas.length, 4);
  assert.deepEqual(v.escolhas, {});
});

test("passo 3: marca as escolhas aos poucos e aprova no fim, com o comando pronto", () => {
  assert.deepEqual(visaoDoPasso(3, 0, HOJE).escolhas[ATA_ID], {});
  assert.deepEqual(visaoDoPasso(3, 2500, HOJE).escolhas[ATA_ID], { 1: "time" });
  const quase = visaoDoPasso(3, APROVA_NO_MS - 1, HOJE);
  assert.deepEqual(quase.escolhas[ATA_ID], { 1: "time", 2: "time", 3: "eu", 4: "eu" });
  assert.equal(quase.caixa.length, 1);
  const feito = visaoDoPasso(3, APROVA_NO_MS, HOJE);
  assert.equal(feito.caixa.length, 0);
  assert.equal(feito.aprovadas.length, 1);
  assert.equal(feito.aprovadas[0].comando, COMANDO_DEMO);
  assert.match(feito.aprovadas[0].comando ?? "", /^\/time Missão \[\[.+\]\]: /);
  assert.equal(feito.aprovadas[0].resumo, "2 para o time, 2 para você");
});

test("passos 4 e 5: o comando continua à mão e as pendências mudam", () => {
  const v4 = visaoDoPasso(4, 0, HOJE);
  assert.equal(v4.aprovadas.length, 1);
  const time4 = v4.pendencias.filter((x) => x.id.startsWith("demo:a") && x.dono === "time");
  assert.equal(time4.length, 2);
  const v5 = visaoDoPasso(5, 0, HOJE);
  assert.equal(v5.aprovadas.length, 1);
  assert.equal(v5.pendencias.filter((x) => x.id.startsWith("demo:a") && x.dono === "time").length, 0);
  assert.equal(v5.pendencias.length, v4.pendencias.length - 2);
  // os contadores sobem durante o passo 5
  const inicio = visaoDoPasso(5, 0, HOJE).resultados.tempoEconomizado.total;
  const meio = visaoDoPasso(5, CONTADOR_MS / 2, HOJE).resultados.tempoEconomizado.total;
  const fim = visaoDoPasso(5, CONTADOR_MS, HOJE).resultados.tempoEconomizado.total;
  assert.ok(inicio < meio && meio < fim);
});

test("sem animação (prefers-reduced-motion) o passo 5 já mostra o número final", () => {
  assert.deepEqual(visaoDoPasso(5, 0, HOJE, true).resultados, resultadosDepois(HOJE));
});

test("tem uma pendência atrasada e as demais não, para mostrar a urgência", () => {
  const v = visaoDoPasso(2, 0, HOJE);
  assert.equal(v.pendencias.filter((x) => x.urgencia === "atrasada").length, 1);
});

test("tarefas da ata usam só nomes genéricos de responsável", () => {
  for (const t of ataDemo(HOJE).tarefas) assert.match(t.responsavel, /^Responsável [A-Z]$/);
});
