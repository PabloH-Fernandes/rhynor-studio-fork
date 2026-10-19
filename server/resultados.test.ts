// Resultados: contagem por período (limites de dia e de 7 dias), sem dupla contagem, resumo .md e rotas.
// Só pastas temporárias (mkdtemp): nunca o vault de verdade.
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ESTIMATIVAS_PADRAO, FRASE_ESTIMATIVA, type Resultados } from "../shared/resultados.ts";
import { aprovarReuniao } from "./aprovacao.ts";
import { lerCaixaItem } from "./caixa.ts";
import { concluirPendencia, lerPendenciasDaNota, montarPendencias } from "./pendencias.ts";
import { ObservadorResultados, calcularResultados, diaDoInstante, exportarResumo, lerEventosDaNota, montarResumoMd, registrarResultados, type Evento } from "./resultados.ts";
import { AGORA, criarReuniao, novoVaultDeTeste } from "./testeVault.ts";

const HOJE = "2026-10-17"; // AGORA: 2026-10-17 14:30 (local)

const ev = (tipo: Evento["tipo"], dia: string, extra: Partial<Evento> = {}): Evento => ({ tipo, dia, ficticia: false, ...extra });

// ---------------------------------------------------------------- períodos

test("hoje, semana (7 dias corridos contando hoje) e total: limites exatos", () => {
  // semana = 2026-10-11 .. 2026-10-17
  const r = calcularResultados(
    [
      ev("ata-sem-ia", "2026-10-17"), // hoje
      ev("ata-sem-ia", "2026-10-16"), // ontem
      ev("ata-com-ia", "2026-10-11"), // primeiro dia da semana (dentro)
      ev("ata-com-ia", "2026-10-10"), // 7 dias atrás (fora da semana, dentro do total)
      ev("ata-sem-ia", "2026-10-18"), // futuro: só total
    ],
    HOJE,
  );
  assert.equal(r.semanaDesde, "2026-10-11");
  assert.deepEqual(r.atasSemIa, { hoje: 1, semana: 2, total: 3 });
  assert.deepEqual(r.atasComIa, { hoje: 0, semana: 1, total: 2 });
  assert.deepEqual(r.atas, { hoje: 1, semana: 3, total: 5 });
});

test("virada do dia: a mesma nota sai de 'hoje' e continua na semana", () => {
  const eventos = [ev("pendencia", "2026-10-17")];
  assert.deepEqual(calcularResultados(eventos, "2026-10-17").pendenciasFechadas, { hoje: 1, semana: 1, total: 1 });
  assert.deepEqual(calcularResultados(eventos, "2026-10-18").pendenciasFechadas, { hoje: 0, semana: 1, total: 1 });
  assert.deepEqual(calcularResultados(eventos, "2026-10-23").pendenciasFechadas, { hoje: 0, semana: 1, total: 1 }); // 6 dias depois: último dia
  assert.deepEqual(calcularResultados(eventos, "2026-10-24").pendenciasFechadas, { hoje: 0, semana: 0, total: 1 }); // 7 dias depois: fora
});

test("nota sem data não soma em hoje nem semana, só no total (e é contada em semData)", () => {
  const r = calcularResultados([ev("ata-sem-ia", ""), ev("missao", "")], HOJE);
  assert.deepEqual(r.atasSemIa, { hoje: 0, semana: 0, total: 1 });
  assert.deepEqual(r.missoesConcluidas, { hoje: 0, semana: 0, total: 1 });
  assert.equal(r.semData, 2);
});

test("tempo economizado = contagem x minutos de cada tipo, por janela", () => {
  const r = calcularResultados(
    [ev("ata-sem-ia", "2026-10-17"), ev("tarefa", "2026-10-17", { chave: "a" }), ev("tarefa", "2026-10-10", { chave: "b" }), ev("missao", "2026-10-12"), ev("pendencia", "2026-10-17")],
    HOJE,
    { ataProcessada: 20, tarefaAprovada: 10, missaoConcluida: 60, pendenciaFechada: 5 },
  );
  assert.equal(r.tempoEconomizado.hoje, 20 + 10 + 5);
  assert.equal(r.tempoEconomizado.semana, 20 + 10 + 60 + 5);
  assert.equal(r.tempoEconomizado.total, 20 + 10 + 10 + 60 + 5);
  // minutos configurados mudam o resultado
  const zerado = calcularResultados([ev("ata-sem-ia", "2026-10-17")], HOJE, { ...ESTIMATIVAS_PADRAO, ataProcessada: 0 });
  assert.equal(zerado.tempoEconomizado.total, 0);
});

// ---------------------------------------------------------------- leitura das notas

const ATA_SEM_IA = (extra: string[] = [], processada = "2026-10-17T12:00:00") =>
  ["---", "tipo: reuniao", "data: 2026-10-01", "status: rascunho", "origem: leitura-automatica", "processamento: sem-ia", `processada_em: ${processada}`, ...extra, "confidencial: true", "---", "", "# Reunião", ""].join("\n");

test("ata sem IA usa processada_em (dia local), não a data da reunião", () => {
  const ms = new Date(2026, 9, 17, 23, 30).getTime();
  const iso = new Date(ms).toISOString();
  const [e] = lerEventosDaNota("r", "a.md", ATA_SEM_IA([], iso), 0);
  assert.equal(e.tipo, "ata-sem-ia");
  assert.equal(e.dia, "2026-10-17");
  assert.equal(diaDoInstante("2026-02-31T10:00:00Z"), "");
  assert.equal(diaDoInstante("lixo"), "");
  assert.equal(diaDoInstante("2026-10-17"), "2026-10-17");
});

test("ata do /reuniao (facilitator, com IA) usa a data da reunião", () => {
  const nota = ["---", "tipo: reuniao", "data: 2026-10-14", "status: processada", "origem: facilitator", "confidencial: true", "---", "", "# R", ""].join("\n");
  assert.deepEqual(
    lerEventosDaNota("r", "b.md", nota, 0).map((e) => [e.tipo, e.dia]),
    [["ata-com-ia", "2026-10-14"]],
  );
  // sem data e sem processada_em: conta no total
  assert.equal(lerEventosDaNota("r", "c.md", nota.replace("data: 2026-10-14", "data:"), 0)[0].dia, "");
});

test("ficticia: true conta e é marcada; nota que não é reunião nem missão não conta", () => {
  const [e] = lerEventosDaNota("r", "f.md", ATA_SEM_IA(["ficticia: true"]), 0);
  assert.equal(e.ficticia, true);
  const r = calcularResultados([e], HOJE);
  assert.equal(r.atasSemIa.total, 1);
  assert.equal(r.incluiFicticias, true);
  assert.equal(calcularResultados([], HOJE).incluiFicticias, false);
  assert.deepEqual(lerEventosDaNota("r", "x.md", "---\ntipo: missao\n---\n", 0), []);
  assert.deepEqual(lerEventosDaNota("m", "x.md", ATA_SEM_IA(), 0), []);
  assert.deepEqual(lerEventosDaNota("r", "sem-fm.md", "# nada", 0), []);
});

const MISSAO = (fm: string[], tarefas: string[]) => ["---", "tipo: missao", ...fm, "confidencial: false", "---", "", "# M", "", "## Tarefas", ...tarefas, ""].join("\n");

test("reunião escrita à mão (sem origem facilitator nem leitura automática) não conta como ata", () => {
  const mao = ["---", "tipo: reuniao", "data: 2026-10-14", "status: processada", "confidencial: true", "---", "", "# R", "## Tarefas", "- [x] feito | concluída: 2026-10-14", ""].join("\n");
  const ev = lerEventosDaNota("r", "mao.md", mao, 0);
  assert.equal(ev.filter((e) => e.tipo === "ata-com-ia" || e.tipo === "ata-sem-ia").length, 0);
  assert.equal(ev.filter((e) => e.tipo === "pendencia").length, 1, "a pendência fechada continua contando");
  const r = calcularResultados(ev, HOJE, { ...ESTIMATIVAS_PADRAO, pendenciaFechada: 0 });
  assert.equal(r.atas.total, 0);
  assert.equal(r.tempoEconomizado.total, 0);
});

test("missão concluída: concluida_em vale; sem ela NÃO usa o mtime (só no total, 'data aproximada')", () => {
  const mtime = new Date(2026, 9, 15, 9, 0).getTime();
  const [com] = lerEventosDaNota("m", "m1.md", MISSAO(["status: concluída", "concluida_em: 2026-10-16"], ["- [x] a"]), mtime);
  assert.deepEqual([com.tipo, com.dia, com.aproximada], ["missao", "2026-10-16", false]);
  const [sem] = lerEventosDaNota("m", "m2.md", MISSAO(["status: concluída"], ["- [x] a"]), mtime);
  assert.deepEqual([sem.tipo, sem.dia, sem.aproximada], ["missao", "", true]);
  const r = calcularResultados([com, sem], HOJE);
  assert.equal(r.missoesConcluidas.total, 2);
  assert.equal(r.missoesDataAproximada, 1);
  assert.deepEqual(calcularResultados([sem], "2026-10-15").missoesConcluidas, { hoje: 0, semana: 0, total: 1 }, "mtime não vira hoje nem semana");
  assert.match(montarResumoMd(r), /data aproximada/);
  assert.deepEqual(lerEventosDaNota("m", "m3.md", MISSAO(["status: em andamento"], ["- [ ] a"]), mtime), []);
});

test("pendência fechada: só [x] com 'concluída: AAAA-MM-DD' válida", () => {
  const nota = MISSAO(
    ["status: em andamento", "aprovada_em: 2026-10-17T10:00:00"],
    ["- [x] ok | concluída: 2026-10-17", "- [x] sem data", "- [ ] aberta | concluída: 2026-10-17", "- [x] data ruim | concluída: 2026-02-31"],
  );
  const eventos = lerEventosDaNota("m", "m.md", nota, 0);
  assert.equal(eventos.filter((e) => e.tipo === "pendencia").length, 1);
  assert.equal(eventos.filter((e) => e.tipo === "tarefa").length, 4);
});

test("tarefa aprovada: só missão com aprovada_em; [-] ignorada não conta", () => {
  const sem = MISSAO(["status: a fazer"], ["- [ ] a", "- [ ] b"]);
  assert.deepEqual(lerEventosDaNota("m", "m.md", sem, 0), []);
  const com = MISSAO(["status: a fazer", "aprovada_em: 2026-10-17T10:00:00"], ["- [ ] a", "- [-] ignorada", "- [x] b"]);
  assert.equal(lerEventosDaNota("m", "m.md", com, 0).filter((e) => e.tipo === "tarefa").length, 2);
});

test("sem dupla contagem: mesma tarefa em duas missões da mesma reunião conta uma vez", () => {
  const fm = ["status: a fazer", "reuniao: 2026-10-17-x", "aprovada_em: 2026-10-17T10:00:00"];
  const a = lerEventosDaNota("m", "m1.md", MISSAO(fm, ["- [ ] Montar a página", "- [ ] Outra"]), 0);
  const b = lerEventosDaNota("m", "m2.md", MISSAO(fm, ["- [ ] montar a página", "- [ ] Terceira"]), 0);
  const r = calcularResultados([...a, ...b], HOJE);
  assert.equal(r.tarefasAprovadas.total, 3);
  // outra reunião com o mesmo texto: são tarefas diferentes
  const c = lerEventosDaNota("m", "m3.md", MISSAO(["status: a fazer", "reuniao: outra", "aprovada_em: 2026-10-17T10:00:00"], ["- [ ] Montar a página"]), 0);
  assert.equal(calcularResultados([...a, ...b, ...c], HOJE).tarefasAprovadas.total, 4);
});

// ---------------------------------------------------------------- vault de ponta a ponta

test("do vault: ata fictícia, aprovação, conclusões e a missão concluída, sem contar duas vezes", async () => {
  const v = novoVaultDeTeste();
  const obs = new ObservadorResultados(() => v.vault, undefined, { semWatch: true, intervaloMs: 0, now: () => AGORA });
  try {
    await obs.iniciar();
    assert.equal(obs.getResultados().atas.total, 0, "vault vazio");

    const id = await criarReuniao(v, "projeto-software");
    await obs.recarregar();
    let r = obs.getResultados();
    assert.deepEqual(r.atasSemIa, { hoje: 1, semana: 1, total: 1 });
    assert.equal(r.tarefasAprovadas.total, 0, "ainda não foi aprovada");
    assert.equal(r.incluiFicticias, true, "a ata do gerador é fictícia");

    const item = lerCaixaItem(`${id}.md`, fs.readFileSync(path.join(v.reunioes, `${id}.md`), "utf8"));
    assert.ok(item && item.tarefas.length >= 3);
    const decisoes = item.tarefas.map((t, i) => ({ n: t.n, h: t.h, acao: i === 0 ? "eu" : i === 1 ? "ignorar" : "time" }));
    const doTime = decisoes.filter((d) => d.acao === "time").length;
    const ap = await aprovarReuniao(v.vault, { reuniao: id, decisoes }, { now: () => AGORA });
    assert.equal(ap.status, 200);
    const missao = (ap.corpo as { missao: string }).missao;
    await obs.recarregar();
    r = obs.getResultados();
    // as tarefas "Time faz" existem na reunião E na missão: contam uma vez (as da missão); "eu" e ignorada não contam
    assert.deepEqual(r.tarefasAprovadas, { hoje: doTime, semana: doTime, total: doTime });
    assert.equal(r.atas.total, 1, "aprovar não cria outra ata");
    assert.equal(r.missoesConcluidas.total, 0);

    // fecha as pendências da missão pelo mesmo caminho do painel: a última conclui a missão
    const arqMissao = path.join(v.missoes, `${missao}.md`);
    const texto = fs.readFileSync(arqMissao, "utf8");
    const pend = montarPendencias(lerPendenciasDaNota("m", `${missao}.md`, texto), HOJE);
    assert.equal(pend.length, doTime);
    for (const p of pend) assert.equal((await concluirPendencia(v.vault, { id: p.id, h: p.h }, { now: () => AGORA })).status, 200);
    // a tarefa "eu" da reunião
    const eu = montarPendencias(lerPendenciasDaNota("r", `${id}.md`, fs.readFileSync(path.join(v.reunioes, `${id}.md`), "utf8")), HOJE);
    assert.equal(eu.length, 1);
    assert.equal((await concluirPendencia(v.vault, { id: eu[0].id, h: eu[0].h }, { now: () => AGORA })).status, 200);

    await obs.recarregar();
    r = obs.getResultados();
    assert.deepEqual(r.missoesConcluidas, { hoje: 1, semana: 1, total: 1 });
    assert.equal(r.missoesDataAproximada, 0, "a conclusão automática grava concluida_em");
    assert.deepEqual(r.pendenciasFechadas, { hoje: doTime + 1, semana: doTime + 1, total: doTime + 1 });
    const e = ESTIMATIVAS_PADRAO;
    assert.equal(r.tempoEconomizado.total, e.ataProcessada + doTime * e.tarefaAprovada + e.missaoConcluida + (doTime + 1) * e.pendenciaFechada);
    assert.equal(r.ficticias, 1 + doTime + 1 + doTime + 1, "ata, tarefas, missão e pendências vindas da ata fictícia");
  } finally {
    obs.parar();
    v.limpar();
  }
});

test("os números vêm das notas: apagar a nota derruba a contagem; observador novo (reinício) dá o mesmo", async () => {
  const v = novoVaultDeTeste();
  const novo = () => new ObservadorResultados(() => v.vault, undefined, { semWatch: true, intervaloMs: 0, now: () => AGORA });
  const obs = novo();
  try {
    const id = await criarReuniao(v, "so-decisoes");
    await obs.iniciar();
    assert.equal(obs.getResultados().atas.total, 1);
    const depoisDoReinicio = novo();
    await depoisDoReinicio.iniciar();
    assert.deepEqual(depoisDoReinicio.getResultados(), obs.getResultados());
    depoisDoReinicio.parar();
    fs.rmSync(path.join(v.reunioes, `${id}.md`));
    await obs.recarregar();
    assert.equal(obs.getResultados().atas.total, 0);
  } finally {
    obs.parar();
    v.limpar();
  }
});

test("cache por mtime: nota que não mudou não é aberta de novo; a que mudou é relida", async () => {
  const v = novoVaultDeTeste();
  const obs = new ObservadorResultados(() => v.vault, undefined, { semWatch: true, intervaloMs: 0, now: () => AGORA });
  try {
    const arq = path.join(v.reunioes, "2026-10-17-a.md");
    fs.writeFileSync(arq, ATA_SEM_IA());
    await obs.iniciar();
    assert.equal(obs.getResultados().atasSemIa.total, 1);
    let avisos = 0;
    obs.subscribe(() => avisos++);
    await obs.recarregar();
    assert.equal(avisos, 0, "nada mudou: ninguém é avisado");
    fs.writeFileSync(arq, ATA_SEM_IA([], "2026-10-10T12:00:00") + "\nmais texto\n");
    await obs.recarregar();
    assert.deepEqual(obs.getResultados().atasSemIa, { hoje: 0, semana: 0, total: 1 });
    assert.equal(avisos, 1);
  } finally {
    obs.parar();
    v.limpar();
  }
});

test("vault não configurado ou pasta ausente: tudo zero, sem erro", async () => {
  const obs = new ObservadorResultados(() => null, undefined, { semWatch: true, intervaloMs: 0, now: () => AGORA });
  await obs.iniciar();
  assert.equal(obs.getResultados().atas.total, 0);
  obs.parar();
  const vazio = fs.mkdtempSync(path.join(os.tmpdir(), "res-vazio-"));
  const obs2 = new ObservadorResultados(() => vazio, undefined, { semWatch: true, intervaloMs: 0, now: () => AGORA });
  try {
    await obs2.iniciar();
    assert.equal(obs2.getResultados().missoesConcluidas.total, 0);
  } finally {
    obs2.parar();
    fs.rmSync(vazio, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- resumo e exportação

function exemplo(): Resultados {
  return calcularResultados(
    [ev("ata-sem-ia", "2026-10-17", { ficticia: true }), ev("ata-com-ia", "2026-10-12"), ev("tarefa", "2026-10-17", { chave: "k" }), ev("missao", "2026-10-17", { aproximada: true }), ev("pendencia", "")],
    HOJE,
  );
}

test("montarResumoMd traz números, período, 'estimativa' e a frase fixa", () => {
  const md = montarResumoMd(exemplo());
  assert.match(md, /^# Resumo de resultados do AG Pocket/);
  assert.match(md, /Semana: 11\/10\/2026 a 17\/10\/2026/);
  assert.match(md, /\| Atas processadas \| 1 \| 2 \| 2 \|/);
  assert.match(md, /\| - lidas sem IA \| 1 \| 1 \| 1 \|/);
  assert.match(md, /\| - com IA \(\/reuniao\) \| 0 \| 1 \| 1 \|/);
  assert.match(md, /\| Tarefas aprovadas \| 1 \| 1 \| 1 \|/);
  assert.match(md, /\| Pendências fechadas \| 0 \| 0 \| 1 \|/);
  // padrões (tarefa e pendência = 0): hoje 20 + 60 = 80 min; semana: + ata com IA (20) = 100; total igual (pendência vale 0)
  assert.match(md, /\| Tempo economizado \(estimativa\) \| 1 h 20 min \| 1 h 40 min \| 1 h 40 min \|/);
  assert.ok(md.includes(FRASE_ESTIMATIVA));
  assert.match(md, /demonstração/);
  assert.match(md, /sem data entram só no total/);
  assert.ok(!md.includes("undefined") && !md.includes("NaN"));
});

test("sem dado fictício o resumo não fala em demonstração", () => {
  const md = montarResumoMd(calcularResultados([ev("ata-sem-ia", "2026-10-17")], HOJE));
  assert.ok(!md.includes("demonstração"));
  assert.ok(md.includes(FRASE_ESTIMATIVA));
});

test("exportarResumo grava resultados-AAAA-MM-DD.md na pasta dada e devolve o mesmo texto", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "res-exp-"));
  try {
    const sub = path.join(dir, "exportacoes");
    const e = await exportarResumo(exemplo(), sub);
    assert.equal(e.arquivo, "resultados-2026-10-17.md");
    assert.equal(fs.readFileSync(path.join(sub, e.arquivo), "utf8"), e.texto);
    assert.ok(e.texto.includes(FRASE_ESTIMATIVA));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rotas: GET exige Host local; POST exportar exige JSON e Origin do painel e grava o .md", async () => {
  const v = novoVaultDeTeste();
  const dirExp = path.join(v.vault, "exportacoes-teste");
  await criarReuniao(v, "projeto-software");
  const obs = new ObservadorResultados(() => v.vault, undefined, { semWatch: true, intervaloMs: 0, now: () => AGORA });
  await obs.iniciar();
  const app = express();
  let porta = 0;
  registrarResultados(app, { resultados: obs, porta: () => porta, dirExportacoes: dirExp });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  porta = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${porta}`;
  try {
    const get = await fetch(`${base}/api/resultados`);
    assert.equal(get.status, 200);
    const corpo = (await get.json()) as { resultados: Resultados };
    assert.equal(corpo.resultados.atasSemIa.total, 1);
    // o corpo traz só números: nenhum título nem texto de nota
    assert.ok(!JSON.stringify(corpo).includes("Responsável"));

    const post = (headers: Record<string, string>) => fetch(`${base}/api/resultados/exportar`, { method: "POST", headers, body: "{}" });
    assert.equal((await post({ "Content-Type": "text/plain" })).status, 415);
    assert.equal((await post({ "Content-Type": "application/json", Origin: "http://evil.com" })).status, 403);
    assert.ok(!fs.existsSync(dirExp), "pedido recusado não grava nada");

    const ok = await post({ "Content-Type": "application/json", Origin: base });
    assert.equal(ok.status, 200);
    const exp = (await ok.json()) as { ok: boolean; arquivo: string; texto: string };
    assert.equal(exp.arquivo, `resultados-${corpo.resultados.hoje}.md`);
    assert.ok(exp.texto.includes(FRASE_ESTIMATIVA));
    assert.equal(fs.readFileSync(path.join(dirExp, exp.arquivo), "utf8"), exp.texto);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    obs.parar();
    v.limpar();
  }
});
