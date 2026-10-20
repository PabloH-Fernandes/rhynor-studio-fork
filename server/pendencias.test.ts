// Pendências: varredura de 10-Reunioes/ e 20-Missoes/ e conclusão de tarefa. Só pastas temporárias (mkdtemp).
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";
import type { Pendencia } from "../shared/types.ts";
import { aprovarReuniao } from "./aprovacao.ts";
import { lerCaixaItem } from "./caixa.ts";
import { ObservadorPendencias, concluirPendencia, lerPendenciasDaNota, montarPendencias, registrarPendencias, validarConclusao } from "./pendencias.ts";
import { AGORA, criarReuniao, novoVaultDeTeste, type VaultDeTeste } from "./testeVault.ts";
import { parseMissao } from "./vault.ts";
import { lerEventosDaNota } from "./resultados.ts";

const HOJE = "2026-10-17";

const REUNIAO = [
  "---",
  "tipo: reuniao",
  "data: 2026-10-10",
  "status: processada",
  "origem: leitura-automatica",
  "confidencial: true",
  "---",
  "",
  "# Planejamento da sprint",
  "",
  "## Pauta e notas",
  "- segredo da pauta",
  "",
  "## Tarefas",
  "- [ ] Ligar para o fornecedor | responsável: Responsável A | prazo: 2026-10-15 | classe: eu",
  "- [ ] Montar a página | responsável: Responsável B | prazo: 2026-10-30 | classe: time",
  "- [ ] Ainda sem classe | responsável: | prazo: | classe: ?",
  "- [x] Já feita | responsável: Responsável A | prazo: | classe: eu",
  "- [-] Ignorada | responsável: | prazo: | classe: eu",
  "- [ ] Revisar o contrato [[Contrato]] | responsável: Responsável A | prazo: 2026-02-31 | classe: eu",
  "",
  "## Dúvidas",
  "- segredo da dúvida",
  "",
].join("\n");

const MISSAO = (extra: string[] = [], status = "a fazer") =>
  [
    "---",
    "tipo: missao",
    `status: ${status}`,
    "origem: reuniao",
    "reuniao_titulo: Planejamento da sprint",
    ...extra,
    "confidencial: false",
    "---",
    "",
    "# Tarefas: Planejamento da sprint",
    "",
    "## Tarefas",
    "- [ ] Montar a página | prazo: 2026-10-30",
    "- [x] Passo feito | prazo: 2026-10-01 | concluída: 2026-10-02",
    "- [ ] Passo sem prazo",
    "",
    "## Resultado",
    "- [ ] linha de outra seção não conta",
    "",
  ].join("\n");

test("reunião: só entram as linhas - [ ] com classe eu (texto sem sufixos, prazo inválido some)", () => {
  const p = lerPendenciasDaNota("r", "2026-10-10-planejamento.md", REUNIAO);
  assert.deepEqual(
    p.map((x) => [x.texto, x.responsavel, x.prazo, x.origem, x.dono, x.status]),
    [
      ["Ligar para o fornecedor", "Responsável A", "2026-10-15", "Planejamento da sprint", "eu", "a fazer"],
      ["Revisar o contrato Contrato", "Responsável A", "", "Planejamento da sprint", "eu", "a fazer"],
    ],
  );
  assert.match(p[0].id, /^r:2026-10-10-planejamento:1:[0-9a-f]{8}$/);
  assert.match(p[1].id, /^r:2026-10-10-planejamento:6:[0-9a-f]{8}$/);
  assert.ok(!JSON.stringify(p).includes("segredo"));
});

test("a tabela do /reuniao (sem checkbox) não entra", () => {
  const tabela = ["---", "tipo: reuniao", "---", "# R", "## Tarefas", "| # | Tarefa | Responsável | Prazo | Classe |", "|---|---|---|---|---|", "| 1 | Algo | X | 2026-10-31 | 🙋 |"].join("\n");
  assert.deepEqual(lerPendenciasDaNota("r", "r.md", tabela), []);
});

test("missão: toda linha - [ ] da seção Tarefas, dono time; humano e duvida ficam com eu", () => {
  const time = lerPendenciasDaNota("m", "2026-10-10-missao.md", MISSAO(["classe: time"]));
  assert.deepEqual(
    time.map((x) => [x.texto, x.prazo, x.origem, x.dono]),
    [
      ["Montar a página", "2026-10-30", "Planejamento da sprint", "time"],
      ["Passo sem prazo", "", "Planejamento da sprint", "time"],
    ],
  );
  for (const classe of ["humano", "duvida", "dúvida"]) {
    const p = lerPendenciasDaNota("m", "m.md", MISSAO([`classe: ${classe}`]));
    assert.deepEqual(
      p.map((x) => x.dono),
      ["eu", "eu"],
      classe,
    );
  }
  assert.equal(lerPendenciasDaNota("m", "m.md", MISSAO([], "em andamento"))[0].status, "em andamento");
});

test("missão concluída, confidencial, de outro tipo ou com nome estranho não entra", () => {
  assert.deepEqual(lerPendenciasDaNota("m", "m.md", MISSAO([], "concluída")), []);
  assert.deepEqual(lerPendenciasDaNota("m", "m.md", MISSAO(["confidencial: true"])), []);
  assert.deepEqual(lerPendenciasDaNota("m", "m.md", MISSAO().replace("tipo: missao", "tipo: nota")), []);
  assert.deepEqual(lerPendenciasDaNota("m", "a.b.md", MISSAO()), []);
  assert.deepEqual(lerPendenciasDaNota("r", "m.md", MISSAO()), []); // missão na pasta de reuniões
});

test("montarPendencias ordena: atrasadas, logo, no prazo, sem prazo, e marca a urgência", () => {
  const p = montarPendencias(
    [
      { id: "a", prazo: "" },
      { id: "b", prazo: "2026-12-01" },
      { id: "c", prazo: "2026-10-18" },
      { id: "d", prazo: "2026-10-01" },
    ].map((x) => ({ ...x, h: "0", texto: x.id, responsavel: "", origem: "", dono: "eu" as const, status: "a fazer" as const })),
    HOJE,
  );
  assert.deepEqual(
    p.map((x) => [x.id, x.urgencia]),
    [
      ["d", "atrasada"],
      ["c", "logo"],
      ["b", "no-prazo"],
      ["a", "sem-prazo"],
    ],
  );
});

/** reunião fictícia aprovada: a 1ª tarefa fica com "eu", as demais com o time */
async function reuniaoAprovada(v: VaultDeTeste) {
  const id = await criarReuniao(v, "projeto-software");
  const item = lerCaixaItem(`${id}.md`, fs.readFileSync(path.join(v.reunioes, `${id}.md`), "utf8"));
  assert.ok(item && item.tarefas.length >= 2);
  const r = await aprovarReuniao(
    v.vault,
    { reuniao: id, decisoes: item.tarefas.map((t, i) => ({ n: t.n, h: t.h, acao: i === 0 ? "eu" : "time" })) },
    { now: () => AGORA },
  );
  assert.equal(r.status, 200);
  return { id, item, missao: (r.corpo as { missao: string | null }).missao };
}

test("reunião aprovada dá 1 pendência 'eu' e a missão dá as do time, sem duplicar", async () => {
  const v = novoVaultDeTeste();
  try {
    const { item, missao } = await reuniaoAprovada(v);
    assert.ok(missao);
    const obs = new ObservadorPendencias(() => v.vault, { semWatch: true, intervaloMs: 0, now: () => AGORA });
    await obs.iniciar();
    const itens = obs.getItens();
    const eu = itens.filter((p) => p.dono === "eu");
    const time = itens.filter((p) => p.dono === "time");
    assert.equal(eu.length, 1);
    assert.equal(eu[0].id.startsWith("r:"), true);
    assert.equal(time.length, item.tarefas.length - 1);
    assert.ok(time.every((p) => p.id.startsWith("m:")));
    assert.equal(new Set(itens.map((p) => p.texto)).size, itens.length); // nenhum texto nas duas origens
    obs.parar();
  } finally {
    v.limpar();
  }
});

test("o cenário projeto-software tem tarefa vencida (atrasada)", async () => {
  const v = novoVaultDeTeste();
  try {
    await reuniaoAprovada(v);
    const obs = new ObservadorPendencias(() => v.vault, { semWatch: true, intervaloMs: 0, now: () => new Date(2027, 0, 1) });
    await obs.iniciar();
    assert.ok(obs.getItens().some((p) => p.urgencia === "atrasada"));
    obs.parar();
  } finally {
    v.limpar();
  }
});

test("o observador avisa quando uma nota muda, e esvazia sem vault", async () => {
  const v = novoVaultDeTeste();
  try {
    fs.writeFileSync(path.join(v.reunioes, "2026-10-10-a.md"), REUNIAO);
    let vault: string | null = v.vault;
    const obs = new ObservadorPendencias(() => vault, { semWatch: true, intervaloMs: 0, now: () => AGORA });
    const avisos: Pendencia[][] = [];
    obs.subscribe((i) => avisos.push(i));
    await obs.iniciar();
    assert.equal(obs.getItens().length, 2);
    assert.equal(avisos.length, 1);
    await obs.recarregar(); // nada mudou: não avisa de novo
    assert.equal(avisos.length, 1);
    fs.writeFileSync(path.join(v.missoes, "2026-10-10-m.md"), MISSAO());
    await obs.recarregar();
    assert.equal(obs.getItens().length, 4);
    vault = null;
    await obs.recarregar();
    assert.deepEqual(obs.getItens(), []);
    obs.parar();
  } finally {
    v.limpar();
  }
});

// ---------------------------------------------------------------- concluir

const ler = (arq: string) => fs.readFileSync(arq, "utf8");

test("validarConclusao só aceita id no formato, nunca caminho", () => {
  assert.ok(validarConclusao({ id: "r:2026-10-10-a:1:0123abcd", h: "89abcdef" }).ok);
  assert.ok(validarConclusao({ id: "m:Missão de teste:2:0123abcd", h: "89abcdef" }).ok);
  const ruins: unknown[] = [
    null,
    [],
    { id: "x:a:1:0123abcd", h: "89abcdef" },
    { id: "r:../segredo:1:0123abcd", h: "89abcdef" },
    { id: "r:a/b:1:0123abcd", h: "89abcdef" },
    { id: "r:a\\b:1:0123abcd", h: "89abcdef" },
    { id: "r:a.md:1:0123abcd", h: "89abcdef" },
    { id: "r: a:1:0123abcd", h: "89abcdef" },
    { id: "r:a:0:0123abcd", h: "89abcdef" },
    { id: "r:a:1:zzzzzzzz", h: "89abcdef" },
    { id: "r:a:1:0123abcd", h: "curto" },
    { id: "r:a:1:0123abcd" },
    { id: 5, h: "89abcdef" },
  ];
  for (const r of ruins) assert.equal(validarConclusao(r).ok, false, JSON.stringify(r));
});

function pendenciaDe(pasta: "r" | "m", nome: string, texto: string, i: number): Pendencia {
  const p = montarPendencias(lerPendenciasDaNota(pasta, `${nome}.md`, texto), HOJE).sort((a, b) => (a.id < b.id ? -1 : 1))[i];
  assert.ok(p);
  return p;
}

test("concluir marca [x], acrescenta a data e mexe só nessa linha", async () => {
  const v = novoVaultDeTeste();
  try {
    const arq = path.join(v.reunioes, "2026-10-10-a.md");
    fs.writeFileSync(arq, REUNIAO);
    const p = pendenciaDe("r", "2026-10-10-a", REUNIAO, 0);
    assert.equal(p.texto, "Ligar para o fornecedor");
    const r = await concluirPendencia(v.vault, { id: p.id, h: p.h }, { now: () => AGORA });
    assert.equal(r.status, 200);
    assert.equal(
      ler(arq),
      REUNIAO.replace(
        "- [ ] Ligar para o fornecedor | responsável: Responsável A | prazo: 2026-10-15 | classe: eu",
        "- [x] Ligar para o fornecedor | responsável: Responsável A | prazo: 2026-10-15 | classe: eu | concluída: 2026-10-17",
      ),
    );
    // já concluída: o mesmo pedido agora dá 409
    assert.equal((await concluirPendencia(v.vault, { id: p.id, h: p.h }, { now: () => AGORA })).status, 409);
  } finally {
    v.limpar();
  }
});

test("concluir mantém CRLF e BOM e não muda o status da missão", async () => {
  const v = novoVaultDeTeste();
  try {
    const arq = path.join(v.missoes, "2026-10-10-m.md");
    const original = "\uFEFF" + MISSAO(["classe: time"]).replace(/\n/g, "\r\n");
    fs.writeFileSync(arq, original);
    const p = pendenciaDe("m", "2026-10-10-m", original, 1); // ordem por id: 1 = "Passo sem prazo" (posição 3)
    assert.equal(p.texto, "Passo sem prazo");
    const r = await concluirPendencia(v.vault, { id: p.id, h: p.h }, { now: () => AGORA });
    assert.equal(r.status, 200);
    const depois = ler(arq);
    assert.equal(depois, original.replace("- [ ] Passo sem prazo", "- [x] Passo sem prazo | concluída: 2026-10-17"));
    assert.ok(depois.startsWith("\uFEFF---\r\n"));
    assert.ok(!/[^\r]\n/.test(depois), "só CRLF");
    assert.match(depois, /status: a fazer/);
  } finally {
    v.limpar();
  }
});

test("409 quando a linha mudou desde que o painel leu (prazo ou posição)", async () => {
  const v = novoVaultDeTeste();
  try {
    const arq = path.join(v.reunioes, "2026-10-10-a.md");
    fs.writeFileSync(arq, REUNIAO);
    const p = pendenciaDe("r", "2026-10-10-a", REUNIAO, 0);
    // prazo editado na nota
    fs.writeFileSync(arq, REUNIAO.replace("prazo: 2026-10-15 | classe: eu", "prazo: 2026-10-20 | classe: eu"));
    assert.equal((await concluirPendencia(v.vault, { id: p.id, h: p.h })).status, 409);
    // linha nova no começo da seção: o número aponta para outra tarefa
    fs.writeFileSync(arq, REUNIAO.replace("## Tarefas\n", "## Tarefas\n- [ ] Nova | responsável: | prazo: | classe: eu\n"));
    assert.equal((await concluirPendencia(v.vault, { id: p.id, h: p.h })).status, 409);
    assert.ok(!ler(arq).includes("concluída:"));
  } finally {
    v.limpar();
  }
});

test("409 quando a nota muda no meio (lstat) e nada é gravado; 404 e 400 nos casos de borda", async () => {
  const v = novoVaultDeTeste();
  try {
    const arq = path.join(v.reunioes, "2026-10-10-a.md");
    fs.writeFileSync(arq, REUNIAO);
    const p = pendenciaDe("r", "2026-10-10-a", REUNIAO, 0);
    const r = await concluirPendencia(v.vault, { id: p.id, h: p.h }, { antesDeGravar: () => fs.appendFileSync(arq, "\n- editado por outro programa\n") });
    assert.equal(r.status, 409);
    assert.ok(!ler(arq).includes("concluída:"));

    assert.equal((await concluirPendencia(v.vault, { id: "r:nao-existe:1:0123abcd", h: "89abcdef" })).status, 404);
    assert.equal((await concluirPendencia(v.vault, { id: "r:../x:1:0123abcd", h: "89abcdef" })).status, 400);
    // uma missão não se conclui pela pasta de reuniões
    fs.writeFileSync(path.join(v.missoes, "mm.md"), MISSAO());
    const m = pendenciaDe("m", "mm", MISSAO(), 0);
    assert.equal((await concluirPendencia(v.vault, { id: m.id.replace(/^m:/, "r:"), h: m.h })).status, 404);
  } finally {
    v.limpar();
  }
});

test("rotas: GET exige Host local; POST exige JSON e Origin do painel; concluir grava e o observador atualiza", async () => {
  const v = novoVaultDeTeste();
  const arq = path.join(v.reunioes, "2026-10-10-a.md");
  fs.writeFileSync(arq, REUNIAO);
  const obs = new ObservadorPendencias(() => v.vault, { semWatch: true, intervaloMs: 0, now: () => AGORA });
  await obs.iniciar();
  const app = express();
  let porta = 0;
  registrarPendencias(app, { resolverVault: () => v.vault, pendencias: obs, porta: () => porta, now: () => AGORA });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  porta = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${porta}`;
  try {
    const get = await fetch(`${base}/api/pendencias`);
    assert.equal(get.status, 200);
    const { itens } = (await get.json()) as { itens: Pendencia[] };
    assert.equal(itens.length, 2);
    const corpo = JSON.stringify({ id: itens[0].id, h: itens[0].h });

    const semJson = await fetch(`${base}/api/pendencias/concluir`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: corpo });
    assert.equal(semJson.status, 415);
    const fora = await fetch(`${base}/api/pendencias/concluir`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.com" }, body: corpo });
    assert.equal(fora.status, 403);
    assert.ok(!ler(arq).includes("concluída:"));

    const ok = await fetch(`${base}/api/pendencias/concluir`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: corpo });
    assert.equal(ok.status, 200);
    assert.ok(ler(arq).includes("concluída: 2026-10-17"));
    assert.equal(obs.getItens().length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    obs.parar();
    v.limpar();
  }
});

test("concluir acha a nota cujo nome está em NFD no disco (OneDrive de Mac)", async (t) => {
  const v = novoVaultDeTeste();
  try {
    const nfc = "2026-10-10-reunião-á";
    const nfd = nfc.normalize("NFD");
    assert.notEqual(nfc, nfd);
    const arq = path.join(v.reunioes, `${nfd}.md`);
    fs.writeFileSync(arq, REUNIAO);
    if (!fs.readdirSync(v.reunioes).some((n) => n === `${nfd}.md`)) {
      t.skip("o sistema de arquivos normaliza o nome para NFC: não dá para criar um nome NFD aqui");
      return;
    }
    const p = pendenciaDe("r", nfc, REUNIAO, 0);
    const r = await concluirPendencia(v.vault, { id: p.id, h: p.h }, { now: () => AGORA });
    assert.equal(r.status, 200);
    assert.ok(ler(arq).includes("concluída:"));
  } finally {
    v.limpar();
  }
});

// ---------------------------------------------------------------- conclusão automática da missão (Etapa 4)

const MISSAO_DUAS = [
  "---",
  "tipo: missao",
  "status: em andamento",
  "origem: reuniao",
  "classe: time",
  "confidencial: false",
  "---",
  "",
  "# Tarefas: Duas coisas",
  "",
  "## Tarefas",
  "- [ ] Primeira",
  "- [-] Ignorada",
  "- [ ] Segunda",
  "",
].join("\n");

test("missão cancelada, pausada ou com outro status não é concluída pela última tarefa", async () => {
  const v = novoVaultDeTeste();
  try {
    for (const status of ["cancelada", "pausada", "bloqueada"]) {
      const nome = `2026-10-10-${status}.md`;
      const arq = path.join(v.missoes, nome);
      const original = MISSAO_DUAS.replace("status: em andamento", `status: ${status}`).replace("- [ ] Segunda", "- [x] Segunda | concluída: 2026-10-10");
      fs.writeFileSync(arq, original);
      const [a] = montarPendencias(lerPendenciasDaNota("m", nome, original), HOJE);
      const r = await concluirPendencia(v.vault, { id: a.id, h: a.h }, { now: () => AGORA });
      assert.equal(r.status, 200);
      assert.equal((r.corpo as { missaoConcluida?: boolean }).missaoConcluida, undefined, status);
      assert.match(ler(arq), new RegExp(`status: ${status}`));
      assert.ok(!ler(arq).includes("concluida_em"));
      assert.match(ler(arq), /- [x] Primeira | concluída: 2026-10-17/, "a tarefa foi marcada mesmo assim");
    }
    // status vazio e 'a fazer' ainda concluem
    for (const [i, status] of ["", "a fazer", "aprovada"].entries()) {
      const nome = `2026-10-11-ok${i}.md`;
      const arq = path.join(v.missoes, nome);
      const original = MISSAO_DUAS.replace("status: em andamento", `status: ${status}`).replace("- [ ] Segunda", "- [x] Segunda | concluída: 2026-10-10");
      fs.writeFileSync(arq, original);
      const [a] = montarPendencias(lerPendenciasDaNota("m", nome, original), HOJE);
      const r = await concluirPendencia(v.vault, { id: a.id, h: a.h }, { now: () => AGORA });
      assert.equal((r.corpo as { missaoConcluida?: boolean }).missaoConcluida, true, status || "vazio");
      assert.match(ler(arq), /status: concluída/);
    }
  } finally {
    v.limpar();
  }
});

test("concluir a última tarefa da missão grava status concluída e concluida_em (CRLF e BOM mantidos)", async () => {
  const v = novoVaultDeTeste();
  try {
    const arq = path.join(v.missoes, "2026-10-10-duas.md");
    const original = "﻿" + MISSAO_DUAS.replace(/\n/g, "\r\n");
    fs.writeFileSync(arq, original);
    const [a, b] = montarPendencias(lerPendenciasDaNota("m", "2026-10-10-duas.md", original), HOJE).sort((x, y) => (x.id < y.id ? -1 : 1));
    // a primeira: a missão continua em andamento
    const r1 = await concluirPendencia(v.vault, { id: a.id, h: a.h }, { now: () => AGORA });
    assert.equal(r1.status, 200);
    assert.equal((r1.corpo as { missaoConcluida?: boolean }).missaoConcluida, undefined);
    assert.match(ler(arq), /status: em andamento/);
    assert.ok(!ler(arq).includes("concluida_em"));
    // a última: a ignorada ([-]) não segura a conclusão
    const r2 = await concluirPendencia(v.vault, { id: b.id, h: b.h }, { now: () => AGORA });
    assert.equal(r2.status, 200);
    assert.equal((r2.corpo as { missaoConcluida?: boolean }).missaoConcluida, true);
    const depois = ler(arq);
    assert.equal(
      depois,
      original
        .replace("status: em andamento", "status: concluída")
        .replace("confidencial: false", "confidencial: false\r\nconcluida_em: 2026-10-17")
        .replace("- [ ] Primeira", "- [x] Primeira | concluída: 2026-10-17")
        .replace("- [ ] Segunda", "- [x] Segunda | concluída: 2026-10-17"),
    );
    assert.ok(depois.startsWith("﻿---\r\n"));
    assert.ok(!/[^\r]\n/.test(depois), "só CRLF");
    // a missão concluída sai das pendências
    assert.deepEqual(lerPendenciasDaNota("m", "2026-10-10-duas.md", depois), []);
  } finally {
    v.limpar();
  }
});

test("conclusão automática respeita as travas: nota que mudou no meio não vira concluída", async () => {
  const v = novoVaultDeTeste();
  try {
    const arq = path.join(v.missoes, "2026-10-10-uma.md");
    const texto = MISSAO_DUAS.replace("- [ ] Segunda\n", "");
    fs.writeFileSync(arq, texto);
    const [p] = montarPendencias(lerPendenciasDaNota("m", "2026-10-10-uma.md", texto), HOJE);
    const r = await concluirPendencia(v.vault, { id: p.id, h: p.h }, { now: () => AGORA, antesDeGravar: () => fs.appendFileSync(arq, "\nedição no meio\n") });
    assert.equal(r.status, 409);
    assert.ok(!ler(arq).includes("concluída"));
    assert.ok(!ler(arq).includes("concluida_em"));
  } finally {
    v.limpar();
  }
});

test("tarefa de reunião concluída nunca muda status de nota de reunião", async () => {
  const v = novoVaultDeTeste();
  try {
    const arq = path.join(v.reunioes, "2026-10-10-a.md");
    const texto = REUNIAO.replace("- [ ] Revisar o contrato [[Contrato]] | responsável: Responsável A | prazo: 2026-02-31 | classe: eu\n", "");
    fs.writeFileSync(arq, texto);
    const p = pendenciaDe("r", "2026-10-10-a", texto, 0);
    assert.equal((await concluirPendencia(v.vault, { id: p.id, h: p.h }, { now: () => AGORA })).status, 200);
    assert.match(ler(arq), /status: processada/);
    assert.ok(!ler(arq).includes("concluida_em"));
  } finally {
    v.limpar();
  }
});

test("reabrir: desmarcar a tarefa com a marca devolve a pendência; concluir de novo põe uma marca só", async () => {
  const v = novoVaultDeTeste();
  try {
    const nome = "2026-10-10-duas.md";
    const arq = path.join(v.missoes, nome);
    const original = "﻿" + MISSAO_DUAS.replace(/\n/g, "\r\n");
    fs.writeFileSync(arq, original);
    const amanha = new Date(2026, 9, 18, 9, 0);
    // fecha as duas tarefas: a missão conclui
    for (let i = 0; i < 2; i++) {
      const [p] = montarPendencias(lerPendenciasDaNota("m", nome, ler(arq)), HOJE);
      assert.equal((await concluirPendencia(v.vault, { id: p.id, h: p.h }, { now: () => AGORA })).status, 200);
    }
    assert.match(ler(arq), /status: concluída/);
    assert.match(ler(arq), /concluida_em: 2026-10-17/);
    assert.deepEqual(lerPendenciasDaNota("m", nome, ler(arq)), []);

    // o dono desmarca uma tarefa no Obsidian (a marca da data fica na linha)
    const aberta = ler(arq).replace("- [x] Segunda | concluída: 2026-10-17", "- [ ] Segunda | concluída: 2026-10-17");
    assert.notEqual(aberta, ler(arq));
    fs.writeFileSync(arq, aberta);
    const reaberta = lerPendenciasDaNota("m", nome, aberta);
    assert.equal(reaberta.length, 1);
    assert.equal(reaberta[0].texto, "Segunda");
    assert.equal(reaberta[0].status, "em andamento");

    // concluir de novo: uma marca só, com a data nova, e a missão volta a concluída com a data nova
    const [p] = montarPendencias(reaberta, HOJE);
    const r = await concluirPendencia(v.vault, { id: p.id, h: p.h }, { now: () => amanha });
    assert.equal(r.status, 200);
    assert.equal((r.corpo as { missaoConcluida?: boolean }).missaoConcluida, true);
    const depois = ler(arq);
    assert.equal(depois.match(/Segunda[^\r\n]*/)![0], "Segunda | concluída: 2026-10-18");
    assert.match(depois, /concluida_em: 2026-10-18/);
    assert.ok(!depois.includes("concluida_em: 2026-10-17"));
    assert.ok(depois.startsWith("﻿---\r\n"));
    assert.ok(!/[^\r]\n/.test(depois), "só CRLF");
    assert.deepEqual(lerPendenciasDaNota("m", nome, depois), []);
  } finally {
    v.limpar();
  }
});

test("reabrir: cancelada e pausada com '- [ ]' + marca não mudam; concluída com '- [ ]' sem marca continua concluída", () => {
  for (const status of ["cancelada", "pausada"]) {
    const t = MISSAO_DUAS.replace("status: em andamento", `status: ${status}`).replace("- [ ] Segunda", "- [ ] Segunda | concluída: 2026-10-10");
    // a marca não muda nada: o resultado é o mesmo de antes da Etapa 6.5 (status e pendências iguais ao da nota sem marca)
    const sem = t.replace(" | concluída: 2026-10-10", "");
    const resumo = (x: string) => lerPendenciasDaNota("m", "m.md", x).map((p) => [p.texto, p.status]);
    assert.deepEqual(resumo(t), resumo(sem), status);
    assert.equal(parseMissao("m.md", t, 0)?.status, parseMissao("m.md", sem, 0)?.status, status);
  }
  const semMarca = MISSAO_DUAS.replace("status: em andamento", "status: concluída");
  assert.deepEqual(lerPendenciasDaNota("m", "m.md", semMarca), []);
  assert.equal(parseMissao("m.md", semMarca, 0)?.status, "concluída");
  const comMarca = semMarca.replace("- [ ] Segunda", "- [ ] Segunda | concluída: 2026-10-10");
  assert.equal(parseMissao("m.md", comMarca, 0)?.status, "em andamento");
  assert.equal(lerPendenciasDaNota("m", "m.md", comMarca.replace("confidencial: false", "confidencial: true")).length, 0, "confidencial continua fora");
});

test("reunião classe eu: desmarcar a tarefa concluída devolve a pendência", () => {
  const feita = REUNIAO.replace(
    "- [ ] Ligar para o fornecedor | responsável: Responsável A | prazo: 2026-10-15 | classe: eu",
    "- [x] Ligar para o fornecedor | responsável: Responsável A | prazo: 2026-10-15 | classe: eu | concluída: 2026-10-17",
  );
  assert.ok(!lerPendenciasDaNota("r", "a.md", feita).some((p) => p.texto === "Ligar para o fornecedor"));
  const desmarcada = feita.replace("- [x] Ligar", "- [ ] Ligar");
  assert.ok(lerPendenciasDaNota("r", "a.md", desmarcada).some((p) => p.texto === "Ligar para o fornecedor"));
});

test("atas fictícias aprovadas como 'eu' aparecem em Pendências com a urgência certa (atrasada, logo, sem prazo)", async () => {
  const v = novoVaultDeTeste();
  try {
    const querEu: Record<string, string[]> = {
      "projeto-software": ["Trocar o login antigo pelo novo", "Criar o ambiente de testes com dados inventados"],
      "tarefas-sem-prazo": ["Combinar com a equipe um horário fixo para o acompanhamento"],
    };
    for (const [cenario, textos] of Object.entries(querEu)) {
      const id = await criarReuniao(v, cenario as "projeto-software" | "tarefas-sem-prazo");
      const item = lerCaixaItem(`${id}.md`, fs.readFileSync(path.join(v.reunioes, `${id}.md`), "utf8"));
      assert.ok(item);
      const r = await aprovarReuniao(
        v.vault,
        { reuniao: id, decisoes: item.tarefas.map((t) => ({ n: t.n, h: t.h, acao: textos.includes(t.texto) ? "eu" : "ignorar" })) },
        { now: () => AGORA },
      );
      assert.equal(r.status, 200, cenario);
    }
    const obs = new ObservadorPendencias(() => v.vault, { semWatch: true, intervaloMs: 0, now: () => AGORA });
    await obs.iniciar();
    const itens = obs.getItens();
    obs.parar();
    const urgenciaDoTexto = (texto: string) => itens.find((p) => p.texto === texto && p.dono === "eu")?.urgencia;
    assert.equal(urgenciaDoTexto("Trocar o login antigo pelo novo"), "atrasada");
    assert.equal(urgenciaDoTexto("Criar o ambiente de testes com dados inventados"), "logo", "prazo daqui a 1 dia");
    assert.equal(urgenciaDoTexto("Combinar com a equipe um horário fixo para o acompanhamento"), "sem-prazo");
    assert.equal(itens.filter((p) => p.dono === "eu").length, 3, "só as 3 aprovadas como 'eu'");
    assert.ok(itens.every((p) => p.dono === "eu"), "tarefas 'ignorar' não viram missão nem pendência");
  } finally {
    v.limpar();
  }
});

test("concluir só tira a marca antiga no formato do painel: '| concluída: parcial' fica no texto", async () => {
  const v = novoVaultDeTeste();
  try {
    const arq = path.join(v.missoes, "2026-10-10-m.md");
    const original = MISSAO(["classe: time"]).replace("- [ ] Passo sem prazo", "- [ ] Passo sem prazo | concluída: parcial");
    fs.writeFileSync(arq, original);
    const p = pendenciaDe("m", "2026-10-10-m", original, 1);
    assert.equal((await concluirPendencia(v.vault, { id: p.id, h: p.h }, { now: () => AGORA })).status, 200);
    assert.equal(ler(arq), original.replace("- [ ] Passo sem prazo | concluída: parcial", "- [x] Passo sem prazo | concluída: parcial | concluída: 2026-10-17"));
    // marca antiga no formato do painel (tarefa desmarcada no Obsidian): é trocada, não duplicada
    const arq2 = path.join(v.missoes, "2026-10-11-n.md");
    const outro = MISSAO(["classe: time"]).replace("- [ ] Passo sem prazo", "- [ ] Passo sem prazo | concluída: 2026-09-09");
    fs.writeFileSync(arq2, outro);
    const p2 = pendenciaDe("m", "2026-10-11-n", outro, 1);
    assert.equal((await concluirPendencia(v.vault, { id: p2.id, h: p2.h }, { now: () => AGORA })).status, 200);
    assert.ok(ler(arq2).includes("- [x] Passo sem prazo | concluída: 2026-10-17"));
    assert.ok(!ler(arq2).includes("2026-09-09"));
  } finally {
    v.limpar();
  }
});

// ---------------------------------------------------------------- missão reaberta: os três leitores concordam

function missaoConcluida(corpoTarefas: string[], antes: string[] = []): string {
  return [
    "---", "tipo: missao", "status: concluída", "origem: reuniao", "classe: time", "concluida_em: 2026-10-12", "confidencial: false", "---", "",
    "# Tarefas: Uma coisa", "", ...antes, "## Tarefas", ...corpoTarefas, "",
  ].join("\n");
}

function leitores(texto: string): { painel: string; pendencias: number; resultados: number } {
  const eventos = lerEventosDaNota("m", "2026-10-10-uma.md", texto, 0);
  return {
    painel: parseMissao("2026-10-10-uma.md", texto, 0)?.status ?? "",
    pendencias: lerPendenciasDaNota("m", "2026-10-10-uma.md", texto).length,
    resultados: eventos.filter((e) => e.tipo === "missao").length,
  };
}

test("missão reaberta: amostra em bloco de código, comentário, fora de ## Tarefas ou com data impossível não reabre em nenhum leitor", () => {
  const amostra = "- [ ] x | concluída: 2026-01-01";
  const casos: Record<string, string> = {
    "bloco de código": missaoConcluida(["- [x] feita | concluída: 2026-10-12", "```", amostra, "```"]),
    comentário: missaoConcluida(["- [x] feita | concluída: 2026-10-12", "<!--", amostra, "-->"]),
    "fora de ## Tarefas": missaoConcluida(["- [x] feita | concluída: 2026-10-12", "", "## Notas", amostra]),
    "antes de ## Tarefas": missaoConcluida(["- [x] feita | concluída: 2026-10-12"], [amostra, ""]),
    "data impossível": missaoConcluida(["- [x] feita | concluída: 2026-10-12", "- [ ] x | concluída: 2026-02-31"]),
  };
  for (const [nome, texto] of Object.entries(casos)) {
    const r = leitores(texto);
    assert.equal(r.painel, "concluída", `painel: ${nome}`);
    assert.equal(r.pendencias, 0, `pendências: ${nome}`);
    assert.equal(r.resultados, 1, `resultados: ${nome}`);
  }
});

test("missão reaberta de verdade reabre nos três leitores ao mesmo tempo", () => {
  const r = leitores(missaoConcluida(["- [x] feita | concluída: 2026-10-12", "- [ ] volta | concluída: 2026-10-12"]));
  assert.equal(r.painel, "em andamento");
  assert.equal(r.pendencias, 1);
  assert.equal(r.resultados, 0);
});
