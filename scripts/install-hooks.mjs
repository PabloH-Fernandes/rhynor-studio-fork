#!/usr/bin/env node
// Liga (ou desliga, com --remove) os hooks do escritório no Claude Code.
//
//   npm run install-hooks                 → ~/.claude/settings.json (vale pra todos os projetos)
//   npm run install-hooks -- --project .  → <pasta>/.claude/settings.local.json (só um projeto)
//   npm run uninstall-hooks               → remove de novo
//
// Antes de mexer, salva um backup do arquivo com data e hora.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "--escritorio-ia";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(ROOT, "hooks", "hook.mjs");

const TOOL_EVENTS = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest"];
const OTHER_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "TeammateIdle",
  "Stop",
];

const args = process.argv.slice(2);
const remove = args.includes("--remove");
const projectIdx = args.indexOf("--project");
const target =
  projectIdx >= 0
    ? path.join(path.resolve(args[projectIdx + 1] ?? "."), ".claude", "settings.local.json")
    : path.join(os.homedir(), ".claude", "settings.json");

let settings = {};
if (fs.existsSync(target)) {
  const text = fs.readFileSync(target, "utf8");
  try {
    settings = text.trim() ? JSON.parse(text) : {};
  } catch {
    console.error(`❌ Não consegui ler ${target} (JSON inválido). Corrija o arquivo e rode de novo.`);
    process.exit(1);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(target, `${target}.backup-${stamp}`);
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
}

settings.hooks ??= {};

// tira qualquer versão antiga do nosso hook antes de colocar de novo
for (const event of Object.keys(settings.hooks)) {
  const groups = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  const cleaned = groups
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !String(h.command ?? "").includes(MARKER)) }))
    .filter((g) => g.hooks.length > 0);
  if (cleaned.length) settings.hooks[event] = cleaned;
  else delete settings.hooks[event];
}

if (!remove) {
  // caminho entre aspas pra funcionar com espaços (ex.: C:\Users\Pablo Henrique\...)
  const command = `node "${HOOK}" ${MARKER}`;
  const entry = { type: "command", command, timeout: 5, async: true };
  for (const event of [...TOOL_EVENTS, ...OTHER_EVENTS]) {
    const group = TOOL_EVENTS.includes(event) ? { matcher: "*", hooks: [entry] } : { hooks: [entry] };
    (settings.hooks[event] ??= []).push(group);
  }
}

if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
fs.writeFileSync(target, JSON.stringify(settings, null, 2) + "\n");

if (remove) {
  console.log(`🧹 Hooks do escritório removidos de ${target}`);
} else {
  console.log(`✅ Hooks instalados em ${target}`);
  console.log(`   Abra uma sessão NOVA do Claude Code (os hooks são lidos ao iniciar).`);
}
