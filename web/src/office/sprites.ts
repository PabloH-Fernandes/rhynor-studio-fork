// Personagens pixel art desenhados por código (sem imagens), então dá pra trocar
// uniforme, pele e cabelo só mudando cores. Coordenadas em pixels da resolução base;
// (x, y) é o ponto entre os pés.

import type { Uniform } from "../theme";
import { palette, theme } from "../theme";
import { AG_CHEST, bitmapRuns } from "./agMark";

export type Dir = "down" | "up" | "left" | "right";

export type Accessory = "nenhum" | "oculos" | "headset" | "lapis" | "barba" | "relogio";

/** 0 curto, 1 comprido, 2 raspado, 3 coque, 4 rabo de cavalo, 5 cacheado volumoso, 6 franja lateral */
export const HAIR_STYLE_COUNT = 7;

export interface CharLook {
  uniform: Uniform;
  skin: string;
  hair: string;
  hairStyle: number;
  accessory: Accessory;
}

export interface CharPose {
  dir: Dir;
  walking: boolean;
  sitting: boolean;
  typing: boolean;
  /** tempo em ms, usado nas animações */
  t: number;
  /** pra cada personagem não animar sincronizado */
  phase: number;
  alpha?: number;
}

type Part = [x: number, y: number, w: number, h: number, color: string];

export function drawCharacter(ctx: CanvasRenderingContext2D, x: number, y: number, look: CharLook, pose: CharPose) {
  const parts: Part[] = [];
  const { uniform: u } = look;
  const tailored = u.kind === "blazer" || u.kind === "terno";
  const inner = u.inner ?? palette.white;
  // crachá: branco com topo marinho; na camisa branca inverte (marinho com topo na cor do papel); visitante todo cinza
  const badgeTop = u.visitor ? u.accent : u.kind === "camisa" ? u.accent : palette.navy900;
  const badgeBody = u.visitor ? u.accent : u.kind === "camisa" ? palette.navy900 : palette.white;
  const walkFrame = pose.walking ? Math.floor((pose.t + pose.phase) / 140) % 4 : 0;
  const step = walkFrame === 1 ? 1 : walkFrame === 3 ? -1 : 0;
  const bob = pose.walking && walkFrame % 2 === 1 ? -1 : 0;
  const by = Math.round(y + bob + (pose.sitting ? 2 : 0));
  const bx = Math.round(x);
  const side = pose.dir === "left" || pose.dir === "right";
  const flip = pose.dir === "left" ? -1 : 1;

  // ---------------- pernas
  if (!pose.sitting) {
    if (side) {
      parts.push([bx - 2 + step * flip, by - 6, 3, 5, u.pants]);
      parts.push([bx - 1 - step * flip, by - 6, 3, 5, u.pants]);
      parts.push([bx - 2 + step * flip + (flip > 0 ? 1 : -1), by - 1, 3, 1, u.shoes]);
      parts.push([bx - 1 - step * flip + (flip > 0 ? 1 : -1), by - 1, 3, 1, u.shoes]);
    } else {
      parts.push([bx - 4, by - 6 - (step > 0 ? 1 : 0), 3, 5, u.pants]);
      parts.push([bx + 1, by - 6 - (step < 0 ? 1 : 0), 3, 5, u.pants]);
      parts.push([bx - 4, by - 1 - (step > 0 ? 1 : 0), 3, 1, u.shoes]);
      parts.push([bx + 1, by - 1 - (step < 0 ? 1 : 0), 3, 1, u.shoes]);
    }
  }

  // ---------------- tronco
  const torsoW = side ? 7 : 10;
  const tx = bx - Math.floor(torsoW / 2);
  const ty = by - 13;
  parts.push([tx, ty, torsoW, 8, u.shirt]);
  parts.push([tx, ty + 6, torsoW, 2, u.shirtShade]);

  if (pose.dir === "down") {
    if (tailored) {
      // paletó nas laterais, camisa no centro em V
      parts.push([bx - 2, ty, 4, 2, inner]);
      parts.push([bx - 1, ty + 2, 2, 2, inner]);
      parts.push([bx - 3, ty, 1, 3, u.shirtShade]);
      parts.push([bx + 2, ty, 1, 3, u.shirtShade]);
      if (u.tie) parts.push([bx - 1, ty + 1, 1, 4, u.tie]);
      if (u.trim === "lenco") parts.push([bx + 2, ty + 3, 2, 1, u.accent]);
    } else {
      const collar = u.trim === "gola" ? u.accent : u.shirtShade;
      parts.push([bx - 3, ty, 2, 1, collar]);
      parts.push([bx + 1, ty, 2, 1, collar]);
      if (u.kind === "camisa") {
        parts.push([bx - 2, ty + 1, 1, 1, collar]);
        parts.push([bx + 1, ty + 1, 1, 1, collar]);
      }
      for (const [lx, ly, w, h] of bitmapRuns(AG_CHEST, bx + 1, ty + 2)) parts.push([lx, ly, w, h, u.logo]);
    }
    if (u.lapelBadge) {
      // crachá AG preso na lapela
      parts.push([bx + 2, ty + 3, 2, 2, palette.white]);
      parts.push([bx + 2, ty + 3, 2, 1, palette.navy900]);
    } else {
      // cordão em V até o crachá 2x3 (branco com topo marinho)
      parts.push([bx - 4, ty, 1, 2, u.accent]);
      parts.push([bx - 3, ty + 2, 1, 2, u.accent]);
      parts.push([bx - 1, ty, 1, 2, u.accent]);
      parts.push([bx - 2, ty + 2, 1, 2, u.accent]);
      parts.push([bx - 3, ty + 4, 2, 1, badgeTop]);
      parts.push([bx - 3, ty + 5, 2, 2, badgeBody]);
    }
  } else if (pose.dir === "up") {
    parts.push([bx - 2, ty, 4, 1, tailored ? inner : u.trim === "gola" ? u.accent : u.shirtShade]); // gola
    parts.push([tx + 1, ty + 2, torsoW - 2, 2, u.accent]); // faixa nas costas
  } else {
    const front = flip > 0 ? tx + torsoW - 1 : tx;
    if (tailored) parts.push([front, ty, 1, 3, inner]);
    if (u.tie) parts.push([front, ty + 1, 1, 3, u.tie]);
    if (!u.lapelBadge) {
      // de lado: cordão curto + crachá (comprido demais parecia gravata)
      const cx = flip > 0 ? bx + 1 : bx - 1;
      parts.push([cx, ty, 1, 2, u.accent]);
      parts.push([cx, ty + 2, 1, 1, badgeTop]);
      parts.push([flip > 0 ? cx : cx - 1, ty + 3, 2, 2, badgeBody]);
    }
  }

  // ---------------- braços
  const arm = (ax: number, ay: number, len: number, wrist: boolean) => {
    const sleeve = u.kind === "polo" ? 2 : len;
    parts.push([ax, ay, 2, sleeve, u.shirtShade]);
    if (sleeve < len) parts.push([ax, ay + sleeve, 2, len - sleeve, look.skin]);
    if (tailored) parts.push([ax, ay + len - 1, 2, 1, inner]); // punho da camisa
    if (u.trim === "manga") parts.push([ax, ay + (u.kind === "polo" ? 1 : 2), 2, 1, u.accent]);
    if (wrist && look.accessory === "relogio") parts.push([ax, ay + len - 1, 2, 1, palette.props.watch]);
  };
  const swing = pose.walking ? step : 0;
  if (pose.typing) {
    const k = Math.floor((pose.t + pose.phase) / 110) % 2;
    arm(bx - 6, ty + 1, 5, false);
    arm(bx + 4, ty + 1, 5, true);
    parts.push([bx - 5, ty + 5 + (k ? -1 : 0), 3, 2, look.skin]);
    parts.push([bx + 2, ty + 5 + (k ? 0 : -1), 3, 2, look.skin]);
  } else if (side) {
    arm(bx - 1 + swing * flip, ty + 1, 6, true);
    parts.push([bx - 1 + swing * flip, ty + 7, 2, 2, look.skin]);
  } else {
    arm(bx - 6, ty + 1 + swing, 6, false);
    arm(bx + 4, ty + 1 - swing, 6, true);
    parts.push([bx - 6, ty + 7 + swing, 2, 2, look.skin]);
    parts.push([bx + 4, ty + 7 - swing, 2, 2, look.skin]);
  }

  // ---------------- cabeça
  const hx = bx - 4;
  const hy = ty - 8;
  parts.push([hx, hy, 8, 8, look.skin]);
  pushHair(parts, look, pose.dir, hx, hy);
  pushAccessory(parts, look, pose.dir, hx, hy);

  // ---------------- desenho: sombra, contorno (tudo 1px maior em escuro) e cores
  const alpha = pose.alpha ?? 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (!pose.sitting) {
    const gy = Math.round(y);
    ctx.fillStyle = palette.props.shadow;
    ctx.fillRect(bx - 6, gy, 12, 1);
    ctx.fillRect(bx - 4, gy - 1, 8, 3);
  }
  ctx.fillStyle = theme.colors.outline;
  for (const [px, py, w, h] of parts) ctx.fillRect(px - 1, py - 1, w + 2, h + 2);
  for (const [px, py, w, h, color] of parts) {
    ctx.fillStyle = color;
    ctx.fillRect(px, py, w, h);
  }

  // olhos por último (piscam de vez em quando)
  const blink = (pose.t + pose.phase * 7) % 3800 < 120;
  if (pose.dir !== "up") {
    ctx.fillStyle = theme.colors.outline;
    const eyeH = blink ? 1 : 2;
    const eyeY = hy + 3 + (blink ? 1 : 0);
    if (pose.dir === "down") {
      ctx.fillRect(hx + 2, eyeY, 1, eyeH);
      ctx.fillRect(hx + 5, eyeY, 1, eyeH);
    } else {
      ctx.fillRect(flip > 0 ? hx + 5 : hx + 2, eyeY, 1, eyeH);
    }
  }
  ctx.restore();
}

/**
 * Cabelo com 1px de realce. Nada passa de hy - 3 (o contorno fica em y - 25),
 * dentro da caixa de clique de 26px do hitTest.
 */
function pushHair(parts: Part[], look: CharLook, dir: Dir, hx: number, hy: number) {
  const c = look.hair;
  const hl = lighten(c);
  const up = dir === "up";
  const side = dir === "left" || dir === "right";
  const flip = dir === "left" ? -1 : 1;
  const style = ((look.hairStyle % HAIR_STYLE_COUNT) + HAIR_STYLE_COUNT) % HAIR_STYLE_COUNT;

  if (style === 2) {
    // raspado: rente à cabeça
    parts.push([hx, hy - 1, 8, 2, c]);
    if (up) parts.push([hx, hy, 8, 5, c]);
    else if (side) parts.push([flip > 0 ? hx : hx + 5, hy, 3, 4, c]);
    else {
      parts.push([hx, hy + 1, 1, 2, c]);
      parts.push([hx + 7, hy + 1, 1, 2, c]);
    }
    parts.push([hx + 2, hy - 1, 2, 1, hl]);
    return;
  }

  if (style === 5) {
    // cacheado volumoso
    parts.push([hx - 2, hy - 3, 12, 4, c]);
    if (up) parts.push([hx - 2, hy, 12, 7, c]);
    else if (side) parts.push([flip > 0 ? hx - 2 : hx + 4, hy, 6, 7, c]);
    else {
      parts.push([hx - 2, hy + 1, 2, 5, c]);
      parts.push([hx + 8, hy + 1, 2, 5, c]);
    }
    parts.push([hx - 1, hy - 2, 1, 1, hl]);
    parts.push([hx + 3, hy - 3, 2, 1, hl]);
    parts.push([hx + 7, hy - 2, 1, 1, hl]);
    return;
  }

  // curto, comprido, coque, rabo de cavalo e franja lateral partem da mesma base
  const long = style === 1;
  parts.push([hx - 1, hy - 1, 10, 3, c]);
  if (up) parts.push([hx - 1, hy, 10, long ? 9 : 7, c]);
  else if (side) parts.push([flip > 0 ? hx - 1 : hx + 5, hy, 4, long ? 9 : 5, c]);
  else {
    parts.push([hx - 1, hy + 1, 2, long ? 8 : 3, c]);
    parts.push([hx + 7, hy + 1, 2, long ? 8 : 3, c]);
  }

  if (style === 3) {
    const bunX = side ? (flip > 0 ? hx : hx + 4) : hx + 2;
    parts.push([bunX, hy - 3, 4, 2, c]);
    parts.push([bunX + 1, hy - 3, 1, 1, hl]);
  } else {
    parts.push([hx + 1, hy - 1, 2, 1, hl]);
  }

  if (style === 4) {
    if (up) parts.push([hx + 3, hy + 7, 2, 4, c]);
    else if (side) parts.push([flip > 0 ? hx - 2 : hx + 8, hy + 2, 2, 5, c]);
  }

  if (style === 6 && !up) {
    if (side) parts.push([flip > 0 ? hx + 4 : hx, hy + 2, 4, 1, c]);
    else parts.push([hx + 3, hy + 2, 4, 1, c]);
  }
}

function pushAccessory(parts: Part[], look: CharLook, dir: Dir, hx: number, hy: number) {
  const up = dir === "up";
  const side = dir === "left" || dir === "right";
  const flip = dir === "left" ? -1 : 1;

  switch (look.accessory) {
    case "oculos": {
      if (up) return;
      const frame = palette.gray800;
      const glint = palette.navy100;
      if (side) {
        parts.push([flip > 0 ? hx + 4 : hx + 1, hy + 2, 3, 1, frame]);
        parts.push([flip > 0 ? hx + 6 : hx + 1, hy + 3, 1, 2, glint]);
        parts.push([flip > 0 ? hx + 2 : hx + 4, hy + 3, 2, 1, frame]);
      } else {
        parts.push([hx + 1, hy + 2, 6, 1, frame]);
        parts.push([hx, hy + 3, 1, 1, frame]);
        parts.push([hx + 7, hy + 3, 1, 1, frame]);
        parts.push([hx + 1, hy + 3, 1, 2, glint]);
        parts.push([hx + 4, hy + 3, 1, 2, glint]);
      }
      return;
    }
    case "headset": {
      const band = palette.gray800;
      const cup = palette.gray600;
      if (side) {
        parts.push([hx + 1, hy - 2, 6, 1, band]);
        parts.push([hx + 3, hy + 2, 2, 3, cup]);
        parts.push([flip > 0 ? hx + 5 : hx, hy + 6, 3, 1, band]);
      } else {
        parts.push([hx - 1, hy - 2, 10, 1, band]);
        parts.push([hx - 2, hy + 2, 2, 3, cup]);
        parts.push([hx + 8, hy + 2, 2, 3, cup]);
        if (!up) {
          parts.push([hx, hy + 6, 3, 1, band]);
          parts.push([hx + 3, hy + 6, 1, 1, look.uniform.accent]);
        }
      }
      return;
    }
    case "lapis": {
      const { pencil, pencilTip } = palette.props;
      if (side) {
        parts.push([hx + 2, hy + 1, 4, 1, pencil]);
        parts.push([flip > 0 ? hx + 6 : hx + 1, hy + 1, 1, 1, pencilTip]);
      } else {
        const px = up ? hx - 1 : hx + 8;
        parts.push([px, hy, 1, 3, pencil]);
        parts.push([px, hy + 3, 1, 1, pencilTip]);
      }
      return;
    }
    case "barba": {
      if (up) return;
      if (side) parts.push([flip > 0 ? hx + 2 : hx, hy + 5, 6, 3, look.hair]);
      else {
        parts.push([hx, hy + 5, 8, 3, look.hair]);
        parts.push([hx + 3, hy + 6, 2, 1, look.skin]); // boca
      }
      return;
    }
    // relógio fica no pulso (desenhado junto do braço); "nenhum" não desenha nada
    default:
      return;
  }
}

const lightCache = new Map<string, string>();
/** mistura a cor com branco: realce de 1px do cabelo */
function lighten(hex: string, amt = 0.35): string {
  let out = lightCache.get(hex);
  if (out) return out;
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 255;
    return Math.round(v + (255 - v) * amt);
  };
  out = `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
  lightCache.set(hex, out);
  return out;
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
