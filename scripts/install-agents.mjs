#!/usr/bin/env node
// Copia os subagentes do time (pasta agents/) para o Claude Code.
//
//   npm run install-agents                 → ~/.claude/agents (todos os projetos)
//   npm run install-agents -- --project .  → <pasta>/.claude/agents (só um projeto)
//
// Se já existir um agente com o mesmo nome, guarda um backup antes de sobrescrever.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "agents");

const args = process.argv.slice(2);
const projectIdx = args.indexOf("--project");
const dest =
  projectIdx >= 0
    ? path.join(path.resolve(args[projectIdx + 1] ?? "."), ".claude", "agents")
    : path.join(os.homedir(), ".claude", "agents");

fs.mkdirSync(dest, { recursive: true });

const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".md"));
for (const f of files) {
  const to = path.join(dest, f);
  if (fs.existsSync(to)) {
    const lf = (p) => fs.readFileSync(p, "utf8").replace(/
/g, "
");
    const same = lf(to) === lf(path.join(SRC, f));
    if (same) {
      console.log(`   = ${f} (já está igual)`);
      continue;
    }
    fs.copyFileSync(to, `${to}.backup-${Date.now()}`);
  }
  fs.copyFileSync(path.join(SRC, f), to);
  console.log(`   + ${f}`);
}
console.log(`✅ ${files.length} agentes em ${dest}`);
console.log(`   Dentro do Claude Code, rode /agents pra conferir.`);
