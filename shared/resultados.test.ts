import assert from "node:assert/strict";
import { test } from "node:test";
import { ESTIMATIVAS_PADRAO, formatarMinutos } from "./resultados.ts";

test("formatarMinutos: texto simples", () => {
  assert.equal(formatarMinutos(0), "0 min");
  assert.equal(formatarMinutos(45), "45 min");
  assert.equal(formatarMinutos(60), "1 h");
  assert.equal(formatarMinutos(80), "1 h 20 min");
  assert.equal(formatarMinutos(-5), "0 min");
  assert.equal(formatarMinutos(NaN), "0 min");
  assert.equal(formatarMinutos(100.4), "1 h 40 min");
});

test("padrões: ata 20 min e missão 60 min; tarefa e pendência 0 (evita dupla contagem)", () => {
  assert.equal(ESTIMATIVAS_PADRAO.ataProcessada, 20);
  assert.equal(ESTIMATIVAS_PADRAO.missaoConcluida, 60);
  assert.equal(ESTIMATIVAS_PADRAO.tarefaAprovada, 0);
  assert.equal(ESTIMATIVAS_PADRAO.pendenciaFechada, 0);
});
