// Elenco fixo dos Personagens: quem é quem no escritório (nome, visual, jeito e falas).
// Fica salvo no servidor em data/elenco.json; estes são os valores padrão.
// Sem dependências: o mesmo arquivo roda no servidor (tsx) e no navegador (Vite).
// Pele, cabelo e roupa são ids de cor; cada id aponta para um token da marca (--rh-pixel-* ou as
// cores da logo), resolvido só na tela (web/src/marca/cores.ts). Nenhum hex mora aqui.

export type Genero = "feminino" | "masculino";

/** roupas casuais desenhadas em web/src/office/sprites.ts */
export type Roupa = "camiseta" | "moletom" | "camisa-aberta" | "jaqueta" | "sueter";

/** detalhe especial: só o crachá de visitante dos convidados */
export type Destaque = "cracha-visitante";

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
  | "bone"
  | "gorro"
  | "oculos"
  | "cachecol"
  | "prancheta"
  | "caneca"
  | "lapis"
  | "relogio"
  | "barba";

export interface Personagem {
  /** identificador fixo (lider, dev, dev-2, explore...) */
  key: string;
  /** papel que ele cobre: lider, planejador, dev... ou "convidado" */
  papel: string;
  /** key do Personagem principal quando este é a variação para trabalho em paralelo */
  variacaoDe?: string;
  /** convidados: tipos de subagente que ele atende ("*" = qualquer outro) */
  agentTypes?: string[];
  nome: string;
  /** vai na plaquinha da mesa: até 6 letras */
  apelido: string;
  /** cargo com gênero ("Desenvolvedora", "Pesquisador") */
  cargo: string;
  genero: Genero;
  /** tom de pele: id de SKIN_TONES ("pele-1" ... "pele-6") */
  pele: string;
  /** estilo e cor (id de HAIR_COLORS) */
  cabelo: { estilo: EstiloCabelo; cor: string };
  roupa: Roupa;
  /** cor da peça de cima: id de CORES_ROUPA */
  corRoupa: string;
  /** camisa aberta e jaqueta: a camiseta por baixo (id de CORES_ROUPA) */
  corInterna?: string;
  /** calça: id de CORES_ROUPA */
  corCalca: string;
  destaque?: Destaque;
  acessorios: Acessorio[];
  /** matrícula fictícia RH-0000 */
  matricula: string;
  personalidade: string;
  /** 3 a 5 falas de bate-papo, até 28 caracteres, sem emoji */
  falas: string[];
  /** crachá, "O que eu faço": uma frase simples, para quem não é de TI */
  oQueFaco: string;
  /** crachá, "Sou responsável por:": 2 ou 3 itens curtos */
  responsabilidades: string[];
}

export interface Roster {
  versao: 1;
  /** ISO 8601 */
  atualizadoEm: string;
  personagens: Personagem[];
}

// ------------------------------------------------------------------ opções

export const GENEROS: readonly Genero[] = ["feminino", "masculino"];
export const ROUPAS: readonly Roupa[] = ["camiseta", "moletom", "camisa-aberta", "jaqueta", "sueter"];
/** roupas abertas na frente: mostram a camiseta de baixo (corInterna) */
export const ROUPAS_ABERTAS: readonly Roupa[] = ["camisa-aberta", "jaqueta"];
export const DESTAQUES: readonly Destaque[] = ["cracha-visitante"];
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
  "bone",
  "gorro",
  "oculos",
  "cachecol",
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
  bone: "cabeca",
  gorro: "cabeca",
  lapis: "cabeca",
  barba: "pelos",
  oculos: "rosto",
  cachecol: "tronco",
  prancheta: "mao",
  caneca: "mao",
  relogio: "pulso",
};

/** campos que o vestiário (e o PUT /api/roster) pode mudar; papel, cargo, matrícula, key e falas não */
export const CAMPOS_EDITAVEIS = [
  "nome",
  "apelido",
  "genero",
  "pele",
  "cabelo",
  "roupa",
  "corRoupa",
  "corInterna",
  "corCalca",
  "destaque",
  "acessorios",
  "oQueFaco",
  "responsabilidades",
] as const satisfies readonly (keyof Personagem)[];
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

/** uma cor que dá pra escolher: id salvo no elenco, nome no vestiário e o token da marca */
export interface Swatch {
  id: string;
  nome: string;
  /** nome do token sem os traços ("rh-pixel-pele-1"); a tela resolve a cor */
  token: string;
}

/** tons de pele, do mais claro ao mais escuro (pixel art aprovada em 2026-10-25) */
export const SKIN_TONES: readonly Swatch[] = [
  { id: "pele-1", nome: "Clara", token: "rh-pixel-pele-1" },
  { id: "pele-2", nome: "Clara-média", token: "rh-pixel-pele-2" },
  { id: "pele-3", nome: "Média", token: "rh-pixel-pele-3" },
  { id: "pele-4", nome: "Morena", token: "rh-pixel-pele-4" },
  { id: "pele-5", nome: "Negra", token: "rh-pixel-pele-5" },
  { id: "pele-6", nome: "Negra retinta", token: "rh-pixel-pele-6" },
];

/** cores de cabelo (a ordem importa para o sorteio por hash de quem não está no elenco); grisalho é o aço da marca */
export const HAIR_COLORS: readonly Swatch[] = [
  { id: "preto", nome: "Preto", token: "rh-pixel-cabelo-preto" },
  { id: "castanho-escuro", nome: "Castanho-escuro", token: "rh-pixel-cabelo-castanho-escuro" },
  { id: "castanho", nome: "Castanho", token: "rh-pixel-cabelo-castanho" },
  { id: "castanho-claro", nome: "Castanho-claro", token: "rh-pixel-cabelo-castanho-claro" },
  { id: "ruivo", nome: "Ruivo", token: "rh-pixel-cabelo-ruivo" },
  { id: "loiro", nome: "Loiro", token: "rh-pixel-cabelo-loiro" },
  { id: "grisalho", nome: "Grisalho", token: "rh-aco" },
];

/** cores de roupa e calça: as de pixel art e as da logo/interface que combinam com roupa */
export const CORES_ROUPA: readonly Swatch[] = [
  { id: "jeans", nome: "Jeans", token: "rh-pixel-roupa-jeans" },
  { id: "petroleo", nome: "Petróleo", token: "rh-pixel-roupa-petroleo" },
  { id: "oliva", nome: "Oliva", token: "rh-pixel-roupa-oliva" },
  { id: "vinho", nome: "Vinho", token: "rh-pixel-roupa-vinho" },
  { id: "ocre", nome: "Ocre", token: "rh-pixel-roupa-ocre" },
  { id: "creme", nome: "Creme", token: "rh-pixel-roupa-creme" },
  { id: "grafite", nome: "Grafite", token: "rh-pixel-roupa-grafite" },
  { id: "ardosia", nome: "Ardósia", token: "rh-ardosia" },
  { id: "aco", nome: "Aço", token: "rh-aco" },
  { id: "nevoa", nome: "Névoa", token: "rh-nevoa" },
  { id: "noite", nome: "Noite", token: "rh-noite" },
];

/** token de um id de cor (pele, cabelo ou roupa), ou undefined se o id não existe na lista */
export function tokenDe(lista: readonly Swatch[], id: string): string | undefined {
  return lista.find((s) => s.id === id)?.token;
}

/**
 * Destaques que combinam com o papel: o crachá de visitante é de convidado (e obrigatório para ele);
 * o time não tem destaque.
 */
export function DESTAQUES_PERMITIDOS(papel: string): Destaque[] {
  return papel === "convidado" ? ["cracha-visitante"] : [];
}

// ------------------------------------------------------------------ elenco padrão

export const DEFAULT_ROSTER: Roster = {
  versao: 1,
  atualizadoEm: "2026-10-25T00:00:00.000Z",
  personagens: [
    {
      key: "lider",
      papel: "lider",
      nome: "Heloísa Campelo",
      apelido: "HELÔ",
      cargo: "Líder",
      genero: "feminino",
      pele: "pele-5",
      cabelo: { estilo: "cacheado", cor: "preto" },
      roupa: "jaqueta",
      corRoupa: "jeans",
      corInterna: "nevoa",
      corCalca: "grafite",
      acessorios: ["relogio"],
      matricula: "RH-0001",
      personalidade: "calma, direta, de bom humor",
      falas: ["Bora alinhar rapidinho?", "Boa, time!", "Quem pega essa?", "Café e foco, gente."],
      oQueFaco: "Converso com você, entendo o pedido e divido o trabalho entre o time.",
      responsabilidades: ["entender o que você precisa", "chamar a pessoa certa para cada parte", "entregar o resultado final para você"],
    },
    {
      key: "planejador",
      papel: "planejador",
      nome: "Otto Siqueira",
      apelido: "OTTO",
      cargo: "Planejador",
      genero: "masculino",
      pele: "pele-1",
      cabelo: { estilo: "curto", cor: "castanho-claro" },
      roupa: "sueter",
      corRoupa: "oliva",
      corCalca: "jeans",
      acessorios: ["prancheta", "barba"],
      matricula: "RH-0002",
      personalidade: "organizado, tranquilo, otimista",
      falas: ["Já tá no quadro.", "Passo a passo, pessoal.", "Prazo tá de boa.", "Primeiro o mais simples."],
      oQueFaco: "Transformo um pedido grande em passos pequenos, na ordem certa.",
      responsabilidades: ["dividir o trabalho em etapas", "avisar o que pode dar errado", "dizer quem faz o quê"],
    },
    {
      key: "pesquisador",
      papel: "pesquisador",
      nome: "Luana Tavares",
      apelido: "LUANA",
      cargo: "Pesquisadora",
      genero: "feminino",
      pele: "pele-4",
      cabelo: { estilo: "rabo-de-cavalo", cor: "castanho-escuro" },
      roupa: "moletom",
      corRoupa: "petroleo",
      corCalca: "grafite",
      acessorios: ["oculos"],
      matricula: "RH-0003",
      personalidade: "curiosa, detalhista, falante",
      falas: ["Achei um artigo ótimo!", "Tem doc pra tudo, viu?", "Saiu versão nova!", "Deixa eu conferir."],
      oQueFaco: "Procuro informação fora do projeto para o time decidir com segurança.",
      responsabilidades: ["ler manuais e guias oficiais", "comparar opções antes da escolha", "explicar erros que ninguém conhece"],
    },
    {
      key: "dev",
      papel: "dev",
      nome: "Kauã Moreira",
      apelido: "KAUÃ",
      cargo: "Desenvolvedor",
      genero: "masculino",
      pele: "pele-6",
      cabelo: { estilo: "raspado", cor: "preto" },
      roupa: "moletom",
      corRoupa: "grafite",
      corCalca: "jeans",
      acessorios: ["headset"],
      matricula: "RH-0004",
      personalidade: "focado, criativo, brincalhão",
      falas: ["Compilou de primeira!", "Só mais um commit...", "Quem mexeu no CSS?", "Tá rodando aqui!"],
      oQueFaco: "Construo o que foi pedido, escrevendo e ajustando o programa.",
      responsabilidades: ["fazer as mudanças no projeto", "consertar o que estiver quebrado", "deixar tudo rodando direitinho"],
    },
    {
      key: "testador",
      papel: "testador",
      nome: "Érica Nakamura",
      apelido: "ÉRICA",
      cargo: "Testadora",
      genero: "feminino",
      pele: "pele-1",
      cabelo: { estilo: "chanel", cor: "preto" },
      roupa: "camiseta",
      corRoupa: "vinho",
      corCalca: "ardosia",
      acessorios: ["relogio"],
      matricula: "RH-0005",
      personalidade: "cuidadosa, paciente, cética",
      falas: ["Rodei 3 vezes, passou.", "E se clicar duas vezes?", "Achei um caso de borda.", "Confia, mas testa."],
      oQueFaco: "Confiro se o que foi feito funciona antes de entregar.",
      responsabilidades: ["testar cada mudança", "achar erros antes de você", "avisar o dev quando algo quebra"],
    },
    {
      key: "revisor",
      papel: "revisor",
      nome: "Benedito Araújo",
      apelido: "BENÊ",
      cargo: "Revisor",
      genero: "masculino",
      pele: "pele-3",
      cabelo: { estilo: "franja-lateral", cor: "grisalho" },
      roupa: "camisa-aberta",
      corRoupa: "aco",
      corInterna: "noite",
      corCalca: "oliva",
      acessorios: ["oculos"],
      matricula: "RH-0006",
      personalidade: "criterioso, sincero, gentil",
      falas: ["Ficou bem legível.", "Só um detalhezinho...", "Esse nome tá ótimo.", "Aprovado, pode ir."],
      oQueFaco: "Leio tudo com calma antes de ficar pronto e aponto o que dá para melhorar.",
      responsabilidades: ["achar falhas e riscos escondidos", "ver se está claro e organizado", "dar o sinal verde para entregar"],
    },
    {
      key: "documentador",
      papel: "documentador",
      nome: "Thaís Gouveia",
      apelido: "THAÍS",
      cargo: "Documentadora",
      genero: "feminino",
      pele: "pele-2",
      cabelo: { estilo: "comprido", cor: "ruivo" },
      roupa: "sueter",
      corRoupa: "creme",
      corCalca: "jeans",
      acessorios: ["lapis"],
      matricula: "RH-0007",
      personalidade: "didática, calma, caprichosa",
      falas: ["Já tá no README!", "Um exemplo ajuda, né?", "Escrevi bem simples.", "Faltou só um print."],
      oQueFaco: "Escrevo as explicações para qualquer pessoa entender e usar.",
      responsabilidades: ["atualizar o guia do projeto", "anotar o que mudou e por quê", "dar exemplos simples de uso"],
    },
    {
      key: "dev-2",
      papel: "dev",
      variacaoDe: "dev",
      nome: "Vinícius Rocha",
      apelido: "VINI",
      cargo: "Desenvolvedor",
      genero: "masculino",
      pele: "pele-4",
      cabelo: { estilo: "cacheado", cor: "castanho" },
      roupa: "camiseta",
      corRoupa: "ocre",
      corCalca: "grafite",
      acessorios: ["gorro"],
      matricula: "RH-0008",
      personalidade: "animado, rápido, prático",
      falas: ["Pareando com o Kauã!", "Testa aí no seu PC?", "Subi a correção já.", "Bora que dá tempo!"],
      oQueFaco: "Ajudo a construir quando tem muita coisa para fazer ao mesmo tempo.",
      responsabilidades: ["pegar uma parte do trabalho", "trabalhar junto sem atrapalhar", "consertar o que estiver quebrado"],
    },
    {
      key: "pesquisador-2",
      papel: "pesquisador",
      variacaoDe: "pesquisador",
      nome: "Aline Bezerra",
      apelido: "ALINE",
      cargo: "Pesquisadora",
      genero: "feminino",
      pele: "pele-5",
      cabelo: { estilo: "trancas", cor: "preto" },
      roupa: "jaqueta",
      corRoupa: "ardosia",
      corInterna: "aco",
      corCalca: "creme",
      acessorios: ["caneca"],
      matricula: "RH-0009",
      personalidade: "tranquila, observadora, nerd",
      falas: ["Achei a fonte original!", "Anotei 3 referências.", "Vale ler o changelog.", "Hmm, interessante..."],
      oQueFaco: "Pesquiso junto quando aparecem muitas perguntas de uma vez.",
      responsabilidades: ["achar a fonte original", "anotar referências confiáveis", "resumir o que encontrei"],
    },
    {
      key: "explore",
      papel: "convidado",
      agentTypes: ["explore"],
      nome: "Diego Amaral",
      apelido: "DIEGO",
      cargo: "Explorador",
      genero: "masculino",
      pele: "pele-1",
      cabelo: { estilo: "curto", cor: "loiro" },
      roupa: "camiseta",
      corRoupa: "jeans",
      corCalca: "grafite",
      destaque: "cracha-visitante",
      acessorios: ["bone"],
      matricula: "RH-0010",
      personalidade: "aventureiro, rápido, sorridente",
      falas: ["Já vasculhei tudo!", "Achei na pasta src/", "Mapa do projeto pronto.", "Partiu explorar!"],
      oQueFaco: "Vasculho as pastas do projeto e conto onde fica cada coisa.",
      responsabilidades: ["achar arquivos rapidinho", "montar um mapa do projeto", "dizer onde algo está guardado"],
    },
    {
      key: "general-purpose",
      papel: "convidado",
      agentTypes: ["general-purpose"],
      nome: "Cida Monteiro",
      apelido: "CIDA",
      cargo: "Generalista",
      genero: "feminino",
      pele: "pele-6",
      cabelo: { estilo: "coque", cor: "grisalho" },
      roupa: "camisa-aberta",
      corRoupa: "vinho",
      corInterna: "creme",
      corCalca: "ardosia",
      destaque: "cracha-visitante",
      acessorios: ["cachecol"],
      matricula: "RH-0011",
      personalidade: "prestativa, versátil, tranquila",
      falas: ["Precisa de mão aí?", "Faço o que precisar!", "Deixa comigo.", "Já já fica pronto."],
      oQueFaco: "Pego tarefas variadas que não são de ninguém em especial.",
      responsabilidades: ["resolver um pouco de tudo", "fazer tarefas com vários passos", "dar uma mão a quem precisar"],
    },
    {
      key: "curinga",
      papel: "convidado",
      agentTypes: ["plan", "*"],
      nome: "Ícaro Lins",
      apelido: "ÍCARO",
      cargo: "Consultor",
      genero: "masculino",
      pele: "pele-3",
      cabelo: { estilo: "comprido", cor: "preto" },
      roupa: "sueter",
      corRoupa: "petroleo",
      corCalca: "jeans",
      destaque: "cracha-visitante",
      acessorios: ["oculos"],
      matricula: "RH-0012",
      personalidade: "gentil, estratégico, curioso",
      falas: ["Posso dar uma ideia?", "Visitando o time hoje!", "Que estúdio massa!", "Gostei desse plano."],
      oQueFaco: "Venho quando o time precisa de uma ajuda diferente ou de um plano extra.",
      responsabilidades: ["planejar quando pedirem", "cobrir funções que o time não tem", "dar uma segunda opinião"],
    },
  ],
};

// ------------------------------------------------------------------ validação

export type RosterResult = { ok: true; roster: Roster } | { ok: false; erros: string[] };

/** limites de tamanho do elenco (o vestiário usa os mesmos nos contadores) */
export const LIMITS = {
  personagens: 40,
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
  oQueFaco: 100,
  responsabilidade: 40,
  responsabilidadesMin: 2,
  responsabilidadesMax: 3,
} as const;

const KEY = /^[a-z0-9][a-z0-9-]*$/;
const MATRICULA = /^RH-\d{4}$/;
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

/** id de cor de uma das listas (pele, cabelo ou roupa) */
function corDa(erros: string[], where: string, x: unknown, lista: readonly Swatch[]): x is string {
  if (typeof x !== "string" || !lista.some((s) => s.id === x)) {
    erros.push(`${where}: cor desconhecida (use ${lista.map((s) => s.id).join(", ")})`);
    return false;
  }
  return true;
}

/** Erros de um Personagem sozinho (sem as regras que comparam com os outros, como key repetida). */
export function personagemErrors(x: unknown, i = 0): string[] {
  const erros: string[] = [];
  const at = `personagens[${i}]`;
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
  corDa(erros, `${who}.pele`, x.pele, SKIN_TONES);

  if (!isObj(x.cabelo)) {
    erros.push(`${who}.cabelo: precisa ter estilo e cor`);
  } else {
    if (!oneOf(ESTILOS_CABELO, x.cabelo.estilo)) erros.push(`${who}.cabelo.estilo: estilo desconhecido`);
    corDa(erros, `${who}.cabelo.cor`, x.cabelo.cor, HAIR_COLORS);
  }

  const papel = typeof x.papel === "string" ? x.papel : "";
  if (!oneOf(ROUPAS, x.roupa)) {
    erros.push(`${who}.roupa: use ${ROUPAS.join(", ")}`);
  } else if (x.corInterna !== undefined) {
    if (!ROUPAS_ABERTAS.includes(x.roupa)) erros.push(`${who}.corInterna: só vale para ${ROUPAS_ABERTAS.join(" e ")}`);
    else corDa(erros, `${who}.corInterna`, x.corInterna, CORES_ROUPA);
  }
  corDa(erros, `${who}.corRoupa`, x.corRoupa, CORES_ROUPA);
  corDa(erros, `${who}.corCalca`, x.corCalca, CORES_ROUPA);
  const permitidos = DESTAQUES_PERMITIDOS(papel);
  if (x.destaque !== undefined && !oneOf(permitidos, x.destaque)) erros.push(`${who}.destaque: "${String(x.destaque)}" é só de convidado`);
  if (papel === "convidado" && x.destaque !== "cracha-visitante") erros.push(`${who}.destaque: convidado usa "cracha-visitante"`);

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

  if (typeof x.matricula !== "string" || !MATRICULA.test(x.matricula)) erros.push(`${who}.matricula: use o formato RH-0000`);

  if (!Array.isArray(x.falas) || x.falas.length < LIMITS.falasMin || x.falas.length > LIMITS.falasMax) {
    erros.push(`${who}.falas: precisa ter de ${LIMITS.falasMin} a ${LIMITS.falasMax} falas`);
  } else {
    x.falas.forEach((f, j) => {
      if (text(erros, `${who}.falas[${j}]`, f, LIMITS.fala) && EMOJI.test(f)) erros.push(`${who}.falas[${j}]: sem emoji`);
    });
  }
  erros.push(...oQueFacoErrors(x, who));
  return erros;
}

/** Erros só da parte "O que eu faço" do crachá (frase e responsabilidades). */
export function oQueFacoErrors(x: Record<string, unknown>, who = "personagem"): string[] {
  const erros: string[] = [];
  if (text(erros, `${who}.oQueFaco`, x.oQueFaco, LIMITS.oQueFaco) && EMOJI.test(x.oQueFaco)) erros.push(`${who}.oQueFaco: sem emoji`);
  const r = x.responsabilidades;
  if (!Array.isArray(r) || r.length < LIMITS.responsabilidadesMin || r.length > LIMITS.responsabilidadesMax) {
    erros.push(`${who}.responsabilidades: precisa ter de ${LIMITS.responsabilidadesMin} a ${LIMITS.responsabilidadesMax} itens`);
  } else {
    r.forEach((item, j) => {
      const at = `${who}.responsabilidades[${j}]`;
      if (text(erros, at, item, LIMITS.responsabilidade) && EMOJI.test(item)) erros.push(`${at}: sem emoji`);
    });
  }
  return erros;
}

/** texto "O que eu faço" de quem não tem padrão próprio (Personagem extra de um elenco salvo) */
const O_QUE_FACO_GENERICO = {
  oQueFaco: "Ajudo o time no que for preciso.",
  responsabilidades: ["pegar tarefas avulsas", "dar uma mão a quem precisar"],
};

/** "O que eu faço" padrão de um papel: o do Personagem principal do papel no elenco padrão */
export function oQueFacoPadrao(papel: string): Pick<Personagem, "oQueFaco" | "responsabilidades"> {
  const def = papel === "convidado" ? undefined : DEFAULT_ROSTER.personagens.find((a) => a.papel === papel && !a.variacaoDe);
  const fonte = def ?? O_QUE_FACO_GENERICO;
  return { oQueFaco: fonte.oQueFaco, responsabilidades: [...fonte.responsabilidades] };
}

/**
 * Cópia só com os campos conhecidos de Personagem (o resto é descartado). Não valida:
 * os valores vêm como estão. Campos opcionais ausentes não aparecem.
 */
export function cleanPersonagem(x: Record<string, unknown>): Personagem {
  const out: Record<string, unknown> = {};
  for (const k of PERSONAGEM_FIELDS) if (x[k] !== undefined) out[k] = x[k];
  if (isObj(x.cabelo)) out.cabelo = { estilo: x.cabelo.estilo, cor: x.cabelo.cor };
  if (Array.isArray(x.agentTypes)) out.agentTypes = [...x.agentTypes];
  if (Array.isArray(x.acessorios)) out.acessorios = [...x.acessorios];
  if (Array.isArray(x.falas)) out.falas = [...x.falas];
  if (Array.isArray(x.responsabilidades)) out.responsabilidades = [...x.responsabilidades];
  return out as unknown as Personagem;
}

/** todos os campos de Personagem, na ordem em que aparecem no JSON salvo */
const PERSONAGEM_FIELDS = [
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
  "corRoupa",
  "corInterna",
  "corCalca",
  "destaque",
  "acessorios",
  "matricula",
  "personalidade",
  "falas",
  "oQueFaco",
  "responsabilidades",
] as const satisfies readonly (keyof Personagem)[];

/**
 * Confere tudo o que pode quebrar a tela ou fugir das regras do elenco. Não altera a entrada:
 * em caso de sucesso devolve um elenco novo, limpo, só com os campos conhecidos.
 */
export function validateRoster(x: unknown): RosterResult {
  const erros: string[] = [];
  if (!isObj(x)) return { ok: false, erros: ["o elenco precisa ser um objeto"] };
  if (x.versao !== 1) erros.push("versao: precisa ser 1");
  if (!isDate(x.atualizadoEm)) erros.push("atualizadoEm: data inválida");
  if (!Array.isArray(x.personagens) || x.personagens.length === 0 || x.personagens.length > LIMITS.personagens) {
    erros.push(`personagens: precisa ser uma lista com 1 a ${LIMITS.personagens} Personagens`);
    return { ok: false, erros };
  }

  x.personagens.forEach((a, i) => erros.push(...personagemErrors(a, i)));

  const list = x.personagens.filter(isObj);
  const keys = list.map((a) => a.key);
  const dup = <T>(arr: T[]) => [...new Set(arr.filter((v, i) => arr.indexOf(v) !== i))];
  for (const k of dup(keys)) erros.push(`key repetida: ${String(k)}`);
  for (const m of dup(list.map((a) => a.matricula))) erros.push(`matrícula repetida: ${String(m)}`);
  for (const a of list) {
    if (a.variacaoDe !== undefined && !keys.includes(a.variacaoDe)) erros.push(`${String(a.key)}.variacaoDe: não existe Personagem "${String(a.variacaoDe)}"`);
    if (a.variacaoDe !== undefined && a.variacaoDe === a.key) erros.push(`${String(a.key)}.variacaoDe: não pode apontar para ele mesmo`);
  }

  if (erros.length) return { ok: false, erros };
  return { ok: true, roster: { versao: 1, atualizadoEm: x.atualizadoEm as string, personagens: list.map(cleanPersonagem) } };
}

const isDate = (x: unknown): x is string => typeof x === "string" && !Number.isNaN(Date.parse(x));

/**
 * Completa um elenco salvo (talvez antigo ou parcial) com os padrões: cada Personagem do
 * padrão ganha os campos que faltarem; Personagens extras do salvo entram no fim.
 * Só os campos conhecidos passam. Não valida: passe o resultado no validateRoster.
 */
export function mergeWithDefaults(parcial: unknown): Roster {
  const base = structuredClone(DEFAULT_ROSTER);
  if (!isObj(parcial) || !Array.isArray(parcial.personagens)) return base;

  const saved = new Map<string, Personagem>();
  for (const a of parcial.personagens) if (isObj(a) && typeof a.key === "string") saved.set(a.key, cleanPersonagem(a));

  const personagens = base.personagens.map((def) => {
    const s = saved.get(def.key);
    if (!s) return def;
    saved.delete(def.key);
    const raw: unknown = s.cabelo;
    const cabelo = isObj(raw) ? { ...def.cabelo, ...stripUndefined(raw) } : (raw ?? def.cabelo);
    // destaque é opcional de verdade: no Personagem salvo, não ter destaque significa "sem destaque"
    // corInterna também: só existe com camisa aberta ou jaqueta, então o salvo manda
    const { destaque: _padrao, corInterna: _interna, ...semDestaque } = def;
    return { ...semDestaque, ...s, cabelo } as Personagem;
  });
  // extras (sem padrão próprio) de um elenco antigo, sem o "O que eu faço": o do papel
  for (const extra of saved.values()) {
    const pad = oQueFacoPadrao(typeof extra.papel === "string" ? extra.papel : "");
    personagens.push({ ...extra, oQueFaco: extra.oQueFaco ?? pad.oQueFaco, responsabilidades: extra.responsabilidades ?? pad.responsabilidades });
  }
  // convidado salvo sem destaque (elenco antigo ou editado à mão): ganha o crachá de visitante
  for (const a of personagens) if (a.papel === "convidado" && a.destaque === undefined) a.destaque = "cracha-visitante";

  return {
    versao: 1,
    atualizadoEm: isDate(parcial.atualizadoEm) ? parcial.atualizadoEm : base.atualizadoEm,
    personagens,
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Parte de `atual` e copia de `de` só os CAMPOS_EDITAVEIS (o que faltar em `de` some, como o
 * destaque). O cargo acompanha o gênero. Não valida: os valores vêm como estão.
 */
export function aplicarEditaveis(atual: Personagem, de: Record<string, unknown> | Personagem): Personagem {
  const out = structuredClone(atual) as unknown as Record<string, unknown>;
  const fonte = de as Record<string, unknown>;
  for (const campo of CAMPOS_EDITAVEIS) {
    const v = fonte[campo];
    if (v === undefined) delete out[campo];
    else out[campo] = structuredClone(v);
  }
  const pers = out as unknown as Personagem;
  if (oneOf(GENEROS, pers.genero)) pers.cargo = cargoDe(pers.papel, pers.genero, pers.cargo);
  return pers;
}

/** Personagem principal de um papel (sem variação), ex.: a plaquinha da mesa do dev */
export function personagemDoPapel(roster: Roster, papel: string): Personagem | undefined {
  return roster.personagens.find((a) => a.papel === papel && !a.variacaoDe);
}
