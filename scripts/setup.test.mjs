import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ROOT,
  MARCA_INICIO,
  MARCA_FIM,
  aplicaBloco,
  aplicaEnv,
  detectaErroCert,
  dicaCert,
  escolheNavegador,
  hooksEmDia,
  lerCatalogo,
  mcpExisteNaLista,
  montaBlocoTime,
  montaComando,
  navegadorDoServidor,
  parseFlags,
  validaCatalogo,
} from "./setup.mjs";

test("parseFlags", () => {
  const f = parseFlags(["--dry-run", "--completo", "--browser=chrome"]);
  assert.equal(f.dryRun, true);
  assert.equal(f.completo, true);
  assert.equal(f.browser, "chrome");
  assert.deepEqual(f.erros, []);
  assert.equal(parseFlags(["--check", "--sem-plugins"]).semPlugins, true);
  assert.equal(parseFlags(["--browser=ie"]).erros.length, 1);
  assert.equal(parseFlags(["--xpto"]).erros.length, 1);
});

test("escolheNavegador", () => {
  const nav = { win32: "msedge", padrao: "chrome" };
  assert.equal(escolheNavegador("win32", null, nav), "msedge");
  assert.equal(escolheNavegador("linux", null, nav), "chrome");
  assert.equal(escolheNavegador("darwin", null, nav), "chrome");
  assert.equal(escolheNavegador("win32", "firefox", nav), "firefox");
});

test("detectaErroCert e dica sem desligar SSL", () => {
  assert.equal(detectaErroCert("npm error code UNABLE_TO_GET_ISSUER_CERT_LOCALLY"), true);
  assert.equal(detectaErroCert("Error: SELF_SIGNED_CERT_IN_CHAIN"), true);
  assert.equal(detectaErroCert("ENOTFOUND"), false);
  assert.match(dicaCert("win32").join(" "), /\$env:NODE_OPTIONS="--use-system-ca"/);
  assert.match(dicaCert("linux").join(" "), /export NODE_OPTIONS=--use-system-ca/);
});

test("montaComando aspa argumentos com espaço", () => {
  assert.equal(montaComando("npm", ["run", "x y"], "win32"), 'npm run "x y"');
  assert.equal(montaComando("claude", ["mcp", "--", "@p/m@latest"], "win32"), "claude mcp -- @p/m@latest");
  assert.equal(montaComando("echo", ["a b", "it's"], "linux"), "echo 'a b' 'it'\\''s'");
});

test("aplicaBloco: criar, igual, atualizar, anexar, erro", () => {
  const bloco = "# Time de AGzinhos\n\ncorpo v1";
  const criado = aplicaBloco(null, bloco);
  assert.equal(criado.acao, "criar");
  assert.ok(criado.texto.startsWith(MARCA_INICIO) && criado.texto.trimEnd().endsWith(MARCA_FIM));

  assert.equal(aplicaBloco(criado.texto, bloco).acao, "igual");
  assert.equal(aplicaBloco(criado.texto.replace(/\n/g, "\r\n"), bloco).acao, "igual");

  const novo = aplicaBloco(`antes\n\n${criado.texto}\ndepois\n`, "# Time de AGzinhos\n\ncorpo v2");
  assert.equal(novo.acao, "atualizar");
  assert.match(novo.texto, /^antes\n\n/);
  assert.match(novo.texto, /corpo v2/);
  assert.doesNotMatch(novo.texto, /corpo v1/);
  assert.match(novo.texto, /\ndepois\n$/);

  const crlf = aplicaBloco("# meu\r\ntexto\r\n", bloco);
  assert.equal(crlf.acao, "anexar");
  assert.equal(crlf.aviso, undefined);
  assert.ok(crlf.texto.startsWith("# meu\r\ntexto\r\n\r\n"));
  assert.ok(!/[^\r]\n/.test(crlf.texto));

  const dup = aplicaBloco("# Time de AGzinhos\n\nvelho\n", bloco);
  assert.equal(dup.acao, "anexar");
  assert.ok(dup.aviso);
  assert.match(dup.texto, /^# Time de AGzinhos\n\nvelho\n/);

  for (const t of [`x ${MARCA_INICIO} y`, `x ${MARCA_FIM} y`, `${MARCA_FIM}\n${MARCA_INICIO}`]) {
    const r = aplicaBloco(t, bloco);
    assert.equal(r.acao, "erro");
    assert.equal(r.texto, t);
  }
});

test("montaBlocoTime descarta o cabeçalho e usa o título novo", () => {
  const fonte = fs.readFileSync(path.join(ROOT, "team", "CLAUDE-time.md"), "utf8");
  const b = montaBlocoTime(fonte);
  assert.ok(b.startsWith("# Time de AGzinhos\n\nVocê é o **líder**"));
  assert.ok(!b.includes("Cole este bloco") && !b.includes("vault"));
});

test("aplicaEnv preserva o resto e não mexe se já está certo", () => {
  const base = { model: "x", env: { A: "1" }, hooks: { Stop: [] } };
  const r = aplicaEnv(base);
  assert.equal(r.mudou, true);
  assert.deepEqual(r.settings.env, { A: "1", CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" });
  assert.equal(r.settings.model, "x");
  assert.equal(aplicaEnv(r.settings).mudou, false);
  assert.equal(aplicaEnv({}).mudou, true);
  assert.ok(aplicaEnv({ env: "oops" }).erro);
});

test("catálogo real é válido e validaCatalogo acusa problemas", () => {
  const cat = lerCatalogo();
  assert.ok(cat.essenciais.some((i) => i.tipo === "mcp" && i.nome === "playwright"));
  assert.ok(cat.extras.some((i) => i.tipo === "skill-manual"));
  assert.ok(validaCatalogo({ versao: 2, essenciais: [], extras: [] }).length > 0);
  assert.ok(validaCatalogo({ versao: 1, essenciais: [{ id: "a", tipo: "xx", paraQue: "p" }], extras: [] }).length > 0);
  assert.ok(validaCatalogo({ versao: 1, essenciais: [{ id: "a", tipo: "skill", paraQue: "p", repo: "r" }], extras: [] }).length > 0);
  const dup = { id: "a", tipo: "skill", paraQue: "p", repo: "r", skill: "s" };
  assert.ok(validaCatalogo({ versao: 1, essenciais: [dup, dup], extras: [] }).some((e) => /repetido/.test(e)));
});

test("MCP: navegador do servidor e linha da lista", () => {
  assert.equal(navegadorDoServidor({ args: ["@playwright/mcp@latest", "--browser", "msedge"] }), "msedge");
  assert.equal(navegadorDoServidor({ args: ["--browser=chrome"] }), "chrome");
  assert.equal(navegadorDoServidor({}), null);
  assert.equal(mcpExisteNaLista("a: x - ok\nplaywright: npx foo - ✓ Connected\n", "playwright"), true);
  assert.equal(mcpExisteNaLista("plugin:playwright: x\n", "playwright"), false);
});

test("hooks: install-hooks real satisfaz hooksEmDia, e outra pasta não", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agp-home-"));
  try {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "install-hooks.mjs")], { env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const settings = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
    assert.equal(hooksEmDia(settings, ROOT), true);
    assert.equal(hooksEmDia(settings, path.join(ROOT, "outra")), false);
    assert.equal(hooksEmDia({}, ROOT), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
