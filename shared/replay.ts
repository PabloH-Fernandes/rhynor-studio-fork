// Replay do dia: tipos compartilhados entre o servidor (GET /api/replay/*) e o painel. Só estrutura e rótulos
// genéricos: o resumo do dia (server/resumoDia.ts) não guarda prompt, comando nem texto livre.

import type { Agent, Progress } from "./types.ts";

/** o que o replay manda ao painel a cada mudança (subconjunto do ServerMessage + "limpar") */
export type MensagemReplay =
  | { type: "agent"; agent: Agent }
  | { type: "remove"; id: string }
  | { type: "progress"; progress: Progress }
  /** o servidor reiniciou nesse instante: o escritório recomeça (como no estado novo do servidor) */
  | { type: "limpar" };

export interface MensagemDoDia {
  /** instante (ms desde 1970) no relógio virtual do replay */
  t: number;
  msg: MensagemReplay;
}

/** ponto de partida para o arrasto: a partir da mensagem `i`, tudo é de `t` em diante */
export interface ChaveReplay {
  t: number;
  i: number;
}

export interface DiaReplay {
  ok: true;
  data: string;
  inicio: number;
  fim: number;
  mensagens: MensagemDoDia[];
  chaves: ChaveReplay[];
  /** havia mensagens demais: ficaram só as mudanças de status (e/ou as primeiras) */
  reduzido?: boolean;
  /** linhas do arquivo que não deu para ler (ignoradas) */
  linhasIgnoradas?: number;
}

export interface DiaDisponivel {
  data: string;
  /** linhas do resumo (eventos + reinícios do servidor) */
  eventos: number;
}

export interface DiasReplay {
  ok: true;
  dias: DiaDisponivel[];
}

export const MAX_MENSAGENS_REPLAY = 20_000;
export const INTERVALO_CHAVE_MS = 60_000;
