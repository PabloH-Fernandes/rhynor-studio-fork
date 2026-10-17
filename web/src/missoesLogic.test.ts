import assert from "node:assert/strict";
import { test } from "node:test";
import type { Missao, MissoesInfo } from "../../shared/types";
import {
  ABAS_MISSOES,
  abaPelaTecla,
  abaValida,
  ehAtual,
  mostraAbas,
  separarMissoes,
  textoAtaNova,
  textoDataMissao,
  textoLimiteConcluidas,
  textoReuniao,
  textoTarefas,
  totaisDe,
  vazioDaAba,
  vazioDe,
} from "./missoesLogic";
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
  // com a leitura sem IA ligada, só a ata fora do formato precisa do /reuniao
  assert.equal(textoAtaNova(1, 1), "📥 Uma ata precisa do /reuniao: ela veio fora do formato");
  assert.equal(textoAtaNova(2, 2), "📥 2 atas precisam do /reuniao: vieram fora do formato");
  assert.equal(textoAtaNova(0, 0), null);
  // leitura sem IA ligada: `novas` não avisa, só o fora do formato
  assert.equal(textoAtaNova(3, 0), null);
  assert.equal(textoAtaNova(NaN, 0), null);
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

test("mostraAbas: só com pelo menos 1 missão", () => {
  assert.equal(mostraAbas(null), false);
  assert.equal(mostraAbas(info({ vault: "sem-vault" })), false);
  assert.equal(mostraAbas(info({ vault: "sem-pasta" })), false);
  assert.equal(mostraAbas(info()), false);
  assert.equal(mostraAbas(info({ missoes: [{ id: "a", status: "concluída" } as Missao] })), true);
});

test("abaValida: desconhecido volta para abertas", () => {
  assert.deepEqual(ABAS_MISSOES, ["abertas", "concluidas"]);
  assert.equal(abaValida("abertas"), "abertas");
  assert.equal(abaValida("concluidas"), "concluidas");
  assert.equal(abaValida(""), "abertas");
  assert.equal(abaValida("concluídas"), "abertas");
});

test("separarMissoes: por status, mantendo a ordem", () => {
  const m = (id: string, status: Missao["status"]) => ({ id, status });
  const lista = [m("1", "em andamento"), m("2", "concluída"), m("3", "a fazer"), m("4", "concluída")];
  const s = separarMissoes(lista);
  assert.deepEqual(s.abertas.map((x) => x.id), ["1", "3"]);
  assert.deepEqual(s.concluidas.map((x) => x.id), ["2", "4"]);
  assert.deepEqual(separarMissoes([]), { abertas: [], concluidas: [] });
});

test("vazioDaAba", () => {
  const nada = { abertas: [], concluidas: [] };
  const so = { abertas: [], concluidas: [1] };
  assert.equal(vazioDaAba("concluidas", nada), "Nenhuma missão concluída ainda.");
  assert.equal(vazioDaAba("concluidas", so), null);
  assert.equal(vazioDaAba("abertas", so), "Nenhuma missão aberta. As concluídas estão na outra aba.");
  assert.equal(vazioDaAba("abertas", { abertas: [1], concluidas: [] }), null);
});

test("abaPelaTecla: setas circulares, Home, End e tecla desconhecida", () => {
  assert.equal(abaPelaTecla("abertas", "ArrowRight"), "concluidas");
  assert.equal(abaPelaTecla("concluidas", "ArrowRight"), "abertas");
  assert.equal(abaPelaTecla("abertas", "ArrowLeft"), "concluidas");
  assert.equal(abaPelaTecla("concluidas", "ArrowLeft"), "abertas");
  assert.equal(abaPelaTecla("concluidas", "Home"), "abertas");
  assert.equal(abaPelaTecla("abertas", "End"), "concluidas");
  assert.equal(abaPelaTecla("abertas", "Enter"), null);
  assert.equal(abaPelaTecla("abertas", "ArrowDown"), null);
});

test("textoDataMissao: data da nota sem fuso, senão atualizadoEm, senão null", () => {
  assert.equal(textoDataMissao({ data: "2026-01-01", atualizadoEm: 0 }), "01/01/2026");
  assert.equal(textoDataMissao({ data: "2026-10-09", atualizadoEm: Date.UTC(2020, 0, 1) }), "09/10/2026");
  const ms = new Date(2026, 2, 5, 23, 30).getTime(); // horário local
  assert.equal(textoDataMissao({ data: "", atualizadoEm: ms }), "05/03/2026");
  assert.equal(textoDataMissao({ data: "", atualizadoEm: 0 }), null);
  assert.equal(textoDataMissao({ data: "lixo", atualizadoEm: NaN }), null);
  // data inválida cai em atualizadoEm
  assert.equal(textoDataMissao({ data: "2026-13-45", atualizadoEm: ms }), "05/03/2026");
  assert.equal(textoDataMissao({ data: "2026-02-31", atualizadoEm: 0 }), null);
  assert.equal(textoDataMissao({ data: "2026-00-10", atualizadoEm: 0 }), null);
  assert.equal(textoDataMissao({ data: "2024-02-29", atualizadoEm: 0 }), "29/02/2024");
  assert.equal(textoDataMissao({ data: "", atualizadoEm: 0 }), null);
});

test("textoLimiteConcluidas: só quando o total passa do mostrado", () => {
  assert.equal(textoLimiteConcluidas(50, 55), "Mostrando as 50 mais recentes de 55");
  assert.equal(textoLimiteConcluidas(50, 50), null, "exatamente 50: sem corte, sem aviso");
  assert.equal(textoLimiteConcluidas(3, 3), null);
  assert.equal(textoLimiteConcluidas(0, 0), null);
});

test("totaisDe: usa os totais do servidor; sem eles, o tamanho das listas", () => {
  const sep = { abertas: [1, 2], concluidas: [1] };
  assert.deepEqual(totaisDe(info({ totais: { abertas: 55, concluidas: 60 } }), sep), { abertas: 55, concluidas: 60 });
  assert.deepEqual(totaisDe(info(), sep), { abertas: 2, concluidas: 1 });
  assert.deepEqual(totaisDe(null, { abertas: [], concluidas: [] }), { abertas: 0, concluidas: 0 });
});
