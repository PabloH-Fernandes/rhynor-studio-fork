import assert from "node:assert/strict";
import { test } from "node:test";
import { somarDias, urgenciaDe } from "./prazos.ts";

test("atrasada só quando o prazo é antes de hoje", () => {
  assert.equal(urgenciaDe("2026-10-16", "2026-10-17"), "atrasada");
  assert.equal(urgenciaDe("2026-10-17", "2026-10-17"), "logo");
});

test("logo vale de hoje até hoje + 2 dias; depois é no-prazo", () => {
  assert.equal(urgenciaDe("2026-10-18", "2026-10-17"), "logo");
  assert.equal(urgenciaDe("2026-10-19", "2026-10-17"), "logo");
  assert.equal(urgenciaDe("2026-10-20", "2026-10-17"), "no-prazo");
});

test("virada de mês e de ano", () => {
  assert.equal(urgenciaDe("2026-11-01", "2026-10-30"), "logo");
  assert.equal(urgenciaDe("2026-11-02", "2026-10-30"), "no-prazo");
  assert.equal(urgenciaDe("2027-01-02", "2026-12-31"), "logo");
  assert.equal(urgenciaDe("2027-01-03", "2026-12-31"), "no-prazo");
  assert.equal(urgenciaDe("2026-12-31", "2027-01-01"), "atrasada");
});

test("29/02 de ano bissexto e não bissexto", () => {
  assert.equal(urgenciaDe("2028-02-29", "2028-02-27"), "logo");
  assert.equal(urgenciaDe("2028-03-01", "2028-02-27"), "no-prazo");
  assert.equal(urgenciaDe("2028-03-01", "2028-02-28"), "logo");
  assert.equal(urgenciaDe("2028-03-02", "2028-02-28"), "no-prazo");
  assert.equal(urgenciaDe("2027-03-01", "2027-02-28"), "logo");
  assert.equal(urgenciaDe("2028-02-28", "2028-02-29"), "atrasada");
  assert.equal(somarDias("2028-02-28", 2), "2028-03-01");
  assert.equal(somarDias("2027-02-28", 2), "2027-03-02");
});

test("sem prazo ou prazo inválido é sem-prazo (2026-02-31 não existe)", () => {
  assert.equal(urgenciaDe("", "2026-10-17"), "sem-prazo");
  assert.equal(urgenciaDe("2026-02-31", "2026-10-17"), "sem-prazo");
  assert.equal(urgenciaDe("amanhã", "2026-10-17"), "sem-prazo");
  assert.equal(urgenciaDe("2026-10-17", ""), "sem-prazo");
});
