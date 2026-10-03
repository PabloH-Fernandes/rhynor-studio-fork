// Marca AG em bitmap ("#" = pixel aceso). Usada no peito dos uniformes e,
// nas próximas etapas, no balcão da recepção e como reserva da logo da placa.

export type Bitmap = readonly string[];

/** logo do peito: 3x2 em forma de "A" (lida melhor como AG do que "#.#"/"###", que parece um U) */
export const AG_CHEST: Bitmap = ["###", "#.#"];

const LETTER_A: Bitmap = ["..###..", ".##.##.", "##...##", "##...##", "#######", "##...##", "##...##", "##...##"];
const LETTER_G: Bitmap = [".####.", "##..##", "##....", "##....", "##.###", "##..##", "##..##", ".#####"];

/** "AG" em 14x8 (A + 1 coluna vazia + G), o mesmo desenho do favicon */
export const AG_LETTERS: Bitmap = LETTER_A.map((row, i) => `${row}.${LETTER_G[i]}`);

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

export function drawBitmap(ctx: CanvasRenderingContext2D, bm: Bitmap, x: number, y: number, color: string, scale = 1) {
  ctx.fillStyle = color;
  for (const [rx, ry, w, h] of bitmapRuns(bm, Math.round(x), Math.round(y), scale)) ctx.fillRect(rx, ry, w, h);
}
