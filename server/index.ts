// Servidor do escritório: recebe os eventos dos hooks do Claude Code (POST /api/hook)
// e repassa em tempo real para a tela via WebSocket (/ws).

import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { OfficeState } from "./state.ts";
import { runDemo } from "./demo.ts";

const PORT = Number(process.env.PORT ?? 4747);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "web", "dist");

const state = new OfficeState();
const app = express();
app.use(express.json({ limit: "5mb" }));

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
app.post("/api/hook", (req, res) => {
  res.status(204).end();
  const ts = Number(req.header("x-hook-ts")) || Date.now();
  queue.push({ ts: Math.min(ts, Date.now()), seq: ++seq, body: req.body });
});

app.get("/api/state", (_req, res) => res.json(state.snapshot()));

app.post("/api/demo", (_req, res) => {
  const info = runDemo(state);
  res.json({ ok: true, ...info });
});

app.post("/api/reset", (_req, res) => {
  state.reset();
  res.json({ ok: true });
});

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

server.listen(PORT, () => {
  const hasUi = fs.existsSync(DIST);
  console.log(`\n🏢 Escritório de IA rodando`);
  console.log(`   Hooks → http://localhost:${PORT}/api/hook`);
  console.log(hasUi ? `   Tela  → http://localhost:${PORT}\n` : `   Tela  → http://localhost:5173 (npm run dev)\n`);
});
