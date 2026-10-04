// Iluminação pela hora real: céu, cor ambiente e quanto "é noite".
// O Lightmap (fim do arquivo) escurece a cena com a cor ambiente e soma as luzes do escritório.
// Tudo sai de chaves por hora interpoladas linearmente (0..24, a última repete a primeira).
// `?hora=HH` (ou HH.MM / HH:MM) na URL força a hora — útil pra testes e prints.
// Atenção: o formato é HH.MM (hora.minuto), não decimal: `?hora=7.5` é 7:05 e `?hora=7.30` é 7:30.

import { palette } from "../theme";
import { disc, hexToRgb, mix, type Rect, type WindowLight } from "./decor";
import { AISLE_Y, BOARD, COFFEE_MACHINE, DESKS, FLOOR_LAMP, H, PINGPONG, POCKET_PLAQUE, RECEPTION, WATER_COOLER, SIGN_LAMP_X, TILE, W, WINDOW_PANES } from "./map";

export type RGB = [number, number, number];

export interface Daylight {
  /** hora fracionada usada (0..24) */
  hour: number;
  skyTop: string;
  skyBottom: string;
  /** cor que multiplica a cena (255,255,255 = sem efeito) */
  ambient: RGB;
  /** 0 = dia, 1 = noite fechada; multiplica a força das luzes */
  night: number;
  /** 0..1: quanto o céu está "quente" (amanhecer/entardecer); tinge as nuvens */
  dusk: number;
  /** luminárias de teto acesas */
  lightsOn: boolean;
  stars: boolean;
}

interface Key<T> {
  hour: number;
  v: T;
}

/** valor interpolado entre as duas chaves em volta de `hour` (chaves em ordem crescente) */
function sample<T>(keys: readonly Key<T>[], hour: number, lerp: (a: T, b: T, t: number) => T): T {
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (hour >= a.hour && hour <= b.hour) {
      const span = b.hour - a.hour;
      return lerp(a.v, b.v, span > 0 ? (hour - a.hour) / span : 0);
    }
  }
  return keys[keys.length - 1].v;
}

const lerpNum = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRgb = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(lerpNum(a[0], b[0], t)),
  Math.round(lerpNum(a[1], b[1], t)),
  Math.round(lerpNum(a[2], b[2], t)),
];

/** piso da noite: os personagens continuam visíveis mesmo sem luz nenhuma */
const NIGHT_AMBIENT: RGB = [62, 72, 118];
const DAY_AMBIENT: RGB = [255, 255, 255];

const AMBIENT: Key<RGB>[] = [
  { hour: 0, v: NIGHT_AMBIENT },
  { hour: 5, v: NIGHT_AMBIENT },
  { hour: 6, v: [150, 120, 140] }, // amanhecer: rosado e ainda escuro
  { hour: 7, v: [235, 210, 195] },
  { hour: 8.5, v: DAY_AMBIENT },
  { hour: 16.5, v: DAY_AMBIENT },
  { hour: 18, v: [232, 212, 212] }, // entardecer: levemente rosado (não compete com o laranja de espera)
  { hour: 19, v: [110, 105, 150] },
  { hour: 20, v: NIGHT_AMBIENT },
  { hour: 24, v: NIGHT_AMBIENT },
];

const NIGHT: Key<number>[] = [
  { hour: 0, v: 1 },
  { hour: 5, v: 1 },
  { hour: 6, v: 0.6 },
  { hour: 7, v: 0.15 },
  { hour: 8, v: 0 },
  { hour: 16.5, v: 0 },
  { hour: 18, v: 0.45 },
  { hour: 19, v: 0.75 },
  { hour: 20, v: 1 },
  { hour: 24, v: 1 },
];

const DUSK: Key<number>[] = [
  { hour: 0, v: 0 },
  { hour: 5, v: 0 },
  { hour: 6, v: 1 },
  { hour: 7.5, v: 0 },
  { hour: 15, v: 0 },
  { hour: 16.5, v: 0.2 }, // tarde: nuvens levemente quentes
  { hour: 18, v: 1 },
  { hour: 19.5, v: 0.3 },
  { hour: 20, v: 0 },
  { hour: 24, v: 0 },
];

const SKY: Key<{ top: string; bottom: string }>[] = palette.sky.map((s) => ({ hour: s.hour, v: { top: s.top, bottom: s.bottom } }));

// ------------------------------------------------------------------ hora (com override)

/** "22", "22.30" ou "22:30" → 22.5; inválido → null */
function parseHourParam(raw: string | null): number | null {
  if (!raw) return null;
  const m = /^(\d{1,2})(?:[.:](\d{1,2}))?$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return h + min / 60;
}

/** lido uma vez, na carga do módulo */
const OVERRIDE: number | null =
  typeof window !== "undefined" ? parseHourParam(new URLSearchParams(window.location.search).get("hora")) : null;

/** hora fracionada (0..24) agora, ou a do `?hora=` */
export function hourNow(date: Date = new Date()): number {
  if (OVERRIDE !== null) return OVERRIDE;
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

/** data pro relógio de parede: com override, hora e minuto forçados (os segundos seguem o real) */
export function clockDate(date: Date = new Date()): Date {
  if (OVERRIDE === null) return date;
  const d = new Date(date);
  const h = Math.floor(OVERRIDE);
  d.setHours(h, Math.round((OVERRIDE - h) * 60));
  return d;
}

// ------------------------------------------------------------------ luz do momento

export function getDaylight(hour: number): Daylight {
  const h = ((hour % 24) + 24) % 24;
  const sky = sample(SKY, h, (a, b, t) => ({ top: mix(a.top, b.top, t), bottom: mix(a.bottom, b.bottom, t) }));
  const night = sample(NIGHT, h, lerpNum);
  return {
    hour: h,
    skyTop: sky.top,
    skyBottom: sky.bottom,
    ambient: sample(AMBIENT, h, lerpRgb),
    night,
    dusk: sample(DUSK, h, lerpNum),
    lightsOn: night > 0.35,
    stars: night > 0.55,
  };
}

/** dia pleno: o lightmap não muda nada e pode ser pulado */
export function isFullDay(d: Daylight): boolean {
  return d.night <= 0 && d.ambient[0] >= 255 && d.ambient[1] >= 255 && d.ambient[2] >= 255;
}

/** o que a janela precisa saber da luz do momento */
export function windowLight(d: Daylight): WindowLight {
  return { sky: { top: d.skyTop, bottom: d.skyBottom }, night: d.night, dusk: d.dusk, stars: d.stars };
}

// ------------------------------------------------------------------ lightmap

/** estado das luzes que dependem do que acontece no escritório */
export interface LightScene {
  /** telas dos monitores ligados (alguém trabalhando/pensando) */
  activeScreens: Rect[];
  /** telas com o "!" de esperando: não escurecem, mas não iluminam em volta */
  waitingScreens: Rect[];
  coffeeBusy: boolean;
}

/**
 * O mapa é refeito na hora quando as luzes mudam (tela acende, café ocupado) e, fora isso, só a
 * cada 5 s pra acompanhar a hora (que muda devagar). Refazer a cada 250 ms dava um pico de
 * milhares de fillRect 4x por segundo à noite.
 */
const REBUILD_MS = 5000;
/** raio (px base), cor e força de cada luz; a força ainda é multiplicada por "night" */
const LIGHT = {
  monitor: { r: 14, color: hexToRgb(palette.night.monitorLight), power: 0.75 },
  lamp: { r: 30, color: hexToRgb(palette.night.warmLight), power: 0.9 },
  sconce: { r: 30, color: hexToRgb(palette.night.warmLight), power: 1 },
  coffee: { r: 16, color: hexToRgb(palette.night.warmLight), power: 0.7 },
  reception: { r: 24, color: hexToRgb(palette.night.warmLight), power: 0.5 },
  ceiling: { r: 34, color: hexToRgb(palette.night.ceilingLight), power: 0.32 },
  meeting: { r: 40, color: hexToRgb(palette.night.ceilingLight), power: 0.32 },
  /** corredor: luz fraca e larga pra quem anda fora das mesas */
  aisle: { r: 70, color: hexToRgb(palette.night.ceilingLight), power: 0.18 },
  /** luminária de teto da ala de descanso, sobre a mesa de ping-pong */
  ala: { r: 38, color: hexToRgb(palette.night.ceilingLight), power: 0.45 },
  /** luz fraca sobre o bebedouro (sem ela ele some na ala escura) */
  cooler: { r: 20, color: hexToRgb(palette.night.ceilingLight), power: 0.4 },
} as const;

/** centros das luzes do corredor: 4 faixas iguais da porta até a ala */
const AISLE_LIGHTS_X = [0, 1, 2, 3].map((i) => Math.round(((i + 0.5) * W) / 4));

/**
 * Luz em faixas concêntricas somadas ("lighter"), de fora pra dentro, com pesos crescentes
 * (1, 2, 3… normalizados): o centro chega na força cheia e a borda fica bem fraca —
 * degraus em pixel, sem gradiente.
 */
function addLight(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: RGB, power: number, bands = 4) {
  if (power <= 0.01) return;
  const total = (bands * (bands + 1)) / 2;
  for (let b = 0; b < bands; b++) {
    const q = (power * (b + 1)) / total;
    disc(g, x, y, Math.max(1, Math.round((r * (bands - b)) / bands)), `rgb(${Math.round(color[0] * q)}, ${Math.round(color[1] * q)}, ${Math.round(color[2] * q)})`);
  }
}

const sceneKey = (s: LightScene) =>
  `${s.activeScreens.map((r) => `${r.x},${r.y}`).join(";")}|${s.waitingScreens.map((r) => `${r.x},${r.y}`).join(";")}|${s.coffeeBusy}`;

/**
 * Mapa de luz na resolução base (W x H). Começa com a cor ambiente, abre as janelas e as telas
 * em branco (ficam com as próprias cores) e soma as luzes. O render aplica com "multiply".
 */
export class Lightmap {
  daylight: Daylight = getDaylight(hourNow());
  private canvas: HTMLCanvasElement | null = null;
  private builtAt = -Infinity;
  private key = "";

  /** recalcula a luz do momento e refaz o mapa a cada ~250 ms ou quando as luzes mudam */
  refresh(now: number, scene: LightScene) {
    const key = sceneKey(scene);
    if (now - this.builtAt < REBUILD_MS && key === this.key) return;
    this.builtAt = now;
    this.key = key;
    this.daylight = getDaylight(hourNow());
    if (isFullDay(this.daylight)) return; // meio-dia: nada a desenhar
    this.build(scene);
  }

  private build(scene: LightScene) {
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const g = this.canvas.getContext("2d");
    if (!g) return;
    const d = this.daylight;
    const n = d.night;
    g.globalCompositeOperation = "source-over";
    g.fillStyle = `rgb(${d.ambient[0]}, ${d.ambient[1]}, ${d.ambient[2]})`;
    g.fillRect(0, 0, W, H);
    // o céu já está com a cor da hora; as telas acesas emitem a própria luz
    g.fillStyle = "#FFFFFF";
    for (const r of WINDOW_PANES) g.fillRect(r.x, r.y, r.w, r.h);
    for (const r of [...scene.activeScreens, ...scene.waitingScreens]) g.fillRect(r.x, r.y, r.w, r.h);
    // quadro branco com os contadores: nunca mais escuro que cinza claro, legível em qualquer hora
    const [br, bg, bb] = [200, 208, 228].map((v, i) => Math.max(v, d.ambient[i]));
    g.fillStyle = `rgb(${br}, ${bg}, ${bb})`;
    g.fillRect(BOARD.x, BOARD.y, BOARD.w, BOARD.h);
    // plaquinha AG POCKET: mesmo piso de luz, pra continuar legível à noite
    g.fillRect(POCKET_PLAQUE.x, POCKET_PLAQUE.y, POCKET_PLAQUE.w, POCKET_PLAQUE.h);

    g.globalCompositeOperation = "lighter";
    if (d.lightsOn) {
      for (const desk of DESKS) {
        addLight(g, desk.cx * TILE, (desk.cy + 0.3) * TILE, LIGHT.ceiling.r, LIGHT.ceiling.color, LIGHT.ceiling.power * n, 3);
      }
      addLight(g, 16 * TILE, 11.2 * TILE, LIGHT.meeting.r, LIGHT.meeting.color, LIGHT.meeting.power * n, 3);
      addLight(g, PINGPONG.x + (PINGPONG.w >> 1), PINGPONG.y + (PINGPONG.h >> 1), LIGHT.ala.r, LIGHT.ala.color, LIGHT.ala.power * n, 3);
      addLight(g, WATER_COOLER.x + 7, WATER_COOLER.y - 18, LIGHT.cooler.r, LIGHT.cooler.color, LIGHT.cooler.power * n, 3);
      for (const ax of AISLE_LIGHTS_X) addLight(g, ax, AISLE_Y * TILE, LIGHT.aisle.r, LIGHT.aisle.color, LIGHT.aisle.power * n, 3);
    }
    for (const r of scene.activeScreens) {
      addLight(g, r.x + (r.w >> 1), r.y + (r.h >> 1), LIGHT.monitor.r, LIGHT.monitor.color, LIGHT.monitor.power * n);
    }
    addLight(g, FLOOR_LAMP.x, FLOOR_LAMP.y - 34, LIGHT.lamp.r, LIGHT.lamp.color, LIGHT.lamp.power * n);
    for (const ax of SIGN_LAMP_X) addLight(g, ax, 12, LIGHT.sconce.r, LIGHT.sconce.color, LIGHT.sconce.power * n);
    if (scene.coffeeBusy) addLight(g, COFFEE_MACHINE.x, COFFEE_MACHINE.y, LIGHT.coffee.r, LIGHT.coffee.color, LIGHT.coffee.power * n);
    // arandela sobre o balcão "AG" da recepção
    addLight(g, RECEPTION.x + (RECEPTION.w >> 1), RECEPTION.y - 24, LIGHT.reception.r, LIGHT.reception.color, LIGHT.reception.power * n);
  }

  /** multiplica a cena pelo mapa (pulado no dia pleno). Chamar com a transformação de escala k ativa. */
  apply(ctx: CanvasRenderingContext2D) {
    if (!this.canvas || isFullDay(this.daylight)) return;
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.canvas, 0, 0, W, H);
    ctx.restore();
  }
}
