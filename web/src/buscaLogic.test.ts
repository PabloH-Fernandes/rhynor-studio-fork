import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_PERGUNTA,
  TEXTO_VAZIO,
  comandoPergunta,
  consultaDe,
  ehUriObsidian,
  lerRespostaBusca,
  textoContagem,
  textoErroBusca,
  urlBusca,
} from "./buscaLogic";

test("consultaDe: só com 2 letras ou mais, sem espaços sobrando", () => {
  assert.equal(consultaDe(""), null);
  assert.equal(consultaDe(" a "), null);
  assert.equal(consultaDe("  ab  "), "ab");
  assert.equal(consultaDe("duas   palavras"), "duas palavras");
  assert.equal(consultaDe("x".repeat(200))?.length, 80);
});

test("urlBusca codifica a pergunta", () => {
  assert.equal(urlBusca("ação & código"), "/api/busca?q=a%C3%A7%C3%A3o%20%26%20c%C3%B3digo");
});

test("ehUriObsidian: só obsidian://open?", () => {
  assert.equal(ehUriObsidian("obsidian://open?vault=a&file=b"), true);
  assert.equal(ehUriObsidian("javascript:alert(1)"), false);
  assert.equal(ehUriObsidian("obsidian://new?vault=a"), false);
  assert.equal(ehUriObsidian("https://exemplo.test"), false);
  assert.equal(ehUriObsidian(undefined), false);
});

test("comandoPergunta: uma linha, sem controle, com limite", () => {
  assert.equal(comandoPergunta("o que decidimos?"), "/memoria o que decidimos?");
  assert.equal(comandoPergunta("linha 1\nlinha 2\r\n\tlinha 3\u0007"), "/memoria linha 1 linha 2 linha 3");
  assert.ok(!comandoPergunta(`a${String.fromCharCode(0x2028)}b`).includes(String.fromCharCode(0x2028)));
  const longo = comandoPergunta("palavra ".repeat(100));
  assert.ok(!longo.includes("\n"));
  assert.ok(longo.length <= "/memoria ".length + MAX_PERGUNTA);
});

test("textos em português simples", () => {
  assert.equal(textoContagem(0, 0), TEXTO_VAZIO);
  assert.equal(textoContagem(1, 1), "1 nota encontrada.");
  assert.equal(textoContagem(5, 5), "5 notas encontradas.");
  assert.equal(textoContagem(20, 31), "31 notas encontradas. Mostrando as 20 primeiras.");
  assert.match(textoErroBusca(null), /conexão/);
  assert.match(textoErroBusca(400), /2 a 80/);
  assert.match(textoErroBusca(500), /não funcionou/);
});

test("lerRespostaBusca: descarta lixo e nunca mostra trecho de nota confidencial", () => {
  assert.equal(lerRespostaBusca(null), null);
  assert.equal(lerRespostaBusca({ itens: "x" }), null);
  const r = lerRespostaBusca({
    itens: [
      { titulo: "A", rel: "A.md", uri: "obsidian://open?vault=v&file=A", confidencial: false, trecho: "oi" },
      { titulo: "B", rel: "B.md", uri: "obsidian://open?vault=v&file=B", confidencial: true, trecho: "segredo" },
      { titulo: 3 },
      null,
    ],
    total: 7,
  });
  assert.ok(r);
  assert.equal(r.itens.length, 2);
  assert.equal(r.itens[0].trecho, "oi");
  assert.equal(r.itens[1].trecho, undefined);
  assert.equal(r.itens[1].confidencial, true);
  assert.equal(r.total, 7);
  assert.equal(r.semVault, false);
  assert.equal(lerRespostaBusca({ itens: [], semVault: true })?.semVault, true);
});
