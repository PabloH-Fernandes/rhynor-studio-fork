// Rotas do Replay do dia (só leitura, só Host local):
//   GET /api/replay/dias              -> datas disponíveis e quantas linhas cada uma tem
//   GET /api/replay/dia?data=AAAA-MM-DD -> as mensagens do escritório ao longo do dia, mais chaves a cada ~60 s
//
// O replay roda num OfficeState NOVO com relógio virtual (server/replay.ts): não toca no estado real nem na
// persistência. A data é validada por regex e vira nome de arquivo só depois disso (nunca caminho livre).

import type { Express } from "express";
import fs from "node:fs";
import path from "node:path";
import type { Roster } from "../shared/roster.ts";
import { DEFAULT_ROSTER } from "../shared/roster.ts";
import {
  INTERVALO_CHAVE_MS,
  MAX_MENSAGENS_REPLAY,
  type ChaveReplay,
  type DiaDisponivel,
  type DiaReplay,
  type DiasReplay,
  type MensagemDoDia,
} from "../shared/replay.ts";
import type { LinhaGravada } from "./gravador.ts";
import { lerJsonl, reproduzir, type RelogioVirtual } from "./replay.ts";
import { exigirHostLocal } from "./seguranca.ts";
import { OfficeState } from "./state.ts";

export interface RotasReplayDeps {
  /** pasta dos resumos (data/replay) */
  dir: () => string;
  porta: () => number;
  /** elenco atual (os nomes dos AGzinhos vêm dele) */
  roster?: () => Roster;
}

const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_ARQUIVO = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** AAAA-MM-DD que existe no calendário (2026-02-31 não vale) */
export function dataValida(data: unknown): data is string {
  if (typeof data !== "string" || !REGEX_DATA.test(data)) return false;
  const [a, m, d] = data.split("-").map(Number);
  const dt = new Date(a, m - 1, d);
  return dt.getFullYear() === a && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Lê o .jsonl ignorando as linhas ruins (arquivo cortado no meio, texto estranho). */
export function lerJsonlTolerante(texto: string): { linhas: LinhaGravada[]; ignoradas: number } {
  const linhas: LinhaGravada[] = [];
  let ignoradas = 0;
  for (const bruta of texto.split(/\r?\n/)) {
    if (!bruta.trim()) continue;
    try {
      linhas.push(...lerJsonl(bruta));
    } catch {
      ignoradas++;
    }
  }
  return { linhas, ignoradas };
}

/** assinatura do que o painel desenha de um agente: se não mudou, a mensagem não entra no dia */
function assinatura(a: { status: string; activity: string; name: string; agzinho?: string; role: string; excedente?: boolean; parentId?: string }): string {
  return [a.status, a.activity, a.name, a.agzinho ?? "", a.role, a.excedente ? 1 : 0, a.parentId ?? ""].join("|");
}

/** Reproduz as linhas e devolve só o que o painel precisa (agent, remove, progress, limpar). */
export function montarDia(data: string, linhas: readonly LinhaGravada[], ignoradas: number, roster: Roster): DiaReplay {
  const bruto: MensagemDoDia[] = [];
  const ultimo = new Map<string, string>();
  let ultimoProgress = "";
  reproduzir(linhas, {
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
  const { lista, reduzido } = reduzir(bruto);
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

/** passou do limite: ficam só as mudanças de status (o resto da atividade some); ainda grande, corta o fim */
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

/** uma chave por janela de ~60 s que tem mensagem: o índice da primeira mensagem dali em diante */
export function calcularChaves(msgs: readonly MensagemDoDia[]): ChaveReplay[] {
  const chaves: ChaveReplay[] = [];
  if (!msgs.length) return chaves;
  const base = msgs[0].t;
  let ultimaJanela = -1;
  for (let i = 0; i < msgs.length; i++) {
    const janela = Math.floor((msgs[i].t - base) / INTERVALO_CHAVE_MS);
    if (janela !== ultimaJanela) {
      chaves.push({ t: base + janela * INTERVALO_CHAVE_MS, i });
      ultimaJanela = janela;
    }
  }
  return chaves;
}

export function registrarReplay(app: Express, deps: RotasReplayDeps) {
  app.get("/api/replay/dias", exigirHostLocal(deps.porta), async (_req, res) => {
    const dias: DiaDisponivel[] = [];
    try {
      for (const nome of await fs.promises.readdir(deps.dir())) {
        const m = REGEX_ARQUIVO.exec(nome);
        if (!m || !dataValida(m[1])) continue;
        try {
          const texto = await fs.promises.readFile(path.join(deps.dir(), nome), "utf8");
          const eventos = texto.split("\n").filter((l) => l.trim()).length;
          if (eventos > 0) dias.push({ data: m[1], eventos });
        } catch {
          /* arquivo sumiu ou não abre: fora da lista */
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") console.warn("[replay] não consegui listar os dias:", err instanceof Error ? err.message : err);
    }
    dias.sort((a, b) => b.data.localeCompare(a.data));
    res.json({ ok: true, dias } satisfies DiasReplay);
  });

  app.get("/api/replay/dia", exigirHostLocal(deps.porta), async (req, res) => {
    const data = req.query.data;
    if (!dataValida(data)) {
      res.status(400).json({ ok: false, erros: ["Data inválida: use AAAA-MM-DD"] });
      return;
    }
    let texto: string;
    try {
      texto = await fs.promises.readFile(path.join(deps.dir(), `${data}.jsonl`), "utf8");
    } catch {
      res.status(404).json({ ok: false, erros: ["Não há replay para esse dia"] });
      return;
    }
    try {
      const { linhas, ignoradas } = lerJsonlTolerante(texto);
      res.json(montarDia(data, linhas, ignoradas, deps.roster?.() ?? DEFAULT_ROSTER));
    } catch (err) {
      console.error("[replay] erro ao montar o dia:", err);
      res.status(500).json({ ok: false, erros: ["Não consegui montar o replay desse dia"] });
    }
  });
}
