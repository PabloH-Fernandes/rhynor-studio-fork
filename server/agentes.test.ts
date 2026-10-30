// Todo agente (agents/*.md e .claude/agents/*.md) precisa de um `model` válido (alias, claude-... ou inherit)
// e de `name:` igual ao nome do arquivo. Os 6 do time de construção em .claude/agents/ são cópia de agents/.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PASTA = path.join(ROOT, "agents");
const PASTA_PROJETO = path.join(ROOT, ".claude", "agents");
const TIME_CONSTRUCAO = ["planejador", "pesquisador", "dev", "testador", "revisor", "documentador"];

const ler = (p: string): string => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const frontmatter = (texto: string): string => /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto)?.[1] ?? "";
const mds = (pasta: string): string[] => fs.readdirSync(pasta).filter((f) => f.endsWith(".md"));

for (const [rotulo, pasta] of [
  ["agents/", PASTA],
  [".claude/agents/", PASTA_PROJETO],
] as const) {
  test(`cada agente de ${rotulo} tem model válido e name igual ao arquivo`, () => {
    const arquivos = mds(pasta);
    assert.ok(arquivos.length >= 6);
    for (const f of arquivos) {
      const fm = frontmatter(ler(path.join(pasta, f)));
      const model = /^model:\s*(\S+)\s*$/m.exec(fm)?.[1];
      assert.ok(model, `${f} sem model`);
      assert.ok(["sonnet", "opus", "haiku", "inherit"].includes(model) || model.startsWith("claude-"), `${f}: model inválido (${model})`);
      const name = /^name:\s*(\S+)\s*$/m.exec(fm)?.[1];
      assert.equal(name, f.replace(/\.md$/, ""), `${rotulo}${f}: name diferente do arquivo`);
    }
  });
}

test(".claude/agents/ tem a cópia exata dos 6 agentes de construção de agents/", () => {
  for (const nome of TIME_CONSTRUCAO) {
    const origem = path.join(PASTA, `${nome}.md`);
    const copia = path.join(PASTA_PROJETO, `${nome}.md`);
    assert.ok(fs.existsSync(copia), `falta .claude/agents/${nome}.md (rode: node scripts/install-agents.mjs --project .)`);
    assert.equal(ler(copia), ler(origem), `.claude/agents/${nome}.md difere de agents/${nome}.md`);
  }
});
