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
  MARCA_MEMORIA_INICIO,
  MARCA_MEMORIA_FIM,
  aplicaBloco,
  aplicaClaudeMd,
  descreveClaudeMd,
  montaBlocoMemoria,
  normalizaLf,
  passoClaudeMd,
  removeCopiasAntigas,
  aplicaEnv,
  aplicaVaultEnv,
  confereVault,
  criaVault,
  estaDentro,
  expandeCaminho,
  obsidianAcima,
  resolveVault,
  criaContexto,
  logs,
  passoVault,
  passoComandos,
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
  // "~" vira a pasta do usuário; relativo sem ~ é recusado (flag e env)
  const home = path.resolve(os.tmpdir(), "Usuário Teste");
  assert.equal(resolveVault({}, "~/Meu Cérebro", root, { home }).caminho, path.join(home, "Meu Cérebro"));
  assert.equal(resolveVault({ env: { AGPOCKET_VAULT: "~\\Cérebro" } }, null, root, { home }).caminho, path.join(home, "Cérebro"));
  assert.match(resolveVault({}, "cerebro", root, { home }).erro, /--vault: caminho relativo/);
  assert.match(resolveVault({ env: { AGPOCKET_VAULT: "./x" } }, null, root, { home }).erro, /AGPOCKET_VAULT: caminho relativo/);
});

test("expandeCaminho", () => {
  const home = path.resolve(os.tmpdir(), "casa");
  assert.equal(expandeCaminho("~", home).caminho, home);
  assert.equal(expandeCaminho("~/a b/é", home).caminho, path.join(home, "a b", "é"));
  assert.ok(expandeCaminho("a/b", home).erro);
  assert.ok(expandeCaminho("~fulano/x", home).erro);
  assert.equal(expandeCaminho(home, "/outro").caminho, home);
});

test("obsidianAcima: acha o vault antigo acima do caminho, mas não o próprio", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agp-obs-"));
  try {
    const antigo = path.join(tmp, "AG Projeto");
    const novo = path.join(antigo, "AG-Cerebro");
    fs.mkdirSync(path.join(novo, ".obsidian"), { recursive: true });
    assert.equal(obsidianAcima(novo), null);
    fs.mkdirSync(path.join(antigo, ".obsidian"));
    assert.equal(obsidianAcima(novo), antigo);
    assert.equal(obsidianAcima(path.join(novo, "nao-existe", "x")), novo);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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

    // corrida: o destino aparece durante a cópia → não sobrescreve e apaga só o .tmp
    const corrida = path.join(tmp, "Cérebro Corrida");
    const r = criaVault(modelo, corrida, {
      aposCopiar: () => {
        fs.mkdirSync(corrida);
        fs.writeFileSync(path.join(corrida, "de outro.md"), "não mexa");
      },
    });
    assert.equal(r.criou, false);
    assert.match(r.motivo, /apareceu/);
    assert.deepEqual(fs.readdirSync(corrida), ["de outro.md"]);
    assert.equal(fs.readFileSync(path.join(corrida, "de outro.md"), "utf8"), "não mexa");
    assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.includes(".tmp-")), []);
    // e o caminho feliz também não deixa .tmp para trás
    assert.equal(fs.readdirSync(path.dirname(destino)).filter((f) => f.includes(".tmp-")).length, 0);
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

test("vault-template: modelos não linkam para outros modelos; nota do canvas dentro do grupo do fluxo", () => {
  const raiz = path.join(ROOT, "vault-template");
  for (const n of fs.readdirSync(path.join(raiz, "Templates"))) {
    const t = fs.readFileSync(path.join(raiz, "Templates", n), "utf8");
    assert.doesNotMatch(t, /\[\[(Reunião|Missão|Projeto|Sessão)\]\]/, n);
  }
  const canvas = JSON.parse(fs.readFileSync(path.join(raiz, "50-Time", "AGENTES.canvas"), "utf8"));
  const no = (id) => canvas.nodes.find((x) => x.id === id);
  const [g, nota] = [no("grp-fluxo"), no("nota")];
  assert.ok(nota.x >= g.x && nota.y >= g.y && nota.x + nota.width <= g.x + g.width && nota.y + nota.height <= g.y + g.height);
});

/** Roda o passoVault com um ctx falso (home temporário) e devolve o que ele imprimiu. */
function rodaPassoVault(flags, home) {
  const ctx = criaContexto({ ...parseFlags([]), ...flags }, home, process.platform);
  const linhas = [];
  const log = console.log;
  console.log = (s) => linhas.push(String(s));
  try {
    return { ok: passoVault(ctx, logs(ctx)), stdout: linhas.join("\n"), ctx };
  } finally {
    console.log = log;
  }
}

test("passoVault em --dry-run e --check: diz o que faria e não cria vault nem settings", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agp-home-"));
  const vault = path.join(home, "Área de Trabalho", "Cérebro Teste");
  try {
    const d = rodaPassoVault({ dryRun: true, vault }, home);
    assert.equal(d.ok, true);
    assert.match(d.stdout, /criar o vault em .*Cérebro Teste/);
    assert.match(d.stdout, /gravar env\.AGPOCKET_VAULT=/);
    const c = rodaPassoVault({ check: true, vault }, home);
    assert.match(c.stdout, /o vault ainda não existe em .*Cérebro Teste/);
    assert.ok(c.ctx.erros > 0);
    assert.equal(fs.existsSync(vault), false);
    assert.equal(fs.existsSync(path.join(home, ".claude", "settings.json")), false);
    assert.deepEqual(fs.readdirSync(home), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("passoVault: instala de verdade num home temporário, depois fica idempotente; incompleto não grava env", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agp-home-"));
  const vault = path.join(home, "Área de Trabalho", "Cérebro");
  const settingsFile = path.join(home, ".claude", "settings.json");
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify({ model: "x", env: { A: "1" } }));
    const r1 = rodaPassoVault({ vault }, home);
    assert.equal(r1.ok, true);
    assert.deepEqual(confereVault(vault), { estado: "ok", faltando: [] });
    const s1 = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    assert.deepEqual(s1, { model: "x", env: { A: "1", AGPOCKET_VAULT: vault } });
    const indice = path.join(vault, "_indice.md");
    fs.writeFileSync(indice, "editado");
    const r2 = rodaPassoVault({}, home);
    assert.match(r2.stdout, /já existia/);
    assert.equal(fs.readFileSync(indice, "utf8"), "editado");
    assert.equal(fs.readdirSync(path.dirname(settingsFile)).filter((f) => f.includes(".backup-")).length, 1);

    // vault incompleto num settings sem AGPOCKET_VAULT: avisa e não grava
    const outroHome = path.join(home, "outro");
    const incompleto = path.join(home, "vault velho");
    fs.mkdirSync(incompleto);
    const r3 = rodaPassoVault({ vault: incompleto }, outroHome);
    assert.match(r3.stdout, /não gravei env\.AGPOCKET_VAULT/);
    assert.equal(fs.existsSync(path.join(outroHome, ".claude", "settings.json")), false);
    assert.deepEqual(fs.readdirSync(incompleto), []);
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

// ───────── vault: casos de borda de ponta a ponta (home temporário, nunca o ~/.claude real) ─────────

function comHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agp-home-"));
  try {
    return fn(home, path.join(home, ".claude", "settings.json"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function fotoDaPasta(dir) {
  const foto = {};
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    const p = path.join(dir, String(f));
    foto[String(f)] = fs.statSync(p).isDirectory() ? "dir" : fs.readFileSync(p).toString("hex");
  }
  return foto;
}

test("vault-template: todo [[link]] resolve para nota do modelo ou é placeholder (só em Templates/); canvas coerente", () => {
  const raiz = path.join(ROOT, "vault-template");
  const arquivos = fs.readdirSync(raiz, { recursive: true }).map(String).filter((f) => /\.(md|canvas)$/.test(f));
  // como no Obsidian: [[nome]] sem extensão só acha .md; .canvas precisa da extensão ([[AGENTES.canvas|AGENTES]])
  const nomes = new Set(arquivos.flatMap((f) => {
    const base = path.basename(f);
    return base.endsWith(".md") ? [base, base.slice(0, -3)] : [base];
  }));
  const placeholder = /^(nome-|AAAA-)/;
  for (const f of arquivos) {
    const t = fs.readFileSync(path.join(raiz, f), "utf8");
    for (const m of t.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
      const alvo = m[1].trim();
      if (nomes.has(alvo)) continue;
      assert.ok(placeholder.test(alvo) && f.startsWith("Templates"), `${f}: [[${alvo}]] não resolve`);
    }
  }
  const canvas = JSON.parse(fs.readFileSync(path.join(raiz, "50-Time", "AGENTES.canvas"), "utf8"));
  const ids = new Set(canvas.nodes.map((n) => n.id));
  assert.equal(ids.size, canvas.nodes.length, "ids de nó repetidos");
  for (const e of canvas.edges) assert.ok(ids.has(e.fromNode) && ids.has(e.toNode), `aresta ${e.id} aponta para nó inexistente`);
});

test("passoVault: vault existente com arquivo do usuário fica intacto byte a byte (completo e incompleto)", () => {
  for (const completo of [true, false]) {
    comHome((home, settings) => {
      const v = path.join(home, "Vault do usuário");
      if (completo) fs.cpSync(path.join(ROOT, "vault-template"), v, { recursive: true });
      fs.mkdirSync(path.join(v, "minhas notas"), { recursive: true });
      fs.writeFileSync(path.join(v, "minhas notas", "a ção.md"), Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0xff, 0x00]));
      fs.writeFileSync(path.join(v, "_indice.md"), "meu\r\nindice");
      const antes = fotoDaPasta(v);
      rodaPassoVault({ vault: v }, home);
      assert.deepEqual(fotoDaPasta(v), antes);
      assert.equal(fs.existsSync(settings), completo, "env só é gravado com vault completo");
    });
  }
});

test("passoVault: segunda rodada não muda nada (settings, vault, sem .tmp nem novo backup)", () => {
  comHome((home, settings) => {
    const v = path.join(home, "Área de Trabalho", "Meu Cérebro");
    assert.equal(rodaPassoVault({ vault: v }, home).ok, true);
    const [s1, f1, ls1] = [fs.readFileSync(settings), fotoDaPasta(v), fs.readdirSync(path.dirname(settings))];
    assert.equal(rodaPassoVault({ vault: v }, home).ok, true);
    assert.deepEqual(fs.readFileSync(settings), s1);
    assert.deepEqual(fotoDaPasta(v), f1);
    assert.deepEqual(fs.readdirSync(path.dirname(settings)), ls1);
    assert.deepEqual(fs.readdirSync(path.dirname(v)).filter((f) => f.includes(".tmp")), []);
  });
});

test("passoVault: AGPOCKET_VAULT do settings manda sobre --vault e não é trocado", () => {
  comHome((home, settings) => {
    const [v1, v2] = [path.join(home, "v1"), path.join(home, "v2")];
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, JSON.stringify({ env: { AGPOCKET_VAULT: v1 } }));
    const antes = fs.readFileSync(settings);
    const r = rodaPassoVault({ vault: v2 }, home);
    assert.match(r.stdout, /--vault ignorado/);
    assert.equal(fs.existsSync(v2), false);
    assert.deepEqual(fs.readFileSync(settings), antes);
  });
});

test("passoVault: recusa vault dentro do repositório (flag e settings), sem criar nada", () => {
  comHome((home, settings) => {
    for (const v of [path.join(ROOT, "meu-vault"), path.join(ROOT, "vault-template"), ROOT, path.join(ROOT, "x", "..", "y")]) {
      const r = rodaPassoVault({ vault: v }, home);
      assert.equal(r.ok, false, v);
      assert.match(r.stdout, /dentro do repositório/);
      assert.equal(fs.existsSync(settings), false);
    }
    assert.equal(fs.existsSync(path.join(ROOT, "meu-vault")), false);
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, JSON.stringify({ env: { AGPOCKET_VAULT: path.join(ROOT, "z") } }));
    assert.equal(rodaPassoVault({}, home).ok, false);
    assert.equal(fs.existsSync(path.join(ROOT, "z")), false);
  });
});

test("passoVault: settings com BOM é lido e preservado; JSON inválido ou não-objeto para sem escrever", () => {
  comHome((home, settings) => {
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, `\uFEFF${JSON.stringify({ model: "m", env: { B: "2" } })}`);
    const v = path.join(home, "v bom");
    assert.equal(rodaPassoVault({ vault: v }, home).ok, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(settings, "utf8")), { model: "m", env: { B: "2", AGPOCKET_VAULT: v } });
  });
  for (const ruim of ["{ quebrado", "[]", "null", "123", JSON.stringify({ env: [] })]) {
    comHome((home, settings) => {
      fs.mkdirSync(path.dirname(settings), { recursive: true });
      fs.writeFileSync(settings, ruim);
      const v = path.join(home, "v");
      assert.equal(rodaPassoVault({ vault: v }, home).ok, false, ruim);
      assert.equal(fs.existsSync(v), false);
      assert.equal(fs.readFileSync(settings, "utf8"), ruim);
      assert.deepEqual(fs.readdirSync(path.dirname(settings)), ["settings.json"]);
    });
  }
});

test("passoVault: ~ expande para o home; caminho relativo é recusado (flag e settings)", () => {
  comHome((home, settings) => {
    assert.equal(rodaPassoVault({ vault: "~/Meu Vault" }, home).ok, true);
    assert.ok(fs.existsSync(path.join(home, "Meu Vault", "_indice.md")));
    assert.equal(JSON.parse(fs.readFileSync(settings, "utf8")).env.AGPOCKET_VAULT, path.join(home, "Meu Vault"));
  });
  for (const rel of ["vault-rel", "./vault-rel", "..\vault-rel", "~vault-rel"]) {
    comHome((home, settings) => {
      assert.equal(rodaPassoVault({ vault: rel }, home).ok, false, rel);
      assert.equal(fs.existsSync(settings), false);
      assert.equal(fs.existsSync(path.resolve(rel)), false);
    });
  }
  comHome((home, settings) => {
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, JSON.stringify({ env: { AGPOCKET_VAULT: "relativo/v" } }));
    const r = rodaPassoVault({}, home);
    assert.equal(r.ok, false);
    assert.match(r.stdout, /AGPOCKET_VAULT/);
  });
});

test("passoVault: falha ao criar não deixa .tmp nem grava env (pai é arquivo; destino é arquivo)", () => {
  comHome((home, settings) => {
    const pai = path.join(home, "arquivo");
    fs.writeFileSync(pai, "x");
    assert.equal(rodaPassoVault({ vault: path.join(pai, "vault") }, home).ok, false);
    const dest = path.join(home, "dest");
    fs.writeFileSync(dest, "arquivo");
    assert.equal(rodaPassoVault({ vault: dest }, home).ok, false);
    assert.equal(fs.readFileSync(dest, "utf8"), "arquivo");
    assert.equal(fs.existsSync(settings), false);
    assert.deepEqual(fs.readdirSync(home).filter((f) => f.includes(".tmp")), []);
  });
});

// ───────────────────────── bloco de memória no CLAUDE.md ─────────────────────────

const BLOCO_TIME = montaBlocoTime(fs.readFileSync(path.join(ROOT, "team", "CLAUDE-time.md"), "utf8"));
const BLOCO_MEMORIA = montaBlocoMemoria(fs.readFileSync(path.join(ROOT, "team", "CLAUDE-memoria.md"), "utf8"));

/** A seção de memória que vinha de team/CLAUDE-memoria.md até a v3 (colada à mão, com o caminho de cada um). */
const MEMORIA_ANTIGA = [
  "## Memória (vault do Obsidian)",
  "",
  "A memória do time fica no vault `D:\\Qualquer Pasta\\Cérebro`, pasta `memoria/`. Índice: [[Memória]].",
  "",
  "**No começo** de trabalho com mais de 2 etapas, leia: `memoria/Decisões.md`, `memoria/Lições aprendidas.md`, `memoria/Pendências.md` e as 2 notas mais recentes de `memoria/sessoes/`. Não reabra uma decisão `aceita` sem motivo novo.",
  "",
  "**No fim**, peça ao [[documentador]] para:",
  "1. Criar `memoria/sessoes/AAAA-MM-DD título.md` seguindo `templates/Sessão.md` e linkar a nota em `memoria/Sessões.md`.",
  "2. Se houve escolha importante, criar a nota em `memoria/decisoes/` (`templates/Decisão.md`) e linkar em `memoria/Decisões.md`.",
  "3. Se o [[testador]] ou o [[revisor]] devolveram algo que pode se repetir, registrar em `memoria/Lições aprendidas.md`.",
  "4. Atualizar `memoria/Pendências.md` (marcar o que foi resolvido, incluir o que surgiu).",
  "",
  "**Regras das notas:** use wikilinks (`[[nome]]`) com nome curto para agentes, decisões e arquivos citados; não guarde segredo, token nem dado pessoal; fatos que o código ou o git já mostram não precisam de nota.",
  "",
].join("\n");

/** Uma cópia antiga do bloco do time (sem um bullet que entrou depois), colada sem marcadores. */
const TIME_ANTIGO = `${BLOCO_TIME.split("\n").filter((l) => !l.startsWith("- Em tarefa com interface")).join("\n")}\n\n`;
const MARCADO_TIME = `${MARCA_INICIO}\n${BLOCO_TIME}\n${MARCA_FIM}\n`;
const conta = (texto, trecho) => texto.split(trecho).length - 1;

test("montaBlocoMemoria: curto, sem caminho fixo, aponta para a estrutura nova e para AGPOCKET_VAULT", () => {
  const b = BLOCO_MEMORIA;
  assert.ok(b.startsWith("# Memória do time\n\nO vault do time é a pasta"));
  assert.ok(b.length < 1200, `bloco grande demais (${b.length} caracteres)`);
  assert.doesNotMatch(b, /[A-Za-z]:\\|\/Users\/|\/home\/|pablo/i, "não pode ter caminho fixo");
  assert.doesNotMatch(b, /`memoria\/|`templates\//, "nada da estrutura antiga");
  for (const t of ["AGPOCKET_VAULT", "_indice.md", "30-Projetos/", "90-Memoria-do-time/", "Decisões.md", "Pendências.md", "Lições aprendidas.md", "Templates/Sessão.md", "confidencial: true", "[[documentador]]", "20-Missoes/"]) {
    assert.ok(b.includes(t), `falta "${t}"`);
  }
  assert.doesNotMatch(b, /2 sessões mais recentes/, "a leitura inicial não inclui mais as últimas sessões");
  assert.ok(!b.includes("> "), "o cabeçalho de explicação não entra no bloco");
  assert.throws(() => montaBlocoMemoria("# outro arquivo"), /O vault do time é a pasta/);
});

test("aplicaBloco com os marcadores da memória convive com o bloco do time", () => {
  const opcoes = { inicio: MARCA_MEMORIA_INICIO, fim: MARCA_MEMORIA_FIM, tituloAntigo: "## Memória (vault do Obsidian)" };
  const r = aplicaBloco(MARCADO_TIME, "# Memória do time\n\nv1", opcoes);
  assert.equal(r.acao, "anexar");
  assert.equal(r.aviso, undefined);
  assert.ok(r.texto.startsWith(MARCADO_TIME));
  assert.equal(aplicaBloco(r.texto, "# Memória do time\n\nv1", opcoes).acao, "igual");
  assert.equal(aplicaBloco(r.texto, BLOCO_TIME).acao, "igual", "o bloco do time não enxerga os marcadores da memória");
  const v2 = aplicaBloco(r.texto, "# Memória do time\n\nv2", opcoes);
  assert.equal(v2.acao, "atualizar");
  assert.ok(v2.texto.startsWith(MARCADO_TIME) && v2.texto.includes("v2") && !v2.texto.includes("v1"));
  assert.equal(aplicaBloco(`${MARCA_MEMORIA_FIM}\n${MARCA_MEMORIA_INICIO}`, "x", opcoes).acao, "erro");
});

test("aplicaClaudeMd: caso real (cópia antiga do time + memória antiga + bloco marcado) vira um time só + memória", () => {
  const atual = `${TIME_ANTIGO}${MEMORIA_ANTIGA}\n${MARCADO_TIME}`.replace(/\n/g, "\r\n");
  const r = aplicaClaudeMd(atual, BLOCO_TIME, BLOCO_MEMORIA);
  assert.equal(r.acao, "atualizar");
  assert.deepEqual(r.partes, { removidas: ["# Time de AGzinhos", "## Memória (vault do Obsidian)"], time: "igual", memoria: "anexar" });
  assert.deepEqual(r.avisos, ["a memória antiga apontava para D:\\Qualquer Pasta\\Cérebro\\memoria; migre o que faltar para o vault novo (AGPOCKET_VAULT)"]);
  assert.equal(conta(r.texto, "# Time de AGzinhos"), 1);
  assert.equal(conta(r.texto, "# Memória do time"), 1);
  assert.doesNotMatch(r.texto, /`memoria\/|Qualquer Pasta/);
  assert.ok(r.texto.indexOf(MARCA_FIM) < r.texto.indexOf(MARCA_MEMORIA_INICIO), "memória depois do time");
  assert.ok(!/[^\r]\n/.test(r.texto), "mantém CRLF");
  assert.deepEqual(descreveClaudeMd(r.partes), [
    'tirar a cópia antiga sem marcadores "# Time de AGzinhos"',
    'tirar a cópia antiga sem marcadores "## Memória (vault do Obsidian)"',
    "anexar o bloco de memória",
  ]);
  const deNovo = aplicaClaudeMd(r.texto, BLOCO_TIME, BLOCO_MEMORIA);
  assert.equal(deNovo.acao, "igual", "idempotente");
  assert.equal(deNovo.texto, r.texto);
});

test("aplicaClaudeMd: nada escrito à mão se perde", () => {
  const meu = "# Minhas regras\n\nResponda em português.\n\n";
  const depois = "\n## Atalhos meus\n\n- gs = git status\n";
  const r = aplicaClaudeMd(`${meu}${TIME_ANTIGO}${MEMORIA_ANTIGA}${depois}`, BLOCO_TIME, BLOCO_MEMORIA);
  assert.ok(r.texto.startsWith(meu), "texto antes fica");
  assert.ok(r.texto.includes("## Atalhos meus\n\n- gs = git status\n"), "texto depois fica");
  assert.equal(conta(r.texto, "# Time de AGzinhos"), 1);

  // uma linha que o setup não conhece dentro da cópia antiga: a seção fica inteira e vira aviso
  const editada = MEMORIA_ANTIGA.replace("**No fim**", "Minha nota pessoal sobre o vault.\n\n**No fim**");
  const k = aplicaClaudeMd(`${TIME_ANTIGO}${editada}`, BLOCO_TIME, BLOCO_MEMORIA);
  assert.deepEqual(k.partes.removidas, ["# Time de AGzinhos"]);
  assert.ok(k.texto.includes(editada.trimEnd()), "a seção editada fica byte a byte");
  assert.equal(k.avisos.length, 1);
  assert.match(k.avisos[0], /Memória \(vault do Obsidian\).*não reconheço/);

  // bullet escrito à mão dentro da cópia antiga do time
  const timeMeu = TIME_ANTIGO.replace("- Ao terminar", "- Sempre rode o lint antes.\n- Ao terminar");
  const t = aplicaClaudeMd(timeMeu, BLOCO_TIME, BLOCO_MEMORIA);
  assert.ok(t.texto.includes("- Sempre rode o lint antes."));
  assert.equal(t.partes.removidas.length, 0);
  assert.equal(t.avisos.length, 1, "um aviso só por seção (remoção e aplicaBloco juntos, sem duplicata)");
  assert.match(t.avisos[0], /Time de AGzinhos.*não reconheço/);

  // subtítulo escrito à mão dentro da cópia antiga do time: faz parte da seção, então ela fica inteira
  const comSub = `${TIME_ANTIGO}## Minhas notas\n\n- nunca use any\n\n${MEMORIA_ANTIGA}`;
  const s = aplicaClaudeMd(comSub, BLOCO_TIME, BLOCO_MEMORIA);
  assert.ok(s.texto.includes(`${TIME_ANTIGO}## Minhas notas\n\n- nunca use any\n`), "título e subtítulo ficam juntos");
  assert.deepEqual(s.partes.removidas, ["## Memória (vault do Obsidian)"], "a memória antiga continua sendo uma seção separada");
  assert.match(s.avisos.join(" "), /Time de AGzinhos.*não reconheço/);
});

test("aplicaClaudeMd: memória antiga só sai com AGPOCKET_VAULT configurado", () => {
  const atual = `${TIME_ANTIGO}${MEMORIA_ANTIGA}\n${MARCADO_TIME}`;
  const sem = aplicaClaudeMd(atual, BLOCO_TIME, BLOCO_MEMORIA, { vaultConfigurado: false });
  assert.deepEqual(sem.partes.removidas, ["# Time de AGzinhos"]);
  assert.ok(sem.texto.includes(MEMORIA_ANTIGA.trimEnd()), "a seção antiga fica byte a byte");
  assert.ok(sem.texto.includes(MARCA_MEMORIA_INICIO), "o bloco novo entra mesmo assim");
  assert.equal(sem.avisos.length, 1);
  assert.match(sem.avisos[0], /mantive a seção "## Memória \(vault do Obsidian\)".*AGPOCKET_VAULT ainda não está/);

  const com = aplicaClaudeMd(atual, BLOCO_TIME, BLOCO_MEMORIA, { vaultConfigurado: true });
  assert.deepEqual(com.partes.removidas, ["# Time de AGzinhos", "## Memória (vault do Obsidian)"]);
  assert.match(com.avisos.join(" "), /apontava para D:\\Qualquer Pasta\\Cérebro\\memoria/);
});

test("aplicaClaudeMd: bloco de memória entra logo depois do bloco do time; sem ele, no fim", () => {
  const depois = "# Minhas regras\n\nfim do arquivo\n";
  const r = aplicaClaudeMd(`${MARCADO_TIME}\n${depois}`, BLOCO_TIME, BLOCO_MEMORIA);
  const [iFimTime, iMem, iFimMem, iMeu] = [MARCA_FIM, MARCA_MEMORIA_INICIO, MARCA_MEMORIA_FIM, "# Minhas regras"].map((m) => r.texto.indexOf(m));
  assert.ok(iFimTime < iMem && iFimMem < iMeu, "time → memória → texto do usuário");
  assert.ok(r.texto.startsWith(`${MARCADO_TIME}\n${MARCA_MEMORIA_INICIO}`));
  assert.ok(r.texto.endsWith(`${MARCA_MEMORIA_FIM}\n\n${depois}`));
  assert.equal(aplicaClaudeMd(r.texto, BLOCO_TIME, BLOCO_MEMORIA).acao, "igual");

  const opcoes = { inicio: MARCA_MEMORIA_INICIO, fim: MARCA_MEMORIA_FIM, depoisDe: MARCA_FIM };
  const semTime = aplicaBloco("# Só meu\n\ntexto\n", "# Memória do time\n\nx", opcoes);
  assert.ok(semTime.texto.startsWith("# Só meu\n\ntexto\n\n") && semTime.texto.endsWith(`${MARCA_MEMORIA_FIM}\n`));
  const crlf = aplicaBloco(`${MARCADO_TIME}\n${depois}`.replace(/\n/g, "\r\n"), "# Memória do time\n\nx", opcoes);
  assert.ok(!/[^\r]\n/.test(crlf.texto), "mantém CRLF");
});

test("aplicaClaudeMd: cópias coladas das fontes novas (team/) são detectadas e só avisam", () => {
  const fonteTime = fs.readFileSync(path.join(ROOT, "team", "CLAUDE-time.md"), "utf8");
  const fonteMemoria = fs.readFileSync(path.join(ROOT, "team", "CLAUDE-memoria.md"), "utf8");
  for (const [fonte, titulo] of [
    [fonteTime, "# Time de agentes"],
    [fonteMemoria, "# Memória do time (vault do Obsidian)"],
  ]) {
    const r = aplicaClaudeMd(`${normalizaLf(fonte)}\n${MARCADO_TIME}`, BLOCO_TIME, BLOCO_MEMORIA);
    assert.ok(r.texto.startsWith(normalizaLf(fonte)), `${titulo}: a cópia fica`);
    assert.deepEqual(r.partes.removidas, []);
    assert.equal(r.avisos.length, 1, titulo);
    assert.ok(r.avisos[0].includes(`"${titulo}"`) && /cópia colada/.test(r.avisos[0]), r.avisos[0]);
  }
  // o bloco instalado colado fora dos marcadores, sem nada a mais: sai (é igual ao que o setup põe)
  const exata = aplicaClaudeMd(`${BLOCO_MEMORIA}\n\n${MARCADO_TIME}`, BLOCO_TIME, BLOCO_MEMORIA);
  assert.deepEqual(exata.partes.removidas, ["# Memória do time"]);
  assert.equal(conta(exata.texto, "# Memória do time"), 1);
  // com uma linha a mais: fica e avisa
  const editada = aplicaClaudeMd(`${BLOCO_MEMORIA}\nminha linha\n\n${MARCADO_TIME}`, BLOCO_TIME, BLOCO_MEMORIA);
  assert.equal(conta(editada.texto, "# Memória do time"), 2);
  assert.match(editada.avisos.join(" "), /"# Memória do time".*não reconheço/);
});

test("aplicaClaudeMd: criar do zero, marcadores quebrados e trechos marcados nunca são tocados", () => {
  const novo = aplicaClaudeMd(null, BLOCO_TIME, BLOCO_MEMORIA);
  assert.equal(novo.acao, "criar");
  assert.ok(novo.texto.startsWith(MARCA_INICIO) && novo.texto.trimEnd().endsWith(MARCA_MEMORIA_FIM));
  assert.equal(aplicaClaudeMd(novo.texto, BLOCO_TIME, BLOCO_MEMORIA).acao, "igual");

  const quebrado = `${TIME_ANTIGO}${MARCA_INICIO}\nmeio`;
  const e = aplicaClaudeMd(quebrado, BLOCO_TIME, BLOCO_MEMORIA);
  assert.equal(e.acao, "erro");
  assert.equal(e.texto, quebrado);

  // um título igual ao legado DENTRO dos marcadores não é cópia antiga
  const dentro = `${MARCA_INICIO}\n# Time de AGzinhos\n\nvelho\n${MARCA_FIM}\n`;
  const x = removeCopiasAntigas(dentro, [{ titulo: "# Time de AGzinhos", linhas: ["# Time de AGzinhos", "velho"] }]);
  assert.equal(x.texto, dentro);
  assert.deepEqual(x.removidas, []);
});

/** Roda o passoClaudeMd com um home temporário e devolve o que ele imprimiu. */
function rodaPassoClaudeMd(flags, home) {
  const ctx = criaContexto({ ...parseFlags([]), ...flags }, home, process.platform);
  const linhas = [];
  const log = console.log;
  console.log = (s) => linhas.push(String(s));
  try {
    return { ok: passoClaudeMd(ctx, logs(ctx)), stdout: linhas.join("\n"), ctx };
  } finally {
    console.log = log;
  }
}

test("passoClaudeMd: --dry-run e --check não escrevem; instalação faz backup e depois fica idempotente", () => {
  comHome((home, settings) => {
    const arquivo = path.join(home, ".claude", "CLAUDE.md");
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(settings, JSON.stringify({ env: { AGPOCKET_VAULT: path.join(home, "Cérebro") } }));
    const original = `${TIME_ANTIGO}${MEMORIA_ANTIGA}\n${MARCADO_TIME}`.replace(/\n/g, "\r\n");
    fs.writeFileSync(arquivo, original);

    const d = rodaPassoClaudeMd({ dryRun: true }, home);
    assert.equal(d.ok, true);
    assert.match(d.stdout, /faria: .*tirar a cópia antiga.*anexar o bloco de memória \(com backup\)/);
    assert.match(d.stdout, /⚠ a memória antiga apontava para D:\\Qualquer Pasta\\Cérebro\\memoria/);
    const c = rodaPassoClaudeMd({ check: true }, home);
    assert.match(c.stdout, /CLAUDE\.md desatualizado/);
    assert.ok(c.ctx.erros > 0);
    assert.equal(fs.readFileSync(arquivo, "utf8"), original);
    assert.deepEqual(fs.readdirSync(path.dirname(arquivo)).sort(), ["CLAUDE.md", "settings.json"]);

    const i = rodaPassoClaudeMd({}, home);
    assert.equal(i.ok, true);
    assert.match(i.stdout, /instalado agora/);
    const backups = fs.readdirSync(path.dirname(arquivo)).filter((f) => f.includes(".backup-"));
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(path.dirname(arquivo), backups[0]), "utf8"), original);
    const instalado = fs.readFileSync(arquivo, "utf8");
    assert.ok(instalado.includes(MARCA_MEMORIA_INICIO) && conta(instalado, "# Time de AGzinhos") === 1);

    const j = rodaPassoClaudeMd({}, home);
    assert.match(j.stdout, /já existia, iguais/);
    assert.equal(fs.readFileSync(arquivo, "utf8"), instalado);
    assert.equal(fs.readdirSync(path.dirname(arquivo)).filter((f) => f.includes(".backup-")).length, 1);
    assert.equal(rodaPassoClaudeMd({ check: true }, home).ctx.erros, 0);
  });
});

test("passoClaudeMd: sem AGPOCKET_VAULT mantém a memória antiga; o --dry-run do vault conta como configurado", () => {
  comHome((home) => {
    const arquivo = path.join(home, ".claude", "CLAUDE.md");
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, `${MEMORIA_ANTIGA}\n${MARCADO_TIME}`);

    const sem = rodaPassoClaudeMd({}, home);
    assert.equal(sem.ok, true);
    assert.match(sem.stdout, /⚠ mantive a seção "## Memória \(vault do Obsidian\)"/);
    const instalado = fs.readFileSync(arquivo, "utf8");
    assert.ok(instalado.includes(MEMORIA_ANTIGA.trimEnd()) && instalado.includes(MARCA_MEMORIA_INICIO));

    // o passo do vault em --dry-run diria que grava AGPOCKET_VAULT: a simulação do CLAUDE.md já tira a seção
    const ctx = criaContexto({ ...parseFlags([]), dryRun: true }, home, process.platform);
    ctx.vaultEnvPendente = true;
    const linhas = [];
    const log = console.log;
    console.log = (s) => linhas.push(String(s));
    try {
      passoClaudeMd(ctx, logs(ctx));
    } finally {
      console.log = log;
    }
    assert.match(linhas.join("\n"), /faria: tirar a cópia antiga sem marcadores "## Memória \(vault do Obsidian\)"/);
    assert.equal(fs.readFileSync(arquivo, "utf8"), instalado);
  });
});

test("passoClaudeMd: --dry-run sem CLAUDE.md não promete backup", () => {
  comHome((home) => {
    const d = rodaPassoClaudeMd({ dryRun: true }, home);
    assert.match(d.stdout, /faria: criar o CLAUDE\.md e criar o bloco do time; anexar o bloco de memória$/m);
    assert.doesNotMatch(d.stdout, /com backup/);
    assert.equal(fs.existsSync(path.join(home, ".claude")), false);
  });
});

// ───────────────────────── comandos globais (commands/*.md) ─────────────────────────

/** Roda o passoComandos com um ctx falso (home temporário) e devolve o que ele imprimiu. */
function rodaPassoComandos(flags, home) {
  const ctx = criaContexto({ ...parseFlags([]), ...flags }, home, process.platform);
  const linhas = [];
  const log = console.log;
  console.log = (s) => linhas.push(String(s));
  try {
    passoComandos(ctx, logs(ctx));
    return { stdout: linhas.join("\n"), ctx };
  } finally {
    console.log = log;
  }
}

const COMANDOS = fs.readdirSync(path.join(ROOT, "commands")).filter((f) => f.endsWith(".md")).sort();

test("passoComandos: dry-run não cria nada; instala os comandos, fica idempotente e faz backup do diferente", () => {
  comHome((home) => {
    assert.ok(COMANDOS.includes("time.md") && COMANDOS.includes("memoria.md"));
    const dest = path.join(home, ".claude", "commands");

    const d = rodaPassoComandos({ dryRun: true }, home);
    assert.match(d.stdout, /8\. Comandos \(\/time, \/memoria\)/);
    assert.match(d.stdout, /faria: copiar commands\/memoria\.md/);
    assert.deepEqual(fs.readdirSync(home), []);
    const c = rodaPassoComandos({ check: true }, home);
    assert.equal(c.ctx.erros, COMANDOS.length);
    assert.deepEqual(fs.readdirSync(home), []);

    const i = rodaPassoComandos({}, home);
    assert.equal(i.ctx.erros, 0);
    assert.deepEqual(fs.readdirSync(dest).sort(), COMANDOS);
    for (const f of COMANDOS) {
      assert.equal(fs.readFileSync(path.join(dest, f), "utf8"), fs.readFileSync(path.join(ROOT, "commands", f), "utf8"));
    }

    const j = rodaPassoComandos({}, home);
    assert.equal((j.stdout.match(/já existia, igual/g) ?? []).length, COMANDOS.length);
    assert.deepEqual(fs.readdirSync(dest).sort(), COMANDOS, "segunda rodada sem backup");

    fs.writeFileSync(path.join(dest, "time.md"), "editado à mão");
    const k = rodaPassoComandos({}, home);
    assert.match(k.stdout, /\/time \(instalado agora\)/);
    const backups = fs.readdirSync(dest).filter((f) => f.startsWith("time.md.backup-"));
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(dest, backups[0]), "utf8"), "editado à mão");
    assert.equal(rodaPassoComandos({ check: true }, home).ctx.erros, 0);
  });
});

test("conteúdo: /memoria, pesquisador e documentador seguem as regras do vault", () => {
  const le = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
  const memoria = le("commands", "memoria.md");
  for (const t of ["$ARGUMENTS", "AGPOCKET_VAULT", "confidencial: true", "[[", "Não achei"]) {
    assert.ok(memoria.includes(t), `memoria.md sem "${t}"`);
  }
  assert.doesNotMatch(memoria, /[A-Z]:\\(Users|Área)|\/Users\/|\/home\/|pablo|AG-Cerebro/i, "memoria.md não pode ter caminho fixo");
  assert.doesNotMatch(memoria, /^allowed-tools:/m);

  const pesquisador = le("agents", "pesquisador.md");
  assert.match(pesquisador, /^tools: .*\bWrite\b/m);
  assert.ok(pesquisador.includes("40-Conhecimento/"));

  const documentador = le("agents", "documentador.md");
  assert.ok(documentador.includes("20-Missoes/") && documentador.includes("confidencial: true"));
});