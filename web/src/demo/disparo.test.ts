import assert from "node:assert/strict";
import { test } from "node:test";
import { liberarDisparoDemo, reservarDisparoDemo } from "./disparo";

test("o disparo da simulação é reservado uma vez só; falha libera para tentar de novo", () => {
  liberarDisparoDemo();
  assert.equal(reservarDisparoDemo(), true);
  assert.equal(reservarDisparoDemo(), false, "remontagem do componente não pede de novo");
  assert.equal(reservarDisparoDemo(), false);
  liberarDisparoDemo();
  assert.equal(reservarDisparoDemo(), true);
  liberarDisparoDemo();
});
