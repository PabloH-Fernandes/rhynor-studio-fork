import assert from "node:assert/strict";
import { test } from "node:test";
import { ROTULO_GASTO, SEM_DADO, ehGastoHoje, formatarTokens } from "./gasto.ts";

test("formatarTokens: sem dado é traço, nunca 0", () => {
  assert.equal(formatarTokens(null), SEM_DADO);
  assert.equal(formatarTokens(undefined), SEM_DADO);
  assert.equal(formatarTokens(Number.NaN), SEM_DADO);
  assert.equal(formatarTokens(-1), SEM_DADO);
  assert.equal(formatarTokens(950), "950");
  assert.equal(formatarTokens(1234), "1,2 mil");
  assert.equal(formatarTokens(12_000), "12 mil");
  assert.equal(formatarTokens(1_550_000), "1,6 mi");
});

test("ehGastoHoje confere o formato vindo do servidor", () => {
  const ok = { total: { tokens: 10, cacheLeitura: 2 }, porPapel: { dev: { tokens: 10, cacheLeitura: 2 } } };
  assert.equal(ehGastoHoje(ok), true);
  assert.equal(ehGastoHoje(null), false);
  assert.equal(ehGastoHoje({ total: { tokens: "10", cacheLeitura: 2 }, porPapel: {} }), false);
  assert.equal(ehGastoHoje({ total: ok.total, porPapel: { dev: { tokens: 1 } } }), false);
});

test("a mensagem de gasto só leva números e nomes de papel (privacidade)", () => {
  const msg = { total: { tokens: 10, cacheLeitura: 2 }, porPapel: { dev: { tokens: 10, cacheLeitura: 2 } } };
  const textos: string[] = [];
  JSON.stringify(msg, (k, v) => {
    if (typeof v === "string") textos.push(v);
    if (k) textos.push(k);
    return v;
  });
  for (const t of textos) assert.match(t, /^(total|tokens|cacheLeitura|porPapel|dev)$/);
  assert.match(ROTULO_GASTO, /não é custo/);
});
