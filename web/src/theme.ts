// =====================================================================
//  TEMA DO ESCRITÓRIO — é aqui que você personaliza tudo.
//
//  Pra versão da empresa: troque officeName, coloque a logo oficial em
//  web/public/logo.png (fundo transparente fica melhor) e ajuste as cores
//  dos uniformes pra bater com o manual de marca.
// =====================================================================

/**
 * Paleta da identidade AG (marinho + branco). Fonte única dos HEX:
 * as variáveis CSS em styles.css (:root) espelham estes valores — manter em sincronia.
 * navy900 (#051733) é a cor da marca, lida do fundo da logo horizontal.
 */
export const palette = {
  navy950: "#020B1C", // contorno, fundo da página, sapatos
  suit: "#0A1428", // terno do líder
  navy900: "#051733", // marca: placa, painel, lambril
  navy850: "#0E2A57", // polo marinho
  navy800: "#0B2550", // cards, calças, frente das mesas
  navy700: "#163768", // blazer do planejador, tapete
  navy600: "#2A4F86", // botão secundário, bordas
  navy600Hover: "#35609C", // hover do botão secundário
  navy500: "#4A6FA5", // bordas e ícones (nunca texto sobre marinho)
  navy300: "#8FA8CC", // texto secundário (7,3:1 sobre navy900)
  navy100: "#D5DFEE", // balão de chat, ghost
  line: "#1E3A66", // divisórias e bordas do painel
  feedTime: "#6F86AB", // hora do feed (5,2:1 sobre navy950)
  white: "#FFFFFF",
  gray50: "#F4F6FA", // camisa branca
  gray150: "#C9D3E2", // sombra da camisa branca
  gray100: "#E6EAF0", // parede
  gray200: "#CDD5E0",
  gray300: "#AEB8C6", // passadeira
  gray400: "#8A96A8",
  gray500: "#5E6B7F",
  gray600: "#4A5568", // cadeira, blazer do revisor
  gray700: "#3A4250", // calça grafite
  gray800: "#262D3A",
  signal: {
    /** exclusivo de "te esperando"; sempre dentro de selo marinho */
    waiting: "#FF8A00",
    /** texto "esperando" sobre fundo claro */
    waitingInk: "#8A4A00",
    /** fundo do alerta "te esperando" no pico do pulse */
    waitingPulseBg: "#10305F",
    ok: "#3FBF86",
    think: "#5AAEF0",
    alert: "#EF5F7B",
    craneLight: "#FF4D4D",
  },
  /** céu por hora: topo e base, interpolados entre as chaves (desenhado em faixas) */
  sky: [
    { hour: 0, top: "#061230", bottom: "#1B2B55" }, // noite
    { hour: 5, top: "#061230", bottom: "#1B2B55" },
    { hour: 6, top: "#3B5C99", bottom: "#F6B48A" }, // amanhecer
    { hour: 9, top: "#6FB7E8", bottom: "#CFEAFB" }, // manhã
    { hour: 14, top: "#5AA6DE", bottom: "#BFE0F5" }, // tarde
    { hour: 18, top: "#2E3F7A", bottom: "#F59E62" }, // entardecer
    { hour: 20, top: "#061230", bottom: "#1B2B55" }, // noite
    { hour: 24, top: "#061230", bottom: "#1B2B55" },
  ],
  night: {
    cityWindow: "#FFD27A",
    star: "#DCE6FF",
  },
  /** objetos pequenos dos personagens */
  props: {
    pencil: "#F2C14E",
    pencilTip: "#3A4250",
    watch: "#CDD5E0",
    shadow: "rgba(2, 11, 28, 0.28)",
  },
} as const;

export type Palette = typeof palette;

/** polo e camisa levam a logo AG no peito; blazer e terno abrem em V mostrando a camisa (inner) */
export type UniformKind = "polo" | "camisa" | "blazer" | "terno";

export interface Uniform {
  kind: UniformKind;
  /** cor principal da peça de cima (polo, camisa ou paletó) */
  shirt: string;
  /** sombra da peça de cima (parte de baixo / mangas) */
  shirtShade: string;
  /** cor do papel: cordão do crachá, faixa nas costas, gola/manga/lenço */
  accent: string;
  /** onde o accent aparece além do cordão: gola, faixa na manga ou lenço de bolso */
  trim?: "gola" | "manga" | "lenco";
  /** camisa por baixo do blazer/terno (o V e o punho) */
  inner?: string;
  /** gravata 1x4 (só o terno) */
  tie?: string;
  /** cor da logo AG 3x2 no peito (polo/camisa) */
  logo: string;
  /** sem cordão: crachá AG preso na lapela (líder) */
  lapelBadge?: boolean;
  /** crachá de visitante: todo na cor do accent (cinza do convidado) */
  visitor?: boolean;
  pants: string;
  shoes: string;
}

export interface Theme {
  officeName: string;
  subtitle: string;
  /** caminho de uma imagem em web/public (ex.: "/logo.png"). Vazio = usa o nome escrito na placa */
  logoUrl: string;
  colors: {
    floorA: string;
    floorB: string;
    floorLine: string;
    rug: string;
    rugBorder: string;
    wall: string;
    wallShade: string;
    baseboard: string;
    wood: string;
    woodShade: string;
    woodLight: string;
    sign: string;
    signText: string;
    outline: string;
  };
  /** uniforme por papel; papéis sem entrada usam "convidado" */
  uniforms: Record<string, Uniform>;
  /** cor de destaque de cada papel (plaquinha da mesa, painel lateral) */
  roleColors: Record<string, string>;
  /** rótulo da plaquinha da mesa */
  deskLabels: Record<string, string>;
}

/** cor de cada papel: plaquinha da mesa, painel lateral e detalhes do uniforme */
const ROLE_COLORS: Record<string, string> = {
  lider: "#F2C14E",
  planejador: "#9B82FF",
  dev: palette.signal.ok,
  testador: "#2EC4B6",
  revisor: palette.signal.alert,
  documentador: palette.signal.think,
  pesquisador: "#E2BD3C",
  convidado: "#A3A8B5",
};

const P = palette;
const polo = (accent: string, trim?: Uniform["trim"]): Uniform => ({
  kind: "polo",
  shirt: P.navy850,
  shirtShade: P.navy900,
  accent,
  trim,
  logo: P.white,
  pants: P.gray700,
  shoes: P.navy950,
});
const camisa = (accent: string, trim: Uniform["trim"]): Uniform => ({
  kind: "camisa",
  shirt: P.gray50,
  shirtShade: P.gray150,
  accent,
  trim,
  logo: P.navy900,
  pants: P.navy800,
  shoes: P.navy950,
});
const blazer = (shirt: string, shirtShade: string, accent: string, pants: string): Uniform => ({
  kind: "blazer",
  shirt,
  shirtShade,
  accent,
  trim: "lenco",
  inner: P.white,
  logo: P.white,
  pants,
  shoes: P.navy950,
});

export const theme: Theme = {
  officeName: "Escritório de IA",
  subtitle: "Andrade Gutierrez · time de agentes",
  logoUrl: "", // ex.: "/logo.png"

  colors: {
    floorA: "#c9a77c",
    floorB: "#bf9c70",
    floorLine: "#a9855c",
    rug: "#3f5f7a",
    rugBorder: "#2e4659",
    wall: "#e9e2d4",
    wallShade: "#d6cbb7",
    baseboard: "#8a6a4a",
    wood: "#8b5e3c",
    woodShade: "#6b452a",
    woodLight: "#a87650",
    sign: "#22283a",
    signText: "#f4f1e8",
    outline: palette.navy950,
  },

  uniforms: {
    lider: {
      kind: "terno",
      shirt: P.suit,
      shirtShade: P.navy900,
      accent: ROLE_COLORS.lider,
      inner: P.white,
      tie: ROLE_COLORS.lider,
      logo: P.white,
      lapelBadge: true,
      pants: P.suit,
      shoes: P.navy950,
    },
    planejador: blazer(P.navy700, P.navy800, ROLE_COLORS.planejador, P.gray700),
    revisor: blazer(P.gray600, P.gray700, ROLE_COLORS.revisor, P.navy800),
    pesquisador: polo(ROLE_COLORS.pesquisador, "gola"),
    testador: polo(ROLE_COLORS.testador, "manga"),
    dev: camisa(ROLE_COLORS.dev, "gola"),
    documentador: camisa(ROLE_COLORS.documentador, "manga"),
    convidado: { ...polo(ROLE_COLORS.convidado), visitor: true },
  },

  roleColors: ROLE_COLORS,

  deskLabels: {
    lider: "LÍDER",
    planejador: "PLANEJAMENTO",
    dev: "DESENVOLVIMENTO",
    testador: "TESTES",
    revisor: "REVISÃO",
    documentador: "DOCUMENTAÇÃO",
    pesquisador: "PESQUISA",
  },
};

export const uniformFor = (role: string) => theme.uniforms[role] ?? theme.uniforms.convidado;
export const roleColor = (role: string) => theme.roleColors[role] ?? theme.roleColors.convidado;

/** tons de pele e cabelo, sorteados de forma fixa pelo id do agente */
export const SKINS = ["#f1c9a5", "#e0ac84", "#c68b62", "#a86f4c", "#7d5038", "#5c3a28"];
export const HAIRS = [
  "#2a1d17",
  "#4a3021",
  "#7a4b2a",
  "#c58a4a",
  "#e2c27a",
  "#1c1c1c",
  "#8c8c8c",
  "#6b2f2f",
  "#B8BCC4", // grisalho
  "#8A3B1F", // ruivo
  "#D9B46A", // loiro
];
