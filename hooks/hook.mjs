#!/usr/bin/env node
// Hook do Claude Code: pega o JSON do evento (stdin) e manda pro servidor do escritório.
// Nunca falha e nunca segura o Claude: se o escritório estiver fechado, só ignora.

const PORT = process.env.STUDIO_PORT || "4848";
const URL = `http://127.0.0.1:${PORT}/api/hook`;

const startedAt = Date.now(); // usado pelo servidor pra manter a ordem dos eventos
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", async () => {
  try {
    if (raw.trim()) {
      await fetch(URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hook-ts": String(startedAt) },
        body: raw,
        signal: AbortSignal.timeout(1500),
      });
    }
  } catch {
    // escritório fechado ou lento: tudo bem, segue o jogo
  }
  process.exit(0);
});
