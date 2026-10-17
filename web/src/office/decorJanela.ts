// Cenário em pixel art: vista das janelas (céu, nuvens, guindaste, prédio em obra),
// quadros (ponte, torre de transmissão), estante com rolos de projeto e a logo da placa em pixels duros.
// Tudo em coordenadas inteiras da resolução base, sem arc/ellipse/gradiente.

import { navyAlpha, palette } from "../theme";
import { type Ctx, type Rect, fill, hexToRgb, line, mix } from "./decorBase";
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

/** céu de dia (hora 9): padrão quando ninguém passa a luz do momento */
export const DAY_SKY: SkyColors = (() => {
  const key = P.sky.find((s) => s.hour === 9) ?? P.sky[0];
  return { top: key.top, bottom: key.bottom };
})();

/** luz do momento vista pela janela (vem de daylight.ts) */
export interface WindowLight {
  sky: SkyColors;
  /** 0 = dia, 1 = noite fechada */
  night: number;
  /** 0..1: amanhecer/entardecer (nuvens rosadas) */
  dusk: number;
  stars: boolean;
}

export const DAY_LIGHT: WindowLight = { sky: DAY_SKY, night: 0, dusk: 0, stars: false };

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

/** escurece uma cor do cenário de fora em direção ao marinho da noite */
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
 * No amanhecer/entardecer ficam rosadas; à noite, azuladas e escuras.
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

/** chão do canteiro: faixa de terra/concreto e, opcionalmente, tapume branco com faixa marinho */
function drawGround(ctx: Ctx, r: Rect, tapume: boolean, n: number) {
  const gy = r.y + r.h - 2;
  fill(ctx, r.x, gy, r.w, 1, shade(P.gray300, n * 0.75));
  fill(ctx, r.x, gy + 1, r.w, 1, shade(P.gray400, n * 0.75));
  if (tapume) {
    fill(ctx, r.x, gy - 3, r.w, 3, shade(P.gray50, n * 0.7));
    fill(ctx, r.x, gy - 1, r.w, 1, P.navy900);
    for (let x = r.x + 3; x < r.x + r.w; x += 7) fill(ctx, x, gy - 3, 1, 2, shade(P.gray200, n * 0.7));
  }
}

// ---------------------------------------------------------------- guindaste

/**
 * Guindaste de torre: torre treliçada, lança que "gira" (o comprimento visível encolhe
 * pelo cosseno, ciclo de ~20 s), carrinho com gancho e carga subindo e descendo,
 * e a luz vermelha piscando no topo (com halo à noite).
 */
function drawCrane(ctx: Ctx, r: Rect, mastX: number, t: number, phase: number, n: number) {
  // à noite vira silhueta escura contra a base clara do céu
  const steel = mixQ(P.navy700, P.navy950, n * 0.75);
  const steelDark = mixQ(P.navy800, P.navy950, n * 0.75);
  const groundY = r.y + r.h - 2;
  const mastTop = r.y + 9;
  const cx = mastX + 1; // eixo da torre

  // base de concreto
  fill(ctx, mastX - 2, groundY - 2, 7, 2, shade(P.gray500, n * 0.6));
  // torre treliçada (3px: dois montantes + travessas alternadas)
  fill(ctx, mastX, mastTop, 1, groundY - 2 - mastTop, steel);
  fill(ctx, mastX + 2, mastTop, 1, groundY - 2 - mastTop, steel);
  for (let y = mastTop + 1; y < groundY - 2; y += 2) fill(ctx, mastX + 1, y, 1, 1, steelDark);

  // giro: comprimento visível = L * cos(θ)
  const theta = (t / 20_000) * Math.PI * 2 + phase;
  const c = Math.cos(theta);
  const jibY = mastTop - 1;
  const jibEnd = cx + Math.round(17 * c);
  const counterEnd = cx - Math.round(7 * c);

  // contra-lança com contrapeso
  line(ctx, cx, jibY, counterEnd, jibY, steel);
  fill(ctx, counterEnd - 1, jibY + 1, 3, 2, shade(P.gray600, n * 0.6));
  // lança (1px cheia + treliça pontilhada embaixo)
  line(ctx, cx, jibY, jibEnd, jibY, steel);
  const dir = jibEnd >= cx ? 1 : -1;
  for (let x = cx; x !== jibEnd; x += dir) if ((x - cx) % 2 === 0) fill(ctx, x, jibY + 1, 1, 1, steelDark);
  // torre do topo (pico) e tirantes
  const apexY = mastTop - 5;
  fill(ctx, cx, apexY, 1, jibY - apexY, steel);
  line(ctx, cx, apexY, cx + Math.round(11 * c), jibY, steelDark);
  line(ctx, cx, apexY, counterEnd, jibY, steelDark);
  // cabine do operador (à noite com a janelinha acesa)
  fill(ctx, mastX - 1, mastTop, 4, 3, shade(P.gray50, n * 0.7));
  fill(ctx, mastX + (c >= 0 ? 2 : -1), mastTop + 1, 1, 1, n > 0.5 ? P.night.cityWindow : P.navy600);

  // carrinho + cabo + gancho com carga
  const along = 0.55 + 0.3 * Math.sin(t / 7_000 + phase);
  const tx = cx + Math.round(17 * c * along);
  const lift = (1 - Math.cos((t / 11_000) * Math.PI * 2 + phase)) / 2; // 0 em cima, 1 embaixo
  const hookY = jibY + 3 + Math.round(lift * (groundY - 7 - (jibY + 3)));
  fill(ctx, tx - 1, jibY + 1, 3, 1, shade(P.gray600, n * 0.6));
  fill(ctx, tx, jibY + 2, 1, hookY - (jibY + 2), shade(P.gray800, n * 0.4));
  fill(ctx, tx - 2, hookY, 5, 2, shade(P.gray400, n * 0.6)); // feixe de vigas
  fill(ctx, tx - 2, hookY + 1, 5, 1, shade(P.gray500, n * 0.6));
  // à noite, refletor de trabalho aceso no carrinho
  if (n > 0.5) fill(ctx, tx, jibY + 1, 1, 1, P.night.cityWindow);

  // luz de sinalização no topo (vermelha, pisca); à noite ganha um halo em cruz
  // com reduced-motion fica acesa, sem piscar
  const on = isReducedMotion() || Math.floor((t + phase * 1000) / 650) % 2 === 0;
  if (on && n > 0.3) {
    ctx.fillStyle = `rgba(255, 77, 77, ${(0.5 * n).toFixed(2)})`;
    ctx.fillRect(cx - 1, apexY - 1, 1, 1);
    ctx.fillRect(cx + 1, apexY - 1, 1, 1);
    ctx.fillRect(cx, apexY - 2, 1, 1);
    ctx.fillRect(cx, apexY, 1, 1);
  }
  fill(ctx, cx, apexY - 1, 1, 1, on ? P.signal.craneLight : P.decor.craneLightOff);
}

// ---------------------------------------------------------------- prédio em obra

/**
 * Prédio em obra: andares prontos embaixo, tela de proteção no meio e só
 * pilares com ferragem em cima. `variant` muda proporção e detalhes.
 * À noite o concreto escurece e algumas janelas dos andares prontos acendem.
 */
function drawConstruction(ctx: Ctx, r: Rect, variant: 0 | 1, t: number, n: number) {
  const k = n * 0.65;
  const concrete = shade(P.gray300, k);
  const concreteShade = shade(P.gray500, k);
  const rebar = shade(P.gray600, k);
  const groundY = r.y + r.h - 5; // em cima do tapume
  const floorH = variant === 0 ? 5 : 4;
  const floors = variant === 0 ? 4 : 5;
  const bw = variant === 0 ? 24 : 17;
  const bx = variant === 0 ? r.x + 5 : r.x + 17;
  const pillarStep = variant === 0 ? 7 : 8;
  const top = groundY - floors * floorH;
  const winDark = shade(P.navy500, n * 0.6);

  for (let f = 0; f < floors; f++) {
    const fy = groundY - (f + 1) * floorH; // laje do andar f (em cima)
    const done = f < 2;
    const screened = !done && f < floors - 1;
    if (done) {
      // fechado: alvenaria clara com janelas
      fill(ctx, bx, fy + 1, bw, floorH - 1, shade(P.gray150, k));
      for (let wx = bx + 2; wx < bx + bw - 2; wx += 4) {
        const on = n > 0.5 && cityWindowLit(hash(r.x * 71 + wx * 13 + f * 5), t, 40);
        fill(ctx, wx, fy + 2, 2, floorH - 3, on ? P.night.cityWindow : winDark);
      }
    }
    // pilares
    for (let px = bx; px <= bx + bw - 1; px += pillarStep) fill(ctx, px, fy + 1, 1, floorH - 1, concreteShade);
    fill(ctx, bx + bw - 1, fy + 1, 1, floorH - 1, concreteShade);
    if (screened) {
      // tela de proteção marinho translúcida com trama de 2px
      ctx.fillStyle = navyAlpha(0.6);
      ctx.fillRect(bx, fy + 1, bw, floorH - 1);
      const weave = `rgba(255,255,255,${(0.25 * (1 - n * 0.6)).toFixed(2)})`;
      for (let sx = bx + (f % 2); sx < bx + bw; sx += 2) fill(ctx, sx, fy + 1 + (sx % 2), 1, 1, weave);
    }
    // laje
    const slabW = f === floors - 1 ? Math.ceil(bw * (variant === 0 ? 0.6 : 0.7)) : bw;
    const slabX = variant === 0 ? bx : bx + bw - slabW;
    fill(ctx, slabX - 1, fy, slabW + 2, 1, concrete);
    fill(ctx, slabX, fy + 1, slabW, 1, concreteShade);
  }
  // ferragem saindo dos pilares do último andar
  for (let px = bx; px <= bx + bw - 1; px += pillarStep) fill(ctx, px, top - 2, 1, 2, rebar);
  fill(ctx, bx + bw - 1, top - 2, 1, 2, rebar);

  if (variant === 0) {
    // elevador de obra (cremalheira) do lado direito, subindo e descendo
    const mx = bx + bw + 3;
    fill(ctx, mx, top - 1, 1, groundY - top + 1, rebar);
    for (let y = top; y < groundY; y += 3) fill(ctx, mx - 1, y, 1, 1, concreteShade);
    const kk = (1 - Math.cos((t / 9_000) * Math.PI * 2)) / 2;
    const cy = top + Math.round(kk * (groundY - top - 4));
    fill(ctx, mx + 1, cy, 3, 3, shade(P.gray50, k));
    fill(ctx, mx + 2, cy + 1, 1, 1, n > 0.5 ? P.night.cityWindow : P.navy600);
  } else {
    // andaime treliçado do lado esquerdo
    const sx = bx - 4;
    const scaffold = shade(P.gray400, k);
    for (let y = top; y < groundY; y += floorH) {
      fill(ctx, sx, y, 3, 1, concreteShade);
      line(ctx, sx, y + 1, sx + 2, y + floorH - 1, scaffold);
    }
    fill(ctx, sx, top, 1, groundY - top, concreteShade);
    fill(ctx, sx + 2, top, 1, groundY - top, concreteShade);
    // bandeirinha marinho no topo
    fill(ctx, bx + bw - 1, top - 6, 1, 4, rebar);
    fill(ctx, bx + bw, top - 6, 3, 2, P.navy900);
  }
}

// ---------------------------------------------------------------- vistas

export type WindowView = ({ kind: "crane"; mast: number; phase: number } | { kind: "construction"; variant: 0 | 1 }) & {
  /** posição da lua no vidro (só uma janela tem lua) */
  moon?: { x: number; y: number };
};

/** conteúdo do vidro (já recortado pelo chamador): céu, estrelas, lua, nuvens, cidade e a obra */
export function drawWindowView(ctx: Ctx, glass: Rect, view: WindowView, t: number, light: WindowLight = DAY_LIGHT) {
  const n = light.night;
  drawSky(ctx, glass, light.sky);
  if (light.stars) drawStars(ctx, glass, t, light);
  if (view.moon) drawMoon(ctx, glass.x + view.moon.x, glass.y + view.moon.y, light);
  drawClouds(ctx, glass, t, light);
  const site = view.kind === "construction";
  drawSkyline(ctx, glass, glass.x, glass.y + glass.h - (site ? 5 : 2), !site, t, light);
  drawGround(ctx, glass, site, n);
  if (view.kind === "crane") drawCrane(ctx, glass, glass.x + view.mast, t, view.phase, n);
  else drawConstruction(ctx, glass, view.variant, t, n);
}

// ===================================================================== quadros e estante

/** moldura marinho com passe-partout branco e sombra de 1px; devolve a área da pintura */
function frame(ctx: Ctx, x: number, y: number, w: number, h: number): Rect {
  ctx.fillStyle = "rgba(2, 11, 28, 0.18)";
  ctx.fillRect(x + 1, y + h, w, 1);
  ctx.fillRect(x + w, y + 1, 1, h);
  fill(ctx, x, y, w, h, P.navy900);
  fill(ctx, x + 1, y + 1, w - 2, h - 2, P.gray50);
  return { x: x + 2, y: y + 2, w: w - 4, h: h - 4 };
}

/** quadro 24x18 com uma ponte estilizada em arco sobre a água */
export function drawBridgePainting(ctx: Ctx, x: number, y: number) {
  const a = frame(ctx, x, y, 24, 18);
  // céu claro em 2 tons + água
  fill(ctx, a.x, a.y, a.w, 5, P.decor.paintingSky);
  fill(ctx, a.x, a.y + 5, a.w, a.h - 9, P.decor.paintingHaze);
  const waterY = a.y + a.h - 4;
  fill(ctx, a.x, waterY, a.w, 4, P.navy600);
  fill(ctx, a.x + 2, waterY + 1, 3, 1, P.navy500);
  fill(ctx, a.x + 11, waterY + 2, 4, 1, P.navy500);
  // tabuleiro
  const deckY = waterY - 3;
  fill(ctx, a.x, deckY, a.w, 1, P.navy900);
  fill(ctx, a.x, deckY + 1, a.w, 1, P.gray500);
  // pilares nas pontas até a água
  fill(ctx, a.x + 1, deckY + 2, 2, waterY - deckY - 2, P.gray500);
  fill(ctx, a.x + a.w - 3, deckY + 2, 2, waterY - deckY - 2, P.gray500);
  // arco parabólico em cima do tabuleiro, com pendurais
  const x0 = a.x + 1;
  const x1 = a.x + a.w - 2;
  const mid = (x0 + x1) / 2;
  const half = (x1 - x0) / 2;
  const rise = 7;
  let prev = deckY;
  for (let i = x0; i <= x1; i++) {
    const u = (i - mid) / half;
    const ay = deckY - Math.round(rise * (1 - u * u));
    // fecha buracos entre colunas vizinhas
    fill(ctx, i, Math.min(ay, prev), 1, Math.abs(ay - prev) + 1, P.navy900);
    if ((i - x0) % 3 === 0 && ay < deckY - 1) fill(ctx, i, ay + 1, 1, deckY - ay - 1, P.navy500);
    prev = ay;
  }
}

/** quadro 24x18 com uma torre de transmissão estilizada num morro, cabos indo para os lados */
export function drawTowerPainting(ctx: Ctx, x: number, y: number) {
  const a = frame(ctx, x, y, 24, 18);
  fill(ctx, a.x, a.y, a.w, 5, P.decor.paintingSky);
  fill(ctx, a.x, a.y + 5, a.w, a.h - 5, P.decor.paintingHaze);
  fill(ctx, a.x + 2, a.y + 3, 5, 1, P.white); // nuvem
  fill(ctx, a.x + 3, a.y + 2, 2, 1, P.white);
  // morro em degraus
  const base = a.y + a.h - 2;
  for (let i = 0; i < a.w; i++) {
    const d = Math.abs(i - a.w / 2 + 0.5);
    const hill = Math.max(0, 2 - Math.floor(d / 4));
    fill(ctx, a.x + i, base - hill, 1, hill + 2, i < a.w / 2 ? P.gray300 : P.gray400);
  }
  // torre: pernas abrindo pra baixo, travessas, pico com 2 braços
  const cx = a.x + Math.floor(a.w / 2);
  const top = a.y + 1;
  const foot = base - 1;
  const steel = P.navy900;
  line(ctx, cx - 1, top + 3, cx - 4, foot, steel);
  line(ctx, cx, top + 3, cx + 3, foot, steel);
  for (let yy = top + 5; yy < foot - 1; yy += 3) {
    const spread = Math.round(((yy - top - 3) / (foot - top - 3)) * 3);
    fill(ctx, cx - 1 - spread, yy, 2 + spread * 2, 1, P.navy600);
  }
  fill(ctx, cx - 1, top, 2, 3, steel); // pico
  fill(ctx, cx - 6, top + 1, 12, 1, steel); // braço de cima
  fill(ctx, cx - 4, top + 4, 8, 1, steel); // braço de baixo
  // isoladores + cabos com catenária
  for (const [ix, iy] of [
    [cx - 6, top + 2],
    [cx + 5, top + 2],
    [cx - 4, top + 5],
    [cx + 3, top + 5],
  ]) fill(ctx, ix, iy, 1, 1, P.gray500);
  const wire = P.gray500;
  line(ctx, a.x, top + 5, cx - 7, top + 3, wire);
  line(ctx, cx + 6, top + 3, a.x + a.w - 1, top + 5, wire);
}

/** estante estreita com fichários, rolos de projeto deitados e rolos em pé num cesto */
export function drawRollShelf(ctx: Ctx, x: number, y: number, w: number, h: number) {
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

  // prateleira 1: fichários em pé (lombadas com etiqueta)
  {
    const c = cell(0);
    const colors = [P.gray50, P.navy600, P.gray200, P.navy500, P.gray50];
    let bx = innerX;
    colors.forEach((col, i) => {
      const bh = c.h - 1 - (i % 2);
      fill(ctx, bx, c.y + c.h - bh, 3, bh, col);
      fill(ctx, bx + 1, c.y + c.h - bh + 2, 1, 2, col === P.gray50 || col === P.gray200 ? P.navy600 : P.white);
      bx += 4;
    });
  }

  // prateleira 2: rolos deitados vistos de frente (pirâmide), papel branco e cópia azul
  {
    const c = cell(1);
    const roll = (rx: number, ry: number, blue: boolean) => {
      const body = blue ? P.decor.blueprint : P.white;
      fill(ctx, rx + 1, ry, 2, 1, body);
      fill(ctx, rx, ry + 1, 4, 2, body);
      fill(ctx, rx + 1, ry + 3, 2, 1, body);
      fill(ctx, rx + 1, ry + 1, 2, 2, blue ? P.navy500 : P.gray300); // tubo oco
    };
    const by = c.y + c.h - 4;
    for (let i = 0; i < 4; i++) roll(innerX + i * 5, by, i % 2 === 1);
    for (let i = 0; i < 3; i++) roll(innerX + 2 + i * 5, by - 3, i === 1);
  }

  // prateleira 3: cesto com rolos em pé (com elástico)
  {
    const c = cell(2);
    const tops = [3, 1, 4, 0, 2];
    tops.forEach((dt, i) => {
      const rx = innerX + 1 + i * 4;
      const col = i % 2 ? P.decor.blueprint : P.gray50;
      fill(ctx, rx, c.y + dt, 3, c.h - dt, col);
      fill(ctx, rx, c.y + dt + 2, 3, 1, i % 2 ? P.navy600 : P.gray400);
    });
    fill(ctx, innerX + 1, c.y + c.h - 4, innerW - 2, 4, P.gray600); // cesto
    fill(ctx, innerX + 1, c.y + c.h - 4, innerW - 2, 1, P.gray500);
  }
}

// ===================================================================== logo em pixels duros

/** só estes dois tons saem do bake */
const LOGO_DARK = hexToRgb(P.navy900);
const LOGO_LIGHT: [number, number, number] = [255, 255, 255];

export interface LogoCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Reduz a logo para (wBase*k) x (hBase*k) pixels de dispositivo: corta pela metade em passos
 * (com suavização de alta qualidade, pra não perder traço fino) até perto do tamanho final e
 * aplica um limiar de luminância, então cada pixel vira só marinho (#051733) ou branco.
 */
export function bakeLogo(img: HTMLImageElement, wBase: number, hBase: number, k: number, crop?: LogoCrop): HTMLCanvasElement {
  const tw = Math.max(1, Math.round(wBase * k));
  const th = Math.max(1, Math.round(hBase * k));
  let src: CanvasImageSource = img;
  let sx = crop?.sx ?? 0;
  let sy = crop?.sy ?? 0;
  let sw = crop?.sw ?? img.naturalWidth;
  let sh = crop?.sh ?? img.naturalHeight;

  const make = (w: number, h: number) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) throw new Error("canvas 2d indisponível");
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    return { c, g };
  };

  while (sw / 2 >= tw && sh / 2 >= th) {
    const { c, g } = make(Math.ceil(sw / 2), Math.ceil(sh / 2));
    g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    src = c;
    sx = 0;
    sy = 0;
    sw = c.width;
    sh = c.height;
  }
  const { c: out, g } = make(tw, th);
  g.drawImage(src, sx, sy, sw, sh, 0, 0, tw, th);

  // em k=1 o traço fino da logo fica abaixo do meio-termo: limiar mais baixo pra não sumir
  const threshold = k <= 1 ? 110 : 128;
  const data = g.getImageData(0, 0, tw, th);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    // pixel transparente conta como fundo
    const a = d[i + 3] / 255;
    const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * a + 23 * (1 - a);
    const [r, gg, b] = lum >= threshold ? LOGO_LIGHT : LOGO_DARK;
    d[i] = r;
    d[i + 1] = gg;
    d[i + 2] = b;
    d[i + 3] = 255;
  }
  g.putImageData(data, 0, 0);
  return out;
}
