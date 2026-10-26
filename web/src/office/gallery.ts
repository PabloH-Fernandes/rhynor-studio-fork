// Galeria de conferência dos bonecos (só pra dev e prints): `?galeria=1` na URL.
// Uma linha por Personagem do elenco, com as poses e animações lado a lado.

import type { Personagem } from "../../../shared/types";
import { inkAlpha, palette } from "../theme";
import { lookOfPersonagem } from "./engine";
import { PORTRAIT_H, PORTRAIT_W, drawCharacter, drawPortrait, type CharAnim, type CharPose, type Dir } from "./sprites";

export const GALLERY_ENABLED =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("galeria") === "1";

const DIRS: Dir[] = ["down", "up", "left", "right"];
const DIR_LABEL: Record<Dir, string> = { down: "fr", up: "co", left: "esq", right: "dir" };

interface Column {
  label: string;
  pose: Partial<CharPose>;
}

/** progresso escolhido pra cada animação mostrar o gesto mais legível */
const ANIMS: [CharAnim, number][] = [
  ["sip", 0.5],
  ["phone", 0.3],
  ["swing", 0.9],
  ["chin", 0.3],
  ["water", 0.5],
  ["stretch", 0.5],
  ["cheer", 0.3],
  ["present", 0.3],
];

const COLUMNS: Column[] = [
  ...DIRS.map((dir) => ({ label: DIR_LABEL[dir], pose: { dir } })),
  // quadro 2 do andar: t = 2 * 140ms com phase 0
  ...DIRS.map((dir) => ({ label: `and ${DIR_LABEL[dir]}`, pose: { dir, walking: true, t: 290 } })),
  { label: "digita", pose: { dir: "down" as Dir, sitting: true, typing: true, t: 0 } },
  // banquinho da reunião: sentado de lado e de costas (as canelas penduradas o motor desenha)
  { label: "bco esq", pose: { dir: "left" as Dir, sitting: true } },
  { label: "bco dir", pose: { dir: "right" as Dir, sitting: true } },
  { label: "bco co", pose: { dir: "up" as Dir, sitting: true } },
  ...ANIMS.map(([anim, animT]) => ({ label: anim, pose: { dir: "down" as Dir, anim, animT } })),
];

const LABEL_W = 46;
const CELL_W = 22;
const CELL_H = 34;
const HEAD_H = 12;
export const GALLERY_W = LABEL_W + (COLUMNS.length + 1) * CELL_W + 4;
export const GALLERY_H = (rows: number) => HEAD_H + rows * CELL_H + 4;

export function drawGallery(ctx: CanvasRenderingContext2D, personagens: readonly Personagem[]) {
  const h = GALLERY_H(personagens.length);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = palette.floor.tileA;
  ctx.fillRect(0, 0, GALLERY_W, h);

  ctx.font = `7px VT323, monospace`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = palette.navy900;
  COLUMNS.forEach((c, i) => ctx.fillText(c.label, LABEL_W + i * CELL_W + CELL_W / 2, 6));
  ctx.fillText("retrato", LABEL_W + COLUMNS.length * CELL_W + CELL_W / 2, 6);

  personagens.forEach((ag, row) => {
    const top = HEAD_H + row * CELL_H;
    ctx.fillStyle = row % 2 ? palette.floor.tileB : palette.floor.tileA;
    ctx.fillRect(0, top, GALLERY_W, CELL_H);
    ctx.fillStyle = palette.floor.joint;
    ctx.fillRect(0, top, GALLERY_W, 1);

    ctx.textAlign = "left";
    ctx.fillStyle = palette.navy900;
    ctx.fillText(ag.apelido, 3, top + CELL_H / 2 - 4);
    ctx.fillStyle = inkAlpha(0.6);
    ctx.fillText(ag.genero === "feminino" ? "F" : "M", 3, top + CELL_H / 2 + 4);
    ctx.textAlign = "center";

    const look = lookOfPersonagem(ag);
    COLUMNS.forEach((c, i) => {
      const pose: CharPose = {
        dir: "down",
        walking: false,
        sitting: false,
        typing: false,
        t: 0,
        phase: 0,
        animT: 0,
        noIdle: true,
        ...c.pose,
      };
      drawCharacter(ctx, LABEL_W + i * CELL_W + CELL_W / 2, top + CELL_H - 3, look, pose);
    });
    const px = LABEL_W + COLUMNS.length * CELL_W + Math.floor((CELL_W - PORTRAIT_W) / 2);
    drawPortrait(ctx, look, 1, px, top + CELL_H - PORTRAIT_H - 4);
  });
}
