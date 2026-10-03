// Tipos compartilhados entre o servidor e o frontend.

import type { Roster } from "./roster.ts";

// só os tipos; valores (DEFAULT_ROSTER, validateRoster...) vêm direto de shared/roster
export type { Acessorio, AGzinho, Destaque, EstiloCabelo, Genero, Roster, RosterResult, Roupa, Swatch } from "./roster.ts";

export type AgentStatus =
  | "chegando" // andando da porta até a mesa
  | "trabalhando" // usando alguma ferramenta
  | "pensando" // recebeu pedido / entre ferramentas
  | "esperando" // precisa de você (permissão, pergunta)
  | "ocioso" // terminou a vez dele, esperando novo pedido
  | "saindo"; // terminou o trabalho e vai embora

export interface Agent {
  id: string;
  sessionId: string;
  /** id do agente que delegou o trabalho (líder), se for subagente */
  parentId?: string;
  /** chave do papel: lider, planejador, dev, testador, revisor, documentador, pesquisador ou qualquer outro tipo */
  role: string;
  /** nome que aparece no crachá */
  name: string;
  status: AgentStatus;
  /** o que está fazendo agora, em português ("Editando App.tsx") */
  activity: string;
  /** pasta do projeto onde a sessão está rodando */
  project: string;
  startedAt: number;
  updatedAt: number;
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
  | { type: "snapshot"; agents: Agent[]; feed: FeedItem[]; roster: Roster }
  | { type: "agent"; agent: Agent }
  | { type: "remove"; id: string }
  | { type: "feed"; item: FeedItem }
  /** um agente mandou mensagem pra outro (agent teams / SendMessage) */
  | { type: "chat"; fromId: string; toId: string; text: string }
  /** o elenco mudou (PUT /api/roster) */
  | { type: "roster"; roster: Roster };
