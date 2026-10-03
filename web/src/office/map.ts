// Planta do escritório: tamanho, mesas, caminhos e desenho do cenário.
// Tudo em "tiles" (1 tile = 16 px na resolução base). Pra mudar o layout,
// mexa em DESKS, OVERFLOW_SPOTS e COFFEE_SPOTS.

import { navyAlpha, palette, theme, roleColor } from "../theme";
import { AG_LETTERS, drawBitmap } from "./agMark";
import {
  bakeLogo,
  disc,
  drawBridgePainting,
  drawTowerPainting,
  drawRollShelf,
  drawWindowView,
  line,
  type WindowView,
} from "./decor";

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

  drawWall(ctx);

  // janelas com céu, nuvens e obra (guindaste girando, prédio subindo)
  for (const win of WINDOWS) drawWindow(ctx, win.x, win.view, t);

  // porta (entrada à esquerda)
  rect(ctx, 0, px(AISLE_Y) - 20, 5, 40, c.woodShade);
  rect(ctx, 0, px(AISLE_Y) - 18, 3, 36, "#3a2a1e");
  rect(ctx, 5, px(AISLE_Y) - 14, 10, 28, "#5b4a3c"); // capacho
  rect(ctx, 6, px(AISLE_Y) - 13, 8, 26, "#6d5a49");
}

// ------------------------------------------------------------------ parede
// Layout da parede (px base, da esquerda pra direita, sem sobreposição):
//   janela 4–48 · janela 54–98 · quadro da ponte 106–130 · estante de rolos 136–160 ·
//   relógio ~166–186 · placa da recepção 204–308 · quadro branco 318–374 ·
//   quadro da torre 382–406 · janela 414–458 · janela 464–508

const WALL_H = WALL_ROWS * TILE; // 48
/** friso branco (1px) e lambril marinho embaixo dele, até o chão */
const TRIM_Y = 39;

/** janelas: x da moldura externa (44 px de largura) e o que se vê pelo vidro */
const WINDOWS: { x: number; view: WindowView }[] = [
  { x: 4, view: { kind: "crane", mast: 10, phase: 0 } },
  { x: 54, view: { kind: "construction", variant: 0 } },
  { x: 414, view: { kind: "construction", variant: 1 } },
  { x: 464, view: { kind: "crane", mast: 27, phase: 2.4 } },
];
const WIN_W = 44;
const WIN_Y = 4;
const WIN_H = 30;

function drawWall(ctx: Ctx) {
  const c = theme.colors;
  // placas da parede com juntas sutis (fiadas desencontradas)
  rect(ctx, 0, 0, W, TRIM_Y, c.wall);
  for (const [jy, off] of [
    [12, 0],
    [25, 32],
  ]) {
    rect(ctx, 0, jy, W, 1, c.wallJoint);
    const rowTop = jy === 12 ? 0 : 13;
    for (let x = off; x < W; x += 64) rect(ctx, x, rowTop, 1, 12, c.wallJoint);
  }
  for (let x = 16; x < W; x += 64) rect(ctx, x, 26, 1, TRIM_Y - 26, c.wallJoint);
  // friso + lambril marinho
  rect(ctx, 0, TRIM_Y, W, 1, c.trim);
  rect(ctx, 0, TRIM_Y + 1, W, 1, c.wainscotTop);
  rect(ctx, 0, TRIM_Y + 2, W, WALL_H - TRIM_Y - 2, c.wainscot);
  for (let x = 24; x < W; x += 48) rect(ctx, x, TRIM_Y + 3, 1, WALL_H - TRIM_Y - 4, c.wainscotTop);
  rect(ctx, 0, WALL_H - 1, W, 1, palette.navy950);
  // sombra da parede no chão (azulada, some em 3 linhas)
  ctx.fillStyle = c.wallShadow;
  ctx.fillRect(0, WALL_H, W, 3);
  ctx.fillRect(0, WALL_H, W, 2);
  ctx.fillRect(0, WALL_H, W, 1);
}

function drawWindow(ctx: Ctx, x: number, view: WindowView, t: number) {
  const glass = { x: x + 2, y: WIN_Y + 2, w: WIN_W - 4, h: WIN_H - 4 };
  // moldura branca com contorno cinza (destaca da parede clara)
  rect(ctx, x - 1, WIN_Y - 1, WIN_W + 2, WIN_H + 2, palette.gray300);
  rect(ctx, x, WIN_Y, WIN_W, WIN_H, palette.white);

  ctx.save();
  ctx.beginPath();
  ctx.rect(glass.x, glass.y, glass.w, glass.h);
  ctx.clip();
  drawWindowView(ctx, glass, view, t);
  // reflexos diagonais de 1px, bem fracos
  const glint = "rgba(255,255,255,0.22)";
  line(ctx, glass.x + 3, glass.y + 9, glass.x + 11, glass.y + 1, glint);
  line(ctx, glass.x + 6, glass.y + 9, glass.x + 14, glass.y + 1, glint);
  line(ctx, glass.x + 24, glass.y + 23, glass.x + 33, glass.y + 14, glint);
  ctx.restore();

  // sombra interna da moldura (topo e esquerda)
  rect(ctx, glass.x, glass.y, glass.w, 1, navyAlpha(0.18));
  rect(ctx, glass.x, glass.y + 1, 1, glass.h - 1, navyAlpha(0.18));
  // divisão em cruz
  const midX = glass.x + glass.w / 2 - 1;
  const midY = glass.y + glass.h / 2 - 1;
  rect(ctx, midX, glass.y, 2, glass.h, palette.white);
  rect(ctx, glass.x, midY, glass.w, 2, palette.white);
  rect(ctx, midX, midY + 2, 2, 1, palette.gray200);
  // peitoril claro, um pouco mais largo que a janela
  const sillY = WIN_Y + WIN_H;
  rect(ctx, x - 2, sillY, WIN_W + 4, 1, palette.white);
  rect(ctx, x - 2, sillY + 1, WIN_W + 4, 1, palette.gray50);
  rect(ctx, x - 2, sillY + 2, WIN_W + 4, 1, palette.gray300);
  rect(ctx, x - 1, sillY + 3, WIN_W + 2, 1, navyAlpha(0.14));
}

// ------------------------------------------------------------------ placa da recepção

/** placa: contorno 1px (204–307 x 5–39) e a logo 100x33 dentro, 1px de folga marinho nas laterais */
const SIGN = { x: 204, y: 5, w: 104, h: 35 };
const LOGO_W = 100;
const LOGO_H = 33;
/** cache do bake por imagem e k; canvas null = o bake falhou (não tenta de novo a cada quadro) */
let logoBake: { src: HTMLImageElement; k: number; canvas: HTMLCanvasElement | null } | null = null;

function bakedLogo(img: HTMLImageElement, k: number): HTMLCanvasElement | null {
  if (logoBake && logoBake.src === img && logoBake.k === k) return logoBake.canvas;
  let canvas: HTMLCanvasElement | null = null;
  try {
    // o PNG da logo tem 1px branco na primeira e na última linha: fica de fora
    const crop = { sx: 0, sy: 1, sw: img.naturalWidth, sh: img.naturalHeight - 2 };
    canvas = bakeLogo(img, LOGO_W, LOGO_H, k, crop);
  } catch {
    canvas = null;
  }
  logoBake = { src: img, k, canvas };
  return canvas;
}

/** Placa da recepção com a logo em pixels duros (ou "AG" em pixel se a imagem não carregar). */
export function drawSign(ctx: Ctx, logo: HTMLImageElement | null) {
  const c = theme.colors;
  const { x, y, w, h } = SIGN;
  // sombra de 1px na parede
  rect(ctx, x + 1, y + h, w, 1, "rgba(2,11,28,0.25)");
  rect(ctx, x + w, y + 1, 1, h, "rgba(2,11,28,0.25)");
  rect(ctx, x, y, w, h, c.outline);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, c.sign);

  // escala inteira atual do canvas (o render roda com setTransform(k))
  const m = ctx.getTransform();
  const k = Math.max(1, Math.round(m.a));
  const ready = logo && logo.complete && logo.naturalWidth > 0;
  const baked = ready ? bakedLogo(logo, k) : null;
  const lx = x + (w - LOGO_W) / 2;
  const ly = y + 1;
  if (baked) {
    // desenha 1:1 em pixels de dispositivo, sem suavização
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(baked, Math.round(lx * m.a + m.e), Math.round(ly * m.d + m.f));
    ctx.restore();
  } else {
    drawBitmap(ctx, AG_LETTERS, x + (w - 28) / 2, y + (h - 16) / 2, c.signText, 2);
  }
  // parafusos nos cantos
  for (const [sx, sy] of [
    [x + 2, y + 2],
    [x + w - 3, y + 2],
    [x + 2, y + h - 3],
    [x + w - 3, y + h - 3],
  ]) rect(ctx, sx, sy, 1, 1, palette.gray500);

  // duas arandelas em cima da placa, iluminando pra baixo
  for (const ax of [x + 20, x + w - 21]) {
    rect(ctx, ax - 1, 0, 3, 1, palette.gray400);
    rect(ctx, ax, 1, 1, 1, palette.gray500);
    rect(ctx, ax - 1, 2, 3, 1, palette.navy800);
    rect(ctx, ax - 2, 3, 5, 1, palette.navy900);
    rect(ctx, ax - 1, 4, 3, 1, palette.white);
  }
}

/** Relógio de parede com a hora real (disco em pixel, ponteiros de 1px). */
export function drawClock(ctx: Ctx, now: Date) {
  const cx = 176;
  const cy = 21;
  rect(ctx, cx - 8, cy + 11, 18, 1, "rgba(2,11,28,0.18)"); // sombra
  disc(ctx, cx, cy, 10, theme.colors.outline);
  disc(ctx, cx, cy, 9, palette.navy800);
  disc(ctx, cx, cy, 8, palette.white);
  // marcas das 12, 3, 6 e 9 + as outras horas em cinza
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const mx = cx + Math.round(Math.sin(a) * 7);
    const my = cy - Math.round(Math.cos(a) * 7);
    rect(ctx, mx, my, 1, 1, i % 3 === 0 ? palette.navy900 : palette.gray300);
  }
  const hand = (angle: number, len: number, color: string) =>
    line(ctx, cx, cy, cx + Math.round(Math.sin(angle) * len), cy - Math.round(Math.cos(angle) * len), color);
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();
  const ha = ((h + m / 60) / 12) * Math.PI * 2;
  hand(ha, 4, palette.navy900);
  // ponteiro das horas mais grosso: segunda linha ao lado
  line(ctx, cx + 1, cy, cx + 1 + Math.round(Math.sin(ha) * 3), cy - Math.round(Math.cos(ha) * 3), palette.navy900);
  hand(((m + s / 60) / 60) * Math.PI * 2, 6, palette.navy900);
  hand((s / 60) * Math.PI * 2, 6, palette.signal.alert);
  rect(ctx, cx, cy, 1, 1, theme.colors.outline);
}

/** Quadro branco com contadores ao vivo. */
export function drawBoard(ctx: Ctx, counts: { working: number; waiting: number; total: number }) {
  const x = 318;
  const y = 6;
  const w = 56;
  const h = 30;
  rect(ctx, x + 1, y + h, w, 1, "rgba(2,11,28,0.18)");
  rect(ctx, x + w, y + 1, 1, h, "rgba(2,11,28,0.18)");
  rect(ctx, x, y, w, h, palette.gray400); // moldura de alumínio
  rect(ctx, x, y, w, 1, palette.gray300);
  rect(ctx, x + 2, y + 2, w - 4, h - 4, palette.white);
  rect(ctx, x + 2, y + 2, w - 4, 1, palette.gray50);
  // bandeja com pincéis
  rect(ctx, x + 6, y + h, 22, 2, palette.gray500);
  rect(ctx, x + 9, y + h - 1, 5, 1, palette.navy600);
  rect(ctx, x + 16, y + h - 1, 5, 1, palette.signal.alert);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `8px VT323, monospace`;
  ctx.fillStyle = palette.navy900;
  ctx.fillText(`TIME: ${counts.total}`, x + 5, y + 3);
  ctx.fillStyle = palette.navy700;
  ctx.fillText(`FAZENDO: ${counts.working}`, x + 5, y + 11);
  ctx.fillStyle = counts.waiting ? palette.signal.waitingInk : palette.gray400;
  ctx.fillText(`ESPERA: ${counts.waiting}`, x + 5, y + 19);
}

/** Quadros e estante da parede (estáticos). */
export function drawDecor(ctx: Ctx) {
  drawBridgePainting(ctx, 106, 9);
  drawRollShelf(ctx, 136, 9, 24, 39);
  drawTowerPainting(ctx, 382, 9);
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
  rect(ctx, mx, my, 13, 11, opts.active ? "#0f2a22" : opts.waiting ? palette.navy900 : "#1c2230");
  if (opts.active) {
    // linhas de código "rolando"
    const scroll = Math.floor(opts.t / 180);
    const colors = ["#3fbf86", "#5aaef0", "#f2c14e", "#ef5f7b", "#c8d0dc"];
    for (let i = 0; i < 4; i++) {
      const len = 3 + ((i * 5 + scroll * 3) % 7);
      rect(ctx, mx + 2 + ((i + scroll) % 2) * 2, my + 2 + i * 2, len, 1, colors[(i + scroll) % colors.length]);
    }
  } else if (opts.waiting) {
    if (Math.floor(opts.t / 400) % 2 === 0) rect(ctx, mx + 6, my + 2, 2, 5, palette.signal.waiting);
    rect(ctx, mx + 6, my + 8, 2, 1, palette.signal.waiting);
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
