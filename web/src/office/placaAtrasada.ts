// Plaquinha de "atrasada": com pelo menos uma pendência atrasada, UM Personagem do time que está de boa segura uma
// plaquinha pequena (quadrado vermelho com "!" em pixel). Desenhada por cima do boneco e dos móveis (depois deles na ordem de desenho,
// antes da iluminação), direto no canvas:
// não mexe nos sprites nem no cache deles. Escolha determinística (menor id entre os elegíveis, e quem já segura
// continua segurando enquanto puder). Com prefers-reduced-motion a plaquinha fica parada.

import { palette } from "../theme";
import { fill } from "./decorBase";

export interface Retangulo {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** medidas da plaquinha em relação ao ponto entre os pés (lado direito; no esquerdo é espelhada) */
const PLACA = { w: 11, h: 14, dx: 6, dy: -21 } as const;

/**
 * Quem segura a plaquinha: `atual` se ainda for elegível, senão o menor id entre os elegíveis, senão ninguém.
 * Sem pendência atrasada (`ativa` falso) ninguém segura.
 */
export function escolherPortador(ativa: boolean, elegiveis: readonly string[], atual: string | null): string | null {
  if (!ativa || elegiveis.length === 0) return null;
  if (atual !== null && elegiveis.includes(atual)) return atual;
  return elegiveis.reduce((menor, id) => (id < menor ? id : menor));
}

const cruza = (a: Retangulo, b: Retangulo) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * O retângulo da plaquinha: à direita do boneco e, se bater numa área proibida de balão (placa, quadro, plaquinhas
 * das mesas, ping-pong), à esquerda. Null quando nenhum dos dois lados está livre (a plaquinha não aparece).
 */
export function lugarDaPlaca(x: number, y: number, proibidas: readonly Retangulo[]): { rect: Retangulo; lado: 1 | -1 } | null {
  const direita: Retangulo = { x: x + PLACA.dx, y: y + PLACA.dy, w: PLACA.w, h: PLACA.h };
  if (!proibidas.some((r) => cruza(direita, r))) return { rect: direita, lado: 1 };
  const esquerda: Retangulo = { x: x - PLACA.dx - PLACA.w + 1, y: y + PLACA.dy, w: PLACA.w, h: PLACA.h };
  if (!proibidas.some((r) => cruza(esquerda, r))) return { rect: esquerda, lado: -1 };
  return null;
}

/** desenha a plaquinha no retângulo dado; `movimento` falso = parada (reduced-motion) */
export function desenharPlaca(ctx: CanvasRenderingContext2D, rect: Retangulo, now: number, movimento: boolean) {
  // balança 1 px para cima a cada ~1,2 s (parada com reduced-motion)
  const sobe = movimento && Math.sin(now / 600) > 0.6 ? -1 : 0;
  const x = Math.round(rect.x);
  const y = Math.round(rect.y) + sobe;
  const tinta = palette.noite;
  fill(ctx, x + 5, y + 9, 1, 5, palette.furniture.woodShade); // cabo
  fill(ctx, x, y, 11, 9, tinta); // contorno
  fill(ctx, x + 1, y + 1, 9, 7, palette.signal.alert); // moldura vermelha
  fill(ctx, x + 2, y + 2, 7, 5, palette.white); // papel
  fill(ctx, x + 5, y + 2, 1, 3, tinta); // "!"
  fill(ctx, x + 5, y + 6, 1, 1, tinta);
}
