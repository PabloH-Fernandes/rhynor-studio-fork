// V3 etapa 3: "ninguém vai embora antes da hora". Persistência do estado (reinício do servidor),
// /compact, /clear, respostas longas, e o que ainda manda o time embora (SessionEnd e timeout).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { LinhaGravada } from "./gravador.ts";
import { PersistenciaEstado } from "./persistencia.ts";
import { agentePorKey, agentes, reproduzir, RelogioVirtual } from "./replay.ts";
import { OfficeState, type HookInput } from "./state.ts";
import { DEFAULT_ROSTER } from "../shared/roster.ts";

const T0 = 1791205200000;
const CWD = "/home/usuario/projeto";
const MIN = 60_000;

/** evento de hook chegando `seg` segundos depois de T0 */
function ev(seg: number, evento: Partial<HookInput> & { hook_event_name: string }): LinhaGravada {
  return { chegada: T0 + seg * 1000, hookTs: null, evento: { session_id: "s1", cwd: CWD, ...evento } };
}
const reinicio = (seg: number): LinhaGravada => ({ chegada: T0 + seg * 1000, marcador: "servidor_iniciou" });

/** líder chama o dev, o dev trabalha; o líder também está trabalhando */
const trabalhando = (): LinhaGravada[] => [
  { chegada: T0, marcador: "servidor_iniciou" },
  ev(1, { hook_event_name: "SessionStart", source: "startup" }),
  ev(2, { hook_event_name: "UserPromptSubmit", prompt: "faz o login" }),
  ev(3, { hook_event_name: "PreToolUse", tool_name: "Agent", tool_use_id: "tu-dev", tool_input: { subagent_type: "dev", description: "Fazer o login" } }),
  ev(3.2, { hook_event_name: "SubagentStart", agent_id: "ag-dev", agent_type: "dev" }),
  ev(5, { hook_event_name: "PreToolUse", agent_id: "ag-dev", agent_type: "dev", tool_name: "Edit", tool_input: { file_path: "/x/login.ts" } }),
  ev(6, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" } }),
];

function comPersistencia(anterior: OfficeState, relogio: RelogioVirtual): OfficeState {
  const salvo: unknown = JSON.parse(JSON.stringify(anterior.serializar()));
  const novo = new OfficeState({ relogio, sweepEveryMs: 0 });
  novo.setRoster(structuredClone(DEFAULT_ROSTER));
  novo.restaurar(salvo);
  return novo;
}

const resumo = (s: OfficeState) => agentes(s).map((a) => `${a.id}:${a.sessionId}:${a.status}`).sort();
const saidas = <T extends { status: string }>(linhaDoTempo: T[]) => linhaDoTempo.filter((m) => m.status === "saindo" || m.status === "saiu");

test("reinício no meio do trabalho: mesmos AGzinhos e status; o próximo evento vai pro mesmo boneco", () => {
  const antes = reproduzir(trabalhando()).state;
  const linhas = [...trabalhando(), reinicio(10), ev(12, { hook_event_name: "PreToolUse", agent_id: "ag-dev", agent_type: "dev", tool_name: "Read", tool_input: { file_path: "/x/a.ts" } })];
  const { state, linhaDoTempo } = reproduzir(linhas, { aoReiniciar: comPersistencia });
  assert.deepEqual(resumo(state), resumo(antes));
  assert.equal(agentePorKey(state, "dev")?.activity.includes("a.ts"), true);
  assert.equal(agentePorKey(state, "lider")?.status, "trabalhando");
  assert.deepEqual(saidas(linhaDoTempo), []);
  assert.ok(!linhaDoTempo.some((m) => m.status === "chegando" && m.t > T0 + 10_000));
});

test("reinício logo depois do SubagentStart: quem estava 'chegando' volta já sentado", () => {
  const linhas = [...trabalhando().slice(0, 5), reinicio(4)];
  const { state, relogio } = reproduzir(linhas, { aoReiniciar: comPersistencia });
  const dev = agentePorKey(state, "dev");
  assert.equal(dev?.status, "pensando");
  relogio.avancarAte(relogio.now() + 20_000); // nenhum timer órfão mexe nele
  assert.equal(agentePorKey(state, "dev")?.status, "pensando");
});

// retomada do mesmo agent_id (SendMessage do líder depois do SubagentStop); um agent_id NOVO do
// mesmo papel pega a variação livre (dev-2), como na etapa 2
test("reinício: o líder retoma quem já entregou e ele só volta pra mesa", () => {
  const linhas = [
    ...trabalhando(),
    ev(8, { hook_event_name: "SubagentStop", agent_id: "ag-dev", agent_type: "dev" }),
    reinicio(10),
    ev(20, { hook_event_name: "PreToolUse", tool_name: "SendMessage", tool_input: { to: "ag-dev", message: "Ajusta o login" } }),
    ev(20.2, { hook_event_name: "SubagentStart", agent_id: "ag-dev", agent_type: "dev" }),
    ev(22, { hook_event_name: "PreToolUse", agent_id: "ag-dev", agent_type: "dev", tool_name: "Edit", tool_input: { file_path: "/x/b.ts" } }),
  ];
  const { state, linhaDoTempo } = reproduzir(linhas, { aoReiniciar: comPersistencia });
  const subs = agentes(state).filter((a) => a.parentId);
  assert.equal(subs.length, 1, "o mesmo AGzinho, sem boneco novo");
  assert.equal(subs[0].id, "ag:dev");
  assert.equal(subs[0].status, "trabalhando");
  assert.equal(subs[0].tasksDone, 1);
  assert.ok(!linhaDoTempo.some((m) => m.id === "ag:dev" && m.t > T0 + 10_000 && (m.status === "chegando" || m.status === "saindo")));
});

test("/compact no meio do trabalho: time mantido e o líder não vira ocioso", () => {
  const linhas = [...trabalhando(), ev(30, { hook_event_name: "SessionStart", source: "compact" })];
  const { state, linhaDoTempo } = reproduzir(linhas);
  assert.equal(agentes(state).length, 2);
  assert.equal(agentePorKey(state, "lider")?.status, "trabalhando");
  assert.equal(agentePorKey(state, "dev")?.status, "trabalhando");
  assert.deepEqual(saidas(linhaDoTempo), []);
});

test("/compact com o líder ocioso: só muda o texto", () => {
  const linhas = [...trabalhando(), ev(20, { hook_event_name: "Stop" }), ev(30, { hook_event_name: "SessionStart", source: "compact" })];
  const lider = agentePorKey(reproduzir(linhas).state, "lider");
  assert.equal(lider?.status, "ocioso");
  assert.equal(lider?.activity, "Resumiu a conversa");
});

test("resposta longa: vários Stop e eventos a cada ~10 min, ninguém sai", () => {
  const linhas = [...trabalhando(), ev(60, { hook_event_name: "SubagentStop", agent_id: "ag-dev", agent_type: "dev" })];
  for (let i = 1; i <= 8; i++) {
    const t = 60 + i * 10 * 60;
    linhas.push(ev(t, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: `/x/${i}.ts` } }));
    linhas.push(ev(t + 5, { hook_event_name: "Stop" }));
  }
  const { state, linhaDoTempo } = reproduzir(linhas, { depoisDoFimMs: 20 * MIN });
  assert.deepEqual(saidas(linhaDoTempo), []);
  assert.equal(agentePorKey(state, "lider")?.status, "ocioso");
  assert.equal(agentePorKey(state, "dev")?.status, "ocioso");
});

test("/clear: SessionEnd reason clear + SessionStart clear com session_id novo → mesmo time", () => {
  const linhas = [
    ...trabalhando(),
    ev(8, { hook_event_name: "SubagentStop", agent_id: "ag-dev", agent_type: "dev" }),
    ev(9, { hook_event_name: "Stop" }),
    ev(20, { hook_event_name: "SessionEnd", reason: "clear" }),
    ev(20.3, { hook_event_name: "SessionStart", session_id: "s2", source: "clear" }),
    ev(25, { hook_event_name: "UserPromptSubmit", session_id: "s2", prompt: "agora o logout" }),
  ];
  const { state, linhaDoTempo } = reproduzir(linhas, { depoisDoFimMs: 60_000 });
  assert.deepEqual(saidas(linhaDoTempo), []);
  const lider = agentePorKey(state, "lider");
  assert.equal(lider?.id, "s:s1", "o boneco do líder é o mesmo");
  assert.equal(lider?.sessionId, "s2");
  assert.equal(lider?.status, "pensando");
  assert.equal(agentePorKey(state, "dev")?.sessionId, "s2");
  assert.equal(agentes(state).length, 2);

  // a sessão nova chama um dev: a Bia (de boa, herdada pela sessão nova) só volta pra mesa
  const mais = [
    ...linhas,
    ev(30, { hook_event_name: "PreToolUse", session_id: "s2", tool_name: "Agent", tool_use_id: "tu-x", tool_input: { subagent_type: "dev", description: "Logout" } }),
    ev(30.2, { hook_event_name: "SubagentStart", session_id: "s2", agent_id: "ag-dev-b", agent_type: "dev", tool_use_id: "tu-x" }),
  ];
  const depois = reproduzir(mais);
  assert.equal(agentes(depois.state).length, 2);
  assert.equal(agentePorKey(depois.state, "dev")?.status, "pensando");
  assert.ok(agentes(depois.state).every((a) => a.sessionId === "s2"));
  assert.deepEqual(saidas(depois.linhaDoTempo), []);
  assert.ok(!depois.linhaDoTempo.some((m) => m.status === "chegando" && m.t > T0 + 20_000));
  // e o SessionEnd normal da sessão nova manda todo mundo embora
  const fim = reproduzir([...mais, ev(40, { hook_event_name: "SessionEnd", session_id: "s2", reason: "prompt_input_exit" })], { depoisDoFimMs: 10_000 }).state;
  assert.equal(agentes(fim).length, 0);
});

test("/clear: o /clear sobrevive a um reinício do servidor no meio da troca", () => {
  const linhas = [
    ...trabalhando(),
    ev(20, { hook_event_name: "SessionEnd", reason: "clear" }),
    reinicio(21),
    ev(22, { hook_event_name: "SessionStart", session_id: "s2", source: "clear" }),
  ];
  const { state, linhaDoTempo } = reproduzir(linhas, { aoReiniciar: comPersistencia, depoisDoFimMs: 60_000 });
  assert.deepEqual(saidas(linhaDoTempo), []);
  assert.deepEqual(agentes(state).map((a) => a.sessionId), ["s2", "s2"]);
});

test("dev entregou, novo agent_id dev → ag:dev, sem chegando", () => {
  const linhas = [
    ...trabalhando(),
    ev(8, { hook_event_name: "SubagentStop", agent_id: "ag-dev", agent_type: "dev" }),
    ev(20, { hook_event_name: "PreToolUse", tool_name: "Agent", tool_use_id: "tu-dev2", tool_input: { subagent_type: "dev", description: "Ajustar o login" } }),
    ev(20.2, { hook_event_name: "SubagentStart", agent_id: "ag-dev-2", agent_type: "dev", tool_use_id: "tu-dev2" }),
    ev(22, { hook_event_name: "PreToolUse", agent_id: "ag-dev-2", agent_type: "dev", tool_name: "Edit", tool_input: { file_path: "/x/b.ts" } }),
  ];
  const { state, linhaDoTempo } = reproduzir(linhas);
  const subs = agentes(state).filter((a) => a.parentId);
  assert.deepEqual(subs.map((a) => `${a.id}:${a.status}`), ["ag:dev:trabalhando"]);
  assert.ok(!linhaDoTempo.some((m) => m.t > T0 + 10_000 && (m.status === "chegando" || m.status === "saindo")));
});

test("/clear fora de ordem: SessionStart clear antes do SessionEnd clear funde o time na hora", () => {
  const linhas = [
    ...trabalhando(),
    ev(8, { hook_event_name: "SubagentStop", agent_id: "ag-dev", agent_type: "dev" }),
    ev(9, { hook_event_name: "Stop" }),
    ev(20, { hook_event_name: "SessionStart", session_id: "s2", source: "clear" }),
    ev(21, { hook_event_name: "SessionEnd", reason: "clear" }),
  ];
  const { state, linhaDoTempo } = reproduzir(linhas, { depoisDoFimMs: 60_000 });
  assert.deepEqual(agentes(state).map((a) => `${a.id}:${a.sessionId}`).sort(), ["ag:dev:s2", "s:s1:s2"]);
  assert.equal(agentePorKey(state, "lider")?.activity, "Começou uma conversa nova");
  // só o líder duplicado (que entrou 1 s antes) sai; o time fica
  assert.deepEqual(saidas(linhaDoTempo).map((m) => m.id), ["s:s2"]);
});

test("/clear com duas esperas abertas: só herda quem tem o mesmo cwd", () => {
  const linhas = [
    ...trabalhando(),
    ev(10, { hook_event_name: "SessionStart", session_id: "outra", source: "startup", cwd: "/outro" }),
    ev(20, { hook_event_name: "SessionEnd", reason: "clear" }),
    ev(20.1, { hook_event_name: "SessionEnd", session_id: "outra", reason: "clear", cwd: "/outro" }),
    // sem cwd, com duas esperas abertas, não dá pra saber de quem é: não herda
    ev(21, { hook_event_name: "SessionStart", session_id: "s2", source: "clear", cwd: undefined }),
    ev(22, { hook_event_name: "SessionStart", session_id: "s3", source: "clear" }),
  ];
  const { state } = reproduzir(linhas, { depoisDoFimMs: 45_000 });
  // a "outra" (/outro) não teve conversa nova: foi embora depois da espera
  assert.deepEqual(agentes(state).map((a) => `${a.id}:${a.sessionId}`).sort(), ["ag:dev:s3", "s:s1:s3", "s:s2:s2"]);
});

test("SessionEnd reason clear sem a conversa nova em 30 s: o time vai embora", () => {
  const linhas = [...trabalhando(), ev(20, { hook_event_name: "SessionEnd", reason: "clear" })];
  const ainda = reproduzir(linhas, { depoisDoFimMs: 20_000 }).state;
  assert.equal(agentes(ainda).length, 2, "dentro da espera ninguém sai");
  const { state } = reproduzir(linhas, { depoisDoFimMs: 45_000 });
  assert.equal(agentes(state).length, 0);
});

test("/clear de outro projeto (cwd diferente) não herda o time", () => {
  const linhas = [
    ...trabalhando(),
    ev(20, { hook_event_name: "SessionEnd", reason: "clear" }),
    ev(21, { hook_event_name: "SessionStart", session_id: "s9", source: "clear", cwd: "/outro" }),
  ];
  const { state } = reproduzir(linhas, { depoisDoFimMs: 45_000 });
  assert.deepEqual(agentes(state).map((a) => a.sessionId), ["s9"]);
});

test("SessionEnd normal manda o time embora; Stop não", () => {
  const comStop = reproduzir([...trabalhando(), ev(20, { hook_event_name: "Stop" })], { depoisDoFimMs: 30_000 }).state;
  assert.equal(agentes(comStop).length, 2);
  const { state } = reproduzir([...trabalhando(), ev(20, { hook_event_name: "SessionEnd", reason: "logout" })], { depoisDoFimMs: 30_000 });
  assert.equal(agentes(state).length, 0);
});

test("timeout de 30 min sem eventos manda embora (ocioso); com o arquivo velho, ninguém volta", () => {
  const linhas = [...trabalhando(), ev(8, { hook_event_name: "SubagentStop", agent_id: "ag-dev", agent_type: "dev" }), ev(9, { hook_event_name: "Stop" })];
  const { state } = reproduzir(linhas, { depoisDoFimMs: 32 * MIN });
  assert.equal(agentes(state).length, 0);

  // servidor desligado por 40 min: o estado salvo é descartado no boot
  const vivo = reproduzir(linhas).state;
  const salvo: unknown = JSON.parse(JSON.stringify(vivo.serializar()));
  const novo = new OfficeState({ relogio: new RelogioVirtual(T0 + 40 * MIN), sweepEveryMs: 0 });
  assert.equal(novo.restaurar(salvo), 0);
  assert.equal(agentes(novo).length, 0);
});

test("arquivo corrompido ou com formato estranho: começa vazio sem erro", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agpocket-estado-"));
  try {
    const file = path.join(dir, "escritorio.json");
    const state = new OfficeState({ sweepEveryMs: 0 });
    const p = new PersistenciaEstado(state, file);
    assert.equal(p.carregar(), 0, "sem arquivo");
    fs.writeFileSync(file, "{oops");
    assert.equal(p.carregar(), 0);
    for (const lixo of [null, 42, [], { v: 2, agents: [] }, { v: 1, agents: "x", lastSeen: {} }, { v: 1, agents: [{ id: 1 }], lastSeen: [["s1"]] }]) {
      fs.writeFileSync(file, JSON.stringify(lixo));
      assert.equal(p.carregar(), 0);
    }
    assert.equal(agentes(state).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PersistenciaEstado: salva, carrega num estado novo e o limpar apaga o arquivo", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agpocket-estado-"));
  try {
    const file = path.join(dir, "escritorio.json");
    const { state } = reproduzir(trabalhando());
    // o estado do replay usa o relógio virtual; o novo usa o mesmo instante
    const p = new PersistenciaEstado(state, file);
    // pedidos seguidos não acumulam: uma em andamento + no máximo uma a mais, com o estado do fim
    await Promise.all([p.salvar(), p.salvar(), p.salvar()]);
    assert.deepEqual(fs.readdirSync(dir), ["escritorio.json"], "nenhum .tmp sobrando");
    const salvo = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(salvo.v, 1);

    const novo = new OfficeState({ relogio: new RelogioVirtual(T0 + 10_000), sweepEveryMs: 0 });
    novo.setRoster(structuredClone(DEFAULT_ROSTER));
    assert.equal(new PersistenciaEstado(novo, file).carregar(), 2);
    assert.deepEqual(resumo(novo), resumo(state));
    assert.ok(novo.getProgress().fonte !== undefined);

    p.salvarSync();
    assert.ok(fs.existsSync(file));
    await p.limpar();
    assert.ok(!fs.existsSync(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a simulação (demo) não é salva", () => {
  const state = new OfficeState({ relogio: new RelogioVirtual(T0), sweepEveryMs: 0 });
  state.handleHook({ hook_event_name: "SessionStart", session_id: "demo-1", cwd: CWD });
  state.handleHook({ hook_event_name: "SessionStart", session_id: "real", cwd: CWD });
  const salvo = state.serializar();
  assert.deepEqual(salvo.agents.map((a) => a.sessionId), ["real"]);
  assert.deepEqual(salvo.lastSeen.map(([s]) => s), ["real"]);
});
