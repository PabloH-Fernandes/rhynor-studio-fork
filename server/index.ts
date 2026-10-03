// Servidor do escritório: recebe os eventos dos hooks do Claude Code (POST /api/hook)
// e repassa em tempo real para a tela via WebSocket (/ws).

import express, { type ErrorRequestHandler } from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { DEFAULT_SESSION_TIMEOUT_MIN, OfficeState } from "./state.ts";
import { cancelDemo, runDemo } from "./demo.ts";
import { loadRoster, saveRoster } from "./roster.ts";
import { DEFAULT_ROSTER, mergeWithDefaults, validateRoster } from "../shared/roster.ts";

const PORT = Number(process.env.PORT ?? 4747);
/** só na máquina local: os hooks e a tela rodam no mesmo computador */
const HOST = "127.0.0.1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "web", "dist");

/** minutos sem nenhum evento até a sessão ser encerrada (terminal fechado à força, sem SessionEnd) */
const SESSION_TIMEOUT_MIN = parseTimeoutMin(process.env.AG_SESSION_TIMEOUT_MIN);

const state = new OfficeState({ sessionTimeoutMs: SESSION_TIMEOUT_MIN * 60_000 });
state.setRoster(loadRoster());
const app = express();
// cada rota com o próprio limite: eventos de hook podem ser grandes, o elenco não
const hookJson = express.json({ limit: "5mb" });
const rosterJson = express.json({ limit: "64kb" });

// Os hooks rodam em paralelo (async), então os eventos podem chegar um pouco fora de ordem.
// Seguramos cada um por ~150ms e processamos na ordem em que o hook começou.
const queue: { ts: number; seq: number; body: any }[] = [];
let seq = 0;
setInterval(() => {
  if (!queue.length) return;
  const cutoff = Date.now() - 150;
  queue.sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  while (queue.length && queue[0].ts <= cutoff) {
    const { body } = queue.shift()!;
    try {
      state.handleHook(body);
    } catch (err) {
      console.error("[hook] erro ao processar evento:", err);
    }
  }
}, 50).unref();

// Os hooks mandam o JSON do evento aqui. Responde rápido pra nunca atrasar o Claude.
app.post("/api/hook", hookJson, (req, res) => {
  res.status(204).end();
  const ts = Number(req.header("x-hook-ts")) || Date.now();
  queue.push({ ts: Math.min(ts, Date.now()), seq: ++seq, body: req.body });
});

app.get("/api/state", (_req, res) => res.json(state.snapshot()));

// Elenco dos AGzinhos: o atual e o padrão (para "Voltar ao padrão" no vestiário).
app.get("/api/roster", (_req, res) => {
  res.json({ roster: state.getRoster(), padrao: DEFAULT_ROSTER });
});

app.put("/api/roster", rosterJson, async (req, res) => {
  const body: unknown = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body) || !Array.isArray((body as { agzinhos?: unknown }).agzinhos)) {
    res.status(400).json({ ok: false, erros: ["o elenco precisa ser um objeto com a lista agzinhos"] });
    return;
  }
  // normaliza igual ao load (completa com os padrões e descarta campos desconhecidos),
  // então o que fica salvo é o mesmo que volta depois de reiniciar
  const checked = validateRoster(mergeWithDefaults({ ...body, atualizadoEm: new Date().toISOString() }));
  if (!checked.ok) {
    res.status(400).json({ ok: false, erros: checked.erros });
    return;
  }
  try {
    await saveRoster(checked.roster);
  } catch (err) {
    console.error("[roster] erro ao salvar:", err);
    res.status(500).json({ ok: false, erros: ["Não consegui salvar o elenco no servidor. Tente de novo."] });
    return;
  }
  state.setRoster(checked.roster);
  res.json({ ok: true, roster: checked.roster });
});

app.post("/api/demo", (_req, res) => {
  // uma simulação por vez: a anterior para e a sessão dela vai embora
  const anterior = cancelDemo();
  if (anterior) state.endSession(anterior, "Saiu (simulação reiniciada)");
  const info = runDemo(state);
  res.json({ ok: true, ...info });
});

app.post("/api/reset", (_req, res) => {
  cancelDemo(); // senão a simulação em andamento volta a encher o escritório
  state.reset();
  res.json({ ok: true });
});

// Erros do parser de JSON (e qualquer outro) voltam em JSON, sem página HTML nem stack.
const jsonErrors: ErrorRequestHandler = (err: { type?: string; status?: number }, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.type === "entity.parse.failed") return void res.status(400).json({ ok: false, erros: ["JSON inválido"] });
  if (err?.type === "entity.too.large") return void res.status(413).json({ ok: false, erros: ["Corpo grande demais"] });
  console.error("[server] erro:", err);
  const status = typeof err?.status === "number" && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ ok: false, erros: [status === 500 ? "Erro interno do servidor" : "Requisição inválida"] });
};
app.use("/api", jsonErrors);

// Em produção (npm start depois do build) o próprio servidor entrega a tela.
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get("*", (_req, res) => res.sendFile(path.join(DIST, "index.html")));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify(state.snapshot()));
});

state.subscribe((msg) => {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
});

server.listen(PORT, HOST, () => {
  const hasUi = fs.existsSync(DIST);
  console.log(`\n🏢 AG Pocket rodando`);
  console.log(`   Hooks → http://${HOST}:${PORT}/api/hook`);
  console.log(hasUi ? `   Tela  → http://${HOST}:${PORT}` : `   Tela  → http://localhost:5173 (npm run dev)`);
  console.log(`   Sessão sem sinal sai em ${SESSION_TIMEOUT_MIN} min (AG_SESSION_TIMEOUT_MIN)\n`);
});

/** AG_SESSION_TIMEOUT_MIN: minutos (> 0); vazio usa o padrão, inválido avisa e usa o padrão */
function parseTimeoutMin(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_SESSION_TIMEOUT_MIN;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  console.warn(`[config] AG_SESSION_TIMEOUT_MIN="${raw}" inválido, usando ${DEFAULT_SESSION_TIMEOUT_MIN} min`);
  return DEFAULT_SESSION_TIMEOUT_MIN;
}
