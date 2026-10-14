// Quadro quantizado dos bonecos: tempos, espreguiçar e comemorar, piscar e respirar, e o
// frameOf (pose contínua → quadro que vai pro cache) com a chave do quadro (frameKey).

import type { CharAnim, CharPose, Dir, Holding, Mood } from "./sprites";

/** passos das animações longas (gole, celular, raquete...) no cache */
export const ANIM_STEPS = 12;
const WALK_FRAME_MS = 140;
const TYPE_HAND_MS = 110;
const TYPE_GAZE_MS = 600;
const BREATH_MS = 1200;

// ------------------------------------------------------------------ espreguiçar e comemorar

/** baixo (normal), diagonal, mãos sobre a cabeça (espreguiçar) e punho erguido (comemorar) */
export type ArmPose = "down" | "diag" | "up" | "fist";

/** 5 quadros do espreguiçar: baixo → diagonal → acima (segura) → diagonal → baixo */
export function stretchArms(t: number): ArmPose {
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

/** ritmo do gesto de quem apresenta a reunião (braço direito) */
const PRESENT_MS = 800;

/** apresentando: o braço direito alterna diagonal e baixo; com reduced-motion fica parado na diagonal */
export function presentArm(t: number, reduced: boolean): ArmPose {
  if (reduced) return "diag";
  return Math.floor(t / PRESENT_MS) % 2 === 0 ? "diag" : "down";
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
  else if (anim === "present") armR = presentArm(p.t + p.phase, calm);
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

export function frameKey(f: SpriteFrame): string {
  return `${f.sitting ? 1 : 0}${f.walk + 1}${f.swing + 1}${f.rise}${f.blink ? 1 : 0}${f.type + 1}|${f.anim ?? ""}${f.step}|${f.armL}${f.armR}|${f.holding ?? ""}|${f.mood ?? ""}`;
}
