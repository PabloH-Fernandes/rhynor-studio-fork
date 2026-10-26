// Planta do escritório: tamanho, mesas, caminhos e desenho do cenário.
// Tudo em "tiles" (1 tile = 16 px na resolução base). Pra mudar o layout,
// mexa em DESKS, OVERFLOW_SPOTS, COFFEE_SPOTS e REST_SPOTS.
// As colunas 32 a 36 são a ala de descanso (ping-pong, bebedouro, 3ª mesa de convidado).

import { inkAlpha, navyAlpha, palette, theme, roleColor } from "../theme";
import { comAlfa } from "../marca/cores";
import { RHYNOR_LETTERS, STUDIO_LETTERS, STUDIO_PLAQUE, bitmapWidth, drawBitmap, drawPixelArt } from "./pixelMarca";
import { RINO_32, RINO_TOKENS } from "../marca/rinoceronte";
import { cor } from "../marca/cores";
import {
  SOFA_GRAY,
  SOFA_NAVY,
  disc,
  drawCoatRack,
  drawCoffeeTable,
  drawCredenza,
  drawFloorLamp,
  drawPingPongTable,
  drawPlant,
  drawPrinter,
  drawReception,
  drawSofa,
  drawSeriesPosterCity,
  drawSeriesPosterFilm,
  drawStudioShelf,
  drawWaterCooler,
  drawWindowView,
  fill,
  line,
  mix,
  oval,
  type Rect,
  type WindowLight,
  type WindowView,
} from "./decor";
import type { Dir } from "./sprites";
import { rotuloQueCabe } from "./deskLabel";
import { SEGMENTOS, segmentosCheios, type TextoProgresso } from "../progresso";

export const TILE = 16;
export const COLS = 36;
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
  /** pra onde olha ao chegar (sem isso: o padrão do motor) */
  face?: Dir;
  /** linha usada na ordenação por profundidade quando está parado aqui (ex.: na frente do sofá) */
  depth?: number;
  /** banquinho da reunião: sentado sem mesa na frente, o motor desenha as canelas penduradas */
  stool?: boolean;
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
  // ala de descanso, embaixo do ping-pong (lane x = 32, a mesma dos jogadores)
  { id: "convidado-3", role: "convidado", cx: 34, cy: 12 },
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

/** coluna livre à direita da mesa (fora do banquinho 1, em 18,6; colada na lane 19,5 do revisor) */
const LANE_DIREITA_REUNIAO = 19.3;

/**
 * Lugares em pé em volta da mesa de reunião (quando as mesas lotam). O reuniao:4 fica em cima à
 * direita, fora da coluna do presenter (em 16; 9,2 ficava a 0,1 tile dele): sobe pela lane da
 * direita e entra de lado.
 */
export const OVERFLOW_SPOTS: Spot[] = (
  [
    [14.4, 10.2],
    [17.6, 10.2],
    [14.4, 12.6],
    [17.6, 12.6],
    [17.8, 8.4, LANE_DIREITA_REUNIAO],
    [16, 13.4],
  ] as [number, number, number?][]
).map(([x, y, lane], i) => ({
  id: `reuniao:${i}`,
  x,
  y,
  laneX: lane ?? x,
  via: lane === undefined ? [] : [{ x: lane, y }],
  sitting: false,
}));

/** coluna livre à esquerda da mesa (fora do banquinho 0, em 13,4, e dos em pé de x 14,4) */
const LANE_ESQUERDA_REUNIAO = 12.6;

/**
 * Quem apresenta a reunião: em pé atrás da mesa redonda, de frente pra ela. Sobe pela coluna livre
 * à esquerda e entra por cima, sem atravessar a mesa nem os lugares em pé (route() sempre passa
 * pelo corredor).
 */
export const MEETING_PRESENTER: Spot = {
  id: "reuniao:apresenta",
  x: 16,
  y: 9.3,
  laneX: LANE_ESQUERDA_REUNIAO,
  via: [{ x: LANE_ESQUERDA_REUNIAO, y: 9.3 }],
  sitting: false,
  face: "down",
};

/** distância do pé do boneco sentado ao centro da linha de profundidade do banquinho (px base) */
const STOOL_DEPTH = 2;

function stoolSeat(i: number, x: number, y: number, face: Dir): Spot {
  return {
    id: `reuniao:banco${i}`,
    x,
    y,
    laneX: x,
    via: [],
    sitting: true,
    stool: true,
    face,
    // logo depois do banquinho (que é ordenado em y*TILE + STOOL_DEPTH)
    depth: y * TILE + STOOL_DEPTH + 0.5,
  };
}

/**
 * Os 4 banquinhos em volta da mesa (sempre desenhados). Cada um sobe do corredor em linha reta
 * por uma coluna que fica fora da mesa (x 14,4 a 17,6) e longe dos OVERFLOW_SPOTS (>= 0,8 tile).
 */
export const MEETING_STOOLS: Spot[] = [
  stoolSeat(0, 13.4, 11.2, "right"),
  stoolSeat(1, 18.6, 11.2, "left"),
  stoolSeat(2, 15.2, 14.1, "up"),
  stoolSeat(3, 16.8, 14.1, "up"),
];

/**
 * Lugares da reunião, na ordem de uso: 4 sentados e, quando há mais gente, 2 em pé (os mesmos
 * ids de OVERFLOW_SPOTS 0 e 1: a reserva do descanso é uma só). O presenter não entra aqui.
 */
export const MEETING_SEATS: Spot[] = [
  ...MEETING_STOOLS,
  { ...OVERFLOW_SPOTS[0], face: "right" },
  { ...OVERFLOW_SPOTS[1], face: "left" },
];

// cafe:0 fica 0,4 tile mais baixo: em 15 a cabeça cobria a plaquinha da mesa convidado-2
export const COFFEE_SPOTS: Spot[] = [
  [27.6, 15.4],
  [29.2, 15.1],
  [30.7, 15],
].map(([x, y], i) => ({ id: `cafe:${i}`, x, y, laneX: x, via: [], sitting: false, face: "down" as const }));

// ------------------------------------------------------------------ descanso

/** atividades com lugar no mapa (espreguiçar fica na própria mesa) */
export type RestSpotKind = "cafe" | "celular" | "maquete" | "bebedouro" | "regar" | "papo";

/** Lugar de descanso: o agendador (activities.ts) reserva um por vez por Personagem. */
export interface RestSpot extends Spot {
  kind: RestSpotKind;
  face: Dir;
  /** sentado no sofá/poltrona: o motor desenha as canelas na frente do assento */
  sofa?: boolean;
}

/** Sentado no sofá: pés na linha `baseY - 4` e desenhado logo depois do sofá (base `baseY`). */
function sofaSeat(id: string, xPx: number, baseY: number, approach?: { laneX: number; y: number }): RestSpot {
  const x = xPx / TILE;
  const y = (baseY - 4) / TILE;
  return {
    id,
    kind: "celular",
    x,
    y,
    laneX: approach?.laneX ?? x,
    via: approach ? [{ x: approach.laneX, y: approach.y }, { x, y: approach.y }] : [],
    sitting: true,
    sofa: true,
    face: "down",
    depth: baseY + 0.5,
  };
}

/** mesa de ping-pong da ala (tampo em px base; a base com as pernas fica 8 px abaixo) */
export const PINGPONG = { x: 527, y: 106, w: 34, h: 28 } as const;
/** coluna livre da ala: sobe do corredor até os jogadores e a 3ª mesa de convidado */
export const ALA_LANE_X = 32;

/** Os 2 lados da mesa de ping-pong (a partida entra na etapa 5; por ora o lugar só fica reservado). */
export const PINGPONG_SPOTS: Spot[] = [
  { id: "pingpong:0", x: 34, y: 6.2, laneX: ALA_LANE_X, via: [{ x: ALA_LANE_X, y: 6.2 }], sitting: false, face: "down" },
  { id: "pingpong:1", x: 34, y: 9.6, laneX: ALA_LANE_X, via: [{ x: ALA_LANE_X, y: 9.6 }], sitting: false, face: "up" },
];

/** bebedouro da ala, embaixo do corredor (x = borda esquerda, y = base, px base) */
export const WATER_COOLER: Point = { x: 553, y: 286 };

/**
 * Lugares de descanso. A maquete usa os mesmos ids de OVERFLOW_SPOTS (reuniao:0 e reuniao:1):
 * a reserva é uma só, então ninguém fica em pé no mesmo ponto.
 */
export const REST_SPOTS: RestSpot[] = [
  ...COFFEE_SPOTS.map((s): RestSpot => ({ ...s, kind: "cafe", face: "down" })),
  // sofá escuro de cima (2 lugares) e poltrona: sobem pela lane da mesa mais perto
  sofaSeat("sofa:0", 39, 104, { laneX: 2.5, y: 7 }),
  sofaSeat("sofa:1", 57, 104, { laneX: 2.5, y: 7 }),
  sofaSeat("poltrona", 455, 104, { laneX: 25.5, y: 7 }),
  // sofá de espera embaixo (desce direto do corredor)
  sofaSeat("espera:0", 127, 285),
  sofaSeat("espera:1", 149, 285),
  // maquete: em pé dos 2 lados de cima da mesa de reunião, olhando pro centro
  ...OVERFLOW_SPOTS.slice(0, 2).map((s, i): RestSpot => ({ ...s, kind: "maquete", face: i === 0 ? "right" : "left" })),
  // planta do corredor: o regador fica sobre o vaso
  { id: "planta", kind: "regar", x: 282 / TILE, y: 15, laneX: 282 / TILE, via: [], sitting: false, face: "right" },
  // bebedouro: à esquerda dele, virado pra ele
  { id: "bebedouro", kind: "bebedouro", x: 540 / TILE, y: 17.4, laneX: 540 / TILE, via: [], sitting: false, face: "right" },
];

/** Ponto de encontro do bate-papo: 2 ou 3 lugares, usados na ordem (os 2 primeiros ficam lado a lado). */
export interface PapoPlace {
  id: string;
  spots: readonly RestSpot[];
}

const restSpot = (id: string) => {
  const s = REST_SPOTS.find((r) => r.id === id);
  if (!s) throw new Error(`lugar de descanso ${id} não existe`);
  return s;
};

/**
 * Em pé no corredor, entre a mesa do testador e a reunião (fora das lanes 8,5 e 14,4):
 * 2 frente a frente logo acima do corredor e o 3º logo abaixo, no meio, olhando pra cima
 * (afastados ~14 px pra um não cobrir o outro).
 */
export const PAPO_CORREDOR: RestSpot[] = [
  [12.3, 15.2, "right"],
  [14.1, 15.2, "left"],
  [13.2, 16.4, "up"],
].map(([x, y, face], i) => ({
  id: `papo:${i}`,
  kind: "papo",
  x: x as number,
  y: y as number,
  laneX: x as number,
  via: [],
  sitting: false,
  face: face as Dir,
}));

/** Os mesmos ids do sofá e do café: a reserva é uma só, ninguém senta em cima de ninguém. */
export const PAPO_PLACES: PapoPlace[] = [
  { id: "sofa", spots: [restSpot("sofa:0"), restSpot("sofa:1")] },
  { id: "espera", spots: [restSpot("espera:0"), restSpot("espera:1")] },
  { id: "copa", spots: COFFEE_SPOTS.map((s) => restSpot(s.id)) },
  { id: "corredor", spots: PAPO_CORREDOR },
];

/** Onde fica um copo largado em cima de uma mesa (px base). */
export interface CupSurface {
  x: number;
  y: number;
  /** ordenação por profundidade: logo depois da mesa */
  depth: number;
}

/** Lugar do copo no tampo: à direita, na frente do monitor (o lado esquerdo já tem caneca e papéis). */
export function cupSurface(d: Desk): CupSurface {
  return { x: Math.round(d.cx * TILE) + 15, y: Math.round((d.cy + 0.55) * TILE) + 4, depth: (d.cy + 0.55) * TILE + 20.1 };
}

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

/** placas de porcelanato: 32x32 px (2x2 tiles), alternando 2 tons, com juntas de 1px */
const FLOOR_SLAB = 32;

/**
 * Chão, tapete, passadeira, parede e porta: tudo estático, o motor desenha uma vez numa camada
 * fora da tela (as janelas, que mexem, vêm por cima em drawWindows).
 */
export function drawFloor(ctx: Ctx) {
  const c = theme.colors;
  const top = WALL_ROWS * TILE;
  for (let y = top; y < H; y += FLOOR_SLAB) {
    for (let x = 0; x < W; x += FLOOR_SLAB) {
      const i = x / FLOOR_SLAB + (y - top) / FLOOR_SLAB;
      const tone = i % 2 === 0 ? c.floorA : c.floorB;
      rect(ctx, x, y, FLOOR_SLAB, FLOOR_SLAB, tone);
      // pintinha clara fixa em metade das placas (textura sutil do porcelanato)
      const s = (x * 7 + y * 13) % 23;
      if (s % 2 === 0) rect(ctx, x + 4 + s, y + 6 + (s % 11), 1, 1, mix(tone, palette.gray100, 0.5));
    }
    rect(ctx, 0, y + FLOOR_SLAB - 1, W, 1, c.floorLine);
  }
  for (let x = FLOOR_SLAB - 1; x < W; x += FLOOR_SLAB) rect(ctx, x, top, 1, H - top, c.floorLine);

  // tapete da área de reunião
  rect(ctx, px(12.6), px(8.6), px(6.8), px(5.6), c.rugBorder);
  rect(ctx, px(12.6) + 3, px(8.6) + 3, px(6.8) - 6, px(5.6) - 6, c.rug);
  {
    const rx = px(12.6) + 5;
    const ry = px(8.6) + 5;
    const rw = px(6.8) - 10;
    const rh = px(5.6) - 10;
    for (const [fx, fy, fw, fh] of [
      [rx, ry, rw, 1],
      [rx, ry + rh - 1, rw, 1],
      [rx, ry, 1, rh],
      [rx + rw - 1, ry, 1, rh],
    ]) rect(ctx, fx, fy, fw, fh, palette.navy700);
    for (let i = 1; i < 6; i++) rect(ctx, rx + 3, ry + i * 13, rw - 6, 1, palette.gray200);
  }

  // corredor (passadeira cinza) por onde todo mundo anda, da porta até a ala de descanso
  rect(ctx, 0, px(AISLE_Y) - 6, W, 12, palette.gray400);
  rect(ctx, 0, px(AISLE_Y) - 5, W, 10, palette.gray300);

  drawWall(ctx);

  // porta (entrada à esquerda, madeira quente) + capacho escuro
  rect(ctx, 0, px(AISLE_Y) - 20, 5, 40, c.woodShade);
  rect(ctx, 0, px(AISLE_Y) - 18, 3, 36, palette.furniture.woodDark);
  rect(ctx, 3, px(AISLE_Y) - 18, 1, 36, c.wood);
  rect(ctx, 5, px(AISLE_Y) - 14, 10, 28, palette.navy900);
  rect(ctx, 6, px(AISLE_Y) - 13, 8, 26, palette.navy800);
  for (let y = px(AISLE_Y) - 11; y < px(AISLE_Y) + 12; y += 3) rect(ctx, 7, y, 6, 1, palette.navy700);
}

/** janelas com céu, nuvens e a cidade (prédios, antena piscando): todo quadro, por cima da parede */
export function drawWindows(ctx: Ctx, t: number, light?: WindowLight) {
  for (const win of WINDOWS) drawWindow(ctx, win.x, win.view, t, light);
}

// ------------------------------------------------------------------ parede
// Layout da parede (px base, da esquerda pra direita, sem sobreposição):
//   janela 4–48 · janela 54–98 · pôster da cidade 106–130 · estante do estúdio 136–160 ·
//   relógio ~166–186 · placa da recepção 204–308 · quadro de etapas 318–404 (bandeja até y 39,
//   acima do friso) · pôster do filme 410–434 · janela 440–484 ·
//   janela 490–534 · plaquinha "RHYNOR STUDIO" 539–574 (em cima da ala de descanso)

const WALL_H = WALL_ROWS * TILE; // 48
/** friso (1px) e lambril escuro embaixo dele, até o chão */
const TRIM_Y = 39;

/** janelas: x da moldura externa (44 px de largura) e o que se vê pelo vidro */
const WINDOWS: { x: number; view: WindowView }[] = [
  { x: 4, view: { kind: "cidade", seed: 3, antena: 12 } },
  { x: 54, view: { kind: "cidade", seed: 11 } },
  { x: 440, view: { kind: "cidade", seed: 23 } },
  { x: 490, view: { kind: "cidade", seed: 37, antena: 22, moon: { x: 4, y: 3 } } },
];
const WIN_W = 44;
const WIN_Y = 4;
const WIN_H = 30;

/** vidro de cada janela (px base) */
export const WINDOW_GLASS: Rect[] = WINDOWS.map((w) => ({ x: w.x + 2, y: WIN_Y + 2, w: WIN_W - 4, h: WIN_H - 4 }));

/** os 4 vidros de cada janela, sem a cruz branca: o lightmap deixa só eles com as cores do céu */
export const WINDOW_PANES: Rect[] = WINDOW_GLASS.flatMap((g) => {
  const midX = g.x + g.w / 2 - 1;
  const midY = g.y + g.h / 2 - 1;
  const lw = midX - g.x;
  const th = midY - g.y;
  return [
    { x: g.x, y: g.y, w: lw, h: th },
    { x: midX + 2, y: g.y, w: g.x + g.w - midX - 2, h: th },
    { x: g.x, y: midY + 2, w: lw, h: g.y + g.h - midY - 2 },
    { x: midX + 2, y: midY + 2, w: g.x + g.w - midX - 2, h: g.y + g.h - midY - 2 },
  ];
});

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
  // friso + lambril escuro
  rect(ctx, 0, TRIM_Y, W, 1, c.trim);
  rect(ctx, 0, TRIM_Y + 1, W, 1, c.wainscotTop);
  rect(ctx, 0, TRIM_Y + 2, W, WALL_H - TRIM_Y - 2, c.wainscot);
  for (let x = 24; x < W; x += 48) rect(ctx, x, TRIM_Y + 3, 1, WALL_H - TRIM_Y - 4, c.wainscotTop);
  rect(ctx, 0, WALL_H - 1, W, 1, palette.navy950);
  // sombra da parede no chão (some em 3 linhas)
  ctx.fillStyle = c.wallShadow;
  ctx.fillRect(0, WALL_H, W, 3);
  ctx.fillRect(0, WALL_H, W, 2);
  ctx.fillRect(0, WALL_H, W, 1);
}

function drawWindow(ctx: Ctx, x: number, view: WindowView, t: number, light?: WindowLight) {
  const glass = { x: x + 2, y: WIN_Y + 2, w: WIN_W - 4, h: WIN_H - 4 };
  // moldura clara com contorno de aço (destaca da parede)
  rect(ctx, x - 1, WIN_Y - 1, WIN_W + 2, WIN_H + 2, palette.gray300);
  rect(ctx, x, WIN_Y, WIN_W, WIN_H, palette.white);

  ctx.save();
  ctx.beginPath();
  ctx.rect(glass.x, glass.y, glass.w, glass.h);
  ctx.clip();
  drawWindowView(ctx, glass, view, t, light);
  // reflexos diagonais de 1px, bem fracos
  // (à noite mais fracos, pra não riscarem o céu escuro)
  const glint = comAlfa("rh-nevoa", 0.22 * (1 - 0.6 * (light?.night ?? 0)));
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

/** letreiro: contorno 1px (204–307 x 5–39), rinoceronte 32x32 à esquerda e "RHYNOR / STUDIO" à direita */
export const SIGN = { x: 204, y: 5, w: 104, h: 35 } as const;
/** x das duas arandelas em cima da placa (também são luzes no lightmap) */
export const SIGN_LAMP_X = [SIGN.x + 20, SIGN.x + SIGN.w - 21] as const;

/** Letreiro da recepção: rinoceronte pixel (versão de fundo escuro) e "RHYNOR STUDIO". */
export function drawSign(ctx: Ctx) {
  const c = theme.colors;
  const { x, y, w, h } = SIGN;
  // sombra de 1px na parede
  rect(ctx, x + 1, y + h, w, 1, inkAlpha(0.25));
  rect(ctx, x + w, y + 1, 1, h, inkAlpha(0.25));
  rect(ctx, x, y, w, h, c.outline);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, c.sign);
  drawSignArt(ctx, c.signText);
  // parafusos nos cantos
  for (const [sx, sy] of [
    [x + 2, y + 2],
    [x + w - 3, y + 2],
    [x + 2, y + h - 3],
    [x + w - 3, y + h - 3],
  ]) rect(ctx, sx, sy, 1, 1, palette.gray500);

  // duas arandelas em cima da placa, iluminando pra baixo
  for (const ax of SIGN_LAMP_X) {
    rect(ctx, ax - 1, 0, 3, 1, palette.gray400);
    rect(ctx, ax, 1, 1, 1, palette.gray500);
    rect(ctx, ax - 1, 2, 3, 1, palette.navy800);
    rect(ctx, ax - 2, 3, 5, 1, palette.navy900);
    rect(ctx, ax - 1, 4, 3, 1, palette.white);
  }
}

/**
 * Brilho do letreiro à noite: soma o rinoceronte e as letras de novo por cima (o chamador põe
 * "lighter" e o alpha), pra continuarem legíveis depois do multiply do lightmap.
 */
export function drawSignGlow(ctx: Ctx) {
  drawSignArt(ctx, theme.colors.signText);
}

/** cores do rinoceronte (letra → token da marca) */
const rinoCores = (): Record<string, string> => Object.fromEntries(Object.entries(RINO_TOKENS).map(([k, t]) => [k, cor(t)]));

/** rinoceronte 32x32 à esquerda (1px do contorno em cima) e o texto centralizado no resto */
function drawSignArt(ctx: Ctx, textColor: string) {
  const { x, y, w, h } = SIGN;
  drawPixelArt(ctx, RINO_32, x + 3, y + 1, rinoCores());
  const left = x + 3 + 32 + 2;
  const area = x + w - 3 - left;
  const bigW = bitmapWidth(RHYNOR_LETTERS);
  const smallW = bitmapWidth(STUDIO_LETTERS);
  const top = y + Math.floor((h - (8 + 4 + 5)) / 2);
  drawBitmap(ctx, RHYNOR_LETTERS, left + Math.floor((area - bigW) / 2), top, textColor);
  drawBitmap(ctx, STUDIO_LETTERS, left + Math.floor((area - smallW) / 2), top + 12, textColor);
}

/** Relógio de parede com a hora real (disco em pixel, ponteiros de 1px). */
export function drawClock(ctx: Ctx, now: Date) {
  const cx = 176;
  const cy = 21;
  rect(ctx, cx - 8, cy + 11, 18, 1, inkAlpha(0.18)); // sombra
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

/**
 * quadro de etapas na parede (px base), entre a placa e o quadro da torre (x 410); o lightmap
 * mantém ele claro em qualquer hora. A bandeja de pincéis fica embaixo (y + h .. y + h + 2), acima
 * do friso da parede (y 39).
 */
export const BOARD = { x: 318, y: 3, w: 86, h: 34 } as const;
/** bandeja de pincéis embaixo do quadro (o lightmap clareia junto) */
export const BOARD_TRAY = { x: BOARD.x + 6, y: BOARD.y + BOARD.h, w: 22, h: 2 } as const;

export interface BoardData {
  progresso: TextoProgresso;
  /** só o time (líder e os 6 papéis); visitante não entra */
  total: number;
  /** visitantes que aparecem no mapa (no máximo 3) */
  visitors: number;
  /** quem está trabalhando no mapa: time + visitantes visíveis */
  working: number;
  waiting: number;
  /** nome da missão em andamento (só quando ela nasceu de uma reunião); troca a linha dos contadores */
  missao?: string;
}

const BOARD_TITLE_FONT = "8px VT323, monospace";
const BOARD_SMALL_FONT = "7px VT323, monospace";

/** emoji (e seus modificadores, junções e bandeiras): a VT323 não tem, viraria um glifo de outra fonte */
const EMOJI = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[‍️⃣]/gu;

/** tira os emoji do texto do quadro (e os espaços que sobram) */
export function semEmoji(text: string): string {
  return text.replace(EMOJI, "").replace(/\s{2,}/g, " ").trim();
}

/** corta o texto (sem emoji) com "…" até caber em maxW; corta por code point, nunca no meio de um par UTF-16 */
export function cortaTexto(text: string, maxW: number, medir: (s: string) => number): string {
  const limpo = semEmoji(text);
  if (medir(limpo) <= maxW) return limpo;
  const cps = Array.from(limpo);
  let n = cps.length;
  while (n > 1 && medir(`${cps.slice(0, n).join("")}…`) > maxW) n--;
  return `${cps.slice(0, n).join("").trimEnd()}…`;
}

function fitText(ctx: Ctx, text: string, maxW: number): string {
  return cortaTexto(text, maxW, (s) => ctx.measureText(s).width);
}

/** largura da prancheta + espaço antes do nome da missão (px base) */
const MISSAO_ICON_W = 7;
/** com menos que isso do nome à vista, o "ESPERA n" sai da linha (ele já aparece no painel) */
const MISSAO_MIN_CHARS = 6;

/**
 * Linha da missão no quadro: o nome (cortado com "…") e, se couber junto com pelo menos
 * MISSAO_MIN_CHARS letras do nome, o "ESPERA n" à direita (null = não mostra).
 */
export function linhaDaMissao(
  nome: string,
  waiting: number,
  maxW: number,
  medir: (s: string) => number,
): { nome: string; espera: string | null } {
  const textW = maxW - MISSAO_ICON_W;
  if (waiting > 0) {
    const espera = `ESPERA ${waiting}`;
    const cortado = cortaTexto(nome, textW - medir(` · ${espera}`), medir);
    const visiveis = Array.from(cortado.endsWith("…") ? cortado.slice(0, -1) : cortado).length;
    if (!cortado.endsWith("…") || visiveis >= MISSAO_MIN_CHARS) return { nome: cortado, espera };
  }
  return { nome: cortaTexto(nome, textW, medir), espera: null };
}

/** copo do escritório (o mesmo das mesas) com vapor; (x, y) = canto de cima do corpo */
function boardCup(ctx: Ctx, x: number, y: number) {
  const ink = palette.navy950;
  rect(ctx, x + 1, y - 2, 1, 1, palette.gray400); // vapor
  rect(ctx, x + 2, y - 3, 1, 1, palette.gray400);
  rect(ctx, x, y - 1, 3, 1, ink); // borda de cima
  rect(ctx, x - 1, y, 1, 4, ink); // lados
  rect(ctx, x + 3, y, 1, 4, ink);
  rect(ctx, x, y + 4, 3, 1, ink); // fundo
  rect(ctx, x, y, 3, 1, palette.furniture.woodShade); // café
  rect(ctx, x, y + 1, 3, 3, palette.white);
  rect(ctx, x, y + 2, 3, 1, palette.navy900); // faixa do copo
  rect(ctx, x + 4, y + 1, 1, 2, ink); // asa
}

/** prancheta em pixel (5x6): clipe no alto, folha branca e 2 linhas de texto; (x, y) = canto de cima */
function boardClipboard(ctx: Ctx, x: number, y: number) {
  const ink = palette.navy700;
  rect(ctx, x, y + 1, 5, 5, ink); // prancheta
  rect(ctx, x + 1, y, 3, 1, palette.gray500); // clipe
  rect(ctx, x + 1, y + 2, 3, 3, palette.white); // folha
  rect(ctx, x + 1, y + 3, 3, 1, palette.gray400); // linha de texto
}

/** visto em pixel (6x5) */
function boardCheck(ctx: Ctx, x: number, y: number) {
  const c = palette.navy700;
  rect(ctx, x, y + 2, 1, 1, c);
  rect(ctx, x + 1, y + 3, 1, 1, c);
  rect(ctx, x + 2, y + 4, 1, 1, c);
  rect(ctx, x + 3, y + 2, 1, 2, c);
  rect(ctx, x + 4, y + 1, 1, 1, c);
  rect(ctx, x + 5, y, 1, 1, c);
}

/**
 * Quadro de etapas: título ("Time na Etapa 4 de 7", "em Construção" ou "de boa" com xícara),
 * o que está sendo feito, barra de 10 segmentos com "4/7" e, embaixo, "TIME 5 · FAZENDO 2"
 * (e "ESPERA n" em waitingInk só quando há alguém esperando). Fica numa camada própria no motor,
 * redesenhada só quando o texto ou os contadores mudam.
 */
export function drawBoard(ctx: Ctx, data: BoardData, k = 2) {
  const { x, y, w, h } = BOARD;
  const pr = data.progresso;
  rect(ctx, x + 1, y + h, w, 1, inkAlpha(0.18));
  rect(ctx, x + w, y + 1, 1, h, inkAlpha(0.18));
  rect(ctx, x, y, w, h, palette.gray400); // moldura de alumínio
  rect(ctx, x, y, w, 1, palette.gray300);
  rect(ctx, x + 2, y + 2, w - 4, h - 4, palette.white);
  rect(ctx, x + 2, y + 2, w - 4, 1, palette.gray50);
  // bandeja com pincéis
  rect(ctx, BOARD_TRAY.x, BOARD_TRAY.y, BOARD_TRAY.w, BOARD_TRAY.h, palette.gray500);
  rect(ctx, x + 9, y + h - 1, 5, 1, palette.navy600);
  rect(ctx, x + 16, y + h - 1, 5, 1, palette.signal.alert);

  const left = x + 5;
  const maxW = w - 9;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // título (com espaço pro ícone de xícara ou visto)
  ctx.font = BOARD_TITLE_FONT;
  const icon = pr.estado === "nada" || pr.estado === "concluido" ? 8 : 0;
  const title = ctx.measureText(pr.titulo).width <= maxW - icon ? pr.titulo : fitText(ctx, pr.curto, maxW - icon);
  ctx.fillStyle = palette.navy900;
  ctx.fillText(title, left, y + 2);
  const tw = Math.round(ctx.measureText(title).width);
  if (pr.estado === "nada") boardCup(ctx, left + tw + 3, y + 6);
  if (pr.estado === "concluido") boardCheck(ctx, left + tw + 2, y + 5);

  // texto de 7 px em k=1 vira borrão (o canvas sempre suaviza texto): ali o detalhe some e os
  // contadores vão em 8 px; de k=2 pra cima a linha pequena aparece
  const small = k >= 2 ? BOARD_SMALL_FONT : BOARD_TITLE_FONT;
  ctx.font = small;
  const detalhe =
    pr.estado === "tarefas" ? pr.detalhe : pr.estado === "papel" ? "sem lista de tarefas" : pr.estado === "concluido" ? "tudo entregue" : "ninguém trabalhando agora";
  if (detalhe && k >= 2) {
    ctx.fillStyle = pr.estado === "tarefas" ? palette.navy600 : palette.gray500;
    ctx.fillText(fitText(ctx, detalhe, maxW), left, y + 10);
  }

  // barra de 10 segmentos + "4/7"
  if (pr.max > 0) {
    const cheios = segmentosCheios(pr.valor, pr.max);
    for (let i = 0; i < SEGMENTOS; i++) {
      const sx = left + i * 6;
      rect(ctx, sx, y + 18, 5, 5, i < cheios ? palette.navy700 : palette.gray200);
    }
    ctx.fillStyle = palette.navy900;
    ctx.fillText(`${pr.valor}/${pr.max}`, left + SEGMENTOS * 6 + 2, y + 17);
  }

  // contadores (sem barra, sobem pro lugar dela); com "ESPERA n", "FAZENDO" vira "FAZ." se não couber
  const cy = pr.max > 0 ? y + 25 : y + 17;
  ctx.font = small;
  const espera = data.waiting > 0 ? ` · ESPERA ${data.waiting}` : "";
  // "TIME 7 · VISITANTES 2 · FAZENDO 3" (sem visitantes, o trecho some); se não couber, abrevia
  const cabe = (t: string) => ctx.measureText(t + espera).width <= maxW;
  const com = (visit: string, faz: string) => `TIME ${data.total}${data.visitors > 0 ? ` · ${visit} ${data.visitors}` : ""} · ${faz} ${data.working}`;
  if (data.missao) {
    // missão da reunião: prancheta + nome (cortado com "…"), no lugar dos contadores; ESPERA fica à
    // direita quando sobra lugar pro nome (linhaDaMissao)
    const linha = linhaDaMissao(data.missao, data.waiting, maxW, (s) => ctx.measureText(s).width);
    boardClipboard(ctx, left, cy + 1);
    ctx.fillStyle = palette.navy900;
    ctx.fillText(linha.nome, left + MISSAO_ICON_W, cy);
    if (linha.espera) {
      ctx.fillStyle = palette.signal.waitingInk;
      ctx.textAlign = "right";
      ctx.fillText(linha.espera, left + maxW, cy);
      ctx.textAlign = "left";
    }
    return;
  }
  const base = [com("VISITANTES", "FAZENDO"), com("VISITANTES", "FAZ."), com("VIS.", "FAZ.")].find(cabe) ?? com("VIS.", "FAZ.");
  ctx.fillStyle = palette.gray600;
  ctx.fillText(base, left, cy);
  if (espera) {
    ctx.fillStyle = palette.signal.waitingInk;
    ctx.fillText(espera, left + ctx.measureText(base).width, cy);
  }
}

/** Quadros e estante da parede (estáticos). */
export function drawDecor(ctx: Ctx) {
  drawSeriesPosterCity(ctx, 106, 9);
  drawStudioShelf(ctx, 136, 9, 24, 39);
  drawSeriesPosterFilm(ctx, 410, 9);
  drawStudioPlaque(ctx);
}

/** plaquinha "RHYNOR STUDIO" na parede da ala (px base) */
export const STUDIO_PLAQUE_RECT = { x: 539, y: 9, w: 35, h: 18 } as const;

/** Plaquinha ardósia com cantos em degrau e "RHYNOR / STUDIO" em névoa, pixel bold (bitmap de pixelMarca). */
function drawStudioPlaque(ctx: Ctx) {
  const { x, y, w, h } = STUDIO_PLAQUE_RECT;
  // sombra de 1px na parede, acompanhando o degrau de baixo
  rect(ctx, x + 2, y + h, w - 3, 1, inkAlpha(0.25));
  rect(ctx, x + w, y + 2, 1, h - 3, inkAlpha(0.25));
  // contorno e fundo com 2 degraus em cada canto
  const stepped = (ox: number, oy: number, ow: number, oh: number, color: string) => {
    fill(ctx, ox + 2, oy, ow - 4, oh, color);
    fill(ctx, ox + 1, oy + 1, ow - 2, oh - 2, color);
    fill(ctx, ox, oy + 2, ow, oh - 4, color);
  };
  stepped(x, y, w, h, theme.colors.outline);
  stepped(x + 1, y + 1, w - 2, h - 2, palette.navy700);
  drawBitmap(ctx, STUDIO_PLAQUE, x + 3, y + 3, palette.white);
}

/** Mesa de reunião redonda com um storyboard no centro (desenhada ordenada por y). */
export function drawMeetingTable(ctx: Ctx) {
  const c = theme.colors;
  const cx = px(16);
  const cy = px(11.2);
  oval(ctx, cx, cy + 9, 26, 9, navyAlpha(0.2));
  oval(ctx, cx, cy + 3, 25, 12, c.woodShade);
  oval(ctx, cx, cy, 25, 12, c.woodLight);
  oval(ctx, cx - 4, cy - 3, 17, 7, mix(c.woodLight, palette.white, 0.1));
  drawStoryboard(ctx, cx, cy);
  // caneca clara com café
  rect(ctx, cx - 19, cy - 3, 4, 4, palette.navy950);
  rect(ctx, cx - 18, cy - 2, 2, 2, palette.white);
  rect(ctx, cx - 18, cy - 2, 2, 1, c.woodShade);
  rect(ctx, cx - 15, cy - 2, 1, 2, palette.white);
}

/**
 * Banquinho de madeira clara (px base). (x, y) = pés de quem senta: o assento fica logo abaixo do
 * quadril (y - 3), as pernas vão até y + 3 e a sombra no chão. Ordenar por y + 2.
 */
export function drawStool(ctx: Ctx, x: number, y: number) {
  const F = palette.furniture;
  const ink = palette.navy950;
  rect(ctx, x - 5, y + 2, 11, 2, navyAlpha(0.18)); // sombra
  for (const lx of [x - 4, x + 3]) {
    rect(ctx, lx - 1, y - 1, 3, 5, ink);
    rect(ctx, lx, y - 1, 1, 4, palette.navy800);
  }
  rect(ctx, x - 6, y - 4, 12, 5, ink); // contorno do assento
  rect(ctx, x - 5, y - 3, 10, 3, F.oak);
  rect(ctx, x - 5, y - 3, 10, 1, F.oakLight);
  rect(ctx, x - 5, y - 1, 10, 1, F.oakShade);
}

/** storyboard: 6 quadrinhos em 2 fileiras sobre uma folha clara, com rabiscos de cena e um lápis */
function drawStoryboard(ctx: Ctx, cx: number, cy: number) {
  // folha com contorno escuro (e a espessura embaixo)
  rect(ctx, cx - 11, cy - 7, 22, 13, palette.navy950);
  rect(ctx, cx - 10, cy - 6, 20, 11, palette.white);
  rect(ctx, cx - 10, cy + 4, 20, 1, palette.gray150);
  // 6 quadros 5x3 com uma cena simples cada
  for (let i = 0; i < 6; i++) {
    const qx = cx - 9 + (i % 3) * 6;
    const qy = cy - 5 + Math.floor(i / 3) * 5;
    rect(ctx, qx, qy, 5, 4, palette.gray300);
    rect(ctx, qx + 1, qy + 1, 3, 2, palette.gray100);
    // rabisco: horizonte, personagem ou objeto
    if (i % 3 === 0) rect(ctx, qx + 1, qy + 2, 3, 1, palette.navy600);
    else if (i % 3 === 1) rect(ctx, qx + 2, qy + 1, 1, 2, palette.navy700);
    else rect(ctx, qx + 1, qy + 1, 1, 1, palette.signal.alert);
  }
  // lápis deitado ao lado
  rect(ctx, cx + 6, cy + 6, 6, 1, palette.props.pencil);
  rect(ctx, cx + 12, cy + 6, 1, 1, palette.props.pencilTip);
}

/** Cantinho do café (embaixo, antes da ala de descanso): balcão escuro com tampo claro. */
export function drawCoffeeCorner(ctx: Ctx, t: number, busy: boolean, still = false) {
  const F = palette.furniture;
  const x = px(26.6);
  const y = px(16.1);
  const w = px(5.4);
  rect(ctx, x - 1, y, 1, 30, palette.navy950);
  rect(ctx, x, y, w, 30, palette.navy800);
  rect(ctx, x, y, w, 6, F.oak);
  rect(ctx, x, y, w, 1, F.oakLight);
  rect(ctx, x, y + 6, w, 1, F.oakShade);
  rect(ctx, x, y + 7, w, 1, palette.navy950);
  for (const dx of [28, 57]) rect(ctx, x + dx, y + 10, 1, 18, palette.navy700); // portas
  // cafeteira
  rect(ctx, x + 9, y - 17, 18, 20, palette.navy950);
  rect(ctx, x + 10, y - 16, 16, 18, palette.gray800);
  rect(ctx, x + 12, y - 13, 12, 5, palette.gray700);
  rect(ctx, x + 16, y - 4, 4, 4, palette.white);
  rect(ctx, x + 21, y - 11, 2, 2, busy ? palette.signal.ok : palette.signal.alert);
  // xícaras
  rect(ctx, x + 34, y - 3, 5, 4, palette.white);
  // vapor saindo da xícara branca (à direita de quem está no café), ondulando 1px
  if (busy && !still) {
    const k = Math.floor(t / 250) % 4;
    ctx.fillStyle = comAlfa("rh-nevoa", 0.8);
    for (let j = 0; j < 4; j++) {
      const wave = (j + k) % 2;
      ctx.fillRect(x + 35 + wave, y - 7 - j * 2, 1, 2);
      if (j < 3) ctx.fillRect(x + 37 - wave, y - 8 - j * 2, 1, 2);
    }
  }
  rect(ctx, x + 41, y - 3, 5, 4, palette.navy600);
  // torre de copos pra quem vem tomar café (o bebedouro foi pra ala de descanso)
  rect(ctx, x + 65, y - 10, 6, 11, palette.navy950);
  rect(ctx, x + 66, y - 9, 4, 9, palette.white);
  for (let cy = y - 7; cy < y; cy += 2) rect(ctx, x + 66, cy, 4, 1, palette.gray200);
  rect(ctx, x + 66, y - 9, 4, 1, palette.navy900);
}

/** balcão da recepção (x, y da base e largura); tem arandela própria à noite */
export const RECEPTION = { x: 24, y: 285, w: 60 } as const;

/** luminária de piso (x do poste, y da base) */
export const FLOOR_LAMP: Point = { x: 110, y: 102 };

/** centro da cafeteira (px base), luz quente quando alguém está no café */
export const COFFEE_MACHINE: Point = { x: px(26.6) + 18, y: px(16.1) - 8 };

/** Peça de mobília fixa: `y` é a linha da base, usada na ordenação por profundidade. */
export interface Prop {
  /** o motor desenha diferente (ex.: "pingpong" sem as raquetes e a bolinha no tampo durante o jogo) */
  id?: string;
  y: number;
  /** `t` em ms; `t < 0` significa "parado" (reduced-motion): props `live` devem desenhar o quadro estático */
  draw: (ctx: Ctx, t: number) => void;
  /** muda com o tempo (luz piscando): desenha todo quadro; sem isso o motor guarda pronto (bake.ts) */
  live?: boolean;
}

/**
 * Mobília solta e plantas. Só nas faixas livres: em cima (y 50–118, fora de x 215–290),
 * embaixo (y 258–288, x 20–420) e na ala de descanso (x 518–576, fora do corredor);
 * nada nas lanes x = 40/136/224/312/408/512 nem no corredor.
 */
export const PROPS: Prop[] = [
  // cantos de cima: planta grande no canto esquerdo e no canto da ala de descanso
  { y: 74, draw: (ctx) => drawPlant(ctx, 8, 74, true) },
  { y: 74, draw: (ctx) => drawPlant(ctx, W - 10, 74, true) },
  // ala de descanso: ping-pong (base 8 px abaixo do tampo) e bebedouro embaixo do corredor
  { id: "pingpong", y: PINGPONG.y + PINGPONG.h + 8, draw: (ctx) => drawPingPongTable(ctx, PINGPONG.x, PINGPONG.y, PINGPONG.w, PINGPONG.h) },
  { y: WATER_COOLER.y, draw: (ctx) => drawWaterCooler(ctx, WATER_COOLER.x, WATER_COOLER.y) },
  // cima à esquerda: sofá escuro, mesinha de centro e luminária de piso
  { y: 104, draw: (ctx) => drawSofa(ctx, 24, 104, 48, 2, SOFA_NAVY, { pillow: true }) },
  { y: 100, draw: (ctx) => drawCoffeeTable(ctx, 78, 100) },
  { y: FLOOR_LAMP.y, draw: (ctx) => drawFloorLamp(ctx, FLOOR_LAMP.x, FLOOR_LAMP.y) },
  // cima à direita: multifuncional, arara de figurino e poltrona
  { y: 100, draw: (ctx, t) => drawPrinter(ctx, 300, 100, t), live: true },
  { y: 100, draw: (ctx) => drawCoatRack(ctx, 350, 100) },
  { y: 104, draw: (ctx) => drawSofa(ctx, 440, 104, 30, 1, SOFA_NAVY) },
  // corredor (fora da lane 312)
  { y: 236, draw: (ctx) => drawPlant(ctx, 296, 236) },
  // embaixo: recepção ao lado da porta, sofá de espera e plantas
  { y: 286, draw: (ctx) => drawPlant(ctx, 12, 286) },
  { y: RECEPTION.y, draw: (ctx) => drawReception(ctx, RECEPTION.x, RECEPTION.y, RECEPTION.w) },
  { y: 286, draw: (ctx) => drawPlant(ctx, 98, 286) },
  { y: 285, draw: (ctx) => drawSofa(ctx, 110, 285, 56, 2, SOFA_GRAY, { tall: false }) },
  { y: 286, draw: (ctx) => drawPlant(ctx, 262, 286) },
  // credenza com HDs e estojos (termina em x 395, fora da lane 408)
  { y: 285, draw: (ctx) => drawCredenza(ctx, 330, 285, 66) },
];

/** Mesa de trabalho com computador e plaquinha. `label` é a função na plaquinha (rotuloDaMesa). */
export function drawDesk(
  ctx: Ctx,
  d: Desk,
  opts: { active: boolean; waiting: boolean; label: string; t: number; reducedMotion?: boolean },
) {
  const c = theme.colors;
  const { w, x, top, depth } = deskGeom(d);
  const front = 9;

  const F = palette.furniture;

  // sombra
  rect(ctx, x + 2, top + depth + front - 1, w, 4, navyAlpha(0.16));
  // tampo claro com filete de 2px na frente + painel frontal claro; quem trabalha agora ganha o
  // contorno de 1px em laranja (a luz brasa em volta vem do lightmap)
  rect(ctx, x - 1, top - 1, w + 2, depth + front + 2, opts.active ? palette.signal.active : c.outline);
  rect(ctx, x, top, w, depth, F.oak);
  rect(ctx, x, top, w, 2, F.oakLight);
  rect(ctx, x, top + depth - 2, w, 2, palette.navy800);
  rect(ctx, x, top + depth, w, front, palette.gray50);
  rect(ctx, x, top + depth + front - 2, w, 2, palette.gray200);

  // teclado
  rect(ctx, px(d.cx) - 7, top + depth - 7, 14, 4, palette.gray700);
  rect(ctx, px(d.cx) - 6, top + depth - 6, 12, 2, palette.gray500);

  // monitor (à direita, virado "pra câmera" — licença poética de escritório pixel), moldura escura
  const { x: mx, y: my } = monitorScreen(d);
  rect(ctx, mx - 2, my - 2, 17, 15, c.outline);
  rect(ctx, mx - 1, my - 1, 15, 13, palette.navy800);
  rect(ctx, mx, my, 13, 11, opts.active ? palette.navy950 : opts.waiting ? palette.navy900 : palette.gray800);
  if (opts.active) {
    // linhas de código "rolando"
    const scroll = opts.reducedMotion ? 0 : Math.floor(opts.t / 180); // reduced-motion: quadro fixo
    const colors = [palette.signal.ok, palette.signal.think, palette.props.pencil, palette.signal.alert, palette.gray200];
    for (let i = 0; i < 4; i++) {
      const len = 3 + ((i * 5 + scroll * 3) % 7);
      rect(ctx, mx + 2 + ((i + scroll) % 2) * 2, my + 2 + i * 2, len, 1, colors[(i + scroll) % colors.length]);
    }
  } else if (opts.waiting) {
    // com reduced-motion o "!" fica sempre aceso
    if (opts.reducedMotion || Math.floor(opts.t / 400) % 2 === 0) rect(ctx, mx + 6, my + 2, 2, 5, palette.signal.waiting);
    rect(ctx, mx + 6, my + 8, 2, 1, palette.signal.waiting);
  }
  rect(ctx, mx + 5, my + 12, 3, 2, palette.gray700);
  rect(ctx, mx + 2, my + 13, 9, 2, palette.gray700);

  // caneca e papéis à esquerda
  rect(ctx, x + 4, top + 2, 4, 4, palette.white);
  rect(ctx, x + 10, top + 3, 8, 5, palette.white);
  rect(ctx, x + 11, top + 5, 5, 1, palette.gray300);

  // plaquinha: a função de quem está na mesa (office/deskLabel.ts), ardósia com texto névoa.
  // VT323 a 7px: estreita (2,8 px por letra) e com Ç, Ã e Í de verdade. Rótulo que só cabe muito
  // espremido vira a forma curta ("DESENVOLV. 2").
  ctx.font = PLATE_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const maxW = w - 6;
  const label = rotuloQueCabe(opts.label, maxW, (s) => ctx.measureText(s).width);
  const textW = Math.min(ctx.measureText(label).width, maxW);
  const plate = deskPlateRect(d, textW);
  rect(ctx, plate.x, plate.y, plate.w, plate.h, palette.navy700);
  ctx.fillStyle = palette.white;
  ctx.fillText(label, px(d.cx), plate.y + 4, maxW);
}

/** fonte da plaquinha da mesa */
const PLATE_FONT = "7px VT323, monospace";

/** medidas do tampo de uma mesa (px base): largura, borda esquerda, topo e profundidade */
function deskGeom(d: Desk) {
  const w = px(d.big ? 3.6 : 2.75);
  return { w, x: px(d.cx) - w / 2, top: px(d.cy + 0.55), depth: d.big ? 13 : 11 };
}

/**
 * Plaquinha da mesa (px base, inteiros): 7 px de altura (o til de REVISÃO encosta no topo e a
 * cedilha de DOCUMENTAÇÃO na base), largura do texto + 6 até a largura do tampo - 4. Sem `textW`,
 * o maior tamanho possível (é o que os balões evitam, sem precisar medir o texto).
 */
export function deskPlateRect(d: Desk, textW = Infinity): Rect {
  const { w, top, depth } = deskGeom(d);
  const tw = Math.min(textW + 6, w - 4);
  return { x: Math.round(px(d.cx) - tw / 2), y: top + depth + 1, w: Math.round(tw), h: 7 };
}

/** tampo de uma mesa (px base): o lightmap acende a luz brasa em volta de quem trabalha */
export function deskTopRect(d: Desk): Rect {
  const { w, x, top, depth } = deskGeom(d);
  return { x, y: top, w, h: depth + 9 };
}

/** tela do monitor de uma mesa (px base); o lightmap usa pra luz e brilho */
export function monitorScreen(d: Desk): Rect {
  return { x: px(d.cx) + 8, y: px(d.cy + 0.55) - 12, w: 13, h: 11 };
}

/** Cadeira atrás da mesa (desenhada antes do personagem). */
export function drawChair(ctx: Ctx, d: Desk, color: string) {
  const x = px(d.cx);
  const y = px(d.cy + 0.85);
  // encosto escuro com a faixa na cor do papel
  rect(ctx, x - 6, y - 18, 12, 11, theme.colors.outline);
  rect(ctx, x - 5, y - 17, 10, 9, palette.gray600);
  rect(ctx, x - 5, y - 17, 10, 2, color);
  rect(ctx, x - 4, y - 14, 8, 1, palette.gray500);
}
