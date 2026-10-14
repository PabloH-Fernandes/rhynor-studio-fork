// Tipos compartilhados entre o servidor e o frontend.

import type { Roster } from "./roster.ts";

// só os tipos; valores (DEFAULT_ROSTER, validateRoster...) vêm direto de shared/roster
export type { Acessorio, AGzinho, Destaque, EstiloCabelo, Genero, Roster, RosterResult, Roupa, Swatch } from "./roster.ts";

export type AgentStatus =
  | "chegando" // andando da porta até a mesa
  | "trabalhando" // usando alguma ferramenta
  | "pensando" // recebeu pedido / entre ferramentas
  | "esperando" // precisa de você (permissão, pergunta)
  | "ocioso" // de boa: terminou a vez dele e fica no escritório até a sessão acabar
  | "saindo"; // a sessão acabou e ele vai embora

export interface Agent {
  /** líder: s:<session_id> (após um /clear, o da conversa anterior); subagente: ag:<key do AGzinho> (ou ag:extra:<agent_id> sem AGzinho livre) */
  id: string;
  sessionId: string;
  /** id do agente que delegou o trabalho (líder), se for subagente */
  parentId?: string;
  /** chave do papel: lider, planejador, dev, testador, revisor, documentador, pesquisador, convidado ou outro tipo */
  role: string;
  /** nome do AGzinho ("Beatriz Lima"); o visitante extra, sem AGzinho, usa o nome do tipo */
  name: string;
  /** key do AGzinho no elenco (lider, dev, dev-2, explore...); ausente no visitante extra */
  agzinho?: string;
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
 * Assunto da linha do feed (server/frases.ts). Linhas seguidas do mesmo AGzinho e do mesmo assunto
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
  /** nome curto da versão simples ("Guto", "Marina") */
  quem?: string;
  categoria?: FeedCategoria;
  /** o que contar quando linhas iguais se juntam ("arquivos" → "(12 arquivos)"); sem ele não junta */
  contaComo?: string;
}

/**
 * Andamento do trabalho para o quadro de etapas ("AGzinhos na Etapa 4 de 7").
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
  /** ok = pasta 20-Missoes lida; sem-vault = AGPOCKET_VAULT não configurado; sem-pasta = vault sem 20-Missoes */
  vault: "ok" | "sem-vault" | "sem-pasta";
  missoes: Missao[];
  /** só a contagem de atas novas na raiz de 00-Inbox: nada do conteúdo nem dos nomes */
  inbox: { novas: number };
  /** a missão em que o time está agora, se der pra saber */
  atual: { id: string; nome: string; reuniaoTitulo: string } | null;
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
