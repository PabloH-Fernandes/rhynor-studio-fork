// Tipos compartilhados entre o servidor e o frontend.

import type { Roster } from "./roster.ts";
import type { Urgencia } from "./prazos.ts";
import type { GastoHoje } from "./gasto.ts";
import type { Resultados } from "./resultados.ts";
import type { ResumoTransparencia } from "./transparencia.ts";

// só os tipos; valores (DEFAULT_ROSTER, validateRoster...) vêm direto de shared/roster
export type { Acessorio, Personagem, Destaque, EstiloCabelo, Genero, Roster, RosterResult, Roupa, Swatch } from "./roster.ts";

export type AgentStatus =
  | "chegando" // andando da porta até a mesa
  | "trabalhando" // usando alguma ferramenta
  | "pensando" // recebeu pedido / entre ferramentas
  | "esperando" // precisa de você (permissão, pergunta)
  | "ocioso" // de boa: terminou a vez dele e fica no escritório até a sessão acabar
  | "saindo"; // a sessão acabou e ele vai embora

export interface Agent {
  /** líder: s:<session_id> (após um /clear, o da conversa anterior); subagente: p:<key do Personagem> (ou p:extra:<agent_id> sem Personagem livre) */
  id: string;
  sessionId: string;
  /** id do agente que delegou o trabalho (líder), se for subagente */
  parentId?: string;
  /** chave do papel: lider, planejador, dev, testador, revisor, documentador, pesquisador, convidado ou outro tipo */
  role: string;
  /** nome do Personagem ("Kauã Moreira"); o visitante extra, sem Personagem, usa o nome do tipo */
  name: string;
  /** key do Personagem no elenco (lider, dev, dev-2, explore...); ausente no visitante extra */
  personagem?: string;
  status: AgentStatus;
  /** o que está fazendo agora, em português ("Editando App.tsx") */
  activity: string;
  /** a mesma atividade sem jargão ("Fazendo mudanças no sistema"); estado salvo antigo não tem */
  activitySimples?: string;
  /** pasta do projeto onde a sessão está rodando */
  project: string;
  startedAt: number;
  updatedAt: number;
  /** quando foi chamado pela última vez (criação ou SubagentStart de novo) */
  boundAt: number;
  /**
   * visitante além dos 3 que cabem na tela: continua no estado mas não é desenhado no mapa, e o
   * painel só conta ("+N visitantes"). Entra quando um dos 3 sai (ordem de chegada).
   */
  excedente?: boolean;
  /** entregas no dia `tasksDay` (zera na virada do dia) */
  tasksDone: number;
  /** dia das entregas, AAAA-MM-DD no fuso do servidor */
  tasksDay: string;
}

export interface OfficeConfig {
  /** sessão sem nenhum evento por esse tempo é encerrada (4x se houver ferramenta em andamento) */
  sessionTimeoutMs: number;
}

/**
 * Assunto da linha do feed (server/frases.ts). Linhas seguidas do mesmo Personagem e do mesmo assunto
 * se juntam no front; "precisa", "etapa", "concluido" e "terminou" ganham destaque.
 */
export type FeedCategoria =
  | "estudo"
  | "busca"
  | "mudanca"
  | "teste"
  | "comando"
  | "internet"
  | "tarefas"
  | "recado"
  | "ferramenta"
  | "chegada"
  | "pedido"
  | "precisa"
  | "erro"
  | "info"
  | "terminou"
  | "etapa"
  | "concluido"
  | "saiu";

export interface FeedItem {
  id: number;
  at: number;
  agentId: string;
  agentName: string;
  role: string;
  /** versão técnica, a de sempre ("Editando state.ts", "Rodando: npm test") */
  text: string;
  kind: "info" | "tool" | "spawn" | "done" | "alert" | "message";
  /** versão simples, sem jargão e sem o nome ("está fazendo mudanças no sistema"); feed salvo antigo não tem */
  simples?: string;
  /** nome curto da versão simples ("Helô", "Otto") */
  quem?: string;
  categoria?: FeedCategoria;
  /** o que contar quando linhas iguais se juntam ("arquivos" → "(12 arquivos)"); sem ele não junta */
  contaComo?: string;
}

/**
 * Andamento do trabalho para o quadro de etapas ("Time na Etapa 4 de 7").
 * - tarefas: veio da lista de tarefas do líder (TodoWrite ou TaskCreate/TaskUpdate);
 *   concluidas === total > 0 é a lista inteira feita ("concluíram N de N");
 * - papel: sem lista, a fase pelo papel ativo (titulo = "Construção", "Testes"...; sem número);
 * - nada: ninguém trabalhando ("de boa").
 */
export interface Progress {
  fonte: "tarefas" | "papel" | "nada";
  /** etapa atual (1-based); 0 fora de "tarefas" */
  etapa: number;
  total: number;
  concluidas: number;
  /** tarefas: o que está sendo feito (activeForm ou o assunto); papel: a fase */
  titulo: string;
  /** sessão de onde veio */
  sessionId?: string;
}

export type MissaoStatus = "a fazer" | "em andamento" | "concluída";

/** Uma nota de <vault>/20-Missoes/. Nunca leva o nome da nota de reunião (10-Reunioes é confidencial). */
export interface Missao {
  /** nome do arquivo sem .md */
  id: string;
  nome: string;
  status: MissaoStatus;
  origem: "reuniao" | "manual";
  projeto: string;
  /** título neutro da reunião de origem (vazio se não tiver) */
  reuniaoTitulo: string;
  classe: "time" | "humano" | "duvida";
  /** AAAA-MM-DD (vazio se a nota não tiver) */
  data: string;
  tarefas: { feitas: number; total: number };
  /** tarefas da seção "## Tarefas" (até 20, cada texto com até 140 caracteres) */
  itens: { texto: string; feita: boolean }[];
  /** até 300 caracteres, sem links */
  objetivo: string;
  /** mtime do arquivo (ms) */
  atualizadoEm: number;
}

export interface MissoesInfo {
  /** ok = pasta 20-Missoes lida; sem-vault = STUDIO_VAULT não configurado; sem-pasta = vault sem 20-Missoes */
  vault: "ok" | "sem-vault" | "sem-pasta";
  missoes: Missao[];
  /** só a contagem de atas novas na raiz de 00-Inbox: nada do conteúdo nem dos nomes */
  inbox: {
    novas: number;
    /** atas que a leitura sem IA não entendeu e que ficaram no Inbox esperando o /reuniao; ausente se a leitura automática está desligada */
    foraDoFormato?: number;
  };
  /** a missão em que o time está agora, se der pra saber */
  atual: { id: string; nome: string; reuniaoTitulo: string } | null;
  /** quantas missões há antes do corte por grupo (a lista vem limitada); ausente em servidor antigo */
  totais?: { abertas: number; concluidas: number };
}

/** Uma tarefa de uma reunião esperando a sua decisão na Caixa de entrada. */
export interface CaixaTarefa {
  /** posição da linha entre as tarefas da nota (1, 2, 3...): é o número que volta em POST /api/caixa/aprovar */
  n: number;
  texto: string;
  /** "Responsável A" (nome já trocado); vazio se não tiver */
  responsavel: string;
  /** AAAA-MM-DD ou vazio */
  prazo: string;
  /** hash curto do texto da tarefa na nota: volta no POST para o servidor conferir que a nota não mudou */
  h?: string;
}

/** Uma reunião lida sem IA (`status: rascunho`) que ainda precisa de aprovação. Só título, data e tarefas. */
export interface CaixaItem {
  /** nome da nota em 10-Reunioes, sem .md (só letras, números e hífen) */
  id: string;
  titulo: string;
  /** AAAA-MM-DD ou vazio */
  data: string;
  /** só as tarefas em aberto; vazio = reunião sem tarefas */
  tarefas: CaixaTarefa[];
  /** havia mais tarefas em aberto do que o painel mostra (as demais ficam na nota, intocadas) */
  truncada?: boolean;
}

export type CaixaAcao = "time" | "eu" | "ignorar";

/** Corpo de POST /api/caixa/aprovar */
export interface CaixaAprovacao {
  reuniao: string;
  decisoes: { n: number; acao: CaixaAcao; h?: string }[];
}

/** Resposta de POST /api/caixa/aprovar quando deu certo */
export interface CaixaResposta {
  ok: true;
  /** `/time Missão [[nota]]: ...`; null quando ninguém ficou com "Time faz" (nenhuma missão criada) */
  comando: string | null;
  /** nome da nota da missão criada, sem .md; null se não criou */
  missao: string | null;
}

/** De quem é a pendência: sua (🙋) ou do time (🤖) */
export type PendenciaDono = "eu" | "time";

/** Uma tarefa em aberto de uma reunião (classe eu) ou de uma missão, para o painel de Pendências. */
export interface Pendencia {
  /** `r:nota:n:hash` (reunião) ou `m:nota:n:hash` (missão): é o que volta em POST /api/pendencias/concluir */
  id: string;
  /** hash curto da linha inteira da tarefa na nota: volta no POST para o servidor conferir que a nota não mudou */
  h: string;
  /** texto da tarefa, sem os campos depois do `|` */
  texto: string;
  /** vazio se não tiver */
  responsavel: string;
  /** AAAA-MM-DD ou vazio */
  prazo: string;
  /** título da reunião ou da missão de onde a tarefa vem */
  origem: string;
  dono: PendenciaDono;
  status: "a fazer" | "em andamento";
  /** calculada pelo servidor com o dia local dele; o painel recalcula com o dia do navegador */
  urgencia: Urgencia;
}

/** Corpo de POST /api/pendencias/concluir */
export interface PendenciaConclusao {
  id: string;
  h: string;
}

/** Resposta de POST /api/pendencias/concluir quando deu certo */
export interface PendenciaConclusaoResposta {
  ok: true;
  concluidaEm: string;
  /** era a última tarefa da missão: o servidor marcou a missão como concluída */
  missaoConcluida?: boolean;
}

/** Uma reunião (/reuniao) acontecendo: a mesa de reunião do escritório. Passageira: não é salva. */
export interface ReuniaoAtiva {
  sessionId: string;
  /** id visual do líder da sessão */
  liderId: string;
  desde: number;
}

export type ServerMessage =
  | {
      type: "snapshot";
      agents: Agent[];
      feed: FeedItem[];
      roster: Roster;
      config: OfficeConfig;
      progress: Progress;
      /** opcional: estado salvo e testes antigos não têm */
      reuniao?: ReuniaoAtiva | null;
    }
  /** as missões do vault mudaram (ou a contagem de atas novas) */
  | { type: "missoes"; info: MissoesInfo }
  /** a leitura automática (sem IA) acabou de ler uma ata nova: texto fixo e hora, sem título nem conteúdo (o título fica só na nota do vault) */
  | { type: "ata-nova"; texto: string; hora: string }
  /** a Caixa de entrada mudou (reunião nova para aprovar, ou uma foi aprovada) */
  | { type: "caixa"; itens: CaixaItem[] }
  /** as pendências (tarefas em aberto de reuniões e missões) mudaram */
  | { type: "pendencias"; itens: Pendencia[] }
  /** os números de Resultados foram recalculados (as notas do vault mudaram) */
  | { type: "resultados"; resultados: Resultados }
  /** a Transparência (o que os agentes abriram no vault) ganhou linhas: resumo do mês, sem conteúdo */
  | { type: "transparencia"; resumo: ResumoTransparencia }
  /** tokens lidos do registro do Claude hoje (só números; null = sem dado). Não é custo */
  | { type: "gasto"; hoje: GastoHoje | null }
  /** uma reunião (/reuniao) começou ou acabou */
  | { type: "reuniao"; reuniao: ReuniaoAtiva | null }
  | { type: "agent"; agent: Agent }
  | { type: "remove"; id: string }
  | { type: "feed"; item: FeedItem }
  /** um agente mandou mensagem pra outro (agent teams / SendMessage) */
  | { type: "chat"; fromId: string; toId: string; text: string }
  /** o elenco mudou (PUT /api/roster) */
  | { type: "roster"; roster: Roster }
  /** o quadro de etapas mudou */
  | { type: "progress"; progress: Progress };

/** Um resultado da busca no vault (GET /api/busca). Nunca traz caminho absoluto nem corpo de nota confidencial. */
export interface BuscaItem {
  /** nome do arquivo sem .md */
  titulo: string;
  /** caminho dentro do vault, com "/" */
  rel: string;
  /** ~160 caracteres em volta do primeiro acerto; ausente em nota confidencial */
  trecho?: string;
  confidencial: boolean;
  /** obsidian://open?vault=...&file=... */
  uri: string;
}

export interface BuscaResposta {
  ok: true;
  itens: BuscaItem[];
  /** quantas notas casaram; com `maisResultados` é só o limite (20), nunca a contagem exata */
  total: number;
  /** true quando casaram mais notas que o limite: refine a busca */
  maisResultados?: boolean;
  /** true quando o índice ainda está sendo montado (itens vazios; tente de novo em instantes) */
  montando?: boolean;
  /** true quando não há vault configurado */
  semVault?: boolean;
}
