// Cache de desenhos estáticos: um móvel (planta, sofá, mesa de reunião...) é desenhado uma vez,
// na escala k atual, num canvas pequeno recortado no tamanho dele, e depois só copiado com
// drawImage. As plantas, por exemplo, eram centenas de fillRect de 1px por quadro.

import { H, W } from "./map";

type Ctx = CanvasRenderingContext2D;

export interface Baked {
  canvas: HTMLCanvasElement;
  /** canto do recorte em pixels de dispositivo (já na escala k) */
  x: number;
  y: number;
}

let scratch: { canvas: HTMLCanvasElement; k: number } | null = null;
/** quantas vezes algo foi assado (debug: se subir sem parar, alguma chave do cache está variando) */
let bakes = 0;
export function bakeCount(): number {
  return bakes;
}

/**
 * Desenha `draw` (em coordenadas base) numa área W x H na escala k, acha a caixa dos pixels
 * pintados e devolve só esse recorte. null se o navegador não der canvas 2D.
 */
export function bakeDrawing(k: number, draw: (g: Ctx) => void): Baked | null {
  if (typeof document === "undefined") return null;
  bakes++;
  if (!scratch || scratch.k !== k) {
    const c = document.createElement("canvas");
    c.width = W * k;
    c.height = H * k;
    scratch = { canvas: c, k };
  }
  const sc = scratch.canvas;
  const g = sc.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, sc.width, sc.height);
  g.setTransform(k, 0, 0, k, 0, 0);
  g.imageSmoothingEnabled = false;
  draw(g);
  const { data, width, height } = g.getImageData(0, 0, sc.width, sc.height);
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const out = document.createElement("canvas");
  if (x1 < 0) {
    out.width = out.height = 1;
    return { canvas: out, x: 0, y: 0 };
  }
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  const og = out.getContext("2d");
  if (!og) return null;
  og.drawImage(sc, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { canvas: out, x: x0, y: y0 };
}

/**
 * Camada que se redesenha sempre na mesma área conhecida (px base), sem procurar a caixa:
 * reaproveita o canvas entre uma vez e outra. Usada nas janelas, refeitas algumas vezes por segundo.
 */
export class AreaLayer {
  private canvas: HTMLCanvasElement | null = null;
  private k = 0;

  constructor(private area: { x: number; y: number; w: number; h: number }) {}

  /** redesenha a área com `draw` (coordenadas base); false se não houver canvas 2D */
  paint(k: number, draw: (g: Ctx) => void): boolean {
    if (typeof document === "undefined") return false;
    const { x, y, w, h } = this.area;
    if (!this.canvas || this.k !== k) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = w * k;
      this.canvas.height = h * k;
      this.k = k;
    }
    const g = this.canvas.getContext("2d");
    if (!g) return false;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(k, 0, 0, k, -x * k, -y * k);
    g.imageSmoothingEnabled = false;
    draw(g);
    return true;
  }

  get baked(): Baked | null {
    return this.canvas ? { canvas: this.canvas, x: this.area.x * this.k, y: this.area.y * this.k } : null;
  }

  get scale(): number {
    return this.k;
  }
}

/** copia um recorte 1:1 em pixels de dispositivo, respeitando o deslocamento da transformação atual */
export function drawBaked(ctx: Ctx, b: Baked) {
  const m = ctx.getTransform();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, m.e, m.f);
  ctx.drawImage(b.canvas, b.x, b.y);
  ctx.restore();
}
