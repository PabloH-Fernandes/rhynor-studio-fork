// Servidor do escritório: recebe os eventos dos hooks do Claude Code (POST /api/hook)
// e repassa em tempo real para a tela via WebSocket (/ws).

import express, { type ErrorRequestHandler } from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type { ServerMessage } from "../shared/types.ts";
import { DEFAULT_SESSION_TIMEOUT_MIN, OfficeState } from "./state.ts";
import { Gravador, lerHookTs } from "./gravador.ts";
import { cancelDemo, iniciarDemo } from "./demo.ts";
import { aplicarPut, loadRoster, saveRoster } from "./roster.ts";
import { ESTADO_FILE, PersistenciaEstado } from "./persistencia.ts";
import { DEFAULT_ROSTER } from "../shared/roster.ts";
import { resolverVault } from "./vault.ts";
import { ObservadorVault } from "./vaultWatcher.ts";
import { IngestaoInbox } from "./ingestao.ts";
import { ObservadorCaixa } from "./caixa.ts";
import { registrarCaixa } from "./aprovacao.ts";
import { ObservadorPendencias, registrarPendencias } from "./pendencias.ts";
import { ObservadorResultados, registrarResultados } from "./resultados.ts";
import { criarLeitorEstimativas } from "./estimativas.ts";
import { LogTransparencia, registrarTransparencia } from "./transparenciaLog.ts";
import { clienteWsPermitido } from "./seguranca.ts";
import { GastoTokens } from "./gastoTokens.ts";
import { ObservadorBusca, registrarBusca } from "./busca.ts";

const PORT = Number(process.env.PORT ?? 4747);
/** só na máquina local: os hooks e a tela rodam no mesmo computador */
const HOST = "127.0.0.1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "web", "dist");

/** minutos sem nenhum evento até a sessão ser encerrada (terminal fechado à força, sem SessionEnd) */
const SESSION_TIMEOUT_MIN = parseTimeoutMin(process.env.AG_SESSION_TIMEOUT_MIN);

/**
 * AGPOCKET_GRAVAR=1 grava todo evento cru dos hooks em data/eventos/AAAA-MM-DD.jsonl, para
 * reproduzir depois com `npm run replay`. AG_HOOK_LOG=1 (antigo) vira sinônimo, com aviso.
 */
const HOOK_LOG_OBSOLETO = process.env.AG_HOOK_LOG === "1";
const GRAVAR = process.env.AGPOCKET_GRAVAR === "1" || HOOK_LOG_OBSOLETO;
const gravador = GRAVAR ? new Gravador(path.join(ROOT, "data", "eventos")) : null;
gravador?.servidorIniciou();

const state = new OfficeState({ sessionTimeoutMs: SESSION_TIMEOUT_MIN * 60_000 });
state.setRoster(loadRoster());
// o time de antes do reinício (tsx watch reinicia quando o time edita server/) volta direto pra mesa
// AGPOCKET_ESTADO troca o arquivo (ex.: testes isolados); relativo à raiz do projeto
const ESTADO = process.env.AGPOCKET_ESTADO?.trim() ? path.resolve(ROOT, process.env.AGPOCKET_ESTADO.trim()) : ESTADO_FILE;
const persistencia = new PersistenciaEstado(state, ESTADO);
const restaurados = persistencia.carregar();
persistencia.ligar();
// missões e atas novas do vault (o servidor não herda o env do settings.json: o resolverVault lê de lá)
const vault = new ObservadorVault(() => resolverVault(process.env, os.homedir()));
void vault.iniciar();
// Caixa de entrada: reuniões lidas sem IA que esperam a aprovação (só título, data e tarefas vão para o painel)
const caixa = new ObservadorCaixa(() => resolverVault(process.env, os.homedir()));
void caixa.iniciar();
// Pendências: tarefas em aberto de reuniões (classe eu) e missões, com prazo (só leitura; concluir grava só a linha)
const pendencias = new ObservadorPendencias(() => resolverVault(process.env, os.homedir()));
void pendencias.iniciar();
// Resultados: números contados das notas do vault (atas, tarefas aprovadas, missões e pendências fechadas) e o tempo
// estimado (data/estimativas.json). Só leitura: o painel nunca dispara o Claude.
const resultados = new ObservadorResultados(() => resolverVault(process.env, os.homedir()), criarLeitorEstimativas());
void resultados.iniciar();
// Busca no cérebro: índice em memória do vault (nota confidencial entra só com o título). Só leitura.
const busca = new ObservadorBusca(() => resolverVault(process.env, os.homedir()));
void busca.iniciar();
// Transparência: o que os agentes abriram no vault (só PreToolUse; caminho relativo, nunca conteúdo) em
// data/transparencia/AAAA-MM.jsonl. Roda na fila dos hooks sem esperar nada e sem lançar erro.
// O caminho do vault pode vir de um arquivo (settings.json, lido de forma síncrona): guarda por 5 s para o loop dos hooks.
let vaultMemo: { valor: string | null; ate: number } = { valor: null, ate: 0 };
function vaultDosHooks(): string | null {
  const agora = Date.now();
  if (agora >= vaultMemo.ate) vaultMemo = { valor: resolverVault(process.env, os.homedir()), ate: agora + 5000 };
  return vaultMemo.valor;
}
const transparencia = new LogTransparencia(
  () => ({
    vault: vaultDosHooks(),
    reuniaoSessionId: state.getReuniao()?.sessionId ?? null,
    missaoDaSessao: (sid) => vault.getMissaoDaSessao(sid),
  }),
  { atasDoMes: (mes) => resultados.atasDoMes(mes) },
);
void transparencia.iniciar();
// Gasto de tokens: lê o registro (transcript) do Claude no Stop/SubagentStop, só números (nunca texto), e guarda em
// data/gasto/AAAA-MM-DD.json. Não é custo. Roda fora do loop dos hooks e nunca lança.
function missaoDoGasto(sid: string): string | null {
  const info = vault.getInfo();
  const pedida = vault.getMissaoDaSessao(sid);
  const m = pedida ? info.missoes.find((x) => x.id === pedida) : undefined;
  if (m && m.origem === "reuniao" && m.status !== "concluída") return m.id;
  return null; // sem pedido da própria sessão não há atribuição (a missão "atual" de outra sessão não vale)
}
const gasto = new GastoTokens({
  dir: path.join(ROOT, "data", "gasto"),
  missaoDaSessao: missaoDoGasto,
  missaoDesde: (sid) => vault.getMissaoDesde(sid),
  vault: () => resolverVault(process.env, os.homedir()),
});
void gasto.iniciar();
// leitura das atas do Inbox sem IA (AGPOCKET_INGESTAO=0 desliga): nota em 10-Reunioes e ata arquivada em processadas/
const ingestao =
  process.env.AGPOCKET_INGESTAO?.trim() === "0"
    ? null
    : new IngestaoInbox(() => resolverVault(process.env, os.homedir()), {
        aoIngerir: (ata) => {
          void caixa.recarregar(); // a reunião já aparece na Caixa de entrada junto com a animação
          broadcast({ type: "ata-nova", texto: "Chegou uma ata", hora: ata.hora });
        },
        aoMudarForaDoFormato: (n) => vault.definirForaDoFormato(n),
      });
void ingestao?.iniciar();
// sessão que acaba (SessionEnd, sem sinal, /clear) ou "Limpar": a missão pedida por ela deixa de ser a atual
state.aoEncerrarSessao((sid) => (sid === null ? vault.esquecerTodas() : vault.esquecerSessao(sid)));
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
      // a missão atual vem do prompt "/time Missão [[nota]]" (o texto do prompt não é guardado)
      const sid: unknown = body?.session_id;
      gasto.registrar(body); // ANTES de esquecerSessao: a missão da sessão ainda vale. Síncrono e leve; o resto roda depois
      if (typeof sid === "string") {
        if (body.hook_event_name === "UserPromptSubmit") vault.notarPrompt(sid, String(body.user_prompt ?? body.prompt ?? ""));
        else if (body.hook_event_name === "SessionEnd") vault.esquecerSessao(sid);
      }
      try {
        void transparencia.registrar(body); // ANTES do handleHook: a reunião (/reuniao) ainda é a de agora
      } catch (err) {
        console.warn("[transparencia] erro ao registrar:", err instanceof Error ? err.message : err);
      }
      state.handleHook(body);
    } catch (err) {
      console.error("[hook] erro ao processar evento:", err);
    }
    persistencia.agendar(); // o "último evento" da sessão muda mesmo sem mudar ninguém na tela
  }
}, 50).unref();

// Os hooks mandam o JSON do evento aqui. Responde rápido pra nunca atrasar o Claude.
app.post("/api/hook", hookJson, (req, res) => {
  res.status(204).end();
  const hookTs = lerHookTs(req.header("x-hook-ts"));
  gravador?.evento(req.body, hookTs);
  const ts = hookTs ?? Date.now();
  queue.push({ ts: Math.min(ts, Date.now()), seq: ++seq, body: req.body });
});

app.get("/api/state", (_req, res) => res.json(state.snapshot()));

// Missões do vault (só o que o painel mostra: nada de nome de nota de reunião nem de ata).
app.get("/api/missoes", async (_req, res) => {
  // se a primeira leitura demorar (OneDrive), devolve o último valor conhecido
  await Promise.race([vault.pronto, new Promise((r) => setTimeout(r, 3000).unref())]);
  res.json(vault.getInfo());
});

// Caixa de entrada: GET /api/caixa e POST /api/caixa/aprovar (o POST exige JSON e Origin do próprio painel)
registrarCaixa(app, { resolverVault: () => resolverVault(process.env, os.homedir()), caixa, porta: () => PORT });

// Pendências: GET /api/pendencias e POST /api/pendencias/concluir (o POST exige JSON e Origin do próprio painel)
registrarPendencias(app, { resolverVault: () => resolverVault(process.env, os.homedir()), pendencias, porta: () => PORT });

// Resultados: GET /api/resultados e POST /api/resultados/exportar (grava data/exportacoes/resultados-AAAA-MM-DD.md)
registrarResultados(app, { resultados, porta: () => PORT });

// Busca no cérebro: GET /api/busca?q=... (só leitura; nunca recebe caminho nem devolve caminho absoluto)
registrarBusca(app, { resolverVault: () => resolverVault(process.env, os.homedir()), busca, porta: () => PORT });

// Transparência: GET /api/transparencia?mes=AAAA-MM e POST /api/transparencia/exportar (grava data/transparencia/AAAA-MM.md)
registrarTransparencia(app, { log: transparencia, atasDoMes: (mes) => resultados.atasDoMes(mes), porta: () => PORT });

// Elenco dos AGzinhos: o atual e o padrão (para "Voltar ao padrão" no vestiário).
app.get("/api/roster", (_req, res) => {
  res.json({ roster: state.getRoster(), padrao: DEFAULT_ROSTER });
});

app.put("/api/roster", rosterJson, async (req, res) => {
  // parte do elenco atual e só aceita os campos editáveis (papel, cargo, cordão, matrícula e falas
  // não mudam por aqui); o atualizadoEm sempre avança, pra os navegadores saberem qual é o mais novo
  const checked = aplicarPut(state.getRoster(), req.body);
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
  // uma simulação por vez: a anterior para e a sessão dela vai embora; pedido repetido em poucos segundos
  // (recarga, duas abas) devolve a mesma simulação, sem reiniciar
  const { info } = iniciarDemo(state);
  res.json({ ok: true, ...info });
});

app.post("/api/reset", async (_req, res) => {
  cancelDemo(); // senão a simulação em andamento volta a encher o escritório
  state.reset();
  try {
    await persistencia.limpar(); // senão o próximo boot traz todo mundo de volta
  } catch (err) {
    console.error("[estado] erro ao apagar o estado salvo:", err);
  }
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
const wss = new WebSocketServer({ server, path: "/ws", verifyClient: clienteWsPermitido(() => PORT) });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify(state.snapshot()));
  ws.send(JSON.stringify({ type: "missoes", info: vault.getInfo() } satisfies ServerMessage));
  ws.send(JSON.stringify({ type: "caixa", itens: caixa.getItens() } satisfies ServerMessage));
  ws.send(JSON.stringify({ type: "pendencias", itens: pendencias.getItens() } satisfies ServerMessage));
  ws.send(JSON.stringify({ type: "resultados", resultados: resultados.getResultados() } satisfies ServerMessage));
  ws.send(JSON.stringify({ type: "transparencia", resumo: transparencia.getResumo() } satisfies ServerMessage));
  ws.send(JSON.stringify({ type: "gasto", hoje: gasto.getHoje() } satisfies ServerMessage));
});

function broadcast(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}
state.subscribe(broadcast);
vault.subscribe((info) => broadcast({ type: "missoes", info }));
caixa.subscribe((itens) => broadcast({ type: "caixa", itens }));
pendencias.subscribe((itens) => broadcast({ type: "pendencias", itens }));
resultados.subscribe((r) => broadcast({ type: "resultados", resultados: r }));
transparencia.subscribe((resumo) => broadcast({ type: "transparencia", resumo }));
gasto.subscribe((hoje) => broadcast({ type: "gasto", hoje }));
// missões, caixa e pendências mudaram: os Resultados são recalculados (o próprio observador também vigia as pastas)
vault.subscribe(() => resultados.agendar());
caixa.subscribe(() => resultados.agendar());
pendencias.subscribe(() => resultados.agendar());

server.listen(PORT, HOST, () => {
  const hasUi = fs.existsSync(DIST);
  console.log(`\n🏢 AG Pocket rodando`);
  console.log(`   Hooks → http://${HOST}:${PORT}/api/hook`);
  console.log(hasUi ? `   Tela  → http://${HOST}:${PORT}` : `   Tela  → http://localhost:5173 (npm run dev)`);
  console.log(`   Sessão sem sinal sai em ${SESSION_TIMEOUT_MIN} min (AG_SESSION_TIMEOUT_MIN)`);
  const vaultCaminho = resolverVault(process.env, os.homedir());
  console.log(vaultCaminho ? `   Vault → ${vaultCaminho}` : "   Vault não configurado (rode npm run setup)");
  if (restaurados) console.log(`   Estado restaurado: ${restaurados} AGzinho(s) de volta`);
  console.log("");
  if (HOOK_LOG_OBSOLETO) {
    console.warn("   AG_HOOK_LOG está obsoleto: use AGPOCKET_GRAVAR=1 (por enquanto liga o mesmo gravador)");
  }
  if (GRAVAR) {
    console.warn(
      "   Gravador ligado: todo evento cru vai para data/eventos/AAAA-MM-DD.jsonl. O arquivo contém seus prompts,\n" +
        "   comandos e caminhos de arquivo: fica só nesta máquina (para compartilhar, use npm run replay -- --anonimizar)\n",
    );
  }
});

// Ao desligar, grava o estado na hora (o debounce de 1 s pode não ter rodado ainda).
// No Windows o tsx watch mata o processo sem sinal: aí vale a última gravação do debounce.
let desligando = false;
async function desligar(codigo: number) {
  if (desligando) return;
  desligando = true;
  persistencia.salvarSync();
  // linhas de transparência ainda na corrente: espera, mas no máximo 1 s (corrente travada não segura o desligamento)
  let t: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all([transparencia.esperarGravacoes(), gasto.fechar().catch(() => undefined)]),
    new Promise<void>((resolve) => {
      t = setTimeout(resolve, 1000);
    }),
  ]);
  clearTimeout(t);
  vault.parar();
  caixa.parar();
  pendencias.parar();
  resultados.parar();
  busca.parar();
  transparencia.parar();
  ingestao?.parar();
  process.exit(codigo);
}
process.once("SIGINT", () => void desligar(130));
process.once("SIGTERM", () => void desligar(143));
process.once("SIGHUP", () => void desligar(129));
process.once("beforeExit", () => persistencia.salvarSync());

/** AG_SESSION_TIMEOUT_MIN: minutos (> 0); vazio usa o padrão, inválido avisa e usa o padrão */
function parseTimeoutMin(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_SESSION_TIMEOUT_MIN;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  console.warn(`[config] AG_SESSION_TIMEOUT_MIN="${raw}" inválido, usando ${DEFAULT_SESSION_TIMEOUT_MIN} min`);
  return DEFAULT_SESSION_TIMEOUT_MIN;
}
