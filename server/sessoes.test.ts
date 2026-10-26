// Sessões gravadas (server/fixtures/sessoes/*.jsonl) passadas pelo reprodutor: cada Personagem faz
// só o trabalho do próprio agent_id e o mesmo agent_id fica no mesmo boneco a sessão inteira.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { LinhaGravada } from "./gravador.ts";
import { agentePorKey, agentePorNome, agentes, lerJsonl, reproduzir } from "./replay.ts";
import { describeTool } from "./state.ts";

const PASTA = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "sessoes");
/** instante zero das fixtures (os eventos estão em segundos depois dele) */
const T0 = 1791205200000;

const carregar = (nome: string) => lerJsonl(fs.readFileSync(path.join(PASTA, nome), "utf8"));
/** as linhas que chegaram até `seg` segundos */
const ate = (linhas: LinhaGravada[], seg: number) => linhas.filter((l) => l.chegada <= T0 + seg * 1000);
const subs = (linhas: LinhaGravada[]) => agentes(reproduzir(linhas).state).filter((a) => a.parentId);

test("bug 1: subagente retomado por SendMessage em menos de 2 min volta trabalhando no mesmo boneco", () => {
  const linhas = carregar("retomada-sendmessage.jsonl");

  // entregou: de boa na mesa
  const entregou = reproduzir(ate(linhas, 15)).state;
  assert.equal(agentePorNome(entregou, "Kauã")?.status, "ocioso");

  // 30 s depois do Stop, o Edit do mesmo agent_id chega: nada é descartado
  const { state } = reproduzir(ate(linhas, 40));
  const bia = agentePorNome(state, "Kauã")!;
  assert.equal(bia.id, "p:dev");
  assert.equal(bia.status, "trabalhando");
  assert.equal(bia.activity, describeTool("Edit", { file_path: "/home/usuario/projeto-exemplo/src/login.ts" }));
  assert.equal(subs(ate(linhas, 40)).length, 1, "o retomado não ganha outro boneco");
});

test("bug 1: eventos 2+ min depois do SubagentStop ainda vão para o mesmo boneco", () => {
  const linhas = carregar("retomada-sendmessage.jsonl");
  const { state, linhaDoTempo } = reproduzir(linhas);
  const bia = agentePorKey(state, "dev")!;
  assert.equal(bia.id, "p:dev");
  assert.equal(bia.status, "trabalhando");
  assert.equal(bia.activity, "Rodando os testes");
  assert.equal(bia.tasksDone, 2);
  assert.equal(subs(linhas).length, 1);
  // ninguém mais recebeu o trabalho dela (nem o Ícaro, o curinga)
  assert.ok(!linhaDoTempo.some((m) => m.id !== bia.id && m.atividade === "Rodando os testes"));
  // o boneco do Kauã passou por ocioso (2 entregas) e voltou a trabalhar nas duas retomadas
  const daBia = linhaDoTempo.filter((m) => m.id === bia.id).map((m) => m.status);
  assert.equal(daBia.at(-1), "trabalhando");
  assert.equal(daBia.filter((s) => s === "ocioso").length, 2);
});

test("3 subagentes em paralelo (dev, dev, testador) → Kauã, Vini e Érica, cada um com a própria atividade", () => {
  const linhas = carregar("tres-em-paralelo.jsonl");
  const { state } = reproduzir(ate(linhas, 6));
  const bia = agentePorNome(state, "Kauã");
  const yasmin = agentePorNome(state, "Vini");
  const rafa = agentePorNome(state, "Érica");
  assert.deepEqual(
    [bia?.personagem, yasmin?.personagem, rafa?.personagem],
    ["dev", "dev-2", "testador"],
  );
  assert.equal(new Set([bia?.id, yasmin?.id, rafa?.id]).size, 3);
  assert.equal(bia?.activity, describeTool("Read", { file_path: "/home/usuario/projeto-exemplo/src/form.ts" }));
  assert.equal(yasmin?.activity, describeTool("Write", { file_path: "/home/usuario/projeto-exemplo/src/schema.ts" }));
  assert.equal(rafa?.activity, describeTool("Bash", { command: "npm test" }));
  for (const a of [bia, yasmin, rafa]) assert.equal(a?.status, "trabalhando");
});

test("bug 2: evento de outro agent_id (sem agent_type) não mexe no Kauã; sem agent_id só no líder", () => {
  const linhas = carregar("tres-em-paralelo.jsonl");
  const antes = reproduzir(ate(linhas, 6)).state;
  const time = (s: typeof antes) =>
    ["Kauã", "Vini", "Érica"].map((n) => {
      const a = agentePorNome(s, n)!;
      return { id: a.id, status: a.status, activity: a.activity, updatedAt: a.updatedAt };
    });

  const { state } = reproduzir(linhas);
  assert.deepEqual(time(state), time(antes), "o Grep do ag-x e o Read do líder não alteram o time");
  // o ag-x ganhou um boneco próprio (convidado), não o de ninguém do time
  const grep = describeTool("Grep", { pattern: "useForm" });
  const doX = agentes(state).filter((a) => a.activity === grep);
  assert.equal(doX.length, 1);
  assert.ok(!["dev", "dev-2", "testador"].includes(doX[0].personagem ?? ""));
  // o Read sem agent_id é do líder
  const lider = agentes(state).find((a) => !a.parentId)!;
  assert.equal(lider.activity, describeTool("Read", { file_path: "/home/usuario/projeto-exemplo/README.md" }));
  assert.equal(agentes(state).filter((a) => a.activity === lider.activity).length, 1);
});

test("retomada por SendMessage: 1 linha \"foi chamada de novo\" por retomada (SendMessage + 1º evento não duplicam)", () => {
  const linhas = carregar("retomada-sendmessage.jsonl");
  const { state } = reproduzir(linhas);
  const snap = state.snapshot();
  if (snap.type !== "snapshot") throw new Error("devia ser snapshot");
  const deNovo = snap.feed.filter((f) => f.agentId === "p:dev" && f.categoria === "chegada" && /de novo/.test(f.simples ?? ""));
  // a fixture tem 2 retomadas do Kauã, cada uma com SendMessage do líder e depois eventos dela
  assert.deepEqual(
    deNovo.map((f) => [f.quem, f.simples, f.text]),
    [
      ["Kauã", "foi chamado de novo para ajudar", "foi chamado de novo"],
      ["Kauã", "foi chamado de novo para ajudar", "foi chamado de novo"],
    ],
  );
});
