// =====================================================================
//  TEMA DO ESCRITÓRIO — é aqui que você personaliza tudo.
//
//  A marca fica em assets/marca (servida em /marca) e a fonte da verdade
//  é referencias/rhynor-marca.md.
// =====================================================================

import { HAIR_COLORS, SKIN_TONES, type Personagem } from "../../shared/roster";
import { comAlfa, cor, derivada, misturar, type NomeCor } from "./marca/cores";

/** mistura de dois tokens (t = 0 é o primeiro) */
const m = (a: NomeCor, b: NomeCor, t: number) => misturar(a, b, t);

/**
 * Paleta do canvas, toda derivada dos tokens da marca (web/src/marca/tokens.css): cada folha é lida
 * na hora do uso (e memorizada até os tokens mudarem), então nada aqui roda antes do CSS carregar.
 * Os nomes são os de sempre (o escritório lê `palette.white`, `palette.navy900`...); o comentário
 * diz o papel de cada um.
 */
const ESPEC = {
  navy950: () => cor("rh-noite"), // contorno, sapatos, tinta escura
  suit: () => m("rh-noite", "rh-ardosia", 0.45), // terno
  navy900: () => cor("rh-superficie"), // placa, lambril, painéis
  navy850: () => cor("rh-ardosia"), // polo escura
  navy800: () => m("rh-superficie", "rh-ardosia", 0.5), // calças, filetes, moldura dos monitores
  navy700: () => cor("rh-ardosia"), // blazer, tapete
  navy600: () => cor("rh-borda"), // bordas
  navy600Hover: () => m("rh-borda", "rh-aco", 0.25),
  navy500: () => m("rh-borda", "rh-aco", 0.45), // ícones e detalhes
  navy300: () => cor("rh-aco"), // texto secundário
  navy100: () => cor("rh-nevoa"), // balão de chat
  line: () => cor("rh-borda"),
  feedTime: () => cor("rh-texto-suave"),
  white: () => cor("rh-nevoa"),
  gray50: () => cor("rh-nevoa"), // camisa clara
  gray150: () => m("rh-nevoa", "rh-aco", 0.5), // sombra da camisa clara
  gray100: () => m("rh-aco", "rh-nevoa", 0.45), // parede
  gray200: () => m("rh-nevoa", "rh-aco", 0.35),
  gray300: () => cor("rh-aco"),
  gray400: () => m("rh-aco", "rh-borda", 0.35),
  gray500: () => m("rh-aco", "rh-borda", 0.65),
  gray600: () => m("rh-borda", "rh-aco", 0.2), // cadeira
  gray700: () => m("rh-ardosia", "rh-noite", 0.3), // calça escura
  gray800: () => m("rh-superficie", "rh-noite", 0.3),
  signal: {
    /** exclusivo de "te esperando" */
    waiting: () => cor("rh-aviso"),
    /** texto "esperando" sobre fundo claro */
    waitingInk: () => cor("rh-ardosia"),
    /** fundo do alerta "te esperando" no pico do pulse */
    waitingPulseBg: () => cor("rh-elevado"),
    ok: () => cor("rh-ok"),
    think: () => cor("rh-aco"),
    alert: () => cor("rh-alerta"),
    /** brilho da mesa de quem está trabalhando agora (o único laranja do escritório) */
    active: () => cor("rh-laranja"),
    activeGlow: () => cor("rh-brasa"),
  },
  /** céu por hora: topo e base, interpolados entre as chaves (dia nublado de aço e névoa, sem azul) */
  sky: () => {
    const noite = { top: cor("rh-noite"), bottom: m("rh-noite", "rh-ardosia", 0.6) };
    const virada = { top: cor("rh-ardosia"), bottom: m("rh-aco", "rh-brasa", 0.18) };
    const dia = { top: m("rh-aco", "rh-ardosia", 0.25), bottom: m("rh-nevoa", "rh-aco", 0.35) };
    return [
      { hour: 0, ...noite },
      { hour: 5, ...noite },
      { hour: 6, ...virada }, // amanhecer
      { hour: 9, ...dia }, // manhã nublada
      { hour: 14, ...dia },
      { hour: 18, ...virada }, // entardecer
      { hour: 20, ...noite },
      { hour: 24, ...noite },
    ];
  },
  night: {
    cityWindow: () => m("rh-aviso", "rh-nevoa", 0.35),
    star: () => cor("rh-nevoa"),
    moon: () => cor("rh-nevoa"),
    /** nuvem à noite (um pouco mais clara que o céu) */
    cloud: () => m("rh-superficie", "rh-ardosia", 0.6),
    /** prédios da cidade escurecem em direção a esta cor */
    shade: () => cor("rh-noite"),
    /** cores das luzes no lightmap (somadas com 'lighter', vezes a força da noite) */
    monitorLight: () => m("rh-aco", "rh-nevoa", 0.4),
    warmLight: () => cor("rh-brasa"),
    ceilingLight: () => m("rh-aviso", "rh-nevoa", 0.55),
  },
  /** objetos pequenos dos personagens */
  props: {
    pencil: () => cor("rh-aviso"),
    pencilTip: () => cor("rh-ardosia"),
    watch: () => cor("rh-aco"),
    shadow: () => comAlfa("rh-noite", 0.28),
    /** bochecha: misturada com a pele por quem desenha */
    blush: () => cor("rh-alerta"),
    helmetYellow: () => cor("rh-aviso"),
    vest: () => m("rh-aviso", "rh-ok", 0.5),
    vestStripe: () => cor("rh-nevoa"),
    /** raquete de ping-pong */
    paddle: () => cor("rh-alerta"),
  },
  /** cenário da parede: juntas, nuvens, pôsteres e estante */
  decor: {
    wallJoint: () => m("rh-aco", "rh-borda", 0.25),
    cloudFar: () => cor("rh-nevoa"),
    cloudShade: () => m("rh-nevoa", "rh-aco", 0.45),
    /** nuvem no amanhecer/entardecer (misturada pela força do "dusk") */
    cloudDusk: () => m("rh-aco", "rh-brasa", 0.3),
    craneLightOff: () => m("rh-alerta", "rh-noite", 0.6),
    paintingSky: () => m("rh-aco", "rh-nevoa", 0.5),
    paintingHaze: () => cor("rh-nevoa"),
    blueprint: () => cor("rh-aco"),
    /** base verde (vaso grande, detalhes) */
    maquette: () => cor("rh-pixel-folha"),
    maquetteShade: () => m("rh-pixel-folha", "rh-noite", 0.25),
  },
  /** piso em placas de ardósia */
  floor: {
    tileA: () => m("rh-ardosia", "rh-aco", 0.3),
    tileB: () => m("rh-ardosia", "rh-aco", 0.24),
    joint: () => m("rh-ardosia", "rh-noite", 0.15),
  },
  /** mobília: tampos claros, madeira escura (ardósia), plantas e água do bebedouro */
  furniture: {
    oakLight: () => cor("rh-nevoa"),
    oak: () => m("rh-nevoa", "rh-aco", 0.4),
    oakShade: () => cor("rh-aco"),
    wood: () => m("rh-ardosia", "rh-aco", 0.25),
    woodShade: () => cor("rh-ardosia"),
    woodLight: () => m("rh-ardosia", "rh-aco", 0.45),
    woodDark: () => cor("rh-superficie"),
    leafDark: () => m("rh-pixel-folha", "rh-noite", 0.35),
    leaf: () => cor("rh-pixel-folha"),
    leafLight: () => m("rh-pixel-folha", "rh-nevoa", 0.3),
    water: () => m("rh-aco", "rh-nevoa", 0.4),
    waterLight: () => cor("rh-nevoa"),
  },
};

type Folha = () => unknown;
type Arvore<T> = { readonly [K in keyof T]: T[K] extends Folha ? ReturnType<T[K]> : Arvore<T[K]> };

/** objeto com getters memorizados (refeitos quando os tokens mudam) a partir da especificação */
function arvore<T extends object>(espec: T): Arvore<T> {
  const out = {};
  for (const [k, v] of Object.entries(espec)) {
    const get = typeof v === "function" ? derivada(v as Folha) : ((sub: unknown) => () => sub)(arvore(v as object));
    Object.defineProperty(out, k, { get, enumerable: true });
  }
  return out as Arvore<T>;
}

export const palette = arvore(ESPEC);

export type Palette = typeof palette;

/** ardósia com alpha: sombras e tela de proteção */
export const navyAlpha = (a: number) => comAlfa("rh-ardosia", a);

/** noite com alpha: fundo da etiqueta de nome */
export const inkAlpha = (a: number) => comAlfa("rh-noite", a);

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
   * (duas cores) na placa da recepção. Vazio ou falha ao carregar = "RHYNOR" em pixel.
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

/** papéis conhecidos (o painel e as plaquinhas não usam mais cor por papel: tudo em aço) */
const PAPEIS = ["lider", "planejador", "dev", "testador", "revisor", "documentador", "pesquisador", "convidado"] as const;
const roleColors = (): Record<string, string> => Object.fromEntries(PAPEIS.map((p) => [p, cor("rh-aco")]));
/** cordão do crachá no sprite: laranja da marca */
const CORDAO = () => cor("rh-laranja");

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

const colors = derivada(
  (): Theme["colors"] => ({
    floorA: palette.floor.tileA,
    floorB: palette.floor.tileB,
    floorLine: palette.floor.joint,
    rug: m("rh-ardosia", "rh-noite", 0.25),
    rugBorder: palette.navy900,
    wall: palette.gray100,
    wallJoint: palette.decor.wallJoint,
    wainscot: palette.navy900,
    wainscotTop: palette.navy800,
    trim: cor("rh-aco"),
    wallShadow: comAlfa("rh-noite", 0.16),
    wood: palette.furniture.wood,
    woodShade: palette.furniture.woodShade,
    woodLight: palette.furniture.woodLight,
    sign: cor("rh-noite"),
    signText: cor("rh-nevoa"),
    outline: palette.navy950,
  }),
);

const uniforms = derivada(
  (): Record<string, Uniform> => ({
    lider: {
      kind: "terno",
      shirt: P.suit,
      shirtShade: P.navy900,
      accent: CORDAO(),
      inner: P.white,
      tie: cor("rh-aco"),
      logo: P.white,
      lapelBadge: true,
      pants: P.suit,
      shoes: P.navy950,
    },
    planejador: blazer(P.navy700, P.navy800, CORDAO(), P.gray700),
    revisor: blazer(P.gray600, P.gray700, CORDAO(), P.navy800),
    pesquisador: polo(CORDAO(), "gola"),
    testador: polo(CORDAO(), "manga"),
    dev: camisa(CORDAO(), "gola"),
    documentador: camisa(CORDAO(), "manga"),
    convidado: { ...polo(cor("rh-aco")), visitor: true },
  }),
);

const roleColorsMemo = derivada(roleColors);

export const theme: Theme = {
  officeName: "Rhynor Studio",
  subtitle: "Time de agentes do Claude Code",
  logoUrl: "",
  get colors() {
    return colors();
  },
  get uniforms() {
    return uniforms();
  },
  get roleColors() {
    return roleColorsMemo();
  },
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
 * Uniforme de um Personagem do elenco: a roupa dele com o cordão na cor dele. Gola, faixa e
 * lenço seguem o uniforme do papel quando a peça é a mesma; o destaque troca o detalhe
 * (gravata dourada, blazer cinza, crachá de visitante).
 */
export function uniformForPersonagem(ag: Personagem): Uniform {
  const base = theme.uniforms[ag.papel];
  const trim = base?.kind === ag.roupa ? base.trim : undefined;
  const accent = ag.destaque === "cracha-visitante" ? cor("rh-aco") : CORDAO();
  let u: Uniform;
  switch (ag.roupa) {
    case "terno":
      u = { ...theme.uniforms.lider, accent, tie: ag.destaque === "gravata-dourada" ? cor("rh-aviso") : P.navy900 };
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
