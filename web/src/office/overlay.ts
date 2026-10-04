// Desenho da camada de cima do escritório: balões (trabalho, chat e descanso), etiquetas de
// nome, o selo "!" de quem espera e os pontinhos de quem pensa. O lugar de cada um vem do
// layout (bubbles.ts); aqui só se desenha, em coordenadas base inteiras.

import { inkAlpha, palette } from "../theme";
import type { Placement } from "./bubbles";
import { fill, type Rect } from "./decor";
import type { Point } from "./map";

export type BubbleStyle = "trabalho" | "chat" | "descanso";

/**
 * A VT323 tem ligadura "fi" (no canvas "Sofia" saía "Soña"): um ZWNJ (U+200C, invisível e sem
 * largura) depois de cada "f" minúsculo seguido de letra sem acento impede a junção ("café" fica
 * igual: com \p{L} o "fé" também ganharia o ZWNJ). Só no texto desenhado no canvas (nomes e
 * balões), antes de medir e quebrar linha.
 */
export const noLigatures = (s: string) => s.replace(/f(?=[A-Za-z])/g, "f‌");

export const WORK_FONT = "8px VT323, monospace";
export const WORK_MAX_W = 120;
/** balão de descanso: letra menor, uma linha, no máximo ~80 px */
export const REST_FONT = "7px VT323, monospace";
export const REST_MAX_W = 80;
export const REST_H = 10;
export const NAME_FONT = "7px VT323, monospace";
export const NAME_SHIFTS = [0, -8, 8] as const;

const BUBBLE_STYLE: Record<BubbleStyle, { bg: string; border: string; ink: string }> = {
  trabalho: { bg: palette.white, border: palette.navy950, ink: palette.navy900 },
  chat: { bg: palette.navy100, border: palette.navy950, ink: palette.navy900 },
  // discreto: cinza claro, borda cinza e texto cinza (os de trabalho continuam mandando)
  descanso: { bg: palette.gray100, border: palette.gray300, ink: palette.gray600 },
};

/**
 * Balão no lugar que o layout escolheu: acima (rabinho embaixo, apontando pra cabeça) ou ao lado
 * (rabinho virado pra cabeça). O de descanso tem rabinho curto (2 px) e letra de 7 px.
 */
export function drawBubbleAt(ctx: CanvasRenderingContext2D, p: Placement, lines: string[], style: BubbleStyle, cx: number, headY: number) {
  const { bg, border, ink } = BUBBLE_STYLE[style];
  const { x, y, w, h } = p.box;
  const small = style === "descanso";
  roundBox(ctx, x, y, w, h, bg, border);
  if (p.side === "above") {
    if (small) {
      const tx = Math.round(Math.max(x + 2, Math.min(x + w - 5, cx - 1)));
      ctx.fillStyle = border;
      ctx.fillRect(tx, y + h - 1, 3, 2);
      ctx.fillRect(tx + 1, y + h + 1, 1, 1);
      ctx.fillStyle = bg;
      ctx.fillRect(tx + 1, y + h - 1, 1, 1);
    } else {
      const tx = Math.round(Math.max(x + 3, Math.min(x + w - 6, cx - 2)));
      ctx.fillStyle = border;
      ctx.fillRect(tx, y + h - 1, 5, 2);
      ctx.fillRect(tx + 1, y + h + 1, 3, 1);
      ctx.fillRect(tx + 2, y + h + 2, 1, 1);
      ctx.fillStyle = bg;
      ctx.fillRect(tx + 1, y + h - 1, 3, 1);
      ctx.fillRect(tx + 2, y + h, 1, 1);
    }
  } else {
    // rabinho lateral apontando pra cabeça
    const left = p.side === "left";
    const ex = left ? x + w - 1 : x;
    const s = left ? 1 : -1;
    if (small) {
      const ty = Math.round(Math.max(y + 2, Math.min(y + h - 5, headY)));
      ctx.fillStyle = border;
      ctx.fillRect(left ? ex : ex - 1, ty, 2, 3);
      ctx.fillRect(ex + 2 * s, ty + 1, 1, 1);
      ctx.fillStyle = bg;
      ctx.fillRect(ex, ty + 1, 1, 1);
    } else {
      const ty = Math.round(Math.max(y + 2, Math.min(y + h - 7, headY)));
      ctx.fillStyle = border;
      ctx.fillRect(left ? ex : ex - 1, ty, 2, 5);
      ctx.fillRect(ex + 2 * s, ty + 1, 1, 3);
      ctx.fillRect(ex + 3 * s, ty + 2, 1, 1);
      ctx.fillStyle = bg;
      ctx.fillRect(ex, ty + 1, 1, 3);
      ctx.fillRect(ex + s, ty + 2, 1, 1);
    }
  }
  ctx.font = small ? REST_FONT : WORK_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = ink;
  if (small) ctx.fillText(lines[0], x + 3, y + 5);
  else lines.forEach((l, i) => ctx.fillText(l, x + 4, y + 6 + i * 8));
}

/** etiqueta de nome: fundo escuro translúcido, quadradinho 2x2 na cor do papel e o nome */
export function drawNameTag(ctx: CanvasRenderingContext2D, box: Rect, text: string, color: string) {
  ctx.fillStyle = inkAlpha(0.7);
  ctx.fillRect(box.x, box.y, box.w, box.h);
  fill(ctx, box.x + 2, box.y + 3, 2, 2, color);
  ctx.font = NAME_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = palette.white;
  ctx.fillText(text, box.x + 5, box.y + box.h);
}

/**
 * Selo marinho com borda e "!" laranja acima da cabeça de quem espera; a borda pisca entre
 * laranja e branco (com reduced-motion: parado e com a borda laranja fixa). Sempre visível.
 */
export function drawWaitBadge(ctx: CanvasRenderingContext2D, head: Point, now: number, reduced: boolean) {
  const b = reduced ? 0 : Math.round(Math.sin(now / 150) * 1.5);
  const sx = Math.round(head.x - 5);
  const sy = Math.round(head.y - 2 - 13 + b);
  const ring = !reduced && Math.floor(now / 400) % 2 ? palette.white : palette.signal.waiting;
  roundBox(ctx, sx, sy, 10, 12, ring, palette.navy950);
  ctx.fillStyle = palette.navy900;
  ctx.fillRect(sx + 2, sy + 2, 6, 8);
  ctx.fillStyle = palette.signal.waiting;
  ctx.fillRect(sx + 4, sy + 3, 2, 4);
  ctx.fillRect(sx + 4, sy + 8, 2, 1);
}

/** três pontinhos acendendo em sequência acima de quem está pensando */
export function drawThinkDots(ctx: CanvasRenderingContext2D, head: Point, now: number) {
  const k = Math.floor(now / 300) % 4;
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < k ? palette.white : "rgba(255,255,255,0.35)";
    ctx.fillRect(Math.round(head.x - 5 + i * 4), Math.round(head.y - 6), 2, 2);
  }
}

function roundBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, stroke: string) {
  x = Math.round(x);
  y = Math.round(y);
  ctx.fillStyle = stroke;
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
}

/** quebra em até 2 linhas que caibam em maxW (a 2ª ganha reticências se sobrar texto) */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > 2) lines[1] = lines[1].replace(/.{0,2}$/, "…");
  return lines;
}
