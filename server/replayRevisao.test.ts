// Correções da revisão da Etapa 9: o GET do dia não trava o servidor, cache e mutex por data, privacidade dos campos
// livres, teto de rótulos e cota do dia contra flood. Tudo em pasta temporária e porta efêmera (0): nada de data/ real.

import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_ROSTER } from "../shared/roster.ts";
import type { DiaReplay, DiasReplay } from "../shared/replay.ts";
import { arquivoDoDia } from "./gravador.ts";
import { MAX_ROTULOS, Rotulos, criarRotulos, drenarCedendo, enxugarEvento, lerJsonl, reproduzir, reproduzirPassos } from "./replay.ts";
import { TTL_DIA_ATUAL_MS, registrarReplay } from "./replayRotas.ts";
import { ResumoDia } from "./resumoDia.ts";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "sessoes", "lider-dois-subagentes.jsonl");
const TEXTO = fs.readFileSync(FIXTURE, "utf8");

const esperar = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

interface Opcoes {
  limiteAtingido?: (data: string, bytes: number) => boolean;
  agora?: () => number;
  aoMontar?: () => void;
}

async function ambiente(opts: Opcoes = {}) {
  const pai = fs.mkdtempSync(path.join(os.tmpdir(), "replay-revisao-"));
  const dir = path.join(pai, "replay");
  fs.mkdirSync(dir);
  const app = express();
  app.use(express.json());
  // um /api/hook de mentira: o que importa é quanto ele demora a responder enquanto o replay trabalha
  app.post("/api/hook", (_req, res) => res.json({ ok: true }));
  let porta = 0;
  registrarReplay(app, {
    dir: () => dir,
    porta: () => porta,
    limiteAtingido: opts.limiteAtingido,
    agora: opts.agora,
    // o elenco é lido uma vez por montagem: serve para contar quantas montagens aconteceram
    roster: () => {
      opts.aoMontar?.();
      return DEFAULT_ROSTER;
    },
  });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  porta = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${porta}`;
  return {
    dir,
    base,
    escrever: (nome: string, texto: string) => fs.writeFileSync(path.join(dir, nome), texto),
    anexar: (nome: string, texto: string) => fs.appendFileSync(path.join(dir, nome), texto),
    fechar: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(pai, { recursive: true, force: true });
    },
  };
}

/** ~`bytes` de resumo do dia (formato do ResumoDia) com leituras e avisos que mudam o escritório o tempo todo */
function gerarDia(bytes: number): string {
  const base = new Date(2026, 9, 5, 9, 0, 0).getTime();
  const linhas: string[] = [JSON.stringify({ chegada: base, marcador: "servidor_iniciou" })];
  let total = linhas[0].length;
  const push = (l: string) => {
    linhas.push(l);
    total += l.length + 1;
  };
  push(JSON.stringify({ chegada: base + 10, hookTs: base, evento: { session_id: "g", cwd: "/projeto", hook_event_name: "SessionStart", source: "startup" } }));
  for (let i = 0; total < bytes; i++) {
    const t = base + 1000 + i * 700;
    push(JSON.stringify({ chegada: t, hookTs: t - 5, evento: { session_id: "g", cwd: "/projeto", hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: `r${i}`, tool_input: { file_path: `arquivo-${i}.ts` } } }));
    push(JSON.stringify({ chegada: t + 300, hookTs: t + 295, evento: { session_id: "g", cwd: "/projeto", hook_event_name: "Notification", notification_type: i % 2 ? "idle_prompt" : "permission_prompt", message: "Aviso" } }));
  }
  return linhas.join("\n") + "\n";
}

/** uma medição: o GET do dia montando do zero enquanto POSTs e um timer de 10 ms disputam o event loop */
async function medirGetDoDia(base: string, data: string) {
  // timers de 10 ms: quanto tempo o event loop fica sem poder rodá-los
  let maiorAtrasoTimer = 0;
  let ultimo = performance.now();
  const timer = setInterval(() => {
    const agora = performance.now();
    maiorAtrasoTimer = Math.max(maiorAtrasoTimer, agora - ultimo - 10);
    ultimo = agora;
  }, 10);

  const inicio = performance.now();
  let acabou = false;
  const get = fetch(`${base}/api/replay/dia?data=${data}`).then(async (r) => {
    const buf = await r.arrayBuffer(); // sem JSON.parse aqui: o teste roda no mesmo processo do servidor
    acabou = true;
    return { status: r.status, buf };
  });

  const latencias: number[] = [];
  await esperar(5);
  while (!acabou) {
    const t0 = performance.now();
    const r = await fetch(`${base}/api/hook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hook_event_name: "Stop" }) });
    await r.arrayBuffer();
    latencias.push(performance.now() - t0);
    await esperar(5);
  }
  clearInterval(timer);
  const { status, buf } = await get;
  return { status, buf, duracao: performance.now() - inicio, posts: latencias.length, maiorPost: Math.max(...latencias), maiorAtrasoTimer };
}

const mediana = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test("GET do dia de ~5 MB não trava o servidor: POSTs e timers concorrentes seguem rápidos", { timeout: 180_000 }, async () => {
  const a = await ambiente();
  try {
    const texto = gerarDia(5 * 1024 * 1024);
    assert.ok(texto.length >= 5 * 1024 * 1024);
    a.escrever("2026-10-05.jsonl", texto);

    // aquecimento (JIT, conexões, leitura do disco): não conta
    a.escrever("2026-10-04.jsonl", TEXTO);
    await fetch(`${a.base}/api/replay/dia?data=2026-10-04`).then((r) => r.arrayBuffer());

    // 3 medições; entre elas o arquivo cresce uma linha em branco (size muda), então cada GET monta do zero.
    // Com o npm test rodando outros arquivos em paralelo, um pico de CPU pega uma medição, não a mediana.
    const medidas: Awaited<ReturnType<typeof medirGetDoDia>>[] = [];
    for (let i = 0; i < 3; i++) {
      if (i > 0) a.anexar("2026-10-05.jsonl", "\n");
      const m = await medirGetDoDia(a.base, "2026-10-05");
      assert.equal(m.status, 200);
      assert.ok(m.posts >= 5, "o GET durou o bastante para medir");
      medidas.push(m);
    }
    const post = mediana(medidas.map((m) => m.maiorPost));
    const timer = mediana(medidas.map((m) => m.maiorAtrasoTimer));
    const duracao = mediana(medidas.map((m) => m.duracao));
    console.log(
      `[lag] medidas (maior POST / maior atraso de timer / GET): ${medidas.map((m) => `${m.maiorPost.toFixed(0)}/${m.maiorAtrasoTimer.toFixed(0)}/${m.duracao.toFixed(0)} ms`).join("; ")}`,
    );
    // meta ~50-100 ms. Antes da correção o GET segurava o event loop quase o tempo todo (560 ms de 5 MB
    // num bloco só). Limite: 250 ms ou metade da duração do GET, o que for maior. Máquina carregada deixa
    // tudo mais lento por igual (passa); um bloco que ocupa o GET inteiro continua reprovando.
    const limite = Math.max(250, duracao / 2);
    assert.ok(post < limite, `POST esperou ${post.toFixed(0)} ms (mediana; limite ${limite.toFixed(0)} ms)`);
    assert.ok(timer < limite, `timer atrasou ${timer.toFixed(0)} ms (mediana; limite ${limite.toFixed(0)} ms)`);

    const dia = JSON.parse(Buffer.from(medidas[0].buf).toString("utf8")) as DiaReplay;
    assert.equal(dia.ok, true);
    assert.ok(dia.mensagens.length > 100);
    assert.ok(dia.chaves.length >= 1);
  } finally {
    await a.fechar();
  }
});

test("cache por data e uma montagem só: pedidos simultâneos e repetidos reaproveitam o mesmo resultado", async () => {
  let montagens = 0;
  const a = await ambiente({ aoMontar: () => montagens++ });
  try {
    a.escrever("2026-10-05.jsonl", TEXTO);
    const corpos = await Promise.all(Array.from({ length: 6 }, () => fetch(`${a.base}/api/replay/dia?data=2026-10-05`).then((r) => r.text())));
    assert.equal(montagens, 1, "seis pedidos ao mesmo tempo, uma montagem");
    assert.ok(corpos.every((c) => c === corpos[0]));
    await fetch(`${a.base}/api/replay/dia?data=2026-10-05`).then((r) => r.text());
    assert.equal(montagens, 1, "arquivo igual (mtime+size): vem do cache");

    // o arquivo mudou (dia antigo: sem TTL): monta de novo
    a.anexar("2026-10-05.jsonl", JSON.stringify({ chegada: 1791205300000, marcador: "servidor_iniciou" }) + "\n");
    const novo = await fetch(`${a.base}/api/replay/dia?data=2026-10-05`).then((r) => r.json() as Promise<DiaReplay>);
    assert.equal(montagens, 2);
    assert.equal(novo.ok, true);
  } finally {
    await a.fechar();
  }
});

test("dia atual: o resultado vale por ~5 s mesmo que o arquivo cresça", async () => {
  let t = new Date(2026, 9, 5, 12, 0, 0).getTime();
  let montagens = 0;
  const a = await ambiente({ agora: () => t, aoMontar: () => montagens++ });
  try {
    a.escrever("2026-10-05.jsonl", TEXTO);
    await fetch(`${a.base}/api/replay/dia?data=2026-10-05`).then((r) => r.text());
    a.anexar("2026-10-05.jsonl", JSON.stringify({ chegada: t, marcador: "servidor_iniciou" }) + "\n");
    t += TTL_DIA_ATUAL_MS - 1000;
    await fetch(`${a.base}/api/replay/dia?data=2026-10-05`).then((r) => r.text());
    assert.equal(montagens, 1, "dentro do TTL");
    t += 2000;
    await fetch(`${a.base}/api/replay/dia?data=2026-10-05`).then((r) => r.text());
    assert.equal(montagens, 2, "passou do TTL e o arquivo mudou");
  } finally {
    await a.fechar();
  }
});

test("/api/replay/dias: conta em fluxo, marca dia sem movimento e o limite atingido; acompanha o arquivo que cresce", async () => {
  const a = await ambiente({ limiteAtingido: (data) => data === "2026-10-05" });
  try {
    a.escrever("2026-10-04.jsonl", `{"chegada":1,"marcador":"servidor_iniciou"}\n`);
    a.escrever("2026-10-05.jsonl", TEXTO);
    a.escrever("2026-10-06.jsonl", "");
    const j = (await (await fetch(`${a.base}/api/replay/dias`)).json()) as DiasReplay;
    assert.deepEqual(j.dias.map((d) => d.data), ["2026-10-05", "2026-10-04"]);
    assert.equal(j.dias[0].limiteAtingido, true);
    assert.equal(j.dias[0].semMovimento, undefined);
    assert.equal(j.dias[1].semMovimento, true);
    assert.equal(j.dias[1].limiteAtingido, undefined);

    a.anexar("2026-10-04.jsonl", JSON.stringify({ chegada: 2, hookTs: null, evento: { hook_event_name: "Stop" } }) + "\n");
    const j2 = (await (await fetch(`${a.base}/api/replay/dias`)).json()) as DiasReplay;
    const d4 = j2.dias.find((d) => d.data === "2026-10-04");
    assert.equal(d4?.eventos, 2);
    assert.equal(d4?.semMovimento, undefined);
  } finally {
    await a.fechar();
  }
});

test("/api/replay/dia: a flag limiteAtingido chega ao painel", async () => {
  const a = await ambiente({ limiteAtingido: () => true });
  try {
    a.escrever("2026-10-05.jsonl", TEXTO);
    const j = (await (await fetch(`${a.base}/api/replay/dia?data=2026-10-05`)).json()) as DiaReplay;
    assert.equal(j.limiteAtingido, true);
  } finally {
    await a.fechar();
  }
});

test("reproduzir em fatias dá o mesmo resultado do síncrono", async () => {
  const linhas = lerJsonl(TEXTO);
  const sync = reproduzir(linhas);
  const fatiado = await drenarCedendo(reproduzirPassos(linhas), 0);
  assert.deepEqual(fatiado.linhaDoTempo, sync.linhaDoTempo);
});

// ---------------------------------------------------------------- privacidade dos campos livres

const MARCADOR = "CLIENTE@acme secreto";

/** troca toda string (e chave de objeto não, só valores) por um marcador conhecido */
function marcar(v: unknown): unknown {
  if (typeof v === "string") return MARCADOR;
  if (Array.isArray(v)) return v.map(marcar);
  if (typeof v === "object" && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, marcar(x)]));
  return v;
}

/** o molde reúne os campos que QUALQUER ferramenta/evento pode ter: o marcador entra em todos */
const MOLDE = {
  hook_event_name: "x",
  session_id: "x",
  agent_id: "x",
  agent_type: "x",
  tool_name: "x",
  tool_use_id: "x",
  source: "x",
  notification_type: "x",
  matcher: "x",
  cwd: "x",
  prompt: "x",
  user_prompt: "x",
  message: "x",
  tool_input: {
    subagent_type: "x", name: "x", description: "x", file_path: "x", notebook_path: "x", command: "x", pattern: "x", query: "x", url: "x",
    skill: "x", to: "x", recipient: "x", message: "x", content: "x", text: "x", taskId: "x", id: "x", task_id: "x", status: "x",
    subject: "x", activeForm: "x", active_form: "x", path: "x", old_string: "x", new_string: "x",
    todos: [{ content: "x", subject: "x", status: "x", activeForm: "x", active_form: "x" }],
  },
  tool_response: { task: { id: "x", titulo: "x" }, taskId: "x", id: "x", success: "x", stdout: "x", stderr: "x" },
  transcript_path: "x",
  extra_novo: "x",
};

const FERRAMENTAS = [
  "Agent", "Task", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "Grep", "Glob", "WebSearch", "WebFetch", "Skill",
  "SendMessage", "TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "AskUserQuestion", "mcp__cliente_acme__ler", "ferramenta nova do cliente",
];
const EVENTOS_HOOK = ["PreToolUse", "PostToolUse", "SessionStart", "SessionEnd", "UserPromptSubmit", "Notification", "Stop", "SubagentStart", "SubagentStop", "PermissionRequest"];

test("marcador conhecido em TODOS os campos livres de cada ferramenta e evento: nenhum aparece no resumo", () => {
  const molde = marcar(MOLDE) as Record<string, unknown>;
  for (const tool of FERRAMENTAS) {
    for (const evento of EVENTOS_HOOK) {
      // ferramenta desconhecida: o próprio nome é o marcador; as demais usam o nome real (escolhe o ramo do anonimizador)
      const comTool = { ...molde, tool_name: tool === "ferramenta nova do cliente" ? MARCADOR : tool, hook_event_name: evento };
      const saida = JSON.stringify(enxugarEvento(structuredClone(comTool), criarRotulos()));
      for (const p of ["CLIENTE", "acme", "secreto", "@"]) {
        // "acme" só pode aparecer em tool_name de MCP (mcp__cliente_acme__ler), que vira mcp__*
        assert.equal(saida.includes(p), false, `${p} vazou em ${tool}/${evento}: ${saida}`);
      }
    }
  }
});

test("pelo ResumoDia (arquivo gravado) o marcador também não aparece", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resumo-marcador-"));
  try {
    const quando = new Date(2026, 9, 5, 10, 0, 0).getTime();
    const r = new ResumoDia(dir, { now: () => quando });
    const molde = marcar(MOLDE) as Record<string, unknown>;
    for (const tool of FERRAMENTAS) for (const evento of EVENTOS_HOOK) r.evento({ ...molde, tool_name: tool === "ferramenta nova do cliente" ? MARCADOR : tool, hook_event_name: evento }, quando);
    await r.esvaziar();
    const texto = fs.readFileSync(arquivoDoDia(dir, quando), "utf8");
    assert.ok(texto.length > 1000);
    for (const p of ["CLIENTE", "acme", "secreto", "@"]) assert.equal(texto.includes(p), false, `${p} vazou`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tool_name de MCP vira mcp__*; ids e tipos fora do padrão viram rótulo/hash estável; os normais passam", () => {
  const r = criarRotulos();
  const mcp = enxugarEvento({ hook_event_name: "PreToolUse", tool_name: "mcp__cliente_acme__ler", session_id: "s1" }, r);
  assert.equal(mcp.tool_name, "mcp__*");
  assert.equal(mcp.session_id, "s1");
  const normal = enxugarEvento({ hook_event_name: "PreToolUse", tool_name: "Read", agent_type: "dev", session_id: "abc-123_x.y:z", tool_use_id: "toolu_01", tool_input: { file_path: "/x/a.ts" } }, r);
  assert.equal(normal.tool_name, "Read");
  assert.equal(normal.agent_type, "dev");
  assert.equal(normal.session_id, "abc-123_x.y:z");
  const estranho1 = enxugarEvento({ hook_event_name: "Stop", session_id: "sessão do cliente!", agent_type: "agente do cliente", source: "x".repeat(41) }, criarRotulos());
  const estranho2 = enxugarEvento({ hook_event_name: "Stop", session_id: "sessão do cliente!" }, criarRotulos());
  assert.match(String(estranho1.session_id), /^id-[0-9a-f]{8}$/);
  assert.equal(estranho1.session_id, estranho2.session_id, "o mesmo id esquisito vira sempre o mesmo hash (o estado segue agrupando a sessão)");
  assert.equal(estranho1.agent_type, "outro");
  assert.equal(estranho1.source, "outro");
});

test("extensão do arquivo: só .letras/números (até 8); o resto fica sem extensão", () => {
  const r = criarRotulos();
  assert.match(r.arquivo.de("/x/a.ts"), /^arquivo-\d+\.ts$/);
  assert.match(r.arquivo.de("/x/b.cliente-acme"), /^arquivo-\d+$/);
  assert.match(r.arquivo.de("/x/c.muitolongaextensao"), /^arquivo-\d+$/);
  assert.match(r.arquivo.de("/x/d.é"), /^arquivo-\d+$/);
});

// ---------------------------------------------------------------- rótulos com teto

test("Rotulos: guarda só hash curto (nunca o texto) e depois do teto devolve o rótulo genérico", () => {
  const r = new Rotulos((n) => `Comando ${n}`, "Comando ?");
  const primeiro = r.de("senha-super-secreta");
  assert.equal(primeiro, "Comando 1");
  assert.equal(r.de("senha-super-secreta"), "Comando 1");
  const mapa = (r as unknown as { mapa: Map<string, string> }).mapa;
  for (const [chave, valor] of mapa) {
    assert.match(chave, /^[0-9a-f]{8}$/);
    assert.equal(valor.includes("senha"), false);
  }
  for (let i = 0; i < MAX_ROTULOS + 500; i++) r.de(`comando forjado ${i}`);
  assert.ok(r.tamanho <= MAX_ROTULOS, `cresceu para ${r.tamanho}`);
  assert.equal(r.de("comando totalmente novo"), "Comando ?");
  assert.equal(r.de("senha-super-secreta"), "Comando 1", "o que já tinha rótulo continua com ele");
});

test("POSTs forjados no ResumoDia não fazem os rótulos crescerem sem limite", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resumo-rotulos-"));
  try {
    const quando = new Date(2026, 9, 5, 10, 0, 0).getTime();
    const limite = 4 * 1024 * 1024;
    const r = new ResumoDia(dir, { now: () => quando, limiteBytes: limite });
    for (let i = 0; i < MAX_ROTULOS + 300; i++) {
      r.evento({ session_id: "s", hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: `t${i}`, tool_input: { file_path: `/x/forjado-${i}.ts` } }, quando);
    }
    await r.esvaziar();
    const rotulos = (r as unknown as { rotulos: ReturnType<typeof criarRotulos> }).rotulos;
    assert.ok(rotulos.arquivo.tamanho <= MAX_ROTULOS);
    const texto = fs.readFileSync(arquivoDoDia(dir, quando), "utf8");
    assert.ok(texto.includes("arquivo-?"), "passou do teto: rótulo genérico");
    assert.equal(texto.includes("forjado"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- cota do dia contra flood

test("flood de sessões desconhecidas não esgota a cota: a sessão real ainda grava e o dia avisa o limite", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resumo-cota-"));
  const aviso = console.warn;
  const avisos: string[] = [];
  console.warn = (...args: unknown[]) => void avisos.push(args.join(" "));
  try {
    const quando = new Date(2026, 9, 5, 10, 0, 0).getTime();
    const limite = 40_000;
    const r = new ResumoDia(dir, { now: () => quando, limiteBytes: limite });
    r.evento({ session_id: "real", hook_event_name: "SessionStart", source: "startup" }, quando);
    for (let i = 0; i < 2000; i++) r.evento({ session_id: `forjada-${i}`, hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: `f${i}`, tool_input: { file_path: `/x/${i}.ts` } }, quando);
    await r.esvaziar();
    const arquivo = arquivoDoDia(dir, quando);
    const tamanhoDoFlood = fs.statSync(arquivo).size;
    assert.ok(tamanhoDoFlood <= limite * 0.7 + 400, `o flood usou ${tamanhoDoFlood} de ${limite}`);
    assert.equal(r.limiteAtingido("2026-10-05"), true);

    // a sessão que abriu de verdade segue gravando na cota reservada
    for (let i = 0; i < 20; i++) r.evento({ session_id: "real", hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: `r${i}`, tool_input: { file_path: `/x/real-${i}.ts` } }, quando);
    await r.esvaziar();
    const texto = fs.readFileSync(arquivo, "utf8");
    assert.ok(fs.statSync(arquivo).size <= limite);
    assert.equal(texto.split("\n").filter((l) => l.includes('"session_id":"real"')).length, 21);
    assert.ok(avisos.length >= 1 && avisos.length <= 2, `avisos: ${avisos.length}`);
    assert.equal(r.limiteAtingido("2026-10-06"), false);
  } finally {
    console.warn = aviso;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sessões novas que mandam SessionStart/UserPromptSubmit viram conhecidas, mas só 30 por minuto", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resumo-promocao-"));
  try {
    const quando = new Date(2026, 9, 5, 10, 0, 0).getTime();
    const limite = 1_000_000;
    const r = new ResumoDia(dir, { now: () => quando, limiteBytes: limite });
    for (let i = 0; i < 100; i++) r.evento({ session_id: `n${i}`, hook_event_name: "SessionStart", source: "startup" }, quando);
    await r.esvaziar();
    const conhecidas = (r as unknown as { conhecidas: Set<string> }).conhecidas;
    assert.equal(conhecidas.size, 30);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
