// Cabelos dos bonecos (9 estilos), desenhados por código em coordenadas da cabeça.

import { palette } from "../theme";
import { blend, type Part } from "./body";
import type { AccessoryCtx } from "./accessories";
import type { CharLook } from "./sprites";

/** 0 curto, 1 comprido, 2 raspado, 3 coque, 4 rabo de cavalo, 5 cacheado volumoso, 6 franja lateral, 7 chanel, 8 trancas */
export const HAIR_STYLE_COUNT = 9;

/**
 * Cabelo com realce de 1px, em coordenadas relativas à cabeça 12x10 (hx, hy).
 * Nada passa de hy - 4 em cima (o coque) nem de 2px pra fora da cabeça nos lados: com o contorno
 * fica dentro da HIT_BOX. De perfil é desenhado virado pra direita (a nuca fica à esquerda).
 */
export function pushHair(parts: Part[], look: CharLook, view: AccessoryCtx["view"], hx: number, hy: number) {
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
