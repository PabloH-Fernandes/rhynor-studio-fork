// Marca em pixel: letras em bitmap ("#" = pixel aceso) do letreiro, do balcão e da plaquinha da ala,
// e drawPixelArt, que desenha uma matriz de letras coloridas (o rinoceronte de web/src/marca/rinoceronte.ts).

export type Bitmap = readonly string[];

/** letras 6x8 bold (hastes de 2px) */
const BIG_GLYPHS: Record<string, Bitmap> = {
  R: ["#####.", "##..##", "##..##", "#####.", "####..", "##.##.", "##..##", "##..##"],
  H: ["##..##", "##..##", "##..##", "######", "######", "##..##", "##..##", "##..##"],
  Y: ["##..##", "##..##", ".####.", "..##..", "..##..", "..##..", "..##..", "..##.."],
  N: ["##..##", "###.##", "######", "##.###", "##..##", "##..##", "##..##", "##..##"],
  O: [".####.", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
};

/** "RHYNOR" em 41x8 (letras 6x8 com 1 coluna vazia entre elas) */
export const RHYNOR_LETTERS: Bitmap = Array.from({ length: 8 }, (_, j) => [..."RHYNOR"].map((ch) => BIG_GLYPHS[ch][j]).join("."));

/** largura de um bitmap em pixels (a linha mais longa) */
export function bitmapWidth(bm: Bitmap): number {
  return Math.max(0, ...bm.map((row) => row.length));
}

/** Retângulos (x, y, w, h) das sequências acesas de cada linha, a partir de (x, y). */
export function bitmapRuns(bm: Bitmap, x: number, y: number, scale = 1): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  bm.forEach((row, j) => {
    let i = 0;
    while (i < row.length) {
      if (row[i] !== "#") {
        i++;
        continue;
      }
      const start = i;
      while (row[i] === "#") i++;
      out.push([x + start * scale, y + j * scale, (i - start) * scale, scale]);
    }
  });
  return out;
}

/**
 * Desenha uma matriz de letras (uma por pixel; "." transparente) com a cor de cada letra.
 * Junta as sequências da mesma cor numa linha num só fillRect. Letra sem cor em `cores` é pulada.
 */
export function drawPixelArt(ctx: CanvasRenderingContext2D, matriz: readonly string[], x: number, y: number, cores: Readonly<Record<string, string>>, escala = 1) {
  const ox = Math.round(x);
  const oy = Math.round(y);
  matriz.forEach((linha, j) => {
    let i = 0;
    while (i < linha.length) {
      const ch = linha[i];
      const cor = cores[ch];
      let fim = i + 1;
      while (fim < linha.length && linha[fim] === ch) fim++;
      if (ch !== "." && cor) {
        ctx.fillStyle = cor;
        ctx.fillRect(ox + i * escala, oy + j * escala, (fim - i) * escala, escala);
      }
      i = fim;
    }
  });
}

export function drawBitmap(ctx: CanvasRenderingContext2D, bm: Bitmap, x: number, y: number, color: string, scale = 1) {
  ctx.fillStyle = color;
  for (const [rx, ry, w, h] of bitmapRuns(bm, Math.round(x), Math.round(y), scale)) ctx.fillRect(rx, ry, w, h);
}

// ------------------------------------------------------------------ plaquinha "RHYNOR / STUDIO"
// Letras pixel bold 4x5 (haste de 2px à esquerda, topo em degrau), em 2 linhas alinhadas à esquerda.

const SMALL_GLYPHS: Record<string, Bitmap> = {
  R: ["###.", "##.#", "###.", "##.#", "##.#"],
  H: ["##.#", "##.#", "####", "##.#", "##.#"],
  Y: ["##.#", "##.#", ".##.", ".##.", ".##."],
  N: ["##.#", "####", "####", "##.#", "##.#"],
  O: [".##.", "##.#", "##.#", "##.#", ".##."],
  S: [".###", "##..", ".##.", "..##", "###."],
  T: ["####", ".##.", ".##.", ".##.", ".##."],
  U: ["##.#", "##.#", "##.#", "##.#", ".##."],
  D: ["###.", "##.#", "##.#", "##.#", "###."],
  I: ["####", ".##.", ".##.", ".##.", "####"],
};

/** uma palavra em letras 4x5 com 1 coluna vazia entre elas */
function smallWord(word: string): Bitmap {
  return Array.from({ length: 5 }, (_, j) => [...word].map((ch) => SMALL_GLYPHS[ch][j]).join("."));
}

const LINE_GAP = 2;
const LINE_TOP = smallWord("RHYNOR");
const LINE_BOTTOM = smallWord("STUDIO");

/** "STUDIO" em 29x5 (letras 4x5), embaixo do "RHYNOR" grande do letreiro */
export const STUDIO_LETTERS: Bitmap = LINE_BOTTOM;

/** "RHYNOR" / "STUDIO" em 29x12 (2 linhas de 5px e 2px entre elas) */
export const STUDIO_PLAQUE: Bitmap = [
  ...LINE_TOP.map((row) => row.padEnd(LINE_BOTTOM[0].length, ".")),
  ...Array.from({ length: LINE_GAP }, () => ".".repeat(LINE_BOTTOM[0].length)),
  ...LINE_BOTTOM,
];
