// =====================================================================
//  TEMA DO ESCRITÓRIO — é aqui que você personaliza tudo.
//
//  Pra versão da empresa: troque officeName, coloque a logo oficial em
//  web/public/logo.png (fundo transparente fica melhor) e ajuste as cores
//  dos uniformes pra bater com o manual de marca.
// =====================================================================

export interface Uniform {
  /** cor principal da camisa */
  shirt: string;
  /** sombra da camisa (parte de baixo / mangas) */
  shirtShade: string;
  /** detalhe: gola, crachá, faixa */
  accent: string;
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

const uniform = (shirt: string, shirtShade: string, accent: string, pants = "#2b3245", shoes = "#1b1d26"): Uniform => ({
  shirt,
  shirtShade,
  accent,
  pants,
  shoes,
});

export const theme: Theme = {
  officeName: "TI · Escritório de IA",
  subtitle: "Time de agentes do Claude Code",
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
    outline: "#1d1a24",
  },

  uniforms: {
    lider: uniform("#1f2d4d", "#16213a", "#f2c14e", "#1b1f2e"),
    planejador: uniform("#7a5af5", "#5f43cf", "#f4f1e8"),
    dev: uniform("#2f9e6d", "#237a54", "#f4f1e8"),
    testador: uniform("#e0703a", "#b9572a", "#f4f1e8"),
    revisor: uniform("#d64561", "#ad3249", "#f4f1e8"),
    documentador: uniform("#3a8fd6", "#2b70ab", "#f4f1e8"),
    pesquisador: uniform("#c9a227", "#a3821b", "#2b3245"),
    convidado: uniform("#8a8f9c", "#6d7280", "#f4f1e8"),
  },

  roleColors: {
    lider: "#f2c14e",
    planejador: "#9b82ff",
    dev: "#3fbf86",
    testador: "#f08a52",
    revisor: "#ef5f7b",
    documentador: "#5aaef0",
    pesquisador: "#e2bd3c",
    convidado: "#a3a8b5",
  },

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
export const HAIRS = ["#2a1d17", "#4a3021", "#7a4b2a", "#c58a4a", "#e2c27a", "#1c1c1c", "#8c8c8c", "#6b2f2f"];
