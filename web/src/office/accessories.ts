// Acessórios dos bonecos (DESENHOS) e os helpers de desenho deles (copo).

import { CAMADA_DO_ACESSORIO, type Acessorio, type Camada } from "../../../shared/roster";
import { palette } from "../theme";
import { TORSO_H, blend, type Part } from "./body";
import type { CharLook } from "./sprites";

/** mão ou pulso onde um acessório/objeto pode ir; s = -1 lado esquerdo da tela, 1 direito (ou a da frente, de perfil) */
export interface Slot {
  x: number;
  y: number;
  s: -1 | 1;
  into: Part[];
  used?: boolean;
}

/** camada de cada acessório: vem de CAMADA_DO_ACESSORIO (shared/roster.ts) */
export type AccessoryLayer = Camada;

export interface AccessoryCtx {
  look: CharLook;
  /** de perfil o desenho é feito virado pra direita (o da esquerda é espelhado depois) */
  view: "front" | "back" | "side";
  /** retângulo na camada certa (com contorno, menos no rosto) */
  put(x: number, y: number, w: number, h: number, color: string): void;
  /** atalho: retângulo relativo ao canto da cabeça (12x10) */
  head(rx: number, ry: number, w: number, h: number, color: string): void;
  /** tronco: canto, largura e a faixa de cada linha (a cintura afina no feminino) */
  tx: number;
  ty: number;
  tw: number;
  torsoRow(r: number): [x: number, w: number];
  /** camada "mao": a mão livre escolhida; "pulso": o pulso com o relógio */
  slot?: Slot;
}

/** como desenhar um acessório; a camada vem do mapa compartilhado */
interface AccessoryDraw {
  /** camada "mao": lado preferido (-1 esquerda da tela, 1 direita) */
  prefer?: -1 | 1;
  draw(c: AccessoryCtx): void;
}

export interface AccessoryDef extends AccessoryDraw {
  camada: AccessoryLayer;
}

/** chapéus: escondem o topo do cabelo (sprites.ts corta o que fica acima da aba) */
export const HATS = new Set<Acessorio>(["bone", "gorro"]);

export function cup(put: AccessoryCtx["put"], x: number, y: number) {
  // copo do escritório nas animações: claro com faixa escura
  put(x, y, 3, 3, palette.white);
  put(x, y + 1, 3, 1, palette.navy900);
}

/**
 * Acessórios, cada um na sua camada (cabeca, pelos, rosto, tronco, mao, pulso); o vestiário e a
 * validação deixam um por camada. Pra criar um novo:
 * 1. some o nome em `Acessorio`, `ACESSORIOS` e a camada em `CAMADA_DO_ACESSORIO` (shared/roster.ts);
 * 2. some o `draw` aqui em DESENHOS (c.head/c.put; de perfil, desenhe virado pra direita); cor
 *    nova vai em palette.props (theme.ts);
 * 3. dê o nome em pt-BR em NOME_ACESSORIO (components/vestiarioLogic.ts).
 * O TypeScript reclama se faltar o passo 2 ou o 3.
 */
const DESENHOS: Record<Acessorio, AccessoryDraw> = {
  headset: {
    draw: (c) => {
      const band = palette.gray800;
      const cupC = palette.gray600;
      c.head(1, -3, 10, 1, band);
      if (c.view === "side") {
        c.head(5, -2, 1, 5, band);
        c.head(4, 3, 3, 3, cupC);
        c.head(6, 8, 3, 1, band);
        c.head(9, 8, 1, 1, c.look.visual.accent);
        return;
      }
      c.head(-1, -2, 1, 6, band);
      c.head(12, -2, 1, 6, band);
      c.head(-2, 4, 2, 3, cupC);
      c.head(12, 4, 2, 3, cupC);
      if (c.view === "front") {
        c.head(0, 8, 3, 1, band);
        c.head(3, 8, 1, 1, c.look.visual.accent);
      }
    },
  },
  bone: {
    draw: (c) => {
      const copa = palette.props.cap;
      const aba = palette.props.capBrim;
      c.head(1, -3, 10, 1, copa);
      c.head(0, -2, 12, 3, copa);
      c.head(5, -3, 2, 1, blend(copa, palette.white, 0.25)); // botão do topo
      if (c.view === "side") c.head(8, 0, 6, 1, aba); // aba pra frente
      else if (c.view === "front") c.head(1, 1, 10, 1, aba);
      else c.head(4, 0, 4, 1, aba); // regulagem atrás
    },
  },
  gorro: {
    draw: (c) => {
      const lã = palette.props.beanie;
      const barra = blend(lã, palette.navy950, 0.3);
      c.head(2, -4, 8, 1, lã);
      c.head(1, -3, 10, 2, lã);
      c.head(0, -1, 12, 2, barra); // barra dobrada
      for (const rx of [2, 5, 8]) c.head(rx, -3, 1, 2, blend(lã, palette.white, 0.15)); // canelado
    },
  },
  oculos: {
    draw: (c) => {
      // cinza médio: contrasta com pele clara e escura
      const frame = palette.gray600;
      if (c.view === "back") return;
      if (c.view === "side") {
        c.head(7, 4, 4, 1, frame);
        c.head(7, 5, 1, 2, frame);
        c.head(10, 5, 1, 2, frame);
        c.head(2, 4, 5, 1, frame); // haste até a orelha
        return;
      }
      // meia-armação: aro de cima e laterais (as bochechas continuam à vista)
      c.head(1, 4, 10, 1, frame);
      for (const rx of [1, 4, 7, 10]) c.head(rx, 5, 1, 2, frame);
    },
  },
  cachecol: {
    draw: (c) => {
      const lã = palette.props.scarf;
      const listra = palette.props.scarfStripe;
      // volta no pescoço (linha de cima do tronco) e, de frente, a ponta caindo com uma listra
      const [x, w] = c.torsoRow(0);
      c.put(x, c.ty - 1, w, 2, lã);
      if (c.view === "front") {
        c.put(x + w - 3, c.ty + 1, 2, 4, lã);
        c.put(x + w - 3, c.ty + 3, 2, 1, listra);
      } else if (c.view === "side") c.put(x + w - 2, c.ty + 1, 2, 3, lã);
    },
  },
  prancheta: {
    prefer: -1,
    draw: (c) => {
      const h = c.slot;
      if (!h || c.view === "back") return;
      const x = h.s < 0 ? h.x - 3 : h.x + 1;
      c.put(x, h.y - 3, 4, 5, palette.furniture.wood);
      c.put(x + 1, h.y - 2, 2, 3, palette.white);
      c.put(x + 1, h.y - 3, 2, 1, palette.gray400); // prendedor
      c.put(h.x, h.y, 2, 2, c.look.skin); // a mão segura por cima
    },
  },
  caneca: {
    prefer: 1,
    draw: (c) => {
      const h = c.slot;
      if (!h) return;
      // caneca: corpo névoa 3x4 com faixa ardósia e alça de 1px pra fora
      const x = h.s > 0 ? h.x + 2 : h.x - 3;
      const y = h.y - 2;
      c.put(x, y, 3, 4, palette.white);
      c.put(x, y + 1, 3, 1, palette.navy700);
      c.put(h.s > 0 ? x + 3 : x - 1, y + 1, 1, 2, palette.white);
    },
  },
  lapis: {
    draw: (c) => {
      const { pencil, pencilTip } = palette.props;
      if (c.view === "side") {
        c.head(2, 3, 5, 1, pencil);
        c.head(7, 3, 1, 1, pencilTip);
      } else {
        // atrás da orelha: do lado direito de frente, do esquerdo de costas
        const rx = c.view === "front" ? 12 : -1;
        c.head(rx, 0, 1, 4, pencil);
        c.head(rx, 4, 1, 1, pencilTip);
      }
    },
  },
  relogio: {
    draw: (c) => {
      const w = c.slot;
      if (w) c.put(w.x, w.y, 2, 1, palette.props.watch);
    },
  },
  barba: {
    draw: (c) => {
      const b = c.look.hair;
      if (c.view === "back") return;
      if (c.view === "side") {
        c.head(5, 5, 1, 4, b);
        c.head(6, 8, 4, 2, b);
        c.head(10, 9, 1, 1, b);
        return;
      }
      c.head(0, 5, 1, 5, b);
      c.head(11, 5, 1, 5, b);
      c.head(1, 8, 4, 2, b);
      c.head(7, 8, 4, 2, b);
      c.head(5, 9, 2, 1, b);
    },
  },
};

export const ACCESSORIES: Record<Acessorio, AccessoryDef> = Object.fromEntries(
  (Object.keys(DESENHOS) as Acessorio[]).map((a) => [a, { ...DESENHOS[a], camada: CAMADA_DO_ACESSORIO[a] }]),
) as Record<Acessorio, AccessoryDef>;
