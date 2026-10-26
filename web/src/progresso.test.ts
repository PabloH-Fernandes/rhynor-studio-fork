import assert from "node:assert/strict";
import { test } from "node:test";
import { segmentosCheios, separarContagem, textoDoProgresso } from "./progresso.ts";

test("texto do quadro: etapa, concluído, papel e de boa", () => {
  const etapa = textoDoProgresso({ fonte: "tarefas", etapa: 4, total: 7, concluidas: 3, titulo: "Construindo novas funções" });
  assert.equal(etapa.titulo, "Time na Etapa 4 de 7");
  assert.equal(etapa.detalhe, "Construindo novas funções");
  assert.deepEqual([etapa.valor, etapa.max], [4, 7]);

  const fim = textoDoProgresso({ fonte: "tarefas", etapa: 5, total: 5, concluidas: 5, titulo: "" });
  assert.equal(fim.estado, "concluido");
  assert.equal(fim.titulo, "AGzinhos concluíram 5 de 5");

  assert.equal(textoDoProgresso({ fonte: "papel", etapa: 0, total: 0, concluidas: 0, titulo: "Construção" }).titulo, "AGzinhos em Construção");
  assert.equal(textoDoProgresso({ fonte: "nada", etapa: 0, total: 0, concluidas: 0, titulo: "" }).titulo, "AGzinhos de boa");
});

test("barra de 10 segmentos: 4 de 7 enche 6; limites", () => {
  assert.equal(segmentosCheios(4, 7), 6);
  assert.equal(segmentosCheios(7, 7), 10);
  assert.equal(segmentosCheios(0, 0), 0);
  assert.equal(segmentosCheios(1, 12), 1);
});

test("contagem \"N de N\" separada do título (não quebra no meio)", () => {
  assert.deepEqual(separarContagem("Time na Etapa 2 de 6"), { frase: "Time na Etapa ", contagem: "2 de 6" });
  assert.deepEqual(separarContagem("AGzinhos concluíram 12 de 12"), { frase: "AGzinhos concluíram ", contagem: "12 de 12" });
  assert.deepEqual(separarContagem("AGzinhos de boa"), { frase: "AGzinhos de boa", contagem: "" });
});
