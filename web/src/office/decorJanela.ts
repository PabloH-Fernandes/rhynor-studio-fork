// Cenário em pixel art: vista das janelas (céu nublado de dia, cidade à noite com prédios e antena),
// pôsteres de série e estante do estúdio (HDs, claquete, estojos).
// Tudo em coordenadas inteiras da resolução base, sem arc/ellipse/gradiente.

import { inkAlpha, palette } from "../theme";
import { type Ctx, type Rect, fill, mix } from "./decorBase";
import { isReducedMotion } from "./motion";

const P = palette;

/** hash inteiro barato e estável para sortear detalhes fixos do cenário */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// ===================================================================== céu e janelas

export interface SkyColors {
  top: string;
  bottom: string;
}

/** céu de dia (hora 9): padrão quando ninguém passa a luz do momento (lido na hora, dos tokens) */
export function daySky(): SkyColors {
  const key = P.sky.find((s) => s.hour === 9) ?? P.sky[0];
  return { top: key.top, bottom: key.bottom };
}

/** luz do momento vista pela janela (vem de daylight.ts) */
export interface WindowLight {
  sky: SkyColors;
  /** 0 = dia, 1 = noite fechada */
  night: number;
  /** 0..1: amanhecer/entardecer (nuvens rosadas) */
  dusk: number;
  stars: boolean;
}

export const DAY_LIGHT: WindowLight = {
  get sky() {
    return daySky();
  },
  night: 0,
  dusk: 0,
  stars: false,
};

/**
 * mix com memo (t quantizado em 1/32): o cenário das janelas chama isso centenas de vezes
 * por quadro com as mesmas cores, e a força da noite só muda devagar.
 */
const mixMemo = new Map<string, string>();
function mixQ(a: string, b: string, t: number): string {
  const q = Math.max(0, Math.min(32, Math.round(t * 32)));
  if (q === 0) return a;
  if (q === 32) return b;
  const key = `${a}${b}${q}`;
  let v = mixMemo.get(key);
  if (v === undefined) {
    v = mix(a, b, q / 32);
    if (mixMemo.size > 4000) mixMemo.clear();
    mixMemo.set(key, v);
  }
  return v;
}

/** escurece uma cor do cenário de fora em direção à noite */
const shade = (c: string, k: number) => mixQ(c, P.night.shade, k);

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** céu em 5 faixas horizontais (sem gradiente liso) */
export function drawSky(ctx: Ctx, r: Rect, sky: SkyColors) {
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const y0 = Math.floor((i * r.h) / bands);
    const y1 = Math.floor(((i + 1) * r.h) / bands);
    fill(ctx, r.x, r.y + y0, r.w, y1 - y0, mixQ(sky.top, sky.bottom, i / (bands - 1)));
  }
}

/** estrelas de 1px na metade de cima do vidro; algumas piscam (paradas com reduced-motion) */
function drawStars(ctx: Ctx, r: Rect, t: number, light: WindowLight) {
  // aparecem aos poucos conforme escurece
  const k = clamp01((light.night - 0.55) / 0.35);
  const still = isReducedMotion();
  for (let i = 0; i < 7; i++) {
    const h = hash(r.x * 13 + i * 7 + 3);
    const x = r.x + 1 + (h % (r.w - 2));
    const y = r.y + 1 + ((h >>> 8) % Math.max(1, Math.floor(r.h * 0.5)));
    const bright = (h >>> 4) % 3 === 0;
    let a = bright ? 1 : 0.6;
    if (!still) {
      const period = 900 + ((h >>> 16) % 1400);
      if (Math.floor((t + (h % 5000)) / period) % 5 === 0) a *= 0.35; // pisca
    }
    fill(ctx, x, y, 1, 1, mixQ(light.sky.top, P.night.star, a * k));
  }
}

/** lua crescente 5x5 em pixel */
const MOON = [".###.", "###..", "##...", "###..", ".###."];

function drawMoon(ctx: Ctx, x: number, y: number, light: WindowLight) {
  const k = clamp01((light.night - 0.4) / 0.4);
  if (k <= 0) return;
  const c = mixQ(light.sky.top, P.night.moon, k);
  const glow = mixQ(light.sky.top, P.night.moon, k * 0.18);
  // halo de 1px bem fraco em volta
  fill(ctx, x + 1, y - 1, 3, 1, glow);
  fill(ctx, x - 1, y + 1, 1, 3, glow);
  fill(ctx, x + 1, y + 5, 3, 1, glow);
  MOON.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) if (row[dx] === "#") fill(ctx, x + dx, y + dy, 1, 1, c);
  });
}

/**
 * Nuvens em 2 camadas com parallax. As posições estão em coordenadas da parede inteira,
 * então a mesma nuvem atravessa uma janela e depois a seguinte.
 * No amanhecer/entardecer ficam quentes; à noite, escuras.
 */
function drawClouds(ctx: Ctx, r: Rect, t: number, light: WindowLight) {
  const tint = (c: string) => mixQ(mixQ(c, P.decor.cloudDusk, light.dusk * 0.6), P.night.cloud, light.night * 0.85);
  const far = tint(P.decor.cloudFar);
  const body = tint(P.white);
  const under = tint(P.decor.cloudShade);
  const span = 512 + 60;
  // camada do fundo: pequena, lenta, um pouco azulada
  for (let i = 0; i < 6; i++) {
    const h = hash(i + 11);
    const x = Math.floor(((h % span) + t / 900) % span) - 30;
    const y = r.y + 2 + (h % 7);
    fill(ctx, x, y, 9, 2, far);
    fill(ctx, x + 2, y - 1, 4, 1, far);
  }
  // camada da frente: maior, mais rápida, branca com sombra embaixo
  for (let i = 0; i < 5; i++) {
    const h = hash(i + 101);
    const x = Math.floor(((h % span) + t / 380) % span) - 30;
    const y = r.y + 4 + (h % 9);
    fill(ctx, x + 1, y + 3, 15, 1, under);
    fill(ctx, x, y + 1, 17, 2, body);
    fill(ctx, x + 3, y, 9, 1, body);
    fill(ctx, x + 5, y - 1, 5, 1, body);
  }
}

/**
 * Janelinha acesa da cidade à noite: sorteio fixo por posição; 1 em cada 4 é "dinâmica"
 * e sorteia de novo a cada ~20 s (cada uma com sua fase, então trocam poucas por vez).
 */
function cityWindowLit(id: number, t: number, ratio: number): boolean {
  const dynamic = id % 4 === 0;
  // com reduced-motion as janelas não trocam
  const epoch = dynamic && !isReducedMotion() ? Math.floor((t + ((id >>> 8) % 20_000)) / 20_000) : 0;
  return hash(id + epoch * 7919) % 100 < ratio;
}

/** prédios ao fundo, sorteados de forma fixa por `seed`; à noite escurecem e acendem janelas */
function drawSkyline(ctx: Ctx, r: Rect, seed: number, groundY: number, nearLayer: boolean, t: number, light: WindowLight) {
  const n = light.night;
  const haze = 1 - n * 0.6; // à noite a névoa do céu pesa menos e o prédio vira silhueta
  const far = mixQ(mixQ(P.navy500, P.navy850, n), light.sky.bottom, (nearLayer ? 0.55 : 0.68) * haze);
  const near = mixQ(mixQ(P.navy500, P.navy900, n), light.sky.bottom, 0.25 * haze);
  const lit = mixQ(far, P.night.cityWindow, clamp01((n - 0.3) / 0.4));
  const showLit = n > 0.3;
  let x = r.x - 2;
  let i = 0;
  while (x < r.x + r.w) {
    const h = hash(seed * 31 + i);
    const w = 5 + (h % 5);
    const bh = 5 + ((h >>> 4) % 9);
    fill(ctx, x, groundY - bh, w, bh, far);
    // uma ou outra luz acesa nos prédios do fundo
    if (showLit && (h >>> 12) % 3 === 0 && bh > 3) {
      fill(ctx, x + 1 + ((h >>> 14) % (w - 2)), groundY - bh + 1 + ((h >>> 18) % (bh - 2)), 1, 1, lit);
    }
    x += w + ((h >>> 8) % 2);
    i++;
  }
  x = r.x + ((seed * 7) % 6) - 4;
  i = 0;
  while (x < r.x + r.w) {
    const h = hash(seed * 53 + i + 7);
    const w = 6 + (h % 4);
    const bh = 3 + ((h >>> 5) % 7);
    if (nearLayer && (h >>> 9) % 3 !== 0) {
      fill(ctx, x, groundY - bh, w, bh, near);
      // janelinhas: claras de dia, algumas acesas (amarelas) à noite
      for (let wy = groundY - bh + 1; wy < groundY - 1; wy += 2) {
        for (let wx = x + 1; wx < x + w - 1; wx += 2) {
          const on = showLit && cityWindowLit(hash(seed * 977 + wx * 131 + wy * 17), t, 34);
          fill(ctx, wx, wy, 1, 1, on ? lit : shade(far, n * 0.3));
        }
      }
    }
    x += w + 3;
    i++;
  }
}

/** calçada da rua lá embaixo: duas faixas de 1px */
function drawGround(ctx: Ctx, r: Rect, n: number) {
  const gy = r.y + r.h - 2;
  fill(ctx, r.x, gy, r.w, 1, shade(P.gray400, n * 0.75));
  fill(ctx, r.x, gy + 1, r.w, 1, shade(P.gray500, n * 0.75));
}

// ---------------------------------------------------------------- prédios altos da cidade

/**
 * Prédio alto da frente: corpo em ardósia, coroa em degrau e grade de janelas de 1px.
 * À noite escurece e uma parte das janelas acende (com troca lenta, como na skyline).
 */
function drawTower(ctx: Ctx, r: Rect, x: number, w: number, h: number, seed: number, t: number, n: number) {
  const base = r.y + r.h - 2;
  const top = base - h;
  const body = shade(mixQ(P.navy700, P.gray500, 0.35), n * 0.55);
  const edge = shade(P.navy800, n * 0.4);
  const lit = P.night.cityWindow;
  fill(ctx, x, top, w, h, body);
  fill(ctx, x, top, 1, h, edge);
  // coroa em degrau
  fill(ctx, x + 1, top - 1, w - 2, 1, body);
  fill(ctx, x + 2, top - 2, Math.max(1, w - 4), 1, edge);
  for (let wy = top + 2; wy < base - 1; wy += 2) {
    for (let wx = x + 2; wx < x + w - 1; wx += 2) {
      const on = n > 0.3 && cityWindowLit(hash(seed * 389 + wx * 97 + wy * 13), t, 40);
      fill(ctx, wx, wy, 1, 1, on ? lit : shade(mixQ(body, P.white, 0.25), n * 0.6));
    }
  }
}

/** antena no topo de um prédio, com a luz de aviso piscando à noite (parada com reduced-motion) */
function drawAntenna(ctx: Ctx, x: number, y: number, t: number, n: number) {
  fill(ctx, x, y, 1, 5, shade(P.gray400, n * 0.5));
  fill(ctx, x - 1, y + 3, 3, 1, shade(P.gray500, n * 0.5));
  const on = isReducedMotion() || Math.floor(t / 900) % 2 === 0;
  fill(ctx, x, y - 1, 1, 1, on && n > 0.2 ? P.signal.alert : P.decor.craneLightOff);
}

export type WindowView = {
  kind: "cidade";
  /** sorteio fixo dos prédios desta janela */
  seed: number;
  /** x (no vidro) da torre alta com antena, se houver */
  antena?: number;
  /** posição da lua no vidro (só uma janela tem lua) */
  moon?: { x: number; y: number };
};

/** conteúdo do vidro (já recortado pelo chamador): céu, estrelas, lua, nuvens e a cidade à noite */
export function drawWindowView(ctx: Ctx, glass: Rect, view: WindowView, t: number, light: WindowLight = DAY_LIGHT) {
  const n = light.night;
  drawSky(ctx, glass, light.sky);
  if (light.stars) drawStars(ctx, glass, t, light);
  if (view.moon) drawMoon(ctx, glass.x + view.moon.x, glass.y + view.moon.y, light);
  drawClouds(ctx, glass, t, light);
  drawSkyline(ctx, glass, glass.x + view.seed, glass.y + glass.h - 2, true, t, light);
  if (view.antena !== undefined) {
    const tx = glass.x + view.antena;
    const th = Math.floor(glass.h * 0.62);
    drawTower(ctx, glass, tx, 9, th, view.seed + 1, t, n);
    drawAntenna(ctx, tx + 4, glass.y + glass.h - 2 - th - 7, t, n);
  } else {
    const h = hash(view.seed * 17 + 5);
    drawTower(ctx, glass, glass.x + 3 + (h % 6), 8, Math.floor(glass.h * 0.45), view.seed + 2, t, n);
    drawTower(ctx, glass, glass.x + glass.w - 13 + ((h >>> 5) % 4), 9, Math.floor(glass.h * 0.55), view.seed + 3, t, n);
  }
  drawGround(ctx, glass, n);
}

// ===================================================================== pôsteres e estante

/** moldura escura com passe-partout claro e sombra de 1px; devolve a área da pintura */
function frame(ctx: Ctx, x: number, y: number, w: number, h: number): Rect {
  ctx.fillStyle = inkAlpha(0.18);
  ctx.fillRect(x + 1, y + h, w, 1);
  ctx.fillRect(x + w, y + 1, 1, h);
  fill(ctx, x, y, w, h, P.navy950);
  fill(ctx, x + 1, y + 1, w - 2, h - 2, P.navy800);
  return { x: x + 2, y: y + 2, w: w - 4, h: h - 4 };
}

/** pôster 24x18 de uma série: lua grande sobre a cidade, título em barras e a faixa de "temporada" */
export function drawSeriesPosterCity(ctx: Ctx, x: number, y: number) {
  const a = frame(ctx, x, y, 24, 18);
  fill(ctx, a.x, a.y, a.w, a.h, P.navy700);
  // lua
  fill(ctx, a.x + 12, a.y + 2, 5, 1, P.gray200);
  fill(ctx, a.x + 11, a.y + 3, 7, 3, P.gray200);
  fill(ctx, a.x + 12, a.y + 6, 5, 1, P.gray200);
  // silhueta de prédios
  const tops = [5, 3, 6, 2, 4, 6, 3, 5, 2, 4];
  tops.forEach((dt, i) => fill(ctx, a.x + i * 2, a.y + 5 + dt, 2, a.h - 9 - dt, P.navy950));
  // título e subtítulo
  fill(ctx, a.x + 2, a.y + a.h - 3, 12, 1, P.white);
  fill(ctx, a.x + 2, a.y + a.h - 1, 7, 1, P.gray300);
  fill(ctx, a.x + a.w - 5, a.y + a.h - 3, 3, 3, P.signal.alert);
}

/** pôster 24x18 de outra série: tira de filme com 3 quadros e o título em barras */
export function drawSeriesPosterFilm(ctx: Ctx, x: number, y: number) {
  const a = frame(ctx, x, y, 24, 18);
  fill(ctx, a.x, a.y, a.w, a.h, P.navy950);
  // furinhos da película em cima e embaixo
  for (let i = 1; i < a.w; i += 3) {
    fill(ctx, a.x + i, a.y + 1, 1, 1, P.gray400);
    fill(ctx, a.x + i, a.y + 10, 1, 1, P.gray400);
  }
  // 3 quadros: céu, retrato, paisagem
  const quadros = [P.decor.paintingSky, P.gray100, P.furniture.leaf];
  quadros.forEach((c, i) => fill(ctx, a.x + 1 + i * 7, a.y + 3, 6, 6, c));
  fill(ctx, a.x + 10, a.y + 4, 2, 2, P.navy700); // cabeça do retrato
  fill(ctx, a.x + 9, a.y + 6, 4, 3, P.navy700); // ombros
  // título
  fill(ctx, a.x + 2, a.y + 12, 16, 1, P.white);
  fill(ctx, a.x + 2, a.y + 14, 10, 1, P.gray300);
}

/** estante estreita do estúdio: HDs com LED, claquete e estojos de mídia */
export function drawStudioShelf(ctx: Ctx, x: number, y: number, w: number, h: number, t = 0) {
  // corpo
  fill(ctx, x, y, w, h, P.navy950);
  fill(ctx, x + 1, y + 1, w - 2, h - 2, P.navy800);
  const innerX = x + 2;
  const innerW = w - 4;
  const shelfH = Math.floor((h - 4) / 3);
  const cell = (i: number) => ({ y: y + 2 + i * (shelfH + 1), h: shelfH });
  for (let i = 0; i < 3; i++) {
    const c = cell(i);
    fill(ctx, innerX, c.y, innerW, c.h, P.navy900);
    fill(ctx, innerX, c.y + c.h, innerW, 1, P.navy700); // prateleira
  }

  // prateleira 1: HDs empilhados, cada um com o LED (um pisca lento; parado com reduced-motion)
  {
    const c = cell(0);
    const blink = isReducedMotion() || Math.floor(t / 700) % 2 === 0;
    for (let i = 0; i < 3; i++) {
      const hy = c.y + c.h - 3 - i * 3;
      fill(ctx, innerX + 1, hy, innerW - 2, 2, i % 2 ? P.gray600 : P.gray500);
      fill(ctx, innerX + innerW - 3, hy, 1, 1, i === 1 && !blink ? P.gray700 : P.signal.ok);
    }
  }

  // prateleira 2: claquete (corpo escuro, régua listrada levantada)
  {
    const c = cell(1);
    const bx = innerX + 3;
    const by = c.y + c.h - 6;
    fill(ctx, bx, by, 12, 6, P.navy950);
    fill(ctx, bx + 1, by + 2, 10, 1, P.gray300); // linhas do quadro
    fill(ctx, bx + 1, by + 4, 6, 1, P.gray300);
    // régua aberta, inclinada em degraus
    for (let i = 0; i < 12; i++) {
      const ry = by - 2 - Math.floor(i / 4);
      fill(ctx, bx + i, ry, 1, 2, Math.floor(i / 2) % 2 ? P.white : P.navy950);
    }
  }

  // prateleira 3: estojos de mídia em pé (lombadas em tons de aço e ardósia)
  {
    const c = cell(2);
    const cores = [P.gray300, P.navy600, P.gray400, P.navy500, P.gray200];
    const tops = [2, 0, 3, 1, 2];
    cores.forEach((col, i) => {
      const rx = innerX + i * 4;
      fill(ctx, rx, c.y + tops[i], 3, c.h - tops[i], col);
      fill(ctx, rx + 1, c.y + tops[i] + 2, 1, 2, P.navy900);
    });
  }
}
