import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { INTERVALO_CHAVE_MS, MAX_MENSAGENS_REPLAY, calcularChaves, type DiaReplay, type DiasReplay } from "../shared/replay.ts";
import type { ServerMessage } from "../shared/types.ts";
import { lerJsonl, reproduzir } from "./replay.ts";
import { dataValida, lerJsonlTolerante, registrarReplay } from "./replayRotas.ts";
import { OfficeState } from "./state.ts";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "sessoes", "lider-dois-subagentes.jsonl");
const TEXTO = fs.readFileSync(FIXTURE, "utf8");

async function ambiente() {
  const pai = fs.mkdtempSync(path.join(os.tmpdir(), "replay-rotas-"));
  const dir = path.join(pai, "replay");
  fs.mkdirSync(dir);
  const app = express();
  let porta = 0;
  registrarReplay(app, { dir: () => dir, porta: () => porta });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  porta = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${porta}`;
  return {
    dir,
    base,
    escrever: (nome: string, texto: string) => fs.writeFileSync(path.join(dir, nome), texto),
    fechar: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(pai, { recursive: true, force: true });
    },
  };
}

test("aoMensagem recebe o que o estado emite, com t do relógio virtual (e o resultado segue igual)", () => {
  const linhas = lerJsonl(TEXTO);
  const msgs: { t: number; msg: ServerMessage }[] = [];
  const com = reproduzir(linhas, { aoMensagem: (t, msg) => msgs.push({ t, msg }) });
  const sem = reproduzir(linhas);
  assert.ok(msgs.some((m) => m.msg.type === "agent"));
  assert.ok(msgs.every((m, i) => i === 0 || m.t >= msgs[i - 1].t));
  assert.ok(msgs[0].t >= linhas[0].chegada);
  assert.deepEqual(com.linhaDoTempo, sem.linhaDoTempo);
});

test("tocar um dia não altera o estado real nem o arquivo salvo", () => {
  const pai = fs.mkdtempSync(path.join(os.tmpdir(), "replay-iso-"));
  try {
    const real = new OfficeState({ sweepEveryMs: 0 });
    real.handleHook({ hook_event_name: "SessionStart", session_id: "real-1", cwd: "/x", source: "startup" });
    const antes = JSON.stringify(real.snapshot());
    const salvo = path.join(pai, "escritorio.json");
    fs.writeFileSync(salvo, JSON.stringify(real.serializar()));
    const salvoAntes = fs.readFileSync(salvo, "utf8");
    reproduzir(lerJsonl(TEXTO), { aoMensagem: () => undefined, depoisDoFimMs: 60_000 });
    assert.equal(JSON.stringify(real.snapshot()), antes);
    assert.equal(fs.readFileSync(salvo, "utf8"), salvoAntes);
    assert.deepEqual(fs.readdirSync(pai), ["escritorio.json"]);
  } finally {
    fs.rmSync(pai, { recursive: true, force: true });
  }
});

test("dataValida: só AAAA-MM-DD que existe", () => {
  assert.equal(dataValida("2026-10-05"), true);
  for (const ruim of ["2026-02-31", "2026-13-01", "26-10-05", "2026-10-5", "../../etc/passwd", "2026-10-05.jsonl", "2026-10-05/../x", "", undefined, ["2026-10-05"], 20261005]) {
    assert.equal(dataValida(ruim), false, String(ruim));
  }
});

test("lerJsonlTolerante ignora linhas ruins e conta quantas", () => {
  const { linhas, ignoradas } = lerJsonlTolerante(`{"chegada":1,"marcador":"servidor_iniciou"}\nlixo\n{"chegada":2}\n{"chegada":3,"hookTs":null,"evento":{"hook_event_name":"Stop"}}\n{"chegada":4,"hoo`);
  assert.equal(linhas.length, 2);
  assert.equal(ignoradas, 3);
});

test("GET /api/replay/dias: lista as datas com a contagem, mais nova primeiro; ignora o que não é dia", async () => {
  const a = await ambiente();
  try {
    a.escrever("2026-10-04.jsonl", `{"chegada":1,"marcador":"servidor_iniciou"}\n`);
    a.escrever("2026-10-05.jsonl", TEXTO);
    a.escrever("2026-10-06.jsonl", "");
    a.escrever("lixo.txt", "x");
    a.escrever("2026-02-31.jsonl", "x\n");
    const r = await fetch(`${a.base}/api/replay/dias`);
    assert.equal(r.status, 200);
    const j = (await r.json()) as DiasReplay;
    assert.deepEqual(j.dias.map((d) => d.data), ["2026-10-05", "2026-10-04"]);
    assert.equal(j.dias[0].eventos, TEXTO.split("\n").filter((l) => l.trim()).length);
  } finally {
    await a.fechar();
  }
});

test("GET /api/replay/dias sem a pasta: lista vazia (não é erro)", async () => {
  const a = await ambiente();
  try {
    fs.rmSync(a.dir, { recursive: true });
    const j = (await (await fetch(`${a.base}/api/replay/dias`)).json()) as DiasReplay;
    assert.deepEqual(j.dias, []);
  } finally {
    await a.fechar();
  }
});

test("GET /api/replay/dia: devolve início, fim, mensagens e chaves", async () => {
  const a = await ambiente();
  try {
    a.escrever("2026-10-05.jsonl", TEXTO);
    const r = await fetch(`${a.base}/api/replay/dia?data=2026-10-05`);
    assert.equal(r.status, 200);
    const j = (await r.json()) as DiaReplay;
    const linhas = lerJsonl(TEXTO);
    assert.equal(j.inicio, linhas[0].chegada);
    assert.equal(j.fim, linhas[linhas.length - 1].chegada);
    assert.ok(j.mensagens.length > 3);
    assert.ok(j.mensagens.every((m, i) => i === 0 || m.t >= j.mensagens[i - 1].t));
    assert.ok(j.mensagens.some((m) => m.msg.type === "agent" && m.msg.agent.personagem === "dev"));
    assert.ok(j.chaves.length >= 1);
    assert.equal(j.chaves[0].i, 0);
    assert.equal(j.reduzido, undefined);
  } finally {
    await a.fechar();
  }
});

test("data inválida: 400 JSON; inexistente: 404 JSON; caminho esperto nunca vira arquivo", async () => {
  const a = await ambiente();
  try {
    fs.writeFileSync(path.join(path.dirname(a.dir), "segredo.jsonl"), TEXTO);
    for (const q of ["", "?data=abc", "?data=2026-02-31", `?data=${encodeURIComponent("../segredo")}`, "?data=2026-10-05&data=2026-10-06", `?data=${encodeURIComponent("2026-10-05/../../segredo")}`]) {
      const r = await fetch(`${a.base}/api/replay/dia${q}`);
      assert.equal(r.status, 400, q);
      const j = (await r.json()) as { ok: boolean; erros: string[] };
      assert.equal(j.ok, false);
      assert.ok(j.erros[0]);
    }
    const nao = await fetch(`${a.base}/api/replay/dia?data=2026-10-05`);
    assert.equal(nao.status, 404);
    assert.equal(((await nao.json()) as { ok: boolean }).ok, false);
  } finally {
    await a.fechar();
  }
});

test("Host de fora é recusado (403)", async () => {
  const a = await ambiente();
  try {
    const porta = new URL(a.base).port;
    const r = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: Number(porta), path: "/api/replay/dias", headers: { Host: "site-de-fora.example" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(r, 403);
  } finally {
    await a.fechar();
  }
});

test("arquivo corrompido: ignora as linhas ruins e avisa quantas", async () => {
  const a = await ambiente();
  try {
    const corrompido = TEXTO.split("\n").slice(0, 12).join("\n") + "\n{isto nao e json\n\u0000\u0000\n" + TEXTO.split("\n").slice(12).join("\n") + '{"chegada":99999999999,"hoo';
    a.escrever("2026-10-05.jsonl", corrompido);
    const r = await fetch(`${a.base}/api/replay/dia?data=2026-10-05`);
    assert.equal(r.status, 200);
    const j = (await r.json()) as DiaReplay;
    assert.ok(j.linhasIgnoradas && j.linhasIgnoradas >= 2);
    assert.ok(j.mensagens.length > 3);
  } finally {
    await a.fechar();
  }
});

test("servidor reiniciado no meio: o marcador limpa o escritório e o dia continua", async () => {
  const a = await ambiente();
  try {
    const base = 1791205200000;
    const ev = (sid: string, extra: Record<string, unknown>) => ({ session_id: sid, cwd: "/x", ...extra });
    const linha = (chegada: number, evento: unknown) => JSON.stringify({ chegada, hookTs: chegada - 10, evento });
    a.escrever(
      "2026-10-05.jsonl",
      [
        JSON.stringify({ chegada: base, marcador: "servidor_iniciou" }),
        linha(base + 1000, ev("s1", { hook_event_name: "SessionStart", source: "startup" })),
        linha(base + 2000, ev("s1", { hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: "a", tool_input: { file_path: "arquivo-1.ts" } })),
        JSON.stringify({ chegada: base + 60_000, marcador: "servidor_iniciou" }),
        linha(base + 61_000, ev("s2", { hook_event_name: "SessionStart", source: "startup" })),
      ].join("\n") + "\n",
    );
    const j = (await (await fetch(`${a.base}/api/replay/dia?data=2026-10-05`)).json()) as DiaReplay;
    const i = j.mensagens.findIndex((m) => m.msg.type === "limpar");
    assert.ok(i > 0, "tem o marcador limpar depois das primeiras mensagens");
    assert.equal(j.mensagens[i].t, base + 60_000);
    assert.ok(j.mensagens.slice(0, i).some((m) => m.msg.type === "agent" && m.msg.agent.sessionId === "s1"));
    assert.ok(j.mensagens.slice(i + 1).some((m) => m.msg.type === "agent" && m.msg.agent.sessionId === "s2"));
    assert.equal(j.fim, base + 61_000);
  } finally {
    await a.fechar();
  }
});

test("arquivo grande: passa de 20 mil mensagens, reduz para mudanças de status e avisa", async () => {
  const a = await ambiente();
  try {
    const base = 1791205200000;
    const linhas: string[] = [JSON.stringify({ chegada: base, marcador: "servidor_iniciou" })];
    linhas.push(JSON.stringify({ chegada: base + 10, hookTs: base, evento: { session_id: "g", cwd: "/x", hook_event_name: "SessionStart", source: "startup" } }));
    // 12 mil leituras: cada uma muda a atividade (arquivo diferente) e há mais mudanças de status via Notification
    for (let i = 0; i < 12_000; i++) {
      const t = base + 1000 + i * 700;
      linhas.push(JSON.stringify({ chegada: t, hookTs: t - 5, evento: { session_id: "g", cwd: "/x", hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: `r${i}`, tool_input: { file_path: `arquivo-${i}.ts` } } }));
      linhas.push(JSON.stringify({ chegada: t + 300, hookTs: t + 295, evento: { session_id: "g", cwd: "/x", hook_event_name: "Notification", notification_type: i % 2 ? "idle_prompt" : "permission_prompt", message: "x" } }));
    }
    a.escrever("2026-10-05.jsonl", linhas.join("\n") + "\n");
    const j = (await (await fetch(`${a.base}/api/replay/dia?data=2026-10-05`)).json()) as DiaReplay;
    assert.equal(j.reduzido, true);
    assert.ok(j.mensagens.length <= MAX_MENSAGENS_REPLAY);
    assert.ok(j.mensagens.length > 100);
    const ids = new Map<string, string>();
    for (const m of j.mensagens) {
      if (m.msg.type !== "agent") continue;
      assert.notEqual(ids.get(m.msg.agent.id), m.msg.agent.status, "só mudanças de status");
      ids.set(m.msg.agent.id, m.msg.agent.status);
    }
  } finally {
    await a.fechar();
  }
});

test("chaves: uma por janela de ~60 s, com o índice da primeira mensagem dali", () => {
  const msg = (t: number) => ({ t, msg: { type: "remove" as const, id: "x" } });
  const base = 1_000_000;
  const chaves = calcularChaves([msg(base), msg(base + 10_000), msg(base + 61_000), msg(base + 200_000), msg(base + 200_500)]);
  assert.deepEqual(chaves, [
    { t: base, i: 0 },
    { t: base + INTERVALO_CHAVE_MS, i: 2 },
    { t: base + 3 * INTERVALO_CHAVE_MS, i: 3 },
  ]);
  assert.deepEqual(calcularChaves([]), []);
});
