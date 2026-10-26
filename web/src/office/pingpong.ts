// Bolinha do ping-pong: onde ela está em cada momento da partida (RallyFrame, do agendador)
// e como desenhar com a sombra no tampo ou no chão.

import { ardosiaAlpha, palette } from "../theme";
import type { RallyFrame } from "./activities";
import { fill } from "./decor";
import { PINGPONG, PINGPONG_SPOTS, TILE, type Point } from "./map";
import { isReducedMotion } from "./motion";

/** pico do arco da bolinha acima da linha reta entre as raquetes (px) */
const BALL_PEAK = 6.5;
/** o tampo fica 8 px acima do chão (pernas da mesa) */
const TABLE_LIFT = 8;
/** x das raquetes: os dois seguram com a mão da direita da tela (centro da mesa + 6) */
const RACKET_X = PINGPONG.x + (PINGPONG.w >> 1) + 6;
/** altura da raquete erguida de cada lado (px base): de frente (cima) e de costas (baixo) */
const RACKET_Y: readonly [number, number] = [Math.round(PINGPONG_SPOTS[0].y * TILE) - 19, Math.round(PINGPONG_SPOTS[1].y * TILE) - 19];
/** onde a sombra começa/termina no tampo, perto de cada borda */
const BALL_GROUND: readonly [number, number] = [PINGPONG.y + 2, PINGPONG.y + PINGPONG.h - 3];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** onde a bolinha cai quando erra: no chão, pra fora da mesa, do lado de quem ia receber */
function missSpot(to: 0 | 1, dx: number): Point {
  const x = dx >= 0 ? PINGPONG.x + PINGPONG.w + 7 : PINGPONG.x - 8;
  return { x, y: to === 1 ? PINGPONG.y + PINGPONG.h + TABLE_LIFT + 4 : PINGPONG.y - 4 };
}

function onTable(x: number, y: number): boolean {
  return x >= PINGPONG.x && x < PINGPONG.x + PINGPONG.w && y >= PINGPONG.y && y < PINGPONG.y + PINGPONG.h;
}

/**
 * Bolinha da partida: arco de ~6–7 px entre as raquetes com sombra de 2x1 no tampo (ou no chão,
 * fora da mesa). Errou: cai fora, quica no chão e o saque recomeça. Reduced-motion: parada no meio.
 */
export function drawBall(ctx: CanvasRenderingContext2D, f: RallyFrame) {
  // 2x2 branca com contorno escuro em cruz (não some na camisa branca nem no piso claro)
  const ball = (x: number, y: number) => {
    const bx = Math.round(x) - 1;
    const by = Math.round(y) - 1;
    fill(ctx, bx - 1, by, 4, 2, palette.noite);
    fill(ctx, bx, by - 1, 2, 4, palette.noite);
    fill(ctx, bx, by, 2, 2, palette.white);
  };
  const shadow = (x: number, y: number, floor: boolean) =>
    fill(ctx, Math.round(x) - 1, Math.round(y), 2, 1, ardosiaAlpha(floor ? 0.22 : 0.5));
  if (isReducedMotion()) {
    const cx = PINGPONG.x + (PINGPONG.w >> 1) + 4;
    const cy = PINGPONG.y + (PINGPONG.h >> 1);
    shadow(cx, cy + 3, false);
    ball(cx, cy - 2);
    return;
  }
  const from = f.from;
  const to: 0 | 1 = from === 0 ? 1 : 0;
  if (f.state === "saque") {
    // na mão de quem saca, quicando de leve antes do golpe
    const toss = Math.round(Math.sin(Math.min(1, f.p) * Math.PI) * 4);
    shadow(RACKET_X, BALL_GROUND[from], false);
    ball(RACKET_X, RACKET_Y[from] + 2 - toss);
    return;
  }
  if (f.state === "fora") {
    const m = missSpot(to, f.dx);
    const hop = f.since < 450 ? Math.round(Math.sin((f.since / 450) * Math.PI) * 3) : 0;
    shadow(m.x, m.y + 1, true);
    ball(m.x, m.y - hop);
    return;
  }
  const p = f.p;
  const arc = 4 * BALL_PEAK * p * (1 - p);
  const x0 = RACKET_X + f.dx0;
  if (!f.miss) {
    const x = lerp(x0, RACKET_X + f.dx, p);
    shadow(x, lerp(BALL_GROUND[from], BALL_GROUND[to], p), false);
    ball(x, lerp(RACKET_Y[from], RACKET_Y[to], p) - arc);
    return;
  }
  // errou: a sombra anda no plano do tampo até o ponto fora da mesa e desce pro chão
  const m = missSpot(to, f.dx);
  const gx = lerp(x0, m.x, p);
  const gy = lerp(BALL_GROUND[from], m.y - TABLE_LIFT, p);
  if (onTable(gx, gy)) shadow(gx, gy, false);
  else shadow(gx, gy + TABLE_LIFT, true);
  ball(gx, lerp(RACKET_Y[from], m.y, p) - arc);
}
