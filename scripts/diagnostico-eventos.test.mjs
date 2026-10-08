import test from "node:test";
import assert from "node:assert/strict";
import { analisar, formatar, lerLinhas } from "./diagnostico-eventos.mjs";

const ev = (chegada, evento) => JSON.stringify({ chegada, hookTs: chegada, evento });

const JSONL = [
  JSON.stringify({ chegada: 900, marcador: "servidor_iniciou" }),
  ev(1000, { hook_event_name: "SessionStart", session_id: "sessaoA", cwd: "C:/p", source: "startup" }),
  ev(1100, { hook_event_name: "UserPromptSubmit", session_id: "sessaoA", cwd: "C:/p", prompt: "SEGREDO-DO-PROMPT" }),
  ev(1200, { hook_event_name: "SubagentStart", session_id: "sessaoA", agent_id: "ag1", agent_type: "dev" }),
  ev(1300, { hook_event_name: "PreToolUse", session_id: "sessaoA", agent_id: "ag1", tool_use_id: "t1", tool_name: "Bash" }),
  ev(1400, { hook_event_name: "PostToolUse", session_id: "sessaoA", agent_id: "ag1", tool_use_id: "t1" }),
  ev(1500, { hook_event_name: "SubagentStop", session_id: "sessaoA", agent_id: "ag1", agent_type: "dev" }),
  ev(1600, { hook_event_name: "PreToolUse", session_id: "sessaoA", agent_id: "ag1", tool_use_id: "t2", tool_name: "Read" }),
  // agente sem Start, em sessão sem prompt
  ev(2000, { hook_event_name: "PreToolUse", session_id: "sessaoB", cwd: "C:/outro", agent_id: "ag2", agent_type: "general-purpose", tool_use_id: "t3", tool_name: "Grep", permission_mode: "bypassPermissions" }),
  JSON.stringify({ chegada: 3000, marcador: "servidor_iniciou" }),
  ev(3100, { hook_event_name: "SessionEnd", session_id: "sessaoA", reason: "other" }),
  "linha quebrada",
].join("\n");

test("analisar: sessões, agentes, tools abertas e marcadores", () => {
  const { linhas, invalidas } = lerLinhas(JSONL);
  assert.equal(invalidas, 1);
  const r = analisar(linhas);
  assert.equal(r.totalEventos, 9);

  const a = r.sessoes.find((s) => s.id === "sessaoA");
  assert.equal(a.cwd, "C:/p");
  assert.equal(a.temSessionEnd, true);
  assert.equal(a.temPrompt, true);
  assert.equal(a.suspeitaNaoInterativa, false);
  const ag1 = a.agentes[0];
  assert.deepEqual([ag1.temStart, ag1.temStop, ag1.depoisDoStop, ag1.nasceuSemStart], [true, true, 1, false]);

  const b = r.sessoes.find((s) => s.id === "sessaoB");
  assert.equal(b.suspeitaNaoInterativa, true);
  assert.deepEqual(b.meta.permission_mode, ["bypassPermissions"]);
  assert.equal(b.agentes[0].nasceuSemStart, true);
  assert.equal(b.agentes[0].tipo, "general-purpose");

  assert.deepEqual(r.toolsSemPost.map((x) => [x.tuid, x.tool]).sort(), [["t2", "Read"], ["t3", "Grep"]]);
  assert.deepEqual(r.marcadores.map((m) => [m.antes, m.depois]), [[0, 9], [8, 1]]);
  assert.ok(r.chaves.some(([k]) => k === "permission_mode"));
});

test("formatar nunca imprime o texto do prompt", () => {
  const { linhas } = lerLinhas(JSONL);
  const texto = formatar(analisar(linhas));
  assert.ok(!texto.includes("SEGREDO-DO-PROMPT"));
  assert.ok(texto.includes("NASCEU SEM SubagentStart"));
});
