// Planta do escritório: tamanho, mesas, caminhos e desenho do cenário.
// Tudo em "tiles" (1 tile = 16 px na resolução base). Pra mudar o layout,
// mexa em DESKS, OVERFLOW_SPOTS e COFFEE_SPOTS.

import { theme, roleColor } from "../theme";

export const TILE = 16;
export const COLS = 32;
export const ROWS = 18;
export const W = COLS * TILE;
export const H = ROWS * TILE;
export const WALL_ROWS = 3;
export const AISLE_Y = 15.5; // corredor principal (embaixo)
export const DOOR: Point = { x: -0.8, y: AISLE_Y };

export interface Point {
  x: number;
  y: number;
}

/** Um lugar onde o agente fica: ponto final + caminho do corredor até lá. */
export interface Spot extends Point {
  id: string;
  /** coluna usada pra subir/descer do corredor */
  laneX: number;
  /** pontos entre o corredor e o lugar (sem incluir o corredor nem o lugar) */
  via: Point[];
  sitting: boolean;
}

export interface Desk {
  id: string;
  /** papel dono da mesa; "convidado" = qualquer um */
  role: string;
  /** centro da cadeira (x) e linha da cadeira (y) */
  cx: number;
  cy: number;
  big?: boolean;
}

export const DESKS: Desk[] = [
  { id: "lider", role: "lider", cx: 16, cy: 4.2, big: true },
  { id: "planejador", role: "planejador", cx: 4.5, cy: 8 },
  { id: "pesquisador", role: "pesquisador", cx: 10.5, cy: 8 },
  { id: "revisor", role: "revisor", cx: 21.5, cy: 8 },
  { id: "documentador", role: "documentador", cx: 27.5, cy: 8 },
  { id: "dev", role: "dev", cx: 4.5, cy: 12 },
  { id: "testador", role: "testador", cx: 10.5, cy: 12 },
  { id: "convidado-1", role: "convidado", cx: 21.5, cy: 12 },
  { id: "convidado-2", role: "convidado", cx: 27.5, cy: 12 },
];

export function deskSpot(d: Desk): Spot {
  const laneX = d.cx - 2;
  return {
    id: `desk:${d.id}`,
    x: d.cx,
    y: d.cy + 0.85,
    laneX,
    via: [{ x: laneX, y: d.cy + 0.85 }],
    sitting: true,
  };
}

/** Lugares em pé em volta da mesa de reunião (quando as mesas lotam). */
export const OVERFLOW_SPOTS: Spot[] = [
  [14.4, 10.2],
  [17.6, 10.2],
  [14.4, 12.6],
  [17.6, 12.6],
  [16, 9.2],
  [16, 13.4],
].map(([x, y], i) => ({ id: `reuniao:${i}`, x, y, laneX: x, via: [], sitting: false }));

export const COFFEE_SPOTS: Spot[] = [
  [27.6, 15],
  [29.2, 15.1],
  [30.7, 15],
].map(([x, y], i) => ({ id: `cafe:${i}`, x, y, laneX: x, via: [], sitting: false }));

export const DOOR_SPOT: Spot = { id: "porta", x: DOOR.x, y: DOOR.y, laneX: DOOR.x, via: [], sitting: false };

/** Caminho entre dois lugares, sempre passando pelo corredor de baixo. */
export function route(from: Spot, to: Spot): Point[] {
  const pts: Point[] = [];
  for (let i = from.via.length - 1; i >= 0; i--) pts.push(from.via[i]);
  pts.push({ x: from.laneX, y: AISLE_Y });
  pts.push({ x: to.laneX, y: AISLE_Y });
  pts.push(...to.via);
  pts.push({ x: to.x, y: to.y });
  // remove pontos repetidos
  return pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > 0.01 || Math.abs(p.y - pts[i - 1].y) > 0.01);
}

// ===================================================================== desenho

type Ctx = CanvasRenderingContext2D;
const px = (n: number) => Math.round(n * TILE);

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function drawFloor(ctx: Ctx, t: number) {
  const c = theme.colors;
  // piso de madeira em tábuas
  for (let row = WALL_ROWS; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      rect(ctx, col * TILE, row * TILE, TILE, TILE, (row + col) % 2 === 0 ? c.floorA : c.floorB);
    }
    rect(ctx, 0, row * TILE + 15, W, 1, c.floorLine);
    const off = row % 2 === 0 ? 0 : 8;
    for (let col = 0; col < COLS; col += 2) rect(ctx, col * TILE + off, row * TILE, 1, 15, c.floorLine);
  }

  // tapete da área de reunião
  rect(ctx, px(12.6), px(8.6), px(6.8), px(5.6), c.rugBorder);
  rect(ctx, px(12.6) + 3, px(8.6) + 3, px(6.8) - 6, px(5.6) - 6, c.rug);
  for (let i = 0; i < 6; i++) rect(ctx, px(12.6) + 6, px(8.9) + i * 14 + 6, px(6.8) - 12, 1, c.rugBorder);

  // corredor (passadeira) por onde todo mundo anda
  rect(ctx, 0, px(AISLE_Y) - 6, px(26.4), 12, "#6d5a49");
  rect(ctx, 0, px(AISLE_Y) - 5, px(26.4), 10, "#7d6855");

  // parede de cima
  rect(ctx, 0, 0, W, WALL_ROWS * TILE, c.wall);
  rect(ctx, 0, WALL_ROWS * TILE - 10, W, 6, c.wallShade);
  rect(ctx, 0, WALL_ROWS * TILE - 4, W, 4, c.baseboard);

  // janelas com céu e nuvens andando
  for (const wx of [1, 5, 24.5, 28.5]) drawWindow(ctx, px(wx), 7, t);

  // porta (entrada à esquerda)
  rect(ctx, 0, px(AISLE_Y) - 20, 5, 40, c.woodShade);
  rect(ctx, 0, px(AISLE_Y) - 18, 3, 36, "#3a2a1e");
  rect(ctx, 5, px(AISLE_Y) - 14, 10, 28, "#5b4a3c"); // capacho
  rect(ctx, 6, px(AISLE_Y) - 13, 8, 26, "#6d5a49");
}

function drawWindow(ctx: Ctx, x: number, y: number, t: number) {
  const w = 52;
  const h = 26;
  rect(ctx, x - 2, y - 2, w + 4, h + 4, "#f7f3ea");
  const grd = ctx.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, "#7cc4f0");
  grd.addColorStop(1, "#c8e9fb");
  ctx.fillStyle = grd;
  ctx.fillRect(x, y, w, h);
  // nuvens
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const drift = ((t / 400 + x) % (w + 30)) - 20;
  rect(ctx, x + drift, y + 6, 14, 4, "#ffffff");
  rect(ctx, x + drift + 3, y + 4, 8, 2, "#ffffff");
  const drift2 = ((t / 650 + x * 3) % (w + 30)) - 20;
  rect(ctx, x + drift2, y + 15, 10, 3, "#f3fbff");
  // prédios ao fundo
  for (let i = 0; i < 5; i++) rect(ctx, x + i * 11, y + h - 6 - ((i * 7 + x) % 6), 9, 12, "#9fb7c8");
  ctx.restore();
  rect(ctx, x + w / 2 - 1, y, 2, h, "#f7f3ea");
  rect(ctx, x, y + h / 2 - 1, w, 2, "#f7f3ea");
}

/** Placa com a logo ou o nome do escritório, centralizada na parede. */
export function drawSign(ctx: Ctx, logo: HTMLImageElement | null) {
  const c = theme.colors;
  const w = 112;
  const h = 30;
  const x = W / 2 - w / 2;
  const y = 7;
  rect(ctx, x - 2, y - 2, w + 4, h + 4, c.outline);
  rect(ctx, x, y, w, h, c.sign);
  rect(ctx, x, y + h - 3, w, 3, roleColor("lider"));
  if (logo && logo.complete && logo.naturalWidth > 0) {
    const scale = Math.min((w - 10) / logo.naturalWidth, (h - 9) / logo.naturalHeight);
    const lw = logo.naturalWidth * scale;
    const lh = logo.naturalHeight * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(logo, x + (w - lw) / 2, y + (h - 3 - lh) / 2, lw, lh);
    ctx.imageSmoothingEnabled = false;
  } else {
    ctx.fillStyle = c.signText;
    ctx.font = `11px "Press Start 2P", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const name = theme.officeName.length > 22 ? theme.officeName.slice(0, 21) + "…" : theme.officeName;
    ctx.font = name.length > 14 ? `6px "Press Start 2P", monospace` : `8px "Press Start 2P", monospace`;
    ctx.fillText(name, W / 2, y + h / 2 - 1);
  }
}

/** Relógio de parede com a hora real. */
export function drawClock(ctx: Ctx, now: Date) {
  const cx = 187;
  const cy = 22;
  ctx.fillStyle = theme.colors.outline;
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fbf8f0";
  ctx.beginPath();
  ctx.arc(cx, cy, 8.5, 0, Math.PI * 2);
  ctx.fill();
  const hand = (angle: number, len: number, width: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(angle) * len, cy - Math.cos(angle) * len);
    ctx.stroke();
  };
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();
  hand(((h + m / 60) / 12) * Math.PI * 2, 4.5, 1.6, "#22283a");
  hand(((m + s / 60) / 60) * Math.PI * 2, 6.5, 1.1, "#22283a");
  hand((s / 60) * Math.PI * 2, 7, 0.5, "#d64561");
}

/** Quadro branco com contadores ao vivo. */
export function drawBoard(ctx: Ctx, counts: { working: number; waiting: number; total: number }) {
  const x = 321;
  const y = 8;
  rect(ctx, x - 2, y - 2, 60, 30, "#9aa0ab");
  rect(ctx, x, y, 56, 26, "#fbfbf8");
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `8px VT323, monospace`;
  ctx.fillStyle = "#2b70ab";
  ctx.fillText(`TIME: ${counts.total}`, x + 3, y + 2);
  ctx.fillStyle = "#237a54";
  ctx.fillText(`FAZENDO: ${counts.working}`, x + 3, y + 10);
  ctx.fillStyle = counts.waiting ? "#d64561" : "#8a8f9c";
  ctx.fillText(`ESPERA: ${counts.waiting}`, x + 3, y + 18);
}

export function drawDecor(ctx: Ctx) {
  // estante à esquerda da placa
  const bx = 147;
  rect(ctx, bx, 10, 28, 36, theme.colors.woodShade);
  rect(ctx, bx + 2, 12, 24, 32, "#5a3b24");
  const books = ["#d64561", "#3a8fd6", "#f2c14e", "#2f9e6d", "#7a5af5", "#e0703a"];
  for (let s = 0; s < 3; s++) {
    rect(ctx, bx + 2, 21 + s * 11, 24, 2, theme.colors.woodShade);
    for (let b = 0; b < 5; b++) rect(ctx, bx + 3 + b * 4.5, 13 + s * 11, 3, 8, books[(b + s * 2) % books.length]);
  }
}

/** Mesa de reunião redonda (objeto com profundidade: desenhado ordenado por y). */
export function drawMeetingTable(ctx: Ctx) {
  const cx = px(16);
  const cy = px(11.2);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + 9, 26, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = theme.colors.woodShade;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 3, 25, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = theme.colors.woodLight;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 25, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  rect(ctx, cx - 9, cy - 4, 7, 5, "#fbfbf8"); // papéis
  rect(ctx, cx + 3, cy - 2, 5, 4, "#f2c14e");
  rect(ctx, cx + 4, cy - 7, 3, 3, "#7d4a2a"); // caneca
}

export function drawPlant(ctx: Ctx, x: number, y: number, big = false) {
  const s = big ? 1.3 : 1;
  rect(ctx, x - 5 * s, y - 8 * s, 10 * s, 8 * s, "#b5643c");
  rect(ctx, x - 6 * s, y - 9 * s, 12 * s, 2 * s, "#9a4f2c");
  ctx.fillStyle = "#3f8a4c";
  for (const [dx, dy, r] of [
    [0, -16, 6],
    [-5, -13, 5],
    [5, -13, 5],
    [-3, -20, 4],
    [3, -21, 4],
  ]) {
    ctx.beginPath();
    ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#56a862";
  ctx.beginPath();
  ctx.arc(x - 2 * s, y - 18 * s, 2.5 * s, 0, Math.PI * 2);
  ctx.fill();
}

/** Cantinho do café (no canto de baixo à direita). */
export function drawCoffeeCorner(ctx: Ctx, t: number, busy: boolean) {
  const c = theme.colors;
  const x = px(26.6);
  const y = px(16.1);
  rect(ctx, x, y, px(5.4), 30, c.woodShade);
  rect(ctx, x, y, px(5.4), 6, c.woodLight);
  // cafeteira
  rect(ctx, x + 10, y - 16, 16, 18, "#2c2f38");
  rect(ctx, x + 12, y - 13, 12, 5, "#3c404c");
  rect(ctx, x + 16, y - 4, 4, 4, "#f4f1e8");
  rect(ctx, x + 21, y - 11, 2, 2, busy ? "#3fbf86" : "#d64561");
  // vapor
  if (busy) {
    const k = Math.floor(t / 250) % 3;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(x + 17, y - 22 - k * 2, 2, 3);
    ctx.fillRect(x + 15 + k, y - 27 - k, 2, 3);
  }
  // xícaras
  rect(ctx, x + 34, y - 3, 5, 4, "#f4f1e8");
  rect(ctx, x + 41, y - 3, 5, 4, "#d64561");
  // bebedouro
  rect(ctx, x + 64, y - 20, 12, 22, "#dfe6ee");
  rect(ctx, x + 65, y - 30, 10, 11, "#8fd0f5");
  rect(ctx, x + 66, y - 28, 3, 7, "#c4e8fb");
}

/** Mesa de trabalho com computador e plaquinha. `occupantName` vai na plaquinha das mesas de convidado. */
export function drawDesk(ctx: Ctx, d: Desk, opts: { active: boolean; waiting: boolean; occupantName?: string; t: number }) {
  const c = theme.colors;
  const wTiles = d.big ? 3.6 : 2.75;
  const w = px(wTiles);
  const x = px(d.cx) - w / 2;
  const top = px(d.cy + 0.55);
  const depth = d.big ? 13 : 11;
  const front = 9;

  // sombra
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.fillRect(x + 2, top + depth + front - 1, w, 4);
  // tampo + frente
  rect(ctx, x - 1, top - 1, w + 2, depth + front + 2, c.outline);
  rect(ctx, x, top, w, depth, c.woodLight);
  rect(ctx, x, top, w, 2, "#c08c5f");
  rect(ctx, x, top + depth, w, front, c.wood);
  rect(ctx, x, top + depth + front - 2, w, 2, c.woodShade);

  // teclado
  rect(ctx, px(d.cx) - 7, top + depth - 6, 14, 4, "#3a3f4d");
  rect(ctx, px(d.cx) - 6, top + depth - 5, 12, 2, "#5a6070");

  // monitor (à direita, virado "pra câmera" — licença poética de escritório pixel)
  const mx = px(d.cx) + 8;
  const my = top - 12;
  rect(ctx, mx - 1, my - 1, 15, 13, c.outline);
  rect(ctx, mx, my, 13, 11, opts.active ? "#0f2a22" : opts.waiting ? "#3a2a10" : "#1c2230");
  if (opts.active) {
    // linhas de código "rolando"
    const scroll = Math.floor(opts.t / 180);
    const colors = ["#3fbf86", "#5aaef0", "#f2c14e", "#ef5f7b", "#c8d0dc"];
    for (let i = 0; i < 4; i++) {
      const len = 3 + ((i * 5 + scroll * 3) % 7);
      rect(ctx, mx + 2 + ((i + scroll) % 2) * 2, my + 2 + i * 2.2, len, 1.4, colors[(i + scroll) % colors.length]);
    }
  } else if (opts.waiting) {
    if (Math.floor(opts.t / 400) % 2 === 0) rect(ctx, mx + 6, my + 2, 2, 5, "#f2c14e");
    rect(ctx, mx + 6, my + 8, 2, 1, "#f2c14e");
  }
  rect(ctx, mx + 5, my + 11, 3, 3, "#3a3f4d");
  rect(ctx, mx + 2, my + 13, 9, 2, "#3a3f4d");

  // caneca e papéis à esquerda
  rect(ctx, x + 4, top + 2, 4, 4, d.role === "lider" ? "#f2c14e" : "#f4f1e8");
  rect(ctx, x + 10, top + 3, 8, 5, "#fbfbf8");

  // plaquinha
  const label = d.role === "convidado" ? (opts.occupantName ?? "LIVRE").toUpperCase() : theme.deskLabels[d.role] ?? d.role.toUpperCase();
  const color = roleColor(d.role === "convidado" ? "convidado" : d.role);
  ctx.font = `5px "Press Start 2P", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = Math.min(ctx.measureText(label).width + 6, w - 4);
  const plateY = top + depth + 2;
  rect(ctx, px(d.cx) - tw / 2, plateY, tw, 6, color);
  ctx.fillStyle = "#1d1a24";
  ctx.fillText(label, px(d.cx), plateY + 3.3, w - 8);
}

/** Cadeira atrás da mesa (desenhada antes do personagem). */
export function drawChair(ctx: Ctx, d: Desk, color: string) {
  const x = px(d.cx);
  const y = px(d.cy + 0.85);
  // encosto escuro com a faixa na cor do papel
  rect(ctx, x - 6, y - 18, 12, 11, theme.colors.outline);
  rect(ctx, x - 5, y - 17, 10, 9, "#3a3f4d");
  rect(ctx, x - 5, y - 17, 10, 2, color);
  rect(ctx, x - 4, y - 14, 8, 1, "#4a5060");
}
