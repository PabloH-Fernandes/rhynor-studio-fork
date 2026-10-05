import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { LinhaGravada } from "./gravador.ts";
import { agentePorKey, agentePorNome, agentes, anonimizar, lerJsonl, reproduzir, type RelogioVirtual } from "./replay.ts";
import { OfficeState } from "./state.ts";
import { DEFAULT_ROSTER } from "../shared/roster.ts";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "sessoes", "lider-dois-subagentes.jsonl");
const TEXTO = fs.readFileSync(FIXTURE, "utf8");
const linhas = () => lerJsonl(TEXTO);

test("líder + 2 subagentes: cada AGzinho termina no status certo", () => {
  const { state, linhaDoTempo } = reproduzir(linhas());

  assert.equal(agentes(state).length, 3);
  assert.equal(agentePorKey(state, "lider")?.status, "pensando");
  assert.equal(agentePorKey(state, "lider")?.activity, "Coordenando: chamou Dev");
  // o planejador entregou (SubagentStop): fica de boa no escritório
  assert.equal(agentePorNome(state, "Marina")?.status, "ocioso");
  // o Pre do Bash chegou depois do Post do Edit, mas começou antes (x-hook-ts menor): a fila
  // ordena como o servidor e o Post do Edit é o último; PostToolUse também é trabalho (V3 etapa 2:
  // nunca vira descanso), então a Bia termina trabalhando
  const bia = agentePorNome(state, "Bia");
  assert.equal(bia?.agzinho, "dev");
  assert.equal(bia?.status, "trabalhando");
  assert.equal(bia?.activity, "Rodar os testes do login");
  assert.equal(state.getProgress().total, 2);

  const daBia = linhaDoTempo.filter((m) => m.id === bia?.id).map((m) => m.status);
  assert.deepEqual(daBia, ["chegando", "trabalhando", "trabalhando"]);
});

test("sem evento nenhum, o subagente sai de 'chegando' pelo timer de 12 s do relógio virtual", () => {
  // só o SubagentStart da Bia fica: nenhuma ferramenta dela chega
  const ate = linhas().filter((l) => {
    if (!("evento" in l)) return true;
    const ev = l.evento as { agent_id?: string; hook_event_name?: string };
    return ev.agent_id !== "ag-dev" || ev.hook_event_name === "SubagentStart";
  });
  const { state } = reproduzir(ate);
  assert.equal(agentePorKey(state, "dev")?.status, "chegando");
  const depois = reproduzir(ate, { depoisDoFimMs: 15_000 }).state;
  assert.equal(agentePorKey(depois, "dev")?.status, "pensando");
});

/** o servidor novo carrega o que o anterior salvou (como data/escritorio.json, ida e volta pelo JSON) */
function comPersistencia(anterior: OfficeState, relogio: RelogioVirtual): OfficeState {
  const salvo: unknown = JSON.parse(JSON.stringify(anterior.serializar()));
  const novo = new OfficeState({ relogio, sweepEveryMs: 0 });
  novo.setRoster(structuredClone(DEFAULT_ROSTER));
  novo.restaurar(salvo);
  return novo;
}

// Bug 4: o servidor reinicia no meio da sessão (tsx watch). Sem persistência o escritório
// esvaziava; com o estado salvo, o mesmo time volta como estava.
test("bug 4: servidor_iniciou com persistência mantém o time, os status e a lista", () => {
  const base = linhas();
  const fim = base[base.length - 1].chegada;
  const comReinicio: LinhaGravada[] = [...base, { chegada: fim + 1000, marcador: "servidor_iniciou" }];
  const antes = reproduzir(base).state;
  const resumo = (s: OfficeState) => agentes(s).map((a) => `${a.id}:${a.agzinho}:${a.status}:${a.activity}`).sort();

  const { state, linhaDoTempo } = reproduzir(comReinicio, { aoReiniciar: comPersistencia });
  assert.deepEqual(resumo(state), resumo(antes));
  assert.equal(state.getProgress().total, 2);
  const iReinicio = linhaDoTempo.findIndex((m) => m.status === "reiniciou");
  assert.ok(iReinicio >= 0);
  assert.deepEqual(linhaDoTempo.slice(iReinicio + 1), [], "ninguém sai nem chega no reinício");

  // eventos da sessão viva depois do reinício: o mesmo agent_id cai no mesmo boneco
  const depois: LinhaGravada[] = [
    {
      chegada: fim + 2000,
      hookTs: null,
      evento: { hook_event_name: "PreToolUse", session_id: "sessao-fixture", agent_id: "ag-dev", agent_type: "dev", tool_name: "Read", tool_input: { file_path: "/x/a.ts" } },
    },
    { chegada: fim + 3000, hookTs: null, evento: { hook_event_name: "SubagentStop", session_id: "sessao-fixture", agent_id: "ag-dev", agent_type: "dev" } },
  ];
  const volta = reproduzir([...comReinicio, ...depois], { aoReiniciar: comPersistencia });
  assert.deepEqual(agentes(volta.state).map((a) => a.agzinho).sort(), ["dev", "lider", "planejador"]);
  const bia = agentePorKey(volta.state, "dev");
  assert.equal(bia?.id, agentePorKey(antes, "dev")?.id);
  assert.equal(bia?.status, "ocioso");
  assert.equal(bia?.tasksDone, 1);
  assert.equal(volta.state.getProgress().total, 2);
  assert.ok(!volta.linhaDoTempo.some((m) => m.status === "saindo" || m.status === "saiu" || (m.status === "chegando" && m.t > fim)));
});

test("servidor_iniciou sem persistência (aoReiniciar ausente) ainda começa vazio", () => {
  const base = linhas();
  const fim = base[base.length - 1].chegada;
  const { state } = reproduzir([...base, { chegada: fim + 1000, marcador: "servidor_iniciou" }]);
  assert.equal(agentes(state).length, 0);
  assert.equal(state.getProgress().fonte, "nada");
});

test("anonimizador: nenhum caminho, cwd, prompt ou comando original sobra, e o replay dá o mesmo resultado", () => {
  const anon = anonimizar(linhas());
  const texto = anon.map((l) => JSON.stringify(l)).join("\n");

  for (const original of [
    "/home/usuario",
    "projeto-exemplo",
    "login.ts",
    "auth.ts",
    "login secreto",
    "SEGREDO",
    "senha123",
    "npm test",
    "Implemente",
    "Rodar os testes",
    "transcript_path",
  ]) {
    assert.ok(!texto.includes(original), `sobrou "${original}" no anonimizado`);
  }
  assert.ok(texto.includes('"cwd":"/projeto"'));
  assert.ok(texto.includes('"subagent_type":"dev"'));
  assert.ok(/arquivo-\d+\.ts/.test(texto));
  assert.ok(texto.includes("Tarefa 1"));
  assert.equal(anon.length, linhas().length);

  const original = reproduzir(linhas()).state;
  const copia = reproduzir(anon).state;
  const resumo = (s: typeof original) => agentes(s).map((a) => `${a.agzinho}:${a.status}`).sort();
  assert.deepEqual(resumo(copia), resumo(original));
  assert.equal(copia.getProgress().total, 2);
  assert.equal(copia.getProgress().etapa, original.getProgress().etapa);
});

test("lerJsonl aponta a linha inválida", () => {
  assert.throws(() => lerJsonl('{"chegada":1,"marcador":"servidor_iniciou"}\n{oops'), /linha 2/);
});

test("lerJsonl ignora evento null (POST sem corpo)", () => {
  const lidas = lerJsonl('{"chegada":1,"hookTs":null,"evento":null}\n{"chegada":2,"hookTs":null,"evento":{"hook_event_name":"Stop","session_id":"s"}}');
  assert.equal(lidas.length, 1);
  assert.equal(lidas[0].chegada, 2);
});

test("o estado devolvido continua usável: o relógio virtual dispara os timers dele", () => {
  const ate = linhas().filter((l) => !("evento" in l) || (l.evento as { agent_id?: string; hook_event_name?: string }).hook_event_name === "SubagentStart" || (l.evento as { agent_id?: string }).agent_id !== "ag-dev");
  const { state, relogio } = reproduzir(ate);
  assert.equal(agentePorKey(state, "dev")?.status, "chegando");
  relogio.avancarAte(relogio.now() + 15_000);
  assert.equal(agentePorKey(state, "dev")?.status, "pensando");
});

test("aoReiniciar troca o estado do servidor novo (gancho da persistência da etapa 3)", () => {
  const base = linhas();
  const fim = base[base.length - 1].chegada;
  let chamado = 0;
  const { state } = reproduzir([...base, { chegada: fim + 1000, marcador: "servidor_iniciou" }], {
    aoReiniciar: (anterior) => {
      chamado++;
      return anterior; // "persistência perfeita": o mesmo estado segue
    },
  });
  assert.equal(chamado, 1, "o primeiro marcador (boot) não conta como reinício");
  assert.equal(agentes(state).length, 3);
});
