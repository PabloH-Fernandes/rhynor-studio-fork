// Personagens pixel art desenhados por código (sem imagens), então dá pra trocar
// uniforme, pele e cabelo só mudando cores. Coordenadas em pixels da resolução base;
// (x, y) é o ponto entre os pés.
//
// Proporção chibi: cabeça 12x10, tronco 7 e pernas 4 (uns 24 px com o cabelo).
// Cada quadro é desenhado uma vez num canvas pequeno (spriteCache) e depois só copiado.

import type { Acessorio } from "../../../shared/roster";
import type { Uniform } from "../theme";
import { palette, theme } from "../theme";
import { AG_CHEST, bitmapRuns } from "./agMark";
import { SPRITE_OX, SPRITE_OY, cachedSprite } from "./spriteCache";

// ------------------------------------------------------------------ cores

const blendCache = new Map<string, string>();

/** mistura duas cores hex (t = 0 a primeira, 1 a segunda); memorizado */
function blend(a: string, b: string, t: number): string {
  const key = `${a}|${b}|${t}`;
  let out = blendCache.get(key);
  if (out) return out;
  const na = parseInt(a.slice(1, 7), 16);
  const nb = parseInt(b.slice(1, 7), 16);
  const ch = (shift: number) => {
    const va = (na >> shift) & 255;
    const vb = (nb >> shift) & 255;
    return Math.round(va + (vb - va) * t)
      .toString(16)
      .padStart(2, "0");
  };
  out = `#${ch(16)}${ch(8)}${ch(0)}`;
  blendCache.set(key, out);
  return out;
}

export type Dir = "down" | "up" | "left" | "right";

/** 0 curto, 1 comprido, 2 raspado, 3 coque, 4 rabo de cavalo, 5 cacheado volumoso, 6 franja lateral, 7 chanel, 8 trancas */
export const HAIR_STYLE_COUNT = 9;

export interface CharLook {
  uniform: Uniform;
  skin: string;
  hair: string;
  hairStyle: number;
  /** todos os acessórios; cada um é desenhado na sua camada (ACCESSORIES) */
  accessories: readonly Acessorio[];
  /** cílio de 1px e cintura 1px mais fina; o uniforme é o mesmo */
  feminine: boolean;
}

/**
 * Animações curtas: espreguiçar (fim de turno), comemorar (fim de tarefa) e as de descanso
 * (gole de café, celular, raquete, mão no queixo, regar).
 */
export type CharAnim = "stretch" | "cheer" | "sip" | "phone" | "swing" | "chin" | "water";

/** objeto na mão fora de animação (ex.: volta da copa com o copo) */
export type Holding = "copo" | "celular" | "raquete" | "regador";

/** expressão da sobrancelha: sobe esperando, inclina pensando */
export type Mood = "esperando" | "pensando";

export interface CharPose {
  dir: Dir;
  walking: boolean;
  sitting: boolean;
  typing: boolean;
  /** tempo em ms, usado nas animações */
  t: number;
  /** pra cada personagem não animar sincronizado */
  phase: number;
  /** semente do piscar (hash do id); sem ela usa `phase` */
  seed?: number;
  alpha?: number;
  anim?: CharAnim;
  /** progresso da animação, 0..1 */
  animT: number;
  holding?: Holding;
  mood?: Mood;
  /** prefers-reduced-motion: sem piscar, respirar, balançar nem pular */
  reducedMotion?: boolean;
  /** sem piscar nem respirar (galeria e retrato) */
  noIdle?: boolean;
}

// ------------------------------------------------------------------ medidas

const HEAD_W = 12;
const HEAD_H = 10;
const TORSO_H = 7;
const LEG_H = 4;
/**
 * Quanto o corpo desce ao sentar. Zero: o tampo da mesa (com o contorno) começa na 6ª linha
 * do tronco, então aparecem a cabeça, a gola, o cordão, a logo AG e o crachá inteiro.
 */
export const SIT_DROP = 0;
/** topo da cabeça com o cabelo mais alto, relativo ao y dos pés (em pé e sentado) */
export const HEAD_TOP_STAND = -(LEG_H + TORSO_H + HEAD_H + 4);
export const HEAD_TOP_SIT = HEAD_TOP_STAND + SIT_DROP;
/**
 * Caixa de clique relativa ao ponto entre os pés (com o contorno). Nenhum cabelo nem acessório
 * sai dela, fora o pulo e as animações longas.
 */
export const HIT_BOX = { left: -10, right: 10, top: HEAD_TOP_STAND - 2, bottom: 3 } as const;

/** passos das animações longas (gole, celular, raquete...) no cache */
const ANIM_STEPS = 12;
const WALK_FRAME_MS = 140;
const TYPE_HAND_MS = 110;
const TYPE_GAZE_MS = 600;
const BREATH_MS = 1200;

// ------------------------------------------------------------------ espreguiçar e comemorar

/** baixo (normal), diagonal, mãos sobre a cabeça (espreguiçar) e punho erguido (comemorar) */
export type ArmPose = "down" | "diag" | "up" | "fist";

/** 5 quadros do espreguiçar: baixo → diagonal → acima (segura) → diagonal → baixo */
function stretchArms(t: number): ArmPose {
  if (t < 0.12 || t >= 0.9) return "down";
  if (t < 0.26 || t >= 0.76) return "diag";
  return "up";
}

const CHEER_HOPS = 2;

/** um pulinho por metade: agacha, sobe até 4px, desce e agacha de novo ao pousar */
function hop(t: number): { lift: number; air: boolean } {
  const k = (t * CHEER_HOPS) % 1;
  if (k < 0.2 || k >= 0.85) return { lift: 1, air: false };
  const a = (k - 0.2) / 0.65;
  return { lift: -Math.round(Math.sin(a * Math.PI) * 4), air: true };
}

/**
 * Deslocamento vertical do corpo (px, negativo = pra cima) causado pela animação.
 * O motor usa o mesmo valor pra subir o nome/balão junto com a cabeça.
 */
export function animLift(anim: CharAnim | undefined, t: number, reducedMotion = false): number {
  if (!anim || reducedMotion) return 0;
  if (anim === "stretch") return stretchArms(t) === "up" ? -1 : 0;
  if (anim === "cheer") return hop(t).lift;
  return 0;
}

function cheerArms(t: number, reduced: boolean): [ArmPose, ArmPose] {
  // sem pulo: só ergue os braços uma vez
  if (reduced) return t < 0.15 || t >= 0.85 ? ["diag", "diag"] : ["fist", "fist"];
  if (t >= 0.95) return ["down", "down"];
  // no ar um braço vai lá em cima e o outro fica na diagonal, alternando a cada pulo
  const { air } = hop(t);
  const second = t * CHEER_HOPS >= 1;
  return [air && !second ? "fist" : "diag", air && second ? "fist" : "diag"];
}

// ------------------------------------------------------------------ piscar e respirar

/** PRNG pequeno e estável (mulberry32) */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BlinkPlan {
  period: number;
  at: number[];
  dur: number[];
}

const BLINKS_PER_PLAN = 16;
const blinkPlans = new Map<number, BlinkPlan>();

/**
 * Agenda de piscadas de um personagem, repetida em ciclo: intervalos de 2,5 a 6 s,
 * olho fechado por 120 a 150 ms e, em ~20% das vezes, uma segunda piscada logo depois.
 */
function blinkPlan(seed: number): BlinkPlan {
  let plan = blinkPlans.get(seed);
  if (plan) return plan;
  const rnd = mulberry32(seed);
  const at: number[] = [];
  const dur: number[] = [];
  let t = 0;
  for (let i = 0; i < BLINKS_PER_PLAN; i++) {
    t += 2500 + rnd() * 3500;
    const d = 120 + Math.round(rnd() * 30);
    at.push(t);
    dur.push(d);
    if (rnd() < 0.2) {
      t += d + 110;
      at.push(t);
      dur.push(d);
    }
  }
  plan = { period: t + 2500, at, dur };
  blinkPlans.set(seed, plan);
  return plan;
}

function blinkClosed(t: number, seed: number): boolean {
  const p = blinkPlan(seed);
  const k = ((t % p.period) + p.period) % p.period;
  for (let i = 0; i < p.at.length; i++) if (k >= p.at[i] && k < p.at[i] + p.dur[i]) return true;
  return false;
}

// ------------------------------------------------------------------ quadro quantizado

/** tudo que muda o desenho do boneco; vira a chave do cache */
export interface SpriteFrame {
  dir: Dir;
  sitting: boolean;
  /** -1 parado; 0..3 ciclo do andar (1 e 3 são a passagem) */
  walk: number;
  /** balanço dos braços no andar: -1, 0 ou 1 */
  swing: number;
  /** tronco e cabeça 1px acima (passagem do andar ou respiração) */
  rise: 0 | 1;
  blink: boolean;
  /** -1 sem digitar; 0..3 = mão que bate (bit 0) + olhando o teclado (bit 1); 4 = digitando parado */
  type: number;
  anim?: CharAnim;
  /** passo da animação longa, 0..ANIM_STEPS-1 */
  step: number;
  armL: ArmPose;
  armR: ArmPose;
  holding?: Holding;
  mood?: Mood;
}

/** passo fixo de cada animação longa com reduced-motion */
const CALM_STEP: Partial<Record<CharAnim, number>> = { sip: 0, phone: 0, swing: 0, chin: 0, water: 0 };

export function frameOf(p: CharPose): SpriteFrame {
  const calm = !!p.reducedMotion;
  const idle = !calm && !p.noIdle;
  const seed = p.seed ?? p.phase;
  const animT = Math.min(1, Math.max(0, p.animT));
  const anim = p.anim;
  const walk = p.walking ? Math.floor((p.t + p.phase) / WALK_FRAME_MS) % 4 : -1;
  const typing = p.typing && !anim;
  let type = -1;
  if (typing) {
    type = calm
      ? 4
      : (Math.floor((p.t + p.phase) / TYPE_HAND_MS) % 2) + 2 * (Math.floor((p.t + p.phase) / TYPE_GAZE_MS) % 2);
  }
  const still = !p.walking && !typing && !anim;
  const breath = idle && still && Math.floor((p.t + (seed % (2 * BREATH_MS))) / BREATH_MS) % 2 === 1;
  const passing = p.walking && !calm && (walk === 1 || walk === 3);
  let armL: ArmPose = "down";
  let armR: ArmPose = "down";
  let step = 0;
  if (anim === "stretch") armL = armR = stretchArms(animT);
  else if (anim === "cheer") [armL, armR] = cheerArms(animT, calm);
  else if (anim) step = calm ? (CALM_STEP[anim] ?? 0) : Math.min(ANIM_STEPS - 1, Math.floor(animT * ANIM_STEPS));
  return {
    dir: p.dir,
    sitting: p.sitting,
    walk,
    swing: p.walking && !calm ? (walk === 0 ? 1 : walk === 2 ? -1 : 0) : 0,
    rise: passing || breath ? 1 : 0,
    blink: idle && p.dir !== "up" && blinkClosed(p.t, seed),
    type,
    anim,
    step,
    armL,
    armR,
    holding: p.holding,
    mood: p.mood,
  };
}

function frameKey(f: SpriteFrame): string {
  return `${f.sitting ? 1 : 0}${f.walk + 1}${f.swing + 1}${f.rise}${f.blink ? 1 : 0}${f.type + 1}|${f.anim ?? ""}${f.step}|${f.armL}${f.armR}|${f.holding ?? ""}|${f.mood ?? ""}`;
}

const lookKeys = new WeakMap<CharLook, string>();

/** hash da aparência (o motor troca o objeto quando o elenco muda) */
export function lookKey(look: CharLook): string {
  let k = lookKeys.get(look);
  if (!k) {
    k = hashString(JSON.stringify(look)).toString(36);
    lookKeys.set(look, k);
  }
  return k;
}

// ------------------------------------------------------------------ desenho com cache

export function drawCharacter(ctx: CanvasRenderingContext2D, x: number, y: number, look: CharLook, pose: CharPose) {
  const f = frameOf(pose);
  const lift = animLift(pose.anim, Math.min(1, Math.max(0, pose.animT)), pose.reducedMotion);
  const bx = Math.round(x);
  const gy = Math.round(y);
  const by = gy + (f.sitting ? SIT_DROP : 0) + lift;

  ctx.save();
  ctx.globalAlpha = pose.alpha ?? 1;
  if (!f.sitting) {
    // a sombra fica no chão; com o corpo no ar ela encolhe e achata
    const s = lift < 0 ? Math.min(3, -lift) : 0;
    ctx.fillStyle = palette.props.shadow;
    ctx.fillRect(bx - 6 + s, gy, 12 - 2 * s, 1);
    if (s) ctx.fillRect(bx - 4 + s, gy - 1, 8 - 2 * s, 2);
    else ctx.fillRect(bx - 4, gy - 1, 8, 3);
  }
  const sprite = cachedSprite(`${lookKey(look)}|${f.dir}|${frameKey(f)}`, (c) => renderSprite(c, SPRITE_OX, SPRITE_OY, look, f));
  if (sprite) ctx.drawImage(sprite, bx - SPRITE_OX, by - SPRITE_OY);
  else renderSprite(ctx, bx, by, look, f);
  ctx.restore();
}

/** tamanho do retrato (busto) em escala 1 */
export const PORTRAIT_W = 18;
export const PORTRAIT_H = 22;
const PORTRAIT_FRAME: SpriteFrame = {
  dir: "down",
  sitting: false,
  walk: -1,
  swing: 0,
  rise: 0,
  blink: false,
  type: -1,
  step: 0,
  armL: "down",
  armR: "down",
};

/**
 * Retrato pro crachá: busto (cabeça e peito com o crachá) de frente, fundo transparente
 * e pixel duro, ampliado `escala` vezes a partir de (x, y).
 */
export function drawPortrait(ctx: CanvasRenderingContext2D, look: CharLook, escala: number, x = 0, y = 0) {
  const s = Math.max(1, Math.round(escala));
  // sem os objetos de mão (prancheta, caneca): no recorte do busto viravam um pedaço solto
  const bust: CharLook = { ...look, accessories: look.accessories.filter((x) => ACCESSORIES[x].camada !== "mao") };
  const sprite = cachedSprite(`${lookKey(look)}|retrato|${frameKey(PORTRAIT_FRAME)}`, (c) =>
    renderSprite(c, SPRITE_OX, SPRITE_OY, bust, PORTRAIT_FRAME),
  );
  if (!sprite) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  // do topo do coque (com contorno) até a 6ª linha do tronco: o crachá aparece inteiro
  const sx = SPRITE_OX - PORTRAIT_W / 2;
  const sy = SPRITE_OY + HEAD_TOP_STAND - 2;
  ctx.drawImage(sprite, sx, sy, PORTRAIT_W, PORTRAIT_H, Math.round(x), Math.round(y), PORTRAIT_W * s, PORTRAIT_H * s);
  ctx.restore();
}

// ------------------------------------------------------------------ montagem do boneco

type Part = [x: number, y: number, w: number, h: number, color: string];

/** mão ou pulso onde um acessório/objeto pode ir; s = -1 lado esquerdo da tela, 1 direito (ou a da frente, de perfil) */
interface Slot {
  x: number;
  y: number;
  s: -1 | 1;
  into: Part[];
  used?: boolean;
}

export type AccessoryLayer = "cabeca" | "rosto" | "tronco" | "mao" | "pulso";

export interface AccessoryCtx {
  look: CharLook;
  /** de perfil o desenho é feito virado pra direita (o da esquerda é espelhado depois) */
  view: "front" | "back" | "side";
  /** retângulo na camada certa (com contorno, menos no rosto) */
  put(x: number, y: number, w: number, h: number, color: string): void;
  /** atalho: retângulo relativo ao canto da cabeça (12x10) */
  head(rx: number, ry: number, w: number, h: number, color: string): void;
  /** tronco: canto, largura e a faixa de cada linha (a cintura afina no feminino) */
  tx: number;
  ty: number;
  tw: number;
  torsoRow(r: number): [x: number, w: number];
  /** camada "mao": a mão livre escolhida; "pulso": o pulso com o relógio */
  slot?: Slot;
}

export interface AccessoryDef {
  camada: AccessoryLayer;
  /** camada "mao": lado preferido (-1 esquerda da tela, 1 direita) */
  prefer?: -1 | 1;
  draw(c: AccessoryCtx): void;
}

const HELMETS = new Set<Acessorio>(["capacete-branco", "capacete-amarelo"]);

function helmet(color: string, shade: string): AccessoryDef {
  return {
    camada: "cabeca",
    draw: (c) => {
      // casco por cima do topo do cabelo (o cabelo de cima já foi cortado) e aba de 1px
      c.head(1, -3, 10, 1, color);
      c.head(0, -2, 12, 3, color);
      c.head(5, -3, 2, 1, shade); // friso do casco
      c.head(3, -2, 1, 1, blend(color, palette.white, 0.6));
      if (c.view === "side") c.head(1, 1, 12, 1, shade);
      else c.head(-1, 1, 14, 1, shade);
    },
  };
}

function cup(put: AccessoryCtx["put"], x: number, y: number) {
  // copo AG das animações: branco com faixa marinho
  put(x, y, 3, 3, palette.white);
  put(x, y + 1, 3, 1, palette.navy900);
}

/** acessórios por camada; pra criar um novo, some uma entrada aqui (e em Acessorio, no shared/roster) */
export const ACCESSORIES: Record<Acessorio, AccessoryDef> = {
  headset: {
    camada: "cabeca",
    draw: (c) => {
      const band = palette.gray800;
      const cupC = palette.gray600;
      c.head(1, -3, 10, 1, band);
      if (c.view === "side") {
        c.head(5, -2, 1, 5, band);
        c.head(4, 3, 3, 3, cupC);
        c.head(6, 8, 3, 1, band);
        c.head(9, 8, 1, 1, c.look.uniform.accent);
        return;
      }
      c.head(-1, -2, 1, 6, band);
      c.head(12, -2, 1, 6, band);
      c.head(-2, 4, 2, 3, cupC);
      c.head(12, 4, 2, 3, cupC);
      if (c.view === "front") {
        c.head(0, 8, 3, 1, band);
        c.head(3, 8, 1, 1, c.look.uniform.accent);
      }
    },
  },
  "capacete-branco": helmet(palette.white, palette.gray200),
  "capacete-amarelo": helmet(palette.props.helmetYellow, blend(palette.props.helmetYellow, palette.navy950, 0.25)),
  oculos: {
    camada: "rosto",
    draw: (c) => {
      // cinza médio: contrasta com pele clara e escura
      const frame = palette.gray600;
      if (c.view === "back") return;
      if (c.view === "side") {
        c.head(7, 4, 4, 1, frame);
        c.head(7, 5, 1, 2, frame);
        c.head(10, 5, 1, 2, frame);
        c.head(2, 4, 5, 1, frame); // haste até a orelha
        return;
      }
      // meia-armação: aro de cima e laterais (as bochechas continuam à vista)
      c.head(1, 4, 10, 1, frame);
      for (const rx of [1, 4, 7, 10]) c.head(rx, 5, 1, 2, frame);
    },
  },
  colete: {
    camada: "tronco",
    draw: (c) => {
      const vest = palette.props.vest;
      const stripe = palette.props.vestStripe;
      if (c.view === "front") {
        // duas abas laterais (a camisa e a logo continuam no meio) com faixa prata
        for (let r = 0; r < TORSO_H; r++) {
          const [x, w] = c.torsoRow(r);
          const color = r === 4 ? stripe : vest;
          c.put(x, c.ty + r, 2, 1, color);
          c.put(x + w - 2, c.ty + r, 2, 1, color);
        }
        return;
      }
      for (let r = 0; r < TORSO_H; r++) {
        const [x, w] = c.torsoRow(r);
        c.put(x, c.ty + r, w, 1, r === 4 || (c.view === "back" && r === 2) ? stripe : vest);
      }
    },
  },
  prancheta: {
    camada: "mao",
    prefer: -1,
    draw: (c) => {
      const h = c.slot;
      if (!h || c.view === "back") return;
      const x = h.s < 0 ? h.x - 3 : h.x + 1;
      c.put(x, h.y - 3, 4, 5, palette.furniture.wood);
      c.put(x + 1, h.y - 2, 2, 3, palette.white);
      c.put(x + 1, h.y - 3, 2, 1, palette.gray400); // prendedor
      c.put(h.x, h.y, 2, 2, c.look.skin); // a mão segura por cima
    },
  },
  caneca: {
    camada: "mao",
    prefer: 1,
    draw: (c) => {
      const h = c.slot;
      if (!h) return;
      // caneca AG: corpo branco 3x4 com faixa marinho e alça de 1px pra fora
      const x = h.s > 0 ? h.x + 2 : h.x - 3;
      const y = h.y - 2;
      c.put(x, y, 3, 4, palette.white);
      c.put(x, y + 1, 3, 1, palette.navy900);
      c.put(h.s > 0 ? x + 3 : x - 1, y + 1, 1, 2, palette.white);
    },
  },
  lapis: {
    camada: "cabeca",
    draw: (c) => {
      const { pencil, pencilTip } = palette.props;
      if (c.view === "side") {
        c.head(2, 3, 5, 1, pencil);
        c.head(7, 3, 1, 1, pencilTip);
      } else {
        // atrás da orelha: do lado direito de frente, do esquerdo de costas
        const rx = c.view === "front" ? 12 : -1;
        c.head(rx, 0, 1, 4, pencil);
        c.head(rx, 4, 1, 1, pencilTip);
      }
    },
  },
  relogio: {
    camada: "pulso",
    draw: (c) => {
      const w = c.slot;
      if (w) c.put(w.x, w.y, 2, 1, palette.props.watch);
    },
  },
  barba: {
    camada: "rosto",
    draw: (c) => {
      const b = c.look.hair;
      if (c.view === "back") return;
      if (c.view === "side") {
        c.head(5, 5, 1, 4, b);
        c.head(6, 8, 4, 2, b);
        c.head(10, 9, 1, 1, b);
        return;
      }
      c.head(0, 5, 1, 5, b);
      c.head(11, 5, 1, 5, b);
      c.head(1, 8, 4, 2, b);
      c.head(7, 8, 4, 2, b);
      c.head(5, 9, 2, 1, b);
    },
  },
};

/**
 * Desenha o boneco com o ponto entre os pés em (bx, by), já inteiros. Sem sombra e sem alpha:
 * é o que vai pro cache.
 */
export function renderSprite(ctx: CanvasRenderingContext2D, bx: number, by: number, look: CharLook, f: SpriteFrame) {
  /** corpo, com contorno */
  const L: Part[] = [];
  /** rosto, sem contorno */
  const F: Part[] = [];
  /** por cima de tudo, com contorno próprio: braços erguidos e objetos das animações */
  const O: Part[] = [];
  /** gotas e polegar: 1px, sem contorno */
  const FX: Part[] = [];

  const u = look.uniform;
  const skin = look.skin;
  const dir = f.dir;
  const side = dir === "left" || dir === "right";
  const back = dir === "up";
  const view: AccessoryCtx["view"] = side ? "side" : back ? "back" : "front";
  const tailored = u.kind === "blazer" || u.kind === "terno";
  const polo = u.kind === "polo";
  const inner = u.inner ?? palette.white;
  const forearm = polo ? skin : u.shirtShade;
  const hasWatch = look.accessories.includes("relogio");
  const hasHelmet = look.accessories.some((a) => HELMETS.has(a));
  const st = f.step / ANIM_STEPS;
  const anim = f.anim;
  const longAnim = anim && anim !== "stretch" && anim !== "cheer" ? anim : undefined;
  // crachá: branco com topo marinho; na camisa branca inverte; visitante todo na cor do cordão
  // crachá: branco com topo marinho; na camisa branca inverte; visitante: topo marinho e corpo na cor do cordão
  const badgeTop = u.visitor ? palette.navy900 : u.kind === "camisa" ? u.accent : palette.navy900;
  const badgeBody = u.visitor ? u.accent : u.kind === "camisa" ? palette.navy900 : palette.white;

  const ty = by - LEG_H - TORSO_H - f.rise;
  const tw = side ? 6 : 8;
  const tx = bx - tw / 2;
  const waist = look.feminine ? 1 : 0;
  const torsoRow = (r: number): [number, number] => {
    if (waist && (r === 4 || r === 5)) return side ? [tx + 1, tw - 1] : [tx + 1, tw - 2];
    return [tx, tw];
  };

  // ---------------- pernas (sentado ficam escondidas pela mesa)
  if (!f.sitting) {
    const legTop = by - LEG_H - f.rise;
    const legH = by - 1 - legTop;
    if (side) {
      // uma perna à frente e outra atrás; a de trás um tom mais escura
      const d = f.walk === 0 ? 2 : f.walk === 2 ? -2 : 0;
      const far = blend(u.pants, palette.navy950, 0.3);
      for (const [lx, color] of [
        [bx - 2 - d, far],
        [bx - 1 + d, u.pants],
      ] as const) {
        L.push([lx, legTop, 3, legH, color]);
        L.push([lx + 1, by - 1, 3, 1, u.shoes]);
      }
    } else {
      for (const [i, lx] of [
        [0, bx - 4],
        [1, bx + 1],
      ] as const) {
        const up = (f.walk === 0 && i === 0) || (f.walk === 2 && i === 1) ? 1 : 0;
        L.push([lx, legTop - up, 3, legH, u.pants]);
        L.push([lx, by - 1 - up, 3, 1, u.shoes]);
      }
    }
  }

  // ---------------- tronco
  for (const [r, h, color] of [
    [0, 4, u.shirt],
    [4, 1, u.shirt],
    [5, 1, u.shirtShade],
    [6, 1, u.shirtShade],
  ] as const) {
    const [x, w] = torsoRow(r);
    L.push([x, ty + r, w, h, color]);
  }

  if (dir === "down") {
    if (tailored) {
      // paletó nas laterais, camisa no centro em V
      L.push([bx - 2, ty, 4, 1, inner]);
      L.push([bx - 1, ty + 1, 2, 2, inner]);
      L.push([bx - 3, ty, 1, 3, u.shirtShade]);
      L.push([bx + 2, ty, 1, 3, u.shirtShade]);
      if (u.tie) L.push([bx - 1, ty + 1, 2, 4, u.tie]);
      if (u.trim === "lenco") L.push([bx + 2, ty + 3, 2, 1, u.accent]);
    } else {
      const collar = u.trim === "gola" ? u.accent : u.shirtShade;
      L.push([bx - 3, ty, 2, 1, collar]);
      L.push([bx + 1, ty, 2, 1, collar]);
      if (u.kind === "camisa") {
        L.push([bx - 2, ty + 1, 1, 1, collar]);
        L.push([bx + 1, ty + 1, 1, 1, collar]);
      }
    }
  } else if (back) {
    L.push([bx - 2, ty, 4, 1, tailored ? inner : u.trim === "gola" ? u.accent : u.shirtShade]); // gola
    L.push([tx + 1, ty + 2, tw - 2, 2, u.accent]); // faixa nas costas
  } else {
    const front = tx + tw - 1;
    if (tailored) L.push([front, ty, 1, 3, inner]);
    if (u.tie) L.push([front, ty + 1, 1, 3, u.tie]);
  }

  const accCtx = (into: Part[], slot?: Slot): AccessoryCtx => {
    const put = (x: number, y: number, w: number, h: number, color: string) => into.push([x, y, w, h, color]);
    return {
      look,
      view,
      put,
      head: (rx, ry, w, h, color) => put(hx + rx, hy + ry, w, h, color),
      tx,
      ty,
      tw,
      torsoRow,
      slot,
    };
  };
  const layer = (camada: AccessoryLayer) => look.accessories.filter((a) => ACCESSORIES[a].camada === camada);

  // cabeça: digitar olhando o teclado e o celular abaixam 1px; o gole joga pra trás
  let headDy = 0;
  if (f.type >= 0 && f.type < 4 && f.type >> 1) headDy = 1;
  if (longAnim === "phone") headDy = 1;
  const sipPhase = st < 0.2 || st >= 0.8 ? 0 : st < 0.35 || st >= 0.65 ? 1 : 2;
  if (longAnim === "sip" && sipPhase === 2) headDy = -1;
  const hx = bx - HEAD_W / 2;
  const hy = ty - HEAD_H + headDy;

  // colete por cima da camisa; logo, cordão e crachá por cima dele
  for (const a of layer("tronco")) ACCESSORIES[a].draw(accCtx(L));

  if (dir === "down") {
    if (!tailored) for (const [lx, ly, w, h] of bitmapRuns(AG_CHEST, bx + 1, ty + 2)) L.push([lx, ly, w, h, u.logo]);
    if (u.lapelBadge) {
      // crachá AG preso na lapela
      L.push([bx + 2, ty + 3, 2, 2, palette.white]);
      L.push([bx + 2, ty + 3, 2, 1, palette.navy900]);
    } else {
      // cordão até o crachá 2x3 (sentado ele fica acima do tampo da mesa)
      L.push([bx - 4, ty, 1, 2, u.accent]);
      L.push([bx - 1, ty, 1, 2, u.accent]);
      L.push([bx - 3, ty + 2, 2, 1, badgeTop]);
      L.push([bx - 3, ty + 3, 2, 2, badgeBody]);
    }
  } else if (side && !u.lapelBadge) {
    L.push([bx, ty, 1, 2, u.accent]);
    L.push([bx, ty + 2, 1, 1, badgeTop]);
    L.push([bx, ty + 3, 2, 2, badgeBody]);
  }

  // ---------------- braços
  const hands: Slot[] = [];
  const wrists: Slot[] = [];
  const armDown = (into: Part[], ax: number, ay: number, len: number, s: -1 | 1): Slot => {
    const sleeve = polo ? 2 : len;
    into.push([ax, ay, 2, sleeve, u.shirtShade]);
    if (sleeve < len) into.push([ax, ay + sleeve, 2, len - sleeve, skin]);
    if (tailored) into.push([ax, ay + len - 1, 2, 1, inner]); // punho da camisa
    if (u.trim === "manga") into.push([ax, ay + (polo ? 1 : 2), 2, 1, u.accent]);
    into.push([ax, ay + len, 2, 2, skin]);
    if (s > 0) wrists.push({ x: ax, y: ay + len - 1, s, into });
    return { x: ax, y: ay + len, s, into };
  };
  const sleeveO = (x: number, y: number, h: number) => O.push([x, y, 2, h, u.shirtShade]);
  const foreO = (x: number, y: number, h = 2) => O.push([x, y, 2, h, forearm]);
  const handO = (x: number, y: number) => O.push([x, y, 2, 2, skin]);
  const putO = (x: number, y: number, w: number, h: number, color: string) => O.push([x, y, w, h, color]);

  /** braço erguido (espreguiçar/comemorar), escrito pro lado esquerdo e espelhado: coluna x (largura 2) → -x - 2 */
  const raised = (s: -1 | 1, p: ArmPose) => {
    if (p === "down") {
      armDown(L, s < 0 ? bx - 6 : bx + 4, ty + 1, 4, s);
      return;
    }
    const seg = (dx: number, dy: number, h: number, color: string) => O.push([bx + (s < 0 ? dx : -dx - 2), ty + dy, 2, h, color]);
    const cuff = tailored ? inner : s > 0 && hasWatch ? palette.props.watch : forearm;
    seg(-6, 0, 2, u.shirtShade); // ombro
    if (p === "diag") {
      seg(-7, -3, 3, forearm);
      seg(-7, -3, 1, cuff);
      seg(-8, -5, 2, skin);
    } else if (p === "fist") {
      // punho erguido ao lado da cabeça
      seg(-8, -3, 4, u.shirtShade);
      seg(-8, -6, 3, forearm);
      seg(-8, -6, 1, cuff);
      seg(-8, -9, 3, skin);
    } else {
      // espreguiçando: braços pra cima, mãos lá no alto da cabeça
      seg(-8, -4, 5, u.shirtShade);
      seg(-8, -8, 4, forearm);
      seg(-8, -8, 1, cuff);
      seg(-7, -11, 3, skin);
    }
  };

  const racket = (x: number, y: number, handleX: number, handleY: number, handleH: number) => {
    putO(handleX, handleY, 1, handleH, palette.furniture.wood);
    putO(x, y, 3, 3, palette.props.paddle);
    putO(x, y, 1, 1, blend(palette.props.paddle, palette.white, 0.45));
  };
  const wateringCan = (x: number, y: number) => {
    putO(x, y, 4, 3, palette.navy500);
    putO(x + 1, y - 1, 2, 1, palette.navy600);
    putO(x + 4, y + 1, 1, 1, palette.navy500);
    putO(x + 5, y + 2, 1, 1, palette.navy500);
    // gotas de 1px caindo do bico
    const k = f.step % 3;
    FX.push([x + 5, y + 4 + k * 2, 1, 1, palette.furniture.water]);
    FX.push([x + 6, y + 5 + ((k + 1) % 3) * 2, 1, 1, palette.furniture.waterLight]);
  };

  if (anim === "stretch" || anim === "cheer") {
    raised(-1, f.armL);
    raised(1, f.armR);
  } else if (longAnim && side) {
    // de perfil (virado pra direita): o braço da frente faz o gesto
    const ax = bx - 1;
    switch (longAnim) {
      case "sip":
        if (sipPhase === 0) {
          sleeveO(ax, ty + 1, 3);
          handO(bx + 1, ty + 3);
          cup(putO, bx + 3, ty + 2);
        } else {
          sleeveO(ax, ty + 1, 2);
          foreO(bx + 1, ty - 1);
          handO(bx + 2, sipPhase === 1 ? ty - 2 : ty - 3);
          cup(putO, bx + 4, sipPhase === 1 ? ty - 3 : ty - 4);
        }
        break;
      case "phone":
        sleeveO(ax, ty + 1, 3);
        handO(bx + 1, ty + 3);
        putO(bx + 3, ty + 1, 2, 4, palette.gray800);
        putO(bx + 3, ty + 2, 1, 2, palette.signal.think);
        FX.push([bx + 2, ty + 2 + (f.step & 1), 1, 1, skin]); // polegar
        break;
      case "swing":
        if (st > 0.8) {
          sleeveO(ax, ty, 2);
          foreO(bx + 1, ty - 2);
          handO(bx + 3, ty - 4);
          racket(bx + 4, ty - 9, bx + 5, ty - 6, 2);
        } else {
          sleeveO(ax, ty + 1, 3);
          handO(bx + 1, ty + 4);
          racket(bx + 1, ty - 1, bx + 2, ty + 2, 2);
        }
        break;
      case "chin":
        sleeveO(ax, ty + 1, 2);
        foreO(bx + 1, ty - 1);
        handO(bx + 3, ty - 2);
        break;
      case "water":
        sleeveO(ax, ty + 1, 3);
        handO(bx + 1, ty + 3);
        wateringCan(bx + 3, ty + 2);
        break;
    }
  } else if (longAnim) {
    // de frente ou de costas: o braço da direita da tela faz o gesto
    const rx = bx + 4;
    switch (longAnim) {
      case "sip":
        armDown(L, bx - 6, ty + 1, 4, -1);
        if (back) sleeveO(rx, ty + 1, sipPhase === 0 ? 3 : 2);
        else if (sipPhase === 0) {
          sleeveO(rx, ty + 1, 3);
          if (hasWatch) putO(rx, ty + 3, 2, 1, palette.props.watch);
          handO(bx + 3, ty + 3);
          cup(putO, bx, ty + 2);
        } else {
          sleeveO(rx, ty + 1, 2);
          foreO(bx + 3, ty - 1);
          if (hasWatch) putO(bx + 3, ty - 1, 2, 1, palette.props.watch);
          handO(bx + 3, sipPhase === 1 ? ty - 2 : ty - 3);
          // no canto da boca (centrado parecia um sorrisão)
          cup(putO, bx, sipPhase === 1 ? ty - 2 : ty - 4);
        }
        break;
      case "phone":
        sleeveO(bx - 6, ty + 1, 3);
        sleeveO(rx, ty + 1, 3);
        if (!back) {
          putO(bx - 2, ty + 1, 4, 4, palette.gray800);
          putO(bx - 1, ty + 2, 2, 2, palette.signal.think);
          handO(bx - 4, ty + 3);
          handO(bx + 2, ty + 3);
          FX.push([bx - 1 + (f.step & 1), ty + 2 + ((f.step >> 1) & 1), 1, 1, skin]); // polegar
        }
        break;
      case "swing":
        armDown(L, bx - 6, ty + 1, 4, -1);
        if (st > 0.8) {
          sleeveO(rx, ty, 2);
          foreO(bx + 5, ty - 2);
          handO(bx + 6, ty - 4);
          racket(bx + 6, ty - 9, bx + 7, ty - 6, 2);
        } else {
          sleeveO(rx, ty + 1, 3);
          handO(bx + 5, ty + 4);
          racket(bx + 5, ty - 1, bx + 6, ty + 2, 2);
        }
        break;
      case "chin":
        armDown(L, bx - 6, ty + 1, 4, -1);
        if (back) sleeveO(rx, ty + 1, 3);
        else {
          sleeveO(rx, ty + 1, 2);
          foreO(bx + 3, ty - 1);
          handO(bx + 1, ty - 2);
        }
        break;
      case "water":
        armDown(L, bx - 6, ty + 1, 4, -1);
        sleeveO(rx, ty + 1, 3);
        handO(bx + 5, ty + 3);
        wateringCan(bx + 7, ty + 2);
        break;
    }
  } else if (f.type >= 0) {
    // digitando: antebraços pra frente, mãos no teclado alternando com 1px de pulso
    const k = f.type < 4 ? f.type & 1 : -1;
    for (const [ax, s] of [
      [bx - 6, -1],
      [bx + 4, 1],
    ] as const) {
      L.push([ax, ty + 1, 2, polo ? 2 : 3, u.shirtShade]);
      if (polo) L.push([ax, ty + 3, 2, 1, skin]);
      if (u.trim === "manga") L.push([ax, ty + (polo ? 1 : 2), 2, 1, u.accent]);
      if (s > 0) wrists.push({ x: ax, y: ty + 3, s, into: L });
    }
    L.push([bx - 5, ty + 3 - (k === 0 ? 1 : 0), 2, 2, skin]);
    L.push([bx + 3, ty + 3 - (k === 1 ? 1 : 0), 2, 2, skin]);
  } else if (side) {
    hands.push(armDown(L, bx - 1 - f.swing, ty + 1, 4, 1));
  } else {
    hands.push(armDown(L, bx - 6, ty + 1 + f.swing, 4, -1));
    hands.push(armDown(L, bx + 4, ty + 1 - f.swing, 4, 1));
  }

  for (const a of layer("pulso")) for (const w of wrists) ACCESSORIES[a].draw(accCtx(w.into, w));

  // ---------------- objetos na mão (fora de animação) e acessórios de mão
  const takeHand = (prefer: -1 | 1): Slot | undefined => {
    const free = hands.filter((h) => !h.used);
    const h = free.find((x) => x.s === prefer) ?? free[0];
    if (h) h.used = true;
    return h;
  };
  if (f.holding && !anim && !f.sitting) {
    const h = takeHand(1);
    if (h) {
      const ox = (w: number) => (h.s > 0 ? h.x + 2 : h.x - w);
      const put = (x: number, y: number, w: number, hh: number, color: string) => h.into.push([x, y, w, hh, color]);
      if (f.holding === "copo") cup(put, ox(3), h.y - 1);
      else if (f.holding === "celular") {
        put(ox(2), h.y - 1, 2, 3, palette.gray800);
        put(ox(2), h.y, 1, 1, palette.signal.think);
      } else if (f.holding === "raquete") {
        put(ox(1), h.y + 1, 1, 1, palette.furniture.wood);
        put(ox(1) - 1, h.y + 2, 3, 3, palette.props.paddle);
      } else {
        put(ox(4), h.y, 4, 3, palette.navy500);
        put(ox(4) + 1, h.y - 1, 2, 1, palette.navy600);
      }
    }
  }
  if (!f.sitting && !back) {
    for (const a of layer("mao")) {
      const h = takeHand(ACCESSORIES[a].prefer ?? 1);
      if (h) ACCESSORIES[a].draw(accCtx(h.into, h));
    }
  }

  // ---------------- cabeça (cantos arredondados) e cabelo
  L.push([hx + 1, hy, HEAD_W - 2, HEAD_H, skin]);
  L.push([hx, hy + 1, HEAD_W, HEAD_H - 2, skin]);
  const hair: Part[] = [];
  pushHair(hair, look, view, hx, hy);
  for (const p of hair) {
    if (!hasHelmet) L.push(p);
    else {
      // o capacete esconde o topo do cabelo (e o coque): corta o que fica acima da aba
      const cut = hy + 2;
      const bottom = p[1] + p[3];
      if (bottom > cut) L.push([p[0], Math.max(p[1], cut), p[2], bottom - Math.max(p[1], cut), p[4]]);
    }
  }
  for (const a of layer("cabeca")) ACCESSORIES[a].draw(accCtx(L));

  // ---------------- rosto (de costas não tem)
  if (!back) {
    const eye = theme.colors.outline;
    const brow = look.hair;
    const blush = blend(skin, palette.props.blush, 0.45);
    const fp = (rx: number, ry: number, w: number, h: number, color: string) => F.push([hx + rx, hy + ry, w, h, color]);
    const cheer = anim === "cheer";
    if (side) {
      if (f.blink) fp(8, 6, 2, 1, eye);
      else {
        fp(8, 5, 2, 2, eye);
        fp(9, 5, 1, 1, palette.white);
      }
      if (f.mood === "esperando") fp(8, 2, 2, 1, brow);
      else if (f.mood === "pensando") {
        fp(8, 3, 1, 1, brow);
        fp(9, 2, 1, 1, brow);
      } else fp(8, 3, 2, 1, brow);
      if (look.feminine) fp(7, 4, 1, 1, eye);
      fp(7, 7, 2, 1, blush);
    } else {
      // olhar: mão no queixo olha pros lados
      const gx = longAnim === "chin" ? (st < 0.5 ? 1 : -1) : 0;
      for (const ex of [2 + gx, 8 + gx]) {
        if (f.blink) fp(ex, 6, 2, 1, eye);
        else {
          fp(ex, 5, 2, 2, eye);
          fp(ex, 5, 1, 1, palette.white); // brilho
        }
      }
      const browY = f.mood === "esperando" ? 2 : 3;
      fp(2, browY, 2, 1, brow);
      if (f.mood === "pensando") {
        fp(8, 3, 1, 1, brow);
        fp(9, 2, 1, 1, brow);
      } else fp(8, browY, 2, 1, brow);
      if (look.feminine) {
        // cílio no canto de fora de cada olho
        fp(1 + gx, 4, 1, 1, eye);
        fp(10 + gx, 4, 1, 1, eye);
      }
      fp(1, 7, 2, 1, blush);
      fp(9, 7, 2, 1, blush);
    }
    for (const a of layer("rosto")) ACCESSORIES[a].draw(accCtx(F));
    // boca por último (por cima da barba)
    if (side) fp(cheer ? 9 : 10, 8, cheer ? 2 : 1, 1, cheer ? eye : blend(skin, eye, 0.6));
    else fp(5, 8, cheer ? 2 : 1, 1, cheer ? eye : blend(skin, eye, 0.6));
  }

  // ---------------- perfil pra esquerda: espelha tudo em torno do centro do corpo
  if (dir === "left") for (const list of [L, F, O, FX]) for (const p of list) p[0] = 2 * bx - p[0] - p[2];

  // ---------------- tinta: contorno (tudo 1px maior em escuro) e cores
  const outline = (list: Part[]) => {
    ctx.fillStyle = theme.colors.outline;
    for (const [px, py, w, h] of list) ctx.fillRect(px - 1, py - 1, w + 2, h + 2);
  };
  const paint = (list: Part[]) => {
    for (const [px, py, w, h, color] of list) {
      ctx.fillStyle = color;
      ctx.fillRect(px, py, w, h);
    }
  };
  outline(L);
  paint(L);
  paint(F);
  // segundo passe com contorno próprio: 1px escuro separa braço, copo e cabelo
  outline(O);
  paint(O);
  paint(FX);
}

/**
 * Cabelo com realce de 1px, em coordenadas relativas à cabeça 12x10 (hx, hy).
 * Nada passa de hy - 4 em cima (o coque) nem de 2px pra fora da cabeça nos lados: com o contorno
 * fica dentro da HIT_BOX. De perfil é desenhado virado pra direita (a nuca fica à esquerda).
 */
function pushHair(parts: Part[], look: CharLook, view: AccessoryCtx["view"], hx: number, hy: number) {
  const c = look.hair;
  const hl = blend(c, palette.white, 0.35);
  const h = (rx: number, ry: number, w: number, hh: number, color = c) => parts.push([hx + rx, hy + ry, w, hh, color]);
  const style = ((look.hairStyle % HAIR_STYLE_COUNT) + HAIR_STYLE_COUNT) % HAIR_STYLE_COUNT;
  const front = view === "front";
  const side = view === "side";
  const back = view === "back";

  /** touca básica: topo 2 linhas acima da cabeça até a linha 1 (a testa fica livre pra sobrancelha) */
  const cap = (backRows = 8) => {
    h(1, -2, 10, 1);
    if (back) h(0, -1, 12, backRows);
    else h(0, -1, 12, 3);
    if (side) h(0, 2, 6, 4); // nuca
    h(3, -2, 3, 1, hl);
  };

  switch (style) {
    case 2: {
      // raspado: 1 linha rente no topo e o resto pontilhado, mostrando a forma da cabeça
      const dots = (rx: number, ry: number, w: number, rows: number) => {
        for (let j = 0; j < rows; j++) for (let i = (j % 2); i < w; i += 2) h(rx + i, ry + j, 1, 1);
      };
      h(1, -1, 10, 1);
      dots(1, 0, 10, 1);
      if (back) dots(0, 1, 12, 5);
      else if (side) dots(0, 1, 5, 4);
      else {
        dots(0, 1, 1, 3);
        dots(11, 1, 1, 3);
      }
      h(3, -1, 2, 1, hl);
      return;
    }
    case 5: // cacheado volumoso
      h(1, -3, 4, 1);
      h(7, -3, 4, 1);
      h(-1, -2, 14, back ? 10 : 4);
      if (side) h(-1, 2, 7, 5);
      else if (front) {
        h(-1, 2, 2, 5);
        h(11, 2, 2, 5);
      }
      h(2, -3, 1, 1, hl);
      h(8, -3, 2, 1, hl);
      h(-1, 0, 1, 1, hl);
      h(12, 0, 1, 1, hl);
      return;
    case 7: // chanel: liso, franja reta e corte reto na altura do queixo
      h(1, -2, 10, 1);
      if (back) h(-1, -1, 14, 10);
      else {
        h(0, -1, 12, 3);
        if (side) {
          h(-1, 0, 7, 9);
          h(11, 1, 1, 5);
        } else {
          h(-1, 0, 2, 9);
          h(11, 0, 2, 9);
        }
      }
      h(3, -2, 3, 1, hl);
      if (!back) h(side ? 0 : -1, 2, 1, 4, hl);
      return;
    case 8: {
      // tranças: touca rente e tranças com textura (realce linha sim, linha não)
      cap(7);
      const braid = (rx: number, ry: number, w: number, len: number) => {
        h(rx, ry, w, len);
        for (let i = 0; i < len; i += 2) h(rx, ry + i, 1, 1, hl);
      };
      if (back) for (const rx of [0, 3, 7, 10]) braid(rx, 6, 2, 6);
      else if (side) braid(-1, 1, 3, 10);
      else {
        braid(-1, 2, 2, 9);
        braid(11, 2, 2, 9);
      }
      return;
    }
  }

  // curto, comprido, coque, rabo de cavalo e franja lateral partem da touca
  const long = style === 1;
  cap(long ? 12 : 8);
  if (long) {
    if (back) h(-1, -1, 14, 12);
    else if (side) h(-1, 0, 7, 11);
    else {
      h(-1, 0, 2, 11);
      h(11, 0, 2, 11);
      h(-1, 3, 1, 3, hl);
    }
  } else if (front && style !== 3 && style !== 4) {
    // costeletas (coque e rabo puxam o cabelo pra trás)
    h(0, 2, 1, 2);
    h(11, 2, 1, 2);
  }

  if (style === 3) {
    // coque arredondado no alto (de perfil vai pra nuca)
    const bx0 = side ? 1 : 4;
    h(bx0 + 1, -4, 2, 1);
    h(bx0, -3, 4, 2);
    h(bx0 + 1, -4, 1, 1, hl);
  } else if (style === 4) {
    if (back) h(5, 7, 2, 5);
    else if (front) h(12, 3, 1, 4); // ponta do rabo saindo atrás da cabeça
    else if (side) h(-1, 1, 2, 6);
    if (back) h(5, 8, 1, 1, hl);
    else if (side) h(-1, 2, 1, 1, hl);
  } else if (style === 6 && !back) {
    // franja caindo pro lado (deixa a sobrancelha livre)
    if (side) h(10, 2, 2, 1);
    else h(5, 2, 3, 1);
  }
}

/** Escolhe aparência fixa a partir do id (o mesmo agente sempre tem a mesma cara). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
