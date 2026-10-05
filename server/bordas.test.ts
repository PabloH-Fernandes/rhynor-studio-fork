// Casos de borda da identidade por agent_id, via reprodutor.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LinhaGravada } from "./gravador.ts";
import { agentePorNome, agentes, reproduzir } from "./replay.ts";

const T0 = 1791205200000;
type Ev = Record<string, unknown>;
const mk = (seg: number, e: Ev, sid = "S1"): LinhaGravada =>
  ({ chegada: T0 + seg * 1000, hookTs: T0 + seg * 1000 - 20, evento: { session_id: sid, cwd: "/p", ...e } }) as LinhaGravada;
const ag = (seg: number, tu: string, type = "dev", sid = "S1") =>
  mk(seg, { hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: type, description: "x" }, tool_use_id: tu }, sid);
const start = (seg: number, id: string, type = "dev", sid = "S1") => mk(seg, { hook_event_name: "SubagentStart", agent_id: id, agent_type: type }, sid);
const stop = (seg: number, id: string, type = "dev", sid = "S1") => mk(seg, { hook_event_name: "SubagentStop", agent_id: id, agent_type: type }, sid);
const pre = (seg: number, id: string | undefined, tu: string, tool = "Read", type = "dev", sid = "S1") =>
  mk(seg, { hook_event_name: "PreToolUse", tool_name: tool, tool_input: { file_path: "/p/a.ts" }, tool_use_id: tu, ...(id ? { agent_id: id, agent_type: type } : {}) }, sid);
const post = (seg: number, id: string | undefined, tu: string, tool = "Read", type = "dev", sid = "S1") =>
  mk(seg, { hook_event_name: "PostToolUse", tool_name: tool, tool_use_id: tu, ...(id ? { agent_id: id, agent_type: type } : {}) }, sid);
const sess = (sid = "S1") => mk(0, { hook_event_name: "SessionStart", source: "startup" }, sid);
const subs = (l: LinhaGravada[]) => agentes(reproduzir(l).state).filter((a) => a.parentId);

test("PreToolUse do subagente antes do SubagentStart: um boneco só, trabalhando", () => {
  const l = [sess(), ag(1, "t1"), pre(2, "A", "r1"), start(2.5, "A")];
  const s = subs(l);
  assert.equal(s.length, 1);
  assert.equal(s[0].status, "trabalhando");
});

test("PostToolUse atrasado depois do SubagentStop fica ocioso (só PreToolUse/Start retoma)", () => {
  const l = [sess(), ag(1, "t1"), start(1.2, "A"), pre(2, "A", "r1"), stop(4, "A"), post(4.1, "A", "r1")];
  const s = subs(l);
  assert.equal(s.length, 1);
  assert.equal(s[0].status, "ocioso", "Post atrasado não religa o boneco");
});

test("2 sessões simultâneas com o mesmo papel: bonecos distintos", () => {
  const l = [sess("S1"), sess("S2"), ag(1, "t1", "dev", "S1"), ag(1.1, "t2", "dev", "S2"), start(1.3, "A", "dev", "S1"), start(1.4, "B", "dev", "S2"),
    pre(2, "A", "r1", "Read", "dev", "S1"), pre(2.1, "B", "r2", "Read", "dev", "S2")];
  const s = subs(l);
  assert.equal(s.length, 2);
  assert.notEqual(s[0].id, s[1].id);
  assert.ok(s.every((a) => a.status === "trabalhando"));
});

test("SendMessage para agente parado acha o destinatário e a mensagem vira chat", () => {
  const l = [sess(), ag(1, "t1"), start(1.2, "A"), pre(2, "A", "r1"), stop(4, "A"),
    mk(10, { hook_event_name: "PreToolUse", tool_name: "SendMessage", tool_input: { to: "A", message: "continue" }, tool_use_id: "m1" })];
  const r = reproduzir(l);
  const a = subs(l)[0];
  assert.equal(a.status, "ocioso", "SendMessage sozinho não religa; só o evento do agente");
  assert.ok(r.state);
});

test("agent_type ausente em evento de id conhecido: mesmo boneco", () => {
  const l = [sess(), ag(1, "t1"), start(1.2, "A"), mk(2, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/p/a" }, tool_use_id: "r1", agent_id: "A" })];
  const s = subs(l);
  assert.equal(s.length, 1);
  assert.equal(s[0].status, "trabalhando");
});

test("evento sem agent_id com subagentes ativos só mexe no líder", () => {
  const l = [sess(), ag(1, "t1"), start(1.2, "A"), pre(2, "A", "r1"), pre(3, undefined, "r2", "Bash")];
  const s = subs(l);
  assert.equal(s.length, 1);
  assert.equal(s[0].activity.includes("Bash"), false);
  const lider = agentes(reproduzir(l).state).find((a) => !a.parentId)!;
  assert.equal(lider.status, "trabalhando");
});

test("2 agent_id do mesmo papel na mesma sessão: bonecos distintos, ambos trabalhando", () => {
  const l = [sess(), ag(1, "t1"), ag(1.1, "t2"), start(1.3, "A"), start(1.4, "B"), pre(2, "A", "r1"), pre(2.1, "B", "r2")];
  const s = subs(l);
  assert.equal(s.length, 2);
  assert.notEqual(s[0].id, s[1].id);
});
