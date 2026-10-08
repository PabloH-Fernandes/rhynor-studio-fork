import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { DEFAULT_ROSTER } from "../shared/roster.ts";
import type { Agent } from "../shared/types.ts";
import { DEMO_END_AFTER_STOP_MS, cancelDemo, runDemo } from "./demo.ts";
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

test("Start → Stop → Start do mesmo agent_id volta o mesmo AGzinho; agent_id novo da sessão também (só volta pra mesa)", () => {
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
  // retomado: mesmo agent_id, mesmo boneco, trabalhando
  start("a1", "dev");
  assert.equal(subs().length, 1, "não pode nascer outro dev");
  assert.equal(byId("ag:dev")!.status, "trabalhando");
  assert.equal(byId("ag:dev")!.tasksDone, 1);
  stop("a1", "dev");
  assert.equal(byId("ag:dev")!.tasksDone, 2);

  // agent_id novo do mesmo papel na mesma sessão: a Bia de boa só volta pra mesa (V3 etapa 3)
  start("a2", "dev");
  assert.equal(byId("ag:dev")!.status, "pensando");
  assert.equal(byId("ag:dev-2"), undefined, "ninguém novo entra pela porta");
  hook("PreToolUse", { agent_id: "a2", agent_type: "dev", tool_name: "Read", tool_input: { file_path: "src/a.ts" } });
  assert.equal(byId("ag:dev")!.status, "trabalhando");

  // com a Bia ocupada pelo a2, o 3º vai pra variação
  start("a3", "dev");
  assert.equal(byId("ag:dev-2")?.name, "Yasmin Okada");
  assert.equal(subs().length, 2);
  // e o a1 perdeu o boneco: se voltar, não divide a Bia com o a2 (vai para um visitante extra)
  const biaAntes = { ...byId("ag:dev")! };
  hook("PreToolUse", { agent_id: "a1", agent_type: "dev", tool_name: "Read", tool_input: { file_path: "src/b.ts" } });
  assert.deepEqual(byId("ag:dev"), biaAntes, "evento do a1 não mexe na Bia do a2");
  assert.equal(byId("ag:extra:a1")?.status, "trabalhando", "o a1 de volta ganha outro boneco");
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
  // visitante não fica de boa: a Sofia sai andando e some depois da animação
  stop("p1", "Plan");
  assert.equal(byId("ag:curinga")?.status, "saindo");
  advance(7000);
  assert.equal(byId("ag:curinga"), undefined);

  start("g1", "general-purpose");
  assert.equal(byId("ag:general-purpose")?.name, "Jorge Batista");

  // Iara e Jorge com agent_id ativo; a Sofia já saiu e está livre de novo
  start("x1", "superpowers:code-reviewer");
  assert.equal(byId("ag:curinga")?.status, "chegando", "o tipo desconhecido usa a Sofia livre");
  assert.equal(subs().length, 3);
});

test("visitante (Iara, Jorge, Sofia) sai andando ao SubagentStop; nunca fica de boa", () => {
  start("e1", "Explore");
  start("g1", "general-purpose");
  stop("e1", "Explore");
  stop("g1", "general-purpose");
  assert.equal(byId("ag:explore")?.status, "saindo");
  assert.equal(byId("ag:general-purpose")?.status, "saindo");
  assert.ok(![...agents()].some((a) => a.parentId && a.status === "ocioso"), "nenhum visitante de boa");
  advance(7000);
  assert.equal(subs().length, 0);
});

test("visitante sem SubagentStop sai sozinho após 3 min sem evento; cada evento zera a contagem", () => {
  start("e1", "Explore");
  advance(2 * MIN);
  hook("PreToolUse", { agent_id: "e1", agent_type: "Explore", tool_name: "Read", tool_input: { file_path: "a.ts" } });
  advance(2 * MIN + 59_000);
  assert.equal(byId("ag:explore")?.status, "trabalhando", "2min59 depois do último evento ainda fica");
  advance(2000);
  assert.equal(byId("ag:explore")?.status, "saindo");
  assert.equal(byId("ag:explore")?.activity, "Saiu (sem sinal)");
  advance(7000);
  assert.equal(byId("ag:explore"), undefined);
});

test("visitante esperando você nunca expira; depois que responde, volta a valer o limite", () => {
  start("e1", "Explore");
  hook("PermissionRequest", { agent_id: "e1", agent_type: "Explore", tool_name: "Bash", tool_input: { command: "ls" } });
  advance(20 * MIN);
  state.sweep();
  assert.equal(byId("ag:explore")?.status, "esperando");
  hook("PreToolUse", { agent_id: "e1", agent_type: "Explore", tool_name: "Read", tool_input: { file_path: "a.ts" } });
  advance(3 * MIN + 1000);
  assert.equal(byId("ag:explore")?.status, "saindo");
});

test("sweep() também tira o visitante parado (relógio trocado, sem timers)", () => {
  start("e1", "Explore");
  t += 3 * MIN + 1;
  state.sweep();
  assert.equal(byId("ag:explore")?.status, "saindo");
});

/** os 3 convidados ocupados + um tipo desconhecido: o 4º vira visitante extra (ag:extra:<id>) */
function encherVisitantes() {
  start("e1", "Explore");
  start("g1", "general-purpose");
  start("p1", "Plan");
  start("x1", "superpowers:code-reviewer");
}

test("evento tardio de visitante que saiu não recria o ag:extra; só um SubagentStart reabre", () => {
  encherVisitantes();
  assert.ok(byId("ag:extra:x1"));
  stop("x1", "superpowers:code-reviewer");
  // dentro da animação de saída: não cancela a saída
  hook("PreToolUse", { agent_id: "x1", tool_name: "Read", tool_input: { file_path: "a.ts" } });
  assert.equal(byId("ag:extra:x1")?.status, "saindo");
  advance(7000);
  assert.equal(byId("ag:extra:x1"), undefined);
  for (const ev of ["PreToolUse", "PostToolUse", "PermissionRequest", "Notification"]) {
    hook(ev, { agent_id: "x1", agent_type: "superpowers:code-reviewer", tool_name: "Read", tool_input: { file_path: "a.ts" }, message: "oi", notification_type: "agent_needs_input" });
  }
  hook("SubagentStop", { agent_id: "x1" });
  assert.equal(byId("ag:extra:x1"), undefined, "evento tardio não reencarna o visitante");
  // passado o período de retirada, volta a valer a regra comum
  advance(60_000);
  start("x1", "superpowers:code-reviewer");
  assert.equal(byId("ag:extra:x1")?.status, "chegando", "SubagentStart explícito reabre");
});

test("SubagentStart do mesmo id logo depois de sair (ainda retirado) reabre o visitante", () => {
  encherVisitantes();
  stop("x1", "superpowers:code-reviewer");
  advance(7000);
  assert.equal(byId("ag:extra:x1"), undefined);
  start("x1", "superpowers:code-reviewer");
  assert.ok(byId("ag:extra:x1"));
  assert.notEqual(byId("ag:extra:x1")?.status, "saindo");
});

test("no máximo 3 visitantes na tela: o 4º fica como excedente e entra quando um dos 3 sai", () => {
  const avisos: Agent[] = [];
  state.subscribe((m) => {
    if (m.type === "agent") avisos.push({ ...m.agent });
  });
  encherVisitantes();
  assert.deepEqual(
    subs().map((a) => [a.id, !!a.excedente]),
    [["ag:explore", false], ["ag:general-purpose", false], ["ag:curinga", false], ["ag:extra:x1", true]],
  );
  assert.equal(avisos.find((a) => a.id === "ag:extra:x1")?.excedente, true, "já nasce marcado nos avisos às telas");
  stop("e1", "Explore");
  // a Iara ainda anda até a porta e ocupa o lugar
  assert.equal(byId("ag:extra:x1")?.excedente, true);
  advance(7000);
  assert.equal(byId("ag:explore"), undefined);
  assert.equal(byId("ag:extra:x1")?.excedente, undefined, "o 4º entra na tela quando a Iara sai");
  assert.equal(subs().filter((a) => !a.excedente).length, 3);
});

test("visitante não conta na fase do quadro: só visitantes trabalhando = ninguém; com um dev, a fase é a dele", () => {
  start("e1", "Explore");
  hook("PreToolUse", { agent_id: "e1", agent_type: "Explore", tool_name: "Read", tool_input: { file_path: "a.ts" } });
  hook("Stop"); // o líder também não conta: sobra só o visitante trabalhando
  assert.equal(state.getProgress().fonte, "nada");
  start("d1", "dev");
  hook("PreToolUse", { agent_id: "d1", agent_type: "dev", tool_name: "Edit", tool_input: { file_path: "a.ts" } });
  assert.equal(state.getProgress().titulo, "Construção");
  stop("d1", "dev");
  assert.equal(byId("ag:dev")?.status, "ocioso", "o time continua de boa");
});

test("visitantes não são gravados nem restaurados; o time sim", () => {
  hook("SessionStart");
  start("d1", "dev");
  start("e1", "Explore");
  encherVisitantes();
  const salvo = state.serializar();
  assert.ok(salvo.agents.some((a) => a.id === "ag:dev"));
  assert.deepEqual(salvo.agents.filter((a) => a.parentId && a.id !== "ag:dev").map((a) => a.id), []);
  assert.ok(![...salvo.aliases, ...salvo.bindings].some(([, v]) => JSON.stringify(v).includes("extra") || JSON.stringify(v).includes("explore")));
  const outro = new OfficeState({ now: () => t, sweepEveryMs: 0 });
  outro.restaurar(JSON.parse(JSON.stringify(salvo)));
  const snap = outro.snapshot();
  const ids = snap.type === "snapshot" ? snap.agents.map((a) => a.id) : [];
  assert.ok(ids.includes("ag:dev"));
  assert.ok(!ids.some((id) => id === "ag:explore" || id.startsWith("ag:extra:") || id === "ag:curinga"));
});

test("restaurar ignora visitante mesmo que o arquivo tenha um", () => {
  hook("SessionStart");
  start("e1", "Explore");
  const salvo = JSON.parse(JSON.stringify(state.serializar()));
  const iara = { ...structuredClone(byId("ag:explore")!) };
  salvo.agents.push(iara);
  const outro = new OfficeState({ now: () => t, sweepEveryMs: 0 });
  outro.restaurar(salvo);
  const snap = outro.snapshot();
  assert.ok(snap.type === "snapshot" && !snap.agents.some((a) => a.id === "ag:explore"));
});

test("bug 2: agent_id que já entregou, sem agent_type e 3 min depois, é a Bia (não a Sofia); outro dev da sessão também volta pra Bia", () => {
  start("a1", "dev");
  hook("PreToolUse", { agent_id: "a1", agent_type: "dev", tool_name: "Read", tool_input: { file_path: "src/a.ts" } });
  stop("a1", "dev");
  advance(3 * MIN);
  hook("PreToolUse", { agent_id: "a1", tool_name: "Read", tool_input: { file_path: "src/b.ts" } });
  assert.equal(byId("ag:dev")!.status, "trabalhando");
  assert.equal(byId("ag:curinga"), undefined, "o curinga não pega o trabalho da Bia");
  stop("a1", "dev");

  // outro agent_id sem tipo não leva a Bia de boa (não é dev); um dev novo da sessão só a leva de volta pra mesa
  const bia = { ...byId("ag:dev")! };
  hook("PreToolUse", { agent_id: "x1", tool_name: "Grep", tool_input: { pattern: "y" } });
  assert.deepEqual(byId("ag:dev"), bia);
  start("a2", "dev");
  assert.equal(byId("ag:dev")?.status, "pensando");
  assert.equal(byId("ag:dev-2"), undefined);
});

test("evento depois do SubagentStop (mesmo após 2+ min) volta pro mesmo boneco, sem criar ninguém", () => {
  start("a1", "testador");
  stop("a1", "testador");
  advance(3 * MIN);
  const before = agents().length;
  hook("PreToolUse", { agent_id: "a1", agent_type: "testador", tool_name: "Bash", tool_input: { command: "ls" } });
  assert.equal(byId("ag:testador")!.status, "trabalhando");
  hook("PostToolUse", { agent_id: "a1", agent_type: "testador", tool_name: "Bash" });
  assert.equal(byId("ag:testador")!.status, "trabalhando", "PostToolUse nunca deixa ocioso");
  hook("PermissionRequest", { agent_id: "a1", agent_type: "testador", tool_name: "Bash" });
  assert.equal(agents().length, before);
  assert.equal(byId("ag:testador")!.status, "esperando");
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

test("simulação completa: ficam depois de entregar, 2ª chamada, 2 devs, '!', quadro e SessionEnd", () => {
  const { durationMs } = runDemo(state);
  // anda de 500 em 500 ms anotando o que aconteceu (o roteiro pode mudar de tempos)
  let laranja = false;
  let devsJuntos = false;
  const titulos: string[] = [];
  /** id visual do pesquisador quando ele entregou a 1ª vez */
  let pesquisadorId: string | undefined;
  let chamadoNoDescanso = false;
  let passou = 0;
  // até o Stop do líder (o SessionEnd vem DEMO_END_AFTER_STOP_MS depois)
  while (passou < durationMs - DEMO_END_AFTER_STOP_MS) {
    advance(500);
    passou += 500;
    const now = agents();
    laranja ||= now.some((a) => a.status === "esperando");
    const trabalhando = (id: string) => {
      const a = now.find((x) => x.id === id);
      return !!a && a.status !== "ocioso" && a.status !== "saindo";
    };
    devsJuntos ||= trabalhando("ag:dev") && trabalhando("ag:dev-2");
    const pesq = now.find((a) => a.role === "pesquisador");
    if (pesq?.status === "ocioso" && pesq.tasksDone === 1) pesquisadorId ??= pesq.id;
    if (pesquisadorId && pesq?.id === pesquisadorId && pesq.tasksDone === 1 && trabalhando(pesq.id)) chamadoNoDescanso = true;
    const p = state.getProgress();
    const titulo = p.fonte === "tarefas" ? (p.concluidas === p.total ? `concluíram ${p.total}` : `etapa ${p.etapa}/${p.total}`) : p.titulo;
    if (titulo && titulos.at(-1) !== titulo) titulos.push(titulo);
  }
  assert.ok(laranja, "o PermissionRequest do testador devia acender o laranja");
  assert.ok(devsJuntos, "dev (Bia) e dev-2 (Yasmin) deviam trabalhar ao mesmo tempo");
  assert.ok(chamadoNoDescanso, "o pesquisador de boa devia ser chamado de novo (mesmo id visual)");
  // o quadro passa por Planejamento, pelas etapas da lista e chega a "concluíram"
  assert.ok(titulos.includes("Planejamento"), titulos.join(" → "));
  for (const etapa of ["etapa 1/6", "etapa 2/6", "etapa 4/6", "etapa 6/6", "concluíram 6"]) {
    assert.ok(titulos.includes(etapa), `${etapa} faltou: ${titulos.join(" → ")}`);
  }
  assert.ok(titulos.indexOf("Planejamento") < titulos.indexOf("etapa 1/6"));
  assert.equal(titulos.at(-1), "concluíram 6");

  // depois do Stop do líder: todo mundo de boa, ninguém saiu
  advance(1000);
  const team = subs();
  assert.deepEqual(team.map((a) => a.id).sort(), ["ag:dev", "ag:dev-2", "ag:documentador", "ag:pesquisador", "ag:planejador", "ag:revisor", "ag:testador"]);
  assert.ok(team.every((a) => a.status === "ocioso"), team.map((a) => `${a.id}:${a.status}`).join(" "));
  assert.equal(byId("ag:pesquisador")!.id, pesquisadorId);
  assert.equal(byId("ag:pesquisador")!.tasksDone, 2, "o pesquisador entregou 2 vezes");
  assert.ok(team.filter((a) => a.id !== "ag:pesquisador").every((a) => a.tasksDone === 1));
  const lider = agents().find((a) => !a.parentId)!;
  assert.equal(lider.status, "ocioso");
  assert.equal(lider.activity, "Terminou, esperando você");

  // SessionEnd: todos vão até a porta e saem
  advance(DEMO_END_AFTER_STOP_MS - 1000 - 500);
  assert.equal(agents().length, 8, "ainda de boa antes do SessionEnd");
  advance(1000);
  assert.ok(agents().every((a) => a.status === "saindo"));
  advance(7000);
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

const spawnDev = (tool_use_id: string, description: string) =>
  hook("PreToolUse", { tool_name: "Agent", tool_use_id, tool_input: { subagent_type: "dev", description } });

test("2 devs seguidos (Pre → Start → Pre → Start): cada um com a sua descrição", () => {
  spawnDev("tA", "A");
  advance(300);
  start("a1", "dev");
  advance(1000);
  spawnDev("tB", "B");
  advance(300);
  start("a2", "dev");
  assert.equal(byId("ag:dev")!.activity, "A");
  assert.equal(byId("ag:dev-2")!.activity, "B");
  advance(2000); // nenhum fallback sobrando
  assert.equal(subs().length, 2);
});

test("2 devs com os Pre antes dos Start: casam na ordem (FIFO)", () => {
  spawnDev("tA", "A");
  spawnDev("tB", "B");
  advance(200);
  start("a1", "dev");
  start("a2", "dev");
  assert.equal(byId("ag:dev")!.activity, "A");
  assert.equal(byId("ag:dev-2")!.activity, "B");
  advance(2000);
  assert.equal(subs().length, 2);
});

test("SubagentStart antes do PreToolUse Agent: um dev só, com a descrição", () => {
  start("a1", "dev");
  advance(300);
  spawnDev("tA", "A");
  assert.equal(subs().length, 1);
  assert.equal(byId("ag:dev")!.activity, "A");
  advance(2000);
  assert.equal(subs().length, 1);
});

test("evento do subagente antes do Start, Start nunca chega: o fallback não duplica", () => {
  spawnDev("tA", "A");
  advance(500);
  hook("PreToolUse", { agent_id: "a1", agent_type: "dev", tool_name: "Read" });
  advance(2000);
  assert.equal(subs().length, 1);
  assert.equal(byId("ag:dev")!.activity, "A");
});

test("evento do subagente antes do Start, depois um 2º dev: cada um com a sua descrição", () => {
  spawnDev("tA", "A");
  advance(200);
  hook("PreToolUse", { agent_id: "a1", agent_type: "dev", tool_name: "Read" });
  advance(200);
  start("a1", "dev");
  advance(500);
  spawnDev("tB", "B");
  advance(300);
  start("a2", "dev");
  assert.equal(byId("ag:dev")!.activity, "A");
  assert.equal(byId("ag:dev-2")!.activity, "B");
  advance(2000);
  assert.equal(subs().length, 2);
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
