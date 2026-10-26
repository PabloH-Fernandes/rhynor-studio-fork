// =====================================================================
//  TEMA DO ESCRITÓRIO — é aqui que você personaliza tudo.
//
//  A marca fica em assets/marca (servida em /marca) e a fonte da verdade
//  é referencias/rhynor-marca.md.
// =====================================================================

import { HAIR_COLORS, SKIN_TONES, type AGzinho } from "../../shared/roster";

/**
 * Paleta herdada do motor upstream (troca pelos tokens Rhynor nas próximas etapas). Fonte única dos HEX:
 * as variáveis CSS em styles.css (:root) espelham estes valores — manter em sincronia.
 * navy900 (#051733) é a cor da marca, lida do fundo da logo horizontal.
 */
export const palette = {
  navy950: "#020B1C", // contorno, fundo da página, sapatos
  suit: "#0A1428", // terno do líder
  navy900: "#051733", // marca: placa, painel, lambril
  navy850: "#0E2A57", // polo marinho
  navy800: "#0B2550", // cards, calças, filete do tampo e moldura dos monitores
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
    moon: "#F4F0DC",
    /** nuvem à noite (um pouco mais clara que o céu) */
    cloud: "#2A3B66",
    /** prédios, obra e guindaste escurecem em direção a esta cor */
    shade: "#0A1A3C",
    /** cores das luzes no lightmap (somadas com 'lighter', vezes a força da noite) */
    monitorLight: "#4FA8FF",
    warmLight: "#FFC27A",
    ceilingLight: "#FFE0B0",
  },
  /** objetos pequenos dos personagens */
  props: {
    pencil: "#F2C14E",
    pencilTip: "#3A4250",
    watch: "#CDD5E0",
    shadow: "rgba(2, 11, 28, 0.28)",
    /** bochecha: rosa misturado com a pele (nunca o laranja de "te esperando") */
    blush: "#F07C9A",
    /** capacete de obra amarelo (amarelo, não laranja) */
    helmetYellow: "#F2C200",
    /** colete refletivo: lima com faixas prata */
    vest: "#D7E84A",
    vestStripe: "#E1E6EE",
    /** raquete de ping-pong */
    paddle: "#D9444F",
  },
  /** cenário da parede: juntas, nuvens, quadros e rolos de projeto */
  decor: {
    wallJoint: "#D8DEE7",
    cloudFar: "#E8F3FB",
    cloudShade: "#D6E8F6",
    /** nuvem no amanhecer/entardecer (misturada pela força do "dusk") */
    cloudDusk: "#F7B4A2",
    craneLightOff: "#6E2A36",
    paintingSky: "#CFE3F5",
    paintingHaze: "#E4EFF9",
    blueprint: "#BFD6F0",
    /** base verde da maquete na mesa de reunião */
    maquette: "#6FA06A",
    maquetteShade: "#5A8756",
  },
  /** piso de porcelanato cinza-azulado */
  floor: {
    tileA: "#D9DEE6",
    tileB: "#CFD5DE",
    joint: "#BAC2CE",
  },
  /** mobília: tampo claro, madeira quente (só em detalhes), plantas e água do bebedouro */
  furniture: {
    /** tampo claro das mesas (carvalho claro) */
    oakLight: "#F0E2C8",
    oak: "#E2CCA6",
    oakShade: "#C7A97E",
    /** madeira quente da porta e da mesa de reunião */
    wood: "#8B5E3C",
    woodShade: "#6B452A",
    woodLight: "#A87650",
    woodDark: "#3A2A1E",
    leafDark: "#2F6B45",
    leaf: "#3F8A55",
    leafLight: "#66B26E",
    water: "#8FD0F5",
    waterLight: "#C4E8FB",
  },
} as const;

export type Palette = typeof palette;

/** navy850 (#0E2A57) com alpha: sombras azuladas e tela de proteção */
export const navyAlpha = (a: number) => `rgba(14, 42, 87, ${a})`;

/** navy950 (#020B1C) com alpha: fundo da etiqueta de nome */
export const inkAlpha = (a: number) => `rgba(2, 11, 28, ${a})`;

/** polo e camisa levam a marquinha no peito; blazer e terno abrem em V mostrando a camisa (inner) */
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
  /** cor da marquinha 3x2 no peito (polo/camisa) */
  logo: string;
  /** sem cordão: crachá preso na lapela (líder) */
  lapelBadge?: boolean;
  /** crachá de visitante: todo na cor do accent (cinza do convidado) */
  visitor?: boolean;
  pants: string;
  shoes: string;
}

export interface Theme {
  officeName: string;
  subtitle: string;
  /**
   * caminho de uma imagem em assets/ (ex.: "/marca/logo.png"), reduzida para pixels duros
   * (só marinho e branco) na placa da recepção. Vazio ou falha ao carregar = "RHYNOR" em pixel.
   */
  logoUrl: string;
  colors: {
    floorA: string;
    floorB: string;
    floorLine: string;
    rug: string;
    rugBorder: string;
    wall: string;
    /** juntas sutis das placas da parede */
    wallJoint: string;
    /** lambril marinho (faixa de baixo da parede) e a borda de cima dele */
    wainscot: string;
    wainscotTop: string;
    /** friso de 1px entre a parede e o lambril */
    trim: string;
    /** sombra da parede no chão (azulada, com alpha) */
    wallShadow: string;
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
  /** função de cada papel na plaquinha da mesa (office/deskLabel.ts) */
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
  officeName: "Rhynor Studio",
  subtitle: "Time de agentes do Claude Code",
  logoUrl: "",

  colors: {
    floorA: palette.floor.tileA,
    floorB: palette.floor.tileB,
    floorLine: palette.floor.joint,
    rug: palette.navy100,
    rugBorder: palette.navy900,
    wall: palette.gray100,
    wallJoint: palette.decor.wallJoint,
    wainscot: palette.navy900,
    wainscotTop: palette.navy800,
    trim: palette.white,
    wallShadow: navyAlpha(0.16),
    wood: palette.furniture.wood,
    woodShade: palette.furniture.woodShade,
    woodLight: palette.furniture.woodLight,
    sign: palette.navy900,
    signText: palette.white,
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
    convidado: "CONVIDADO",
  },
};

export const uniformFor = (role: string) => theme.uniforms[role] ?? theme.uniforms.convidado;
export const roleColor = (role: string) => theme.roleColors[role] ?? theme.roleColors.convidado;

/**
 * Uniforme de um AGzinho do elenco: a roupa dele com o cordão na cor dele. Gola, faixa e
 * lenço seguem o uniforme do papel quando a peça é a mesma; o destaque troca o detalhe
 * (gravata dourada, blazer cinza, crachá de visitante).
 */
export function uniformForAgzinho(ag: AGzinho): Uniform {
  const base = theme.uniforms[ag.papel];
  const trim = base?.kind === ag.roupa ? base.trim : undefined;
  const accent = ag.cordao;
  let u: Uniform;
  switch (ag.roupa) {
    case "terno":
      u = { ...theme.uniforms.lider, accent, tie: ag.destaque === "gravata-dourada" ? ROLE_COLORS.lider : P.navy900 };
      break;
    case "blazer":
      u = ag.destaque === "blazer-cinza" ? blazer(P.gray600, P.gray700, accent, P.navy800) : blazer(P.navy700, P.navy800, accent, P.gray700);
      break;
    case "camisa":
      u = camisa(accent, trim ?? "gola");
      break;
    default:
      u = polo(accent, trim ?? (ag.papel === "convidado" ? undefined : "gola"));
  }
  return ag.destaque === "cracha-visitante" ? { ...u, visitor: true } : u;
}

/** tons de pele e cabelo, sorteados de forma fixa pelo id do agente (a lista mora em shared/roster.ts) */
export const SKINS: readonly string[] = SKIN_TONES.map((t) => t.hex);
export const HAIRS: readonly string[] = HAIR_COLORS.map((c) => c.hex);
