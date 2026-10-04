// Elenco fixo dos AGzinhos: quem é quem no escritório (nome, visual, jeito e falas).
// Fica salvo no servidor em data/agzinhos.json; estes são os valores padrão.
// Sem dependências: o mesmo arquivo roda no servidor (tsx) e no navegador (Vite).

export type Genero = "feminino" | "masculino";

/** polo marinho com AG branco, camisa branca com AG marinho, blazer ou terno */
export type Roupa = "polo" | "camisa" | "blazer" | "terno";

/** detalhe especial da roupa, além do uniforme do papel */
export type Destaque =
  | "gravata-dourada" // terno do líder
  | "blazer-cinza" // blazer cinza em vez do marinho
  | "cracha-visitante"; // convidados

/**
 * Estilos de cabelo desenhados em web/src/office/sprites.ts
 * (o índice em HAIR_STYLE_INDEX é o `hairStyle` de lá).
 */
export type EstiloCabelo =
  | "curto"
  | "comprido"
  | "raspado"
  | "coque"
  | "rabo-de-cavalo"
  | "cacheado"
  | "franja-lateral"
  | "chanel"
  | "trancas";

export type Acessorio =
  | "headset"
  | "capacete-branco"
  | "capacete-amarelo"
  | "oculos"
  | "colete"
  | "prancheta"
  | "caneca"
  | "lapis"
  | "relogio"
  | "barba";

export interface AGzinho {
  /** identificador fixo (lider, dev, dev-2, explore...) */
  key: string;
  /** papel que ele cobre: lider, planejador, dev... ou "convidado" */
  papel: string;
  /** key do AGzinho principal quando este é a variação para trabalho em paralelo */
  variacaoDe?: string;
  /** convidados: tipos de subagente que ele atende ("*" = qualquer outro) */
  agentTypes?: string[];
  nome: string;
  /** vai na plaquinha da mesa: até 6 letras */
  apelido: string;
  /** cargo com gênero ("Desenvolvedora", "Pesquisador") */
  cargo: string;
  genero: Genero;
  /** tom de pele (hex) */
  pele: string;
  cabelo: { estilo: EstiloCabelo; cor: string };
  roupa: Roupa;
  destaque?: Destaque;
  acessorios: Acessorio[];
  /** cor do cordão do crachá (cor do papel); nunca o laranja de "te esperando" */
  cordao: string;
  /** matrícula fictícia AG-0000 */
  matricula: string;
  personalidade: string;
  /** 3 a 5 falas de bate-papo, até 28 caracteres, sem emoji */
  falas: string[];
}

export interface Roster {
  versao: 1;
  /** ISO 8601 */
  atualizadoEm: string;
  agzinhos: AGzinho[];
}

// ------------------------------------------------------------------ opções

export const GENEROS: readonly Genero[] = ["feminino", "masculino"];
export const ROUPAS: readonly Roupa[] = ["polo", "camisa", "blazer", "terno"];
export const DESTAQUES: readonly Destaque[] = ["gravata-dourada", "blazer-cinza", "cracha-visitante"];
export const ESTILOS_CABELO: readonly EstiloCabelo[] = [
  "curto",
  "comprido",
  "raspado",
  "coque",
  "rabo-de-cavalo",
  "cacheado",
  "franja-lateral",
  "chanel",
  "trancas",
];
export const ACESSORIOS: readonly Acessorio[] = [
  "headset",
  "capacete-branco",
  "capacete-amarelo",
  "oculos",
  "colete",
  "prancheta",
  "caneca",
  "lapis",
  "relogio",
  "barba",
];

/**
 * Parte do corpo de cada acessório: um por camada (a validação confere). "pelos" (barba) é
 * desenhada antes do "rosto", então barba e óculos convivem. sprites.ts lê daqui.
 */
export type Camada = "cabeca" | "pelos" | "rosto" | "tronco" | "mao" | "pulso";
export const CAMADAS: readonly Camada[] = ["cabeca", "pelos", "rosto", "tronco", "mao", "pulso"];
export const CAMADA_DO_ACESSORIO: Record<Acessorio, Camada> = {
  headset: "cabeca",
  "capacete-branco": "cabeca",
  "capacete-amarelo": "cabeca",
  lapis: "cabeca",
  barba: "pelos",
  oculos: "rosto",
  colete: "tronco",
  prancheta: "mao",
  caneca: "mao",
  relogio: "pulso",
};

/** campos que o vestiário (e o PUT /api/roster) pode mudar; papel, cargo, cordão, matrícula, key e falas não */
export const CAMPOS_EDITAVEIS = ["nome", "apelido", "genero", "pele", "cabelo", "roupa", "destaque", "acessorios"] as const satisfies readonly (keyof AGzinho)[];
export type CampoEditavel = (typeof CAMPOS_EDITAVEIS)[number];

/** cargo de cada papel nos dois gêneros */
export const CARGOS: Record<string, Record<Genero, string>> = {
  lider: { feminino: "Líder", masculino: "Líder" },
  planejador: { feminino: "Planejadora", masculino: "Planejador" },
  pesquisador: { feminino: "Pesquisadora", masculino: "Pesquisador" },
  dev: { feminino: "Desenvolvedora", masculino: "Desenvolvedor" },
  testador: { feminino: "Testadora", masculino: "Testador" },
  revisor: { feminino: "Revisora", masculino: "Revisor" },
  documentador: { feminino: "Documentadora", masculino: "Documentador" },
};

/** convidados têm cargo próprio (Exploradora, Consultor...): o par é achado pelo cargo atual */
export const CARGOS_CONVIDADO: readonly Record<Genero, string>[] = [
  { feminino: "Exploradora", masculino: "Explorador" },
  { feminino: "Consultora", masculino: "Consultor" },
  { feminino: "Generalista", masculino: "Generalista" },
];

/** cargo que combina com o gênero; cargo desconhecido fica como está */
export function cargoDe(papel: string, genero: Genero, atual: string): string {
  const par = Object.hasOwn(CARGOS, papel)
    ? CARGOS[papel]
    : [...CARGOS_CONVIDADO, ...Object.values(CARGOS)].find((c) => c.feminino === atual || c.masculino === atual);
  return par ? par[genero] : atual;
}

/** estilo → `hairStyle` desenhado em sprites.ts (0 curto ... 6 franja lateral, 7 chanel, 8 trancas) */
export const HAIR_STYLE_INDEX: Record<EstiloCabelo, number> = {
  curto: 0,
  comprido: 1,
  raspado: 2,
  coque: 3,
  "rabo-de-cavalo": 4,
  cacheado: 5,
  "franja-lateral": 6,
  chanel: 7,
  trancas: 8,
};

export interface Swatch {
  id: string;
  nome: string;
  hex: string;
}

/** tons de pele, do mais claro ao mais escuro (web/src/theme.ts reexporta como SKINS) */
export const SKIN_TONES: readonly Swatch[] = [
  { id: "clara", nome: "Clara", hex: "#f1c9a5" },
  { id: "clara-media", nome: "Clara-média", hex: "#e0ac84" },
  { id: "media", nome: "Média", hex: "#c68b62" },
  { id: "morena", nome: "Morena", hex: "#a86f4c" },
  { id: "negra", nome: "Negra", hex: "#7d5038" },
  { id: "negra-retinta", nome: "Negra retinta", hex: "#5c3a28" },
];

/** cores de cabelo (web/src/theme.ts reexporta como HAIRS; a ordem importa para o sorteio por hash) */
export const HAIR_COLORS: readonly Swatch[] = [
  { id: "castanho-escuro", nome: "Castanho-escuro", hex: "#2a1d17" },
  { id: "castanho", nome: "Castanho", hex: "#4a3021" },
  { id: "castanho-claro", nome: "Castanho-claro", hex: "#7a4b2a" },
  { id: "mel", nome: "Mel", hex: "#c58a4a" },
  { id: "loiro-claro", nome: "Loiro-claro", hex: "#e2c27a" },
  { id: "preto", nome: "Preto", hex: "#1c1c1c" },
  { id: "cinza", nome: "Cinza", hex: "#8c8c8c" },
  { id: "acaju", nome: "Acaju", hex: "#6b2f2f" },
  { id: "grisalho", nome: "Grisalho", hex: "#B8BCC4" },
  { id: "ruivo", nome: "Ruivo", hex: "#8A3B1F" },
  { id: "loiro", nome: "Loiro", hex: "#D9B46A" },
];

/** laranja exclusivo de "te esperando": nenhum cordão pode usar */
export const WAITING_ORANGE = "#FF8A00";

/** regra de uniforme: terno só o líder; blazer planejador e revisor; o resto polo ou camisa */
export function ROUPAS_PERMITIDAS(papel: string): Roupa[] {
  if (papel === "lider") return ["terno"];
  if (papel === "planejador" || papel === "revisor") return ["blazer"];
  return ["polo", "camisa"];
}

/**
 * Destaques que combinam com o papel e a roupa: gravata dourada só com terno, blazer cinza
 * só com blazer, e o crachá de visitante é de convidado (e obrigatório para ele).
 */
export function DESTAQUES_PERMITIDOS(papel: string, roupa: Roupa): Destaque[] {
  if (papel === "convidado") return ["cracha-visitante"];
  if (roupa === "terno") return ["gravata-dourada"];
  if (roupa === "blazer") return ["blazer-cinza"];
  return [];
}

// ------------------------------------------------------------------ elenco padrão

const skin = (id: string) => SKIN_TONES.find((t) => t.id === id)!.hex;
const hair = (id: string) => HAIR_COLORS.find((c) => c.id === id)!.hex;

export const DEFAULT_ROSTER: Roster = {
  versao: 1,
  atualizadoEm: "2026-10-03T00:00:00.000Z",
  agzinhos: [
    {
      key: "lider",
      papel: "lider",
      nome: "Augusto Vilela",
      apelido: "GUTO",
      cargo: "Líder",
      genero: "masculino",
      pele: skin("media"),
      cabelo: { estilo: "franja-lateral", cor: hair("grisalho") },
      roupa: "terno",
      destaque: "gravata-dourada",
      acessorios: ["relogio"],
      cordao: "#F2C14E",
      matricula: "AG-0001",
      personalidade: "calmo, decidido, gentil",
      falas: ["Bora alinhar rapidinho?", "Bom trabalho, time!", "Quem pega essa?", "Café e foco, pessoal."],
    },
    {
      key: "planejador",
      papel: "planejador",
      nome: "Marina Toledo",
      apelido: "MARINA",
      cargo: "Planejadora",
      genero: "feminino",
      pele: skin("clara"),
      cabelo: { estilo: "coque", cor: hair("castanho") },
      roupa: "blazer",
      acessorios: ["prancheta"],
      cordao: "#9B82FF",
      matricula: "AG-0002",
      personalidade: "organizada, metódica, otimista",
      falas: ["Já anotei no quadro!", "Passo a passo, gente.", "Prazo tá folgado.", "Cada coisa no lugar."],
    },
    {
      key: "pesquisador",
      papel: "pesquisador",
      nome: "Caio Nogueira",
      apelido: "CAIO",
      cargo: "Pesquisador",
      genero: "masculino",
      pele: skin("morena"),
      cabelo: { estilo: "cacheado", cor: hair("preto") },
      roupa: "polo",
      acessorios: ["oculos"],
      cordao: "#E2BD3C",
      matricula: "AG-0003",
      personalidade: "curioso, detalhista, falante",
      falas: ["Li um artigo ótimo!", "Tem doc pra tudo, viu?", "Sabia que tem versão nova?", "Deixa eu conferir isso."],
    },
    {
      key: "dev",
      papel: "dev",
      nome: "Beatriz Lima",
      apelido: "BIA",
      cargo: "Desenvolvedora",
      genero: "feminino",
      pele: skin("negra"),
      cabelo: { estilo: "trancas", cor: hair("preto") },
      roupa: "camisa",
      acessorios: ["headset"],
      cordao: "#3FBF86",
      matricula: "AG-0004",
      personalidade: "focada, criativa, bem-humorada",
      falas: ["Compilou de primeira!", "Só mais um commit...", "Quem mexeu no meu CSS?", "Tá rodando aqui!"],
    },
    {
      key: "testador",
      papel: "testador",
      nome: "Rafael Mendes",
      apelido: "RAFA",
      cargo: "Testador",
      genero: "masculino",
      pele: skin("clara-media"),
      cabelo: { estilo: "curto", cor: hair("castanho-claro") },
      roupa: "polo",
      acessorios: ["relogio"],
      cordao: "#2EC4B6",
      matricula: "AG-0005",
      personalidade: "cuidadoso, paciente, cético",
      falas: ["Rodei 3 vezes, passou.", "E se clicar duas vezes?", "Achei um caso de borda.", "Confia, mas testa."],
    },
    {
      key: "revisor",
      papel: "revisor",
      nome: "Lúcia Ferraz",
      apelido: "LÚCIA",
      cargo: "Revisora",
      genero: "feminino",
      pele: skin("negra-retinta"),
      cabelo: { estilo: "chanel", cor: hair("castanho-escuro") },
      roupa: "blazer",
      destaque: "blazer-cinza",
      acessorios: ["oculos"],
      cordao: "#EF5F7B",
      matricula: "AG-0006",
      personalidade: "criteriosa, sincera, gentil",
      falas: ["Ficou bem legível!", "Só um detalhezinho...", "Esse nome tá ótimo.", "Aprovado com carinho."],
    },
    {
      key: "documentador",
      papel: "documentador",
      nome: "Davi Sampaio",
      apelido: "DAVI",
      cargo: "Documentador",
      genero: "masculino",
      pele: skin("clara"),
      cabelo: { estilo: "raspado", cor: hair("castanho") },
      roupa: "camisa",
      acessorios: ["lapis", "barba"],
      cordao: "#5AAEF0",
      matricula: "AG-0007",
      personalidade: "didático, calmo, caprichoso",
      falas: ["Já tá no README!", "Um exemplo ajuda, né?", "Escrevi bem simples.", "Faltou só um print."],
    },
    {
      key: "dev-2",
      papel: "dev",
      variacaoDe: "dev",
      nome: "Yasmin Okada",
      apelido: "YASMIN",
      cargo: "Desenvolvedora",
      genero: "feminino",
      pele: skin("clara"),
      cabelo: { estilo: "comprido", cor: hair("preto") },
      roupa: "polo",
      acessorios: ["headset"],
      cordao: "#A6D854",
      matricula: "AG-0008",
      personalidade: "animada, rápida, prática",
      falas: ["Pareando com a Bia!", "Testa aí no seu PC?", "Subi a correção já.", "Bora que dá tempo!"],
    },
    {
      key: "pesquisador-2",
      papel: "pesquisador",
      variacaoDe: "pesquisador",
      nome: "Tomás Ribeiro",
      apelido: "TOMÁS",
      cargo: "Pesquisador",
      genero: "masculino",
      pele: skin("negra-retinta"),
      cabelo: { estilo: "curto", cor: hair("preto") },
      roupa: "camisa",
      acessorios: ["prancheta"],
      cordao: "#D98FD3",
      matricula: "AG-0009",
      personalidade: "tranquilo, observador, nerd",
      falas: ["Achei a fonte original!", "Anotei 3 referências.", "Vale ler o changelog.", "Hmm, interessante..."],
    },
    {
      key: "explore",
      papel: "convidado",
      agentTypes: ["explore"],
      nome: "Iara Campos",
      apelido: "IARA",
      cargo: "Exploradora",
      genero: "feminino",
      pele: skin("morena"),
      cabelo: { estilo: "rabo-de-cavalo", cor: hair("acaju") },
      roupa: "polo",
      destaque: "cracha-visitante",
      acessorios: ["capacete-branco"],
      cordao: "#B7A58C",
      matricula: "AG-0010",
      personalidade: "aventureira, rápida, sorridente",
      falas: ["Já vasculhei tudo!", "Achei na pasta src/", "Mapa do projeto pronto.", "Partiu explorar!"],
    },
    {
      key: "general-purpose",
      papel: "convidado",
      agentTypes: ["general-purpose"],
      nome: "Jorge Batista",
      apelido: "JORGE",
      cargo: "Generalista",
      genero: "masculino",
      pele: skin("media"),
      cabelo: { estilo: "raspado", cor: hair("grisalho") },
      roupa: "camisa",
      destaque: "cracha-visitante",
      acessorios: ["colete"],
      cordao: "#A3A8B5",
      matricula: "AG-0011",
      personalidade: "prestativo, versátil, tranquilo",
      falas: ["Precisa de mão aí?", "Faço o que precisar!", "Deixa comigo.", "Já já fica pronto."],
    },
    {
      key: "curinga",
      papel: "convidado",
      agentTypes: ["plan", "*"],
      nome: "Sofia Arruda",
      apelido: "SOFIA",
      cargo: "Consultora",
      genero: "feminino",
      pele: skin("clara-media"),
      cabelo: { estilo: "comprido", cor: hair("mel") },
      roupa: "polo",
      destaque: "cracha-visitante",
      acessorios: ["caneca"],
      cordao: "#8A9A5B",
      matricula: "AG-0012",
      personalidade: "gentil, estratégica, curiosa",
      falas: ["Posso dar uma ideia?", "Visitando o time hoje!", "Que escritório lindo!", "Gostei desse plano."],
    },
  ],
};

// ------------------------------------------------------------------ validação

export type RosterResult = { ok: true; roster: Roster } | { ok: false; erros: string[] };

/** limites de tamanho do elenco (o vestiário usa os mesmos nos contadores) */
export const LIMITS = {
  agzinhos: 40,
  key: 32,
  nome: 40,
  apelido: 6,
  cargo: 40,
  personalidade: 80,
  fala: 28,
  falasMin: 3,
  falasMax: 5,
  agentTypes: 10,
  agentType: 64,
  acessorios: 6,
} as const;

const HEX = /^#[0-9a-fA-F]{6}$/;
const KEY = /^[a-z0-9][a-z0-9-]*$/;
const MATRICULA = /^AG-\d{4}$/;
const EMOJI = /\p{Extended_Pictographic}/u;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
/** conta caracteres de verdade (acentos e afins contam 1) */
const len = (s: string) => [...s.normalize("NFC")].length;
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => typeof x === "string" && (list as readonly string[]).includes(x);

function text(erros: string[], where: string, x: unknown, max: number, min = 1): x is string {
  if (typeof x !== "string") {
    erros.push(`${where}: precisa ser texto`);
    return false;
  }
  const n = len(x.trim());
  if (n < min || len(x) > max) {
    erros.push(`${where}: precisa ter de ${min} a ${max} caracteres`);
    return false;
  }
  return true;
}

/** cor #RRGGBB; o laranja de "te esperando" é proibido em tudo que é do AGzinho */
function hex(erros: string[], where: string, x: unknown): x is string {
  if (typeof x !== "string" || !HEX.test(x)) {
    erros.push(`${where}: cor inválida (use #RRGGBB)`);
    return false;
  }
  if (x.toUpperCase() === WAITING_ORANGE) {
    erros.push(`${where}: o laranja ${WAITING_ORANGE} é exclusivo de "te esperando"`);
    return false;
  }
  return true;
}

/** Erros de um AGzinho sozinho (sem as regras que comparam com os outros, como key repetida). */
export function agzinhoErrors(x: unknown, i = 0): string[] {
  const erros: string[] = [];
  const at = `agzinhos[${i}]`;
  if (!isObj(x)) return [`${at}: precisa ser um objeto`];
  const who = typeof x.key === "string" && x.key ? `${at} (${x.key})` : at;

  if (text(erros, `${who}.key`, x.key, LIMITS.key) && !KEY.test(x.key)) erros.push(`${who}.key: use só letras minúsculas, números e hífen`);
  if (text(erros, `${who}.papel`, x.papel, LIMITS.key) && !KEY.test(x.papel)) erros.push(`${who}.papel: use só letras minúsculas, números e hífen`);
  if (x.variacaoDe !== undefined) text(erros, `${who}.variacaoDe`, x.variacaoDe, LIMITS.key);
  if (x.agentTypes !== undefined) {
    if (!Array.isArray(x.agentTypes) || x.agentTypes.length > LIMITS.agentTypes) {
      erros.push(`${who}.agentTypes: precisa ser uma lista com até ${LIMITS.agentTypes} tipos`);
    } else {
      x.agentTypes.forEach((t, j) => text(erros, `${who}.agentTypes[${j}]`, t, LIMITS.agentType));
    }
  }
  if (text(erros, `${who}.nome`, x.nome, LIMITS.nome) && EMOJI.test(x.nome)) erros.push(`${who}.nome: sem emoji`);
  if (text(erros, `${who}.apelido`, x.apelido, LIMITS.apelido) && EMOJI.test(x.apelido)) erros.push(`${who}.apelido: sem emoji`);
  text(erros, `${who}.cargo`, x.cargo, LIMITS.cargo);
  text(erros, `${who}.personalidade`, x.personalidade, LIMITS.personalidade);
  if (!oneOf(GENEROS, x.genero)) erros.push(`${who}.genero: use ${GENEROS.join(" ou ")}`);
  hex(erros, `${who}.pele`, x.pele);

  if (!isObj(x.cabelo)) {
    erros.push(`${who}.cabelo: precisa ter estilo e cor`);
  } else {
    if (!oneOf(ESTILOS_CABELO, x.cabelo.estilo)) erros.push(`${who}.cabelo.estilo: estilo desconhecido`);
    hex(erros, `${who}.cabelo.cor`, x.cabelo.cor);
  }

  const papel = typeof x.papel === "string" ? x.papel : "";
  if (!oneOf(ROUPAS, x.roupa)) {
    erros.push(`${who}.roupa: use ${ROUPAS.join(", ")}`);
  } else {
    if (!ROUPAS_PERMITIDAS(papel).includes(x.roupa)) {
      erros.push(`${who}.roupa: "${x.roupa}" não é permitida para o papel ${papel} (use ${ROUPAS_PERMITIDAS(papel).join(" ou ")})`);
    }
    const permitidos = DESTAQUES_PERMITIDOS(papel, x.roupa);
    if (x.destaque !== undefined && !oneOf(permitidos, x.destaque)) {
      erros.push(`${who}.destaque: "${String(x.destaque)}" não combina com ${papel} de ${x.roupa}`);
    }
    if (papel === "convidado" && x.destaque !== "cracha-visitante") erros.push(`${who}.destaque: convidado usa "cracha-visitante"`);
  }

  if (!Array.isArray(x.acessorios) || x.acessorios.length > LIMITS.acessorios) {
    erros.push(`${who}.acessorios: precisa ser uma lista com até ${LIMITS.acessorios} itens`);
  } else {
    x.acessorios.forEach((a, j) => {
      if (!oneOf(ACESSORIOS, a)) erros.push(`${who}.acessorios[${j}]: acessório desconhecido`);
    });
    if (new Set(x.acessorios).size !== x.acessorios.length) erros.push(`${who}.acessorios: item repetido`);
    const camadas = x.acessorios.filter((a): a is Acessorio => oneOf(ACESSORIOS, a)).map((a) => CAMADA_DO_ACESSORIO[a]);
    for (const c of new Set(camadas.filter((c, j) => camadas.indexOf(c) !== j))) erros.push(`${who}.acessorios: no máximo 1 acessório na camada ${c}`);
  }

  hex(erros, `${who}.cordao`, x.cordao);
  if (typeof x.matricula !== "string" || !MATRICULA.test(x.matricula)) erros.push(`${who}.matricula: use o formato AG-0000`);

  if (!Array.isArray(x.falas) || x.falas.length < LIMITS.falasMin || x.falas.length > LIMITS.falasMax) {
    erros.push(`${who}.falas: precisa ter de ${LIMITS.falasMin} a ${LIMITS.falasMax} falas`);
  } else {
    x.falas.forEach((f, j) => {
      if (text(erros, `${who}.falas[${j}]`, f, LIMITS.fala) && EMOJI.test(f)) erros.push(`${who}.falas[${j}]: sem emoji`);
    });
  }
  return erros;
}

/**
 * Cópia só com os campos conhecidos de AGzinho (o resto é descartado). Não valida:
 * os valores vêm como estão. Campos opcionais ausentes não aparecem.
 */
export function cleanAGzinho(x: Record<string, unknown>): AGzinho {
  const out: Record<string, unknown> = {};
  for (const k of AGZINHO_FIELDS) if (x[k] !== undefined) out[k] = x[k];
  if (isObj(x.cabelo)) out.cabelo = { estilo: x.cabelo.estilo, cor: x.cabelo.cor };
  if (Array.isArray(x.agentTypes)) out.agentTypes = [...x.agentTypes];
  if (Array.isArray(x.acessorios)) out.acessorios = [...x.acessorios];
  if (Array.isArray(x.falas)) out.falas = [...x.falas];
  return out as unknown as AGzinho;
}

/** todos os campos de AGzinho, na ordem em que aparecem no JSON salvo */
const AGZINHO_FIELDS = [
  "key",
  "papel",
  "variacaoDe",
  "agentTypes",
  "nome",
  "apelido",
  "cargo",
  "genero",
  "pele",
  "cabelo",
  "roupa",
  "destaque",
  "acessorios",
  "cordao",
  "matricula",
  "personalidade",
  "falas",
] as const satisfies readonly (keyof AGzinho)[];

/**
 * Confere tudo o que pode quebrar a tela ou fugir da regra de uniforme. Não altera a entrada:
 * em caso de sucesso devolve um elenco novo, limpo, só com os campos conhecidos.
 */
export function validateRoster(x: unknown): RosterResult {
  const erros: string[] = [];
  if (!isObj(x)) return { ok: false, erros: ["o elenco precisa ser um objeto"] };
  if (x.versao !== 1) erros.push("versao: precisa ser 1");
  if (!isDate(x.atualizadoEm)) erros.push("atualizadoEm: data inválida");
  if (!Array.isArray(x.agzinhos) || x.agzinhos.length === 0 || x.agzinhos.length > LIMITS.agzinhos) {
    erros.push(`agzinhos: precisa ser uma lista com 1 a ${LIMITS.agzinhos} AGzinhos`);
    return { ok: false, erros };
  }

  x.agzinhos.forEach((a, i) => erros.push(...agzinhoErrors(a, i)));

  const list = x.agzinhos.filter(isObj);
  const keys = list.map((a) => a.key);
  const dup = <T>(arr: T[]) => [...new Set(arr.filter((v, i) => arr.indexOf(v) !== i))];
  for (const k of dup(keys)) erros.push(`key repetida: ${String(k)}`);
  for (const m of dup(list.map((a) => a.matricula))) erros.push(`matrícula repetida: ${String(m)}`);
  for (const a of list) {
    if (a.variacaoDe !== undefined && !keys.includes(a.variacaoDe)) erros.push(`${String(a.key)}.variacaoDe: não existe AGzinho "${String(a.variacaoDe)}"`);
    if (a.variacaoDe !== undefined && a.variacaoDe === a.key) erros.push(`${String(a.key)}.variacaoDe: não pode apontar para ele mesmo`);
  }

  if (erros.length) return { ok: false, erros };
  return { ok: true, roster: { versao: 1, atualizadoEm: x.atualizadoEm as string, agzinhos: list.map(cleanAGzinho) } };
}

const isDate = (x: unknown): x is string => typeof x === "string" && !Number.isNaN(Date.parse(x));

/**
 * Completa um elenco salvo (talvez antigo ou parcial) com os padrões: cada AGzinho do
 * padrão ganha os campos que faltarem; AGzinhos extras do salvo entram no fim.
 * Só os campos conhecidos passam. Não valida: passe o resultado no validateRoster.
 */
export function mergeWithDefaults(parcial: unknown): Roster {
  const base = structuredClone(DEFAULT_ROSTER);
  if (!isObj(parcial) || !Array.isArray(parcial.agzinhos)) return base;

  const saved = new Map<string, AGzinho>();
  for (const a of parcial.agzinhos) if (isObj(a) && typeof a.key === "string") saved.set(a.key, cleanAGzinho(a));

  const agzinhos = base.agzinhos.map((def) => {
    const s = saved.get(def.key);
    if (!s) return def;
    saved.delete(def.key);
    const raw: unknown = s.cabelo;
    const cabelo = isObj(raw) ? { ...def.cabelo, ...stripUndefined(raw) } : (raw ?? def.cabelo);
    // destaque é opcional de verdade: no AGzinho salvo, não ter destaque significa "sem destaque"
    const { destaque: _padrao, ...semDestaque } = def;
    return { ...semDestaque, ...s, cabelo } as AGzinho;
  });
  agzinhos.push(...saved.values());
  // convidado salvo sem destaque (elenco antigo ou editado à mão): ganha o crachá de visitante
  for (const a of agzinhos) if (a.papel === "convidado" && a.destaque === undefined) a.destaque = "cracha-visitante";

  return {
    versao: 1,
    atualizadoEm: isDate(parcial.atualizadoEm) ? parcial.atualizadoEm : base.atualizadoEm,
    agzinhos,
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Parte de `atual` e copia de `de` só os CAMPOS_EDITAVEIS (o que faltar em `de` some, como o
 * destaque). O cargo acompanha o gênero. Não valida: os valores vêm como estão.
 */
export function aplicarEditaveis(atual: AGzinho, de: Record<string, unknown> | AGzinho): AGzinho {
  const out = structuredClone(atual) as unknown as Record<string, unknown>;
  const fonte = de as Record<string, unknown>;
  for (const campo of CAMPOS_EDITAVEIS) {
    const v = fonte[campo];
    if (v === undefined) delete out[campo];
    else out[campo] = structuredClone(v);
  }
  const ag = out as unknown as AGzinho;
  if (oneOf(GENEROS, ag.genero)) ag.cargo = cargoDe(ag.papel, ag.genero, ag.cargo);
  return ag;
}

/** AGzinho principal de um papel (sem variação), ex.: a plaquinha da mesa do dev */
export function agzinhoDoPapel(roster: Roster, papel: string): AGzinho | undefined {
  return roster.agzinhos.find((a) => a.papel === papel && !a.variacaoDe);
}
