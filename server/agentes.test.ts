// Todo agents/*.md precisa de um `model` válido (alias, claude-... ou inherit).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PASTA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "agents");

test("cada agente tem model válido", () => {
  const arquivos = fs.readdirSync(PASTA).filter((f) => f.endsWith(".md"));
  assert.ok(arquivos.length >= 6);
  for (const f of arquivos) {
    const texto = fs.readFileSync(path.join(PASTA, f), "utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto)?.[1] ?? "";
    const model = /^model:\s*(\S+)\s*$/m.exec(fm)?.[1];
    assert.ok(model, `${f} sem model`);
    assert.ok(["sonnet", "opus", "haiku", "inherit"].includes(model) || model.startsWith("claude-"), `${f}: model inválido (${model})`);
  }
});
