/** Câmera do escritório (módulo puro, sem React): translação em px do palco + zoom relativo ao enquadramento. */
export interface Camera {
  x: number;
  y: number;
  z: number;
}

/** tamanho do escritório ajustado à tela (px CSS) e do palco */
export interface Fit {
  cw: number;
  ch: number;
  ww: number;
  wh: number;
}

export const Z_MIN = 0.5;
export const Z_MAX = 6;
export const MIN_VISIBLE = 0.25; // fração mínima do escritório que fica à vista

/** limita zoom e pan: sempre sobra pelo menos MIN_VISIBLE do escritório (ou do palco, se menor) à vista */
export function clampCamera(c: Camera, f: Fit): Camera {
  const z = Math.min(Z_MAX, Math.max(Z_MIN, c.z));
  const mx = Math.min(MIN_VISIBLE * f.cw * z, f.ww);
  const my = Math.min(MIN_VISIBLE * f.ch * z, f.wh);
  return {
    z,
    x: Math.min(f.ww - mx, Math.max(mx - f.cw * z, c.x)),
    y: Math.min(f.wh - my, Math.max(my - f.ch * z, c.y)),
  };
}

/** pan elástico: além do limite só passa uma fração (resistência) do excesso */
export function rubberBand(c: Camera, f: Fit, resistance = 0.35): Camera {
  const lim = clampCamera(c, f);
  return { z: lim.z, x: lim.x + (c.x - lim.x) * resistance, y: lim.y + (c.y - lim.y) * resistance };
}

export const fitCamera = (f: Fit): Camera => ({ x: (f.ww - f.cw) / 2, y: (f.wh - f.ch) / 2, z: 1 });

/** muda o zoom mantendo o ponto (px, py) do palco parado */
export const zoomAt = (c: Camera, z: number, px: number, py: number, f: Fit): Camera => {
  const nz = Math.min(Z_MAX, Math.max(Z_MIN, z));
  return clampCamera({ z: nz, x: px - ((px - c.x) * nz) / c.z, y: py - ((py - c.y) * nz) / c.z }, f);
};

/**
 * Arredonda o zoom de repouso ao degrau mais próximo que deixa os pixels uniformes
 * (cw * z * dpr / baseW inteiro), sem sair de [Z_MIN, Z_MAX]. Se não houver degrau válido, mantém z.
 */
export function snapZoom(z: number, f: Fit, dpr: number, baseW: number): number {
  const unit = (f.cw * dpr) / baseW; // pixels de tela por pixel da planta em z = 1
  if (!(unit >= 1)) return z; // tela estreita: degraus grossos demais, não vale
  const k = Math.round(z * unit);
  if (k < 1) return z;
  const nz = k / unit;
  if (nz < Z_MIN - 1e-9 || nz > Z_MAX + 1e-9) return z;
  return Math.abs(nz - z) / z > 0.12 ? z : nz; // só ajuste fino, nunca um salto visível
}
