// Guardas da marca Rhynor (npm test). Conferem os arquivos versionados (git ls-files):
//  (a) nenhuma cor literal (#rgb, #rrggbb, #rrggbbaa, rgb(N, rgba(N) fora de web/src/marca/tokens.css;
//  (b) nenhuma menção à marca antiga;
//  (c) a cópia dos tokens é igual à matriz da marca;
//  (d) todo id de cor do elenco aponta para um token existente (coberto em shared/roster.test.ts).
// Os padrões da marca antiga são montados por concatenação para este arquivo não acusar a si mesmo.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESTE = "scripts/marca.test.mjs";

const versionados = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const BINARIO = /\.(png|jpe?g|gif|ico|webp|ttf|otf|woff2?|pdf|zip)$/i;

/** arquivos de texto versionados que ainda existem no disco (fora as exceções) */
function textos(excecao) {
  return versionados.filter((f) => !BINARIO.test(f) && !excecao(f) && fs.existsSync(path.join(ROOT, f)));
}

/** linhas que casam com o padrão, no formato "arquivo:linha: trecho" */
function achados(arquivos, padrao) {
  const out = [];
  for (const f of arquivos) {
    const linhas = fs.readFileSync(path.join(ROOT, f), "utf8").split(/\r?\n/);
    linhas.forEach((l, i) => {
      padrao.lastIndex = 0;
      if (padrao.test(l)) out.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`);
    });
  }
  return out;
}

test("(a) nenhuma cor literal fora de web/src/marca/tokens.css", () => {
  const excecao = (f) => f === "web/src/marca/tokens.css" || f.startsWith("referencias/") || f === "package-lock.json";
  // # seguido de 3, 6 ou 8 dígitos hex inteiros (dígitos colados em letra ou âncora de markdown não contam),
  // e rgb(/rgba( com número literal logo depois
  const hex = new RegExp("(?<![\\w&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])");
  const rgb = /rgba?\(\s*\d/;
  const lista = [...achados(textos(excecao), hex), ...achados(textos(excecao), rgb)];
  assert.deepEqual(lista, [], `cor literal fora dos tokens:\n${lista.join("\n")}`);
});

test("(b) nenhuma menção à marca antiga", () => {
  const excecao = (f) => f === "referencias/missao-studio-v1.md" || f === "referencias/rhynor-marca.md" || f === ESTE || f === "package-lock.json";
  const A = "A";
  const G = "G";
  const sigla = A + G;
  const padroes = [
    new RegExp(`\\b${sigla}\\b`), // a sigla sozinha, em maiúsculas
    new RegExp(`${sigla}zinho`, "i"),
    new RegExp(`${sigla}[ _-]?Pocket`, "i"), // nome do produto antigo, a variável e o marcador
    new RegExp(`Andr${"ade"}`),
    new RegExp(`Gutier${"rez"}`, "i"),
    new RegExp(`${sigla}-Cere${"bro"}`, "i"),
    new RegExp(`0517${"33"}`),
    new RegExp(`mari${"nho"}`, "i"),
  ];
  const arquivos = textos(excecao);
  const lista = padroes.flatMap((p) => achados(arquivos, p));
  assert.deepEqual(lista, [], `menção à marca antiga:\n${lista.join("\n")}`);
});

test("(c) web/src/marca/tokens.css é igual à matriz referencias/rhynor-marca/tokens.css", () => {
  const ler = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
  assert.equal(ler("web/src/marca/tokens.css"), ler("referencias/rhynor-marca/tokens.css"));
});

test("(d) os ids de cor do elenco apontam para tokens que existem (conferido em shared/roster.test.ts)", () => {
  const t = fs.readFileSync(path.join(ROOT, "shared", "roster.test.ts"), "utf8");
  assert.match(t, /todo id de cor aponta para um token --rh-\* da marca/);
});
