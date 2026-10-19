import assert from "node:assert/strict";
import { test } from "node:test";
import { ESTIMATIVAS_PADRAO, type Resultados } from "../../shared/resultados";
import type { RegistroTransparencia, ResumoTransparencia } from "../../shared/transparencia";
import {
  NOTA_LIMITE,
  TEXTO_VIOLACAO,
  contadoresAtas,
  ehResumoTransparencia,
  horaDe,
  marcaDoNivel,
  montarAlertas,
  montarLinhas,
  nomeArquivoMd,
  plural,
  resumoDoGet,
  textoErroExportar,
} from "./transparenciaLogic";

const TS = new Date(2026, 9, 17, 14, 5, 9).getTime();

const reg = (nivel: RegistroTransparencia["nivel"], arquivo: string, extra: Partial<RegistroTransparencia> = {}): RegistroTransparencia => ({
  ts: TS,
  sessao: "s1",
  agente: "dev",
  ferramenta: "Read",
  acao: "leu",
  arquivo,
  confidencial: nivel !== "normal",
  missao: null,
  via: "PreToolUse",
  nivel,
  ...extra,
});

const resumo = (recentes: RegistroTransparencia[], extra: Partial<ResumoTransparencia> = {}): ResumoTransparencia => ({
  mes: "2026-10",
  total: recentes.length,
  normais: recentes.filter((r) => r.nivel === "normal").length,
  informativos: recentes.filter((r) => r.nivel === "informativo").length,
  violacoes: recentes.filter((r) => r.nivel === "violacao").length,
  recentes,
  ...extra,
});

test("horaDe: HH:MM:SS com zero à esquerda", () => {
  assert.equal(horaDe(TS), "14:05:09");
});

test("montarLinhas: mais nova primeiro, marca em texto (não só cor) e frase para o leitor de tela", () => {
  const l = montarLinhas(resumo([reg("normal", "a.md"), reg("informativo", "00-Inbox/ata.md"), reg("violacao", "10-Reunioes/r.md", { acao: "buscou" })]));
  assert.deepEqual(l.map((x) => x.arquivo), ["10-Reunioes/r.md", "00-Inbox/ata.md", "a.md"]);
  assert.deepEqual(l.map((x) => x.marca), ["ATENÇÃO", "Esperado", ""]);
  assert.equal(l[0].frase, "14:05:09, dev buscou em 10-Reunioes/r.md (ATENÇÃO)");
  assert.equal(l[2].frase, "14:05:09, dev leu a.md");
  assert.equal(marcaDoNivel("normal"), "");
  assert.equal(montarLinhas(resumo(Array.from({ length: 30 }, (_, i) => reg("normal", `n${i}.md`))), 5).length, 5);
});

test("montarAlertas: vermelho só com violação, âmbar só com informativo; o texto vem junto", () => {
  assert.deepEqual(montarAlertas(resumo([reg("normal", "a.md")])), []);
  const so = montarAlertas(resumo([reg("violacao", "10-Reunioes/r.md")]));
  assert.equal(so.length, 1);
  assert.equal(so[0].tipo, "violacao");
  assert.equal(so[0].titulo, "ATENÇÃO: um agente leu uma nota confidencial");
  assert.equal(so[0].titulo, TEXTO_VIOLACAO);
  assert.ok(so[0].detalhe.includes("1 vez") && so[0].detalhe.includes("10-Reunioes/r.md") && so[0].detalhe.includes("14:05:09"));
  const dois = montarAlertas(resumo([reg("violacao", "x.md"), reg("informativo", "00-Inbox/a.md"), reg("informativo", "00-Inbox/b.md")]));
  assert.deepEqual(dois.map((a) => a.tipo), ["violacao", "informativo"]);
  assert.ok(dois[1].detalhe.startsWith("2 vezes"));
  // violação que já saiu da lista curta: o aviso continua, sem a última linha
  const antiga = montarAlertas(resumo([], { violacoes: 3, total: 3 }));
  assert.ok(antiga[0].detalhe.startsWith("3 vezes neste mês."));
});

test("contadoresAtas: sem IA e com IA vêm do total de Resultados", () => {
  assert.equal(contadoresAtas(null), null);
  const p = (total: number) => ({ hoje: 0, semana: 0, total });
  const r = { atasSemIa: p(4), atasComIa: p(1), estimativas: ESTIMATIVAS_PADRAO } as unknown as Resultados;
  assert.deepEqual(contadoresAtas(r), { semIa: 4, comIa: 1, frase: "Atas sem IA: 4. Atas com IA (/reuniao): 1." });
});

test("a nota de limite diz o que não é visto", () => {
  assert.ok(NOTA_LIMITE.includes("Só registra o que chegou do Claude Code ao servidor"));
  assert.ok(NOTA_LIMITE.includes("cat, type"));
});

test("ehResumoTransparencia e resumoDoGet: aceitam a forma certa e recusam o resto", () => {
  const ok = resumo([reg("normal", "a.md")]);
  assert.ok(ehResumoTransparencia(ok));
  assert.ok(!ehResumoTransparencia(null));
  assert.ok(!ehResumoTransparencia({ ...ok, recentes: [{ ts: "x" }] }));
  assert.ok(!ehResumoTransparencia({ ...ok, violacoes: "1" }));
  const get = resumoDoGet({ mes: "2026-10", linhas: ok.recentes, contagens: { total: 1, normais: 1, informativos: 0, violacoes: 0 } });
  assert.deepEqual(get, ok);
  assert.equal(resumoDoGet({ mes: "2026-10" }), null);
  assert.equal(resumoDoGet(undefined), null);
});

test("pequenos textos", () => {
  assert.equal(plural(1, "vez", "vezes"), "1 vez");
  assert.equal(plural(2, "vez", "vezes"), "2 vezes");
  assert.equal(nomeArquivoMd("2026-10"), "2026-10.md");
  assert.ok(textoErroExportar(403).includes("Recarregue"));
  assert.ok(textoErroExportar(500).includes("Tente de novo"));
});
