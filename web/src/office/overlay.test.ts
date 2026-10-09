// Testes do texto do overlay (sem DOM): npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { noLigatures, textosDoNome } from "./overlay";

const ZWNJ = "‌";

describe("noLigatures", () => {
  it('quebra o "fi" de "Sofia" com um ZWNJ', () => {
    assert.equal(noLigatures("Sofia"), `Sof${ZWNJ}ia`);
    assert.equal(noLigatures("Sofia Arruda"), `Sof${ZWNJ}ia Arruda`);
  });

  it("sem f seguido de letra, fica igual", () => {
    assert.equal(noLigatures("café"), "café");
    assert.equal(noLigatures("Bia"), "Bia");
    assert.equal(noLigatures("chef!"), "chef!");
  });

  it('"Fifi": só o f minúsculo seguido de letra muda', () => {
    assert.equal(noLigatures("Fifi"), `Fif${ZWNJ}i`);
  });
});

describe("textosDoNome", () => {
  it("lider com projeto: o mais largo leva o projeto, depois nome inteiro e primeiro nome", () => {
    assert.deepEqual(textosDoNome("Claude (lider)", "loja", true), ["Claude (lider) · loja", "Claude (lider)", "Claude"]);
  });
  it("subagente herda o projeto mas a etiqueta nao repete", () => {
    assert.deepEqual(textosDoNome("Bia Souza", "loja", false), ["Bia Souza", "Bia"]);
  });
  it("sem projeto, igual a antes; projeto longo e abreviado", () => {
    assert.deepEqual(textosDoNome("Bia", undefined, true), ["Bia"]);
    assert.equal(textosDoNome("Bia", "um-projeto-muito-comprido", true)[0], "Bia · um-projeto-m..");
  });
});
