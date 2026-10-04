// Testes do texto do overlay (sem DOM): npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { noLigatures } from "./overlay";

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
