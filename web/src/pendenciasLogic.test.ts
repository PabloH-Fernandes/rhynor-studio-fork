import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pendencia } from "../../shared/types";
import {
  URGENCIAS,
  comUrgencia,
  contarPendencias,
  filtrarPendencias,
  filtroValido,
  hojeLocal,
  ordenarPendencias,
  proximoFoco,
  resumoPendencias,
  rotuloConcluir,
  textoDono,
  textoErroConclusao,
  textoEstado,
} from "./pendenciasLogic";

const base: Omit<Pendencia, "id" | "prazo" | "dono"> = { h: "00000000", texto: "x", responsavel: "", origem: "Reunião", status: "a fazer", urgencia: "sem-prazo" };
const p = (id: string, prazo: string, dono: "eu" | "time"): Pendencia => ({ ...base, id, prazo, dono, texto: id });

const LISTA = [p("a", "", "eu"), p("b", "2026-10-30", "time"), p("c", "2026-10-18", "eu"), p("d", "2026-10-10", "time")];

test("comUrgencia recalcula pelo dia dado, ignorando a urgência que veio do servidor", () => {
  const r = comUrgencia(LISTA, "2026-10-17");
  assert.deepEqual(r.map((x) => [x.id, x.urgencia]), [["a", "sem-prazo"], ["b", "no-prazo"], ["c", "logo"], ["d", "atrasada"]]);
  // virou o dia: o que vencia amanhã agora vence hoje, e o de ontem continua atrasado
  assert.equal(comUrgencia(LISTA, "2026-10-19")[2].urgencia, "atrasada");
});

test("ordenarPendencias: atrasadas, vencem logo, no prazo, sem prazo", () => {
  const r = ordenarPendencias(comUrgencia(LISTA, "2026-10-17"));
  assert.deepEqual(r.map((x) => x.id), ["d", "c", "b", "a"]);
});

test("filtros: Minhas, Do time e Atrasadas (de qualquer dono)", () => {
  const l = comUrgencia(LISTA, "2026-10-17");
  assert.deepEqual(filtrarPendencias(l, "minhas").map((x) => x.id), ["a", "c"]);
  assert.deepEqual(filtrarPendencias(l, "time").map((x) => x.id), ["b", "d"]);
  assert.deepEqual(filtrarPendencias(l, "atrasadas").map((x) => x.id), ["d"]);
  assert.deepEqual(contarPendencias(l), { minhas: 2, time: 2, atrasadas: 1, total: 4 });
});

test("filtroValido volta para Minhas quando o valor salvo é estranho", () => {
  assert.equal(filtroValido("time"), "time");
  assert.equal(filtroValido("atrasadas"), "atrasadas");
  assert.equal(filtroValido("lixo"), "minhas");
  assert.equal(filtroValido(""), "minhas");
});

test("cada urgência tem ícone e texto (status nunca só por cor)", () => {
  assert.equal(URGENCIAS.atrasada.icone, "🔴");
  assert.equal(URGENCIAS.logo.icone, "🟠");
  assert.equal(URGENCIAS["sem-prazo"].icone, "⚪");
  assert.equal(URGENCIAS.logo.texto, "Vence em até 2 dias");
  for (const u of Object.values(URGENCIAS)) assert.ok(u.texto.length > 0 && u.icone.length > 0);
});

test("textos de dono, estado e botão", () => {
  assert.equal(textoDono("eu").texto, "Com você");
  assert.equal(textoDono("time").texto, "Com o time");
  assert.equal(textoEstado("em andamento"), "Em andamento");
  assert.equal(textoEstado("a fazer"), "A fazer");
  assert.equal(rotuloConcluir({ texto: "Ligar", origem: "Reunião X" }), "Concluir: Ligar (de Reunião X)");
});

test("proximoFoco: o próximo, senão o anterior, senão ninguém", () => {
  assert.equal(proximoFoco(["a", "b", "c"], "b"), "c");
  assert.equal(proximoFoco(["a", "b", "c"], "c"), "b");
  assert.equal(proximoFoco(["a"], "a"), null);
  assert.equal(proximoFoco(["a"], "z"), null);
});

test("resumo e erros em português", () => {
  assert.equal(resumoPendencias({ minhas: 0, time: 0, atrasadas: 0, total: 0 }), "nenhuma pendência");
  assert.equal(resumoPendencias({ minhas: 1, time: 0, atrasadas: 0, total: 1 }), "1 pendência");
  assert.equal(resumoPendencias({ minhas: 2, time: 1, atrasadas: 1, total: 3 }), "3 pendências, 1 atrasada");
  assert.equal(resumoPendencias({ minhas: 2, time: 1, atrasadas: 2, total: 3 }), "3 pendências, 2 atrasadas");
  assert.match(textoErroConclusao(409), /A nota mudou/);
  assert.match(textoErroConclusao(503), /npm run setup/);
  assert.match(textoErroConclusao(500), /Tente de novo/);
});

test("hojeLocal usa o dia local", () => {
  assert.equal(hojeLocal(new Date(2026, 9, 17, 23, 59).getTime()), "2026-10-17");
  assert.equal(hojeLocal(new Date(2026, 9, 18, 0, 1).getTime()), "2026-10-18");
});
