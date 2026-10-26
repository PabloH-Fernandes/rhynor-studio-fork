// Base dos bonecos: mistura de cores, medidas do corpo e o retângulo de desenho (Part).
// Sem dependência dos outros arquivos dos sprites (frame, hair, accessories e sprites importam daqui).

// ------------------------------------------------------------------ cores

const blendCache = new Map<string, string>();

/** mistura duas cores hex (t = 0 a primeira, 1 a segunda); memorizado */
export function blend(a: string, b: string, t: number): string {
  const key = `${a}|${b}|${t}`;
  let out = blendCache.get(key);
  if (out) return out;
  const na = parseInt(a.slice(1, 7), 16);
  const nb = parseInt(b.slice(1, 7), 16);
  const ch = (shift: number) => {
    const va = (na >> shift) & 255;
    const vb = (nb >> shift) & 255;
    return Math.round(va + (vb - va) * t)
      .toString(16)
      .padStart(2, "0");
  };
  out = `#${ch(16)}${ch(8)}${ch(0)}`;
  blendCache.set(key, out);
  return out;
}

// ------------------------------------------------------------------ medidas

export const HEAD_W = 12;
export const HEAD_H = 10;
export const TORSO_H = 7;
export const LEG_H = 4;
/**
 * Quanto o corpo desce ao sentar. Zero: o tampo da mesa (com o contorno) começa na 6ª linha
 * do tronco, então aparecem a cabeça, a gola, o cordão e o crachá inteiro.
 */
export const SIT_DROP = 0;
/** topo da cabeça com o cabelo mais alto, relativo ao y dos pés (em pé e sentado) */
export const HEAD_TOP_STAND = -(LEG_H + TORSO_H + HEAD_H + 4);
export const HEAD_TOP_SIT = HEAD_TOP_STAND + SIT_DROP;
/**
 * Caixa de clique relativa ao ponto entre os pés (com o contorno). Nenhum cabelo nem acessório
 * sai dela, fora o pulo e as animações longas.
 */
export const HIT_BOX = { left: -10, right: 10, top: HEAD_TOP_STAND - 2, bottom: 3 } as const;

/** retângulo [x, y, w, h, cor] de uma parte do boneco */
export type Part = [x: number, y: number, w: number, h: number, color: string];
