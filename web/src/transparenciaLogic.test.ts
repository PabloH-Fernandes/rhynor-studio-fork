import assert from "node:assert/strict";
import { test } from "node:test";
import { semTipos, tipoInformativo, type RegistroTransparencia, type ResumoTransparencia } from "../../shared/transparencia";
import {
  NOTA_LIMITE,
  NOTA_PERMISSAO,
  TEXTO_VIOLACAO,
  contadoresAtas,
  ehResumoTransparencia,
  horaDe,
  marcaDoNivel,
  montarAlertas,
  montarLinhas,
  montarViolacoes,
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

const resumo = (recentes: RegistroTransparencia[], extra: Partial<ResumoTransparencia> = {}): ResumoTransparencia => {
  const viol = recentes.filter((r) => r.nivel === "violacao");
  const por = semTipos();
  for (const r of recentes) {
    const t = tipoInformativo(r);
    if (t) por[t]++;
  }
  return {
    mes: "2026-10",
    total: recentes.length,
    normais: recentes.filter((r) => r.nivel === "normal").length,
    informativos: recentes.filter((r) => r.nivel === "informativo").length,
    informativosPor: por,
    violacoes: viol.length,
    ultimaViolacao: viol.length ? { ts: viol[viol.length - 1].ts, arquivo: viol[viol.length - 1].arquivo } : null,
    violacoesRecentes: viol.slice(-5),
    atas: null,
    recentes,
    ...extra,
  };
};

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

test("montarAlertas: vermelho só com violação, âmbar um por tipo de aviso; o texto vem junto", () => {
  assert.deepEqual(montarAlertas(resumo([reg("normal", "a.md")])), []);
  const so = montarAlertas(resumo([reg("violacao", "10-Reunioes/r.md")]));
  assert.equal(so.length, 1);
  assert.equal(so[0].tipo, "violacao");
  assert.equal(so[0].titulo, "ATENÇÃO: um agente leu uma nota confidencial");
  assert.equal(so[0].titulo, TEXTO_VIOLACAO);
  assert.ok(so[0].detalhe.includes("1 vez") && so[0].detalhe.includes("10-Reunioes/r.md") && so[0].detalhe.includes("14:05:09"));
  assert.ok(so[0].detalhe.includes("seção Violações"));
  assert.deepEqual(so[0].ultima, { hora: "14:05:09", arquivo: "10-Reunioes/r.md" });
  const dois = montarAlertas(resumo([reg("violacao", "x.md"), reg("informativo", "00-Inbox/a.md"), reg("informativo", "00-Inbox/b.md")]));
  assert.deepEqual(dois.map((a) => a.tipo), ["violacao", "informativo"]);
  assert.equal(dois[1].titulo, "Esperado: a reunião (/reuniao) abriu a ata do Inbox");
  assert.ok(dois[1].detalhe.startsWith("2 vezes"));
  // cada tipo tem o seu texto: ata do Inbox, outra nota confidencial na reunião, busca na raiz, alteração
  const tipos = montarAlertas(
    resumo([
      reg("informativo", "00-Inbox/a.md"),
      reg("informativo", "30-Projetos/reservada.md"),
      reg("informativo", ".", { acao: "buscou", ferramenta: "Grep" }),
      reg("informativo", "10-Reunioes/n.md", { acao: "editou", ferramenta: "Edit" }),
    ]),
  );
  assert.deepEqual(
    tipos.map((a) => a.titulo),
    [
      "Esperado: a reunião (/reuniao) abriu a ata do Inbox",
      "Esperado: a reunião abriu uma nota confidencial",
      "Aviso: busca na raiz do vault pode alcançar notas confidenciais",
      "Aviso: um agente alterou uma nota em pasta confidencial",
    ],
  );
  assert.equal(new Set(tipos.map((a) => a.chave)).size, 4);
  // a última violação vem do resumo, mesmo quando já saiu da lista curta (tempo real, sem recarregar)
  const antiga = montarAlertas(resumo([], { violacoes: 3, total: 3, ultimaViolacao: { ts: TS, arquivo: "10-Reunioes/velha.md" } }));
  assert.ok(antiga[0].detalhe.startsWith("3 vezes neste mês; a última às 14:05:09, em 10-Reunioes/velha.md"));
  assert.equal(antiga[0].ultima?.arquivo, "10-Reunioes/velha.md");
});

test("montarViolacoes e ids: violações fora da janela continuam na lista; a chave não muda quando a lista anda", () => {
  const v = (n: number) => reg("violacao", `10-Reunioes/n${n}.md`, { ts: TS + n * 1000 });
  const r = resumo(Array.from({ length: 20 }, (_, i) => reg("normal", `n${i}.md`, { ts: TS + 100_000 + i })), {
    violacoes: 7,
    violacoesRecentes: [v(1), v(2), v(3), v(4), v(5)],
  });
  const viol = montarViolacoes(r);
  assert.equal(viol.length, 5);
  assert.equal(viol[0].arquivo, "10-Reunioes/n5.md", "mais nova primeiro");
  assert.ok(viol.every((l) => l.nivel === "violacao" && l.marca === "ATENÇÃO"));
  // a chave de uma linha é a mesma depois que entra uma linha nova
  const antes = montarLinhas(r);
  const depois = montarLinhas({ ...r, recentes: [...r.recentes.slice(1), reg("normal", "novo.md", { ts: TS + 200_000 })] });
  const idDe = (ls: typeof antes, arq: string) => ls.find((l) => l.arquivo === arq)?.id;
  assert.equal(idDe(antes, "n10.md"), idDe(depois, "n10.md"));
  assert.equal(new Set(antes.map((l) => l.id)).size, antes.length);
  // linhas iguais no mesmo instante ainda têm chaves diferentes
  const iguais = montarLinhas(resumo([reg("normal", "a.md"), reg("normal", "a.md")]));
  assert.notEqual(iguais[0].id, iguais[1].id);
  // marcas: Aviso (busca na raiz) x Esperado (ata do Inbox)
  const m = montarLinhas(resumo([reg("informativo", ".", { acao: "buscou" }), reg("informativo", "00-Inbox/a.md")]));
  assert.deepEqual(m.map((l) => l.marca), ["Esperado", "Aviso"]);
});

test("contadoresAtas: o valor é o do MÊS do resumo e o rótulo diz isso", () => {
  assert.equal(contadoresAtas(null), null);
  assert.equal(contadoresAtas(resumo([])), null);
  const c = contadoresAtas(resumo([], { atas: { semIa: 4, comIa: 1 } }));
  assert.deepEqual(c, {
    mes: "2026-10",
    semIa: 4,
    comIa: 1,
    rotulo: "Atas neste mês (2026-10)",
    frase: "Atas neste mês (2026-10): 4 sem IA, 1 com IA (/reuniao).",
    nomeSemIa: "atas sem IA",
    nomeComIa: "ata com IA (/reuniao)",
  });
});

test("contadoresAtas: singular com 1, plural com 0 ou mais de 1", () => {
  const nomes = (semIa: number, comIa: number) => {
    const c = contadoresAtas(resumo([], { atas: { semIa, comIa } }));
    return [c?.nomeSemIa, c?.nomeComIa];
  };
  assert.deepEqual(nomes(1, 2), ["ata sem IA", "atas com IA (/reuniao)"]);
  assert.deepEqual(nomes(0, 0), ["atas sem IA", "atas com IA (/reuniao)"]);
});

test("a nota de limite diz o que não é visto", () => {
  assert.ok(NOTA_LIMITE.includes("Só registra o que chegou do Claude Code ao servidor"));
  assert.ok(NOTA_LIMITE.includes("cat, type"));
  assert.ok(NOTA_PERMISSAO.includes("antes de o Claude Code pedir ou negar a permissão") && NOTA_PERMISSAO.includes("leitura negada também aparece"));
});

test("ehResumoTransparencia e resumoDoGet: aceitam a forma certa e recusam o resto", () => {
  const ok = resumo([reg("normal", "a.md")]);
  assert.ok(ehResumoTransparencia(ok));
  assert.ok(!ehResumoTransparencia(null));
  assert.ok(!ehResumoTransparencia({ ...ok, recentes: [{ ts: "x" }] }));
  assert.ok(!ehResumoTransparencia({ ...ok, violacoes: "1" }));
  const get = resumoDoGet({ mes: "2026-10", linhas: ok.recentes, contagens: { total: 1, normais: 1, informativos: 0, violacoes: 0 }, atas: { semIa: 2, comIa: 0 } });
  assert.deepEqual(get, { ...ok, atas: { semIa: 2, comIa: 0 } });
  // o GET traz a última violação e as violações recentes (fora das linhas): a tela fica igual à do WebSocket
  const viol = reg("violacao", "10-Reunioes/v.md");
  const comViol = resumoDoGet({
    mes: "2026-10",
    linhas: ok.recentes,
    contagens: { total: 9, normais: 1, informativos: 0, violacoes: 8, informativosPor: { "busca-raiz": 0 } },
    alerta: { ultima: TS, ultimaArquivo: "10-Reunioes/v.md", recentes: [viol] },
    atas: { semIa: 1, comIa: 1 },
  });
  assert.deepEqual(comViol?.ultimaViolacao, { ts: TS, arquivo: "10-Reunioes/v.md" });
  assert.deepEqual(comViol?.violacoesRecentes, [viol]);
  assert.deepEqual(comViol?.atas, { semIa: 1, comIa: 1 });
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
