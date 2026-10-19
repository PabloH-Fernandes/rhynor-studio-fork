import assert from "node:assert/strict";
import { test } from "node:test";
import { PASSOS, TOTAL_PASSOS, criarRoteiro } from "./roteiro";

function relogio(inicio = 1000) {
  let t = inicio;
  return { agora: () => t, passa: (ms: number) => (t += ms) };
}

test("o roteiro tem 5 passos e uns 3 minutos", () => {
  assert.equal(TOTAL_PASSOS, 5);
  assert.deepEqual(
    PASSOS.map((p) => p.n),
    [1, 2, 3, 4, 5],
  );
  const total = PASSOS.reduce((s, p) => s + p.duracaoMs, 0);
  assert.ok(total >= 170_000 && total <= 210_000, `total ${total}`);
});

test("começa no passo 1 e avança sozinho quando o tempo passa", () => {
  const r = relogio();
  const rot = criarRoteiro(r.agora);
  assert.equal(rot.estado().passo.n, 1);
  assert.equal(rot.estado().pausado, false);
  r.passa(PASSOS[0].duracaoMs - 1);
  assert.equal(rot.estado().passo.n, 1);
  r.passa(1);
  const e = rot.estado();
  assert.equal(e.passo.n, 2);
  assert.equal(e.decorridoMs, 0);
});

test("pular várias etapas de uma vez (aba oculta) cai no passo certo", () => {
  const r = relogio();
  const rot = criarRoteiro(r.agora);
  r.passa(PASSOS[0].duracaoMs + PASSOS[1].duracaoMs + PASSOS[2].duracaoMs + 5000);
  const e = rot.estado();
  assert.equal(e.passo.n, 4);
  assert.equal(e.decorridoMs, 5000);
});

test("pausar congela o tempo e retomar continua de onde parou", () => {
  const r = relogio();
  const rot = criarRoteiro(r.agora);
  r.passa(4000);
  rot.pausar();
  assert.equal(rot.estado().pausado, true);
  r.passa(60_000);
  const parado = rot.estado();
  assert.equal(parado.passo.n, 1);
  assert.equal(parado.decorridoMs, 4000);
  rot.retomar();
  r.passa(5999);
  assert.equal(rot.estado().passo.n, 1);
  r.passa(1);
  assert.equal(rot.estado().passo.n, 2);
});

test("alternar pausa e continua", () => {
  const r = relogio();
  const rot = criarRoteiro(r.agora);
  rot.alternar();
  assert.equal(rot.estado().pausado, true);
  rot.alternar();
  assert.equal(rot.estado().pausado, false);
});

test("avançar pula para o próximo passo e zera o tempo; pausado continua pausado", () => {
  const r = relogio();
  const rot = criarRoteiro(r.agora);
  r.passa(3000);
  rot.avancar();
  let e = rot.estado();
  assert.equal(e.passo.n, 2);
  assert.equal(e.decorridoMs, 0);
  rot.pausar();
  rot.avancar();
  e = rot.estado();
  assert.equal(e.passo.n, 3);
  assert.equal(e.pausado, true);
  r.passa(PASSOS[2].duracaoMs * 2);
  assert.equal(rot.estado().passo.n, 3, "pausado não anda");
});

test("chega ao fim e para no último passo", () => {
  const r = relogio();
  const rot = criarRoteiro(r.agora);
  r.passa(PASSOS.reduce((s, p) => s + p.duracaoMs, 0) + 1);
  let e = rot.estado();
  assert.equal(e.fim, true);
  assert.equal(e.passo.n, 5);
  r.passa(1_000_000);
  e = rot.estado();
  assert.equal(e.fim, true);
  assert.equal(e.passo.n, 5);
  rot.avancar();
  rot.alternar();
  assert.equal(rot.estado().fim, true);
});

test("avançar no último passo termina o roteiro", () => {
  const r = relogio();
  const rot = criarRoteiro(r.agora);
  for (let i = 0; i < TOTAL_PASSOS - 1; i++) rot.avancar();
  assert.equal(rot.estado().passo.n, 5);
  assert.equal(rot.estado().fim, false);
  rot.avancar();
  assert.equal(rot.estado().fim, true);
});
