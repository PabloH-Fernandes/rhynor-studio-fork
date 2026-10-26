// =====================================================================
//  TEMA DO ESCRITÓRIO — é aqui que você personaliza tudo.
//
//  A marca fica em assets/marca (servida em /marca) e a fonte da verdade
//  é referencias/rhynor-marca.md.
// =====================================================================

import { CORES_ROUPA, HAIR_COLORS, ROUPAS_ABERTAS, SKIN_TONES, tokenDe, type Personagem, type Roupa, type Swatch } from "../../shared/roster";
import { comAlfa, cor, derivada, misturar, type NomeCor } from "./marca/cores";

/** mistura de dois tokens (t = 0 é o primeiro) */
const m = (a: NomeCor, b: NomeCor, t: number) => misturar(a, b, t);

/**
 * Paleta do canvas, toda derivada dos tokens da marca (web/src/marca/tokens.css): cada folha é lida
 * na hora do uso (e memorizada até os tokens mudarem), então nada aqui roda antes do CSS carregar.
 * Os nomes seguem os tokens (`palette.noite`, `palette.superficie`, `palette.ardosia`...); o comentário
 * diz o papel de cada um.
 */
const ESPEC = {
  noite: () => cor("rh-noite"), // contorno, sapatos, tinta escura
  noiteArdosia: () => m("rh-noite", "rh-ardosia", 0.45), // tom escuro de roupa
  superficie: () => cor("rh-superficie"), // placa, lambril, painéis
  superficieArdosia: () => m("rh-superficie", "rh-ardosia", 0.5), // calças, filetes, moldura dos monitores
  ardosia: () => cor("rh-ardosia"), // placas e tapete
  borda: () => cor("rh-borda"), // bordas
  bordaAco: () => m("rh-borda", "rh-aco", 0.45), // ícones e detalhes
  aco: () => cor("rh-aco"), // texto secundário
  nevoa: () => cor("rh-nevoa"), // balão de chat
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
    /** contorno da mesa de quem está trabalhando agora (laranja da marca, como o cordão dos crachás) */
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
    /** boné: copa ardósia e aba noite */
    cap: () => cor("rh-ardosia"),
    capBrim: () => cor("rh-noite"),
    /** gorro petróleo com a barra dobrada mais escura */
    beanie: () => cor("rh-pixel-roupa-petroleo"),
    /** cachecol ocre com listra creme */
    scarf: () => cor("rh-pixel-roupa-ocre"),
    scarfStripe: () => cor("rh-pixel-roupa-creme"),
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
    antennaOff: () => m("rh-alerta", "rh-noite", 0.6),
    posterSky: () => m("rh-aco", "rh-nevoa", 0.5),
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
export const ardosiaAlpha = (a: number) => comAlfa("rh-ardosia", a);

/** noite com alpha: fundo da etiqueta de nome */
export const inkAlpha = (a: number) => comAlfa("rh-noite", a);

/**
 * Visual de um boneco: a roupa casual e as cores já resolvidas dos tokens. Sem uniforme e sem
 * logo no peito: a marca aparece no crachá (topo ardósia, corpo névoa) e no cordão laranja.
 */
export interface Visual {
  roupa: Roupa;
  /** cor da peça de cima */
  shirt: string;
  /** sombra da peça de cima (mangas, barra, capuz) */
  shirtShade: string;
  /** camisa aberta e jaqueta: a camiseta de baixo, à mostra na frente */
  inner?: string;
  /** cordão do crachá: sempre o laranja da marca */
  accent: string;
  /** crachá de visitante: corpo em aço em vez de névoa */
  visitor?: boolean;
  pants: string;
  shoes: string;
}

export interface Theme {
  officeName: string;
  subtitle: string;
  colors: {
    floorA: string;
    floorB: string;
    floorLine: string;
    rug: string;
    rugBorder: string;
    wall: string;
    /** juntas sutis das placas da parede */
    wallJoint: string;
    /** lambril (faixa de baixo da parede) e a borda de cima dele */
    wainscot: string;
    wainscotTop: string;
    /** friso de 1px entre a parede e o lambril */
    trim: string;
    /** sombra da parede no chão (com alpha) */
    wallShadow: string;
    wood: string;
    woodShade: string;
    woodLight: string;
    sign: string;
    signText: string;
    outline: string;
  };
  /** cor de cada papel (painel lateral); sem cor por papel, é aço para todos */
  roleColors: Record<string, string>;
  /** função de cada papel na plaquinha da mesa (office/deskLabel.ts) */
  deskLabels: Record<string, string>;
}

/** papéis conhecidos (o painel e as plaquinhas não usam mais cor por papel: tudo em aço) */
const PAPEIS = ["lider", "planejador", "dev", "testador", "revisor", "documentador", "pesquisador", "convidado"] as const;
const roleColors = (): Record<string, string> => Object.fromEntries(PAPEIS.map((p) => [p, cor("rh-aco")]));

const colors = derivada(
  (): Theme["colors"] => ({
    floorA: palette.floor.tileA,
    floorB: palette.floor.tileB,
    floorLine: palette.floor.joint,
    rug: m("rh-ardosia", "rh-noite", 0.25),
    rugBorder: palette.superficie,
    wall: palette.gray100,
    wallJoint: palette.decor.wallJoint,
    wainscot: palette.superficie,
    wainscotTop: palette.superficieArdosia,
    trim: cor("rh-aco"),
    wallShadow: comAlfa("rh-noite", 0.16),
    wood: palette.furniture.wood,
    woodShade: palette.furniture.woodShade,
    woodLight: palette.furniture.woodLight,
    sign: cor("rh-noite"),
    signText: cor("rh-nevoa"),
    outline: palette.noite,
  }),
);

const roleColorsMemo = derivada(roleColors);

export const theme: Theme = {
  officeName: "Rhynor Studio",
  subtitle: "Time de agentes do Claude Code",
  get colors() {
    return colors();
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

export const roleColor = (role: string) => theme.roleColors[role] ?? theme.roleColors.convidado;

/** cor de um id da lista (pele, cabelo ou roupa); id desconhecido cai no primeiro da lista */
export function corDoId(lista: readonly Swatch[], id: string | undefined): string {
  return cor((tokenDe(lista, id ?? "") ?? lista[0].token) as NomeCor);
}

/** monta o visual a partir dos ids de cor */
function visual(roupa: Roupa, corRoupa: string, corCalca: string, corInterna: string | undefined, visitor: boolean): Visual {
  const shirt = corDoId(CORES_ROUPA, corRoupa);
  return {
    roupa,
    shirt,
    shirtShade: misturar(shirt, "rh-noite", 0.28),
    inner: ROUPAS_ABERTAS.includes(roupa) ? corDoId(CORES_ROUPA, corInterna ?? "nevoa") : undefined,
    accent: cor("rh-laranja"),
    visitor,
    pants: corDoId(CORES_ROUPA, corCalca),
    shoes: palette.noite,
  };
}

/** Visual de um Personagem do elenco: a roupa e as cores dele, cordão laranja, crachá de visitante se for convidado. */
export function visualDoPersonagem(pers: Personagem): Visual {
  return visual(pers.roupa, pers.corRoupa, pers.corCalca, pers.corInterna, pers.destaque === "cracha-visitante");
}

/** roupa de quem não está no elenco (visitante extra ou sem elenco), sorteada de forma fixa pelo hash */
const ROUPAS_SORTEIO: readonly [Roupa, string, string][] = [
  ["camiseta", "grafite", "jeans"],
  ["moletom", "petroleo", "grafite"],
  ["sueter", "oliva", "jeans"],
  ["camiseta", "ocre", "grafite"],
  ["sueter", "creme", "ardosia"],
];

/** Visual padrão por papel e hash (convidado sem elenco ganha o crachá de visitante). */
export function visualPadrao(role: string, h: number): Visual {
  const [roupa, corRoupa, corCalca] = ROUPAS_SORTEIO[h % ROUPAS_SORTEIO.length];
  return visual(roupa, corRoupa, corCalca, undefined, role === "convidado" || !Object.hasOwn(theme.deskLabels, role));
}

/** tons de pele e cabelo de quem não está no elenco, sorteados pelo hash do id (as listas moram em shared/roster.ts) */
export const skinPorHash = (h: number) => corDoId(SKIN_TONES, SKIN_TONES[h % SKIN_TONES.length].id);
export const hairPorHash = (h: number) => corDoId(HAIR_COLORS, HAIR_COLORS[h % HAIR_COLORS.length].id);
