import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { DEFAULT_ROSTER } from "../shared/roster.ts";
import type { Agent } from "../shared/types.ts";
import { cancelDemo, runDemo } from "./demo.ts";
import { OfficeState, type HookInput } from "./state.ts";

const S1 = "sessao-1";
const S2 = "sessao-2";
const MIN = 60_000;

let t: number;
let state: OfficeState;

beforeEach(() => {
  // timers falsos: o fallback do spawn (1,5 s), a saída pela porta (7 s) e a simulação
  mock.timers.enable({ apis: ["setTimeout"] });
  t = Date.parse("2026-10-03T10:00:00");
  state = new OfficeState({ now: () => t, sweepEveryMs: 0 });
});

afterEach(() => {
  cancelDemo();
  mock.timers.reset();
});

/**
 * Avança o relógio do estado e os timers juntos, em passos de até 1 s: o mock do Node
 * não dispara, no mesmo tick, um timer agendado por outro timer.
 */
function advance(ms: number) {
  while (ms > 0) {
    const step = Math.min(ms, 1000);
    t += step;
    mock.timers.tick(step);
    ms -= step;
  }
}

function hook(ev: string, extra: Partial<HookInput> = {}, session = S1) {
  state.handleHook({ hook_event_name: ev, session_id: session, cwd: "/home/pablo/portal", ...extra });
}

function agents(): Agent[] {
  const snap = state.snapshot();
  assert.equal(snap.type, "snapshot");
  return snap.type === "snapshot" ? snap.agents : [];
}

const byId = (id: string) => agents().find((a) => a.id === id);
const subs = () => agents().filter((a) => a.parentId);
const start = (agent_id: string, agent_type: string, session = S1) => hook("SubagentStart", { agent_id, agent_type }, session);
const stop = (agent_id: string, agent_type: string, session = S1) => hook("SubagentStop", { agent_id, agent_type }, session);

test("Start → Stop → Start do mesmo papel volta o mesmo AGzinho, com 1 entrega", () => {
  start("a1", "dev");
  const first = byId("ag:dev");
  assert.ok(first, "devia criar ag:dev");
  assert.equal(first.name, "Beatriz Lima");

  stop("a1", "dev");
  const idle = byId("ag:dev")!;
  assert.equal(idle.status, "ocioso", "depois do Stop fica de boa, não sai");
  assert.equal(idle.activity, "De boa");
  assert.equal(idle.tasksDone, 1);

  advance(5000);
  start("a2", "dev");
  const again = byId("ag:dev")!;
  assert.equal(subs().length, 1, "não pode nascer outro dev");
  assert.equal(again.name, "Beatriz Lima");
  assert.equal(again.tasksDone, 1);
  assert.equal(again.status, "pensando");
  assert.equal(again.boundAt, t);

  // os eventos do novo agent_id caem nela
  hook("PreToolUse", { agent_id: "a2", agent_type: "dev", tool_name: "Read", tool_input: { file_path: "src/a.ts" } });
  assert.equal(byId("ag:dev")!.status, "trabalhando");
});

test("dois devs ao mesmo tempo viram ag:dev e ag:dev-2", () => {
  start("a1", "dev");
  start("a2", "dev");
  assert.deepEqual(
    subs().map((a) => [a.id, a.name, a.role]),
    [
      ["ag:dev", "Beatriz Lima", "dev"],
      ["ag:dev-2", "Yasmin Okada", "dev"],
    ],
  );
});

test("convidados: Explore → Iara, Plan e tipo desconhecido → Sofia, general-purpose → Jorge", () => {
  start("e1", "Explore");
  assert.equal(byId("ag:explore")?.name, "Iara Campos");
  assert.equal(byId("ag:explore")?.role, "convidado");

  start("p1", "Plan");
  assert.equal(byId("ag:curinga")?.name, "Sofia Arruda");
  stop("p1", "Plan");

  start("x1", "superpowers:code-reviewer");
  assert.equal(byId("ag:curinga")?.status, "pensando", "o tipo desconhecido reaproveita a Sofia de boa");
  assert.equal(subs().length, 2);

  start("g1", "general-purpose");
  assert.equal(byId("ag:general-purpose")?.name, "Jorge Batista");
});

test("evento atrasado de um agent_id aposentado não cria ninguém", () => {
  start("a1", "testador");
  stop("a1", "testador");
  const before = agents().length;
  hook("PreToolUse", { agent_id: "a1", agent_type: "testador", tool_name: "Bash", tool_input: { command: "ls" } });
  hook("PostToolUse", { agent_id: "a1", agent_type: "testador", tool_name: "Bash" });
  hook("PermissionRequest", { agent_id: "a1", agent_type: "testador", tool_name: "Bash" });
  assert.equal(agents().length, before);
  assert.equal(byId("ag:testador")!.status, "ocioso");
});

test("líder criado por evento de subagente já aparece coordenando (não fica chegando)", () => {
  start("a1", "dev");
  const lead = byId(`s:${S1}`)!;
  assert.equal(lead.status, "pensando");
  assert.equal(lead.activity, "Coordenando o time");
});

test("SessionEnd tira todos da sessão e só dela", () => {
  hook("SessionStart");
  start("a1", "dev");
  start("a2", "revisor");
  stop("a2", "revisor");
  start("b1", "dev", S2); // 2ª sessão: dev-2
  hook("SessionEnd");
  for (const a of agents().filter((x) => x.sessionId === S1)) assert.equal(a.status, "saindo", a.id);
  assert.equal(byId("ag:dev-2")!.status, "chegando");
  advance(7000);
  assert.deepEqual(
    agents().map((a) => a.id),
    [`s:${S2}`, "ag:dev-2"],
  );
});

test("timeout da sessão: 30 min sem nenhum evento encerra a sessão inteira", () => {
  hook("SessionStart");
  start("a1", "dev");
  advance(29 * MIN);
  state.sweep();
  // sem evento próprio ele já passou de "chegando" pra "pensando" (ARRIVE_MS), mas continua lá
  assert.equal(byId("ag:dev")!.status, "pensando");
  advance(2 * MIN);
  state.sweep();
  assert.ok(agents().every((a) => a.status === "saindo"));
  assert.equal(byId(`s:${S1}`)!.activity, "Saiu (sessão sem sinal)");
});

test("subagente sem evento nenhum não fica 'chegando' pra sempre: vira 'pensando' em 12 s", () => {
  hook("SessionStart");
  start("a1", "dev");
  advance(11_000);
  assert.equal(byId("ag:dev")!.status, "chegando");
  advance(1000);
  assert.equal(byId("ag:dev")!.status, "pensando");
  // quem já teve evento não é mexido pelo timer
  start("a2", "revisor");
  hook("PreToolUse", { agent_id: "a2", agent_type: "revisor", tool_name: "Read", tool_input: { file_path: "a.ts" } });
  advance(12_000);
  assert.equal(byId("ag:revisor")!.status, "trabalhando");
});

test("timeout da sessão: ferramenta sem Post segura até 4x o limite", () => {
  hook("SessionStart");
  start("a1", "dev");
  hook("PreToolUse", { agent_id: "a1", agent_type: "dev", tool_name: "Bash", tool_input: { command: "npm test" } });
  advance(31 * MIN);
  state.sweep();
  assert.equal(byId("ag:dev")!.status, "trabalhando", "ainda não pode encerrar em 31 min");
  advance(90 * MIN);
  state.sweep();
  assert.equal(byId("ag:dev")!.status, "saindo");
});

test("o timeout vem do construtor e cai no padrão quando é inválido", () => {
  assert.equal(new OfficeState({ sessionTimeoutMs: 5 * MIN, sweepEveryMs: 0 }).config.sessionTimeoutMs, 5 * MIN);
  assert.equal(new OfficeState({ sessionTimeoutMs: -1, sweepEveryMs: 0 }).config.sessionTimeoutMs, 30 * MIN);
  assert.equal(new OfficeState({ sessionTimeoutMs: Number.NaN, sweepEveryMs: 0 }).config.sessionTimeoutMs, 30 * MIN);
  const snap = state.snapshot();
  assert.ok(snap.type === "snapshot" && snap.config.sessionTimeoutMs === 30 * MIN);
});

test("Notification: auth_success não acende o laranja; permission_prompt acende", () => {
  hook("UserPromptSubmit", { prompt: "oi" });
  hook("Notification", { notification_type: "auth_success", message: "Login ok" });
  assert.equal(byId(`s:${S1}`)!.status, "pensando");
  hook("Notification", { notification_type: "elicitation_complete", message: "Pronto" });
  assert.equal(byId(`s:${S1}`)!.status, "pensando");
  hook("Notification", { notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" });
  assert.equal(byId(`s:${S1}`)!.status, "esperando");
  hook("Notification", { notification_type: "idle_prompt", message: "Claude is waiting for your input" });
  assert.equal(byId(`s:${S1}`)!.status, "ocioso");
});

test("o líder de uma 2ª sessão vira convidado", () => {
  hook("SessionStart");
  hook("SessionStart", {}, S2);
  const l1 = byId(`s:${S1}`)!;
  const l2 = byId(`s:${S2}`)!;
  assert.equal(l1.name, "Augusto Vilela");
  assert.equal(l1.agzinho, "lider");
  assert.equal(l2.role, "convidado");
  assert.equal(l2.agzinho, "explore");
  assert.equal(l2.name, "Iara Campos");
  // a Iara está ocupada como líder: o Explore da sessão 1 vai para o próximo convidado
  start("e1", "Explore");
  assert.equal(subs()[0].id, "ag:curinga");
});

test("sem fallback de SubagentStart: o spawn pelo tool_use_id também fica de boa no fim", () => {
  hook("PreToolUse", { tool_name: "Agent", tool_use_id: "tu1", tool_input: { subagent_type: "documentador", description: "Atualizar o README" } });
  advance(1500);
  const doc = byId("ag:documentador")!;
  assert.equal(doc.activity, "Atualizar o README");
  hook("PostToolUse", { tool_name: "Agent", tool_use_id: "tu1" });
  assert.equal(byId("ag:documentador")!.status, "ocioso");
  assert.equal(byId("ag:documentador")!.tasksDone, 1);
});

test("um AGzinho de boa emprestado a outra sessão sai com a sessão nova", () => {
  start("a1", "revisor");
  stop("a1", "revisor");
  start("b1", "revisor", S2);
  assert.equal(byId("ag:revisor")!.sessionId, S2);
  hook("SessionEnd");
  assert.equal(byId("ag:revisor")!.status, "pensando");
  hook("SessionEnd", {}, S2);
  assert.equal(byId("ag:revisor")!.status, "saindo");
});

test("cancelDemo + reset no meio da simulação: ninguém reaparece depois", () => {
  runDemo(state);
  advance(12_000);
  assert.ok(agents().length > 0, "a simulação devia ter gente no escritório");
  cancelDemo();
  state.reset();
  assert.equal(agents().length, 0);
  for (let i = 0; i < 20; i++) advance(10_000); // passa do fim da simulação (~85 s + 20 s)
  assert.equal(agents().length, 0);
});

test("simulação completa: o '!' acontece, os subagentes ficam de boa e o SessionEnd leva todos", () => {
  const { durationMs } = runDemo(state);
  advance(33_600);
  assert.ok(
    agents().some((a) => a.status === "esperando"),
    "o PermissionRequest do testador (~33,5 s) devia acender o laranja",
  );
  advance(durationMs - 33_600 + 1000);
  const team = subs();
  assert.equal(team.length, 6);
  assert.ok(team.every((a) => a.status === "ocioso" && a.tasksDone === 1));
  advance(20_000 + 7000);
  assert.equal(agents().length, 0);
});

test("sessão com alguém esperando você não cai por timeout", () => {
  hook("SessionStart");
  hook("PermissionRequest", { tool_name: "Bash", tool_input: { command: "rm -rf build" } });
  advance(31 * MIN);
  state.sweep();
  assert.equal(byId(`s:${S1}`)!.status, "esperando");
  advance(10 * 60 * MIN);
  state.sweep();
  assert.equal(byId(`s:${S1}`)!.status, "esperando");
});

test("visitante extra sai ao entregar: rodadas de 3 devs não acumulam extras", () => {
  for (let round = 0; round < 3; round++) {
    const ids = [1, 2, 3].map((i) => `r${round}-${i}`);
    for (const id of ids) start(id, "dev");
    assert.deepEqual(subs().filter((a) => a.status !== "saindo").map((a) => a.id), ["ag:dev", "ag:dev-2", `ag:extra:${ids[2]}`]);
    for (const id of ids) stop(id, "dev");
    assert.equal(byId(`ag:extra:${ids[2]}`)!.status, "saindo");
    advance(7000);
    assert.equal(agents().filter((a) => a.id.startsWith("ag:extra:")).length, 0);
  }
});

test("sessão real que chega depois toma o Guto da simulação (sem dois Gutos)", () => {
  hook("SessionStart", {}, "demo-abc");
  assert.equal(byId("s:demo-abc")!.agzinho, "lider");
  hook("SessionStart");
  assert.equal(byId(`s:${S1}`)!.name, "Augusto Vilela");
  const demo = byId("s:demo-abc")!;
  assert.equal(demo.role, "convidado");
  assert.equal(demo.agzinho, "explore");
  assert.equal(agents().filter((a) => a.agzinho === "lider").length, 1);
});

test("simulação que começa com sessão real na tela usa convidado e não pega AGzinho real de boa", () => {
  hook("SessionStart");
  start("a1", "dev");
  stop("a1", "dev"); // Bia de boa na sessão real
  hook("SessionStart", {}, "demo-xyz");
  assert.equal(byId("s:demo-xyz")!.role, "convidado");
  assert.equal(byId(`s:${S1}`)!.agzinho, "lider");
  start("d1", "dev", "demo-xyz");
  assert.equal(byId("ag:dev")!.sessionId, S1, "a Bia continua na sessão real");
  assert.equal(byId("ag:dev-2")!.sessionId, "demo-xyz");
  // entre sessões reais o empréstimo continua valendo
  start("b1", "dev", S2);
  assert.equal(byId("ag:dev")!.sessionId, S2);
});

test("evento atrasado depois do SessionEnd não recria o líder", () => {
  hook("SessionStart");
  hook("SessionEnd");
  advance(7000);
  hook("Stop");
  hook("Notification", { notification_type: "idle_prompt", message: "waiting" });
  assert.equal(byId(`s:${S1}`), undefined);
  hook("SessionStart"); // uma sessão retomada volta
  assert.ok(byId(`s:${S1}`));
});

test("SubagentStart depois do fallback reaproveita o mesmo agente (sem duplicar)", () => {
  hook("PreToolUse", { tool_name: "Agent", tool_use_id: "tu9", tool_input: { subagent_type: "revisor", description: "Revisar" } });
  advance(1500);
  assert.equal(byId("ag:revisor")!.status, "chegando");
  start("r1", "revisor");
  assert.equal(subs().length, 1);
  hook("PreToolUse", { agent_id: "r1", agent_type: "revisor", tool_name: "Read", tool_input: { file_path: "a.ts" } });
  assert.equal(byId("ag:revisor")!.status, "trabalhando");
  stop("r1", "revisor");
  hook("PostToolUse", { tool_name: "Agent", tool_use_id: "tu9" }); // não conta de novo
  assert.equal(byId("ag:revisor")!.tasksDone, 1);
});

test("PreToolUse do subagente antes do SubagentStart: o Start não duplica", () => {
  hook("PreToolUse", { tool_name: "Agent", tool_use_id: "tu5", tool_input: { subagent_type: "testador", description: "Testar o form" } });
  hook("PreToolUse", { agent_id: "x1", agent_type: "testador", tool_name: "Bash", tool_input: { command: "npm test" } });
  start("x1", "testador");
  assert.equal(subs().length, 1);
  assert.equal(byId("ag:testador")!.activity, "Testar o form");
  advance(2000); // o fallback já foi consumido pelo Start
  assert.equal(subs().length, 1);
});

test("Notification sem notification_type: idle, permissão e aviso comum", () => {
  hook("UserPromptSubmit", { prompt: "oi" });
  hook("Notification", { message: "Claude is waiting for your input" });
  assert.equal(byId(`s:${S1}`)!.status, "ocioso");
  hook("Notification", { message: "Claude needs your permission to use Bash" });
  assert.equal(byId(`s:${S1}`)!.status, "esperando");
  hook("UserPromptSubmit", { prompt: "ok" });
  hook("Notification", { message: "Login concluído" });
  assert.equal(byId(`s:${S1}`)!.status, "pensando");
});

test("setRoster renomeia quem está na tela", () => {
  hook("SessionStart");
  start("a1", "dev");
  const roster = structuredClone(DEFAULT_ROSTER);
  roster.agzinhos.find((a) => a.key === "dev")!.nome = "Bia Nova";
  roster.agzinhos.find((a) => a.key === "lider")!.nome = "Guto Novo";
  state.setRoster(roster);
  assert.equal(byId("ag:dev")!.name, "Bia Nova");
  assert.equal(byId(`s:${S1}`)!.name, "Guto Novo");
});

test("sessão encerrada por timeout não é aposentada: um evento novo traz o líder de volta", () => {
  hook("SessionStart");
  advance(31 * MIN);
  state.sweep();
  assert.equal(byId(`s:${S1}`)!.status, "saindo");
  advance(7000);
  hook("UserPromptSubmit", { prompt: "voltei" });
  assert.equal(byId(`s:${S1}`)?.status, "pensando");
});
