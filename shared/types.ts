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
  /** líder: s:<session_id>; subagente: ag:<key do AGzinho> (ou ag:extra:<agent_id> sem AGzinho livre) */
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
  /** pasta do projeto onde a sessão está rodando */
  project: string;
  startedAt: number;
  updatedAt: number;
  /** quando foi chamado pela última vez (criação ou SubagentStart de novo) */
  boundAt: number;
  /** entregas no dia `tasksDay` (zera na virada do dia) */
  tasksDone: number;
  /** dia das entregas, AAAA-MM-DD no fuso do servidor */
  tasksDay: string;
}

export interface OfficeConfig {
  /** sessão sem nenhum evento por esse tempo é encerrada (4x se houver ferramenta em andamento) */
  sessionTimeoutMs: number;
}

export interface FeedItem {
  id: number;
  at: number;
  agentId: string;
  agentName: string;
  role: string;
  text: string;
  kind: "info" | "tool" | "spawn" | "done" | "alert" | "message";
}

export type ServerMessage =
  | { type: "snapshot"; agents: Agent[]; feed: FeedItem[]; roster: Roster; config: OfficeConfig }
  | { type: "agent"; agent: Agent }
  | { type: "remove"; id: string }
  | { type: "feed"; item: FeedItem }
  /** um agente mandou mensagem pra outro (agent teams / SendMessage) */
  | { type: "chat"; fromId: string; toId: string; text: string }
  /** o elenco mudou (PUT /api/roster) */
  | { type: "roster"; roster: Roster };
