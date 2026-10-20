// Rotas do Replay do dia (só leitura, só Host local):
//   GET /api/replay/dias              -> datas disponíveis e quantas linhas cada uma tem
//   GET /api/replay/dia?data=AAAA-MM-DD -> as mensagens do escritório ao longo do dia, mais chaves a cada ~60 s
//
// O replay roda num OfficeState NOVO com relógio virtual (server/replay.ts): não toca no estado real nem na
// persistência. A data é validada por regex e vira nome de arquivo só depois disso (nunca caminho livre).
//
// Um dia de ~5 MB leva centenas de ms de CPU para montar. Para não travar os hooks (/api/hook) no mesmo processo:
// o trabalho roda em fatias que devolvem o event loop (leitura, reprodução e serialização), o resultado fica em
// cache por data (mtime+size; o dia atual vale só ~5 s) e há UMA montagem por data (e uma de cada vez no total).

import type { Express } from "express";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { Roster } from "../shared/roster.ts";
import { DEFAULT_ROSTER } from "../shared/roster.ts";
import { diaLocal } from "../shared/datas.ts";
import {
  MAX_MENSAGENS_REPLAY,
  calcularChaves,
  type DiaDisponivel,
  type DiaReplay,
  type DiasReplay,
  type MensagemDoDia,
} from "../shared/replay.ts";
import type { LinhaGravada } from "./gravador.ts";
import { drenar, drenarCedendo, lerJsonl, reproduzirPassos, type RelogioVirtual } from "./replay.ts";
import { exigirHostLocal } from "./seguranca.ts";
import { OfficeState } from "./state.ts";

export interface RotasReplayDeps {
  /** pasta dos resumos (data/replay) */
  dir: () => string;
  porta: () => number;
  /** elenco atual (os nomes dos AGzinhos vêm dele) */
  roster?: () => Roster;
  /** o dia bateu no limite de gravação? (bytes = tamanho do arquivo, para quem reiniciou o servidor) */
  limiteAtingido?: (data: string, bytes: number) => boolean;
  /** relógio (testes) */
  agora?: () => number;
}

const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_ARQUIVO = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** o dia de hoje ainda recebe eventos: o resultado vale por pouco tempo mesmo que o arquivo mude */
export const TTL_DIA_ATUAL_MS = 5000;
/** quantos dias montados ficam em memória */
const MAX_DIAS_EM_CACHE = 4;
/** quanto trabalho seguido (ms) antes de devolver o controle ao servidor (hooks, WebSocket) */
const FATIA_MS = 8;
/** mensagens por lote ao serializar */
const LOTE_SERIALIZAR = 400;

/** AAAA-MM-DD que existe no calendário (2026-02-31 não vale) */
export function dataValida(data: unknown): data is string {
  if (typeof data !== "string" || !REGEX_DATA.test(data)) return false;
  const [a, m, d] = data.split("-").map(Number);
  const dt = new Date(a, m - 1, d);
  return dt.getFullYear() === a && dt.getMonth() === m - 1 && dt.getDate() === d;
}

type LeituraTolerante = { linhas: LinhaGravada[]; ignoradas: number };

/** Lê o .jsonl ignorando as linhas ruins (arquivo cortado no meio, texto estranho). Cede (yield) de tempos em tempos. */
function* lerPassos(texto: string): Generator<void, LeituraTolerante> {
  const linhas: LinhaGravada[] = [];
  let ignoradas = 0;
  let n = 0;
  for (const bruta of texto.split(/\r?\n/)) {
    if (++n % 200 === 0) yield;
    if (!bruta.trim()) continue;
    try {
      linhas.push(...lerJsonl(bruta));
    } catch {
      ignoradas++;
    }
  }
  return { linhas, ignoradas };
}

export function lerJsonlTolerante(texto: string): LeituraTolerante {
  return drenar(lerPassos(texto));
}

/** assinatura do que o painel desenha de um agente: se não mudou, a mensagem não entra no dia */
function assinatura(a: { status: string; activity: string; name: string; agzinho?: string; role: string; excedente?: boolean; parentId?: string }): string {
  return [a.status, a.activity, a.name, a.agzinho ?? "", a.role, a.excedente ? 1 : 0, a.parentId ?? ""].join("|");
}

/** Reproduz as linhas e devolve só o que o painel precisa (agent, remove, progress, limpar). Cede o event loop entre as linhas. */
function* montarPassos(data: string, linhas: readonly LinhaGravada[], ignoradas: number, roster: Roster): Generator<void, DiaReplay> {
  const bruto: MensagemDoDia[] = [];
  const ultimo = new Map<string, string>();
  let ultimoProgress = "";
  yield* reproduzirPassos(linhas, {
    roster,
    aoReiniciar: (_anterior, relogio: RelogioVirtual) => {
      bruto.push({ t: relogio.now(), msg: { type: "limpar" } });
      ultimo.clear();
      ultimoProgress = "";
      const novo = new OfficeState({ relogio, sweepEveryMs: 0 });
      novo.setRoster(structuredClone(roster));
      return novo;
    },
    aoMensagem: (t, msg) => {
      if (msg.type === "agent") {
        const sig = assinatura(msg.agent);
        if (ultimo.get(msg.agent.id) === sig) return;
        ultimo.set(msg.agent.id, sig);
        bruto.push({ t, msg: { type: "agent", agent: structuredClone(msg.agent) } });
      } else if (msg.type === "remove") {
        ultimo.delete(msg.id);
        bruto.push({ t, msg: { type: "remove", id: msg.id } });
      } else if (msg.type === "progress") {
        const s = JSON.stringify(msg.progress);
        if (s === ultimoProgress) return;
        ultimoProgress = s;
        bruto.push({ t, msg: { type: "progress", progress: msg.progress } });
      }
    },
  });
  yield;
  const { lista, reduzido } = reduzir(bruto);
  yield;
  return {
    ok: true,
    data,
    inicio: linhas.length ? linhas[0].chegada : 0,
    fim: linhas.length ? linhas[linhas.length - 1].chegada : 0,
    mensagens: lista,
    chaves: calcularChaves(lista),
    ...(reduzido ? { reduzido: true } : {}),
    ...(ignoradas ? { linhasIgnoradas: ignoradas } : {}),
  };
}

export function montarDia(data: string, linhas: readonly LinhaGravada[], ignoradas: number, roster: Roster): DiaReplay {
  return drenar(montarPassos(data, linhas, ignoradas, roster));
}

/** passou do limite: ficam só as mudanças de status (o resto da atividade some); ainda grande, corta o FIM do dia */
function reduzir(msgs: MensagemDoDia[]): { lista: MensagemDoDia[]; reduzido: boolean } {
  if (msgs.length <= MAX_MENSAGENS_REPLAY) return { lista: msgs, reduzido: false };
  const status = new Map<string, string>();
  let lista = msgs.filter((m) => {
    if (m.msg.type === "limpar") status.clear();
    if (m.msg.type === "remove") status.delete(m.msg.id);
    if (m.msg.type !== "agent") return true;
    const antes = status.get(m.msg.agent.id);
    status.set(m.msg.agent.id, m.msg.agent.status);
    return antes !== m.msg.agent.status;
  });
  if (lista.length > MAX_MENSAGENS_REPLAY) lista = lista.slice(0, MAX_MENSAGENS_REPLAY);
  return { lista, reduzido: true };
}

/** JSON do dia em lotes (JSON.stringify de milhares de mensagens de uma vez trava o servidor por dezenas de ms) */
async function serializarDia(dia: DiaReplay): Promise<string> {
  const { mensagens, ...resto } = dia;
  const cabeca = JSON.stringify(resto).slice(0, -1); // sem o "}" final
  const partes: string[] = [];
  let inicio = performance.now();
  for (let i = 0; i < mensagens.length; i += LOTE_SERIALIZAR) {
    partes.push(
      mensagens
        .slice(i, i + LOTE_SERIALIZAR)
        .map((m) => JSON.stringify(m))
        .join(","),
    );
    if (performance.now() - inicio >= FATIA_MS) {
      await new Promise<void>((ok) => setImmediate(ok));
      inicio = performance.now();
    }
  }
  return `${cabeca},"mensagens":[${partes.join(",")}]}`;
}

interface DiaEmCache {
  mtimeMs: number;
  size: number;
  construidoEm: number;
  json: string;
}

interface InfoArquivo {
  mtimeMs: number;
  size: number;
  /** linhas do arquivo */
  linhas: number;
  /** linhas que não são o marcador de início do servidor */
  movimento: number;
}

/** conta as linhas em fluxo (sem carregar o arquivo inteiro na memória nem travar o event loop) */
async function contarLinhas(arquivo: string): Promise<{ linhas: number; movimento: number }> {
  const entrada = fs.createReadStream(arquivo, { encoding: "utf8" });
  const rl = readline.createInterface({ input: entrada, crlfDelay: Infinity });
  let linhas = 0;
  let movimento = 0;
  try {
    for await (const l of rl) {
      if (!l.trim()) continue;
      linhas++;
      if (!(l.startsWith('{"chegada":') && l.includes('"marcador":"servidor_iniciou"'))) movimento++;
    }
  } finally {
    rl.close();
    entrada.destroy();
  }
  return { linhas, movimento };
}

export function registrarReplay(app: Express, deps: RotasReplayDeps) {
  const agora = deps.agora ?? Date.now;
  /** dias já montados (chave: data); mtime+size dizem se o arquivo mudou */
  const cacheDias = new Map<string, DiaEmCache>();
  /** UMA montagem por data em andamento: pedidos repetidos esperam a mesma promessa */
  const emAndamento = new Map<string, Promise<string>>();
  /** e uma montagem de cada vez no servidor todo (as outras esperam a vez) */
  let fila: Promise<unknown> = Promise.resolve();
  const infoArquivos = new Map<string, InfoArquivo>();
  let listando: Promise<DiaDisponivel[]> | null = null;

  async function montarEGuardar(data: string, arquivo: string, st: fs.Stats): Promise<string> {
    const texto = await fs.promises.readFile(arquivo, "utf8");
    const { linhas, ignoradas } = await drenarCedendo(lerPassos(texto), FATIA_MS);
    const dia = await drenarCedendo(montarPassos(data, linhas, ignoradas, deps.roster?.() ?? DEFAULT_ROSTER), FATIA_MS);
    if (deps.limiteAtingido?.(data, st.size)) dia.limiteAtingido = true;
    const json = await serializarDia(dia);
    cacheDias.delete(data);
    cacheDias.set(data, { mtimeMs: st.mtimeMs, size: st.size, construidoEm: agora(), json });
    while (cacheDias.size > MAX_DIAS_EM_CACHE) cacheDias.delete(cacheDias.keys().next().value as string);
    return json;
  }

  /** JSON do dia (do cache ou montado agora); null se não há arquivo */
  async function jsonDoDia(data: string): Promise<string | null> {
    const arquivo = path.join(deps.dir(), `${data}.jsonl`);
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(arquivo);
      if (!st.isFile()) return null;
    } catch {
      return null;
    }
    const emCache = cacheDias.get(data);
    if (emCache) {
      const igual = emCache.mtimeMs === st.mtimeMs && emCache.size === st.size;
      const recente = data === diaLocal(agora()) && agora() - emCache.construidoEm < TTL_DIA_ATUAL_MS;
      if (igual || recente) return emCache.json;
    }
    let promessa = emAndamento.get(data);
    if (!promessa) {
      const vez = fila.then(() => montarEGuardar(data, arquivo, st));
      fila = vez.catch(() => undefined);
      promessa = vez.finally(() => emAndamento.delete(data));
      emAndamento.set(data, promessa);
    }
    return promessa;
  }

  async function listarDias(): Promise<DiaDisponivel[]> {
    const dias: DiaDisponivel[] = [];
    const vistos = new Set<string>();
    try {
      for (const nome of await fs.promises.readdir(deps.dir())) {
        const m = REGEX_ARQUIVO.exec(nome);
        if (!m || !dataValida(m[1])) continue;
        const arquivo = path.join(deps.dir(), nome);
        try {
          const st = await fs.promises.stat(arquivo);
          if (!st.isFile()) continue;
          vistos.add(nome);
          let info = infoArquivos.get(nome);
          if (!info || info.mtimeMs !== st.mtimeMs || info.size !== st.size) {
            info = { mtimeMs: st.mtimeMs, size: st.size, ...(await contarLinhas(arquivo)) };
            infoArquivos.set(nome, info);
          }
          if (info.linhas === 0) continue;
          dias.push({
            data: m[1],
            eventos: info.linhas,
            ...(info.movimento === 0 ? { semMovimento: true } : {}),
            ...(deps.limiteAtingido?.(m[1], st.size) ? { limiteAtingido: true } : {}),
          });
        } catch {
          /* arquivo sumiu ou não abre: fora da lista */
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") console.warn("[replay] não consegui listar os dias:", err instanceof Error ? err.message : err);
    }
    for (const nome of infoArquivos.keys()) if (!vistos.has(nome)) infoArquivos.delete(nome);
    dias.sort((a, b) => b.data.localeCompare(a.data));
    return dias;
  }

  app.get("/api/replay/dias", exigirHostLocal(deps.porta), async (_req, res) => {
    try {
      listando ??= listarDias().finally(() => {
        listando = null;
      });
      const dias = await listando;
      res.json({ ok: true, dias } satisfies DiasReplay);
    } catch (err) {
      console.error("[replay] erro ao listar os dias:", err);
      res.status(500).json({ ok: false, erros: ["Não consegui listar os dias"] });
    }
  });

  app.get("/api/replay/dia", exigirHostLocal(deps.porta), async (req, res) => {
    const data = req.query.data;
    if (!dataValida(data)) {
      res.status(400).json({ ok: false, erros: ["Data inválida: use AAAA-MM-DD"] });
      return;
    }
    try {
      const json = await jsonDoDia(data);
      if (json === null) {
        res.status(404).json({ ok: false, erros: ["Não há replay para esse dia"] });
        return;
      }
      res.type("application/json").send(json);
    } catch (err) {
      console.error("[replay] erro ao montar o dia:", err);
      res.status(500).json({ ok: false, erros: ["Não consegui montar o replay desse dia"] });
    }
  });
}
