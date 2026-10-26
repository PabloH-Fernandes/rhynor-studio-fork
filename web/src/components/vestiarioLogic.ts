// Regras do vestiário sem React nem canvas: opções permitidas, como aplicar uma edição no
// elenco, o que conta como "alteração não salva" e como ler os erros da validação.
// Testes em vestiarioLogic.test.ts (npm test).

import {
  ACESSORIOS,
  CAMADAS,
  CAMADA_DO_ACESSORIO,
  aplicarEditaveis,
  DESTAQUES_PERMITIDOS,
  LIMITS,
  ROUPAS_PERMITIDAS,
  cargoDe,
  cleanPersonagem,
  validateRoster,
  type Camada,
  type RosterResult,
} from "../../../shared/roster";
import type { Acessorio, Personagem, Destaque, EstiloCabelo, Genero, Roster, Roupa } from "../../../shared/types";

export { CAMADAS, type Camada };

export const NOME_CAMADA: Record<Camada, string> = {
  cabeca: "Cabeça",
  pelos: "Barba",
  rosto: "Rosto",
  tronco: "Tronco",
  mao: "Mão",
  pulso: "Pulso",
};

export const NOME_ACESSORIO: Record<Acessorio, string> = {
  headset: "Headset",
  "capacete-branco": "Capacete branco",
  "capacete-amarelo": "Capacete amarelo",
  oculos: "Óculos",
  colete: "Colete refletivo",
  prancheta: "Prancheta",
  caneca: "Caneca",
  lapis: "Lápis na orelha",
  relogio: "Relógio",
  barba: "Barba",
};

export const NOME_ESTILO: Record<EstiloCabelo, string> = {
  curto: "Curto",
  comprido: "Comprido",
  raspado: "Raspado",
  coque: "Coque",
  "rabo-de-cavalo": "Rabo de cavalo",
  cacheado: "Cacheado",
  "franja-lateral": "Franja lateral",
  chanel: "Chanel",
  trancas: "Tranças",
};

export const NOME_ROUPA: Record<Roupa, string> = {
  polo: "Polo marinho",
  camisa: "Camisa branca",
  blazer: "Blazer",
  terno: "Terno",
};

export const NOME_DESTAQUE: Record<Destaque, string> = {
  "gravata-dourada": "Gravata dourada",
  "blazer-cinza": "Blazer cinza",
  "cracha-visitante": "Crachá de visitante",
};


export const LIMITE_NOME = LIMITS.nome;
export const LIMITE_APELIDO = LIMITS.apelido;
export const LIMITE_O_QUE_FACO = LIMITS.oQueFaco;
export const LIMITE_RESPONSABILIDADE = LIMITS.responsabilidade;
/** quantas caixas de responsabilidade o vestiário mostra (a última é opcional) */
export const MAX_RESPONSABILIDADES = LIMITS.responsabilidadesMax;
export const MIN_RESPONSABILIDADES = LIMITS.responsabilidadesMin;

/** conta caracteres como a validação (acento conta 1) */
export const contarCaracteres = (s: string) => [...s.normalize("NFC")].length;

// ------------------------------------------------------------------ roupa e destaque

/** Roupa fixa do papel explicada em uma linha ("Terno: exclusivo do líder"), ou null se dá pra escolher. */
export function regraRoupa(papel: string): string | null {
  const roupas = ROUPAS_PERMITIDAS(papel);
  if (roupas.length !== 1) return null;
  const r = roupas[0];
  if (papel === "lider") return `${NOME_ROUPA[r]}: exclusivo do líder`;
  if (r === "blazer") return `${NOME_ROUPA[r]}: uniforme do planejamento e da revisão`;
  return `${NOME_ROUPA[r]}: única roupa deste papel`;
}

export interface OpcaoDestaque {
  /** undefined = sem destaque */
  valor: Destaque | undefined;
  nome: string;
}

/**
 * Escolhas de destaque pro papel e a roupa. Lista vazia: não há o que escolher; uma só: fixo
 * (o crachá de visitante do convidado). O "sem destaque" ganha o nome do que fica no lugar.
 */
export function opcoesDestaque(papel: string, roupa: Roupa): OpcaoDestaque[] {
  const permitidos = DESTAQUES_PERMITIDOS(papel, roupa);
  if (papel === "convidado") return permitidos.map((d) => ({ valor: d, nome: NOME_DESTAQUE[d] }));
  if (permitidos.length === 0) return [];
  const semNome = roupa === "terno" ? "Gravata marinho" : roupa === "blazer" ? "Blazer marinho" : "Sem destaque";
  return [{ valor: undefined, nome: semNome }, ...permitidos.map((d) => ({ valor: d, nome: NOME_DESTAQUE[d] }))];
}

/** troca a roupa e acerta o destaque (o que não combina sai; convidado continua com o crachá de visitante) */
export function trocarRoupa(ag: Personagem, roupa: Roupa): Personagem {
  const out: Personagem = { ...ag, roupa };
  const permitidos = DESTAQUES_PERMITIDOS(ag.papel, roupa);
  if (ag.papel === "convidado") out.destaque = "cracha-visitante";
  else if (out.destaque !== undefined && !permitidos.includes(out.destaque)) delete out.destaque;
  return out;
}

/** troca o gênero e o cargo junto ("Desenvolvedora" ↔ "Desenvolvedor") */
export function trocarGenero(ag: Personagem, genero: Genero): Personagem {
  return { ...ag, genero, cargo: cargoDe(ag.papel, genero, ag.cargo) };
}

export function trocarDestaque(ag: Personagem, destaque: Destaque | undefined): Personagem {
  const out: Personagem = { ...ag };
  if (destaque === undefined) delete out.destaque;
  else out.destaque = destaque;
  return out;
}

// ------------------------------------------------------------------ acessórios (um por camada)

export function acessoriosPorCamada(): Record<Camada, Acessorio[]> {
  const out = Object.fromEntries(CAMADAS.map((c) => [c, [] as Acessorio[]])) as Record<Camada, Acessorio[]>;
  for (const a of ACESSORIOS) out[CAMADA_DO_ACESSORIO[a]].push(a);
  return out;
}

/** o acessório escolhido numa camada (o primeiro, se um elenco antigo tiver mais de um) */
export function acessorioDaCamada(lista: readonly Acessorio[], camada: Camada): Acessorio | null {
  return lista.find((a) => CAMADA_DO_ACESSORIO[a] === camada) ?? null;
}

/** troca o que está numa camada (null = nenhum); o resultado sai na ordem de ACESSORIOS */
export function trocarAcessorio(lista: readonly Acessorio[], camada: Camada, novo: Acessorio | null): Acessorio[] {
  const resto = lista.filter((a) => CAMADA_DO_ACESSORIO[a] !== camada);
  if (novo) resto.push(novo);
  return ordenarAcessorios(resto);
}

const ordenarAcessorios = (lista: readonly Acessorio[]) => [...lista].sort((a, b) => ACESSORIOS.indexOf(a) - ACESSORIOS.indexOf(b));

// ------------------------------------------------------------------ "O que eu faço" do crachá

/**
 * Troca o item `i` das responsabilidades (as caixas vazias do meio ficam como "" pra não pular
 * de lugar enquanto digita; as do fim somem).
 */
export function trocarResponsabilidade(lista: readonly string[], i: number, valor: string): string[] {
  const out = [...lista];
  while (out.length <= i) out.push("");
  out[i] = valor;
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

/** responsabilidades como vão pro servidor: sem espaço nas pontas e sem caixa vazia */
export const limparResponsabilidades = (lista: readonly string[]) => lista.map((r) => r.trim()).filter(Boolean);

// ------------------------------------------------------------------ elenco, rascunhos e "sujo"

/** forma canônica de um Personagem pra comparar (campos na ordem do JSON salvo, acessórios ordenados) */
function canonico(ag: Personagem): string {
  const c = cleanPersonagem(ag as unknown as Record<string, unknown>);
  // caixa de responsabilidade vazia não conta como alteração (some ao salvar)
  return JSON.stringify({ ...c, acessorios: ordenarAcessorios(c.acessorios ?? []), responsabilidades: limparResponsabilidades(c.responsabilidades ?? []) });
}

export function mesmoPersonagem(a: Personagem | undefined, b: Personagem | undefined): boolean {
  if (!a || !b) return a === b;
  return canonico(a) === canonico(b);
}

/**
 * O elenco que chegou é mais novo que o que o modal conhece? Evita voltar ao antigo quando a
 * resposta do PUT chega antes do WS (ou o WS manda um elenco atrasado).
 */
export function elencoMaisNovo(base: Roster, remoto: Roster): boolean {
  return Date.parse(remoto.atualizadoEm) > Date.parse(base.atualizadoEm);
}

/** mesmo elenco, ignorando a data de atualização */
export function mesmoElenco(a: Roster, b: Roster): boolean {
  return a.personagens.length === b.personagens.length && a.personagens.every((ag, i) => mesmoPersonagem(ag, b.personagens[i]));
}

export const personagemDe = (r: Roster, key: string) => r.personagens.find((a) => a.key === key);

/** rascunho de cada Personagem em edição, por key */
export type Rascunhos = Readonly<Record<string, Personagem>>;

/** keys com alteração não salva (rascunho diferente do salvo), na ordem do elenco */
export function chavesSujas(base: Roster, rascunhos: Rascunhos): string[] {
  return base.personagens.filter((a) => rascunhos[a.key] && !mesmoPersonagem(rascunhos[a.key], a)).map((a) => a.key);
}

/**
 * o elenco salvo com os rascunhos aplicados (textos sem espaço nas pontas, apelido em caixa alta,
 * responsabilidades sem caixa vazia)
 */
export function aplicarRascunhos(base: Roster, rascunhos: Rascunhos): Roster {
  return {
    ...base,
    personagens: base.personagens.map((a) => {
      const r = rascunhos[a.key];
      if (!r) return a;
      return {
        ...r,
        nome: r.nome.trim(),
        apelido: r.apelido.trim().toLocaleUpperCase("pt-BR"),
        oQueFaco: r.oQueFaco.trim(),
        responsabilidades: limparResponsabilidades(r.responsabilidades),
      };
    }),
  };
}

/** o que vai no PUT: elenco inteiro com as edições, conferido com a mesma validação do servidor */
export function prepararEnvio(base: Roster, rascunhos: Rascunhos, agora = new Date()): RosterResult {
  return validateRoster({ ...aplicarRascunhos(base, rascunhos), atualizadoEm: agora.toISOString() });
}

/** copia do outro Personagem só o que o vestiário edita, com o cargo no gênero certo (pra "Voltar ao padrão") */
export const copiarVisual = (atual: Personagem, de: Personagem): Personagem => aplicarEditaveis(atual, de);

/**
 * Chegou um elenco novo pelo WS: as keys em que o outro navegador mudou algo que você também
 * está editando (rascunho sujo). Vazio = dá pra adotar o elenco novo sem perguntar.
 */
export function conflitos(base: Roster, remoto: Roster, rascunhos: Rascunhos): string[] {
  const sujas = chavesSujas(base, rascunhos);
  return sujas.filter((k) => !mesmoPersonagem(personagemDe(base, k), personagemDe(remoto, k)));
}

// ------------------------------------------------------------------ erros da validação

/** caminho do campo no erro: "apelido", "cabelo.cor", "acessorios"... */
export type CaminhoCampo = string;

const ROTULO_CAMPO: Record<string, string> = {
  nome: "Nome",
  apelido: "Apelido",
  genero: "Gênero",
  pele: "Tom de pele",
  "cabelo.estilo": "Estilo do cabelo",
  "cabelo.cor": "Cor do cabelo",
  cabelo: "Cabelo",
  roupa: "Roupa",
  destaque: "Destaque",
  acessorios: "Acessórios",
  cordao: "Cordão",
  matricula: "Matrícula",
  cargo: "Cargo",
  oQueFaco: "O que eu faço",
  responsabilidades: "Sou responsável por",
};

/** erro de validação (do front ou do 400) ou falha do servidor/rede: o título do alerta muda */
export type TipoErro = "validacao" | "servidor";

export interface ErroLido {
  /** key do Personagem, se o erro for de um só */
  key?: string;
  /** caminho do campo sem índice ("acessorios", não "acessorios[2]") */
  campo?: CaminhoCampo;
  /** só a explicação, depois dos dois-pontos */
  texto: string;
  original: string;
}

const ERRO_PERSONAGEM = /^personagens\[\d+\](?: \(([^)]+)\))?\.([a-zA-Z]+(?:\.[a-zA-Z]+)?)(?:\[\d+\])?: (.*)$/;

/** "personagens[3] (dev).apelido: precisa ter..." → { key: "dev", campo: "apelido", texto: "precisa ter..." } */
export function lerErro(erro: string): ErroLido {
  const m = ERRO_PERSONAGEM.exec(erro);
  if (!m) return { texto: erro, original: erro };
  return { key: m[1], campo: m[2], texto: m[3], original: erro };
}

/** erros de um Personagem agrupados por campo (pra mostrar embaixo de cada campo do formulário) */
export function errosPorCampo(erros: readonly string[], key: string): Record<CaminhoCampo, string[]> {
  const out: Record<CaminhoCampo, string[]> = {};
  for (const e of erros.map(lerErro)) {
    if (e.key !== key || !e.campo) continue;
    (out[e.campo] ??= []).push(e.texto);
  }
  return out;
}

/** frase pra lista de erros: "BIA · Apelido: precisa ter de 1 a 6 caracteres" */
export function mensagemDeErro(erro: string, elenco: Roster): string {
  const e = lerErro(erro);
  if (!e.campo) return e.texto;
  const ag = e.key ? personagemDe(elenco, e.key) : undefined;
  const quem = ag ? (ag.apelido.trim() || ag.nome.trim() || ag.key) : e.key;
  const campo = ROTULO_CAMPO[e.campo] ?? e.campo;
  return `${quem ? `${quem} · ` : ""}${campo}: ${e.texto}`;
}
