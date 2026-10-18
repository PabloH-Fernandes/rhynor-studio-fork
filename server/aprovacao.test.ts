// Aprovação da Caixa de entrada (POST /api/caixa/aprovar) e proteção dos POSTs. Só pastas temporárias (mkdtemp).
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { aprovarReuniao, registrarCaixa, validarCorpo, type RespostaAprovacao } from "./aprovacao.ts";
import type { CaixaResposta } from "../shared/types.ts";
import { ObservadorCaixa, lerCaixaItem } from "./caixa.ts";
import { slugDe } from "./reunioesVault.ts";
import { ehJson, origemPermitida } from "./seguranca.ts";
import { AGORA, criarReuniao, novoVaultDeTeste, type VaultDeTeste } from "./testeVault.ts";
import { lerFrontmatter, missaoDoPrompt, parseMissao } from "./vault.ts";

const lerNota = (v: VaultDeTeste, id: string) => fs.readFileSync(path.join(v.reunioes, `${id}.md`), "utf8");
const arquivosMd = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith(".md"));

/** a nota lida como a Caixa lê */
function itemDa(v: VaultDeTeste, id: string) {
  const item = lerCaixaItem(`${id}.md`, lerNota(v, id));
  assert.ok(item, "a nota deve estar na caixa");
  return item;
}
const abertas = (v: VaultDeTeste, id: string) => itemDa(v, id).tarefas;

/** resposta 200 com o corpo de sucesso (falha o teste se não for) */
function corpoOk(r: RespostaAprovacao): CaixaResposta {
  assert.equal(r.status, 200);
  assert.ok(r.corpo.ok);
  return r.corpo as CaixaResposta;
}

test("validarCorpo aceita o formato certo e recusa o resto", () => {
  const ok = validarCorpo({
    reuniao: "2026-10-17-ok",
    decisoes: [
      { n: 1, acao: "time" },
      { n: 2, acao: "ignorar" },
    ],
  });
  assert.ok(ok.ok);
  const ruins: unknown[] = [
    null,
    [],
    "texto",
    { reuniao: "../segredo", decisoes: [] },
    { reuniao: "a/b", decisoes: [] },
    { reuniao: "a.md", decisoes: [] },
    { reuniao: "", decisoes: [] },
    { reuniao: "x".repeat(121), decisoes: [] },
    { reuniao: "ok", decisoes: "nada" },
    { reuniao: "ok", decisoes: [{ n: 0, acao: "time" }] },
    { reuniao: "ok", decisoes: [{ n: 1.5, acao: "time" }] },
    { reuniao: "ok", decisoes: [{ n: "1", acao: "time" }] },
    { reuniao: "ok", decisoes: [{ n: 1, acao: "apagar" }] },
    {
      reuniao: "ok",
      decisoes: [
        { n: 1, acao: "time" },
        { n: 1, acao: "eu" },
      ],
    },
    { reuniao: "ok", decisoes: [null] },
    { reuniao: "ok", decisoes: Array.from({ length: 101 }, (_, i) => ({ n: i + 1, acao: "eu" })) },
  ];
  for (const r of ruins) assert.equal(validarCorpo(r).ok, false, JSON.stringify(r)?.slice(0, 60));
});

test("aprovar grava as escolhas na nota, cria UMA missão e devolve o comando", async () => {
  const v = novoVaultDeTeste();
  try {
    const id = await criarReuniao(v);
    const tarefas = abertas(v, id);
    assert.ok(tarefas.length >= 3);
    const acoes = tarefas.map((_, i) => (i === 0 ? "time" : i === 1 ? "eu" : i === 2 ? "ignorar" : "time") as "time" | "eu" | "ignorar");
    const decisoes = tarefas.map((t, i) => ({ n: t.n, acao: acoes[i] }));

    const r = await aprovarReuniao(v.vault, { reuniao: id, decisoes }, { now: () => AGORA });
    assert.equal(r.status, 200);
    const resp = corpoOk(r);
    const doTime = tarefas.filter((_, i) => acoes[i] === "time");

    // a missão: formato do /reuniao e legível pelo painel
    assert.equal(arquivosMd(v.missoes).length, 1);
    const nomeMissao = arquivosMd(v.missoes)[0].replace(/\.md$/, "");
    assert.equal(resp.missao, nomeMissao);
    assert.match(nomeMissao, /^2026-10-17-.+-missao$/);
    assert.notEqual(nomeMissao, id, "o link [[nota]] precisa de nomes diferentes");
    const textoMissao = fs.readFileSync(path.join(v.missoes, `${nomeMissao}.md`), "utf8");
    const fm = lerFrontmatter(textoMissao);
    assert.equal(fm?.tipo, "missao");
    assert.equal(fm?.origem, "reuniao");
    assert.equal(fm?.reuniao, id);
    assert.equal(fm?.classe, "time");
    assert.equal(fm?.status, "a fazer");
    assert.equal(fm?.confidencial, "false");
    assert.match(fm?.aprovada_em ?? "", /^2026-10-1\dT/);
    for (const secao of ["## Objetivo", "## Tarefas", "## Comando sugerido", "## Resultado"]) assert.ok(textoMissao.includes(secao), secao);

    const m = parseMissao(`${nomeMissao}.md`, textoMissao, 0);
    assert.ok(m);
    assert.equal(m.origem, "reuniao");
    assert.equal(m.classe, "time");
    assert.equal(m.tarefas.total, doTime.length);
    assert.equal(m.itens.length, doTime.length);
    assert.deepEqual(
      m.itens.map((i) => i.texto),
      doTime.map((t) => t.texto),
      "o painel não mostra o sufixo | prazo",
    );
    assert.ok(m.reuniaoTitulo.length > 0);
    assert.ok(!textoMissao.includes("Responsável A"), "a missão não leva o responsável");

    // o comando
    assert.ok(resp.comando);
    assert.match(resp.comando, new RegExp(`^/time Missão \\[\\[${nomeMissao}\\]\\]: Fazer as ${doTime.length} tarefas da reunião .+\\.$`));
    assert.equal(missaoDoPrompt(resp.comando), nomeMissao);
    assert.ok(textoMissao.includes(`\`${resp.comando}\``), "o mesmo comando fica na nota da missão");

    // a reunião
    const nota = lerNota(v, id);
    assert.equal(lerFrontmatter(nota)?.status, "processada");
    assert.match(lerFrontmatter(nota)?.aprovada_em ?? "", /^2026-10-1\dT/);
    assert.match(nota, new RegExp(`## Missões geradas\\n- \\[\\[${nomeMissao}\\]\\]\\n`));
    const linhas = nota.split("\n").filter((l) => /^- \[.\] /.test(l));
    assert.equal(linhas.length, tarefas.length);
    const [primeira, segunda, terceira] = linhas;
    assert.match(primeira, /^- \[ \] .*\| classe: time$/);
    assert.match(segunda, /^- \[ \] .*\| classe: eu$/);
    assert.match(terceira, /^- \[-\] /);
    assert.ok(nota.includes("## Pauta e notas") && nota.includes("## Dúvidas"), "o resto da nota fica intacto");
    assert.ok(!fs.readdirSync(v.reunioes).some((f) => f.endsWith(".tmp")), "sem arquivo temporário sobrando");
  } finally {
    v.limpar();
  }
});

test("sem nenhuma tarefa 'Time faz' não cria missão, só marca a reunião", async () => {
  const v = novoVaultDeTeste();
  try {
    const id = await criarReuniao(v);
    const tarefas = abertas(v, id);
    const r = await aprovarReuniao(v.vault, {
      reuniao: id,
      decisoes: tarefas.map((t, i) => ({ n: t.n, acao: i % 2 ? "ignorar" : "eu" })),
    });
    assert.equal(r.status, 200);
    const resp = corpoOk(r);
    assert.equal(resp.comando, null);
    assert.equal(resp.missao, null);
    assert.deepEqual(arquivosMd(v.missoes), []);
    const nota = lerNota(v, id);
    assert.equal(lerFrontmatter(nota)?.status, "processada");
    assert.match(nota, /## Missões geradas\n- nenhuma\n/);
  } finally {
    v.limpar();
  }
});

test("reunião sem tarefas: arquivar (decisões vazias) vira processada", async () => {
  const v = novoVaultDeTeste();
  try {
    const id = await criarReuniao(v, "so-decisoes");
    assert.deepEqual(abertas(v, id), []);
    const r = await aprovarReuniao(v.vault, { reuniao: id, decisoes: [] });
    assert.equal(r.status, 200);
    assert.equal(lerFrontmatter(lerNota(v, id))?.status, "processada");
    assert.deepEqual(arquivosMd(v.missoes), []);
  } finally {
    v.limpar();
  }
});

test("aprovar de novo a mesma reunião dá 409 e não cria outra missão", async () => {
  const v = novoVaultDeTeste();
  try {
    const id = await criarReuniao(v);
    const decisoes = abertas(v, id).map((t) => ({ n: t.n, acao: "time" as const }));
    assert.equal((await aprovarReuniao(v.vault, { reuniao: id, decisoes })).status, 200);
    const antes = lerNota(v, id);
    const deNovo = await aprovarReuniao(v.vault, { reuniao: id, decisoes });
    assert.equal(deNovo.status, 409);
    assert.equal(arquivosMd(v.missoes).length, 1);
    assert.equal(lerNota(v, id), antes, "a nota não mudou");
  } finally {
    v.limpar();
  }
});

test("dois cliques ao mesmo tempo: um aprova, o outro leva 409", async () => {
  const v = novoVaultDeTeste();
  try {
    const id = await criarReuniao(v);
    const corpo = { reuniao: id, decisoes: abertas(v, id).map((t) => ({ n: t.n, acao: "time" as const })) };
    const [a, b] = await Promise.all([aprovarReuniao(v.vault, corpo), aprovarReuniao(v.vault, corpo)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(arquivosMd(v.missoes).length, 1);
  } finally {
    v.limpar();
  }
});

test("pedidos inválidos dão 400 (e 404 para reunião que não existe) sem tocar em nada", async () => {
  const v = novoVaultDeTeste();
  try {
    const id = await criarReuniao(v);
    const tarefas = abertas(v, id);
    const todas = tarefas.map((t) => ({ n: t.n, acao: "eu" as const }));
    const antes = lerNota(v, id);

    for (const reuniao of ["../x", "a/b", "a\\b", "", "..", "com espaço", `${id}.md`]) {
      assert.equal((await aprovarReuniao(v.vault, { reuniao, decisoes: todas })).status, 400, reuniao);
    }
    assert.equal((await aprovarReuniao(v.vault, { reuniao: id, decisoes: todas.slice(1) })).status, 400, "falta uma tarefa");
    assert.equal((await aprovarReuniao(v.vault, { reuniao: id, decisoes: [] })).status, 400, "nenhuma escolha");
    assert.equal((await aprovarReuniao(v.vault, { reuniao: id, decisoes: [...todas, { n: 99, acao: "eu" }] })).status, 400, "tarefa que não existe");
    assert.equal((await aprovarReuniao(v.vault, { reuniao: id, decisoes: todas.map((d) => ({ ...d, acao: "apagar" })) })).status, 400);
    assert.equal((await aprovarReuniao(v.vault, { reuniao: "2026-01-01-nao-existe", decisoes: [] })).status, 404);
    assert.equal(lerNota(v, id), antes);
    assert.deepEqual(arquivosMd(v.missoes), []);

    // nota que não é da caixa (outra origem) também não passa
    fs.writeFileSync(path.join(v.reunioes, "2026-10-17-manual.md"), "---\ntipo: reuniao\nstatus: rascunho\norigem: facilitator\n---\n# x\n## Tarefas\n- [ ] a\n");
    assert.equal((await aprovarReuniao(v.vault, { reuniao: "2026-10-17-manual", decisoes: [{ n: 1, acao: "time" }] })).status, 400);
  } finally {
    v.limpar();
  }
});

test("a nota mantém CRLF e BOM", async () => {
  const v = novoVaultDeTeste();
  try {
    const id = await criarReuniao(v);
    const arq = path.join(v.reunioes, `${id}.md`);
    fs.writeFileSync(arq, "﻿" + fs.readFileSync(arq, "utf8").replace(/\n/g, "\r\n"));
    const decisoes = abertas(v, id).map((t) => ({ n: t.n, acao: "time" as const }));
    assert.equal((await aprovarReuniao(v.vault, { reuniao: id, decisoes })).status, 200);
    const depois = fs.readFileSync(arq, "utf8");
    assert.equal(depois.charCodeAt(0), 0xfeff);
    assert.ok(!/[^\r]\n/.test(depois), "nenhuma quebra de linha sem \\r");
    assert.equal(lerFrontmatter(depois)?.status, "processada");
  } finally {
    v.limpar();
  }
});

test("a missão não sobrescreve nada: nome ocupado ganha -2", async () => {
  const v = novoVaultDeTeste();
  try {
    const id = await criarReuniao(v);
    const ocupado = `2026-10-17-${slugDe(itemDa(v, id).titulo)}-missao`;
    fs.writeFileSync(path.join(v.missoes, `${ocupado}.md`), "nota do usuário\n");
    const decisoes = abertas(v, id).map((t) => ({ n: t.n, acao: "time" as const }));
    const r = await aprovarReuniao(v.vault, { reuniao: id, decisoes }, { now: () => AGORA });
    assert.equal(r.status, 200);
    const resp = corpoOk(r);
    assert.equal(resp.missao, `${ocupado}-2`);
    assert.equal(fs.readFileSync(path.join(v.missoes, `${ocupado}.md`), "utf8"), "nota do usuário\n");
  } finally {
    v.limpar();
  }
});

// ---------------------------------------------------------------- HTTP (middleware)

interface Resposta {
  status: number;
  corpo: { ok?: boolean; erros?: string[]; comando?: string | null; missao?: string | null; itens?: unknown[] };
}

function pedir(porta: number, metodo: string, rota: string, cabecalhos: Record<string, string>, corpo?: string): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: porta, method: metodo, path: rota, headers: cabecalhos, agent: false }, (res) => {
      let texto = "";
      res.on("data", (c) => (texto += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, corpo: texto.startsWith("{") ? JSON.parse(texto) : {} }));
    });
    req.on("error", reject);
    if (corpo !== undefined) req.write(corpo);
    req.end();
  });
}

async function comServidor(v: VaultDeTeste, fn: (porta: number, caixa: ObservadorCaixa) => Promise<void>) {
  const caixa = new ObservadorCaixa(() => v.vault, { semWatch: true, intervaloMs: 0 });
  await caixa.iniciar();
  const app = express();
  let porta = 0;
  registrarCaixa(app, { resolverVault: () => v.vault, caixa, porta: () => porta, now: () => AGORA });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  porta = (server.address() as AddressInfo).port;
  try {
    await fn(porta, caixa);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    caixa.parar();
  }
}

test("origemPermitida e ehJson", () => {
  assert.equal(origemPermitida("http://127.0.0.1:4750", 4750), true);
  assert.equal(origemPermitida("http://localhost:4750", 4750), true);
  for (const ruim of ["http://127.0.0.1:4751", "https://localhost:4750", "http://evil.com", "http://localhost:4750.evil.com", "null", "", "http://127.0.0.1"]) {
    assert.equal(origemPermitida(ruim, 4750), false, ruim);
  }
  assert.equal(ehJson("application/json"), true);
  assert.equal(ehJson("Application/JSON; charset=utf-8"), true);
  for (const ruim of [undefined, "", "text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/jsonx"]) assert.equal(ehJson(ruim), false, String(ruim));
});

test("POST /api/caixa/aprovar: Origin de fora dá 403, tipo errado dá 415, e nada é gravado", async () => {
  const v = novoVaultDeTeste();
  try {
    const id = await criarReuniao(v);
    const corpo = JSON.stringify({ reuniao: id, decisoes: abertas(v, id).map((t) => ({ n: t.n, acao: "time" })) });
    const antes = lerNota(v, id);
    await comServidor(v, async (porta) => {
      const json = { "Content-Type": "application/json" };
      assert.equal((await pedir(porta, "POST", "/api/caixa/aprovar", { ...json, Origin: "http://evil.com" }, corpo)).status, 403);
      assert.equal((await pedir(porta, "POST", "/api/caixa/aprovar", { ...json, Origin: `http://127.0.0.1:${porta + 1}` }, corpo)).status, 403);
      assert.equal((await pedir(porta, "POST", "/api/caixa/aprovar", { ...json, Origin: "null" }, corpo)).status, 403);
      assert.equal((await pedir(porta, "POST", "/api/caixa/aprovar", { "Content-Type": "text/plain" }, corpo)).status, 415);
      assert.equal((await pedir(porta, "POST", "/api/caixa/aprovar", { "Content-Type": "application/x-www-form-urlencoded" }, "reuniao=x")).status, 415);
      assert.equal((await pedir(porta, "POST", "/api/caixa/aprovar", {}, corpo)).status, 415);
      assert.equal(lerNota(v, id), antes);
      assert.deepEqual(arquivosMd(v.missoes), []);
    });
  } finally {
    v.limpar();
  }
});

test("POST /api/caixa/aprovar: Origin do painel e curl sem Origin funcionam; GET /api/caixa acompanha", async () => {
  const v = novoVaultDeTeste();
  try {
    const id = await criarReuniao(v);
    const id2 = await criarReuniao(v, "alinhamento-bi", 3);
    await comServidor(v, async (porta, caixa) => {
      const json = { "Content-Type": "application/json; charset=utf-8" };
      const lista = await pedir(porta, "GET", "/api/caixa", {});
      assert.equal(lista.status, 200);
      assert.equal(lista.corpo.itens?.length, 2);

      const c1 = JSON.stringify({ reuniao: id, decisoes: abertas(v, id).map((t) => ({ n: t.n, acao: "time" })) });
      const ok = await pedir(porta, "POST", "/api/caixa/aprovar", { ...json, Origin: `http://localhost:${porta}` }, c1);
      assert.equal(ok.status, 200);
      assert.match(ok.corpo.comando ?? "", /^\/time Missão \[\[.+\]\]: /);
      assert.equal(caixa.getItens().length, 1, "a caixa já foi relida");

      const c2 = JSON.stringify({ reuniao: id2, decisoes: abertas(v, id2).map((t) => ({ n: t.n, acao: "eu" })) });
      assert.equal((await pedir(porta, "POST", "/api/caixa/aprovar", json, c2)).status, 200);
      assert.equal((await pedir(porta, "POST", "/api/caixa/aprovar", { ...json, Origin: `http://127.0.0.1:${porta}` }, c1)).status, 409);
      assert.equal((await pedir(porta, "POST", "/api/caixa/aprovar", json, "{ ruim")).status, 400);
      assert.equal((await pedir(porta, "POST", "/api/caixa/aprovar", json, JSON.stringify({ reuniao: "../x", decisoes: [] }))).status, 400);
      assert.equal((await pedir(porta, "GET", "/api/caixa", {})).corpo.itens?.length, 0);
    });
  } finally {
    v.limpar();
  }
});
