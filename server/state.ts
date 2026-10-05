// Estado do escritório: transforma os eventos crus dos hooks do Claude Code
// em "agentes" com status e atividade, e avisa quem estiver ouvindo.
//
// Cada subagente vira um AGzinho do elenco, com id visual estável (ag:<key>): o mesmo
// papel chamado de novo volta a ser a mesma pessoa. Quem termina fica "de boa" no
// escritório; todo mundo de uma sessão só vai embora no SessionEnd ou quando a sessão
// passa tempo demais sem nenhum evento.

import path from "node:path";
import type { Agent, AgentStatus, FeedItem, OfficeConfig, Progress, ServerMessage } from "../shared/types.ts";
import { DEFAULT_ROSTER, agzinhoDoPapel, type AGzinho, type Roster } from "../shared/roster.ts";
import { PROGRESS_NADA, ProgressTracker, sameProgress } from "./progress.ts";

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
  /** só no PostToolUse: a saída da ferramenta (ex.: TaskCreate → { task: { id, subject } }) */
  tool_response?: unknown;
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
/**
 * Subagente sem nenhum evento próprio depois de entrar: passa de "chegando" pra "pensando"
 * (a caminhada da porta até a mesa mais longe, na ala de descanso, leva ~11 s)
 */
const ARRIVE_MS = 12_000;
const FALLBACK_SPAWN_MS = 1500; // se o SubagentStart não chegar, cria pelo tool_use_id
const RETIRE_MS = 2 * 60_000; // eventos atrasados de quem já entregou são ignorados por esse tempo
const SWEEP_EVERY_MS = 60_000;
/** sessão com ferramenta em andamento (Pre sem Post) espera esse múltiplo do timeout */
const BUSY_TIMEOUT_FACTOR = 4;
export const DEFAULT_SESSION_TIMEOUT_MIN = 30;
const FEED_LIMIT = 200;

/** Notification que pede algo a você e acende o laranja; as outras no máximo vão pro feed */
const NEEDS_YOU = new Set(["permission_prompt", "elicitation_dialog", "elicitation_url_dialog", "agent_needs_input"]);

type Listener = (msg: ServerMessage) => void;

interface PendingSpawn {
  sessionId: string;
  type: string;
  description: string;
  timer: NodeJS.Timeout;
}

/** como o id visual foi ligado da última vez: o tipo pedido e a chave do alias (agent_id ou t:<tool_use_id>) */
interface Binding {
  type: string;
  alias: string;
}

export interface OfficeStateOptions {
  /** sessão sem evento por esse tempo é encerrada (padrão 30 min) */
  sessionTimeoutMs?: number;
  /** relógio (injetável nos testes) */
  now?: () => number;
  /** intervalo da varredura de sessões; 0 desliga (os testes chamam sweep() na mão) */
  sweepEveryMs?: number;
}

export class OfficeState {
  private agents = new Map<string, Agent>();
  private feed: FeedItem[] = [];
  private feedSeq = 0;
  private listeners = new Set<Listener>();
  private pending = new Map<string, PendingSpawn>(); // tool_use_id -> spawn ainda sem SubagentStart
  private removalTimers = new Map<string, NodeJS.Timeout>();
  private arrivalTimers = new Map<string, NodeJS.Timeout>();
  private roster: Roster = structuredClone(DEFAULT_ROSTER);
  /** agent_id ou "t:"+tool_use_id → id visual (ag:dev, ag:dev-2...) */
  private aliases = new Map<string, string>();
  /** id visual → última ligação (pra achar quem acabou de chegar pelo SubagentStart) */
  private bindings = new Map<string, Binding>();
  /** agent_id (ou t:...) que já entregou → até quando os eventos dele são ignorados */
  private retired = new Map<string, number>();
  /** session_id → último evento recebido */
  private lastSeen = new Map<string, number>();
  /** listas de tarefas por sessão (quadro de etapas) e o último valor mandado às telas */
  private tasks = new ProgressTracker();
  private progress: Progress = PROGRESS_NADA;
  private progressTimer: NodeJS.Timeout | null = null;
  private readonly now: () => number;
  readonly config: OfficeConfig;

  constructor(opts: OfficeStateOptions = {}) {
    this.now = opts.now ?? Date.now;
    const timeout = opts.sessionTimeoutMs;
    this.config = {
      sessionTimeoutMs: timeout !== undefined && Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_SESSION_TIMEOUT_MIN * 60_000,
    };
    const every = opts.sweepEveryMs ?? SWEEP_EVERY_MS;
    // encerra sessões sem sinal (ex.: terminal fechado à força, sem SessionEnd)
    if (every > 0) setInterval(() => this.sweep(), every).unref();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): ServerMessage {
    return {
      type: "snapshot",
      agents: [...this.agents.values()],
      feed: this.feed.slice(-60),
      roster: this.roster,
      config: this.config,
      progress: this.progress,
    };
  }

  getProgress(): Progress {
    return this.progress;
  }

  getRoster(): Roster {
    return this.roster;
  }

  /** Troca o elenco, atualiza o nome de quem está no escritório e avisa as telas. */
  setRoster(roster: Roster) {
    this.roster = roster;
    this.emit({ type: "roster", roster });
    for (const agent of this.agents.values()) {
      const ag = agent.agzinho ? this.findAgzinho(agent.agzinho) : undefined;
      if (ag) agent.name = ag.nome;
      this.emit({ type: "agent", agent });
    }
  }

  /** Apaga tudo (usado pelo botão "Limpar" da tela). */
  reset() {
    for (const t of this.removalTimers.values()) clearTimeout(t);
    for (const t of this.arrivalTimers.values()) clearTimeout(t);
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.removalTimers.clear();
    this.arrivalTimers.clear();
    this.pending.clear();
    this.aliases.clear();
    this.bindings.clear();
    this.retired.clear();
    this.lastSeen.clear();
    this.tasks.reset();
    for (const id of [...this.agents.keys()]) this.remove(id);
    this.feed = [];
    this.refreshProgress();
    this.emit(this.snapshot());
  }

  // ---------------------------------------------------------------- entrada

  handleHook(input: HookInput) {
    if (!input || typeof input.hook_event_name !== "string" || !input.session_id) return;
    const ev = input.hook_event_name;
    // sessão encerrada: eventos atrasados não recriam o líder (só um SessionStart novo a reabre)
    const sessionKey = this.leaderId(input.session_id);
    if (ev === "SessionStart") this.retired.delete(sessionKey);
    else if (this.isRetired(sessionKey)) return;
    if (ev !== "SessionEnd") this.lastSeen.set(input.session_id, this.now());
    // a lista muda antes do agente: o refresh do update() já vê a lista nova
    const listaMudou = this.tasks.handle(input, this.now());

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
        if (!agent) break; // evento atrasado de quem já entregou
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
        if (!agent) break;
        if (agent.status === "trabalhando" || agent.status === "esperando") {
          this.update(agent, "pensando", ev === "PostToolUseFailure" ? `Deu erro em ${tool}, ajustando...` : agent.activity);
        }
        if (ev === "PostToolUseFailure") this.pushFeed(agent, `${tool} falhou`, "alert");
        break;
      }

      case "PermissionRequest": {
        const agent = this.agentFor(input);
        if (!agent) break;
        const what = describeTool(input.tool_name ?? "?", input.tool_input ?? {});
        this.update(agent, "esperando", `Pedindo permissão: ${what}`);
        this.pushFeed(agent, `pediu permissão → ${what}`, "alert");
        break;
      }

      case "Notification": {
        const agent = this.agentFor(input);
        if (!agent) break;
        const msg = String(input.message ?? "");
        const type = String(input.notification_type ?? "");
        const isIdle = type === "idle_prompt" || (!type && /waiting for your input/i.test(msg));
        // versões antigas não mandam notification_type: aí só o texto diz se pede algo
        const needsYou = NEEDS_YOU.has(type) || (!type && !isIdle && /permiss|needs your|precisa de voc/i.test(msg));
        if (isIdle) {
          this.update(agent, "ocioso", "Esperando seu próximo pedido");
        } else if (needsYou) {
          this.update(agent, "esperando", "Precisa de você!");
          this.pushFeed(agent, msg ? `avisou: ${truncate(msg, 80)}` : "precisa de você", "alert");
        } else if (msg) {
          // auth_success, elicitation_complete, agent_completed, quota_*...: só informa
          this.pushFeed(agent, `avisou: ${truncate(msg, 80)}`, "info");
        }
        break;
      }

      case "SubagentStart": {
        const id = input.agent_id;
        if (!id || this.isRetired(id)) break;
        const type = String(input.agent_type ?? "general-purpose");
        const pend = this.takePending(input.session_id, type);
        const known = this.aliases.get(id);
        if (known && this.agents.has(known)) {
          // um evento dele chegou antes do Start e já o colocou na mesa: só completa a descrição
          const agent = this.agents.get(known)!;
          if (pend?.description) this.update(agent, agent.status, truncate(pend.description, 60));
          break;
        }
        // o fallback já criou este subagente pelo tool_use_id: passa a ouvir pelo agent_id
        const early = this.fallbackBound(input.session_id, type);
        if (early) {
          this.rebindAlias(early, id, type);
          break;
        }
        this.bindSubagent(input.session_id, id, type, pend?.description ?? "", input.cwd);
        break;
      }

      case "SubagentStop": {
        const id = input.agent_id;
        if (!id) break;
        const agent = this.agentByAlias(id);
        if (agent) this.finishWork(agent, id);
        break;
      }

      case "TeammateIdle": {
        const agent = this.agentFor(input);
        if (agent) this.update(agent, "ocioso", "Livre, esperando tarefa");
        break;
      }

      case "Stop": {
        const lead = this.ensureLeader(input);
        this.update(lead, "ocioso", "Terminou, esperando você");
        this.pushFeed(lead, "terminou a vez dele", "done");
        break;
      }

      case "SessionEnd": {
        this.endSession(input.session_id, "Foi embora");
        break;
      }

      default:
        // outros eventos não mudam o escritório
        break;
    }
    if (listaMudou) this.refreshProgress();
  }

  /**
   * Encerra a sessão inteira: todo mundo que está nela agora (inclusive AGzinho emprestado
   * de outra sessão) vai até a porta. Com `retire` (SessionEnd explícito), eventos atrasados da
   * sessão e dos subagentes dela são ignorados por um tempo; no timeout não, porque a sessão
   * pode estar viva e só quieta.
   */
  endSession(sessionId: string, activity: string, { retire = true }: { retire?: boolean } = {}) {
    this.lastSeen.delete(sessionId);
    this.tasks.endSession(sessionId);
    if (retire) this.retire(this.leaderId(sessionId));
    for (const [key, p] of this.pending) {
      if (p.sessionId !== sessionId) continue;
      clearTimeout(p.timer);
      this.pending.delete(key);
    }
    for (const a of [...this.agents.values()]) {
      if (a.sessionId !== sessionId) continue;
      if (retire) for (const [alias, visual] of this.aliases) if (visual === a.id) this.retire(alias);
      this.leave(a, activity);
    }
    this.refreshProgress();
  }

  /**
   * Encerra as sessões sem sinal. Roda sozinha a cada minuto (e nos testes, na mão).
   * Sessão com alguém esperando você nunca expira; com ferramenta em andamento, espera 4x.
   */
  sweep() {
    const now = this.now();
    for (const [id, until] of this.retired) if (until <= now) this.retired.delete(id);
    for (const [sessionId, seen] of [...this.lastSeen]) {
      const team = [...this.agents.values()].filter((a) => a.sessionId === sessionId);
      if (team.some((a) => a.status === "esperando")) continue;
      const busy = team.some((a) => a.status === "trabalhando");
      const limit = this.config.sessionTimeoutMs * (busy ? BUSY_TIMEOUT_FACTOR : 1);
      if (now - seen > limit) this.endSession(sessionId, "Saiu (sessão sem sinal)", { retire: false });
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
      const type = !input.agent_id && input.agent_type ? input.agent_type : "lider";
      // a sessão real tem prioridade: se o "lider" está com o líder de uma simulação, ela troca de AGzinho
      if (!isDemo(input.session_id)) this.yieldFromDemoLeader(type);
      // o líder de uma 2ª sessão aberta vira convidado (o AGzinho "lider" já tem dono)
      const ag = this.candidates(type, true).find((a) => this.freeForLeader(a.key));
      const now = this.now();
      lead = {
        id,
        sessionId: input.session_id,
        role: ag ? ag.papel : normalizeRole(type),
        name: ag?.nome ?? (type === "lider" ? ROLE_NAMES.lider : prettyRole(type)),
        agzinho: ag?.key,
        status: "chegando",
        activity: "Chegando...",
        project: projectName(input.cwd),
        startedAt: now,
        updatedAt: now,
        boundAt: now,
        tasksDone: 0,
        tasksDay: dayKey(now),
      };
      this.agents.set(id, lead);
      this.emit({ type: "agent", agent: lead });
    }
    return lead;
  }

  /** O líder de simulação que está com o AGzinho que a sessão real quer passa para o próximo convidado livre. */
  private yieldFromDemoLeader(type: string) {
    const want = this.candidates(type, true)[0];
    if (!want) return;
    const holder = [...this.agents.values()].find(
      (a) => !a.parentId && a.agzinho === want.key && a.status !== "saindo" && isDemo(a.sessionId),
    );
    if (!holder) return;
    const guest = this.roster.agzinhos.find((a) => a.papel === "convidado" && this.freeForLeader(a.key));
    holder.agzinho = guest?.key;
    holder.role = guest ? guest.papel : "convidado";
    holder.name = guest?.nome ?? prettyRole("convidado");
    this.emit({ type: "agent", agent: holder });
  }

  /**
   * O agente "dono" do evento: o subagente (se veio de dentro de um) ou o líder.
   * Devolve undefined para eventos atrasados de quem já entregou: esses não recriam ninguém.
   */
  private agentFor(input: HookInput): Agent | undefined {
    if (input.agent_id) {
      const sub = this.agentByAlias(input.agent_id);
      if (sub) return sub;
      if (this.isRetired(input.agent_id)) return undefined;
      return this.bindSubagent(input.session_id, input.agent_id, String(input.agent_type ?? "general-purpose"), "", input.cwd);
    }
    return this.ensureLeader(input);
  }

  private agentByAlias(alias: string): Agent | undefined {
    const visual = this.aliases.get(alias);
    return visual ? this.agents.get(visual) : undefined;
  }

  private findAgzinho(key: string): AGzinho | undefined {
    return this.roster.agzinhos.find((a) => a.key === key);
  }

  /**
   * AGzinhos que podem atender um tipo, na ordem de preferência:
   * - papel do time (dev, pesquisador...): o principal e as variações dele (dev-2);
   * - outro tipo: o convidado que atende o tipo (sem diferenciar maiúsculas), o curinga "*"
   *   e depois qualquer convidado.
   * O líder cai nos convidados, na ordem do elenco, quando o "lider" já tem dono (2ª sessão).
   */
  private candidates(type: string, leader: boolean): AGzinho[] {
    const list = this.roster.agzinhos;
    const role = normalizeRole(type);
    const guests = list.filter((a) => a.papel === "convidado");
    const serves = (a: AGzinho, t: string) => (a.agentTypes ?? []).some((x) => x.toLowerCase() === t);
    const guestOrder = [...new Set([...guests.filter((a) => serves(a, role)), ...guests.filter((a) => serves(a, "*")), ...guests])];
    // o AGzinho do líder não é dado a subagente
    const main = role !== "convidado" && (leader || role !== "lider") ? agzinhoDoPapel(this.roster, role) : undefined;
    if (!main) return guestOrder;
    const own = [main, ...list.filter((a) => a.variacaoDe === main.key)];
    return leader ? [...own, ...(role === "lider" ? guests : guestOrder)] : own;
  }

  /**
   * Livre para um subagente da sessão: ninguém na tela com ele, ou ele mesmo de boa (ocioso).
   * A simulação não pega emprestado quem está de boa numa sessão real.
   */
  private freeForSubagent(key: string, sessionId: string): boolean {
    for (const a of this.agents.values()) {
      if (a.agzinho !== key) continue;
      if (a.id !== subagentId(key)) return false; // é o AGzinho de um líder
      if (a.status !== "ocioso") return false; // trabalhando, chegando ou saindo
      if (isDemo(sessionId) && !isDemo(a.sessionId)) return false;
    }
    return true;
  }

  /** livre para um líder: ninguém (fora quem já está saindo) com esse AGzinho */
  private freeForLeader(key: string): boolean {
    for (const a of this.agents.values()) if (a.agzinho === key && a.status !== "saindo") return false;
    return true;
  }

  /**
   * Escolhe o AGzinho de um subagente e devolve o agente na tela já ligado a ele: reaproveita
   * quem está de boa (até de outra sessão, que passa para esta) ou cria um novo. Sem ninguém
   * livre, entra um visitante extra (ag:extra:<id do hook>) com aparência por hash.
   */
  private assignAgzinho(
    sessionId: string,
    agentType: string,
    hookId: string,
    description: string,
    cwd?: string,
  ): { agent: Agent; returning: boolean } {
    const lead = this.ensureLeader({ hook_event_name: "", session_id: sessionId, cwd });
    // líder criado por evento de subagente (servidor aberto com a sessão em andamento): ele está
    // coordenando, não chegando; sem isso ficava "chegando" até ter um evento próprio
    if (lead.status === "chegando") this.update(lead, "pensando", "Coordenando o time");
    const ag = this.candidates(agentType, false).find((a) => this.freeForSubagent(a.key, sessionId));
    const id = ag ? subagentId(ag.key) : `ag:extra:${hookId}`;
    const now = this.now();
    const activity = description ? truncate(description, 60) : "Indo pra mesa...";
    const existing = this.agents.get(id);
    if (existing) {
      // chamado de novo: larga o descanso e volta pra mesa
      existing.sessionId = sessionId;
      existing.parentId = lead.id;
      existing.project = lead.project;
      existing.boundAt = now;
      existing.status = "pensando";
      existing.activity = description ? truncate(description, 60) : "Voltando pra mesa...";
      existing.updatedAt = now;
      this.emit({ type: "agent", agent: existing });
      return { agent: existing, returning: true };
    }
    const agent: Agent = {
      id,
      sessionId,
      parentId: lead.id,
      role: ag ? ag.papel : normalizeRole(agentType),
      name: ag?.nome ?? prettyRole(agentType),
      agzinho: ag?.key,
      status: "chegando",
      activity,
      project: lead.project,
      startedAt: now,
      updatedAt: now,
      boundAt: now,
      tasksDone: 0,
      tasksDay: dayKey(now),
    };
    this.agents.set(id, agent);
    this.emit({ type: "agent", agent });
    // sem evento nenhum (ex.: subagente que só pensa), não fica "chegando / Indo pra mesa..." pra sempre
    const arrive = setTimeout(() => {
      this.arrivalTimers.delete(id);
      if (this.agents.get(id) === agent && agent.status === "chegando") {
        this.update(agent, "pensando", description ? agent.activity : "Pensando...");
      }
    }, ARRIVE_MS);
    arrive.unref?.();
    this.arrivalTimers.set(id, arrive);
    return { agent, returning: false };
  }

  /** Liga um agent_id (ou t:<tool_use_id>) a um AGzinho e conta no feed quem chegou. */
  private bindSubagent(sessionId: string, alias: string, type: string, description: string, cwd?: string): Agent {
    const { agent, returning } = this.assignAgzinho(sessionId, type, alias, description, cwd);
    this.rebindAlias(agent, alias, type);
    const what = description ? `: ${truncate(description, 70)}` : "";
    this.pushFeed(agent, returning ? `foi chamado de novo${what}` : description ? `entrou para${what}` : "entrou no escritório", "spawn");
    return agent;
  }

  /** O agente passa a ouvir pelo `alias`; aliases antigos dele saem (já entregaram ou foram trocados). */
  private rebindAlias(agent: Agent, alias: string, type: string) {
    for (const [key, visual] of this.aliases) if (visual === agent.id && key !== alias) this.aliases.delete(key);
    this.aliases.set(alias, agent.id);
    this.bindings.set(agent.id, { type: normalizeRole(type), alias });
  }

  /** Fim do trabalho de um subagente: fica de boa no escritório e conta mais uma entrega. */
  private finishWork(agent: Agent, alias: string) {
    if (agent.status !== "saindo") {
      const today = dayKey(this.now());
      if (agent.tasksDay !== today) {
        agent.tasksDay = today;
        agent.tasksDone = 0;
      }
      agent.tasksDone += 1;
      if (agent.agzinho) {
        this.update(agent, "ocioso", "De boa");
        this.pushFeed(agent, "entregou o trabalho", "done");
      } else {
        // visitante extra (sem AGzinho livre) não fica: senão eles se acumulam no escritório
        this.leave(agent, "Entregou o trabalho");
      }
    }
    this.aliases.delete(alias);
    this.retire(alias);
  }

  private retire(alias: string) {
    this.retired.set(alias, this.now() + RETIRE_MS);
  }

  private isRetired(alias: string): boolean {
    const until = this.retired.get(alias);
    if (until === undefined) return false;
    if (until > this.now()) return true;
    this.retired.delete(alias);
    return false;
  }

  /** O líder chamou a ferramenta Agent/Task. Espera o SubagentStart; se não vier, cria mesmo assim. */
  private expectSpawn(input: HookInput, type: string, description: string) {
    const toolUseId = input.tool_use_id ?? `anon-${this.now()}`;
    const askedAt = this.now();
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
      this.bindSubagent(p.sessionId, `t:${toolUseId}`, p.type, p.description, input.cwd);
    }, FALLBACK_SPAWN_MS);
    this.pending.set(toolUseId, { sessionId: input.session_id, type, description, timer });
  }

  /** subagente desta sessão e tipo que chegou pelo SubagentStart (não pelo fallback) há pouco */
  private recentSubagent(sessionId: string, type: string, since: number): Agent | undefined {
    const t = normalizeRole(type);
    return [...this.agents.values()].find((a) => {
      const b = this.bindings.get(a.id);
      return (
        a.parentId &&
        a.sessionId === sessionId &&
        b?.type === t &&
        !b.alias.startsWith("t:") &&
        this.aliases.get(b.alias) === a.id &&
        a.status !== "saindo" &&
        a.status !== "ocioso" &&
        a.boundAt >= since - 3000
      );
    });
  }

  /** subagente desta sessão e tipo criado pelo fallback (t:<tool_use_id>) e ainda trabalhando */
  private fallbackBound(sessionId: string, type: string): Agent | undefined {
    const t = normalizeRole(type);
    return [...this.agents.values()].find((a) => {
      const b = this.bindings.get(a.id);
      return (
        a.sessionId === sessionId &&
        b?.type === t &&
        b.alias.startsWith("t:") &&
        this.aliases.get(b.alias) === a.id &&
        a.status !== "saindo" &&
        a.status !== "ocioso"
      );
    });
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
    const alias = `t:${toolUseId}`;
    const agent = this.agentByAlias(alias);
    if (agent) this.finishWork(agent, alias);
  }

  private handleSendMessage(from: Agent, toolInput: Record<string, any>) {
    const toName = String(toolInput.to ?? toolInput.recipient ?? toolInput.name ?? "").toLowerCase();
    const text = String(toolInput.message ?? toolInput.content ?? toolInput.text ?? "");
    const role = normalizeRole(toName);
    // no agent teams cada colega é uma sessão separada, então procura na mesma sessão e depois em todas
    const matches = (a: Agent) => {
      if (a.id === from.id || !toName) return false;
      if (role === "lider") return !a.parentId;
      const ag = a.agzinho ? this.findAgzinho(a.agzinho) : undefined;
      return a.role === role || a.name.toLowerCase() === toName || a.agzinho === toName || ag?.apelido.toLowerCase() === toName;
    };
    const all = [...this.agents.values()];
    const to = all.find((a) => matches(a) && a.sessionId === from.sessionId) ?? all.find(matches);
    if (to) this.emit({ type: "chat", fromId: from.id, toId: to.id, text: truncate(text, 80) });
    this.pushFeed(from, `→ ${to?.name ?? (toName || "time")}: ${truncate(text, 80)}`, "message");
  }

  private update(agent: Agent, status: AgentStatus, activity: string) {
    // quem está chegando continua "chegando" no front até sentar; o front decide a animação
    agent.status = agent.status === "saindo" ? "saindo" : status;
    agent.activity = activity;
    agent.updatedAt = this.now();
    this.emit({ type: "agent", agent });
  }

  private leave(agent: Agent, activity: string) {
    if (agent.status === "saindo") return;
    agent.status = "saindo";
    agent.activity = activity;
    agent.updatedAt = this.now();
    this.emit({ type: "agent", agent });
    this.pushFeed(agent, activity.toLowerCase(), "done");
    const t = setTimeout(() => this.remove(agent.id), LEAVE_DELAY_MS);
    this.removalTimers.set(agent.id, t);
  }

  private remove(id: string) {
    const t = this.removalTimers.get(id);
    if (t) clearTimeout(t);
    this.removalTimers.delete(id);
    const arrive = this.arrivalTimers.get(id);
    if (arrive) clearTimeout(arrive);
    this.arrivalTimers.delete(id);
    for (const [alias, visual] of this.aliases) if (visual === id) this.aliases.delete(alias);
    this.bindings.delete(id);
    if (this.agents.delete(id)) this.emit({ type: "remove", id });
  }

  // ---------------------------------------------------------------- feed

  private pushFeed(agent: Agent, text: string, kind: FeedItem["kind"]) {
    const item: FeedItem = {
      id: ++this.feedSeq,
      at: this.now(),
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
    // status de agente muda a fase (reserva sem lista) e o "de boa"
    if (msg.type === "agent" || msg.type === "remove") this.refreshProgress();
  }

  /** Recalcula o quadro de etapas; manda {type:"progress"} só quando o valor muda. */
  private refreshProgress() {
    const { progress, proximaMudanca } = this.tasks.compute([...this.agents.values()], this.now());
    if (this.progressTimer) clearTimeout(this.progressTimer);
    this.progressTimer = null;
    if (proximaMudanca !== undefined) {
      // a lista concluída sai do quadro sozinha depois de um tempo
      this.progressTimer = setTimeout(() => this.refreshProgress(), Math.max(0, proximaMudanca - this.now()) + 10);
      this.progressTimer.unref?.();
    }
    if (sameProgress(progress, this.progress)) return;
    this.progress = progress;
    for (const fn of this.listeners) fn({ type: "progress", progress });
  }
}

const subagentId = (key: string) => `ag:${key}`;

/** sessões da simulação (server/demo.ts) */
const isDemo = (sessionId: string) => sessionId.startsWith("demo-");

/** AAAA-MM-DD no fuso local */
function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
