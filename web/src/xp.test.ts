import assert from "node:assert/strict";
import { test } from "node:test";
import { legendaXp, xpDasEntregas } from "./xp.ts";

test("xp: 10 entregas por nível; antes da 10ª não há nível (nada de \"Nível 0\" na tela)", () => {
  assert.deepEqual(xpDasEntregas(0), { nivel: 0, noNivel: 0, faltam: 10, total: 0 });
  assert.deepEqual(xpDasEntregas(9), { nivel: 0, noNivel: 9, faltam: 1, total: 9 });
  assert.deepEqual(xpDasEntregas(10), { nivel: 1, noNivel: 0, faltam: 10, total: 10 });
  assert.deepEqual(xpDasEntregas(23), { nivel: 2, noNivel: 3, faltam: 7, total: 23 });
});

test("xp: valor estranho do servidor não quebra a barra", () => {
  assert.equal(xpDasEntregas(-4).total, 0);
  assert.equal(xpDasEntregas(Number.NaN).nivel, 0);
  assert.equal(xpDasEntregas(2.7).total, 2);
});

test("xp: legenda com singular e plural", () => {
  assert.equal(legendaXp(xpDasEntregas(0)), "0 entregas hoje, faltam 10 pro Nível 1");
  assert.equal(legendaXp(xpDasEntregas(1)), "1 entrega hoje, faltam 9 pro Nível 1");
  assert.equal(legendaXp(xpDasEntregas(19)), "19 entregas hoje, falta 1 pro Nível 2");
});
