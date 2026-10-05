// Personagens pixel art desenhados por código (sem imagens), então dá pra trocar
// uniforme, pele e cabelo só mudando cores. Coordenadas em pixels da resolução base;
// (x, y) é o ponto entre os pés.
//
// Proporção chibi: cabeça 12x10, tronco 7 e pernas 4 (uns 24 px com o cabelo).
// Cada quadro é desenhado uma vez num canvas pequeno (spriteCache) e depois só copiado.
//
// Partes em arquivos próprios (este reexporta a API): body.ts (cores e medidas), frame.ts (tempos,
// piscar e frameOf), hair.ts (cabelos) e accessories.ts (acessórios).

import type { Acessorio } from "../../../shared/roster";
import type { Uniform } from "../theme";
import { palette, theme } from "../theme";
import { AG_CHEST, bitmapRuns } from "./agMark";
import { ACCESSORIES, HELMETS, cup, type AccessoryCtx, type AccessoryLayer, type Slot } from "./accessories";
import { HEAD_H, HEAD_TOP_STAND, HEAD_W, LEG_H, SIT_DROP, TORSO_H, blend, type Part } from "./body";
import { ANIM_STEPS, animLift, frameKey, frameOf, type ArmPose, type SpriteFrame } from "./frame";
import { pushHair } from "./hair";
import { SPRITE_H, SPRITE_OX, SPRITE_OY, SPRITE_W, cachedSprite } from "./spriteCache";

export { ACCESSORIES, type AccessoryCtx, type AccessoryDef, type AccessoryLayer } from "./accessories";
export { HEAD_TOP_SIT, HEAD_TOP_STAND, HIT_BOX, SIT_DROP } from "./body";
export { animLift, frameOf, type ArmPose, type SpriteFrame } from "./frame";
export { HAIR_STYLE_COUNT } from "./hair";

export type Dir = "down" | "up" | "left" | "right";

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

/**
 * Desenha o boneco com o ponto entre os pés em (x, y). `usarCache = false` desenha direto, sem
 * guardar o quadro: é o que o vestiário usa pra pré-visualizar um visual ainda não salvo.
 */
export function drawCharacter(ctx: CanvasRenderingContext2D, x: number, y: number, look: CharLook, pose: CharPose, usarCache = true) {
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
  const sprite = usarCache
    ? cachedSprite(`${lookKey(look)}|${f.dir}|${frameKey(f)}`, (c) => renderSprite(c, SPRITE_OX, SPRITE_OY, look, f))
    : null;
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
 * e pixel duro, ampliado `escala` vezes a partir de (x, y). `usarCache = false`: desenha num
 * canvas temporário e não guarda nada (pré-visualização do vestiário).
 */
export function drawPortrait(ctx: CanvasRenderingContext2D, look: CharLook, escala: number, x = 0, y = 0, usarCache = true) {
  const s = Math.max(1, Math.round(escala));
  // sem os objetos de mão (prancheta, caneca): no recorte do busto viravam um pedaço solto
  const bust: CharLook = { ...look, accessories: look.accessories.filter((x) => ACCESSORIES[x].camada !== "mao") };
  const paint = (c: CanvasRenderingContext2D) => renderSprite(c, SPRITE_OX, SPRITE_OY, bust, PORTRAIT_FRAME);
  const sprite = usarCache ? cachedSprite(`${lookKey(look)}|retrato|${frameKey(PORTRAIT_FRAME)}`, paint) : freshSprite(paint);
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

/** canvas temporário do tamanho de um quadro, fora do cache */
function freshSprite(paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_W;
  canvas.height = SPRITE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  paint(ctx);
  return canvas;
}

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
    // barba antes do rosto: os óculos ficam por cima
    for (const a of layer("pelos")) ACCESSORIES[a].draw(accCtx(F));
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

/** Escolhe aparência fixa a partir do id (o mesmo agente sempre tem a mesma cara). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
