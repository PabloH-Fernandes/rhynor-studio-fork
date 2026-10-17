// Primitivas de desenho em pixel compartilhadas por decor*.ts (janela e mobília).
// Tudo em coordenadas inteiras da resolução base, sem arc/ellipse/gradiente.

export type Ctx = CanvasRenderingContext2D;

// ===================================================================== primitivas em pixel

/** retângulo em coordenadas inteiras (ignora tamanho <= 0) */
export function fill(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  const rw = Math.round(w);
  const rh = Math.round(h);
  if (rw <= 0 || rh <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), rw, rh);
}

/** linha de 1px (Bresenham) entre dois pontos inteiros */
export function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  ctx.fillStyle = color;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** disco em pixel centrado no pixel (cx, cy), diâmetro 2r+1, linha a linha */
export function disc(ctx: Ctx, cx: number, cy: number, r: number, color: string) {
  cx = Math.round(cx);
  cy = Math.round(cy);
  ctx.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const hw = Math.floor(Math.sqrt((r + 0.5) * (r + 0.5) - dy * dy));
    ctx.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
  }
}

/** oval em pixel (linha a linha), centrado em (cx, cy), raios rx e ry */
export function oval(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string) {
  cx = Math.round(cx);
  cy = Math.round(cy);
  ctx.fillStyle = color;
  for (let dy = -ry; dy <= ry; dy++) {
    const u = dy / (ry + 0.5);
    const hw = Math.floor((rx + 0.5) * Math.sqrt(1 - u * u));
    ctx.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** mistura duas cores "#RRGGBB" (t = 0 → a, t = 1 → b) */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
