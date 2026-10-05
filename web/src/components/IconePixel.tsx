// Ícones de status em pixel art (8x8), desenhados com currentColor: o status nunca depende só da cor,
// mas o ícone acompanha a cor do selo. Sempre decorativos: o texto do status vem ao lado.

import type { AgentStatus } from "../../../shared/types";

/** "#" = pixel aceso; cada linha tem 8 colunas */
const DESENHOS: Record<AgentStatus, readonly string[]> = {
  // raio
  trabalhando: ["....###.", "...###..", "..###...", ".######.", "...###..", "..###...", ".###....", ".#......"],
  // balão de pensamento
  pensando: ["..####..", ".######.", ".######.", "..####..", "........", ".##.....", ".##.....", "#......."],
  // exclamação: alguém precisa de você
  esperando: ["...##...", "...##...", "...##...", "...##...", "...##...", "........", "...##...", "...##..."],
  // xícara com vapor
  ocioso: [".#..#...", "..#..#..", "........", "#######.", "######.#", "######.#", "#######.", ".####..."],
  // seta entrando
  chegando: ["....#...", "....##..", "#######.", "########", "#######.", "....##..", "....#...", "........"],
  // seta saindo
  saindo: ["...#....", "..##....", ".#######", "########", ".#######", "..##....", "...#....", "........"],
};

/** um path só, quadradinho por quadradinho (sem antialias com shape-rendering crispEdges) */
function caminho(linhas: readonly string[]): string {
  let d = "";
  linhas.forEach((linha, y) => {
    for (let x = 0; x < linha.length; x++) if (linha[x] === "#") d += `M${x} ${y}h1v1h-1z`;
  });
  return d;
}

const CAMINHOS = Object.fromEntries(Object.entries(DESENHOS).map(([k, v]) => [k, caminho(v)])) as Record<AgentStatus, string>;

/** 16px = 2 pixels de tela por pixel da arte (escala inteira, sem borrão) */
export function IconeStatus({ status, tamanho = 16 }: { status: AgentStatus; tamanho?: number }) {
  return (
    <svg
      className="icone-pixel"
      viewBox="0 0 8 8"
      width={tamanho}
      height={tamanho}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <path d={CAMINHOS[status]} fill="currentColor" />
    </svg>
  );
}
