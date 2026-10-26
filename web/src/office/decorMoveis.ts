// Mobília do chão em pixel art: plantas, sofás, impressora, arara de figurino, balcão da recepção,
// ping-pong e bebedouro. Tudo em coordenadas inteiras da resolução base, sem arc/ellipse/gradiente.

import { navyAlpha, palette } from "../theme";
import { RHYNOR_LETTERS, bitmapWidth, drawBitmap } from "./pixelMarca";
import { type Ctx, fill } from "./decorBase";

const P = palette;

// ===================================================================== mobília do chão
// Cada função recebe a linha da BASE (onde a peça toca o chão): é esse y que entra em
// `items` pra ordenar por profundidade. Nada aqui pode cair nas lanes nem no corredor.

// lidos na hora do desenho (as cores vêm dos tokens, carregados depois dos módulos)
const F = P.furniture;
const out = () => P.navy950;
const shadow = () => navyAlpha(0.16);

/** bitmap de folhas em 3 tons: "l" claro, "m" médio, "d" escuro, "." vazio */
function drawLeaves(ctx: Ctx, rows: readonly string[], x: number, y: number) {
  const tone: Record<string, string> = { l: F.leafLight, m: F.leaf, d: F.leafDark };
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const c = tone[row[i]];
      if (c) fill(ctx, x + i, y + j, 1, 1, c);
    }
  });
}

const LEAVES_SMALL = [
  ".....l.l.....",
  "...l.lm.ml...",
  "..llmm.mmml..",
  ".lmmmmdmmdml.",
  ".lmmdmmdmmdm.",
  "llmmdmdmmdmmd",
  ".mmddmdmdmmd.",
  "lmmdmmddmdmdd",
  ".mdmdddmdddm.",
  "..mddmdddmd..",
  "...dddddddd..",
  "....d.d.d....",
] as const;

const LEAVES_BIG = [
  "......l.l......",
  ".....lm.ml.....",
  "...l.lmmml.l...",
  "..lm.mmdmm.ml..",
  "..lmmmmdmmmml..",
  ".lmmdmmdmdmmml.",
  ".lmmdmdmmdmmdm.",
  "..mmdmdmdmdmd..",
  ".l.mmddmddmm.l.",
  "lmm.mdddddm.mml",
  "lmmm.mdmdm.mmdm",
  ".mmdm.mdm.mmdd.",
  "..mddm.d.mddd..",
  "...mddmdmdd....",
  "....mdddddm....",
  ".....dd.dd.....",
  "......d.d......",
] as const;

/**
 * Planta em vaso branco com faixa escura e folhas em 3 tons, pixel a pixel.
 * Pequena: 19 px de altura acima da base. Grande: 27 px.
 */
export function drawPlant(ctx: Ctx, x: number, baseY: number, big = false) {
  x = Math.round(x);
  baseY = Math.round(baseY);
  const bodyW = big ? 10 : 8;
  const bodyH = big ? 8 : 6;
  const rimW = bodyW + 2;
  const rimTop = baseY - bodyH - 2;
  const leaves = big ? LEAVES_BIG : LEAVES_SMALL;
  const lx = x - (leaves[0].length >> 1);
  const bx = x - (bodyW >> 1);
  const rx = x - (rimW >> 1);
  fill(ctx, rx, baseY, rimW, 1, shadow());
  drawLeaves(ctx, leaves, lx, rimTop - leaves.length + 1);
  // vaso: aro mais largo que o corpo, cada um com contorno
  fill(ctx, rx - 1, rimTop - 1, rimW + 2, 4, out());
  fill(ctx, bx - 1, rimTop + 2, bodyW + 2, bodyH + 1, out());
  fill(ctx, rx, rimTop, rimW, 2, P.gray50);
  fill(ctx, rx + 1, rimTop, rimW - 2, 1, P.gray800); // terra
  fill(ctx, bx, rimTop + 2, bodyW, bodyH - 1, P.gray50);
  fill(ctx, bx + bodyW - 2, rimTop + 2, 2, bodyH - 1, P.gray150);
  fill(ctx, bx, rimTop + 1 + (bodyH >> 1), bodyW, 1, P.navy900);
  fill(ctx, bx, baseY - 2, bodyW, 1, P.gray200);
  // as folhas de baixo caem por cima do aro
  drawLeaves(ctx, leaves.slice(-2), lx, rimTop - 1);
}

interface SofaColors {
  frame: string;
  body: string;
  cushion: string;
  light: string;
}

export const SOFA_NAVY: SofaColors = {
  get frame() {
    return P.navy900;
  },
  get body() {
    return P.navy800;
  },
  get cushion() {
    return P.navy700;
  },
  get light() {
    return P.navy600;
  },
};
export const SOFA_GRAY: SofaColors = {
  get frame() {
    return P.gray700;
  },
  get body() {
    return P.gray600;
  },
  get cushion() {
    return P.gray500;
  },
  get light() {
    return P.gray400;
  },
};

/** sofá (ou poltrona, com seats = 1) visto de frente: encosto, braços, assentos e pés */
export function drawSofa(
  ctx: Ctx,
  x: number,
  baseY: number,
  w: number,
  seats: number,
  c: SofaColors,
  opts: { tall?: boolean; pillow?: boolean } = {},
) {
  const tall = opts.tall ?? true;
  const H = tall ? 24 : 19;
  const backH = tall ? 10 : 8;
  const top = baseY - H;
  const armW = 5;
  fill(ctx, x + 1, baseY - 1, w, 2, shadow());
  fill(ctx, x, top, w, H - 2, out());
  fill(ctx, x + 2, baseY - 3, 2, 2, out()); // pés
  fill(ctx, x + w - 4, baseY - 3, 2, 2, out());
  // encosto
  fill(ctx, x + 1, top + 1, w - 2, backH, c.body);
  fill(ctx, x + 1, top + 1, w - 2, 1, c.light);
  const sx = x + 1 + armW;
  const sw = w - 2 - 2 * armW;
  const cw = Math.floor(sw / seats);
  const seatY = top + backH + 1;
  fill(ctx, sx, seatY - 1, sw, 1, c.frame);
  for (let i = 0; i < seats; i++) {
    const cx0 = sx + i * cw;
    fill(ctx, cx0 + 1, top + 3, cw - 2, backH - 4, c.cushion); // almofada do encosto
    fill(ctx, cx0 + 1, top + 3, cw - 2, 1, c.light);
    fill(ctx, cx0, seatY, cw, 4, c.cushion); // assento
    fill(ctx, cx0, seatY, cw, 1, c.light);
    if (i > 0) fill(ctx, cx0, seatY, 1, 4, c.frame);
  }
  fill(ctx, sx, seatY + 4, sw, baseY - 4 - (seatY + 4), c.body); // frente do assento
  // braços
  const armY = top + backH - 3;
  for (const ax of [x + 1, x + w - 1 - armW]) {
    fill(ctx, ax, armY, armW, baseY - 4 - armY, c.frame);
    fill(ctx, ax, armY, armW, 1, c.light);
  }
  if (opts.pillow) {
    // almofada branca no canto esquerdo
    fill(ctx, sx + 1, seatY - 5, 6, 5, out());
    fill(ctx, sx + 2, seatY - 4, 4, 3, P.gray50);
    fill(ctx, sx + 4, seatY - 4, 2, 3, P.gray150);
  }
}

/** mesinha de centro baixa: tampo de madeira clara, revista e xícara */
export function drawCoffeeTable(ctx: Ctx, x: number, baseY: number) {
  const w = 22;
  const top = baseY - 12;
  fill(ctx, x + 1, baseY - 1, w, 2, shadow());
  fill(ctx, x + 2, top + 6, 2, 5, P.gray700); // pernas
  fill(ctx, x + w - 4, top + 6, 2, 5, P.gray700);
  fill(ctx, x, top, w, 6, out());
  fill(ctx, x + 1, top + 1, w - 2, 3, F.oak);
  fill(ctx, x + 1, top + 1, w - 2, 1, F.oakLight);
  fill(ctx, x + 1, top + 4, w - 2, 1, F.oakShade);
  // revista: capa com faixa escura e foto azul
  fill(ctx, x + 4, top + 1, 7, 3, P.white);
  fill(ctx, x + 4, top + 1, 7, 1, P.navy900);
  fill(ctx, x + 6, top + 2, 3, 2, P.signal.think);
  // xícara
  fill(ctx, x + 15, top + 1, 2, 2, P.white);
  fill(ctx, x + 17, top + 2, 1, 1, P.white);
}

/** luminária de piso: base, haste e cúpula branca */
export function drawFloorLamp(ctx: Ctx, x: number, baseY: number) {
  fill(ctx, x - 3, baseY, 7, 1, shadow());
  fill(ctx, x - 3, baseY - 2, 7, 2, out());
  fill(ctx, x - 2, baseY - 2, 5, 1, P.gray600);
  const shadeTop = baseY - 46;
  fill(ctx, x, shadeTop + 7, 1, baseY - 2 - (shadeTop + 7), P.gray600);
  fill(ctx, x - 2, shadeTop, 5, 1, out());
  [5, 7, 7, 9, 9].forEach((w, i) => {
    const y = shadeTop + 1 + i;
    fill(ctx, x - (w >> 1) - 1, y, w + 2, 1, out());
    fill(ctx, x - (w >> 1), y, w, 1, P.gray50);
    fill(ctx, x + 1, y, w >> 1, 1, P.gray150);
  });
  fill(ctx, x - 5, shadeTop + 6, 11, 1, out());
}

/**
 * multifuncional num gabinete: LEDs verde e azul piscando e uma folha saindo a cada ~12 s.
 * `t < 0` significa "parado" (reduced-motion): desenha o quadro estático, sem piscar nem folha.
 * Quem criar outro prop `live` deve tratar `t < 0` do mesmo jeito.
 */
export function drawPrinter(ctx: Ctx, x: number, baseY: number, t: number) {
  const w = 24;
  fill(ctx, x + 1, baseY - 1, w, 2, shadow());
  // gabinete
  const cabTop = baseY - 14;
  fill(ctx, x, cabTop, w, 14, out());
  fill(ctx, x + 1, cabTop + 1, w - 2, 12, P.gray600);
  fill(ctx, x + 1, cabTop + 1, w - 2, 1, P.gray500);
  fill(ctx, x + 12, cabTop + 2, 1, 10, P.gray700);
  fill(ctx, x + 10, cabTop + 6, 1, 2, P.gray400);
  fill(ctx, x + 14, cabTop + 6, 1, 2, P.gray400);
  fill(ctx, x + 1, baseY - 2, w - 2, 1, P.gray700);
  // corpo da impressora
  const top = cabTop - 18;
  fill(ctx, x, top, w, 19, out());
  fill(ctx, x + 1, top + 1, w - 2, 17, P.gray100);
  fill(ctx, x + 1, top + 1, w - 2, 4, P.gray200); // tampa do scanner
  fill(ctx, x + 1, top + 1, w - 2, 1, P.white);
  fill(ctx, x + 1, top + 5, w - 2, 1, P.gray300);
  fill(ctx, x + w - 3, top + 6, 1, 12, P.gray150); // lateral na sombra
  // painel com LEDs: o verde pisca rápido enquanto imprime
  // t < 0 = parado (reduced-motion): LEDs apagados e nenhuma folha saindo
  const idle = t < 0;
  const ph = idle ? 12_000 : t % 12_000;
  const printing = !idle && ph < 1_500;
  fill(ctx, x + 15, top + 6, 7, 4, P.navy900);
  fill(ctx, x + 16, top + 7, 2, 2, P.navy600);
  const green = idle ? false : printing ? Math.floor(t / 120) % 2 === 0 : true;
  const blue = idle ? false : Math.floor(t / 700) % 2 === 0;
  fill(ctx, x + 19, top + 7, 1, 1, green ? P.signal.ok : P.navy800);
  fill(ctx, x + 20, top + 8, 1, 1, blue ? P.signal.think : P.navy800);
  // saída de papel: a folha desce em 1,5 s, fica na bandeja e some (alguém pegou)
  fill(ctx, x + 3, top + 9, 12, 1, P.gray700);
  const len = printing ? 1 + Math.floor((ph / 1_500) * 4) : ph < 9_000 ? 4 : 0;
  if (len > 0) {
    fill(ctx, x + 5, top + 10, 8, Math.min(4, len), P.white);
    if (len >= 4) {
      fill(ctx, x + 6, top + 11, 5, 1, P.gray300);
      fill(ctx, x + 6, top + 13, 4, 1, P.gray300);
    }
  }
  fill(ctx, x + 3, top + 14, 12, 1, P.gray300); // bandeja
  fill(ctx, x + 2, top + 15, 14, 1, P.gray400);
  fill(ctx, x + 1, top + 16, w - 2, 1, P.gray300); // gaveta de papel
  fill(ctx, x + 10, top + 17, 4, 1, P.gray400);
}

/** arara de figurino: barra com cabides, uma jaqueta, uma camisa e um moletom pendurados */
export function drawCoatRack(ctx: Ctx, x: number, baseY: number) {
  const top = baseY - 44;
  fill(ctx, x - 5, baseY, 11, 1, shadow());
  fill(ctx, x - 5, baseY - 2, 11, 2, out());
  fill(ctx, x - 4, baseY - 2, 9, 1, P.gray700);
  fill(ctx, x - 1, top + 2, 2, baseY - 2 - (top + 2), P.gray700);
  fill(ctx, x - 1, top + 2, 1, baseY - 2 - (top + 2), P.gray500);
  fill(ctx, x - 1, top, 2, 2, P.gray600);
  // barra de cima
  fill(ctx, x - 12, top + 4, 24, 1, P.gray700);
  // peças penduradas (cabide de 1px + corpo), em tons das roupas da marca
  const peca = (px: number, w: number, h: number, body: string, edge: string) => {
    fill(ctx, px + (w >> 1), top + 5, 1, 2, P.gray500);
    fill(ctx, px, top + 7, w, h, out());
    fill(ctx, px + 1, top + 8, w - 2, h - 2, body);
    fill(ctx, px + 1, top + 8, 1, h - 2, edge);
  };
  peca(x - 12, 7, 14, P.navy700, P.navy800); // jaqueta
  peca(x + 4, 7, 12, P.gray300, P.gray400); // camisa
  peca(x - 4, 6, 10, P.gray500, P.gray600); // moletom (atrás do poste)
}

/** credenza baixa escura com tampo claro, 3 portas e HDs e estojos de mídia em cima */
export function drawCredenza(ctx: Ctx, x: number, baseY: number, w: number) {
  const bodyTop = baseY - 15;
  fill(ctx, x + 1, baseY - 1, w, 2, shadow());
  fill(ctx, x, bodyTop, w, 15, out());
  fill(ctx, x + 1, bodyTop + 1, w - 2, 2, F.oak);
  fill(ctx, x + 1, bodyTop + 1, w - 2, 1, F.oakLight);
  fill(ctx, x + 1, bodyTop + 3, w - 2, 10, P.navy800);
  fill(ctx, x + 1, bodyTop + 3, w - 2, 1, P.navy700);
  const door = Math.floor((w - 2) / 3);
  for (let i = 1; i < 3; i++) fill(ctx, x + 1 + i * door, bodyTop + 4, 1, 9, P.navy950);
  for (let i = 0; i < 3; i++) fill(ctx, x + 1 + i * door + (door >> 1) - 1, bodyTop + 7, 3, 1, P.gray300);
  fill(ctx, x + 2, baseY - 2, 2, 1, out()); // pés
  fill(ctx, x + w - 4, baseY - 2, 2, 1, out());
  // HDs empilhados (LED verde) e estojos de mídia deitados
  const OUT2 = out();
  for (let i = 0; i < 2; i++) {
    const hy = bodyTop - 3 - i * 3;
    fill(ctx, x + 6, hy - 1, 16, 3, OUT2);
    fill(ctx, x + 7, hy, 14, 1, i ? P.gray500 : P.gray600);
    fill(ctx, x + 19, hy, 1, 1, P.signal.ok);
  }
  for (let i = 0; i < 3; i++) {
    const ex = x + 28 + i * 6;
    fill(ctx, ex - 1, bodyTop - 4, 6, 4, OUT2);
    fill(ctx, ex, bodyTop - 3, 4, 2, i % 2 ? P.gray300 : P.navy600);
  }
  fill(ctx, x + 46, bodyTop - 3, 10, 3, OUT2); // pasta de roteiro
  fill(ctx, x + 47, bodyTop - 2, 8, 2, P.gray50);
  fill(ctx, x + 47, bodyTop - 2, 8, 1, P.navy600);
}

/** balcão da recepção: tampo claro, friso branco e frente escura com "RHYNOR" branco */
export function drawReception(ctx: Ctx, x: number, baseY: number, w: number) {
  const h = 21;
  const top = baseY - h;
  fill(ctx, x + 1, baseY - 1, w, 2, shadow());
  fill(ctx, x, top, w, h, out());
  fill(ctx, x + 1, top + 1, w - 2, 3, F.oak);
  fill(ctx, x + 1, top + 1, w - 2, 1, F.oakLight);
  fill(ctx, x + 1, top + 4, w - 2, 1, F.oakShade);
  fill(ctx, x + 1, top + 5, w - 2, 1, P.gray50); // friso branco
  fill(ctx, x + 1, top + 6, w - 2, h - 7, P.navy900);
  fill(ctx, x + 1, top + 6, w - 2, 1, P.navy800);
  // painéis laterais
  fill(ctx, x + 6, top + 8, 1, h - 11, P.navy800);
  fill(ctx, x + w - 7, top + 8, 1, h - 11, P.navy800);
  drawBitmap(ctx, RHYNOR_LETTERS, x + Math.floor((w - bitmapWidth(RHYNOR_LETTERS)) / 2), top + 9, P.white);
}

/**
 * Mesa de ping-pong vista de cima em 3/4, no sentido do comprimento (jogadores em cima e embaixo):
 * tampo escuro baixo e largo com bordas e linha do meio brancas, rede clara atravessando na
 * horizontal, borda frontal fina, pernas finas só embaixo e sombra no chão.
 * (x, y) = canto de cima do tampo; a base fica em y + h + 8. `gear` = raquetes e bolinha no tampo.
 */
export function drawPingPongTable(ctx: Ctx, x: number, y: number, w: number, h: number, gear = true) {
  // sombra no chão debaixo do tampo (aparece entre as pernas)
  fill(ctx, x + 1, y + h + 3, w - 1, 5, shadow());
  fill(ctx, x + 3, y + h + 8, w - 5, 1, shadow());
  // pernas finas: as de trás mais curtas e escuras, as da frente até o chão
  for (const lx of [x + 5, x + w - 6]) fill(ctx, lx, y + h + 2, 1, 4, P.gray600);
  for (const lx of [x + 2, x + w - 3]) {
    fill(ctx, lx, y + h + 2, 1, 6, P.gray500);
    fill(ctx, lx, y + h + 7, 1, 1, out());
  }
  // contorno, tampo e borda frontal (2px)
  fill(ctx, x - 1, y - 1, w + 2, h + 4, out());
  fill(ctx, x, y, w, h, P.navy600);
  fill(ctx, x, y + h, w, 2, P.navy900);
  // bordas brancas e linha do meio (no sentido do comprimento)
  fill(ctx, x, y, w, 1, P.white);
  fill(ctx, x, y + h - 1, w, 1, P.white);
  fill(ctx, x, y, 1, h, P.white);
  fill(ctx, x + w - 1, y, 1, h, P.white);
  fill(ctx, x + (w >> 1), y, 1, h, P.white);
  // rede: 1px clara atravessando, sombra embaixo, postes 1px pra fora de cada lado
  const ny = y + (h >> 1);
  fill(ctx, x - 2, ny, w + 4, 1, P.gray100);
  fill(ctx, x, ny + 1, w, 1, P.navy800);
  fill(ctx, x - 2, ny - 2, 1, 3, P.gray500);
  fill(ctx, x + w + 1, ny - 2, 1, 3, P.gray500);
  // raquetes descansando (uma de cada lado) e a bolinha; no jogo elas estão na mão
  if (!gear) return;
  const paddle = (px: number, py: number) => {
    fill(ctx, px - 1, py - 1, 5, 5, out());
    fill(ctx, px, py, 3, 3, P.props.paddle);
    fill(ctx, px, py, 1, 1, P.gray50);
    fill(ctx, px + 1, py + 4, 1, 2, F.wood);
  };
  paddle(x + w - 9, y + 4);
  paddle(x + 5, y + h - 10);
  fill(ctx, x + 10, y + 6, 2, 2, P.white);
}

/** bebedouro de galão: corpo branco, galão azul em cima e torneirinha. `x` é a borda esquerda. */
export function drawWaterCooler(ctx: Ctx, x: number, baseY: number) {
  fill(ctx, x + 1, baseY, 14, 1, shadow());
  fill(ctx, x + 1, baseY - 34, 12, 12, out());
  fill(ctx, x, baseY - 24, 14, 24, out());
  fill(ctx, x + 1, baseY - 23, 12, 22, P.gray100);
  fill(ctx, x + 11, baseY - 23, 2, 22, P.gray200);
  fill(ctx, x + 2, baseY - 33, 10, 11, F.water);
  fill(ctx, x + 3, baseY - 31, 3, 7, F.waterLight);
  // torneira e bandeja
  fill(ctx, x + 4, baseY - 18, 3, 2, P.navy600);
  fill(ctx, x + 5, baseY - 16, 1, 1, out());
  fill(ctx, x + 3, baseY - 12, 6, 1, P.gray400);
}
