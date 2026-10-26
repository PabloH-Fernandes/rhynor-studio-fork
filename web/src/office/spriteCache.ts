// Cache dos bonecos: cada combinação de aparência + direção + quadro é desenhada uma vez
// num canvas pequeno (1x, fora da tela) e depois só copiada com drawImage.
// Sombra no chão, alpha e posição ficam fora do cache (quem desenha cuida disso).

/** tamanho do canvas de cada quadro, com folga pra braços erguidos, raquete e regador */
export const SPRITE_W = 40;
export const SPRITE_H = 44;
/** onde fica o ponto entre os pés (x, y) dentro do canvas do quadro */
export const SPRITE_OX = 20;
export const SPRITE_OY = 38;

/** 12 Personagens x 4 direções x quadros quantizados cabem com folga */
export const SPRITE_CACHE_LIMIT = 1500;

export interface SpriteCacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  /** acertos / (acertos + erros), 0..1 */
  hitRate: number;
}

// Map guarda a ordem de inserção: o primeiro é o usado há mais tempo (LRU)
const entries = new Map<string, HTMLCanvasElement>();
let hits = 0;
let misses = 0;
let evictions = 0;

/**
 * Canvas do quadro `key` (formato `lookKey|dir|quadro`). Se não estiver no cache, chama
 * `paint` com um contexto limpo de SPRITE_W x SPRITE_H. Devolve null se o navegador não
 * der um contexto 2D (quem chama desenha direto).
 */
export function cachedSprite(key: string, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement | null {
  const hit = entries.get(key);
  if (hit) {
    hits++;
    entries.delete(key);
    entries.set(key, hit);
    return hit;
  }
  misses++;
  let canvas: HTMLCanvasElement | undefined;
  if (entries.size >= SPRITE_CACHE_LIMIT) {
    // reaproveita o canvas do mais antigo em vez de criar outro
    const oldest = entries.keys().next();
    if (!oldest.done) {
      canvas = entries.get(oldest.value);
      entries.delete(oldest.value);
      evictions++;
    }
  }
  if (!canvas) {
    if (typeof document === "undefined") return null;
    canvas = document.createElement("canvas");
    canvas.width = SPRITE_W;
    canvas.height = SPRITE_H;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, SPRITE_W, SPRITE_H);
  ctx.imageSmoothingEnabled = false;
  paint(ctx);
  entries.set(key, canvas);
  return canvas;
}

/** elenco mudou (vestiário): joga fora os quadros desenhados */
export function clearSpriteCache() {
  entries.clear();
}

export function spriteCacheStats(): SpriteCacheStats {
  const total = hits + misses;
  return { size: entries.size, hits, misses, evictions, hitRate: total ? hits / total : 0 };
}

export function resetSpriteCacheStats() {
  hits = 0;
  misses = 0;
  evictions = 0;
}

declare global {
  interface Window {
    /** debug: `__agSprites()` no console mostra acertos e erros do cache de bonecos */
    __agSprites?: () => SpriteCacheStats;
    __agSpritesReset?: () => void;
  }
}

// import.meta.env só existe no vite (os testes do motor importam este módulo no node)
if (import.meta.env?.DEV && typeof window !== "undefined") {
  window.__agSprites = spriteCacheStats;
  window.__agSpritesReset = resetSpriteCacheStats;
}
