import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { arquivoDoDia } from "./gravador.ts";
import { lerJsonl, reproduzir, agentePorKey } from "./replay.ts";
import { ResumoDia } from "./resumoDia.ts";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(RAIZ, "server", "fixtures", "sessoes", "lider-dois-subagentes.jsonl");
const EVENTOS = lerJsonl(fs.readFileSync(FIXTURE, "utf8")).flatMap((l) => ("evento" in l ? [l.evento as Record<string, unknown>] : []));

function pasta(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "resumo-dia-"));
}

/** eventos com segredos em tudo que é campo livre */
const EXTRAS: Record<string, unknown>[] = [
  { session_id: "s1", cwd: "/home/usuario/segredo-projeto", hook_event_name: "UserPromptSubmit", user_prompt: "use a senha123 no login secreto" },
  {
    session_id: "s1",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: "x1",
    tool_input: { command: "curl -u admin:senha123 https://interno.exemplo/login", description: "login secreto com senha123" },
  },
  {
    session_id: "s1",
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_use_id: "x1",
    tool_input: { command: "echo senha123" },
    tool_response: { stdout: "senha123", stderr: "" },
  },
  { session_id: "s1", hook_event_name: "PreToolUse", tool_name: "Grep", tool_use_id: "x2", tool_input: { pattern: "senha123", path: "/home/usuario/segredo" } },
  { session_id: "s1", hook_event_name: "PreToolUse", tool_name: "WebSearch", tool_use_id: "x3", tool_input: { query: "como vazar a senha123" } },
  { session_id: "s1", hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_use_id: "x4", tool_input: { url: "https://segredo.exemplo/senha123" } },
  { session_id: "s1", hook_event_name: "Notification", message: "Claude needs your permission to run curl senha123", notification_type: "permission_prompt" },
  { session_id: "s1", hook_event_name: "Notification", message: "senha123 está na área de transferência" },
  { session_id: "s1", hook_event_name: "PreToolUse", tool_name: "SendMessage", tool_use_id: "x5", tool_input: { to: "dev", message: "a senha123 é essa" } },
  { session_id: "s1", hook_event_name: "PreToolUse", tool_name: "mcp__cofre__ler", tool_use_id: "x6", tool_input: { chave: "senha123" } },
  { session_id: "s1", hook_event_name: "PostToolUse", tool_name: "TaskCreate", tool_use_id: "x7", tool_input: { subject: "Vazar a senha123", description: "login secreto" }, tool_response: { task: { id: "1" }, texto: "senha123" } },
  { session_id: "s1", hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: "x8", tool_input: { file_path: "/home/usuario/senha123/.env" } },
];

const SEGREDOS = ["login secreto", "senha123", "npm test", "curl", "admin:", "segredo", "/home/usuario", "exemplo.invalid/senha", "transcript", "área de transferência"];

async function gravarTudo(dir: string, quando: number): Promise<{ texto: string; linhas: Record<string, unknown>[] }> {
  const r = new ResumoDia(dir, { now: () => quando });
  r.servidorIniciou();
  for (const ev of [...EVENTOS, ...EXTRAS]) r.evento(ev, quando - 5);
  await r.esvaziar();
  const arquivo = arquivoDoDia(dir, quando);
  const texto = fs.readFileSync(arquivo, "utf8");
  return { texto, linhas: texto.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) };
}

test("nada de segredo no arquivo: prompt, comando, resposta, busca, mensagem e caminhos somem", async () => {
  const dir = pasta();
  try {
    const { texto, linhas } = await gravarTudo(dir, new Date(2026, 9, 5, 10, 0, 0).getTime());
    for (const s of SEGREDOS) assert.equal(texto.includes(s), false, `vazou: ${s}`);
    // mesmo com tudo isso, o arquivo existe e tem uma linha por evento (+ o marcador)
    assert.equal(linhas.length, 1 + EVENTOS.length + EXTRAS.length);
    assert.equal(linhas[0].marcador, "servidor_iniciou");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("só campos permitidos: nenhum prompt, message, tool_response de PostToolUse comum nem caminho original", async () => {
  const dir = pasta();
  try {
    const { linhas } = await gravarTudo(dir, new Date(2026, 9, 5, 10, 0, 0).getTime());
    const permitidosEvento = new Set([
      "hook_event_name", "session_id", "agent_id", "agent_type", "tool_name", "tool_use_id", "source", "notification_type", "matcher",
      "cwd", "message", "tool_input", "tool_response",
    ]);
    const permitidosInput = new Set(["subagent_type", "name", "description", "file_path", "notebook_path", "skill", "to", "recipient", "todos", "taskId", "id", "task_id", "status", "subject", "activeForm"]);
    for (const l of linhas) {
      if (!("evento" in l)) continue;
      const ev = l.evento as Record<string, unknown>;
      for (const k of Object.keys(ev)) assert.ok(permitidosEvento.has(k), `campo não permitido: ${k}`);
      assert.equal("prompt" in ev, false);
      assert.equal("user_prompt" in ev, false);
      if (ev.cwd !== undefined) assert.equal(ev.cwd, "/projeto");
      if (ev.hook_event_name === "PostToolUse" && ev.tool_name !== "TaskCreate" && ev.tool_name !== "TaskUpdate") {
        assert.equal("tool_response" in ev, false, "PostToolUse não leva tool_response");
      }
      const ti = ev.tool_input as Record<string, unknown> | undefined;
      if (ti) for (const k of Object.keys(ti)) assert.ok(permitidosInput.has(k), `tool_input.${k} não permitido`);
      if (typeof ti?.file_path === "string") assert.match(ti.file_path, /^arquivo-\d+(\.\w+)?$/);
    }
    // a tarefa vira "Tarefa N"
    const todo = linhas.find((l) => "evento" in l && (l.evento as { tool_name?: string }).tool_name === "TodoWrite");
    assert.match(JSON.stringify(todo), /Tarefa 1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("o arquivo enxuto passa direto pelo reproduzir e o líder segue coordenando", async () => {
  const dir = pasta();
  try {
    const { texto } = await gravarTudo(dir, new Date(2026, 9, 5, 10, 0, 0).getTime());
    const { state } = reproduzir(lerJsonl(texto));
    assert.equal(agentePorKey(state, "lider")?.status !== undefined, true);
    assert.ok(agentePorKey(state, "dev"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rótulos são estáveis no dia: o mesmo arquivo vira sempre o mesmo arquivo-N", async () => {
  const dir = pasta();
  try {
    const t = new Date(2026, 9, 5, 10, 0, 0).getTime();
    const r = new ResumoDia(dir, { now: () => t });
    for (const f of ["/a/x.ts", "/a/y.ts", "/a/x.ts"]) r.evento({ hook_event_name: "PreToolUse", session_id: "s", tool_name: "Read", tool_input: { file_path: f } }, null);
    await r.esvaziar();
    const nomes = fs.readFileSync(arquivoDoDia(dir, t), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).evento.tool_input.file_path);
    assert.deepEqual(nomes, ["arquivo-1.ts", "arquivo-2.ts", "arquivo-1.ts"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lixo no corpo (null, texto, lista) é ignorado sem lançar", async () => {
  const dir = pasta();
  try {
    const r = new ResumoDia(dir);
    for (const lixo of [null, undefined, "texto", 42, [1, 2]]) assert.doesNotThrow(() => r.evento(lixo, null));
    const circular: Record<string, unknown> = { hook_event_name: "Stop", session_id: "s" };
    circular.self = circular;
    assert.doesNotThrow(() => r.evento(circular, null));
    await r.esvaziar();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("limite por dia: para de gravar, avisa uma vez e o dia seguinte grava normal", async () => {
  const dir = pasta();
  const avisos: unknown[][] = [];
  const antes = console.warn;
  console.warn = (...a: unknown[]) => void avisos.push(a);
  try {
    let agora = new Date(2026, 9, 5, 10, 0, 0).getTime();
    const r = new ResumoDia(dir, { now: () => agora, limiteBytes: 600 });
    for (let i = 0; i < 20; i++) r.evento({ hook_event_name: "Stop", session_id: "s" + i }, null);
    await r.esvaziar();
    const arquivo = arquivoDoDia(dir, agora);
    assert.ok(fs.statSync(arquivo).size <= 600);
    assert.ok(fs.readFileSync(arquivo, "utf8").split("\n").filter(Boolean).length < 20);
    assert.equal(avisos.filter((a) => String(a[0]).includes("limite")).length, 1);
    agora += 24 * 3600_000;
    r.evento({ hook_event_name: "Stop", session_id: "novo" }, null);
    await r.esvaziar();
    assert.ok(fs.existsSync(arquivoDoDia(dir, agora)));
  } finally {
    console.warn = antes;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("o limite vale também depois de reiniciar o servidor (lê o tamanho que já está no disco)", async () => {
  const dir = pasta();
  const antes = console.warn;
  console.warn = () => undefined;
  try {
    const agora = new Date(2026, 9, 5, 10, 0, 0).getTime();
    const a = new ResumoDia(dir, { now: () => agora, limiteBytes: 400 });
    for (let i = 0; i < 10; i++) a.evento({ hook_event_name: "Stop", session_id: "s" }, null);
    await a.esvaziar();
    const tamanho = fs.statSync(arquivoDoDia(dir, agora)).size;
    const b = new ResumoDia(dir, { now: () => agora, limiteBytes: 400 });
    for (let i = 0; i < 10; i++) b.evento({ hook_event_name: "Stop", session_id: "s" }, null);
    await b.esvaziar();
    assert.ok(fs.statSync(arquivoDoDia(dir, agora)).size <= 400);
    assert.ok(fs.statSync(arquivoDoDia(dir, agora)).size >= tamanho);
  } finally {
    console.warn = antes;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("retenção: apaga só dias antigos no formato do resumo e deixa o resto", async () => {
  const dir = pasta();
  try {
    const agora = new Date(2026, 9, 31, 12, 0, 0).getTime();
    const escrever = (n: string) => fs.writeFileSync(path.join(dir, n), "{}\n");
    for (const n of ["2026-09-01.jsonl", "2026-09-30.jsonl", "2026-10-01.jsonl", "2026-10-30.jsonl", "notas.txt", "2020-01-01.md"]) escrever(n);
    const r = new ResumoDia(dir, { now: () => agora, retencaoDias: 30 });
    const apagados = await r.limpar();
    assert.deepEqual(apagados.sort(), ["2026-09-01.jsonl", "2026-09-30.jsonl"]);
    assert.deepEqual(fs.readdirSync(dir).sort(), ["2020-01-01.md", "2026-10-01.jsonl", "2026-10-30.jsonl", "notas.txt"]);
    // pasta que não existe não é erro
    assert.deepEqual(await new ResumoDia(path.join(dir, "nao-existe")).limpar(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gravar é barato: mediana abaixo de 2 ms por evento", async () => {
  const dir = pasta();
  try {
    const r = new ResumoDia(dir);
    const tempos: number[] = [];
    for (let i = 0; i < 300; i++) {
      const ev = EVENTOS[i % EVENTOS.length];
      const t0 = performance.now();
      r.evento(ev, null);
      tempos.push(performance.now() - t0);
    }
    await r.esvaziar();
    tempos.sort((a, b) => a - b);
    assert.ok(tempos[150] < 2, `mediana ${tempos[150]} ms`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("data/replay está no .gitignore (git check-ignore)", () => {
  let saida = "";
  try {
    saida = execFileSync("git", ["check-ignore", "data/replay/x.jsonl"], { cwd: RAIZ, encoding: "utf8" });
  } catch {
    assert.fail("data/replay/x.jsonl não está ignorado pelo git");
  }
  assert.match(saida, /data\/replay\/x\.jsonl/);
});
