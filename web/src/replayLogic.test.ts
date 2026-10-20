import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent } from "../../shared/types";
import type { DiaReplay, MensagemDoDia } from "../../shared/replay";
import { calcularChaves } from "../../shared/replay";
import { DT_MAXIMO_MS, Reprodutor, avancar, aplicar, ehDiaReplay, estadoVazio, indiceEm, rotuloData, rotuloHora } from "./replayLogic";

function agente(id: string, status: Agent["status"]): Agent {
  return { id, sessionId: "s", role: "dev", name: id, status, activity: "", project: "p", startedAt: 0, updatedAt: 0, boundAt: 0, tasksDone: 0, tasksDay: "" };
}

const BASE = 1_000_000;
const mensagens: MensagemDoDia[] = [
  { t: BASE, msg: { type: "agent", agent: agente("a", "chegando") } },
  { t: BASE + 5_000, msg: { type: "agent", agent: agente("a", "trabalhando") } },
  { t: BASE + 70_000, msg: { type: "agent", agent: agente("b", "ocioso") } },
  { t: BASE + 130_000, msg: { type: "remove", id: "a" } },
  { t: BASE + 200_000, msg: { type: "limpar" } },
  { t: BASE + 201_000, msg: { type: "agent", agent: agente("c", "pensando") } },
];
const dia: Pick<DiaReplay, "mensagens" | "chaves"> = { mensagens, chaves: calcularChaves(mensagens) };

const statusEm = (r: Reprodutor, t: number) => Object.values(r.irPara(t).agents).map((a) => `${a.id}:${a.status}`).sort();

test("indiceEm conta as mensagens até o instante (inclusive)", () => {
  assert.equal(indiceEm(mensagens, BASE - 1), 0);
  assert.equal(indiceEm(mensagens, BASE), 1);
  assert.equal(indiceEm(mensagens, BASE + 69_999), 2);
  assert.equal(indiceEm(mensagens, BASE + 10_000_000), 6);
  assert.equal(indiceEm([], 5), 0);
});

test("aplicar: agent entra, remove sai, limpar zera tudo", () => {
  const e = estadoVazio();
  aplicar(e, { type: "agent", agent: agente("a", "ocioso") });
  aplicar(e, { type: "progress", progress: { fonte: "tarefas", etapa: 1, total: 2, concluidas: 0, titulo: "x" } });
  assert.equal(Object.keys(e.agents).length, 1);
  aplicar(e, { type: "remove", id: "a" });
  assert.equal(Object.keys(e.agents).length, 0);
  aplicar(e, { type: "limpar" });
  assert.equal(e.progress, null);
});

test("estado em cada instante, para frente", () => {
  const r = new Reprodutor(dia);
  assert.deepEqual(statusEm(r, BASE - 10), []);
  assert.deepEqual(statusEm(r, BASE + 1_000), ["a:chegando"]);
  assert.deepEqual(statusEm(r, BASE + 6_000), ["a:trabalhando"]);
  assert.deepEqual(statusEm(r, BASE + 80_000), ["a:trabalhando", "b:ocioso"]);
  assert.deepEqual(statusEm(r, BASE + 140_000), ["b:ocioso"]);
  // o servidor reiniciou: todo mundo some até a próxima mensagem
  assert.deepEqual(statusEm(r, BASE + 200_500), []);
  assert.deepEqual(statusEm(r, BASE + 300_000), ["c:pensando"]);
});

test("arrastar para trás dá o mesmo resultado que ir direto (com e sem chaves guardadas)", () => {
  const r = new Reprodutor(dia);
  r.irPara(BASE + 300_000);
  assert.deepEqual(statusEm(r, BASE + 80_000), ["a:trabalhando", "b:ocioso"]);
  assert.deepEqual(statusEm(r, BASE + 2_000), ["a:chegando"]);
  assert.deepEqual(statusEm(r, BASE - 1), []);
  const direto = new Reprodutor(dia);
  assert.deepEqual(statusEm(direto, BASE + 140_000), ["b:ocioso"]);
  const semChaves = new Reprodutor({ mensagens, chaves: [] });
  semChaves.irPara(BASE + 300_000);
  assert.deepEqual(statusEm(semChaves, BASE + 80_000), ["a:trabalhando", "b:ocioso"]);
});

test("o resultado é uma cópia: mexer nele não estraga o replay", () => {
  const r = new Reprodutor(dia);
  const e = r.irPara(BASE + 6_000);
  delete e.agents.a;
  assert.deepEqual(statusEm(r, BASE + 6_000), ["a:trabalhando"]);
  // os retratos das chaves também são cópias
  r.irPara(BASE + 300_000);
  assert.deepEqual(statusEm(r, BASE + 80_000), ["a:trabalhando", "b:ocioso"]);
});

test("avançar: 10x, 30x e 60x, limitado no fim e no salto de aba parada", () => {
  assert.equal(avancar(0, 100, 10, 1e9).t, 1_000);
  assert.equal(avancar(0, 100, 30, 1e9).t, 3_000);
  assert.equal(avancar(0, 100, 60, 1e9).t, 6_000);
  // aba em segundo plano: o quadro vem com dt enorme, mas só anda DT_MAXIMO_MS
  assert.equal(avancar(0, 60_000, 60, 1e9).t, DT_MAXIMO_MS * 60);
  assert.equal(avancar(0, -50, 60, 1e9).t, 0);
  const fim = avancar(990, 100, 10, 1_000);
  assert.deepEqual(fim, { t: 1_000, terminou: true });
  assert.equal(avancar(0, 16, 10, 1_000).terminou, false);
});

test("rótulos de hora e data", () => {
  assert.match(rotuloHora(new Date(2026, 9, 5, 9, 7, 30).getTime()), /^09:07$/);
  assert.equal(rotuloData("2026-10-05"), "05/10/2026");
  assert.equal(rotuloData("lixo"), "lixo");
});

test("ehDiaReplay recusa o que não tem a forma certa", () => {
  assert.equal(ehDiaReplay({ ok: true, inicio: 1, fim: 2, mensagens: [], chaves: [] }), true);
  for (const ruim of [null, {}, { ok: false }, { ok: true, inicio: 1, fim: 2 }, "x"]) assert.equal(ehDiaReplay(ruim), false);
});
