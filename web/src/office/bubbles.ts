// Layout dos balões e etiquetas de nome, refeito a cada quadro: cada pedido tenta algumas
// posições (acima, acima deslocado, à esquerda e à direita da cabeça) e fica na primeira que não
// encosta nos já colocados nem nas zonas proibidas (placa, quadro, plaquinhas das mesas).
// Lógica pura (sem canvas): o motor mede os textos e desenha. Testes em bubbles.test.ts.

import type { Rect } from "./decor";

export type BubbleSide = "above" | "left" | "right";

export interface BubbleSize {
  w: number;
  h: number;
}

/** Algo que já tem lugar certo (o "!" de quem espera, os pontinhos do pensando): só ocupa. */
export interface FixedReq {
  id: string;
  priority: number;
  fixed: Rect;
}

/** Balão ou etiqueta que procura lugar em volta da cabeça. */
export interface FloatReq {
  id: string;
  /** menor = mais importante (é colocado antes) */
  priority: number;
  /** tamanhos tentados em ordem (ex.: nome inteiro, depois só o apelido) */
  sizes: readonly BubbleSize[];
  /** centro da cabeça (x) e onde o balão de cima termina (y, já acima do "!" se houver) */
  ax: number;
  ay: number;
  /** linha da cabeça, pros balões ao lado */
  headY: number;
  /** rabinho fora da caixa (px): entra no retângulo ocupado */
  tail: number;
  /** espaço entre o retângulo ocupado (com rabinho) e `ay` */
  gap: number;
  /** deslocamentos acima da cabeça (padrão: ABOVE_SHIFTS) */
  shifts?: readonly number[];
  /**
   * Ordem da busca: por padrão, todas as posições do 1º tamanho e depois as do 2º. Com
   * `positionFirst`, cada posição tenta todos os tamanhos antes da próxima (ex.: nome: apelido
   * bem em cima da cabeça é melhor que o nome inteiro em cima da cabeça do vizinho).
   */
  positionFirst?: boolean;
  /** sempre aparece: sem lugar livre, fica na primeira posição mesmo encostando */
  always?: boolean;
  /** índice do candidato usado no quadro anterior (tenta primeiro, pra não ficar pulando) */
  prefer?: number;
}

export type BubbleReq = FixedReq | FloatReq;

export interface Placement {
  id: string;
  side: BubbleSide;
  /** caixa do balão, sem o rabinho */
  box: Rect;
  /** retângulo ocupado (caixa + rabinho) */
  rect: Rect;
  /** índice em `sizes` */
  size: number;
  /** índice do candidato (vai no `prefer` do próximo quadro) */
  cand: number;
  /** entrou por `always` sem lugar livre */
  forced: boolean;
}

/** deslocamentos tentados acima da cabeça, em ordem */
export const ABOVE_SHIFTS = [0, -8, 8, -16, 16] as const;
/** distância do centro da cabeça até a caixa dos balões ao lado */
export const SIDE_GAP = 10;

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function inside(r: Rect, bounds: Rect): boolean {
  return r.x >= bounds.x && r.y >= bounds.y && r.x + r.w <= bounds.x + bounds.w && r.y + r.h <= bounds.y + bounds.h;
}

interface Candidate {
  side: BubbleSide;
  box: Rect;
  rect: Rect;
}

/** Posições de um tamanho: acima (0, -8, +8, -16, +16; x preso no canvas), à esquerda e à direita. */
export function candidates(req: FloatReq, size: BubbleSize, bounds: Rect): Candidate[] {
  const shifts = req.shifts ?? ABOVE_SHIFTS;
  const out: Candidate[] = [];
  for (let pos = 0; pos < shifts.length + 2; pos++) {
    const c: Candidate = { side: "above", box: { x: 0, y: 0, w: 0, h: 0 }, rect: { x: 0, y: 0, w: 0, h: 0 } };
    candidateAt(req, size, pos, shifts, bounds, c);
    out.push(c);
  }
  return out;
}

/** candidato `pos` (0..shifts-1 acima, depois esquerda e direita) de um tamanho, escrito em `out` */
function candidateAt(req: FloatReq, size: BubbleSize, pos: number, shifts: readonly number[], bounds: Rect, out: Candidate) {
  const { w, h } = size;
  const box = out.box;
  const rect = out.rect;
  box.w = w;
  box.h = h;
  if (pos < shifts.length) {
    const x = Math.max(bounds.x, Math.min(bounds.x + bounds.w - w, Math.round(req.ax - w / 2 + shifts[pos])));
    const y = Math.round(req.ay - req.gap - req.tail - h);
    out.side = "above";
    box.x = rect.x = x;
    box.y = rect.y = y;
    rect.w = w;
    rect.h = h + req.tail;
    return;
  }
  const sy = Math.round(req.headY + 2 - h / 2);
  box.y = rect.y = sy;
  rect.w = w + req.tail;
  rect.h = h;
  if (pos === shifts.length) {
    out.side = "left";
    box.x = rect.x = Math.round(req.ax - SIDE_GAP - w);
  } else {
    out.side = "right";
    box.x = Math.round(req.ax + SIDE_GAP);
    rect.x = box.x - req.tail;
  }
}

function hitsAny(r: Rect, list: readonly Rect[]): boolean {
  for (let i = 0; i < list.length; i++) if (overlaps(r, list[i])) return true;
  return false;
}

/**
 * Coloca os pedidos por prioridade (empate: na ordem recebida). `occupied` são retângulos que já
 * estão na tela e ninguém pode cobrir (ex.: balões colocados num passe anterior). Devolve o lugar
 * de cada um (quem não coube fica de fora do mapa) e todos os retângulos ocupados.
 * `avoid` (ex.: cabeças de quem está sentado) é evitado se der; sem outro lugar, pode cobrir.
 * Custo: O(n² · candidatos), testando cada candidato na hora (sem montar listas): com n ≤ ~30, nada.
 */
export function placeBubbles(
  reqs: readonly BubbleReq[],
  forbidden: readonly Rect[],
  bounds: Rect,
  occupied: readonly Rect[] = [],
  avoid: readonly Rect[] = [],
): { placed: Map<string, Placement>; rects: Rect[] } {
  const order = reqs.map((r, i) => ({ r, i })).sort((a, b) => a.r.priority - b.r.priority || a.i - b.i);
  const placed = new Map<string, Placement>();
  const rects: Rect[] = [];
  const c: Candidate = { side: "above", box: { x: 0, y: 0, w: 0, h: 0 }, rect: { x: 0, y: 0, w: 0, h: 0 } };
  const blocked = (rect: Rect) => !inside(rect, bounds) || hitsAny(rect, forbidden) || hitsAny(rect, occupied) || hitsAny(rect, rects);

  for (const { r } of order) {
    if ("fixed" in r) {
      rects.push(r.fixed);
      placed.set(r.id, { id: r.id, side: "above", box: r.fixed, rect: r.fixed, size: 0, cand: 0, forced: false });
      continue;
    }
    const shifts = r.shifts ?? ABOVE_SHIFTS;
    const nPos = shifts.length + 2;
    const nSizes = r.sizes.length;
    const total = nPos * nSizes;
    if (!total) continue;
    // índice único `cand`: por tamanho (padrão) ou por posição (positionFirst)
    const sizeOf = (i: number) => (r.positionFirst ? i % nSizes : Math.floor(i / nPos));
    const posOf = (i: number) => (r.positionFirst ? Math.floor(i / nSizes) : i % nPos);
    // `avoid` é um custo, não uma proibição: 1ª rodada evitando, 2ª sem evitar
    let soft = avoid.length > 0;
    const fits = (i: number) => {
      candidateAt(r, r.sizes[sizeOf(i)], posOf(i), shifts, bounds, c);
      return !blocked(c.rect) && !(soft && hitsAny(c.rect, avoid));
    };
    const prefer = r.prefer !== undefined && r.prefer >= 0 && r.prefer < total ? r.prefer : -1;
    let hit = -1;
    for (let round = 0; hit < 0 && round < (soft ? 2 : 1); round++) {
      if (round === 1) soft = false;
      if (prefer >= 0 && fits(prefer)) hit = prefer;
      for (let i = 0; hit < 0 && i < total; i++) if (i !== prefer && fits(i)) hit = i;
    }
    let forced = false;
    if (hit < 0) {
      if (!r.always) continue;
      hit = 0;
      forced = true;
    }
    candidateAt(r, r.sizes[sizeOf(hit)], posOf(hit), shifts, bounds, c);
    const box = { ...c.box };
    const rect = { ...c.rect };
    rects.push(rect);
    placed.set(r.id, { id: r.id, side: c.side, box, rect, size: sizeOf(hit), cand: hit, forced });
  }
  return { placed, rects };
}
