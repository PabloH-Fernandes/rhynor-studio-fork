import assert from "node:assert/strict";
import { test } from "node:test";
import type { Missao, MissoesInfo } from "../../shared/types";
import { ehAtual, textoAtaNova, textoReuniao, textoTarefas, vazioDe } from "./missoesLogic";
import { segmentosCheios } from "./progresso";

const info = (extra: Partial<MissoesInfo> = {}): MissoesInfo => ({
  vault: "ok",
  missoes: [],
  inbox: { novas: 0 },
  atual: null,
  ...extra,
});

test("textoTarefas: singular e plural", () => {
  assert.equal(textoTarefas(2, 5), "2 de 5 tarefas feitas");
  assert.equal(textoTarefas(0, 1), "0 de 1 tarefa feita");
});

test("textoReuniao: só com origem reuniao e título", () => {
  assert.equal(textoReuniao({ origem: "reuniao", reuniaoTitulo: "Alinhamento" }), "📋 da reunião Alinhamento");
  assert.equal(textoReuniao({ origem: "manual", reuniaoTitulo: "Alinhamento" }), null);
  assert.equal(textoReuniao({ origem: "reuniao", reuniaoTitulo: "  " }), null);
});

test("textoAtaNova", () => {
  assert.equal(textoAtaNova(0), null);
  assert.equal(textoAtaNova(NaN), null);
  assert.equal(textoAtaNova(1), "📥 Chegou uma ata nova: rode /reuniao");
  assert.equal(textoAtaNova(3), "📥 Chegaram 3 atas novas: rode /reuniao");
});

test("vazioDe", () => {
  assert.equal(vazioDe(null), null);
  assert.equal(vazioDe(info({ vault: "sem-vault" })), "sem-vault");
  assert.equal(vazioDe(info({ vault: "sem-pasta" })), "sem-missao");
  assert.equal(vazioDe(info()), "sem-missao");
  const m = { id: "a" } as Missao;
  assert.equal(vazioDe(info({ missoes: [m] })), null);
});

test("ehAtual e segmentos da barra", () => {
  assert.equal(ehAtual(info({ atual: { id: "a", nome: "A", reuniaoTitulo: "" } }), { id: "a" }), true);
  assert.equal(ehAtual(info(), { id: "a" }), false);
  assert.equal(ehAtual(null, { id: "a" }), false);
  assert.equal(segmentosCheios(2, 5), 4);
  assert.equal(segmentosCheios(0, 0), 0);
});
