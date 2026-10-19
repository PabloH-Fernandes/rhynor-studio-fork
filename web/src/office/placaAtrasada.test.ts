import assert from "node:assert/strict";
import { test } from "node:test";
import { escolherPortador, lugarDaPlaca } from "./placaAtrasada";

test("sem pendência atrasada ou sem elegível, ninguém segura a plaquinha", () => {
  assert.equal(escolherPortador(false, ["a", "b"], "a"), null);
  assert.equal(escolherPortador(true, [], null), null);
});

test("escolha determinística: o menor id; quem já segura continua enquanto puder", () => {
  assert.equal(escolherPortador(true, ["dev-2", "dev-1", "rev-1"], null), "dev-1");
  assert.equal(escolherPortador(true, ["dev-2", "dev-1"], "dev-2"), "dev-2");
  assert.equal(escolherPortador(true, ["dev-1", "rev-1"], "dev-2"), "dev-1");
});

test("a plaquinha vai à direita; bate em área proibida, vai à esquerda; nos dois lados, não aparece", () => {
  const livre = lugarDaPlaca(100, 100, []);
  assert.equal(livre?.lado, 1);
  assert.ok(livre && livre.rect.x === 106 && livre.rect.y === 79);
  const direitaOcupada = [{ x: 108, y: 80, w: 4, h: 4 }];
  assert.equal(lugarDaPlaca(100, 100, direitaOcupada)?.lado, -1);
  const esquerdaTambem = [...direitaOcupada, { x: 88, y: 80, w: 4, h: 4 }];
  assert.equal(lugarDaPlaca(100, 100, esquerdaTambem), null);
});

test("a plaquinha fica acima dos pés do boneco (na altura da cabeça), nunca na linha do tampo da mesa", () => {
  const lugar = lugarDaPlaca(100, 100, []);
  assert.ok(lugar && lugar.rect.y + lugar.rect.h < 100);
});
