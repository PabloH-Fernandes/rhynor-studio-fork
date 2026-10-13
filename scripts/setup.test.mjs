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
  aplicaVaultEnv,
  confereVault,
  criaVault,
  estaDentro,
  resolveVault,
  ESTRUTURA_VAULT,
  detectaErroCert,
  dicaCert,
  escolheNavegador,
  hooksEmDia,
  idsPluginsInstalados,
  leJson,
  lerCatalogo,
  mcpExisteNaLista,
  montaBlocoTime,
  montaComando,
  navegadorDoServidor,
  parseFlags,
  skillStatus,
  veredictoCheckSkill,
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

test("setup sem claude/git no PATH para com exit 1, mensagem clara e não escreve nada", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agp-home-"));
  try {
    const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "vazio") };
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "setup.mjs")], { env, encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /claude \(Claude Code\) não encontrado no PATH/);
    assert.deepEqual(fs.readdirSync(home), []);
    const c = spawnSync(process.execPath, [path.join(ROOT, "scripts", "setup.mjs"), "--check"], { env, encoding: "utf8" });
    assert.equal(c.status, 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("parseFlags: --vault com caminho e vazio", () => {
  assert.equal(parseFlags(["--vault=C:\\Área de Trabalho\\Meu Cérebro"]).vault, "C:\\Área de Trabalho\\Meu Cérebro");
  assert.equal(parseFlags([]).vault, null);
  assert.equal(parseFlags(["--vault="]).erros.length, 1);
});

test("resolveVault: settings manda, depois a flag, depois AG-Cerebro irmão do repositório", () => {
  const root = path.resolve(os.tmpdir(), "Área de Trabalho", "AG-Project", "escritorio-ia");
  const irmao = path.resolve(os.tmpdir(), "Área de Trabalho", "AG-Project", "AG-Cerebro");
  assert.deepEqual(resolveVault({}, null, root), { caminho: irmao, origem: "padrao", diverge: false });
  const flag = path.resolve(os.tmpdir(), "Outro Cérebro");
  assert.equal(resolveVault({ env: {} }, flag, root).origem, "flag");
  assert.equal(resolveVault({ env: {} }, flag, root).caminho, flag);
  const doSettings = path.resolve(os.tmpdir(), "Já Configurado");
  const s = resolveVault({ env: { AGPOCKET_VAULT: doSettings } }, flag, root);
  assert.equal(s.caminho, doSettings);
  assert.equal(s.origem, "settings");
  assert.equal(s.diverge, true);
  assert.equal(resolveVault({ env: { AGPOCKET_VAULT: doSettings } }, doSettings, root).diverge, false);
  assert.equal(resolveVault({ env: { AGPOCKET_VAULT: "  " } }, null, root).origem, "padrao");
  assert.ok(resolveVault({ env: "oops" }, null, root).erro);
  // dentro do repositório: recusado
  assert.ok(resolveVault({}, path.join(root, "vault"), root).erro);
  assert.ok(resolveVault({ env: { AGPOCKET_VAULT: root } }, null, root).erro);
});

test("estaDentro: Windows sem diferenciar maiúsculas; pasta irmã com prefixo igual não conta", () => {
  const raiz = path.resolve(os.tmpdir(), "repo");
  assert.equal(estaDentro(path.join(raiz, "a"), raiz), true);
  assert.equal(estaDentro(raiz, raiz), true);
  assert.equal(estaDentro(`${raiz}-irmao`, raiz), false);
  assert.equal(estaDentro(path.dirname(raiz), raiz), false);
  assert.equal(estaDentro(path.join(raiz.toUpperCase(), "x"), raiz, "win32"), process.platform === "win32");
});

test("aplicaVaultEnv preserva o resto, não troca valor existente e é idempotente", () => {
  const caminho = "C:\\Users\\fulano\\Área de Trabalho\\AG-Cerebro";
  const base = { model: "x", env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" }, hooks: { Stop: [] } };
  const r = aplicaVaultEnv(base, caminho);
  assert.equal(r.mudou, true);
  assert.deepEqual(r.settings, { ...base, env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: "1", AGPOCKET_VAULT: caminho } });
  assert.equal(base.env.AGPOCKET_VAULT, undefined, "não muta a entrada");
  assert.equal(aplicaVaultEnv(r.settings, caminho).mudou, false);
  assert.equal(aplicaVaultEnv(r.settings, "D:\\outro").mudou, false);
  // sobrevive à ida e volta pelo JSON (espaço e acento)
  assert.equal(JSON.parse(JSON.stringify(r.settings)).env.AGPOCKET_VAULT, caminho);
  assert.equal(aplicaVaultEnv({}, caminho).mudou, true);
  assert.ok(aplicaVaultEnv({ env: [] }, caminho).erro);
});

test("criaVault/confereVault: cria do modelo real (espaço e acento), não sobrescreve, idempotente", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agp-vault-"));
  try {
    const modelo = path.join(ROOT, "vault-template");
    const destino = path.join(tmp, "Área de Trabalho", "Meu Cérebro");
    assert.equal(confereVault(destino).estado, "ausente");
    assert.deepEqual(criaVault(modelo, destino), { criou: true });
    assert.deepEqual(confereVault(destino), { estado: "ok", faltando: [] });
    for (const n of ESTRUTURA_VAULT) assert.ok(fs.existsSync(path.join(destino, n)), n);
    assert.ok(fs.existsSync(path.join(destino, "50-Time", "AGENTES.canvas")));
    assert.ok(fs.existsSync(path.join(destino, ".obsidian", "app.json")));

    // pasta existente fica intocada, mesmo com conteúdo diferente do modelo
    const indice = path.join(destino, "_indice.md");
    fs.writeFileSync(indice, "meu conteúdo");
    const antes = fs.readdirSync(destino).sort();
    assert.equal(criaVault(modelo, destino).criou, false);
    assert.equal(fs.readFileSync(indice, "utf8"), "meu conteúdo");
    assert.deepEqual(fs.readdirSync(destino).sort(), antes);

    // vault "de outro jeito": só conferido, nada criado dentro
    const outro = path.join(tmp, "vault antigo");
    fs.mkdirSync(path.join(outro, "memoria"), { recursive: true });
    const c = confereVault(outro);
    assert.equal(c.estado, "incompleto");
    assert.ok(c.faltando.includes("_indice.md"));
    assert.equal(criaVault(modelo, outro).criou, false);
    assert.deepEqual(fs.readdirSync(outro), ["memoria"]);

    // é um arquivo, não pasta
    const arq = path.join(tmp, "arquivo.md");
    fs.writeFileSync(arq, "x");
    assert.equal(confereVault(arq).estado, "arquivo");
    // modelo inexistente
    assert.equal(criaVault(path.join(tmp, "nao-existe"), path.join(tmp, "novo")).criou, false);
    assert.equal(fs.existsSync(path.join(tmp, "novo")), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("vault-template: toda nota .md tem o frontmatter padrão e nada de segredo", () => {
  const raiz = path.join(ROOT, "vault-template");
  const notas = fs.readdirSync(raiz, { recursive: true }).filter((f) => String(f).endsWith(".md"));
  assert.ok(notas.length >= 20);
  for (const n of notas) {
    const t = fs.readFileSync(path.join(raiz, n), "utf8").replace(/\r\n/g, "\n");
    const fm = t.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(fm, `${n} sem frontmatter`);
    for (const k of ["tipo", "projeto", "data", "status", "origem", "tags", "confidencial"]) {
      assert.match(fm[1], new RegExp(`^${k}:`, "m"), `${n} sem ${k}`);
    }
    assert.doesNotMatch(t, /@[\w.-]+\.\w{2,}|token\s*[:=]\s*\S{8,}|senha\s*[:=]/i, `${n} parece ter dado sensível`);
  }
  const reuniao = fs.readFileSync(path.join(raiz, "Templates", "Reunião.md"), "utf8");
  assert.match(reuniao, /^confidencial: true$/m);
  JSON.parse(fs.readFileSync(path.join(raiz, "50-Time", "AGENTES.canvas"), "utf8"));
  const app = JSON.parse(fs.readFileSync(path.join(raiz, ".obsidian", "app.json"), "utf8"));
  assert.deepEqual(
    [app.newLinkFormat, app.useMarkdownLinks, app.alwaysUpdateLinks],
    ["shortest", false, true],
  );
});

test("setup --check e --dry-run não criam o vault nem gravam AGPOCKET_VAULT", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agp-home-"));
  const vault = path.join(home, "Área de Trabalho", "Cérebro Teste");
  try {
    const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "vazio") };
    for (const modo of ["--check", "--dry-run"]) {
      const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "setup.mjs"), modo, `--vault=${vault}`], { env, encoding: "utf8" });
      if (modo === "--check") assert.match(r.stdout, /Vault: .*Cérebro Teste/);
      assert.equal(fs.existsSync(vault), false, modo);
      assert.equal(fs.existsSync(path.join(home, ".claude", "settings.json")), false, modo);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("setup.mjs nunca desliga a verificação SSL (só cita nas dicas)", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "setup.mjs"), "utf8");
  assert.doesNotMatch(src, /process\.env\.NODE_TLS_REJECT_UNAUTHORIZED\s*=|env:\s*\{[^}]*NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized\s*:\s*false/);
  assert.doesNotMatch(src, /["'`]--insecure["'`]|["'`]strict-ssl["'`]/);
});

test("leJson: aceita BOM, recusa null/array/primitivo/inválido", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agp-json-"));
  try {
    const grava = (nome, txt) => {
      const f = path.join(dir, nome);
      fs.writeFileSync(f, txt);
      return f;
    };
    assert.deepEqual(leJson(grava("bom.json", '﻿{"a":1}')), { existe: true, dados: { a: 1 } });
    assert.equal(leJson(path.join(dir, "nao.json")).existe, false);
    assert.deepEqual(leJson(grava("vazio.json", "  ")), { existe: true, dados: {} });
    for (const txt of ["null", "[]", "42", '"x"', "{oops"]) {
      const r = leJson(grava("x.json", txt));
      assert.equal(r.erro, true, txt);
      assert.deepEqual(r.dados, {});
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("idsPluginsInstalados: exige entrada em installed_plugins; enabledPlugins só sem o arquivo", () => {
  const settings = { enabledPlugins: { "a@m": true, "b@m": false } };
  assert.deepEqual([...idsPluginsInstalados(null, settings)], ["a@m"]);
  const inst = {
    plugins: {
      "vazio@m": [],
      "user@m": [{ scope: "user" }],
      "proj@m": [{ scope: "project" }],
      "semescopo@m": [{ version: "1" }],
      "ruim@m": "x",
    },
  };
  assert.deepEqual([...idsPluginsInstalados(inst, settings)].sort(), ["semescopo@m", "user@m"]);
  assert.equal(idsPluginsInstalados({}, settings).size, 0);
});

test("skillStatus: só ~/.claude/skills conta; ~/.agents/skills é 'fora'", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agp-skill-"));
  try {
    fs.mkdirSync(path.join(home, ".claude", "skills", "a"), { recursive: true });
    fs.mkdirSync(path.join(home, ".agents", "skills", "b"), { recursive: true });
    assert.equal(skillStatus(home, "a"), "sim");
    assert.equal(skillStatus(home, "b"), "fora");
    assert.equal(skillStatus(home, "c"), "nao");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("validaCatalogo recusa metacaracteres de shell (comando aceita espaço)", () => {
  const base = { id: "a", tipo: "skill", paraQue: "p & q", repo: "r", skill: "s" };
  const erros = (item) => validaCatalogo({ versao: 1, essenciais: [item], extras: [] });
  assert.deepEqual(erros(base), []);
  for (const c of ['"', "&", "|", "<", ">", "^", "%", " "]) {
    assert.ok(erros({ ...base, skill: `s${c}x` }).some((e) => /proibido/.test(e)), JSON.stringify(c));
  }
  assert.ok(erros({ ...base, repo: "https://x/y & calc" }).length > 0);
  const mcp = { id: "m", tipo: "mcp", paraQue: "p", nome: "n", comando: "npx @p/m@latest", navegador: { padrao: "chrome" } };
  assert.deepEqual(erros(mcp), []);
  for (const c of ["&", "|", "%", '"', "^"]) assert.ok(erros({ ...mcp, comando: `npx x${c}y` }).length > 0, c);
});

test("veredictoCheckSkill: extra sem --completo não avisa; falta/erro de essencial contam", () => {
  const check = { check: true, completo: false };
  assert.equal(veredictoCheckSkill("fora", true, check), "pula");
  assert.equal(veredictoCheckSkill("nao", true, check), "pula");
  assert.equal(veredictoCheckSkill("fora", false, check), "aviso");
  assert.equal(veredictoCheckSkill("nao", false, check), "falta");
  assert.equal(veredictoCheckSkill("fora", true, { check: true, completo: true }), "aviso");
  assert.equal(veredictoCheckSkill("nao", true, { check: true, completo: true }), "falta");
  assert.equal(veredictoCheckSkill("sim", false, check), null);
  assert.equal(veredictoCheckSkill("nao", false, { check: false }), null);
});
