// Personagens pixel art desenhados por código (sem imagens), então dá pra trocar
// uniforme, pele e cabelo só mudando cores. Coordenadas em pixels da resolução base;
// (x, y) é o ponto entre os pés.

import type { Uniform } from "../theme";
import { theme } from "../theme";

export type Dir = "down" | "up" | "left" | "right";

export interface CharLook {
  uniform: Uniform;
  skin: string;
  hair: string;
  hairStyle: number; // 0 curto, 1 comprido, 2 boné, 3 coque
  leader: boolean;
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
  const tx = bx - torsoW / 2;
  const ty = by - 13;
  parts.push([tx, ty, torsoW, 8, u.shirt]);
  parts.push([tx, ty + 6, torsoW, 2, u.shirtShade]);

  // ---------------- braços
  const swing = pose.walking ? step : 0;
  if (pose.typing) {
    const k = Math.floor((pose.t + pose.phase) / 110) % 2;
    parts.push([bx - 6, ty + 1, 2, 5, u.shirtShade]);
    parts.push([bx + 4, ty + 1, 2, 5, u.shirtShade]);
    parts.push([bx - 5, ty + 5 + (k ? -1 : 0), 3, 2, look.skin]);
    parts.push([bx + 2, ty + 5 + (k ? 0 : -1), 3, 2, look.skin]);
  } else if (side) {
    parts.push([bx - 1 + swing * flip, ty + 1, 2, 6, u.shirtShade]);
    parts.push([bx - 1 + swing * flip, ty + 7, 2, 2, look.skin]);
  } else {
    parts.push([bx - 6, ty + 1 + swing, 2, 6, u.shirtShade]);
    parts.push([bx + 4, ty + 1 - swing, 2, 6, u.shirtShade]);
    parts.push([bx - 6, ty + 7 + swing, 2, 2, look.skin]);
    parts.push([bx + 4, ty + 7 - swing, 2, 2, look.skin]);
  }

  // ---------------- cabeça
  const hx = bx - 4;
  const hy = ty - 8;
  parts.push([hx, hy, 8, 8, look.skin]);

  // cabelo
  const hair = look.hair;
  if (look.hairStyle === 2) {
    // boné na cor do uniforme
    parts.push([hx - 1, hy - 1, 10, 3, u.shirt]);
    if (pose.dir === "down") parts.push([hx, hy + 2, 8, 1, u.shirtShade]);
    else if (side) parts.push([flip > 0 ? hx + 6 : hx - 3, hy + 1, 5, 2, u.shirtShade]);
  } else {
    parts.push([hx - 1, hy - 1, 10, 3, hair]);
    if (pose.dir === "up") parts.push([hx - 1, hy, 10, 7, hair]);
    else if (side) parts.push([flip > 0 ? hx - 1 : hx + 5, hy, 4, 5, hair]);
    else {
      parts.push([hx - 1, hy + 1, 2, look.hairStyle === 1 ? 8 : 3, hair]);
      parts.push([hx + 7, hy + 1, 2, look.hairStyle === 1 ? 8 : 3, hair]);
    }
    if (look.hairStyle === 3) parts.push([hx + 2, hy - 3, 4, 3, hair]);
  }

  // ---------------- detalhes do uniforme
  if (pose.dir === "down") {
    parts.push([bx - 2, ty, 4, 1, u.accent]); // gola
    if (look.leader) parts.push([bx - 1, ty + 1, 2, 5, u.accent]); // gravata do líder
    else parts.push([bx + 1, ty + 2, 2, 3, u.accent]); // crachá
  } else if (pose.dir === "up") {
    parts.push([tx + 1, ty + 2, torsoW - 2, 2, u.accent]); // faixa nas costas
  }

  // ---------------- contorno (desenha tudo maior em escuro, depois por cima)
  const alpha = pose.alpha ?? 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (!pose.sitting) {
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(bx, Math.round(y), 6, 2, 0, 0, Math.PI * 2);
    ctx.fill();
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

/** Escolhe aparência fixa a partir do id (o mesmo agente sempre tem a mesma cara). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
