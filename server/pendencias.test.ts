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
