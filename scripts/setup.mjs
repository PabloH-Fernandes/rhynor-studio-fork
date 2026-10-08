#!/usr/bin/env node
// Instala o AG Pocket num PC novo: time de agentes, hooks, configuração global do Claude Code,
// comando /time, Playwright MCP, plugins e skills, e deixa o escritório pronto para `npm start`.
//
//   npm run setup                  → instala só os itens essenciais
//   npm run setup -- --completo    → também os extras (skills de terceiros)
//   npm run setup -- --dry-run     → mostra o que faria, sem escrever nada
//   npm run setup:check            → só confere (não instala nem escreve nada)
//   --sem-plugins                  → pula marketplaces, plugins e skills (rede restrita)
//   --browser=chrome|msedge|firefox|webkit  → navegador do Playwright MCP
//
// Node puro, sem dependência. Idempotente: rodar de novo não duplica nem reinstala o que já está em dia.
// Nunca desliga a verificação de certificado (SSL): em rede com proxy, só sugere NODE_OPTIONS=--use-system-ca.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MARCA_INICIO = "<!-- ag-pocket:inicio -->";
export const MARCA_FIM = "<!-- ag-pocket:fim -->";
const MARKER_HOOK = "--escritorio-ia";
// Mesmos eventos do scripts/install-hooks.mjs (ele roda no nível do módulo e não dá para importar).
export const EVENTOS_HOOK = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "TeammateIdle",
  "Stop",
];
export const NAVEGADORES = ["chrome", "msedge", "firefox", "webkit"];
const TIPOS_ITEM = ["marketplace", "plugin", "mcp", "skill", "skill-manual"];
// Cada comando de instalação tem um tempo limite (stdin ignorado). Em PCs lentos/com antivírus, 120 s não basta: padrão 300 s, ajustável.
const TIMEOUT_ITEM_MS = (Number(process.env.AG_SETUP_TIMEOUT_S) || 300) * 1000;
const TIMEOUT_LONGO_MS = 600_000;

// ───────────────────────── funções puras (testáveis) ─────────────────────────

export function normalizaLf(texto) {
  return texto.replace(/\r\n/g, "\n");
}

/** Lê as flags da linha de comando. Flags desconhecidas ou inválidas vão em `erros`. */
export function parseFlags(argv) {
  const f = { dryRun: false, check: false, completo: false, semPlugins: false, ajuda: false, browser: null, erros: [] };
  for (const a of argv) {
    if (a === "--dry-run") f.dryRun = true;
    else if (a === "--check") f.check = true;
    else if (a === "--completo") f.completo = true;
    else if (a === "--sem-plugins") f.semPlugins = true;
    else if (a === "--help" || a === "-h") f.ajuda = true;
    else if (a.startsWith("--browser=")) {
      const b = a.slice("--browser=".length);
      if (NAVEGADORES.includes(b)) f.browser = b;
      else f.erros.push(`--browser inválido: "${b}" (use ${NAVEGADORES.join(", ")})`);
    } else f.erros.push(`flag desconhecida: ${a}`);
  }
  return f;
}

/** Navegador do Playwright MCP: a flag manda; senão o `navegador` do item do catálogo (msedge no Windows, chrome nos outros). */
export function escolheNavegador(plataforma, flagBrowser, navegadorItem) {
  if (flagBrowser) return flagBrowser;
  const mapa = navegadorItem ?? { win32: "msedge", padrao: "chrome" };
  return mapa[plataforma] ?? mapa.padrao ?? "chrome";
}

/** Erro de certificado típico de proxy corporativo (npm/node/git). */
export function detectaErroCert(texto) {
  return /UNABLE_TO_GET_ISSUER_CERT_LOCALLY|SELF_SIGNED_CERT_IN_CHAIN|unable to get local issuer certificate/i.test(
    String(texto ?? ""),
  );
}

export function dicaCert(plataforma) {
  const comando =
    plataforma === "win32" ? '$env:NODE_OPTIONS="--use-system-ca"' : "export NODE_OPTIONS=--use-system-ca";
  return [
    "Parece um proxy/certificado da empresa bloqueando o download. Faça a rede confiar nos certificados do sistema",
    `e rode de novo (só nesta janela do terminal):  ${comando}`,
    "Não desligue a verificação SSL (nada de NODE_TLS_REJECT_UNAUTHORIZED=0, strict-ssl false ou --insecure).",
  ];
}

/** Monta uma linha de comando segura para o shell (usado no Windows, onde claude/npx/npm são .cmd). */
export function montaComando(cmd, args, plataforma) {
  const aspas = (a) => {
    const s = String(a);
    if (plataforma === "win32") return /[\s"&|<>()^%!]/.test(s) || s === "" ? `"${s.replace(/"/g, '\\"')}"` : s;
    return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
  };
  return [cmd, ...args].map(aspas).join(" ");
}

/** Texto do bloco do time a partir de team/CLAUDE-time.md (sem o cabeçalho "Cole este bloco"). */
export function montaBlocoTime(fonte) {
  const t = normalizaLf(fonte);
  const i = t.indexOf("Você é o **líder**");
  if (i < 0) throw new Error('team/CLAUDE-time.md não tem o trecho "Você é o **líder**"');
  return `# Time de AGzinhos\n\n${t.slice(i).trim()}`;
}

/**
 * Aplica a seção do time num CLAUDE.md. `textoAtual` é null se o arquivo não existe.
 * Retorna { acao: "criar" | "igual" | "atualizar" | "anexar" | "erro", texto, aviso?, mensagem? }.
 */
export function aplicaBloco(textoAtual, bloco) {
  const secao = `${MARCA_INICIO}\n${normalizaLf(bloco).trim()}\n${MARCA_FIM}`;
  if (textoAtual === null || textoAtual === undefined) return { acao: "criar", texto: `${secao}\n` };

  const eol = textoAtual.includes("\r\n") ? "\r\n" : "\n";
  const atual = normalizaLf(textoAtual);
  const contar = (m) => atual.split(m).length - 1;
  const i = atual.indexOf(MARCA_INICIO);
  const f = atual.indexOf(MARCA_FIM);

  if (i < 0 && f < 0) {
    const temAntiga = atual.includes("Time de AGzinhos");
    const base = atual.trim() === "" ? "" : `${atual.trimEnd()}\n\n`;
    const r = { acao: "anexar", texto: `${base}${secao}\n`.replace(/\n/g, eol) };
    if (temAntiga) {
      r.aviso =
        'o CLAUDE.md já tem uma seção "Time de AGzinhos" sem marcadores: o bloco novo vai ao lado dela (nada é apagado) e pode haver duplicata. Apague a antiga à mão se quiser.';
    }
    return r;
  }
  if (i < 0 || f < 0 || f < i || contar(MARCA_INICIO) > 1 || contar(MARCA_FIM) > 1) {
    return {
      acao: "erro",
      texto: textoAtual,
      mensagem: `marcadores ${MARCA_INICIO} / ${MARCA_FIM} incompletos ou fora de ordem no CLAUDE.md; corrija à mão (nada foi alterado)`,
    };
  }
  const fim = f + MARCA_FIM.length;
  if (atual.slice(i, fim) === secao) return { acao: "igual", texto: textoAtual };
  return { acao: "atualizar", texto: (atual.slice(0, i) + secao + atual.slice(fim)).replace(/\n/g, eol) };
}

/** Garante env.CLAUDE_CODE_ENABLE_TODO_TOOLS="1" sem mexer no resto. */
export function aplicaEnv(settings) {
  const env = settings.env;
  if (env !== undefined && (env === null || typeof env !== "object" || Array.isArray(env))) {
    return { erro: 'o campo "env" do settings.json não é um objeto' };
  }
  if (env?.CLAUDE_CODE_ENABLE_TODO_TOOLS === "1") return { mudou: false, settings };
  return { mudou: true, settings: { ...settings, env: { ...(env ?? {}), CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" } } };
}

/** Os 12 eventos com exatamente 1 hook nosso, com o comando exato desta pasta (ROOT diferente = precisa reinstalar). */
export function hooksEmDia(settings, root) {
  const comando = `node "${path.join(root, "hooks", "hook.mjs")}" ${MARKER_HOOK}`;
  const hooks = settings?.hooks && typeof settings.hooks === "object" ? settings.hooks : {};
  const nossos = (evento) => {
    const grupos = Array.isArray(hooks[evento]) ? hooks[evento] : [];
    return grupos.flatMap((g) => (g?.hooks ?? []).map((h) => String(h?.command ?? ""))).filter((c) => c.includes(MARKER_HOOK));
  };
  for (const ev of EVENTOS_HOOK) {
    const lista = nossos(ev);
    if (lista.length !== 1 || lista[0] !== comando) return false;
  }
  return Object.keys(hooks).every((ev) => EVENTOS_HOOK.includes(ev) || nossos(ev).length === 0);
}

/** Compara os agentes do repositório com os instalados (conteúdo igual, CRLF normalizado). */
export function agentesEmDia(srcDir, destDir) {
  const arquivos = fs.readdirSync(srcDir).filter((f) => f.endsWith(".md"));
  const pendentes = arquivos.filter((f) => {
    const to = path.join(destDir, f);
    if (!fs.existsSync(to)) return true;
    return normalizaLf(fs.readFileSync(to, "utf8")) !== normalizaLf(fs.readFileSync(path.join(srcDir, f), "utf8"));
  });
  return { total: arquivos.length, pendentes };
}

const CAMPOS_DE_SHELL = ["repo", "nome", "plugin", "marketplace", "skill", "comando"];
const METACARACTERES_SHELL = /["&|<>^%]/;
const METACARACTERES_SHELL_OU_ESPACO = /["&|<>^%\s]/;

/** Valida o catálogo; devolve a lista de problemas (vazia = válido). */
export function validaCatalogo(cat) {
  const erros = [];
  const str = (v) => typeof v === "string" && v.trim() !== "";
  if (!cat || typeof cat !== "object") return ["o catálogo não é um objeto JSON"];
  if (cat.versao !== 1) erros.push(`versao deve ser 1 (veio ${JSON.stringify(cat.versao)})`);
  const ids = new Set();
  const porTipo = {
    marketplace: ["repo", "nome"],
    plugin: ["plugin", "marketplace"],
    mcp: ["nome", "comando"],
    skill: ["repo", "skill"],
    "skill-manual": ["repo", "instrucao"],
  };
  for (const lista of ["essenciais", "extras"]) {
    if (!Array.isArray(cat[lista])) {
      erros.push(`"${lista}" deve ser uma lista`);
      continue;
    }
    cat[lista].forEach((item, n) => {
      const onde = `${lista}[${n}]${item?.id ? ` (${item.id})` : ""}`;
      if (!item || typeof item !== "object") return erros.push(`${onde}: item inválido`);
      if (!str(item.id)) erros.push(`${onde}: falta "id"`);
      else if (ids.has(item.id)) erros.push(`${onde}: id repetido`);
      else ids.add(item.id);
      if (!TIPOS_ITEM.includes(item.tipo)) return erros.push(`${onde}: tipo inválido (${TIPOS_ITEM.join("|")})`);
      if (!str(item.paraQue)) erros.push(`${onde}: falta "paraQue"`);
      for (const campo of porTipo[item.tipo]) if (!str(item[campo])) erros.push(`${onde}: falta "${campo}"`);
      // campos que viram argumento de comando (no Windows passam por cmd.exe): sem metacaracteres de shell
      for (const campo of CAMPOS_DE_SHELL) {
        if (typeof item[campo] !== "string") continue;
        const proibido = campo === "comando" ? METACARACTERES_SHELL : METACARACTERES_SHELL_OU_ESPACO;
        if (proibido.test(item[campo])) erros.push(`${onde}: "${campo}" tem caractere proibido (" & | < > ^ %${campo === "comando" ? "" : " ou espaço"})`);
      }
      if (item.tipo === "mcp") {
        const nav = item.navegador;
        if (!nav || typeof nav !== "object" || !NAVEGADORES.includes(nav.padrao)) {
          erros.push(`${onde}: "navegador" precisa de "padrao" (${NAVEGADORES.join("|")})`);
        } else if (nav.win32 !== undefined && !NAVEGADORES.includes(nav.win32)) {
          erros.push(`${onde}: navegador.win32 inválido`);
        }
      }
    });
  }
  return erros;
}

export function lerCatalogo(arquivo = path.join(ROOT, "setup", "skills.json")) {
  let cat;
  try {
    cat = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  } catch (e) {
    throw new Error(`não consegui ler ${arquivo}: ${e.message}`);
  }
  const erros = validaCatalogo(cat);
  if (erros.length) throw new Error(`catálogo inválido (${arquivo}):\n  - ${erros.join("\n  - ")}`);
  return cat;
}

/** Navegador configurado num servidor MCP salvo (args com --browser x ou --browser=x). */
export function navegadorDoServidor(servidor) {
  const args = Array.isArray(servidor?.args) ? servidor.args.map(String) : [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--browser") return args[i + 1] ?? null;
    if (args[i].startsWith("--browser=")) return args[i].slice("--browser=".length);
  }
  return null;
}

/** `claude mcp list` imprime uma linha `nome: comando - status`. */
export function mcpExisteNaLista(textoLista, nome) {
  return new RegExp(`^\\s*${nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`, "m").test(textoLista);
}

// ───────────────────────── leitura/escrita de arquivos ─────────────────────────

function carimbo() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Lê um JSON de configuração. `erro: true` = existe mas não é um objeto JSON válido (BOM UTF-8 é aceito). */
export function leJson(arquivo) {
  if (!fs.existsSync(arquivo)) return { existe: false, dados: {} };
  const texto = fs.readFileSync(arquivo, "utf8").replace(/^﻿/, "");
  try {
    const dados = texto.trim() ? JSON.parse(texto) : {};
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) return { existe: true, erro: true, dados: {} };
    return { existe: true, dados };
  } catch {
    return { existe: true, erro: true, dados: {} };
  }
}

/** Como leJson, mas avisa (⚠) quando o arquivo existe e está inválido, em vez de tratar em silêncio como vazio. */
function leJsonAvisando(arquivo, avisa) {
  const r = leJson(arquivo);
  if (r.erro) avisa(`${arquivo} tem JSON inválido; ignorei o conteúdo (nada foi alterado nele)`);
  return r;
}

function backup(arquivo) {
  const destino = `${arquivo}.backup-${carimbo()}`;
  fs.copyFileSync(arquivo, destino);
  return destino;
}

function marketplacesConhecidos(home, avisa = () => {}) {
  const { dados } = leJsonAvisando(path.join(home, ".claude", "plugins", "known_marketplaces.json"), avisa);
  const nomes = new Set(Object.keys(dados));
  const repos = new Set(Object.values(dados).map((m) => m?.source?.repo).filter(Boolean));
  return { nomes, repos };
}

/**
 * Ids de plugins instalados. `instalados` = conteúdo de installed_plugins.json (null se o arquivo não existe/é inválido).
 * Conta só chave com ao menos uma entrada (e, quando a entrada tem "scope", de escopo "user").
 * `enabledPlugins` do settings.json só vale como fallback quando não há installed_plugins.json.
 */
export function idsPluginsInstalados(instalados, settings) {
  const ids = new Set();
  if (instalados) {
    for (const [id, entradas] of Object.entries(instalados.plugins ?? {})) {
      if (!Array.isArray(entradas)) continue;
      if (entradas.some((e) => e && typeof e === "object" && (e.scope === undefined || e.scope === "user"))) ids.add(id);
    }
    return ids;
  }
  for (const [id, ligado] of Object.entries(settings?.enabledPlugins ?? {})) if (ligado === true) ids.add(id);
  return ids;
}

function pluginsInstalados(home, avisa = () => {}) {
  const inst = leJsonAvisando(path.join(home, ".claude", "plugins", "installed_plugins.json"), avisa);
  const { dados: settings } = leJson(path.join(home, ".claude", "settings.json"));
  return idsPluginsInstalados(inst.existe && !inst.erro ? inst.dados : null, settings);
}

/** "sim" = em ~/.claude/skills (destino de `-g -a claude-code`); "fora" = só em ~/.agents/skills; "nao". */
export function skillStatus(home, skill) {
  if (fs.existsSync(path.join(home, ".claude", "skills", skill))) return "sim";
  if (fs.existsSync(path.join(home, ".agents", "skills", skill))) return "fora";
  return "nao";
}

/** --check de uma skill ainda não "sim": "pula" (extra sem --completo), "aviso" (só em ~/.agents), "falta" ou null (fora do --check). */
export function veredictoCheckSkill(estado, extra, flags) {
  if (!flags.check || estado === "sim") return null;
  if (extra && !flags.completo) return "pula";
  return estado === "fora" ? "aviso" : "falta";
}

function mcpsDeUsuario(home, avisa = () => {}) {
  const { dados } = leJsonAvisando(path.join(home, ".claude.json"), avisa);
  return dados.mcpServers && typeof dados.mcpServers === "object" ? dados.mcpServers : {};
}

// ───────────────────────── execução de comandos ─────────────────────────

/** Roda um comando sem terminal interativo (stdin ignorado). No Windows, claude/npx/npm passam por shell. */
function rodar(cmd, args, { timeout = TIMEOUT_ITEM_MS, cwd = ROOT, plataforma = process.platform } = {}) {
  const opcoes = { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 };
  const precisaShell = plataforma === "win32" && ["claude", "npx", "npm"].includes(cmd);
  const r = precisaShell
    ? spawnSync(montaComando(cmd, args, plataforma), { ...opcoes, shell: true })
    : spawnSync(cmd, args, opcoes);
  // Limitação conhecida (Windows): no timeout o spawnSync mata só o cmd.exe; o processo filho (npx/node)
  // pode continuar em segundo plano. Não há como derrubar a árvore depois (o pid já morreu); ver SETUP.md.
  const saida = `${r.stdout ?? ""}${r.stderr ? `\n${r.stderr}` : ""}`.trim();
  const estourou = r.error?.code === "ETIMEDOUT" || (r.signal === "SIGTERM" && r.status === null);
  return {
    ok: r.status === 0 && !r.error,
    status: r.status,
    saida,
    estourou,
    erroSpawn: r.error && !estourou ? r.error.message : null,
  };
}

function ultimasLinhas(texto, n = 6) {
  return texto.split(/\r?\n/).filter((l) => l.trim()).slice(-n).join("\n      ");
}

// ───────────────────────── o setup em si ─────────────────────────

function criaContexto(flags, home, plataforma) {
  const ctx = {
    flags,
    home,
    plataforma,
    claudeDir: path.join(home, ".claude"),
    escreve: !flags.dryRun && !flags.check,
    erros: 0,
    certErro: false,
    rel: { instalado: [], ja: [], falhou: [], pulado: [], manual: [], avisos: [] },
  };
  ctx.settingsFile = path.join(ctx.claudeDir, "settings.json");
  return ctx;
}

const out = (s) => console.log(s);

function logs(ctx) {
  return {
    titulo: (t) => out(`\n== ${t} ==`),
    ok: (m) => out(`  ✔ ${m}`),
    ja: (nome, extra = "") => {
      out(`  ✔ ${nome} (já existia${extra})`);
      ctx.rel.ja.push(nome);
    },
    instalou: (nome) => {
      out(`  ✔ ${nome} (instalado agora)`);
      ctx.rel.instalado.push(nome);
    },
    faria: (m) => out(`  ○ faria: ${m}`),
    aviso: (m) => {
      out(`  ⚠ ${m}`);
      ctx.rel.avisos.push(m);
    },
    falta: (m) => {
      out(`  ✖ ${m}`);
      ctx.erros++;
    },
    falhou: (nome, detalhe, manual) => {
      out(`  ✖ ${nome}: falhou${detalhe ? `\n      ${detalhe}` : ""}`);
      if (manual) {
        out(`      Comando manual: ${manual}`);
        ctx.rel.manual.push(manual);
      }
      ctx.rel.falhou.push(nome);
      ctx.erros++;
    },
    pulou: (nome, motivo) => {
      out(`  - ${nome} (${motivo})`);
      ctx.rel.pulado.push(nome);
    },
  };
}

function registraCert(ctx, saida) {
  if (detectaErroCert(saida)) ctx.certErro = true;
}

function passoPrereqs(ctx, L) {
  L.titulo("1. Pré-requisitos");
  let faltou = false;
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) L.ok(`Node ${process.versions.node}`);
  else {
    L.falta(`Node ${process.versions.node} é antigo. Instale o Node 20 ou mais novo: https://nodejs.org`);
    faltou = true;
  }
  const git = rodar("git", ["--version"], { timeout: 20_000 });
  if (git.ok) L.ok(git.saida.split("\n")[0]);
  else {
    L.falta("git não encontrado no PATH. Instale: https://git-scm.com/downloads e abra um terminal novo.");
    faltou = true;
  }
  const claude = rodar("claude", ["--version"], { timeout: 60_000, plataforma: ctx.plataforma });
  if (claude.ok) {
    L.ok(`Claude Code ${claude.saida.split("\n")[0]}`);
    ctx.claudeOk = true;
  } else {
    L.falta(
      "claude (Claude Code) não encontrado no PATH. Instale: https://docs.claude.com/en/docs/claude-code/setup , faça login com `claude` e abra um terminal novo.",
    );
    faltou = true;
  }
  return !faltou;
}

function passoNpmInstall(ctx, L) {
  L.titulo("2. Dependências (npm install)");
  if (fs.existsSync(path.join(ROOT, "node_modules"))) return L.ja("node_modules");
  if (ctx.flags.check) return L.aviso("node_modules não existe: rode `npm install` (ou `npm run setup`)");
  if (ctx.flags.dryRun) return L.faria("npm install");
  const r = rodar("npm", ["install"], { timeout: TIMEOUT_LONGO_MS, plataforma: ctx.plataforma });
  registraCert(ctx, r.saida);
  if (r.ok) return L.instalou("npm install");
  L.falhou("npm install", ultimasLinhas(r.saida), "npm install");
  return false;
}

function passoAgentes(ctx, L) {
  L.titulo("3. Agentes (~/.claude/agents)");
  const src = path.join(ROOT, "agents");
  const dest = path.join(ctx.claudeDir, "agents");
  const { total, pendentes } = agentesEmDia(src, dest);
  if (pendentes.length === 0) return L.ja(`${total} agentes`, ", em dia");
  if (ctx.flags.check) return L.falta(`${pendentes.length} de ${total} agentes faltando ou desatualizados: ${pendentes.join(", ")}`);
  if (ctx.flags.dryRun) return L.faria(`instalar/atualizar agentes: ${pendentes.join(", ")}`);
  const r = rodar(process.execPath, [path.join(ROOT, "scripts", "install-agents.mjs")], { plataforma: ctx.plataforma });
  const depois = agentesEmDia(src, dest);
  if (r.ok && depois.pendentes.length === 0) return L.instalou(`${total} agentes`);
  L.falhou("agentes", ultimasLinhas(r.saida), "npm run install-agents");
}

/** Retorna false se o settings.json estiver inválido (o setup para, sem sobrescrever nada). */
function passoHooks(ctx, L) {
  L.titulo("4. Hooks do escritório");
  const s = leJson(ctx.settingsFile);
  if (s.erro) {
    L.falta(`${ctx.settingsFile} tem JSON inválido. Corrija o arquivo e rode de novo (nada foi alterado).`);
    return false;
  }
  if (hooksEmDia(s.dados, ROOT)) {
    L.ja(`${EVENTOS_HOOK.length} hooks`, `, apontando para ${ROOT}`);
    return true;
  }
  if (ctx.flags.check) {
    L.falta(`hooks ausentes ou apontando para outra pasta (esperado: ${path.join(ROOT, "hooks", "hook.mjs")})`);
    return true;
  }
  if (ctx.flags.dryRun) {
    L.faria("instalar os hooks (substituindo versões antigas do AG Pocket, com backup do settings.json)");
    return true;
  }
  const r = rodar(process.execPath, [path.join(ROOT, "scripts", "install-hooks.mjs")], { plataforma: ctx.plataforma });
  const depois = leJson(ctx.settingsFile);
  if (r.ok && !depois.erro && hooksEmDia(depois.dados, ROOT)) L.instalou(`${EVENTOS_HOOK.length} hooks`);
  else L.falhou("hooks", ultimasLinhas(r.saida), "npm run install-hooks");
  return true;
}

function passoSettingsEnv(ctx, L) {
  L.titulo("5. settings.json global (lista de tarefas)");
  const s = leJson(ctx.settingsFile); // relê do disco: o passo dos hooks mexeu neste arquivo
  if (s.erro) {
    L.falta(`${ctx.settingsFile} tem JSON inválido. Corrija o arquivo e rode de novo (nada foi alterado).`);
    return false;
  }
  const r = aplicaEnv(s.dados);
  if (r.erro) {
    L.falta(`${r.erro}. Corrija à mão e rode de novo (nada foi alterado).`);
    return false;
  }
  if (!r.mudou) {
    L.ja("env.CLAUDE_CODE_ENABLE_TODO_TOOLS=1");
    return true;
  }
  if (ctx.flags.check) L.falta('falta "env": { "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" } no settings.json');
  else if (ctx.flags.dryRun) L.faria("gravar env.CLAUDE_CODE_ENABLE_TODO_TOOLS=1 no settings.json (com backup)");
  else {
    fs.mkdirSync(ctx.claudeDir, { recursive: true });
    if (s.existe) backup(ctx.settingsFile);
    fs.writeFileSync(ctx.settingsFile, `${JSON.stringify(r.settings, null, 2)}\n`);
    L.instalou("env.CLAUDE_CODE_ENABLE_TODO_TOOLS=1");
  }
  return true;
}

function passoClaudeMd(ctx, L) {
  L.titulo("6. CLAUDE.md global (bloco do time)");
  const arquivo = path.join(ctx.claudeDir, "CLAUDE.md");
  const bloco = montaBlocoTime(fs.readFileSync(path.join(ROOT, "team", "CLAUDE-time.md"), "utf8"));
  const atual = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, "utf8") : null;
  const r = aplicaBloco(atual, bloco);
  if (r.acao === "erro") {
    L.falta(r.mensagem);
    return false;
  }
  if (r.acao === "igual") {
    L.ja("bloco do time no CLAUDE.md", ", igual");
    return true;
  }
  if (ctx.flags.check) {
    L.falta(r.acao === "atualizar" ? "bloco do time no CLAUDE.md está desatualizado" : "bloco do time (ag-pocket) não está no CLAUDE.md");
    if (r.aviso) L.aviso(r.aviso);
    return true;
  }
  if (ctx.flags.dryRun) {
    L.faria(`${{ criar: "criar o CLAUDE.md com", anexar: "anexar ao CLAUDE.md", atualizar: "atualizar no CLAUDE.md" }[r.acao]} o bloco do time`);
    if (r.aviso) L.aviso(r.aviso);
    return true;
  }
  fs.mkdirSync(ctx.claudeDir, { recursive: true });
  if (atual !== null) backup(arquivo);
  fs.writeFileSync(arquivo, r.texto);
  L.instalou(`bloco do time no CLAUDE.md (${r.acao})`);
  if (r.aviso) L.aviso(r.aviso);
  return true;
}

function passoComandoTime(ctx, L) {
  L.titulo("7. Comando /time");
  const src = path.join(ROOT, "commands", "time.md");
  const dest = path.join(ctx.claudeDir, "commands", "time.md");
  if (!fs.existsSync(src)) return L.falta("commands/time.md não existe no repositório");
  const existe = fs.existsSync(dest);
  if (existe && normalizaLf(fs.readFileSync(dest, "utf8")) === normalizaLf(fs.readFileSync(src, "utf8"))) {
    return L.ja("/time", ", igual");
  }
  if (ctx.flags.check) return L.falta("/time ausente ou diferente de commands/time.md");
  if (ctx.flags.dryRun) return L.faria(`${existe ? "atualizar (com backup)" : "copiar"} commands/time.md para ~/.claude/commands/`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (existe) backup(dest);
  fs.copyFileSync(src, dest);
  L.instalou("/time");
}

function passoMcp(ctx, L, item) {
  L.titulo("8. Playwright MCP (escopo de usuário)");
  const navegador = escolheNavegador(ctx.plataforma, ctx.flags.browser, item.navegador);
  const servidores = mcpsDeUsuario(ctx.home, L.aviso);
  const atual = servidores[item.nome];
  const manual = montaComando("claude", ["mcp", "add", "--scope", "user", item.nome, "--", ...item.comando.split(" "), "--browser", navegador], "linux");
  if (atual) {
    const nav = navegadorDoServidor(atual);
    if (nav && nav !== navegador && !ctx.flags.browser) {
      return L.aviso(`${item.nome} já existe com --browser ${nav} (o padrão aqui seria ${navegador}); mantive como está`);
    }
    if (nav && nav !== navegador) {
      return L.aviso(`${item.nome} já existe com --browser ${nav} e você pediu ${navegador}; não recriei. Para trocar: claude mcp remove ${item.nome} --scope user e rode o setup de novo`);
    }
    return L.ja(`MCP ${item.nome}`, nav ? `, --browser ${nav}` : "");
  }
  if (ctx.flags.check) return L.falta(`MCP "${item.nome}" não está instalado (os agentes usam mcp__${item.nome})`);
  if (ctx.flags.dryRun) return L.faria(manual);
  const r = rodar("claude", ["mcp", "add", "--scope", "user", item.nome, "--", ...item.comando.split(" "), "--browser", navegador], {
    plataforma: ctx.plataforma,
  });
  registraCert(ctx, r.saida);
  if (r.ok) return L.instalou(`MCP ${item.nome} (--browser ${navegador})`);
  if (/already exists/i.test(r.saida)) return L.ja(`MCP ${item.nome}`);
  L.falhou(`MCP ${item.nome}`, r.estourou ? `tempo esgotado (${TIMEOUT_ITEM_MS / 1000} s)` : ultimasLinhas(r.saida), manual);
}

function passoPlugins(ctx, L, cat) {
  L.titulo("9. Marketplaces, plugins e skills");
  if (ctx.flags.semPlugins && !ctx.flags.check) {
    L.aviso("--sem-plugins: pulei marketplaces, plugins e skills");
    ctx.rel.pulado.push("marketplaces, plugins e skills");
    return;
  }
  if (ctx.flags.completo && ctx.escreve) {
    L.aviso("--completo: os extras são skills/plugins de TERCEIROS e rodam com as suas permissões. Revise antes de usar.");
  }
  const itens = cat.essenciais.filter((i) => i.tipo !== "mcp");
  const extras = cat.extras.filter((i) => i.tipo !== "mcp");
  const conhecidos = marketplacesConhecidos(ctx.home, L.aviso);
  const plugins = pluginsInstalados(ctx.home, L.aviso);
  const falhasMkt = new Set();

  const cuida = (item, extra) => {
    const rotulo = extra ? `${item.id} (extra)` : item.id;
    if (item.tipo === "marketplace") {
      const manual = `/plugin marketplace add ${item.repo}`;
      if (conhecidos.nomes.has(item.nome) || conhecidos.repos.has(item.repo)) return L.ja(`marketplace ${item.nome}`);
      if (ctx.flags.check) return extra ? L.pulou(rotulo, "não instalado") : L.falta(`marketplace ${item.nome} não está adicionado (${manual})`);
      if (ctx.flags.dryRun) return L.faria(`claude plugin marketplace add ${item.repo}`);
      const r = rodar("claude", ["plugin", "marketplace", "add", item.repo], { plataforma: ctx.plataforma });
      registraCert(ctx, r.saida);
      if (r.ok || /already/i.test(r.saida)) return r.ok ? L.instalou(`marketplace ${item.nome}`) : L.ja(`marketplace ${item.nome}`);
      falhasMkt.add(item.nome);
      return L.falhou(`marketplace ${item.nome}`, r.estourou ? `tempo esgotado (${TIMEOUT_ITEM_MS / 1000} s)` : ultimasLinhas(r.saida), manual);
    }
    if (item.tipo === "plugin") {
      const id = `${item.plugin}@${item.marketplace}`;
      const manual = `/plugin install ${id}`;
      if (plugins.has(id)) return L.ja(`plugin ${id}`);
      if (ctx.flags.check) return extra ? L.pulou(rotulo, "não instalado") : L.falta(`plugin ${id} não está instalado (${manual})`);
      if (ctx.flags.dryRun) return L.faria(`claude plugin install ${id} --scope user`);
      if (falhasMkt.has(item.marketplace)) return L.falhou(`plugin ${id}`, `o marketplace ${item.marketplace} falhou antes`, manual);
      const r = rodar("claude", ["plugin", "install", id, "--scope", "user"], { plataforma: ctx.plataforma });
      registraCert(ctx, r.saida);
      if (r.ok) return /already/i.test(r.saida) ? L.ja(`plugin ${id}`) : L.instalou(`plugin ${id}`);
      return L.falhou(`plugin ${id}`, r.estourou ? `tempo esgotado (${TIMEOUT_ITEM_MS / 1000} s)` : ultimasLinhas(r.saida), manual);
    }
    if (item.tipo === "skill") {
      const manual = `npx skills add ${item.repo} --skill ${item.skill}`;
      const estado = skillStatus(ctx.home, item.skill);
      if (estado === "sim") return L.ja(`skill ${item.skill}`);
      const veredito = veredictoCheckSkill(estado, extra, ctx.flags);
      if (veredito === "pula") return L.pulou(rotulo, "extra; use --completo");
      if (veredito === "aviso") {
        return L.aviso(`skill ${item.skill} existe só em ~/.agents/skills (fora do Claude); falta em ~/.claude/skills (${manual})`);
      }
      if (ctx.flags.check) return extra ? L.pulou(rotulo, "não instalado") : L.falta(`skill ${item.skill} não está instalada (${manual})`);
      const args = ["--yes", "skills", "add", item.repo, "--skill", item.skill, "-g", "-a", "claude-code", "-y"];
      if (ctx.flags.dryRun) return L.faria(`npx ${args.join(" ")}`);
      const r = rodar("npx", args, { plataforma: ctx.plataforma });
      registraCert(ctx, r.saida);
      if (r.ok && skillStatus(ctx.home, item.skill) === "sim") return L.instalou(`skill ${item.skill}`);
      return L.falhou(`skill ${item.skill}`, r.estourou ? `tempo esgotado (${TIMEOUT_ITEM_MS / 1000} s)` : ultimasLinhas(r.saida), manual);
    }
    // skill-manual: sem comando automático, vira instrução
    L.aviso(`${item.id}: instalação manual. ${item.instrucao}`);
    ctx.rel.manual.push(`${item.id}: ${item.instrucao}`);
  };

  // ordem: marketplaces, plugins, skills
  const ordem = ["marketplace", "plugin", "skill", "skill-manual"];
  for (const tipo of ordem) for (const item of itens.filter((i) => i.tipo === tipo)) cuida(item, false);
  if (ctx.flags.completo) {
    for (const tipo of ordem) for (const item of extras.filter((i) => i.tipo === tipo)) cuida(item, true);
  } else if (ctx.flags.check) {
    for (const item of extras) L.pulou(item.id, "extra; use --completo");
  } else {
    out(`  - ${extras.length} extras de terceiros não incluídos (use --completo)`);
  }
}

function passoDados(ctx, L) {
  L.titulo("10. Elenco (data/agzinhos.json)");
  const alvo = path.join(ROOT, "data", "agzinhos.json");
  const exemplo = path.join(ROOT, "data", "agzinhos.example.json");
  if (fs.existsSync(alvo)) return L.ja("data/agzinhos.json", ", não sobrescrevo");
  if (!fs.existsSync(exemplo)) return L.aviso("data/agzinhos.example.json não existe; nada a copiar");
  if (ctx.flags.check) return L.aviso("data/agzinhos.json ainda não existe (o setup cria a partir do exemplo)");
  if (ctx.flags.dryRun) return L.faria("copiar data/agzinhos.example.json para data/agzinhos.json");
  fs.copyFileSync(exemplo, alvo);
  L.instalou("data/agzinhos.json");
}

function passoBuild(ctx, L) {
  L.titulo("11. Build do escritório (npm run build)");
  if (ctx.flags.check) return out("  - não executado em --check");
  if (ctx.flags.dryRun) return L.faria("npm run build");
  if (!fs.existsSync(path.join(ROOT, "node_modules"))) return L.falhou("build", "sem node_modules", "npm install && npm run build");
  const r = rodar("npm", ["run", "build"], { timeout: TIMEOUT_LONGO_MS, plataforma: ctx.plataforma });
  registraCert(ctx, r.saida);
  if (r.ok) return L.ok("build concluído");
  L.falhou("build", ultimasLinhas(r.saida), "npm run build");
}

function resumo(ctx) {
  const { rel } = ctx;
  const lista = (titulo, itens) => {
    if (itens.length) out(`  ${titulo} (${itens.length}): ${itens.join("; ")}`);
  };
  out("\n== Resumo ==");
  if (ctx.flags.dryRun) out("  (dry-run: nada foi escrito nem instalado)");
  lista("Instalado agora", rel.instalado);
  lista("Já existia", rel.ja);
  lista("Falhou", rel.falhou);
  lista("Pulado", rel.pulado);
  if (rel.manual.length) {
    out("  Comandos manuais (cole no Claude Code ou no terminal):");
    for (const m of rel.manual) out(`    ${m}`);
  }
  if (ctx.certErro) for (const l of dicaCert(ctx.plataforma)) out(`  ⚠ ${l}`);
  out(
    "  Nota: a lista fica em setup/skills.json. O setup só instala e confere os itens dela; o que você instalou por conta própria não é tocado.",
  );
  if (ctx.flags.check) {
    out(ctx.erros ? `\n✖ ${ctx.erros} item(ns) essencial(is) faltando. Rode: npm run setup` : "\n✔ Tudo em dia.");
  } else if (ctx.flags.dryRun) {
    out(ctx.erros ? `\n✖ ${ctx.erros} problema(s) encontrado(s).` : "\nPara instalar de verdade, rode: npm run setup");
  } else if (ctx.erros) {
    out(`\n✖ Terminou com ${ctx.erros} problema(s). Veja os comandos manuais acima e rode \`npm run setup\` de novo.`);
  } else {
    out("\n✔ Pronto! Abra uma sessão NOVA do Claude Code e rode `npm start`.");
  }
}

const AJUDA = `Uso: npm run setup -- [opções]
  --dry-run        mostra o que faria, sem escrever nada
  --check          só confere (o mesmo que npm run setup:check)
  --completo       instala também os extras (skills/plugins de terceiros)
  --sem-plugins    pula marketplaces, plugins e skills
  --browser=NAV    navegador do Playwright MCP: ${NAVEGADORES.join(" | ")}`;

/** Roda o setup e devolve o código de saída. */
export function setup(argv, { home = os.homedir(), plataforma = process.platform } = {}) {
  const flags = parseFlags(argv);
  if (flags.ajuda) {
    out(AJUDA);
    return 0;
  }
  if (flags.erros.length) {
    for (const e of flags.erros) out(`✖ ${e}`);
    out(AJUDA);
    return 1;
  }
  const ctx = criaContexto(flags, home, plataforma);
  const L = logs(ctx);
  const modo = flags.check ? "conferência (nada é escrito)" : flags.dryRun ? "dry-run (nada é escrito)" : "instalação";
  out(`AG Pocket — setup: ${modo}${flags.completo ? ", com extras" : ""}`);
  out(`Pasta do projeto: ${ROOT}\nPasta do Claude:  ${ctx.claudeDir}`);

  let cat;
  try {
    cat = lerCatalogo();
  } catch (e) {
    out(`✖ ${e.message}`);
    return 1;
  }
  const itemMcp = [...cat.essenciais, ...(flags.completo ? cat.extras : [])].find((i) => i.tipo === "mcp");

  const prereqOk = passoPrereqs(ctx, L);
  if (!prereqOk && !flags.check) {
    out("\n✖ Resolva os pré-requisitos acima e rode de novo.");
    return 1;
  }
  const seguir = [
    () => passoNpmInstall(ctx, L) !== false,
    () => passoAgentes(ctx, L) !== false,
    () => passoHooks(ctx, L),
    () => passoSettingsEnv(ctx, L),
    () => passoClaudeMd(ctx, L),
    () => passoComandoTime(ctx, L) !== false,
    () => (itemMcp ? passoMcp(ctx, L, itemMcp) !== false : true),
    () => passoPlugins(ctx, L, cat) !== false,
    () => passoDados(ctx, L) !== false,
    () => passoBuild(ctx, L) !== false,
  ];
  for (const passo of seguir) {
    // em --check um passo inválido vira ✖ e o diagnóstico dos demais itens segue
    if (!passo() && !flags.check) {
      out("\n✖ Parei aqui para não sobrescrever nada. Corrija o problema acima e rode de novo.");
      return 1;
    }
  }
  resumo(ctx);
  return ctx.erros > 0 ? 1 : 0;
}

function ehArquivoPrincipal() {
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1] ?? ""));
  } catch {
    return false;
  }
}

if (ehArquivoPrincipal()) process.exitCode = setup(process.argv.slice(2));
