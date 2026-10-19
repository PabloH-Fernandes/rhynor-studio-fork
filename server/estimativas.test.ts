// Estimativas de tempo (data/estimativas.json): valores válidos, inválidos e arquivo ausente. Só pastas temporárias (mkdtemp).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ESTIMATIVAS_PADRAO } from "../shared/resultados.ts";
import { criarLeitorEstimativas, loadEstimativas, validarEstimativas } from "./estimativas.ts";

function pasta(): { dir: string; arq: string; limpar: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "estim-"));
  return { dir, arq: path.join(dir, "estimativas.json"), limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("validarEstimativas aceita números de 0 a 10000 e completa o que falta com o padrão", () => {
  const r = validarEstimativas({ ataProcessada: 30, missaoConcluida: 0 });
  assert.deepEqual(r.estimativas, { ...ESTIMATIVAS_PADRAO, ataProcessada: 30, missaoConcluida: 0 });
  assert.deepEqual(r.avisos, []);
});

test("validarEstimativas rejeita negativo, texto, nulo, infinito e fora do teto (padrão + aviso)", () => {
  const r = validarEstimativas({ ataProcessada: -5, tarefaAprovada: "10", missaoConcluida: null, pendenciaFechada: 99999 });
  assert.deepEqual(r.estimativas, ESTIMATIVAS_PADRAO);
  assert.equal(r.avisos.length, 4);
  assert.ok(r.avisos.every((a) => a.includes("usei")));
  assert.equal(validarEstimativas({ ataProcessada: Number.POSITIVE_INFINITY }).estimativas.ataProcessada, ESTIMATIVAS_PADRAO.ataProcessada);
  for (const ruim of [null, [], "texto", 5]) {
    const x = validarEstimativas(ruim);
    assert.deepEqual(x.estimativas, ESTIMATIVAS_PADRAO);
    assert.equal(x.avisos.length, 1);
  }
});

test("loadEstimativas: sem arquivo usa o padrão sem avisar; JSON quebrado e valor ruim avisam", () => {
  const p = pasta();
  try {
    const avisos: string[] = [];
    assert.deepEqual(loadEstimativas(p.arq, (m) => avisos.push(m)), ESTIMATIVAS_PADRAO);
    assert.equal(avisos.length, 0);

    fs.writeFileSync(p.arq, "{ isso não é json");
    assert.deepEqual(loadEstimativas(p.arq, (m) => avisos.push(m)), ESTIMATIVAS_PADRAO);
    assert.equal(avisos.length, 1);

    fs.writeFileSync(p.arq, "﻿" + JSON.stringify({ ataProcessada: 45, tarefaAprovada: -1 }));
    const r = loadEstimativas(p.arq, (m) => avisos.push(m));
    assert.equal(r.ataProcessada, 45);
    assert.equal(r.tarefaAprovada, ESTIMATIVAS_PADRAO.tarefaAprovada);
    assert.equal(avisos.length, 2);
    assert.match(avisos[1], /tarefaAprovada/);
  } finally {
    p.limpar();
  }
});

test("o arquivo de exemplo versionado é válido e igual ao padrão", () => {
  const exemplo = path.resolve(import.meta.dirname, "..", "data", "estimativas.example.json");
  const r = validarEstimativas(JSON.parse(fs.readFileSync(exemplo, "utf8")));
  assert.deepEqual(r.avisos, []);
  assert.deepEqual(r.estimativas, ESTIMATIVAS_PADRAO);
});

test("criarLeitorEstimativas relê só quando o arquivo muda e avisa uma vez por mudança", () => {
  const p = pasta();
  try {
    const avisos: string[] = [];
    const ler = criarLeitorEstimativas(p.arq, (m) => avisos.push(m));
    assert.deepEqual(ler(), ESTIMATIVAS_PADRAO);
    fs.writeFileSync(p.arq, JSON.stringify({ ataProcessada: -1 }));
    ler();
    ler();
    ler();
    assert.equal(avisos.length, 1, "o aviso não se repete a cada recálculo");
    fs.writeFileSync(p.arq, JSON.stringify({ ataProcessada: 25, extra: 1 }));
    assert.equal(ler().ataProcessada, 25);
  } finally {
    p.limpar();
  }
});
