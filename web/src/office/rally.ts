// Partida de ping-pong: calcula, de forma determinística pelo PRNG do grupo, onde a bolinha
// está em cada instante. Lógica pura, usada pelo RestScheduler (activities.ts, que reexporta tudo daqui).

/** ping-pong: um golpe (ida ou volta) leva de 500 a 800 ms */
export const STROKE_MIN_MS = 500;
export const STROKE_MAX_MS = 800;
/** ~1 em 12 golpes a bolinha erra a mesa */
export const MISS_CHANCE = 1 / 12;
/** pausa antes do saque (início da partida e depois de um erro) */
export const SERVE_MS = 700;
/** depois do erro: a bolinha quica no chão, alguém pega e saca de novo */
export const MISS_PAUSE_MS = 1200;
/** parte da pausa do erro em que a bolinha ainda está no chão (o resto é o saque) */
const MISS_FLOOR_SHARE = 0.55;

/** Um golpe do ping-pong: sai do lado `from` (0 = de cima, 1 = de baixo) e chega no outro (ou erra). */
export interface Stroke {
  start: number;
  /** começo do saque (a bolinha parada na mão de quem saca); = start no meio da troca de bolas */
  serveAt: number;
  dur: number;
  from: 0 | 1;
  miss: boolean;
  /** desvio lateral (px) de onde a bolinha chega; o golpe seguinte sai daí */
  dx: number;
  /** desvio de onde saiu (o dx do golpe anterior; 0 no saque) */
  dx0: number;
}

/**
 * Momento da partida, pro motor desenhar a bolinha:
 * - "saque": parada na mão de quem vai sacar (`from`), `p` = progresso da pausa;
 * - "voo": no ar, de `from` pro outro lado, `p` = 0..1;
 * - "fora": errou e está no chão (`since` = ms desde que caiu).
 */
export interface RallyFrame {
  state: "saque" | "voo" | "fora";
  from: 0 | 1;
  p: number;
  miss: boolean;
  dx0: number;
  dx: number;
  since: number;
}

/** O que a partida precisa guardar do grupo (o Group do agendador estende isto). */
export interface RallyState {
  rnd: () => number;
  /** último rallyOf (a pose dos 2 jogadores e a bolinha pedem o mesmo instante) */
  rallyMemo?: { at: number; frame: RallyFrame };
  /** ping-pong: golpe atual (gerado conforme o tempo passa) e o anterior */
  stroke?: Stroke;
  prevStroke?: Stroke;
}

/** Avança os golpes até `now` (determinístico pelo PRNG do grupo) e diz onde a partida está. */
export function rallyOf(g: RallyState & { readyAt?: number }, now: number): RallyFrame | null {
  if (g.readyAt === undefined) return null;
  if (g.rallyMemo?.at === now) return g.rallyMemo.frame;
  const frame = computeRally(g, g.readyAt, now);
  g.rallyMemo = { at: now, frame };
  return frame;
}

function computeRally(g: RallyState, readyAt: number, now: number): RallyFrame {
  const next = (prev: Stroke | undefined): Stroke => {
    const dur = Math.round(STROKE_MIN_MS + g.rnd() * (STROKE_MAX_MS - STROKE_MIN_MS));
    const dx = Math.round(g.rnd() * 6) - 3;
    if (!prev) {
      const start = readyAt + SERVE_MS;
      return { start, serveAt: readyAt, dur, from: g.rnd() < 0.5 ? 0 : 1, miss: false, dx, dx0: 0 };
    }
    const end = prev.start + prev.dur;
    if (prev.miss) {
      // quem errou busca a bolinha e saca
      const start = end + MISS_PAUSE_MS;
      return { start, serveAt: end + MISS_PAUSE_MS * MISS_FLOOR_SHARE, dur, from: prev.from === 0 ? 1 : 0, miss: false, dx, dx0: 0 };
    }
    return { start: end, serveAt: end, dur, from: prev.from === 0 ? 1 : 0, miss: g.rnd() < MISS_CHANCE, dx, dx0: prev.dx };
  };
  g.stroke ??= next(undefined);
  let s = g.stroke;
  // o golpe dura até a bolinha chegar; o que errou dura até a parte "no chão" da pausa acabar
  while (now >= s.start + s.dur + (s.miss ? MISS_PAUSE_MS * MISS_FLOOR_SHARE : 0)) {
    g.prevStroke = s;
    s = g.stroke = next(s);
  }
  // relógio um pouco atrás de quem já avançou (ex.: debug com performance.now e quadro com o
  // tempo do rAF): usa o golpe anterior em vez de mostrar um saque falso
  const prev = g.prevStroke;
  if (now < s.start && s.serveAt === s.start && prev && now >= prev.start) s = prev;
  const base = { miss: s.miss, dx0: s.dx0, dx: s.dx, since: 0 };
  if (now < s.start) {
    const p = (now - s.serveAt) / Math.max(1, s.start - s.serveAt);
    return { ...base, state: "saque", from: s.from, p: Math.max(0, p) };
  }
  const end = s.start + s.dur;
  if (now < end) return { ...base, state: "voo", from: s.from, p: (now - s.start) / s.dur };
  return { ...base, state: "fora", from: s.from, p: 1, since: now - end };
}
