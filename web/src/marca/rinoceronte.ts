// Rinoceronte da Rhynor em pixel art (32x32 e 64x64), aprovado em 2026-10-25. Fonte única das
// matrizes: o canvas desenha daqui (drawPixelArt) e scripts/sprite-rinoceronte.mjs gera os PNGs de
// assets/marca a partir delas. É adaptação de estilo da logo, não logo nova: não redesenhar sem aprovação.
//
// Uma letra por pixel; "." é transparente. As letras viram tokens da marca (nunca hex):
//   L laranja (chifres e triângulo), A ardósia (olho e narina), C aço (sombra do rosto), N névoa (corpo).

/** letra → token, versão de fundo escuro (como rhynor-logo-fundo-escuro.png) */
export const RINO_TOKENS = {
  L: "rh-laranja",
  A: "rh-ardosia",
  C: "rh-aco",
  N: "rh-nevoa",
} as const;

/** versão de fundo claro (como rhynor-logo.png): mesma matriz com ardósia e névoa trocadas */
export const RINO_TOKENS_CLARO = { ...RINO_TOKENS, A: "rh-nevoa", N: "rh-ardosia" } as const;

/**
 * 32x32: leitura simplificada da logo. Orelha e chifre de trás em cima, triângulo à esquerda
 * separado do corpo por 1 px, faixa de aço curva no pescoço, olho em diagonal, chifre da frente
 * em meia-lua dentro do recorte do focinho.
 */
export const RINO_32: readonly string[] = [
  "................................",
  "................................",
  "................L...............",
  "...............LL...............",
  "...............LL....L..........",
  "..............LLL...LL..........",
  "..............LLL..LLL..........",
  "............N.LLL.LL.L..........",
  "...........NN.LLL.N.LL..........",
  "..........NNN.LL.NNN............",
  ".........NNNN.L.NNNNN...........",
  "........NNNNNN.NNNNNN.........N.",
  ".......NNNNNNNNNNNNNNN.....L..N.",
  ".....L.NNNNNNNCNAANNNN..LLLL..N.",
  ".....L.NNNNNNCCNNAANNN.LLLLL.NN.",
  "....LL.NNNNNNCCNNNAANNN.LLL.NNN.",
  "...LLL.NNNNNNCCNNNNAAANN.L.NNNN.",
  "...LLL.NNNNNNCCCNNNNAANNNNNNNNN.",
  "..LLLL.NNNNNNCCCNNNNNNNNNNNNNN..",
  "..LLLL.NNNNNNCCCCNNNNNNNNNNNNN..",
  ".LLLLL..NNNNNNCCCCNNNNNNNNNNNN..",
  "...LLLL.NNNNNNNCCCCNNNNNAANNNN..",
  ".....LL.NNNNNNNCCCCCNNNNNAANN...",
  "......LL.NNNNNNNCCCCCCNNNNNNN...",
  ".......LL.NNNNNNCCNCCCCCNNN.....",
  "...........NNNNNNCNN............",
  "............NNNNNNN.............",
  ".............NNNNN..............",
  "...............NNN..............",
  ".................N..............",
  "................................",
  "................................",
];

/**
 * 64x64: mesma composição com mais detalhe: oco do chifre de trás, borda curva do pescoço,
 * olho em losango (fino em cima, mais largo embaixo), narina com o "gancho" e a ponta do focinho.
 */
export const RINO_64: readonly string[] = [
  "................................................................",
  "................................................................",
  "................................................................",
  "................................................................",
  "................................................................",
  "................................L...............................",
  "...............................LL...............................",
  "..............................LLL...............................",
  "..............................LLLL........L.....................",
  ".............................LLLLL.......LL.....................",
  "............................LLLLLL......LLL.....................",
  "............................LLLLLL....LLLLL.....................",
  "...........................LLLLLLLL..LLLLLL.....................",
  "...........................LLLLLLL..LLLL.LL.....................",
  "...........................LLLLLLL..LLL..LL.....................",
  "........................NN.LLLLLLL.N.....LL.....................",
  ".......................NNN.LLLLLLL.NN...LL......................",
  "......................NNNN.LLLLLLL.NNNN..L......................",
  ".....................NNNNN.LLLLLL.NNNNNN........................",
  "...................NNNNNNN.LLLLL.NNNNNNNN.......................",
  "..................NNNNNNNNN.LL.NNNNNNNNNN.......................",
  ".................NNNNNNNNNN.L.NNNNNNNNNNN.......................",
  "................NNNNNNNNNNN..NNNNNNNNNNNNN......................",
  "...............NNNNNNNNNNNNNNNNNNNNNNNNNNN......................",
  "...............NNNNNNNNNNNNNNNNNNNNNNNNNNNN............L.....N..",
  "...............NNNNNNNNNNNNNNNNNNNNNNNNNNNNN..........LL.....N..",
  "...............NNNNNNNNNNNNNCNNNNANNNNNNNNNNN........LLL....NN..",
  "...............NNNNNNNNNNNNCCNNNNAANNNNNNNNNN..LLLLLLLLL....NN..",
  "...........L...NNNNNNNNNNNCCNNNNNNAANNNNNNNN..LLLLLLLLL....NNN..",
  "...........L...NNNNNNNNNNCCCCNNNNNNAAANNNNNN...LLLLLLLL...NNNN..",
  "..........LL...NNNNNNNNNNCCCCNNNNNNNAAANNNNNN...LLLLLL....NNNN..",
  ".........LLL...NNNNNNNNNNCCCCNNNNNNNNAAAANNNNNN..LLLLL...NNNN...",
  "........LLLL...NNNNNNNNNNCCCCNNNNNNNNNAAAANNNNNN...LL...NNNNN...",
  "........LLLL...NNNNNNNNNNCCCCCNNNNNNNNAAAAANNNNNN.....NNNNNNN...",
  ".......LLLLLL..NNNNNNNNNNCCCCCNNNNNNNNAAAAANNNNNNN..NNNNNNNNN...",
  "......LLLLLLL..NNNNNNNNNNCCCCCCNNNNNNNNAAAANNNNNNNNNNNNNNNNNN...",
  ".....LLLLLLLL...NNNNNNNNNNCCCCCNNNNNNNNNNAANNNNNNNNNNNNNNNNNN...",
  ".....LLLLLLLL...NNNNNNNNNNCCCCCCNNNNNNNNNNNNNNNNNNNNNNNNNNNN....",
  "....LLLLLLLLL...NNNNNNNNNNCCCCCCCNNNNNNNNNNNNNNNNNNNNNNNNNNN....",
  "...LLLLLLLLLL...NNNNNNNNNNCCCCCCCCNNNNNNNNNNNNNNNNNNNNNNNNNN....",
  "..LLLLLLLLLLLL..NNNNNNNNNNNCCCCCCCCNNNNNNNNNNNNNNNNNNNNNNNNN....",
  "...LLLLLLLLLLL...NNNNNNNNNNCCCCCCCCCNNNNNNNNNNNNNNANNNNNNNN.....",
  ".....LLLLLLLLL...NNNNNNNNNNNCCCCCCCCCNNNNNNNNNNNNAAANNNNNNN.....",
  ".......LLLLLLLL..NNNNNNNNNNNCCCCCCCCCCNNNNNNNNNNNNAAANNNNNN.....",
  "........LLLLLLL..NNNNNNNNNNNNCCCCCCCCCCCNNNNNNNNNNNAANNNNN......",
  "..........LLLLL...NNNNNNNNNNNNCCCCCCCCCCCNNNNNNNNNNNANNNNN......",
  "............LLLL..NNNNNNNNNNNNCCCCCCCCCCCCCNNNNNNNNNNNNNNN......",
  "..............LL...NNNNNNNNNNNNCCCCCCCCCCCCCCNNNNNNNNNNNN.......",
  "................L..NNNNNNNNNNNNNCCCCCNNCCCCCCCCNNNNNNN..........",
  "....................NNNNNNNNNNNNNCCCNNNN.CCCCCCCC...............",
  "....................NNNNNNNNNNNNNNCCNNN.........................",
  ".....................NNNNNNNNNNNNNNNNNN.........................",
  ".......................NNNNNNNNNNNNNNNN.........................",
  "........................NNNNNNNNNNNNNN..........................",
  "..........................NNNNNNNNNNNN..........................",
  "............................NNNNNNNNN...........................",
  ".............................NNNNNNNN...........................",
  "...............................NNNNN............................",
  ".................................NN.............................",
  "..................................N.............................",
  "................................................................",
  "................................................................",
  "................................................................",
  "................................................................",
];
