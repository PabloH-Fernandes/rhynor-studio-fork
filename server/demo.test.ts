// A simulação inteira no relógio virtual do replay: o que a missão v3 trouxe aparece no feed
// (frases simples, destaques, agrupamento), ninguém sai antes do fim e a dev-2 ganha a plaquinha dela.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { comNome, temJargao } from "../shared/frases.ts";
import { DEFAULT_ROSTER } from "../shared/roster.ts";
import type { FeedItem } from "../shared/types.ts";
import { agruparFeed, destaqueDe, fraseDaLinha } from "../web/src/feedLogic.ts";
import { numeroNoPapel, rotuloDaMesa } from "../web/src/office/deskLabel.ts";
import { cancelDemo, DEMO_JANELA_REPETIDO_MS, iniciarDemo, runDemo } from "./demo.ts";
import { agentes, RelogioVirtual } from "./replay.ts";
import { OfficeState } from "./state.ts";

const T0 = Date.parse("2026-10-05T10:00:00");

afterEach(() => {
  cancelDemo();
});

test("simulação v3: destaques, frases sem jargão, grupo de leituras, compact, dev-2 e ninguém sai antes do fim", () => {
  const relogio = new RelogioVirtual(T0);
  const state = new OfficeState({ relogio, sweepEveryMs: 0 });
  const feed: FeedItem[] = [];
  state.subscribe((m) => {
    if (m.type === "feed") feed.push(m.item);
  });
  const { durationMs } = runDemo(state, relogio);
  assert.ok(durationMs <= 180_000, `a simulação devia caber em ~3 min (${durationMs} ms)`);

  // até o SessionEnd: o time só cresce, ninguém vai até a porta
  let maxTime = 0;
  let devsJuntos = false;
  for (let passou = 500; passou < durationMs; passou += 500) {
    relogio.avancarAte(T0 + passou);
    const agora = agentes(state);
    assert.ok(agora.every((a) => a.status !== "saindo"), `alguém saiu em ${passou} ms`);
    assert.ok(agora.length >= maxTime, `o time encolheu em ${passou} ms`);
    maxTime = agora.length;
    const ativo = (id: string) => agora.some((a) => a.id === id && a.status !== "ocioso");
    devsJuntos ||= ativo("ag:dev") && ativo("ag:dev-2");
  }
  assert.ok(maxTime >= 8, `líder + 7 do time (o recolher da barra faz sentido): ${maxTime}`);
  assert.ok(devsJuntos, "dev e dev-2 deviam trabalhar ao mesmo tempo");

  // 2 da mesma função: DESENVOLVIMENTO e DESENVOLVIMENTO 2
  const dev2 = agentes(state).find((a) => a.id === "ag:dev-2");
  assert.ok(dev2?.agzinho, "a dev-2 devia estar no escritório");
  const ags = DEFAULT_ROSTER.agzinhos;
  assert.equal(rotuloDaMesa("dev", { papel: "dev", numero: numeroNoPapel(ags, "dev") }), "DESENVOLVIMENTO");
  assert.equal(rotuloDaMesa("dev", { papel: "dev", numero: numeroNoPapel(ags, dev2.agzinho) }), "DESENVOLVIMENTO 2");

  // frases simples: todas sem jargão (com o nome na frente, como o feed mostra)
  const simples = feed.filter((f) => f.simples);
  assert.ok(simples.length > 40, `poucas frases: ${simples.length}`);
  for (const f of simples) assert.ok(!temJargao(comNome(f.quem ?? "", f.simples!)), `jargão: ${f.quem} ${f.simples}`);

  // os 4 destaques
  const destaques = new Set(feed.map((f) => destaqueDe(f.categoria)).filter(Boolean));
  for (const d of ["precisa", "terminou", "etapa", "concluido"]) assert.ok(destaques.has(d as never), `faltou o destaque ${d}`);
  assert.ok(feed.some((f) => f.categoria === "concluido" && f.simples === "concluiu as 6 etapas: trabalho concluído"));

  // grupo de leituras, pesquisa com tema e o compact sem ninguém sair
  const linhas = agruparFeed(feed).map((l) => (l.item.quem ? comNome(l.item.quem, fraseDaLinha(l) ?? "") : ""));
  assert.ok(linhas.includes("Marina está estudando o projeto (5 arquivos)"), linhas.join("\n"));
  assert.ok(feed.some((f) => f.simples === "está pesquisando na internet sobre “validação de formulários”"));
  assert.ok(feed.some((f) => f.simples === "organizou as anotações da conversa para continuar"));

  // a retomada: o pesquisador foi chamado de novo (SendMessage pro agent_id dele) e entregou 2 vezes, mesmo AGzinho
  assert.equal(agentes(state).find((a) => a.id === "ag:pesquisador")?.tasksDone, 2);
  const deNovo = feed.filter((f) => f.agentId === "ag:pesquisador" && f.simples === "foi chamado de novo para ajudar");
  assert.equal(deNovo.length, 1, "uma linha só, mesmo com SendMessage + 1º evento dele");

  // SessionEnd: agora sim todo mundo vai até a porta
  relogio.avancarAte(T0 + durationMs);
  assert.ok(agentes(state).every((a) => a.status === "saindo"));
});

test("POST /api/demo repetido em menos de 5 s devolve a mesma simulação, sem reiniciar", () => {
  const relogio = new RelogioVirtual(T0);
  const state = new OfficeState({ relogio, sweepEveryMs: 0 });
  let agora = T0;
  const primeira = iniciarDemo(state, () => agora, relogio);
  assert.equal(primeira.repetido, false);
  relogio.avancarAte(T0 + 3_000);
  const antes = agentes(state).map((a) => a.id).sort();

  agora = T0 + 3_000;
  const segunda = iniciarDemo(state, () => agora, relogio);
  assert.equal(segunda.repetido, true);
  assert.equal(segunda.session_id, primeira.session_id);
  assert.equal(segunda.durationMs, primeira.durationMs);
  assert.deepEqual(agentes(state).map((a) => a.id).sort(), antes, "ninguém saiu nem chegou por causa do repetido");

  // depois da janela: reinicia (sessão nova); o "Limpar" também libera
  agora = T0 + DEMO_JANELA_REPETIDO_MS + 10;
  const terceira = iniciarDemo(state, () => agora, relogio);
  assert.equal(terceira.repetido, false);
  cancelDemo();
  const quarta = iniciarDemo(state, () => agora, relogio);
  assert.equal(quarta.repetido, false, "depois do reset a simulação começa de novo");
});
