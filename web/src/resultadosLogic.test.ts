import assert from "node:assert/strict";
import { test } from "node:test";
import { ESTIMATIVAS_PADRAO, type Resultados } from "../../shared/resultados";
import { avisosDosResultados, comoEstimamos, ehResultados, montarLinhas, nomeArquivoResumo, plural, resumoTopo, semResultados, tempoTopo, textoErroExportar } from "./resultadosLogic";

const p = (hoje: number, semana: number, total: number) => ({ hoje, semana, total });

const R: Resultados = {
  hoje: "2026-10-17",
  semanaDesde: "2026-10-11",
  atas: p(1, 3, 5),
  atasSemIa: p(1, 2, 3),
  atasComIa: p(0, 1, 2),
  tarefasAprovadas: p(2, 4, 9),
  missoesConcluidas: p(0, 1, 2),
  pendenciasFechadas: p(1, 1, 4),
  tempoEconomizado: p(45, 130, 400),
  estimativas: { ...ESTIMATIVAS_PADRAO },
  missoesDataAproximada: 0,
  semData: 0,
  ficticias: 0,
  incluiFicticias: false,
};

test("montarLinhas: atas com detalhe sem IA / com IA, e o tempo sempre rotulado como estimativa", () => {
  const l = montarLinhas(R);
  assert.deepEqual(
    l.map((x) => [x.id, x.detalhe]),
    [["atas", false], ["atas-sem-ia", true], ["atas-com-ia", true], ["tarefas", false], ["missoes", false], ["pendencias", false], ["tempo", false]],
  );
  const tempo = l[l.length - 1];
  assert.equal(tempo.rotulo, "Tempo economizado (estimativa)");
  assert.equal(tempo.estimativa, true);
  assert.deepEqual([tempo.hoje, tempo.semana, tempo.total], ["45 min", "2 h 10 min", "6 h 40 min"]);
  assert.match(tempo.frase, /estimativa/);
  assert.deepEqual([l[0].hoje, l[0].semana, l[0].total], ["1", "3", "5"]);
  assert.equal(l[3].frase, "Tarefas aprovadas: hoje 2, na semana 4, no total 9");
});

test("resumoTopo e tempoTopo: o tempo nunca aparece sem a palavra estimativa", () => {
  assert.equal(resumoTopo(R), "Hoje: 1 ata · 2 tarefas aprovadas · 0 missões concluídas · 1 pendência fechada");
  assert.equal(tempoTopo(R), "45 min economizados hoje (estimativa)");
  assert.ok(tempoTopo({ ...R, tempoEconomizado: p(0, 0, 0) }).includes("estimativa"));
});

test("plural", () => {
  assert.equal(plural(1, "ata", "atas"), "1 ata");
  assert.equal(plural(0, "ata", "atas"), "0 atas");
  assert.equal(plural(2, "ata", "atas"), "2 atas");
});

test("semResultados só quando nada foi contado", () => {
  const zero = p(0, 0, 0);
  const vazio: Resultados = { ...R, atas: zero, atasSemIa: zero, atasComIa: zero, tarefasAprovadas: zero, missoesConcluidas: zero, pendenciasFechadas: zero, tempoEconomizado: zero };
  assert.equal(semResultados(vazio), true);
  assert.equal(semResultados({ ...vazio, pendenciasFechadas: p(0, 0, 1) }), false);
});

test("avisosDosResultados: fictícios, data aproximada e sem data", () => {
  assert.deepEqual(avisosDosResultados(R), []);
  const a = avisosDosResultados({ ...R, incluiFicticias: true, ficticias: 3, missoesDataAproximada: 1, semData: 2 });
  assert.equal(a.length, 3);
  assert.match(a[0], /demonstração/);
  assert.match(a[1], /1 missão concluída está com data aproximada/);
  assert.match(a[2], /2 itens sem data entram só no total/);
});

test("comoEstimamos usa os minutos configurados e aponta o arquivo", () => {
  const t = comoEstimamos({ ...R, estimativas: { ataProcessada: 30, tarefaAprovada: 10, missaoConcluida: 90, pendenciaFechada: 5 } });
  assert.match(t, /cada ata vale 30 min/i);
  assert.match(t, /missão concluída 1 h 30 min/);
  assert.match(t, /data\/estimativas\.json/);
});

test("nome do arquivo e mensagens de erro em português simples", () => {
  assert.equal(nomeArquivoResumo("2026-10-17"), "resultados-2026-10-17.md");
  assert.match(textoErroExportar(403), /Recarregue/);
  assert.match(textoErroExportar(500), /Não consegui/);
});

test("ehResultados recusa corpo que não tem a forma esperada", () => {
  assert.equal(ehResultados(R), true);
  assert.equal(ehResultados(null), false);
  assert.equal(ehResultados({}), false);
  assert.equal(ehResultados({ ...R, atas: { hoje: "1" } }), false);
  assert.equal(ehResultados({ ...R, estimativas: null }), false);
});
