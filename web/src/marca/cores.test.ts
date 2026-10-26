import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { aoMudarCores, comAlfa, cor, definirCores, derivada, lerTokens, misturar } from "./cores";
import { palette, theme } from "../theme";

afterEach(() => definirCores(null));

test("lerTokens pega só o :root principal (o tema claro fica de fora)", () => {
  const t = lerTokens(":root {\n  --rh-a: #000000;\n  --rh-b: 4px;\n}\n:root[data-theme=\"claro\"] {\n  --rh-a: #FFFFFF;\n}\n");
  assert.deepEqual(t, { "rh-a": "#000000", "rh-b": "4px" });
});

test("no Node, cor() lê o tokens.css do disco", () => {
  assert.match(cor("rh-laranja"), /^#[0-9A-F]{6}$/i);
  assert.equal(cor("--rh-laranja"), cor("rh-laranja"));
});

test("token que não existe ou que não é cor dá erro claro", () => {
  assert.throws(() => cor("rh-nao-existe"), /--rh-nao-existe não existe/);
  assert.throws(() => cor("rh-borda-px"), /não é uma cor/);
});

test("misturar e comAlfa aceitam token ou #rrggbb", () => {
  definirCores({ "rh-a": "#000000", "rh-b": "#FFFFFF" });
  assert.equal(misturar("rh-a", "rh-b", 0.5), "#808080");
  assert.equal(misturar("#000000", "rh-b", 0), "#000000");
  assert.equal(comAlfa("rh-b", 0.5), "#FFFFFF80");
});

test("definirCores troca a fonte, avisa os ouvintes e refaz as derivadas", () => {
  let avisos = 0;
  const desliga = aoMudarCores(() => avisos++);
  definirCores({ "rh-a": "#111111" });
  const d = derivada(() => cor("rh-a"));
  assert.equal(d(), "#111111");
  definirCores({ "rh-a": "#222222" });
  assert.equal(d(), "#222222");
  assert.equal(avisos, 2);
  desliga();
});

test("a paleta do canvas sai toda dos tokens (#rrggbb, com alpha só onde é sombra)", () => {
  const folhas: string[] = [];
  const andar = (o: object) => {
    for (const v of Object.values(o)) {
      if (typeof v === "string") folhas.push(v);
      else if (Array.isArray(v)) for (const k of v) folhas.push(k.top, k.bottom);
      else if (v && typeof v === "object") andar(v);
    }
  };
  andar(palette);
  andar(theme.colors);
  assert.ok(folhas.length > 50);
  for (const c of folhas) assert.match(c, /^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
});
