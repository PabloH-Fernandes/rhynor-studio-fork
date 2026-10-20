// Replay do dia (lógica pura, sem React): o estado do escritório em qualquer instante `t` do dia, a partir das
// mensagens que o servidor montou (GET /api/replay/dia). Nada aqui toca no estado ao vivo: o replay tem o próprio
// estado, que alimenta um segundo OfficeCanvas.

import type { Agent, Progress } from "../../shared/types";
import type { ChaveReplay, DiaReplay, MensagemDoDia, MensagemReplay } from "../../shared/replay";

export const VELOCIDADES = [10, 30, 60] as const;
export type Velocidade = (typeof VELOCIDADES)[number];

export const TEXTO_VAZIO = "Ligue o servidor durante o dia para ter replay.";
export const AVISO_VELOCIDADE = "A 60x os AGzinhos saltam de status; andam na velocidade normal.";

/** quadro parado a cada `dt` acima disso (aba em segundo plano) não faz o replay pular de uma vez */
export const DT_MAXIMO_MS = 250;

export interface EstadoReplay {
  agents: Record<string, Agent>;
  progress: Progress | null;
}

export function estadoVazio(): EstadoReplay {
  return { agents: {}, progress: null };
}

/** aplica uma mensagem no estado (muda o próprio objeto) */
export function aplicar(estado: EstadoReplay, msg: MensagemReplay): void {
  switch (msg.type) {
    case "agent":
      estado.agents[msg.agent.id] = msg.agent;
      break;
    case "remove":
      delete estado.agents[msg.id];
      break;
    case "progress":
      estado.progress = msg.progress;
      break;
    case "limpar":
      estado.agents = {};
      estado.progress = null;
      break;
  }
}

function copiar(e: EstadoReplay): EstadoReplay {
  return { agents: { ...e.agents }, progress: e.progress };
}

/** quantas mensagens têm t <= alvo (busca binária; as mensagens vêm em ordem de t) */
export function indiceEm(mensagens: readonly MensagemDoDia[], alvo: number): number {
  let lo = 0;
  let hi = mensagens.length;
  while (lo < hi) {
    const meio = (lo + hi) >>> 1;
    if (mensagens[meio].t <= alvo) lo = meio + 1;
    else hi = meio;
  }
  return lo;
}

/**
 * Anda no dia: para frente só aplica o que falta; para trás (arrasto) volta à última chave guardada e aplica dali.
 * As chaves do servidor (a cada ~60 s) dizem onde guardar um retrato do estado, para o arrasto ficar barato.
 */
export class Reprodutor {
  private estado = estadoVazio();
  private cursor = 0;
  private retratos = new Map<number, EstadoReplay>();
  private readonly indicesChave: Set<number>;

  constructor(private readonly dia: Pick<DiaReplay, "mensagens" | "chaves">) {
    this.indicesChave = new Set(dia.chaves.map((c: ChaveReplay) => c.i));
  }

  /** índice da próxima mensagem a aplicar (quantas já valem) */
  get indice(): number {
    return this.cursor;
  }

  /** leva o estado até o instante `t` e devolve uma cópia dele */
  irPara(t: number): EstadoReplay {
    const alvo = indiceEm(this.dia.mensagens, t);
    if (alvo < this.cursor) this.voltarPara(alvo);
    this.andarAte(alvo);
    return copiar(this.estado);
  }

  private voltarPara(alvo: number) {
    let melhor = 0;
    for (const i of this.retratos.keys()) if (i <= alvo && i > melhor) melhor = i;
    const retrato = this.retratos.get(melhor);
    this.estado = retrato ? { agents: { ...retrato.agents }, progress: retrato.progress } : estadoVazio();
    this.cursor = retrato ? melhor : 0;
  }

  private andarAte(alvo: number) {
    const msgs = this.dia.mensagens;
    while (this.cursor < alvo) {
      if (this.indicesChave.has(this.cursor) && !this.retratos.has(this.cursor)) this.retratos.set(this.cursor, copiar(this.estado));
      aplicar(this.estado, msgs[this.cursor].msg);
      this.cursor++;
    }
  }
}

/** avança o relógio do replay: `dt` ms reais viram `dt * velocidade` ms do dia; para no fim */
export function avancar(t: number, dtMs: number, velocidade: number, fim: number): { t: number; terminou: boolean } {
  const dt = Math.min(Math.max(dtMs, 0), DT_MAXIMO_MS);
  const novo = Math.min(fim, t + dt * velocidade);
  return { t: novo, terminou: novo >= fim };
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** "14:05" (hora local) */
export function rotuloHora(ms: number): string {
  const d = new Date(ms);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** "14:05:30" (hora local) */
export function rotuloHoraSegundos(ms: number): string {
  const d = new Date(ms);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** "05/10/2026" para a lista de dias (a data é AAAA-MM-DD) */
export function rotuloData(data: string): string {
  const [a, m, d] = data.split("-");
  return a && m && d ? `${d}/${m}/${a}` : data;
}

/** a resposta de /api/replay/dia tem a forma que o painel espera? */
export function ehDiaReplay(v: unknown): v is DiaReplay {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.ok === true && typeof o.inicio === "number" && typeof o.fim === "number" && Array.isArray(o.mensagens) && Array.isArray(o.chaves);
}

export function ehListaDias(v: unknown): v is { ok: true; dias: { data: string; eventos: number }[] } {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.ok === true && Array.isArray(o.dias) && o.dias.every((d) => typeof d === "object" && d !== null && typeof (d as { data?: unknown }).data === "string");
}

/** fim <= inicio (dia com um instante só) ainda precisa de uma faixa mínima no slider */
export function duracaoMs(dia: Pick<DiaReplay, "inicio" | "fim">): number {
  return Math.max(0, dia.fim - dia.inicio);
}
