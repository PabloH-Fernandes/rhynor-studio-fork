// Cenários de replay (relógio virtual) para visitantes temporários, expiração de "trabalhando",
// reinício do servidor no meio da sessão e sessões de projetos diferentes ao mesmo tempo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ROSTER } from "../shared/roster.ts";
import { MAX_VISITANTES_NA_TELA, ehVisitante } from "../shared/visitante.ts";
import type { LinhaGravada } from "./gravador.ts";
import { agentes, reproduzir, type RelogioVirtual } from "./replay.ts";
import { OfficeState, TRABALHANDO_BASH_MS, TRABALHANDO_EXPIRA_MS, VISITANTE_SEM_EVENTO_MS } from "./state.ts";

const T0 = 1791205200000;
type Ev = Record<string, unknown>;
const mk = (seg: number, e: Ev, sid = "S1", cwd = "/work/alfa"): LinhaGravada =>
  ({ chegada: T0 + seg * 1000, hookTs: T0 + seg * 1000 - 20, evento: { session_id: sid, cwd, ...e } }) as LinhaGravada;
const sess = (seg = 0, sid = "S1", cwd = "/work/alfa") => mk(seg, { hook_event_name: "SessionStart", source: "startup" }, sid, cwd);
const chamar = (seg: number, tu: string, type: string, sid = "S1", cwd = "/work/alfa") =>
  mk(seg, { hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: type, description: "x" }, tool_use_id: tu }, sid, cwd);
const start = (seg: number, id: string, type: string, sid = "S1", cwd = "/work/alfa") =>
  mk(seg, { hook_event_name: "SubagentStart", agent_id: id, agent_type: type }, sid, cwd);
const stop = (seg: number, id: string, type: string, sid = "S1", cwd = "/work/alfa") =>
  mk(seg, { hook_event_name: "SubagentStop", agent_id: id, agent_type: type }, sid, cwd);
const pre = (seg: number, id: string | undefined, tu: string, tool = "Read", type = "dev", sid = "S1", cwd = "/work/alfa") =>
  mk(
    seg,
    {
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: tool === "Bash" ? { command: "npm test" } : { file_path: "/p/a.ts" },
      tool_use_id: tu,
      ...(id ? { agent_id: id, agent_type: type } : {}),
    },
    sid,
    cwd,
  );
const reinicio = (seg: number): LinhaGravada => ({ chegada: T0 + seg * 1000, marcador: "servidor_iniciou" });

const visitantes = (s: OfficeState) => agentes(s).filter(ehVisitante);
const naTela = (s: OfficeState) => visitantes(s).filter((a) => !a.excedente && a.status !== "saindo");

/** chega um visitante: o líder chama (Agent) e o SubagentStart abre o boneco */
const chega = (seg: number, n: number, sid = "S1", cwd = "/work/alfa"): LinhaGravada[] => [
  chamar(seg, `tu-v${n}`, `convidado-${n}`, sid, cwd),
  start(seg + 0.2, `v${n}`, `convidado-${n}`, sid, cwd),
];

// ---------------------------------------------------------------- 1. cinco visitantes

test("5 visitantes: máx. 3 na tela, excedentes só marcados, saem no SubagentStop e o 4º e 5º ganham vaga", () => {
  const base = [
    sess(),
    ...[1, 2, 3, 4, 5].flatMap((n) => chega(n, n)),
    ...[1, 2, 3, 4, 5].map((n) => pre(10 + n, `v${n}`, `r${n}`, "Read", `convidado-${n}`)),
  ];

  const cheio = reproduzir(base).state;
  const todos = visitantes(cheio);
  assert.equal(todos.length, 5, "os 5 existem no estado (o contador do painel usa todos)");
  assert.equal(naTela(cheio).length, MAX_VISITANTES_NA_TELA);
  assert.equal(todos.filter((a) => a.excedente).length, 2);
  const ordem = [...todos].sort((a, b) => a.boundAt - b.boundAt);
  assert.deepEqual(ordem.map((a) => Boolean(a.excedente)), [false, false, false, true, true], "excedentes são os últimos a chegar");

  // o 1º entrega e sai pela porta: o 4º ganha a vaga
  const depoisDo1 = reproduzir([...base, stop(30, "v1", "convidado-1")], { depoisDoFimMs: 10_000 }).state;
  assert.equal(visitantes(depoisDo1).length, 4, "o 1º saiu");
  assert.equal(naTela(depoisDo1).length, 3);
  assert.equal(visitantes(depoisDo1).filter((a) => a.excedente).length, 1, "só o 5º continua excedente");

  // o 2º também: o 5º ganha vaga
  const depoisDo2 = reproduzir([...base, stop(30, "v1", "convidado-1"), stop(31, "v2", "convidado-2")], { depoisDoFimMs: 10_000 }).state;
  assert.equal(visitantes(depoisDo2).length, 3);
  assert.equal(naTela(depoisDo2).length, 3);
  assert.equal(visitantes(depoisDo2).filter((a) => a.excedente).length, 0);

  // todos entregam: sobra só o líder
  const fim = reproduzir([...base, ...[1, 2, 3, 4, 5].map((n) => stop(40 + n, `v${n}`, `convidado-${n}`))], { depoisDoFimMs: 15_000 }).state;
  assert.equal(visitantes(fim).length, 0);
  assert.equal(agentes(fim).filter((a) => a.parentId).length, 0);
});

// ---------------------------------------------------------------- 2. visitante sem Stop

test("visitante que nunca recebe SubagentStop sai sozinho em 3 min sem evento", () => {
  const l = [sess(), ...chega(1, 1), pre(2, "v1", "r1", "Read", "convidado-1")];
  const antes = reproduzir(l, { depoisDoFimMs: VISITANTE_SEM_EVENTO_MS - 10_000 }).state;
  assert.equal(visitantes(antes).length, 1, "com 2 min 50 s ainda está lá");
  const depois = reproduzir(l, { depoisDoFimMs: VISITANTE_SEM_EVENTO_MS + 15_000 }).state;
  assert.equal(visitantes(depois).length, 0, "passou dos 3 min: foi embora");
  assert.equal(agentes(depois).filter((a) => !a.parentId).length, 1, "o líder continua");
});

test("visitante que continua mandando evento não expira (o prazo é contado do último evento)", () => {
  const l = [sess(), ...chega(1, 1), ...[60, 120, 180, 240].map((s, i) => pre(s, "v1", `r${i}`, "Read", "convidado-1"))];
  const { state } = reproduzir(l, { depoisDoFimMs: 60_000 });
  assert.equal(visitantes(state).length, 1);
});

// ---------------------------------------------------------------- 3. Pre sem Post

test("PreToolUse sem PostToolUse: o dev volta para 'de boa' em 2 min (10 min com Bash)", () => {
  const dev = (tool: string) => [sess(), chamar(1, "tu1", "dev"), start(1.2, "A", "dev"), pre(2, "A", "r1", tool, "dev")];
  const status = (l: LinhaGravada[], depoisSeg: number) =>
    agentes(reproduzir(l, { depoisDoFimMs: depoisSeg * 1000 }).state).find((a) => a.parentId)!.status;

  const read = dev("Read");
  assert.equal(status(read, TRABALHANDO_EXPIRA_MS / 1000 - 10), "trabalhando", "com 1 min 50 s ainda trabalha");
  assert.equal(status(read, TRABALHANDO_EXPIRA_MS / 1000 + 5), "ocioso", "passou de 2 min: de boa");

  const bash = dev("Bash");
  assert.equal(status(bash, TRABALHANDO_EXPIRA_MS / 1000 + 30), "trabalhando", "Bash dura mais que 2 min");
  assert.equal(status(bash, TRABALHANDO_BASH_MS / 1000 - 10), "trabalhando");
  assert.equal(status(bash, TRABALHANDO_BASH_MS / 1000 + 5), "ocioso", "passou de 10 min: de boa");
});

test("o líder com PreToolUse sem Post também volta para ocioso em 2 min", () => {
  const { state } = reproduzir([sess(), pre(2, undefined, "r1", "Read")], { depoisDoFimMs: TRABALHANDO_EXPIRA_MS + 5000 });
  const lider = agentes(state).find((a) => !a.parentId)!;
  assert.equal(lider.status, "ocioso");
});

test("PreToolUse tardio depois do SubagentStop de visitante não recria fantasma", () => {
  for (const atraso of [0.5, 3, 30]) {
    const l = [
      sess(),
      ...chega(1, 1),
      pre(2, "v1", "r1", "Read", "convidado-1"),
      stop(5, "v1", "convidado-1"),
      pre(5 + atraso, "v1", "r2", "Edit", "convidado-1"),
    ];
    const { state } = reproduzir(l, { depoisDoFimMs: 20_000 });
    assert.equal(visitantes(state).length, 0, `Pre ${atraso}s depois do Stop não pode trazer o visitante de volta`);
  }
});

test("nenhum subagente fica 'trabalhando' preso depois de um Pre tardio pós-Stop", () => {
  const l = [sess(), ...chega(1, 1), stop(5, "v1", "convidado-1"), pre(6, "v1", "r2", "Edit", "convidado-1")];
  const { state } = reproduzir(l, { depoisDoFimMs: 5 * 60_000 });
  assert.equal(agentes(state).filter((a) => a.parentId && a.status === "trabalhando").length, 0);
});

test("SubagentStart explícito reabre um visitante que acabou de sair", () => {
  const l = [sess(), ...chega(1, 1), stop(5, "v1", "convidado-1"), start(8, "v1", "convidado-1")];
  const { state } = reproduzir(l);
  assert.equal(visitantes(state).filter((a) => a.status !== "saindo").length, 1);
});

// ---------------------------------------------------------------- 4. reinício do servidor

function comPersistencia(anterior: OfficeState, relogio: RelogioVirtual): OfficeState {
  const salvo: unknown = JSON.parse(JSON.stringify(anterior.serializar()));
  const novo = new OfficeState({ relogio, sweepEveryMs: 0 });
  novo.setRoster(structuredClone(DEFAULT_ROSTER));
  novo.restaurar(salvo);
  return novo;
}

test("reinício do servidor no meio da sessão: ninguém volta trabalhando e os visitantes não voltam", () => {
  const l = [
    reinicio(0),
    sess(1),
    chamar(2, "tu-dev", "dev"),
    start(2.2, "A", "dev"),
    pre(3, "A", "r1", "Edit", "dev"),
    ...chega(4, 1),
    ...chega(5, 2),
    pre(6, "v1", "rv1", "Read", "convidado-1"),
    pre(7, undefined, "rl", "Bash"),
    reinicio(20),
  ];
  const { state, linhaDoTempo } = reproduzir(l, { aoReiniciar: comPersistencia });
  assert.ok(linhaDoTempo.some((m) => m.status === "reiniciou"));
  const lista = agentes(state);
  assert.equal(lista.filter((a) => a.status === "trabalhando" || a.status === "pensando").length, 0, "a ferramenta em andamento morreu com o processo");
  assert.equal(visitantes(state).length, 0, "visitante é passageiro: não é restaurado");
  assert.ok(lista.some((a) => !a.parentId), "líder restaurado");
  assert.ok(lista.some((a) => a.personagem === "dev"), "dev restaurado (de boa)");
});

test("depois do reinício, evento tardio de visitante que sumiu não deixa ninguém preso (sai em 3 min)", () => {
  const l = [reinicio(0), sess(1), ...chega(2, 1), reinicio(10), pre(12, "v1", "rv1", "Read", "convidado-1")];
  const { state } = reproduzir(l, { aoReiniciar: comPersistencia, depoisDoFimMs: VISITANTE_SEM_EVENTO_MS + 15_000 });
  assert.equal(visitantes(state).length, 0);
  assert.equal(agentes(state).filter((a) => a.status === "trabalhando").length, 0);
});

// ---------------------------------------------------------------- 5. duas sessões, dois projetos

test("duas sessões de projetos diferentes: o Stop de uma não mexe na outra e cada líder tem o project certo", () => {
  const A = { sid: "SA", cwd: "/work/alfa" };
  const B = { sid: "SB", cwd: "/work/beta" };
  const l = [
    sess(0, A.sid, A.cwd),
    sess(0.5, B.sid, B.cwd),
    ...chega(1, 1, A.sid, A.cwd),
    chamar(1.5, "tu-b", "convidado-9", B.sid, B.cwd),
    start(1.7, "vb", "convidado-9", B.sid, B.cwd),
    pre(2, "vb", "rb", "Read", "convidado-9", B.sid, B.cwd),
    pre(3, undefined, "la", "Bash", "lider", A.sid, A.cwd),
    pre(3.5, undefined, "lb", "Read", "lider", B.sid, B.cwd),
    stop(10, "v1", "convidado-1", A.sid, A.cwd),
  ];
  const { state } = reproduzir(l, { depoisDoFimMs: 10_000 });
  const lista = agentes(state);
  const liderA = lista.find((a) => !a.parentId && a.sessionId === A.sid)!;
  const liderB = lista.find((a) => !a.parentId && a.sessionId === B.sid)!;
  assert.equal(liderA.project, "alfa");
  assert.equal(liderB.project, "beta");
  const visB = lista.find((a) => a.sessionId === B.sid && a.parentId);
  assert.ok(visB, "o visitante da sessão B não foi tocado pelo Stop da sessão A");
  assert.equal(visB.status, "trabalhando");
  assert.equal(visB.project, "beta");
  assert.equal(lista.filter((a) => a.sessionId === A.sid && a.parentId).length, 0, "o visitante de A saiu sem rastro");
  assert.equal(liderB.status, "trabalhando");
});

test("duas sessões: Stop e SessionEnd de uma só afetam os agentes dela", () => {
  const l = [
    sess(0, "SA", "/work/alfa"),
    sess(0.5, "SB", "/work/beta"),
    chamar(1, "ta", "dev", "SA", "/work/alfa"),
    start(1.2, "da", "dev", "SA", "/work/alfa"),
    chamar(1, "tb", "dev", "SB", "/work/beta"),
    start(1.3, "db", "dev", "SB", "/work/beta"),
    pre(2, "da", "ra", "Edit", "dev", "SA", "/work/alfa"),
    pre(2, "db", "rb", "Edit", "dev", "SB", "/work/beta"),
    mk(5, { hook_event_name: "Stop" }, "SA", "/work/alfa"),
    mk(6, { hook_event_name: "SessionEnd" }, "SA", "/work/alfa"),
  ];
  const { state } = reproduzir(l);
  const doB = agentes(state).filter((a) => a.sessionId === "SB");
  assert.ok(doB.length >= 2, "líder e dev da sessão B continuam");
  const devB = doB.find((a) => a.parentId)!;
  assert.equal(devB.status, "trabalhando");
  assert.equal(devB.project, "beta");
});
