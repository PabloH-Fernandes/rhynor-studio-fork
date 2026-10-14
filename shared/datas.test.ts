import assert from "node:assert/strict";
import { test } from "node:test";
import { dataBr, dataEfetiva, diaLocal, ehDataValida } from "./datas.ts";

test("ehDataValida: mês 01-12, dia que existe, formato AAAA-MM-DD", () => {
  assert.equal(ehDataValida("2026-10-14"), true);
  assert.equal(ehDataValida("2024-02-29"), true, "ano bissexto");
  assert.equal(ehDataValida(" 2026-01-01 "), true);
  assert.equal(ehDataValida("2026-13-45"), false);
  assert.equal(ehDataValida("2026-02-31"), false);
  assert.equal(ehDataValida("2026-00-10"), false);
  assert.equal(ehDataValida("2025-02-29"), false);
  assert.equal(ehDataValida(""), false);
  assert.equal(ehDataValida("2026-1-5"), false);
});

test("dataEfetiva: data válida; senão dia local de atualizadoEm; senão vazio", () => {
  const ms = new Date(2025, 11, 1, 23, 30).getTime();
  assert.equal(dataEfetiva({ data: "2026-10-14", atualizadoEm: ms }), "2026-10-14");
  assert.equal(dataEfetiva({ data: "2026-13-45", atualizadoEm: ms }), "2025-12-01");
  assert.equal(dataEfetiva({ data: "", atualizadoEm: ms }), "2025-12-01");
  assert.equal(dataEfetiva({ data: "", atualizadoEm: 0 }), "");
  assert.equal(diaLocal(NaN), "");
  assert.equal(dataBr("2026-03-05"), "05/03/2026");
});
