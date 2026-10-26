// Iluminação do escritório: céu, cor ambiente e quanto "é noite". O padrão é a noite (22h); com o
// "ciclo do dia" ligado no painel (studio.painel.ciclo), segue a hora real.
// O Lightmap (fim do arquivo) escurece a cena com a cor ambiente e soma as luzes do escritório.
// Tudo sai de chaves por hora interpoladas linearmente (0..24, a última repete a primeira).
// `?hora=HH` (ou HH.MM / HH:MM) na URL força a hora — útil pra testes e prints. Cores dos tokens da marca.
// Atenção: o formato é HH.MM (hora.minuto), não decimal: `?hora=7.5` é 7:05 e `?hora=7.30` é 7:30.

import { palette } from "../theme";
import { cor, derivada, misturar } from "../marca/cores";
import { disc, hexToRgb, mix, type Rect, type WindowLight } from "./decor";
import { AISLE_Y, BOARD, BOARD_TRAY, COFFEE_MACHINE, DESKS, FLOOR_LAMP, H, PINGPONG, STUDIO_PLAQUE_RECT, RECEPTION, WATER_COOLER, SIGN_LAMP_X, TILE, W, WINDOW_PANES } from "./map";

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

/** multiplicar por branco não muda nada: é o "sem efeito" do lightmap (não é uma cor da marca) */
const NEUTRO: RGB = [255, 255, 255];
const rgbDe = (hex: string): RGB => hexToRgb(hex);
/** RGB → "#rrggbb" (o lightmap monta as cores na hora) */
const hexDe = (c: readonly number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

/** cor ambiente por hora, derivada dos tokens: noite em ardósia, dia nublado quase neutro */
const AMBIENT = derivada((): Key<RGB>[] => {
  // piso da noite: os personagens continuam visíveis mesmo sem luz nenhuma
  const noite = rgbDe(misturar("rh-ardosia", "rh-aco", 0.3));
  const virada = rgbDe(misturar(misturar("rh-ardosia", "rh-aco", 0.6), "rh-brasa", 0.1));
  const quaseDia = rgbDe(misturar("rh-aco", "rh-nevoa", 0.75));
  const nublado = rgbDe(misturar("rh-nevoa", "rh-aco", 0.1));
  return [
    { hour: 0, v: noite },
    { hour: 5, v: noite },
    { hour: 6, v: virada }, // amanhecer: ainda escuro
    { hour: 7, v: quaseDia },
    { hour: 8.5, v: nublado },
    { hour: 16.5, v: nublado },
    { hour: 18, v: quaseDia },
    { hour: 19, v: virada },
    { hour: 20, v: noite },
    { hour: 24, v: noite },
  ];
});

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

const SKY = derivada((): Key<{ top: string; bottom: string }>[] => palette.sky.map((s) => ({ hour: s.hour, v: { top: s.top, bottom: s.bottom } })));

// ------------------------------------------------------------------ hora (com override)

/** "22", "22.30" ou "22:30" → 22.5; inválido → null */
export function parseHourParam(raw: string | null): number | null {
  if (!raw) return null;
  const m = /^(\d{1,2})(?:[.:](\d{1,2}))?$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return h + min / 60;
}

/** lido uma vez, na carga do módulo (os testes trocam com setHourOverride) */
let OVERRIDE: number | null =
  typeof window !== "undefined" ? parseHourParam(new URLSearchParams(window.location.search).get("hora")) : null;

/** força a hora como o `?hora=` (null volta ao normal); usado pelos testes */
export function setHourOverride(hora: number | null) {
  if (hora === OVERRIDE) return;
  OVERRIDE = hora;
  versaoCiclo++;
}

/** hora do escritório quando o ciclo do dia está desligado: noite */
export const NIGHT_HOUR = 22;

/** ciclo do dia (hora real) ligado? O painel liga pela preferência studio.painel.ciclo. */
let cicloReal = false;
/** sobe quando o ciclo liga ou desliga: entra na chave do Lightmap, que refaz a luz na hora */
let versaoCiclo = 0;
export function setCicloReal(ligado: boolean) {
  if (ligado === cicloReal) return;
  cicloReal = ligado;
  versaoCiclo++;
}

/** hora fracionada (0..24): a do `?hora=`, a real (ciclo ligado) ou a noite padrão */
export function hourNow(date: Date = new Date()): number {
  if (OVERRIDE !== null) return OVERRIDE;
  if (!cicloReal) return NIGHT_HOUR;
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

/** data pro relógio de parede: com override, hora e minuto forçados; sem ciclo, a hora da noite (os segundos seguem o real) */
export function clockDate(date: Date = new Date()): Date {
  if (OVERRIDE === null && cicloReal) return date;
  const d = new Date(date);
  if (OVERRIDE === null) {
    d.setHours(NIGHT_HOUR);
    return d;
  }
  const h = Math.floor(OVERRIDE);
  d.setHours(h, Math.round((OVERRIDE - h) * 60));
  return d;
}

// ------------------------------------------------------------------ luz do momento

export function getDaylight(hour: number): Daylight {
  const h = ((hour % 24) + 24) % 24;
  const sky = sample(SKY(), h, (a, b, t) => ({ top: mix(a.top, b.top, t), bottom: mix(a.bottom, b.bottom, t) }));
  const night = sample(NIGHT, h, lerpNum);
  return {
    hour: h,
    skyTop: sky.top,
    skyBottom: sky.bottom,
    ambient: sample(AMBIENT(), h, lerpRgb),
    night,
    dusk: sample(DUSK, h, lerpNum),
    lightsOn: night > 0.35,
    stars: night > 0.55,
  };
}

/** dia pleno: o lightmap não muda nada e pode ser pulado */
export function isFullDay(d: Daylight): boolean {
  return d.night <= 0 && d.ambient.every((v, i) => v >= NEUTRO[i]);
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
  /** tampos das mesas de quem está trabalhando (brilho laranja de 1px + luz brasa) */
  activeDesks?: Rect[];
}

/**
 * O mapa é refeito na hora quando as luzes mudam (tela acende, café ocupado) e, fora isso, só a
 * cada 5 s pra acompanhar a hora (que muda devagar). Refazer a cada 250 ms dava um pico de
 * milhares de fillRect 4x por segundo à noite.
 */
const REBUILD_MS = 5000;
/** raio (px base), cor e força de cada luz; a força ainda é multiplicada por "night" */
const LIGHT = derivada(() => ({
  /** brilho da mesa de quem trabalha: luz brasa */
  active: { r: 12, color: hexToRgb(palette.signal.activeGlow), power: 0.55 },
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
}));

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
    disc(g, x, y, Math.max(1, Math.round((r * (bands - b)) / bands)), hexDe(color.map((v) => v * q)));
  }
}

const sceneKey = (s: LightScene) =>
  `${versaoCiclo}|${(s.activeDesks ?? []).map((r) => `${r.x},${r.y}`).join(";")}|${s.activeScreens.map((r) => `${r.x},${r.y}`).join(";")}|${s.waitingScreens.map((r) => `${r.x},${r.y}`).join(";")}|${s.coffeeBusy}`;

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
    const L = LIGHT();
    g.globalCompositeOperation = "source-over";
    g.fillStyle = hexDe(d.ambient);
    g.fillRect(0, 0, W, H);
    // o céu já está com a cor da hora; as telas acesas emitem a própria luz
    g.fillStyle = hexDe(NEUTRO);
    for (const r of WINDOW_PANES) g.fillRect(r.x, r.y, r.w, r.h);
    for (const r of [...scene.activeScreens, ...scene.waitingScreens]) g.fillRect(r.x, r.y, r.w, r.h);
    // quadro de etapas (e a bandeja): piso de luz alto, pra o texto pequeno passar de 4,5:1 à noite
    g.fillStyle = hexDe(rgbDe(cor("rh-nevoa")).map((v, i) => Math.max(v, d.ambient[i])));
    g.fillRect(BOARD.x, BOARD.y, BOARD.w, BOARD.h);
    g.fillRect(BOARD_TRAY.x, BOARD_TRAY.y, BOARD_TRAY.w, BOARD_TRAY.h);
    // plaquinha RHYNOR STUDIO: piso de luz médio (escura com letra clara não precisa de mais)
    g.fillStyle = hexDe(rgbDe(misturar("rh-aco", "rh-nevoa", 0.5)).map((v, i) => Math.max(v, d.ambient[i])));
    g.fillRect(STUDIO_PLAQUE_RECT.x, STUDIO_PLAQUE_RECT.y, STUDIO_PLAQUE_RECT.w, STUDIO_PLAQUE_RECT.h);

    g.globalCompositeOperation = "lighter";
    if (d.lightsOn) {
      for (const desk of DESKS) {
        addLight(g, desk.cx * TILE, (desk.cy + 0.3) * TILE, L.ceiling.r, L.ceiling.color, L.ceiling.power * n, 3);
      }
      addLight(g, 16 * TILE, 11.2 * TILE, L.meeting.r, L.meeting.color, L.meeting.power * n, 3);
      addLight(g, PINGPONG.x + (PINGPONG.w >> 1), PINGPONG.y + (PINGPONG.h >> 1), L.ala.r, L.ala.color, L.ala.power * n, 3);
      addLight(g, WATER_COOLER.x + 7, WATER_COOLER.y - 18, L.cooler.r, L.cooler.color, L.cooler.power * n, 3);
      for (const ax of AISLE_LIGHTS_X) addLight(g, ax, AISLE_Y * TILE, L.aisle.r, L.aisle.color, L.aisle.power * n, 3);
    }
    for (const r of scene.activeScreens) {
      addLight(g, r.x + (r.w >> 1), r.y + (r.h >> 1), L.monitor.r, L.monitor.color, L.monitor.power * n);
    }
    // brilho brasa em volta da mesa de quem está trabalhando agora
    for (const r of scene.activeDesks ?? []) {
      addLight(g, r.x + (r.w >> 1), r.y + (r.h >> 1), L.active.r, L.active.color, L.active.power * Math.max(n, 0.35));
    }
    addLight(g, FLOOR_LAMP.x, FLOOR_LAMP.y - 34, L.lamp.r, L.lamp.color, L.lamp.power * n);
    for (const ax of SIGN_LAMP_X) addLight(g, ax, 12, L.sconce.r, L.sconce.color, L.sconce.power * n);
    if (scene.coffeeBusy) addLight(g, COFFEE_MACHINE.x, COFFEE_MACHINE.y, L.coffee.r, L.coffee.color, L.coffee.power * n);
    // arandela sobre o balcão da recepção
    addLight(g, RECEPTION.x + (RECEPTION.w >> 1), RECEPTION.y - 24, L.reception.r, L.reception.color, L.reception.power * n);
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
