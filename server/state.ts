// Estado do escritório: transforma os eventos crus dos hooks do Claude Code
// em "agentes" com status e atividade, e avisa quem estiver ouvindo.

import path from "node:path";
import type { Agent, AgentStatus, FeedItem, ServerMessage } from "../shared/types.ts";
import { DEFAULT_ROSTER, type Roster } from "../shared/roster.ts";

/** Formato (parcial) do JSON que o Claude Code manda no stdin de cada hook. */
export interface HookInput {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  agent_id?: string;
  agent_type?: string;
  tool_name?: string;
  tool_input?: Record<string, any>;
  tool_use_id?: string;
  user_prompt?: string;
  prompt?: string;
  message?: string;
  notification_type?: string;
  source?: string;
  [key: string]: unknown;
}

/** Nomes bonitos para os papéis conhecidos. Qualquer outro tipo vira "convidado". */
export const ROLE_NAMES: Record<string, string> = {
  lider: "Claude (líder)",
  planejador: "Planejador",
  dev: "Dev",
  testador: "Testador",
  revisor: "Revisor",
  documentador: "Documentador",
  pesquisador: "Pesquisador",
};

const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);
const LEAVE_DELAY_MS = 7000; // tempo pra animação de saída antes de remover
const FALLBACK_SPAWN_MS = 1500; // se o SubagentStart não chegar, cria pelo tool_use_id
const FEED_LIMIT = 200;

type Listener = (msg: ServerMessage) => void;

interface PendingSpawn {
  sessionId: string;
  type: string;
  description: string;
  timer: NodeJS.Timeout;
}

export class OfficeState {
  private agents = new Map<string, Agent>();
  private feed: FeedItem[] = [];
  private feedSeq = 0;
  private listeners = new Set<Listener>();
  private pending = new Map<string, PendingSpawn>(); // tool_use_id -> spawn ainda sem SubagentStart
  private removalTimers = new Map<string, NodeJS.Timeout>();
  private roster: Roster = structuredClone(DEFAULT_ROSTER);

  constructor() {
    // limpeza de agentes "fantasma" (ex.: terminal fechado à força)
    setInterval(() => this.sweep(), 60_000).unref();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): ServerMessage {
    return { type: "snapshot", agents: [...this.agents.values()], feed: this.feed.slice(-60), roster: this.roster };
  }

  getRoster(): Roster {
    return this.roster;
  }

  /**
   * Troca o elenco e avisa as telas. Por enquanto só guarda e reemite os agentes vivos;
   * o mapeamento agente → AGzinho entra na etapa 2.
   */
  setRoster(roster: Roster) {
    this.roster = roster;
    this.emit({ type: "roster", roster });
    for (const agent of this.agents.values()) this.emit({ type: "agent", agent });
  }

  /** Apaga tudo (usado pelo botão de reset da tela). */
  reset() {
    for (const t of this.removalTimers.values()) clearTimeout(t);
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.removalTimers.clear();
    this.pending.clear();
    for (const id of [...this.agents.keys()]) this.remove(id);
    this.feed = [];
    this.emit(this.snapshot());
  }

  // ---------------------------------------------------------------- entrada

  handleHook(input: HookInput) {
    if (!input || typeof input.hook_event_name !== "string" || !input.session_id) return;
    const ev = input.hook_event_name;

    switch (ev) {
      case "SessionStart": {
        const lead = this.ensureLeader(input);
        this.update(lead, "ocioso", input.source === "resume" ? "Voltou ao trabalho" : "Chegou no escritório");
        this.pushFeed(lead, `entrou no projeto ${lead.project}`, "info");
        break;
      }

      case "UserPromptSubmit": {
        const lead = this.ensureLeader(input);
        const prompt = String(input.user_prompt ?? input.prompt ?? "").trim();
        this.update(lead, "pensando", "Lendo seu pedido...");
        this.pushFeed(lead, prompt ? `recebeu: “${truncate(prompt, 90)}”` : "recebeu um pedido", "message");
        break;
      }

      case "PreToolUse": {
        const tool = input.tool_name ?? "?";
        const agent = this.agentFor(input);
        const toolInput = input.tool_input ?? {};

        if (SUBAGENT_TOOLS.has(tool) && !input.agent_id) {
          const type = String(toolInput.subagent_type ?? toolInput.name ?? "general-purpose");
          const desc = String(toolInput.description ?? "");
          this.update(agent, "pensando", `Coordenando: chamou ${prettyRole(type)}`);
          this.expectSpawn(input, type, desc);
          break;
        }

        if (tool === "SendMessage") {
          this.handleSendMessage(agent, toolInput);
        }

        if (tool === "AskUserQuestion") {
          this.update(agent, "esperando", "Tem uma pergunta pra você");
          this.pushFeed(agent, "está esperando sua resposta", "alert");
          break;
        }

        this.update(agent, "trabalhando", describeTool(tool, toolInput));
        this.pushFeed(agent, describeTool(tool, toolInput), "tool");
        break;
      }

      case "PostToolUse":
      case "PostToolUseFailure": {
        const tool = input.tool_name ?? "?";
        if (SUBAGENT_TOOLS.has(tool) && !input.agent_id && input.tool_use_id) {
          this.finishFallback(input.tool_use_id);
        }
        const agent = this.agentFor(input);
        if (agent.status === "trabalhando" || agent.status === "esperando") {
          this.update(agent, "pensando", ev === "PostToolUseFailure" ? `Deu erro em ${tool}, ajustando...` : agent.activity);
        }
        if (ev === "PostToolUseFailure") this.pushFeed(agent, `${tool} falhou`, "alert");
        break;
      }

      case "PermissionRequest": {
        const agent = this.agentFor(input);
        const what = describeTool(input.tool_name ?? "?", input.tool_input ?? {});
        this.update(agent, "esperando", `Pedindo permissão: ${what}`);
        this.pushFeed(agent, `pediu permissão → ${what}`, "alert");
        break;
      }

      case "Notification": {
        const lead = this.ensureLeader(input);
        const msg = String(input.message ?? "");
        const type = String(input.notification_type ?? "");
        const isIdle = type === "idle_prompt" || /waiting for your input/i.test(msg);
        if (isIdle) {
          this.update(lead, "ocioso", "Esperando seu próximo pedido");
        } else {
          this.update(lead, "esperando", "Precisa de você!");
          this.pushFeed(lead, msg ? `avisou: ${truncate(msg, 80)}` : "precisa de você", "alert");
        }
        break;
      }

      case "SubagentStart": {
        const id = input.agent_id;
        if (!id) break;
        const type = String(input.agent_type ?? "general-purpose");
        const pend = this.takePending(input.session_id, type);
        const agent = this.createSubagent(input.session_id, id, type, pend?.description ?? "", input.cwd);
        this.pushFeed(agent, pend?.description ? `entrou para: ${truncate(pend.description, 70)}` : "entrou no escritório", "spawn");
        break;
      }

      case "SubagentStop": {
        const id = input.agent_id;
        if (!id) break;
        const agent = this.agents.get(id);
        if (agent) this.leave(agent, "Entregou o trabalho");
        break;
      }

      case "TeammateIdle": {
        const agent = this.agentFor(input);
        this.update(agent, "ocioso", "Livre, esperando tarefa");
        break;
      }

      case "Stop": {
        const lead = this.ensureLeader(input);
        this.update(lead, "ocioso", "Terminou, esperando você");
        this.pushFeed(lead, "terminou a vez dele", "done");
        break;
      }

      case "SessionEnd": {
        for (const a of [...this.agents.values()]) {
          if (a.sessionId === input.session_id) this.leave(a, "Foi embora");
        }
        break;
      }

      default:
        // outros eventos não mudam o escritório
        break;
    }
  }

  // ---------------------------------------------------------------- agentes

  private leaderId(sessionId: string) {
    return `s:${sessionId}`;
  }

  private ensureLeader(input: HookInput): Agent {
    const id = this.leaderId(input.session_id);
    let lead = this.agents.get(id);
    if (!lead) {
      // sessão iniciada com --agent ou teammate de um agent team: usa o tipo como papel
      const role = !input.agent_id && input.agent_type ? normalizeRole(input.agent_type) : "lider";
      lead = {
        id,
        sessionId: input.session_id,
        role,
        name: role === "lider" ? ROLE_NAMES.lider : prettyRole(input.agent_type!),
        status: "chegando",
        activity: "Chegando...",
        project: projectName(input.cwd),
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.agents.set(id, lead);
      this.emit({ type: "agent", agent: lead });
    }
    return lead;
  }

  /** O agente "dono" do evento: o subagente (se veio de dentro de um) ou o líder. */
  private agentFor(input: HookInput): Agent {
    if (input.agent_id) {
      const sub = this.agents.get(input.agent_id);
      if (sub) return sub;
      return this.createSubagent(input.session_id, input.agent_id, String(input.agent_type ?? "general-purpose"), "", input.cwd);
    }
    return this.ensureLeader(input);
  }

  private createSubagent(sessionId: string, id: string, type: string, description: string, cwd?: string): Agent {
    const existing = this.agents.get(id);
    if (existing) return existing;
    const lead = this.ensureLeader({ hook_event_name: "", session_id: sessionId, cwd });
    const agent: Agent = {
      id,
      sessionId,
      parentId: lead.id,
      role: normalizeRole(type),
      name: prettyRole(type),
      status: "chegando",
      activity: description ? truncate(description, 60) : "Indo pra mesa...",
      project: lead.project,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.agents.set(id, agent);
    this.emit({ type: "agent", agent });
    return agent;
  }

  /** O líder chamou a ferramenta Agent/Task. Espera o SubagentStart; se não vier, cria mesmo assim. */
  private expectSpawn(input: HookInput, type: string, description: string) {
    const toolUseId = input.tool_use_id ?? `anon-${Date.now()}`;
    const askedAt = Date.now();
    // o SubagentStart pode ter chegado antes deste evento: nesse caso só completa a descrição
    const early = this.recentSubagent(input.session_id, type, askedAt);
    if (early) {
      if (description) this.update(early, early.status, truncate(description, 60));
      return;
    }
    const timer = setTimeout(() => {
      const p = this.pending.get(toolUseId);
      if (!p) return;
      this.pending.delete(toolUseId);
      if (this.recentSubagent(p.sessionId, p.type, askedAt)) return;
      const agent = this.createSubagent(p.sessionId, `t:${toolUseId}`, p.type, p.description, input.cwd);
      this.pushFeed(agent, p.description ? `entrou para: ${truncate(p.description, 70)}` : "entrou no escritório", "spawn");
    }, FALLBACK_SPAWN_MS);
    this.pending.set(toolUseId, { sessionId: input.session_id, type, description, timer });
  }

  private recentSubagent(sessionId: string, type: string, since: number): Agent | undefined {
    const role = normalizeRole(type);
    return [...this.agents.values()].find(
      (a) =>
        a.parentId &&
        a.sessionId === sessionId &&
        a.role === role &&
        !a.id.startsWith("t:") &&
        a.status !== "saindo" &&
        a.startedAt >= since - 3000,
    );
  }

  private takePending(sessionId: string, type: string): PendingSpawn | undefined {
    for (const [key, p] of this.pending) {
      if (p.sessionId === sessionId && (p.type === type || normalizeRole(p.type) === normalizeRole(type))) {
        clearTimeout(p.timer);
        this.pending.delete(key);
        return p;
      }
    }
    return undefined;
  }

  private finishFallback(toolUseId: string) {
    const p = this.pending.get(toolUseId);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(toolUseId);
    }
    const agent = this.agents.get(`t:${toolUseId}`);
    if (agent) this.leave(agent, "Entregou o trabalho");
  }

  private handleSendMessage(from: Agent, toolInput: Record<string, any>) {
    const toName = String(toolInput.to ?? toolInput.recipient ?? toolInput.name ?? "").toLowerCase();
    const text = String(toolInput.message ?? toolInput.content ?? toolInput.text ?? "");
    // no agent teams cada colega é uma sessão separada, então procura na mesma sessão e depois em todas
    const matches = (a: Agent) => a.id !== from.id && (a.role === normalizeRole(toName) || a.name.toLowerCase() === toName);
    const all = [...this.agents.values()];
    const to = all.find((a) => matches(a) && a.sessionId === from.sessionId) ?? all.find(matches);
    if (to) this.emit({ type: "chat", fromId: from.id, toId: to.id, text: truncate(text, 80) });
    this.pushFeed(from, `→ ${to?.name ?? (toName || "time")}: ${truncate(text, 80)}`, "message");
  }

  private update(agent: Agent, status: AgentStatus, activity: string) {
    // quem está chegando continua "chegando" no front até sentar; o front decide a animação
    agent.status = agent.status === "saindo" ? "saindo" : status;
    agent.activity = activity;
    agent.updatedAt = Date.now();
    this.emit({ type: "agent", agent });
  }

  private leave(agent: Agent, activity: string) {
    if (agent.status === "saindo") return;
    agent.status = "saindo";
    agent.activity = activity;
    agent.updatedAt = Date.now();
    this.emit({ type: "agent", agent });
    this.pushFeed(agent, activity.toLowerCase(), "done");
    const t = setTimeout(() => this.remove(agent.id), LEAVE_DELAY_MS);
    this.removalTimers.set(agent.id, t);
  }

  private remove(id: string) {
    const t = this.removalTimers.get(id);
    if (t) clearTimeout(t);
    this.removalTimers.delete(id);
    if (this.agents.delete(id)) this.emit({ type: "remove", id });
  }

  private sweep() {
    const now = Date.now();
    for (const a of this.agents.values()) {
      const idle = now - a.updatedAt;
      if (a.parentId && idle > 10 * 60_000) this.leave(a, "Sumiu (sem sinal)");
      else if (!a.parentId && idle > 3 * 60 * 60_000) this.leave(a, "Sessão parada");
    }
  }

  // ---------------------------------------------------------------- feed

  private pushFeed(agent: Agent, text: string, kind: FeedItem["kind"]) {
    const item: FeedItem = {
      id: ++this.feedSeq,
      at: Date.now(),
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      text,
      kind,
    };
    this.feed.push(item);
    if (this.feed.length > FEED_LIMIT) this.feed.splice(0, this.feed.length - FEED_LIMIT);
    this.emit({ type: "feed", item });
  }

  private emit(msg: ServerMessage) {
    for (const fn of this.listeners) fn(msg);
  }
}

// ------------------------------------------------------------------ helpers

export function normalizeRole(type: string): string {
  const t = type.toLowerCase().split(":").pop()!.trim();
  return t in ROLE_NAMES ? t : t || "convidado";
}

export function prettyRole(type: string): string {
  const role = normalizeRole(type);
  if (ROLE_NAMES[role]) return ROLE_NAMES[role];
  return role
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function projectName(cwd?: string) {
  return cwd ? path.basename(cwd) || cwd : "projeto";
}

function truncate(s: string, n: number) {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

function file(p: unknown) {
  return p ? path.basename(String(p)) : "arquivo";
}

/** Traduz a chamada de ferramenta numa frase curta pro balão do personagem. */
export function describeTool(tool: string, input: Record<string, any>): string {
  switch (tool) {
    case "Read":
      return `Lendo ${file(input.file_path)}`;
    case "Write":
      return `Criando ${file(input.file_path)}`;
    case "Edit":
    case "MultiEdit":
      return `Editando ${file(input.file_path)}`;
    case "NotebookEdit":
      return `Editando ${file(input.notebook_path)}`;
    case "Bash":
      return input.description ? truncate(String(input.description), 48) : `Rodando: ${truncate(String(input.command ?? ""), 40)}`;
    case "Grep":
      return `Procurando “${truncate(String(input.pattern ?? ""), 30)}”`;
    case "Glob":
      return `Procurando arquivos ${truncate(String(input.pattern ?? ""), 30)}`;
    case "WebSearch":
      return `Pesquisando: ${truncate(String(input.query ?? ""), 40)}`;
    case "WebFetch":
      try {
        return `Lendo ${new URL(String(input.url)).hostname}`;
      } catch {
        return "Lendo uma página";
      }
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
      return "Organizando as tarefas";
    case "SendMessage":
      return "Mandando mensagem pro time";
    case "Skill":
      return `Usando a skill ${truncate(String(input.skill ?? input.name ?? ""), 30)}`;
    default:
      if (tool.startsWith("mcp__")) {
        const [, server, name] = tool.split("__");
        return `Usando ${server}: ${name ?? ""}`.trim();
      }
      return `Usando ${tool}`;
  }
}
