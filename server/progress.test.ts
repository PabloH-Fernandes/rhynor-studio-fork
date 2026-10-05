import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { Agent, Progress, ServerMessage } from "../shared/types.ts";
import { DONE_HOLD_MS, LISTA_PREFERIDA_MS, PENDENTE_MS, ProgressTracker, type ProgressHook } from "./progress.ts";
import { OfficeState, type HookInput } from "./state.ts";

// eventos reais capturados com os hooks (caminhos e textos trocados por genéricos)
const fixture = (name: string): ProgressHook[] => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const TASKS = fixture("hooks-taskcreate-update.json");
const TODOS = fixture("hooks-todowrite.json");

let t = 1_000_000;

function agent(sessionId: string, role: string, status: Agent["status"], updatedAt = t, parentId?: string): Agent {
  return {
    id: `${role}-${sessionId}`,
    sessionId,
    parentId,
    role,
    name: role,
    status,
    activity: "",
    project: "projeto",
    startedAt: 0,
    updatedAt,
    boundAt: 0,
    tasksDone: 0,
    tasksDay: "2026-10-04",
  };
}

const feed = (tr: ProgressHook[], p: ProgressTracker, agents: Agent[] = []) => {
  for (const ev of tr) p.handle(ev, (t += 10));
  return p.compute(agents, t).progress;
};

const pick = (p: Progress) => ({ fonte: p.fonte, etapa: p.etapa, total: p.total, concluidas: p.concluidas, titulo: p.titulo });

test("fixture real TaskCreate/TaskUpdate: 3 criadas, 1 concluída, 2 em andamento, 3 apagada → Etapa 2 de 2", () => {
  const p = new ProgressTracker();
  // depois dos 3 TaskCreate (Pre + Post): 3 pendentes, etapa 1
  assert.deepEqual(pick(feed(TASKS.slice(0, 6), p)), { fonte: "tarefas", etapa: 1, total: 3, concluidas: 0, titulo: "Etapa um" });
  assert.deepEqual(pick(feed(TASKS.slice(6), p)), { fonte: "tarefas", etapa: 2, total: 2, concluidas: 1, titulo: "Etapa dois" });
  assert.equal(p.compute([], t).progress.sessionId, "sessao-tasks");
});

test("TaskCreate conta já no Pre (pendente pelo tool_use_id) e o id chega no Post", () => {
  const p = new ProgressTracker();
  assert.equal(feed([TASKS[0]], p).total, 1);
  assert.equal(feed([TASKS[1]], p).total, 1, "o Post não duplica a pendente");
});

test("fixture real TodoWrite: a lista inteira substitui a anterior e o título usa activeForm", () => {
  const p = new ProgressTracker();
  assert.deepEqual(pick(feed(TODOS.slice(0, 2), p)), { fonte: "tarefas", etapa: 1, total: 2, concluidas: 0, titulo: "Fazendo etapa um" });
  assert.deepEqual(pick(feed(TODOS.slice(2), p)), { fonte: "tarefas", etapa: 2, total: 2, concluidas: 1, titulo: "Fazendo etapa dois" });
});

test("sem in_progress: etapa = concluídas + 1 e o título é a próxima pendente", () => {
  const p = new ProgressTracker();
  const todos = [
    { content: "A", status: "completed" },
    { content: "B", status: "pending" },
    { content: "C", status: "pending" },
  ];
  const pr = feed([{ hook_event_name: "PreToolUse", session_id: "s", tool_name: "TodoWrite", tool_input: { todos } }], p);
  assert.deepEqual(pick(pr), { fonte: "tarefas", etapa: 2, total: 3, concluidas: 1, titulo: "B" });
});

test("deleted não conta no total; TaskUpdate com id/task_id e active_form também valem", () => {
  const p = new ProgressTracker();
  const create = (n: string) => [
    { hook_event_name: "PreToolUse", session_id: "s", tool_name: "TaskCreate", tool_input: { subject: `T${n}` }, tool_use_id: `u${n}` },
    { hook_event_name: "PostToolUse", session_id: "s", tool_name: "TaskCreate", tool_input: { subject: `T${n}` }, tool_use_id: `u${n}`, tool_response: { task: { id: n, subject: `T${n}` } } },
  ];
  feed([...create("1"), ...create("2"), ...create("3")], p);
  const pr = feed(
    [
      { hook_event_name: "PostToolUse", session_id: "s", tool_name: "TaskUpdate", tool_input: { id: "2", status: "deleted" }, tool_response: { success: true } },
      { hook_event_name: "PostToolUse", session_id: "s", tool_name: "TaskUpdate", tool_input: { task_id: "3", status: "in_progress", active_form: "Fazendo T3" }, tool_response: { success: true } },
    ],
    p,
  );
  assert.deepEqual(pick(pr), { fonte: "tarefas", etapa: 2, total: 2, concluidas: 0, titulo: "Fazendo T3" });
});

test("fora de ordem: TaskUpdate antes do Post do TaskCreate mantém o status e ganha o assunto depois", () => {
  const p = new ProgressTracker();
  // o Pre de um update de id desconhecido não cria nada (pode falhar)
  feed([{ hook_event_name: "PreToolUse", session_id: "s", tool_name: "TaskUpdate", tool_input: { taskId: "1", status: "in_progress" } }], p);
  assert.equal(p.compute([], t).progress.fonte, "nada");
  // o Post com sucesso cria; o TaskCreate chega depois e completa o assunto
  feed([{ hook_event_name: "PostToolUse", session_id: "s", tool_name: "TaskUpdate", tool_input: { taskId: "1", status: "in_progress" }, tool_response: { success: true, taskId: "1" } }], p);
  const pr = feed(
    [{ hook_event_name: "PostToolUse", session_id: "s", tool_name: "TaskCreate", tool_input: { subject: "Montar a API", activeForm: "Montando a API" }, tool_use_id: "x", tool_response: { task: { id: "1" } } }],
    p,
  );
  assert.deepEqual(pick(pr), { fonte: "tarefas", etapa: 1, total: 1, concluidas: 0, titulo: "Montando a API" });
});

test("TaskCreate que falhou sai das pendentes; update com success:false é ignorado", () => {
  const p = new ProgressTracker();
  feed([{ hook_event_name: "PreToolUse", session_id: "s", tool_name: "TaskCreate", tool_input: { subject: "X" }, tool_use_id: "f" }], p);
  assert.equal(p.compute([], t).progress.total, 1);
  feed([{ hook_event_name: "PostToolUseFailure", session_id: "s", tool_name: "TaskCreate", tool_input: { subject: "X" }, tool_use_id: "f" }], p);
  assert.equal(p.compute([], t).progress.fonte, "nada");
  feed([{ hook_event_name: "PostToolUse", session_id: "s", tool_name: "TaskUpdate", tool_input: { taskId: "9", status: "completed" }, tool_response: { success: false } }], p);
  assert.equal(p.compute([], t).progress.fonte, "nada");
});

test("reserva por papel: sem lista, a fase vem do papel ativo mais recente (time antes do líder)", () => {
  const p = new ProgressTracker();
  const agents = [
    agent("s", "lider", "pensando", t + 50),
    agent("s", "planejador", "ocioso", t + 40, "lider"),
    agent("s", "dev", "trabalhando", t + 10, "lider"),
    agent("s", "testador", "pensando", t + 20, "lider"),
  ];
  assert.deepEqual(pick(p.compute(agents, t).progress), { fonte: "papel", etapa: 0, total: 0, concluidas: 0, titulo: "Testes" });
  // só o líder trabalhando: fase geral
  assert.equal(p.compute([agent("s", "lider", "trabalhando")], t).progress.titulo, "Ação");
});

test("nada: ninguém trabalhando → de boa", () => {
  const p = new ProgressTracker();
  assert.equal(p.compute([agent("s", "lider", "ocioso"), agent("s", "dev", "ocioso", t, "lider")], t).progress.fonte, "nada");
  assert.equal(p.compute([], t).progress.fonte, "nada");
});

test("lista 100% concluída: mostra N de N por DONE_HOLD_MS e depois volta ao de boa (ou à fase)", () => {
  const p = new ProgressTracker();
  const todos = [
    { content: "A", status: "completed" },
    { content: "B", status: "completed" },
  ];
  feed([{ hook_event_name: "PostToolUse", session_id: "s", tool_name: "TodoWrite", tool_input: { todos } }], p);
  const r = p.compute([agent("s", "lider", "ocioso")], t);
  assert.deepEqual(pick(r.progress), { fonte: "tarefas", etapa: 2, total: 2, concluidas: 2, titulo: "" });
  assert.equal(r.proximaMudanca, t + DONE_HOLD_MS);
  assert.equal(p.compute([agent("s", "lider", "ocioso")], t + DONE_HOLD_MS).progress.fonte, "nada");
  assert.equal(p.compute([agent("s", "lider", "trabalhando")], t + DONE_HOLD_MS).progress.titulo, "Ação");
});

test("duas sessões: vale a do evento mais recente; SessionEnd limpa só a dela", () => {
  const p = new ProgressTracker();
  feed(TASKS, p);
  feed(TODOS, p); // mais recente
  assert.equal(p.compute([], t).progress.sessionId, "sessao-todo");
  // um agente da outra sessão (que também tem lista) se mexendo depois puxa o quadro pra ela
  assert.equal(p.compute([agent("sessao-tasks", "lider", "trabalhando", t + 100)], t + 100).progress.sessionId, "sessao-tasks");
  p.endSession("sessao-todo");
  assert.equal(p.compute([], t).progress.sessionId, "sessao-tasks");
});

test("duas sessões: a com lista vence a que só tem gente trabalhando, até a lista ficar parada demais", () => {
  const p = new ProgressTracker();
  feed(TODOS, p);
  const outra = (at: number) => [agent("outra", "dev", "trabalhando", at, "lider")];
  assert.equal(p.compute(outra(t + 60_000), t + 60_000).progress.sessionId, "sessao-todo");
  assert.equal(p.compute(outra(t + LISTA_PREFERIDA_MS + 1000), t + LISTA_PREFERIDA_MS + 1000).progress.titulo, "Construção");
});

// helpers no formato real (Pre + Post) pra os testes abaixo
const S = "s";
const createPre = (id: string, subject: string, extra: Partial<ProgressHook> = {}): ProgressHook => ({
  hook_event_name: "PreToolUse",
  session_id: S,
  tool_name: "TaskCreate",
  tool_input: { subject, description: subject },
  tool_use_id: `c${id}`,
  ...extra,
});
const createPost = (id: string, subject: string, extra: Partial<ProgressHook> = {}): ProgressHook => ({
  ...createPre(id, subject, extra),
  hook_event_name: "PostToolUse",
  tool_response: { task: { id, subject } },
});
const update = (ev: string, id: string, status: string, extra: Partial<ProgressHook> = {}): ProgressHook => ({
  hook_event_name: ev,
  session_id: S,
  tool_name: "TaskUpdate",
  tool_input: { taskId: id, status },
  tool_use_id: `u${id}${status}`,
  ...(ev === "PostToolUse" ? { tool_response: { success: true, taskId: id } } : {}),
  ...extra,
});

test("TodoWrite com agent_id não mexe na lista (é a lista do subagente)", () => {
  const p = new ProgressTracker();
  feed(TODOS, p);
  const antes = pick(p.compute([], t).progress);
  const doSub: ProgressHook = {
    hook_event_name: "PostToolUse",
    session_id: "sessao-todo",
    agent_id: "sub-1",
    tool_name: "TodoWrite",
    tool_input: { todos: [{ content: "Coisa do dev", status: "in_progress" }] },
  };
  assert.equal(p.handle(doSub, (t += 10)), false);
  assert.deepEqual(pick(p.compute([], t).progress), antes);
});

test("TaskCreate/TaskUpdate de subagente valem na lista da sessão", () => {
  const p = new ProgressTracker();
  const pr = feed([createPre("1", "A"), createPost("1", "A"), update("PostToolUse", "1", "in_progress", { agent_id: "sub-1" })], p);
  assert.deepEqual([pr.fonte, pr.etapa, pr.total], ["tarefas", 1, 1]);
  assert.equal(feed([createPre("2", "B", { agent_id: "sub-1" }), createPost("2", "B", { agent_id: "sub-1" })], p).total, 2);
});

test("TaskCreate sem subject e sem description é ignorado", () => {
  const p = new ProgressTracker();
  feed([{ hook_event_name: "PreToolUse", session_id: S, tool_name: "TaskCreate", tool_input: {}, tool_use_id: "vazio" }], p);
  assert.equal(p.compute([], t).progress.fonte, "nada");
});

test("2ª rodada de TaskCreate depois da lista concluída começa uma lista nova", () => {
  const p = new ProgressTracker();
  feed([createPre("1", "A"), createPost("1", "A"), createPre("2", "B"), createPost("2", "B")], p);
  feed([update("PostToolUse", "1", "completed"), update("PostToolUse", "2", "completed")], p);
  assert.equal(p.compute([], t).progress.concluidas, 2);
  const pr = feed([createPre("3", "C"), createPost("3", "C"), update("PostToolUse", "3", "in_progress")], p);
  assert.deepEqual(pick(pr), { fonte: "tarefas", etapa: 1, total: 1, concluidas: 0, titulo: "C" });
});

test("TaskUpdate: o Pre não muda nada; PostToolUseFailure não aplica", () => {
  const p = new ProgressTracker();
  feed([createPre("1", "A"), createPost("1", "A")], p);
  feed([update("PreToolUse", "1", "completed")], p);
  assert.equal(p.compute([], t).progress.concluidas, 0, "o Pre sozinho não conclui");
  feed([update("PostToolUseFailure", "1", "completed")], p);
  assert.equal(p.compute([], t).progress.concluidas, 0, "falhou: continua pendente");
  feed([update("PostToolUse", "1", "completed")], p);
  assert.equal(p.compute([], t).progress.concluidas, 1);
});

test("Post do TaskCreate antes do Pre do mesmo tool_use_id não duplica a tarefa", () => {
  const p = new ProgressTracker();
  const pr = feed([createPost("1", "A"), createPre("1", "A")], p);
  assert.equal(pr.total, 1);
});

test("pendente sem Post expira em PENDENTE_MS; o Stop do líder limpa na hora", () => {
  const p = new ProgressTracker();
  feed([createPre("1", "A"), createPost("1", "A"), createPre("2", "Sem post")], p);
  const r = p.compute([], t);
  assert.equal(r.progress.total, 2);
  assert.equal(r.proximaMudanca, t + PENDENTE_MS, "avisa quando a pendente expira");
  assert.equal(p.compute([], t + PENDENTE_MS).progress.total, 1);

  const q = new ProgressTracker();
  feed([createPre("1", "A"), createPost("1", "A"), createPre("2", "Sem post")], q);
  assert.equal(q.handle({ hook_event_name: "Stop", session_id: S, agent_id: "sub" }, (t += 10)), false, "Stop de subagente não limpa");
  assert.equal(q.handle({ hook_event_name: "Stop", session_id: S }, (t += 10)), true);
  assert.equal(q.compute([], t).progress.total, 1);
});

// ---------------------------------------------------------------- integração com OfficeState

let state: OfficeState;
let msgs: ServerMessage[];
beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  state = new OfficeState({ now: () => t, sweepEveryMs: 0 });
  msgs = [];
  state.subscribe((m) => msgs.push(m));
});
afterEach(() => mock.timers.reset());

const progressMsgs = () => msgs.filter((m): m is Extract<ServerMessage, { type: "progress" }> => m.type === "progress");

test("OfficeState: snapshot traz o progresso e o WS só recebe 'progress' quando o valor muda", () => {
  for (const ev of TODOS) state.handleHook({ ...(ev as HookInput) });
  const snap = state.snapshot();
  assert.equal(snap.type === "snapshot" && snap.progress.etapa, 2);
  const valores = progressMsgs().map((m) => `${m.progress.fonte}:${m.progress.etapa}/${m.progress.total}`);
  // a sequência pode passar por "papel" (líder trabalhando) entre as listas, mas nunca repete um valor
  for (let i = 1; i < valores.length; i++) assert.notEqual(valores[i], valores[i - 1]);
  assert.equal(valores.at(-1), "tarefas:2/2");
});

test("OfficeState: SessionEnd limpa a lista e reset() volta ao de boa", () => {
  for (const ev of TODOS) state.handleHook({ ...(ev as HookInput) });
  state.handleHook({ hook_event_name: "SessionEnd", session_id: "sessao-todo" });
  assert.equal(state.getProgress().fonte, "nada");
  for (const ev of TASKS) state.handleHook({ ...(ev as HookInput) });
  assert.equal(state.getProgress().fonte, "tarefas");
  state.reset();
  assert.equal(state.getProgress().fonte, "nada");
});

test("OfficeState: lista concluída sai do quadro sozinha depois do tempo (timer)", () => {
  const todos = [{ content: "A", status: "completed", activeForm: "A" }];
  state.handleHook({ hook_event_name: "PostToolUse", session_id: "s", tool_name: "TodoWrite", tool_input: { todos } });
  state.handleHook({ hook_event_name: "Stop", session_id: "s" });
  assert.equal(state.getProgress().concluidas, 1);
  t += DONE_HOLD_MS + 20;
  mock.timers.tick(DONE_HOLD_MS + 20);
  assert.equal(state.getProgress().fonte, "nada");
});
