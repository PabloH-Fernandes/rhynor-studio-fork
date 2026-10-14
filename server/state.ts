// Estado do escritório: transforma os eventos crus dos hooks do Claude Code
// em "agentes" com status e atividade, e avisa quem estiver ouvindo.
//
// Cada subagente vira um AGzinho do elenco, com id visual estável (ag:<key>): o mesmo
// papel chamado de novo volta a ser a mesma pessoa. Quem termina fica "de boa" no
// escritório; todo mundo de uma sessão só vai embora no SessionEnd ou quando a sessão
// passa tempo demais sem nenhum evento. Exceção: visitante (Iara, Jorge, Sofia e extras, os agentes
// de fora do time) não fica de boa: sai andando ao entregar ou após 3 min sem evento, e só 3 cabem na tela.

import path from "node:path";
import type { Agent, AgentStatus, FeedItem, OfficeConfig, Progress, ReuniaoAtiva, ServerMessage } from "../shared/types.ts";
import { DEFAULT_ROSTER, agzinhoDoPapel, type AGzinho, type Roster } from "../shared/roster.ts";
import { MAX_VISITANTES_NA_TELA, ehVisitante } from "../shared/visitante.ts";
import { PROGRESS_NADA, ProgressTracker, sameProgress, type TarefasSalvas } from "./progress.ts";
import { ehComandoReuniao } from "./vault.ts";
import { comoAtividade, fraseEvento, fraseFerramenta, nomeCurto, simplificarAtividade, type Evento } from "./frases.ts";

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
  /** só no SessionEnd: por que a sessão acabou ("clear", "logout", "prompt_input_exit", "other"...) */
  reason?: string;
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
const RETIRE_MS = 2 * 60_000; // eventos atrasados de uma sessão encerrada (SessionEnd) são ignorados por esse tempo
const SWEEP_EVERY_MS = 60_000;
/** a reunião (/reuniao) desliga sozinha depois disso (Esc não dispara Stop) */
export const REUNIAO_MAX_MS = 15 * 60_000;
/** visitante sem SubagentStop e sem nenhum evento por esse tempo sai sozinho (exceto se estiver esperando você) */
export const VISITANTE_SEM_EVENTO_MS = 3 * 60_000;
/**
 * depois que um visitante sai, o agent_id dele fica em `retired` por esse tempo: evento tardio
 * (PreToolUse, SubagentHandback...) não recria o ag:extra:*; só um SubagentStart do mesmo id reabre
 */
export const VISITANTE_RETIRE_MS = 60_000;
/** /clear: o SessionEnd (reason "clear") espera o SessionStart da conversa nova por esse tempo */
export const TRANSICAO_MS = 30_000;
/** /clear com os hooks fora de ordem: SessionStart "clear" até esse tempo antes do SessionEnd "clear" ainda funde */
export const CLEAR_ADIANTADO_MS = 5000;
/** sessão com ferramenta realmente em andamento (Pre sem Post no mapa `emAndamento`) espera esse múltiplo do timeout */
const BUSY_TIMEOUT_FACTOR = 4;
/** "trabalhando" sem nenhum evento por esse tempo volta para "de boa" (ocioso) */
export const TRABALHANDO_EXPIRA_MS = 2 * 60_000;
/** o mesmo, quando a ferramenta em andamento é o Bash ou um Agent/Task (build, testes e subagentes demoram) */
export const TRABALHANDO_BASH_MS = 10 * 60_000;
/**
 * "pensando" sem nenhum evento por esse tempo também volta para "de boa": o Esc no prompt não dispara
 * Stop, e o líder ficaria "pensando" (contando em FAZENDO) até o fim da sessão
 */
export const PENSANDO_EXPIRA_MS = 5 * 60_000;
/** depois do SubagentStop, eventos do mesmo agent_id nessa janela são atrasados: não retomam ninguém */
export const JANELA_TARDIO_MS = 5000;
/** quanto tempo a lembrança de "este agent_id já deu SubagentStop" vale para não criar fantasma */
const PARADO_LEMBRA_MS = 10 * 60_000;
/** ferramentas que não contam como trabalho em andamento (entregar o resultado e perguntar a você) */
const FERRAMENTAS_SEM_TRABALHO = new Set(["SubagentHandback", "AskUserQuestion"]);
export const DEFAULT_SESSION_TIMEOUT_MIN = 30;
const FEED_LIMIT = 200;

/** Notification que pede algo a você e acende o laranja; as outras no máximo vão pro feed */
const NEEDS_YOU = new Set(["permission_prompt", "elicitation_dialog", "elicitation_url_dialog", "agent_needs_input"]);

type Listener = (msg: ServerMessage) => void;

/** ferramenta que começou (PreToolUse) e ainda não terminou (PostToolUse) */
interface EmAndamento {
  tool: string;
  at: number;
}

interface PendingSpawn {
  sessionId: string;
  type: string;
  description: string;
  timer: Timer;
}

/** como o id visual foi ligado da última vez: o tipo pedido e a chave do alias (agent_id ou t:<tool_use_id>) */
export interface Binding {
  type: string;
  alias: string;
  /**
   * chegou pelo SubagentStart sem nenhum "Agent" pendente pra casar: o PreToolUse dele ainda pode
   * chegar depois (ordem trocada). Só quem está assim pode ser casado por um "Agent" que chega depois.
   */
  awaitingSpawn?: boolean;
}

/** sessão que recebeu SessionEnd com reason "clear": o time espera a conversa nova (mesmo cwd) */
interface Transicao {
  cwd?: string;
  ate: number;
  timer: Timer;
}

/** O estado do escritório em JSON puro (data/escritorio.json); as simulações ficam de fora. */
export interface EstadoSalvo {
  v: 1;
  salvoEm: number;
  agents: Agent[];
  feed: FeedItem[];
  feedSeq: number;
  aliases: [string, string][];
  bindings: [string, Binding][];
  retired: [string, number][];
  stopped: string[];
  lastSeen: [string, number][];
  lideres: [string, string][];
  transicoes: { sessionId: string; cwd?: string; ate: number }[];
  tarefas: TarefasSalvas;
}

/** identificador opaco de um timer do Relogio */
export type Timer = unknown;

/** relógio e timers do estado: os globais por padrão; o replay usa um agendador virtual */
export interface Relogio {
  now(): number;
  setTimeout(fn: () => void, ms: number): Timer;
  clearTimeout(timer: Timer): void;
}

/** os globais, resolvidos na hora da chamada (os testes trocam o setTimeout pelo mock do node:test) */
const RELOGIO_PADRAO: Relogio = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
};

/** timer que não segura o processo aberto (só os do Node têm unref) */
function soltar(t: Timer) {
  const unref = (t as { unref?: unknown } | null)?.unref;
  if (typeof unref === "function") unref.call(t);
}

export interface OfficeStateOptions {
  /** sessão sem evento por esse tempo é encerrada (padrão 30 min) */
  sessionTimeoutMs?: number;
  /** relógio (injetável nos testes); com `relogio`, vale o now dele */
  now?: () => number;
  /** relógio e timers (injetáveis: o replay usa um agendador virtual) */
  relogio?: Partial<Relogio>;
  /** intervalo da varredura de sessões; 0 desliga (os testes chamam sweep() na mão) */
  sweepEveryMs?: number;
}

export class OfficeState {
  private agents = new Map<string, Agent>();
  private feed: FeedItem[] = [];
  private feedSeq = 0;
  /** atividade simples dada junto com a técnica (ferramenta, permissão...); vale enquanto a técnica for a mesma */
  private simplesDada = new Map<string, { de: string; simples: string }>();
  private listeners = new Set<Listener>();
  private pending = new Map<string, PendingSpawn>(); // tool_use_id -> spawn ainda sem SubagentStart
  private removalTimers = new Map<string, Timer>();
  private arrivalTimers = new Map<string, Timer>();
  /** visitante (id visual) → timer da saída por falta de evento (VISITANTE_SEM_EVENTO_MS) */
  private visitorTimers = new Map<string, Timer>();
  private roster: Roster = structuredClone(DEFAULT_ROSTER);
  /** id visual → (tool_use_id → ferramenta em andamento). Sempre por agente: nunca cruza agent_id nem sessão */
  private emAndamento = new Map<string, Map<string, EmAndamento>>();
  /** id visual → timer da expiração de "trabalhando" sem evento (TRABALHANDO_EXPIRA_MS / TRABALHANDO_BASH_MS) */
  private trabalhoTimers = new Map<string, Timer>();
  /** alias (agent_id) → quando deu SubagentStop: evento tardio dele não revive nem cria fantasma */
  private paradoEm = new Map<string, number>();
  /** agent_id ou "t:"+tool_use_id → id visual (ag:dev, ag:dev-2...) */
  private aliases = new Map<string, string>();
  /** id visual → última ligação (pra achar quem acabou de chegar pelo SubagentStart) */
  private bindings = new Map<string, Binding>();
  /**
   * sessão (s:<id>) ou agent_id de sessão encerrada por SessionEnd → até quando os eventos dele
   * são ignorados. Subagente que só entregou (SubagentStop) NÃO entra aqui: ele pode ser retomado.
   */
  private retired = new Map<string, number>();
  /**
   * aliases (agent_id ou t:...) que já entregaram (SubagentStop) e ainda não voltaram: o boneco
   * fica ocioso e ligado a eles, mas pode ser reaproveitado se não houver outro livre
   */
  private stopped = new Set<string>();
  /**
   * aliases parados que já ganharam a linha "foi chamado de novo" (pelo SendMessage do líder) e
   * ainda não voltaram: o 1º evento dele depois não repete a linha
   */
  private chamadosDeNovo = new Set<string>();
  /** session_id → último evento recebido */
  private lastSeen = new Map<string, number>();
  /** session_id → id visual do líder, quando não é s:<session_id> (o time herdado de um /clear) */
  private lideres = new Map<string, string>();
  /** session_id encerrada por /clear → espera da conversa nova */
  private transicoes = new Map<string, Transicao>();
  /** SessionStart "clear" que não achou time para herdar: o SessionEnd da conversa limpa pode vir depois */
  private clearsSemTime = new Map<string, { cwd?: string; at: number }>();
  /** listas de tarefas por sessão (quadro de etapas) e o último valor mandado às telas */
  private tasks = new ProgressTracker();
  private progress: Progress = PROGRESS_NADA;
  private progressTimer: Timer | null = null;
  /** reunião (/reuniao) em andamento: passageira, não entra no serializar(); sai no Stop, em outro prompt ou em 15 min */
  private reuniao: ReuniaoAtiva | null = null;
  private reuniaoTimer: Timer | null = null;
  private readonly now: () => number;
  private readonly relogio: Relogio;
  readonly config: OfficeConfig;

  constructor(opts: OfficeStateOptions = {}) {
    this.relogio = { ...RELOGIO_PADRAO, ...(opts.now ? { now: opts.now } : {}), ...opts.relogio };
    this.now = this.relogio.now;
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
      agents: [...this.agents.values()].map((a) => this.comSimples(a)),
      feed: this.feed.slice(-60),
      roster: this.roster,
      config: this.config,
      progress: this.progress,
      reuniao: this.reuniao,
    };
  }

  getReuniao(): ReuniaoAtiva | null {
    return this.reuniao;
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

  // ---------------------------------------------------------------- persistência

  /**
   * O estado em JSON puro, para sobreviver ao reinício do servidor (tsx watch). Fica de fora o que
   * é passageiro: simulações, quem já está saindo, spawns pendentes e timers.
   */
  serializar(): EstadoSalvo {
    const real = (sessionId: string) => !isDemo(sessionId);
    // visitante é passageiro (sai ao entregar ou em 3 min): não é gravado
    const agents = [...this.agents.values()].filter((a) => real(a.sessionId) && a.status !== "saindo" && !ehVisitante(a));
    const ids = new Set(agents.map((a) => a.id));
    const daDemo = new Set([...this.agents.values()].filter((a) => isDemo(a.sessionId)).map((a) => a.id));
    return {
      v: 1,
      salvoEm: this.now(),
      agents: structuredClone(agents),
      feed: this.feed.filter((f) => !daDemo.has(f.agentId) && !f.agentId.startsWith("s:demo-")).slice(-60),
      feedSeq: this.feedSeq,
      aliases: [...this.aliases].filter(([, visual]) => ids.has(visual)),
      bindings: structuredClone([...this.bindings].filter(([visual]) => ids.has(visual))),
      retired: [...this.retired],
      stopped: [...this.stopped],
      lastSeen: [...this.lastSeen].filter(([sessionId]) => real(sessionId)),
      lideres: [...this.lideres].filter(([, visual]) => ids.has(visual)),
      transicoes: [...this.transicoes].map(([sessionId, t]) => ({ sessionId, cwd: t.cwd, ate: t.ate })),
      tarefas: this.tasks.serializar().filter((t) => real(t.sessionId)),
    };
  }

  /**
   * Carrega o estado salvo por serializar() num OfficeState recém-criado (antes de qualquer evento).
   * Sessões que passaram do timeout ficam de fora; quem estava "chegando" já aparece sentado (o
   * timer de chegada morreu com o processo). Dado inválido → começa vazio. Nunca lança.
   * Devolve quantos agentes voltaram.
   */
  restaurar(dados: unknown): number {
    try {
      return this.restaurarOuLancar(dados);
    } catch {
      this.limparMemoria();
      return 0;
    }
  }

  private restaurarOuLancar(dados: unknown): number {
    this.limparMemoria();
    if (!isObj(dados) || dados.v !== 1) return 0;
    const now = this.now();
    const lista = <T>(v: unknown, ok: (x: unknown) => x is T): T[] => (Array.isArray(v) ? v.filter(ok) : []);
    const par = <V>(ok: (x: unknown) => x is V) => (x: unknown): x is [string, V] =>
      Array.isArray(x) && x.length === 2 && typeof x[0] === "string" && ok(x[1]);
    const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
    const txt = (x: unknown): x is string => typeof x === "string";

    const agents = lista(dados.agents, agenteValido).filter((a) => !isDemo(a.sessionId) && a.status !== "saindo" && !ehVisitante(a));
    const seen = new Map(lista(dados.lastSeen, par(num)));
    const transicoes = lista(dados.transicoes, (x): x is { sessionId: string; cwd?: string; ate: number } =>
      isObj(x) && txt(x.sessionId) && num(x.ate) && (x.cwd === undefined || txt(x.cwd)),
    );
    const emTransicao = new Map(transicoes.filter((t) => t.ate > now && seen.has(t.sessionId)).map((t) => [t.sessionId, t]));
    // sessão viva: teve evento e não passou do timeout (a regra é a mesma da varredura)
    const vivas = new Set<string>();
    for (const [sessionId, t] of seen) {
      if (isDemo(sessionId) || this.semSinal(sessionId, t, now, agents)) continue;
      // /clear sem a conversa nova até o fim da espera: a sessão acabou
      if (transicoes.some((x) => x.sessionId === sessionId) && !emTransicao.has(sessionId)) continue;
      vivas.add(sessionId);
    }

    for (const a of agents) {
      if (!vivas.has(a.sessionId)) continue;
      if (a.status === "chegando" || a.status === "trabalhando" || a.status === "pensando") {
        // os timers e as ferramentas em andamento morreram com o processo: ninguém volta "trabalhando"
        // (o próximo evento de verdade o põe a trabalhar de novo)
        a.status = "ocioso";
        a.activity = a.parentId ? "De boa" : "Esperando seu próximo pedido";
      }
      const ag = a.agzinho ? this.findAgzinho(a.agzinho) : undefined;
      if (ag) a.name = ag.nome;
      this.agents.set(a.id, a);
    }
    for (const sessionId of vivas) this.lastSeen.set(sessionId, seen.get(sessionId)!);
    for (const [alias, visual] of lista(dados.aliases, par(txt))) if (this.agents.has(visual)) this.aliases.set(alias, visual);
    const bindingValido = (x: unknown): x is Binding => isObj(x) && txt(x.type) && txt(x.alias);
    for (const [visual, b] of lista(dados.bindings, par(bindingValido))) {
      if (this.agents.has(visual)) this.bindings.set(visual, { type: b.type, alias: b.alias, awaitingSpawn: b.awaitingSpawn === true || undefined });
    }
    for (const alias of lista(dados.stopped, txt)) if (this.aliases.has(alias)) this.stopped.add(alias);
    for (const [key, until] of lista(dados.retired, par(num))) if (until > now) this.retired.set(key, until);
    for (const [sessionId, visual] of lista(dados.lideres, par(txt))) {
      if (vivas.has(sessionId) && this.agents.has(visual)) this.lideres.set(sessionId, visual);
    }
    for (const t of emTransicao.values()) if (vivas.has(t.sessionId)) this.agendarTransicao(t.sessionId, t.cwd, t.ate);
    this.tasks.restaurar(dados.tarefas, (sessionId) => vivas.has(sessionId));
    const ids = new Set(this.agents.keys());
    this.feed = lista(dados.feed, (x): x is FeedItem => isObj(x) && num(x.id) && txt(x.agentId) && txt(x.text)).filter(
      (f) => ids.has(f.agentId) || !f.agentId.startsWith("s:demo-"),
    );
    this.feedSeq = Math.max(num(dados.feedSeq) ? dados.feedSeq : 0, ...this.feed.map((f) => f.id));
    this.refreshProgress();
    this.emit(this.snapshot());
    return this.agents.size;
  }

  /** zera tudo sem avisar ninguém (o restaurar começa daqui) */
  private limparMemoria() {
    for (const t of this.removalTimers.values()) this.relogio.clearTimeout(t);
    for (const t of this.arrivalTimers.values()) this.relogio.clearTimeout(t);
    for (const p of this.pending.values()) this.relogio.clearTimeout(p.timer);
    for (const t of this.transicoes.values()) this.relogio.clearTimeout(t.timer);
    for (const t of this.visitorTimers.values()) this.relogio.clearTimeout(t);
    for (const t of this.trabalhoTimers.values()) this.relogio.clearTimeout(t);
    this.removalTimers.clear();
    this.arrivalTimers.clear();
    this.visitorTimers.clear();
    this.trabalhoTimers.clear();
    this.emAndamento.clear();
    this.paradoEm.clear();
    this.pending.clear();
    this.transicoes.clear();
    this.clearsSemTime.clear();
    this.agents.clear();
    this.aliases.clear();
    this.bindings.clear();
    this.retired.clear();
    this.stopped.clear();
    this.chamadosDeNovo.clear();
    this.lastSeen.clear();
    this.lideres.clear();
    this.tasks.reset();
    this.feed = [];
    this.pararReuniao(false);
  }

  /** Apaga tudo (usado pelo botão "Limpar" da tela). */
  reset() {
    for (const t of this.removalTimers.values()) this.relogio.clearTimeout(t);
    for (const t of this.arrivalTimers.values()) this.relogio.clearTimeout(t);
    for (const p of this.pending.values()) this.relogio.clearTimeout(p.timer);
    for (const t of this.visitorTimers.values()) this.relogio.clearTimeout(t);
    for (const t of this.trabalhoTimers.values()) this.relogio.clearTimeout(t);
    this.removalTimers.clear();
    this.arrivalTimers.clear();
    this.visitorTimers.clear();
    this.trabalhoTimers.clear();
    this.emAndamento.clear();
    this.paradoEm.clear();
    this.pending.clear();
    this.aliases.clear();
    this.bindings.clear();
    this.retired.clear();
    this.stopped.clear();
    this.chamadosDeNovo.clear();
    this.lastSeen.clear();
    for (const t of this.transicoes.values()) this.relogio.clearTimeout(t.timer);
    this.transicoes.clear();
    this.clearsSemTime.clear();
    this.tasks.reset();
    for (const id of [...this.agents.keys()]) this.remove(id);
    this.lideres.clear();
    this.feed = [];
    this.pararReuniao(false);
    this.refreshProgress();
    this.emit(this.snapshot());
  }

  // ---------------------------------------------------------------- entrada

  handleHook(input: HookInput) {
    if (!input || typeof input.hook_event_name !== "string" || !input.session_id) return;
    const ev = input.hook_event_name;
    // sessão encerrada: eventos atrasados não recriam o líder (só um SessionStart novo a reabre)
    const sessionKey = this.sessionKey(input.session_id);
    if (ev === "SessionStart") this.retired.delete(sessionKey);
    else if (this.isRetired(sessionKey)) return;
    if (ev !== "SessionEnd") {
      this.lastSeen.set(input.session_id, this.now());
      // a sessão que parecia limpa por /clear continua viva: cancela a espera
      const transicao = this.transicoes.get(input.session_id);
      if (transicao) this.relogio.clearTimeout(transicao.timer);
      this.transicoes.delete(input.session_id);
    }
    // a lista muda antes do agente: o refresh do update() já vê a lista nova
    const listaMudou = this.tasks.handle(input, this.now());

    switch (ev) {
      case "SessionStart": {
        // /clear: a conversa nova (session_id novo) herda o time da que acabou de ser limpa
        const herdou = input.source === "clear" && this.herdarTime(input);
        const existia = this.agents.get(this.leaderId(input.session_id))?.sessionId === input.session_id;
        const lead = this.ensureLeader(input);
        // compact/resume da mesma sessão: o time fica e o líder segue no que estava fazendo
        // (o compact automático chega no meio do trabalho); só quem já estava ocioso ganha o texto novo
        if (!herdou && existia && (input.source === "compact" || input.source === "resume")) {
          if (lead.status === "ocioso") this.update(lead, "ocioso", input.source === "compact" ? "Resumiu a conversa" : "Voltou ao trabalho");
          this.pushFeed(lead, input.source === "compact" ? "resumiu a conversa (compact)" : "retomou a sessão", "info", {
            tipo: input.source === "compact" ? "resumiu" : "voltou",
          });
          break;
        }
        if (input.source === "clear" && !herdou) this.clearsSemTime.set(input.session_id, { cwd: input.cwd, at: this.now() });
        if (herdou) {
          this.update(lead, "ocioso", "Começou uma conversa nova");
          this.pushFeed(lead, "limpou a conversa (/clear): o time continua", "info", { tipo: "conversaNova" });
          break;
        }
        this.update(lead, "ocioso", input.source === "resume" ? "Voltou ao trabalho" : "Chegou no escritório");
        this.pushFeed(lead, `entrou no projeto ${lead.project}`, "info", { tipo: "chegou" });
        break;
      }

      case "UserPromptSubmit": {
        const lead = this.ensureLeader(input);
        const prompt = String(input.user_prompt ?? input.prompt ?? "").trim();
        this.update(lead, "pensando", "Lendo seu pedido...");
        if (ehComandoReuniao(prompt)) {
          // a ata vem colada nos argumentos e é confidencial: nem no feed nem no estado salvo
          this.iniciarReuniao(input.session_id, lead.id);
          this.pushFeed(lead, "começou uma reunião (/reuniao)", "message", { tipo: "pedido" });
          break;
        }
        if (this.reuniao?.sessionId === input.session_id) this.pararReuniao(true);
        this.pushFeed(lead, prompt ? `recebeu: “${truncate(prompt, 90)}”` : "recebeu um pedido", "message", { tipo: "pedido" });
        break;
      }

      case "PreToolUse": {
        const tool = input.tool_name ?? "?";
        // entregar o resultado não retoma ninguém (o Handback chega colado no SubagentStop)
        const agent = this.agentFor(input, { religa: tool !== "SubagentHandback" });
        if (!agent) break; // evento atrasado de quem já entregou
        if (tool === "SubagentHandback" && input.agent_id && this.stopped.has(input.agent_id)) break;
        const toolInput = input.tool_input ?? {};
        this.registrarFerramenta(agent, input, tool);

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
          this.pushFeed(agent, "está esperando sua resposta", "alert", { tipo: "pergunta" });
          break;
        }

        const ag = agent.agzinho ? this.findAgzinho(agent.agzinho) : undefined;
        const frase = fraseFerramenta(tool, toolInput, { genero: ag?.genero, papel: agent.role });
        this.update(agent, "trabalhando", describeTool(tool, toolInput), comoAtividade(frase.simples));
        // o SendMessage já virou linha de recado (handleSendMessage): não repete "Mandando mensagem"
        if (tool !== "SendMessage") this.pushFeed(agent, describeTool(tool, toolInput), "tool", { tipo: "ferramenta", tool, input: toolInput });
        break;
      }

      case "PostToolUse":
      case "PostToolUseFailure": {
        const tool = input.tool_name ?? "?";
        if (SUBAGENT_TOOLS.has(tool) && !input.agent_id && input.tool_use_id) {
          this.finishFallback(input.tool_use_id);
        }
        // o fim de uma ferramenta não retoma ninguém: Post atrasado (depois do SubagentStop, do Stop
        // ou do TeammateIdle) não tira de "ocioso"; só PreToolUse e SubagentStart retomam
        const agent = this.agentFor(input, { religa: false });
        if (agent) this.terminarFerramenta(agent, input, tool);
        if (!agent || agent.status === "ocioso") break;
        // de resto, trabalho ganha do descanso: o Post também é trabalho (nunca vira ocioso nem "pensando")
        const falhou = ev === "PostToolUseFailure";
        this.update(
          agent,
          "trabalhando",
          falhou ? `Deu erro em ${tool}, ajustando...` : agent.activity,
          falhou ? "Deu um problema, tentando de outro jeito" : undefined,
        );
        if (ev === "PostToolUseFailure") this.pushFeed(agent, `${tool} falhou`, "alert", { tipo: "falhou" });
        break;
      }

      case "PermissionRequest": {
        const agent = this.agentFor(input);
        if (!agent) break;
        const what = describeTool(input.tool_name ?? "?", input.tool_input ?? {});
        this.update(agent, "esperando", `Pedindo permissão: ${what}`, "Precisa da sua autorização");
        this.pushFeed(agent, `pediu permissão → ${what}`, "alert", { tipo: "autorizacao" });
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
          this.pushFeed(agent, msg ? `avisou: ${truncate(msg, 80)}` : "precisa de você", "alert", { tipo: "precisa" });
        } else if (msg) {
          // auth_success, elicitation_complete, agent_completed, quota_*...: só informa
          this.pushFeed(agent, `avisou: ${truncate(msg, 80)}`, "info", { tipo: "aviso" });
        }
        break;
      }

      case "SubagentStart": {
        const id = input.agent_id;
        if (!id) break;
        // SubagentStart explícito reabre um visitante que acabou de sair (a sessão encerrada já foi
        // barrada lá em cima, no handleHook)
        this.retired.delete(id);
        this.paradoEm.delete(id);
        const type = String(input.agent_type ?? "general-purpose");
        const known = this.agentByAlias(id);
        if (known) {
          if (this.stopped.delete(id)) {
            // retomado (SendMessage do líder depois do SubagentStop): mesmo boneco, de volta à mesa.
            // Só casa com um "Agent" pendente pelo tool_use_id (por tipo, roubaria o de um novo)
            const pend = this.takePending(input.session_id, type, input.tool_use_id, false);
            this.revive(known);
            this.avisarChamadoDeNovo(known, id);
            this.chamadosDeNovo.delete(id);
            this.update(known, "trabalhando", pend?.description ? truncate(pend.description, 60) : "Voltou ao trabalho");
            this.markAwaitingSpawn(known, false);
            break;
          }
          // um evento dele chegou antes do Start e já o colocou na mesa: só completa a descrição.
          // Por tipo só se ele ainda espera o "Agent" dele (senão roubaria o pendente de um novo do mesmo papel)
          const waiting = this.bindings.get(known.id)?.awaitingSpawn === true;
          const pend = this.takePending(input.session_id, type, input.tool_use_id, waiting);
          if (pend?.description) this.update(known, known.status, truncate(pend.description, 60));
          this.markAwaitingSpawn(known, !pend);
          break;
        }
        // o fallback já criou este subagente pelo tool_use_id: passa a ouvir pelo agent_id
        // (o "Agent" dele já foi consumido pelo fallback: não pega o pendente de outro).
        // Pelo tool_use_id quando vier; só sem ele casa pelo tipo
        const byTool = input.tool_use_id ? this.agentByAlias(`t:${input.tool_use_id}`) : undefined;
        const early = byTool && !this.stopped.has(`t:${input.tool_use_id}`) ? byTool : this.fallbackBound(input.session_id, type);
        if (early) {
          this.rebindAlias(early, id, type);
          break;
        }
        const pend = this.takePending(input.session_id, type, input.tool_use_id);
        const agent = this.bindSubagent(input.session_id, id, type, pend?.description ?? "", input.cwd);
        if (!pend) this.markAwaitingSpawn(agent, true);
        break;
      }

      case "SubagentStop": {
        const id = input.agent_id;
        if (!id) break;
        const agent = this.agentByAlias(id);
        if (agent && !this.stopped.has(id)) this.finishWork(agent, id);
        break;
      }

      case "TeammateIdle": {
        const agent = this.agentFor(input);
        if (agent) this.update(agent, "ocioso", "Livre, esperando tarefa");
        break;
      }

      case "Stop": {
        const lead = this.ensureLeader(input);
        if (this.reuniao?.sessionId === input.session_id) this.pararReuniao(true);
        this.encerrarVez(input.session_id);
        this.update(lead, "ocioso", "Terminou, esperando você");
        this.pushFeed(lead, "terminou a vez dele", "done", { tipo: "terminouVez" });
        break;
      }

      case "SessionEnd": {
        // /clear: a sessão acaba, mas a conversa nova (SessionStart source "clear") vem logo atrás
        if (input.reason === "clear" && !isDemo(input.session_id)) this.esperarConversaNova(input);
        else this.endSession(input.session_id, "Foi embora");
        break;
      }

      default:
        // outros eventos não mudam o escritório
        break;
    }
    if (listaMudou) this.refreshProgress();
  }

  // ---------------------------------------------------------------- reunião (/reuniao)

  private iniciarReuniao(sessionId: string, liderId: string) {
    const desde = this.reuniao?.sessionId === sessionId ? this.reuniao.desde : this.now();
    this.pararReuniao(false);
    this.reuniao = { sessionId, liderId, desde };
    // Esc não dispara Stop: sem isso a mesa de reunião ficaria ligada para sempre
    this.reuniaoTimer = this.relogio.setTimeout(() => {
      this.reuniaoTimer = null;
      this.pararReuniao(true);
    }, REUNIAO_MAX_MS);
    soltar(this.reuniaoTimer);
    this.emit({ type: "reuniao", reuniao: this.reuniao });
  }

  private pararReuniao(avisar: boolean) {
    if (this.reuniaoTimer !== null) this.relogio.clearTimeout(this.reuniaoTimer);
    this.reuniaoTimer = null;
    const tinha = this.reuniao !== null;
    this.reuniao = null;
    if (avisar && tinha) this.emit({ type: "reuniao", reuniao: null });
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
    if (this.reuniao?.sessionId === sessionId) this.pararReuniao(true);
    const transicao = this.transicoes.get(sessionId);
    if (transicao) this.relogio.clearTimeout(transicao.timer);
    this.transicoes.delete(sessionId);
    this.clearsSemTime.delete(sessionId);
    if (retire) this.retire(this.sessionKey(sessionId));
    for (const [key, p] of this.pending) {
      if (p.sessionId !== sessionId) continue;
      this.relogio.clearTimeout(p.timer);
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
    for (const [id, at] of this.paradoEm) if (now - at > PARADO_LEMBRA_MS) this.paradoEm.delete(id);
    for (const id of [...this.emAndamento.keys()]) this.ferramentasAtivas(id); // poda o que passou de 10 min
    for (const [sessionId, seen] of [...this.lastSeen]) {
      if (this.semSinal(sessionId, seen, now)) this.endSession(sessionId, "Saiu (sessão sem sinal)", { retire: false });
    }
    // visitantes sem evento há VISITANTE_SEM_EVENTO_MS (o timer de cada um faz o mesmo na hora certa;
    // aqui é a rede de segurança para quem roda só com o `now` trocado)
    for (const a of [...this.agents.values()]) {
      if (this.visitanteExpirou(a, now)) this.sairVisitante(a, "Saiu (sem sinal)");
      else if (this.trabalhoExpirou(a, now)) this.expirarTrabalho(a);
    }
  }

  // ---------------------------------------------------------------- ferramentas em andamento

  /** PreToolUse: a ferramenta passa a contar como trabalho em andamento deste agente (menos entregar/perguntar) */
  private registrarFerramenta(agent: Agent, input: HookInput, tool: string) {
    if (FERRAMENTAS_SEM_TRABALHO.has(tool)) return;
    let mapa = this.emAndamento.get(agent.id);
    if (!mapa) this.emAndamento.set(agent.id, (mapa = new Map()));
    mapa.set(input.tool_use_id ?? `anon:${tool}`, { tool, at: this.now() });
  }

  /** PostToolUse / PostToolUseFailure: a ferramenta acabou */
  private terminarFerramenta(agent: Agent, input: HookInput, tool: string) {
    const mapa = this.emAndamento.get(agent.id);
    if (!mapa) return;
    mapa.delete(input.tool_use_id ?? `anon:${tool}`);
    if (mapa.size === 0) this.emAndamento.delete(agent.id);
  }

  /**
   * As ferramentas em andamento do agente. Entrada com mais de TRABALHANDO_BASH_MS é descartada: o Post
   * dela nunca veio (senão uma ferramenta esquecida seguraria o "trabalhando" e a sessão para sempre).
   */
  private ferramentasAtivas(agentId: string): EmAndamento[] {
    const mapa = this.emAndamento.get(agentId);
    if (!mapa) return [];
    const now = this.now();
    for (const [key, f] of mapa) if (now - f.at > TRABALHANDO_BASH_MS) mapa.delete(key);
    if (mapa.size === 0) this.emAndamento.delete(agentId);
    return [...mapa.values()];
  }

  private temFerramenta(agentId: string): boolean {
    return this.ferramentasAtivas(agentId).length > 0;
  }

  /**
   * limite sem evento para "trabalhando"/"pensando": 10 min com Bash ou Agent/Task em andamento;
   * senão 5 min "pensando" e 2 min "trabalhando"
   */
  private limiteTrabalho(a: Agent): number {
    if (this.ferramentasAtivas(a.id).some((f) => f.tool === "Bash" || SUBAGENT_TOOLS.has(f.tool))) return TRABALHANDO_BASH_MS;
    return a.status === "pensando" ? PENSANDO_EXPIRA_MS : TRABALHANDO_EXPIRA_MS;
  }

  /** "trabalhando"/"pensando" sem evento além do limite (visitante tem a regra própria dos 3 min; "esperando" nunca expira) */
  private trabalhoExpirou(a: Agent, now: number): boolean {
    if ((a.status !== "trabalhando" && a.status !== "pensando") || ehVisitante(a)) return false;
    return now - a.updatedAt >= this.limiteTrabalho(a);
  }

  /** volta para "de boa" (ocioso) e esquece as ferramentas em andamento: o Post nunca veio */
  private expirarTrabalho(a: Agent) {
    this.emAndamento.delete(a.id);
    this.update(a, "ocioso", a.parentId ? "De boa" : "Esperando seu próximo pedido");
  }

  /** (re)arma a expiração de "trabalhando", contada do último evento do agente */
  private vigiarTrabalho(a: Agent) {
    const antigo = this.trabalhoTimers.get(a.id);
    if (antigo !== undefined) this.relogio.clearTimeout(antigo);
    this.trabalhoTimers.delete(a.id);
    if ((a.status !== "trabalhando" && a.status !== "pensando") || ehVisitante(a)) return;
    const espera = Math.max(0, a.updatedAt + this.limiteTrabalho(a) - this.now());
    const timer = this.relogio.setTimeout(() => {
      this.trabalhoTimers.delete(a.id);
      if (this.agents.get(a.id) !== a) return;
      if (this.trabalhoExpirou(a, this.now())) this.expirarTrabalho(a);
      else this.vigiarTrabalho(a); // chegou evento no meio
    }, espera);
    soltar(timer);
    this.trabalhoTimers.set(a.id, timer);
  }

  /**
   * Stop do líder: acabou a vez da sessão. Ninguém dela continua "trabalhando"/"pensando": volta a
   * "de boa"; visitantes saem; quem espera você continua esperando. Só mexe nos agentes desta sessão.
   */
  private encerrarVez(sessionId: string) {
    for (const a of [...this.agents.values()]) {
      if (a.sessionId !== sessionId || a.status === "saindo") continue;
      if (a.status === "esperando") {
        this.emAndamento.delete(a.id);
        continue;
      }
      if (ehVisitante(a)) {
        // visitante com ferramenta em andamento segue em background: SubagentStop e os 3 min cobrem a saída
        if (this.temFerramenta(a.id) && a.status !== "ocioso") continue;
        this.sairVisitante(a, "Foi embora", { definitiva: false });
        continue;
      }
      this.emAndamento.delete(a.id);
      if (a.parentId && a.status !== "ocioso") {
        const arrive = this.arrivalTimers.get(a.id);
        if (arrive !== undefined) this.relogio.clearTimeout(arrive);
        this.arrivalTimers.delete(a.id);
        this.update(a, "ocioso", "De boa");
      }
    }
  }

  /** visitante parado além do limite (quem espera você nunca expira; quem já está saindo, também não) */
  private visitanteExpirou(a: Agent, now: number): boolean {
    if (!ehVisitante(a) || a.status === "saindo" || a.status === "esperando") return false;
    return now - a.updatedAt >= VISITANTE_SEM_EVENTO_MS;
  }

  /** (re)arma a saída do visitante por falta de evento, contada do último evento dele */
  private vigiarVisitante(a: Agent) {
    const antigo = this.visitorTimers.get(a.id);
    if (antigo !== undefined) this.relogio.clearTimeout(antigo);
    this.visitorTimers.delete(a.id);
    if (!ehVisitante(a) || a.status === "saindo") return;
    const espera = Math.max(0, a.updatedAt + VISITANTE_SEM_EVENTO_MS - this.now());
    const timer = this.relogio.setTimeout(() => {
      this.visitorTimers.delete(a.id);
      if (this.agents.get(a.id) !== a) return;
      if (this.visitanteExpirou(a, this.now())) this.sairVisitante(a, "Saiu (sem sinal)");
      else if (a.status !== "esperando" && a.status !== "saindo") this.vigiarVisitante(a); // chegou evento no meio
    }, espera);
    soltar(timer);
    this.visitorTimers.set(a.id, timer);
  }

  /**
   * Visitante vai embora andando até a porta (entregou ou ficou sem sinal) e o agent_id dele fica
   * em `retired` por VISITANTE_RETIRE_MS: evento tardio não o recria (só um SubagentStart reabre).
   * Sempre grava `paradoEm` (um SubagentStart reabre). Com `definitiva: false` (Stop do líder, o
   * visitante pode seguir vivo) não usa o `retired`, para não bloquear os eventos dele por 60 s.
   */
  private sairVisitante(agent: Agent, activity: string, { definitiva = true }: { definitiva?: boolean } = {}) {
    for (const [alias, visual] of this.aliases) {
      if (visual !== agent.id) continue;
      if (definitiva) this.retire(alias, VISITANTE_RETIRE_MS);
      this.paradoEm.set(alias, this.now());
      this.stopped.add(alias);
    }
    this.leave(agent, activity);
  }

  /**
   * Marca quais visitantes cabem na tela: os MAX_VISITANTES_NA_TELA primeiros por ordem da primeira chegada (startedAt: o boundAt muda a cada SubagentStart)
   * (quem está saindo ainda ocupa o lugar, pois continua andando no mapa); o resto é `excedente`.
   * Devolve os agentes cuja marca mudou.
   */
  private reordenarVisitantes(): Agent[] {
    const mudaram: Agent[] = [];
    const visitantes = [...this.agents.values()].filter(ehVisitante).sort((a, b) => a.startedAt - b.startedAt);
    visitantes.forEach((a, i) => {
      const excedente = i >= MAX_VISITANTES_NA_TELA;
      if (Boolean(a.excedente) === excedente) return;
      if (excedente) a.excedente = true;
      else delete a.excedente;
      mudaram.push(a);
    });
    return mudaram;
  }

  /** a sessão passou do timeout sem evento (com alguém esperando você, nunca; trabalhando, 4x) */
  private semSinal(sessionId: string, seen: number, now: number, agents: Iterable<Agent> = this.agents.values()): boolean {
    const team = [...agents].filter((a) => a.sessionId === sessionId);
    if (team.some((a) => a.status === "esperando")) return false;
    // só ferramenta realmente em andamento segura a sessão; fantasma "trabalhando" e visitante não
    const busy = team.some((a) => !ehVisitante(a) && this.temFerramenta(a.id));
    return now - seen > this.config.sessionTimeoutMs * (busy ? BUSY_TIMEOUT_FACTOR : 1);
  }

  // ---------------------------------------------------------------- /clear

  /** SessionEnd reason "clear": o time fica esperando a conversa nova; sem ela em 30 s, vai embora. */
  private esperarConversaNova(input: HookInput) {
    if (this.fundirClearAdiantado(input)) return;
    this.agendarTransicao(input.session_id, input.cwd, this.now() + TRANSICAO_MS);
  }

  /**
   * O SessionStart "clear" da conversa nova chegou ANTES deste SessionEnd "clear" (hooks em paralelo):
   * o líder recém-chegado sai da tela e o time da conversa limpa passa para a sessão nova na hora.
   */
  private fundirClearAdiantado(input: HookInput): boolean {
    const antiga = input.session_id;
    const now = this.now();
    for (const [sessionId, c] of this.clearsSemTime) if (now - c.at > CLEAR_ADIANTADO_MS) this.clearsSemTime.delete(sessionId);
    const candidatas = [...this.clearsSemTime].filter(([sessionId]) => sessionId !== antiga);
    const novo = this.escolherPorCwd(candidatas, input.cwd, (c) => c.at);
    if (novo === undefined) return false;
    this.clearsSemTime.delete(novo);
    const recem = this.agents.get(this.leaderId(novo));
    const antigo = this.agents.get(this.leaderId(antiga));
    if (recem && antigo && recem.sessionId === novo) {
      this.remove(recem.id);
      this.transferirTime(antiga, novo);
      this.update(antigo, recem.status === "chegando" ? "ocioso" : recem.status, recem.status === "ocioso" || recem.status === "chegando" ? "Começou uma conversa nova" : recem.activity);
    } else {
      this.transferirTime(antiga, novo);
    }
    return true;
  }

  /**
   * A espera mais recente compatível com o cwd. Com mais de uma aberta, o cwd tem que ser igual
   * (sem cwd nenhum, não dá pra saber qual: não casa); com uma só, cwd ausente de um dos lados aceita.
   */
  private escolherPorCwd<T extends { cwd?: string }>(lista: [string, T][], cwd: string | undefined, quando: (t: T) => number): string | undefined {
    const exigir = lista.length > 1;
    let melhor: string | undefined;
    let maisRecente = -Infinity;
    for (const [sessionId, t] of lista) {
      const ok = exigir ? !!cwd && t.cwd === cwd : !(t.cwd && cwd && t.cwd !== cwd);
      if (ok && quando(t) > maisRecente) {
        maisRecente = quando(t);
        melhor = sessionId;
      }
    }
    return melhor;
  }

  private agendarTransicao(sessionId: string, cwd: string | undefined, ate: number) {
    const anterior = this.transicoes.get(sessionId);
    if (anterior) this.relogio.clearTimeout(anterior.timer);
    const timer = this.relogio.setTimeout(() => {
      if (this.transicoes.get(sessionId)?.timer !== timer) return;
      this.transicoes.delete(sessionId);
      this.endSession(sessionId, "Foi embora");
    }, Math.max(0, ate - this.now()));
    soltar(timer);
    this.transicoes.set(sessionId, { cwd, ate, timer });
  }

  /**
   * SessionStart source "clear": passa o time da sessão limpa há pouco (mesmo cwd) para a nova.
   * Os bonecos mantêm o id visual (o líder continua s:<sessão antiga>, via `lideres`), então a tela
   * não vê ninguém sair nem entrar. Eventos atrasados da conversa antiga passam a ser ignorados.
   */
  private herdarTime(input: HookInput): boolean {
    const novo = input.session_id;
    const abertas = [...this.transicoes].filter(([sessionId]) => sessionId !== novo);
    const antiga = this.escolherPorCwd(abertas, input.cwd, (t) => t.ate);
    if (antiga === undefined) return false;
    this.relogio.clearTimeout(this.transicoes.get(antiga)!.timer);
    this.transicoes.delete(antiga);
    this.transferirTime(antiga, novo);
    return true;
  }

  /** o time (líder com o id visual dele, subagentes, spawns pendentes) passa da sessão `antiga` para `novo` */
  private transferirTime(antiga: string, novo: string) {
    const visualLider = this.leaderId(antiga);
    this.lideres.delete(antiga);
    if (!this.agents.has(this.leaderId(novo))) {
      if (visualLider === this.sessionKey(novo)) this.lideres.delete(novo);
      else this.lideres.set(novo, visualLider);
    }
    for (const p of this.pending.values()) if (p.sessionId === antiga) p.sessionId = novo;
    this.lastSeen.delete(antiga);
    this.tasks.endSession(antiga); // conversa nova, lista nova
    this.retire(this.sessionKey(antiga));
    for (const a of this.agents.values()) {
      if (a.sessionId !== antiga) continue;
      a.sessionId = novo;
      this.emit({ type: "agent", agent: a });
    }
  }

  // ---------------------------------------------------------------- agentes

  /** id visual do líder da sessão (o herdado de um /clear mantém o id da sessão anterior) */
  private leaderId(sessionId: string) {
    return this.lideres.get(sessionId) ?? this.sessionKey(sessionId);
  }

  /** chave da sessão em `retired` */
  private sessionKey(sessionId: string) {
    return `s:${sessionId}`;
  }

  private ensureLeader(input: HookInput): Agent {
    let id = this.leaderId(input.session_id);
    let lead = this.agents.get(id);
    if (lead && lead.sessionId !== input.session_id) {
      // o id s:<sessão> ficou com o time herdado por outra conversa (/clear) e esta sessão voltou
      // (ex.: claude --resume da conversa antiga): ela ganha um líder com outro id
      id = `${this.sessionKey(input.session_id)}#${this.now()}`;
      this.lideres.set(input.session_id, id);
      lead = undefined;
    }
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
   * O agente "dono" do evento, só pela identidade: o subagente daquele agent_id (o mesmo boneco
   * a sessão inteira, mesmo depois do SubagentStop) ou, sem agent_id, o líder da sessão.
   * Devolve undefined para eventos atrasados de uma sessão encerrada: esses não recriam ninguém.
   */
  private agentFor(input: HookInput, { religa = true }: { religa?: boolean } = {}): Agent | undefined {
    if (input.agent_id) {
      // quem acabou de sair (visitante que entregou ou ficou sem sinal) ou de sessão encerrada:
      // evento tardio não recria nem retoma; só o SubagentStart reabre (ele limpa o `retired`)
      if (this.isRetired(input.agent_id)) return undefined;
      const sub = this.agentByAlias(input.agent_id);
      // acabou de dar SubagentStop: evento tardio (Pre/Permission...) não o retoma; só o SubagentStart
      const parou = this.paradoEm.get(input.agent_id);
      if (religa && sub && parou !== undefined && this.stopped.has(input.agent_id) && this.now() - parou < JANELA_TARDIO_MS) return undefined;
      // id já parado e sem boneco (reaproveitado ou removido): não cria fantasma
      if (!sub && parou !== undefined && this.now() - parou < PARADO_LEMBRA_MS) return undefined;
      if (sub) {
        // evento novo de quem já tinha entregue: voltou a trabalhar (o handler põe o status).
        // Com religa: false (PostToolUse), só identifica: não retoma quem parou
        if (religa) {
          if (this.stopped.delete(input.agent_id)) this.avisarChamadoDeNovo(sub, input.agent_id);
          this.chamadosDeNovo.delete(input.agent_id);
          this.revive(sub);
        }
        return sub;
      }
      // apareceu pelo próprio evento: ainda não foi casado com nenhum PreToolUse Agent
      const agent = this.bindSubagent(input.session_id, input.agent_id, String(input.agent_type ?? "general-purpose"), "", input.cwd);
      this.markAwaitingSpawn(agent, true);
      return agent;
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
   * O quanto um AGzinho está livre para um subagente novo:
   * - 0: ninguém na tela com ele (ou ele ocioso sem agent_id nenhum ligado);
   * - 1: ocioso, ligado só a agent_id que já entregaram (SubagentStop): reaproveitar só sem alternativa;
   * - null: não pode (AGzinho de líder, saindo, trabalhando ou ligado a um agent_id ativo).
   * Dois agent_id ativos nunca dividem boneco. A simulação não pega emprestado quem está numa sessão real.
   */
  private freeTier(key: string, sessionId: string): 0 | 1 | null {
    let tier: 0 | 1 = 0;
    for (const a of this.agents.values()) {
      if (a.agzinho !== key) continue;
      if (a.id !== subagentId(key)) return null; // é o AGzinho de um líder
      if (a.status !== "ocioso") return null; // trabalhando, chegando ou saindo
      if (isDemo(sessionId) && !isDemo(a.sessionId)) return null;
      for (const [alias, visual] of this.aliases) {
        if (visual !== a.id) continue;
        if (!this.stopped.has(alias)) return null; // agent_id ativo (ex.: ocioso por TeammateIdle)
        tier = 1;
      }
    }
    return tier;
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
    // o agent_id antigo que perde o boneco reaproveitado (o rebindAlias apaga o alias dele) ganha,
    // se voltar, outro AGzinho livre como qualquer agent_id novo
    const options = this.candidates(agentType, false).map((a) => ({ a, tier: this.freeTier(a.key, sessionId) }));
    // quem já está de boa nesta sessão só volta pra mesa; depois quem está livre de verdade; por
    // último o de boa de outra sessão (sempre na ordem de candidates(): principal, depois variações)
    // ("de boa nesta sessão" = no mesmo tipo: o curinga de um Plan não vira o general-purpose)
    const daSessao = (o: (typeof options)[number]) =>
      o.tier === 1 &&
      this.agents.get(subagentId(o.a.key))?.sessionId === sessionId &&
      this.bindings.get(subagentId(o.a.key))?.type === normalizeRole(agentType);
    const ag = (options.find(daSessao) ?? options.find((o) => o.tier === 0) ?? options.find((o) => o.tier === 1))?.a;
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
    const arrive = this.relogio.setTimeout(() => {
      this.arrivalTimers.delete(id);
      if (this.agents.get(id) === agent && agent.status === "chegando") {
        this.update(agent, "pensando", description ? agent.activity : "Pensando...");
      }
    }, ARRIVE_MS);
    soltar(arrive);
    this.arrivalTimers.set(id, arrive);
    return { agent, returning: false };
  }

  /** Liga um agent_id (ou t:<tool_use_id>) a um AGzinho e conta no feed quem chegou. */
  private bindSubagent(sessionId: string, alias: string, type: string, description: string, cwd?: string): Agent {
    const { agent, returning } = this.assignAgzinho(sessionId, type, alias, description, cwd);
    this.rebindAlias(agent, alias, type);
    const what = description ? `: ${truncate(description, 70)}` : "";
    this.pushFeed(agent, returning ? `foi chamado de novo${what}` : description ? `entrou para${what}` : "entrou no escritório", "spawn", {
      tipo: "chamado",
      deNovo: returning,
    });
    return agent;
  }

  /**
   * O agente passa a ouvir pelo `alias`; aliases antigos dele saem (o t:<tool_use_id> trocado pelo
   * agent_id, ou o agent_id que já entregou e cujo boneco foi reaproveitado).
   */
  private rebindAlias(agent: Agent, alias: string, type: string) {
    for (const [key, visual] of this.aliases) {
      if (visual !== agent.id || key === alias) continue;
      this.aliases.delete(key);
      this.stopped.delete(key);
    }
    this.aliases.set(alias, agent.id);
    this.stopped.delete(alias);
    this.bindings.set(agent.id, { type: normalizeRole(type), alias });
  }

  /**
   * Subagente que ia embora recebeu um SubagentStart de novo: cancela a saída (o evento comum de um
   * visitante que acabou de sair é barrado em agentFor pelo `retired`).
   * Quem está saindo porque a sessão acabou não chega aqui (a sessão encerrada é ignorada antes).
   */
  private revive(agent: Agent) {
    if (agent.status !== "saindo" || !agent.parentId) return;
    const t = this.removalTimers.get(agent.id);
    if (t) this.relogio.clearTimeout(t);
    this.removalTimers.delete(agent.id);
    agent.status = "pensando"; // o update não tira ninguém do "saindo"
    this.update(agent, "pensando", agent.activity);
  }

  /**
   * Fim do trabalho de um subagente: fica de boa no escritório e conta mais uma entrega. O alias
   * continua ligado (até o fim da sessão): se o líder retomar o agente, o mesmo boneco volta.
   */
  private finishWork(agent: Agent, alias: string) {
    this.emAndamento.delete(agent.id);
    this.paradoEm.set(alias, this.now());
    if (agent.status !== "saindo") {
      const today = dayKey(this.now());
      if (agent.tasksDay !== today) {
        agent.tasksDay = today;
        agent.tasksDone = 0;
      }
      agent.tasksDone += 1;
      if (ehVisitante(agent)) {
        // visitante (Iara, Jorge, Sofia ou extra) não fica: sai andando até a porta. "De boa" é só do
        // elenco fixo do time. O agent_id vai pra `retired`: evento tardio não o traz de volta
        this.sairVisitante(agent, "Entregou o trabalho");
      } else if (agent.agzinho) {
        this.update(agent, "ocioso", "De boa");
        this.pushFeed(agent, "entregou o trabalho", "done", { tipo: "terminouParte" });
      } else {
        // sem AGzinho livre e com papel do time: também não fica, senão acumula no escritório
        this.leave(agent, "Entregou o trabalho");
      }
    }
    this.stopped.add(alias);
    this.chamadosDeNovo.delete(alias);
  }

  /** Linha "foi chamado de novo" de quem tinha entregue e foi retomado: uma só por retomada. */
  private avisarChamadoDeNovo(agent: Agent, alias: string) {
    if (this.chamadosDeNovo.has(alias)) return;
    this.chamadosDeNovo.add(alias);
    this.pushFeed(agent, "foi chamado de novo", "spawn", { tipo: "chamado", deNovo: true });
  }

  private retire(alias: string, ms = RETIRE_MS) {
    this.retired.set(alias, this.now() + ms);
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
      this.markAwaitingSpawn(early, false);
      if (description) this.update(early, early.status, truncate(description, 60));
      return;
    }
    const timer = this.relogio.setTimeout(() => {
      const p = this.pending.get(toolUseId);
      if (!p) return;
      this.pending.delete(toolUseId);
      const late = this.recentSubagent(p.sessionId, p.type, askedAt);
      if (late) {
        this.markAwaitingSpawn(late, false);
        if (p.description) this.update(late, late.status, truncate(p.description, 60));
        return;
      }
      this.bindSubagent(p.sessionId, `t:${toolUseId}`, p.type, p.description, input.cwd);
    }, FALLBACK_SPAWN_MS);
    this.pending.set(toolUseId, { sessionId: input.session_id, type, description, timer });
  }

  private markAwaitingSpawn(agent: Agent, awaiting: boolean) {
    const b = this.bindings.get(agent.id);
    if (b) b.awaitingSpawn = awaiting;
  }

  /**
   * subagente desta sessão e tipo que chegou pelo SubagentStart (não pelo fallback) há pouco e
   * ainda não casou com nenhum "Agent" (awaitingSpawn): o "Agent" de outro do mesmo tipo, chamado
   * logo depois, não rouba quem já tem o seu
   */
  private recentSubagent(sessionId: string, type: string, since: number): Agent | undefined {
    const t = normalizeRole(type);
    return [...this.agents.values()].find((a) => {
      const b = this.bindings.get(a.id);
      return (
        a.parentId &&
        a.sessionId === sessionId &&
        b?.type === t &&
        b.awaitingSpawn === true &&
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

  /**
   * o "Agent" pendente deste Start: o do tool_use_id, se vier; senão (com `byType`) o mais antigo
   * do tipo (FIFO)
   */
  private takePending(sessionId: string, type: string, toolUseId?: string, byType = true): PendingSpawn | undefined {
    const own = toolUseId ? this.pending.get(toolUseId) : undefined;
    if (own && own.sessionId === sessionId) {
      this.relogio.clearTimeout(own.timer);
      this.pending.delete(toolUseId!);
      return own;
    }
    if (!byType) return undefined;
    for (const [key, p] of this.pending) {
      if (p.sessionId === sessionId && (p.type === type || normalizeRole(p.type) === normalizeRole(type))) {
        this.relogio.clearTimeout(p.timer);
        this.pending.delete(key);
        return p;
      }
    }
    return undefined;
  }

  private finishFallback(toolUseId: string) {
    const p = this.pending.get(toolUseId);
    if (p) {
      this.relogio.clearTimeout(p.timer);
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
    // o líder retoma um subagente pelo agent_id ({to: agent_id}): é o boneco ligado a ele
    const toAlias = String(toolInput.to ?? "");
    const byId = this.agentByAlias(toAlias);
    // quem já tinha entregue foi chamado de novo: a linha sai agora (o 1º evento dele não repete)
    if (byId && this.stopped.has(toAlias)) this.avisarChamadoDeNovo(byId, toAlias);
    const to = byId ?? all.find((a) => matches(a) && a.sessionId === from.sessionId) ?? all.find(matches);
    if (to) this.emit({ type: "chat", fromId: from.id, toId: to.id, text: truncate(text, 80) });
    this.pushFeed(from, `→ ${to?.name ?? (toName || "time")}: ${truncate(text, 80)}`, "message", {
      tipo: "recado",
      para: to ? this.nomeCurto(to) : undefined,
    });
  }

  /** `simples`: a atividade sem jargão; sem ela, a técnica serve se não tiver jargão (comSimples) */
  private update(agent: Agent, status: AgentStatus, activity: string, simples?: string) {
    if (simples) this.simplesDada.set(agent.id, { de: activity, simples });
    // quem está chegando continua "chegando" no front até sentar; o front decide a animação
    agent.status = agent.status === "saindo" ? "saindo" : status;
    agent.activity = activity;
    agent.updatedAt = this.now();
    this.emit({ type: "agent", agent });
  }

  private leave(agent: Agent, activity: string) {
    if (agent.status === "saindo") return;
    this.emAndamento.delete(agent.id);
    agent.status = "saindo";
    agent.activity = activity;
    agent.updatedAt = this.now();
    this.emit({ type: "agent", agent });
    this.pushFeed(agent, activity.toLowerCase(), "done", {
      tipo: "saiu",
      motivo: activity.startsWith("Entregou") ? "entregou" : /sem sinal/i.test(activity) ? "semSinal" : "embora",
    });
    const t = this.relogio.setTimeout(() => this.remove(agent.id), LEAVE_DELAY_MS);
    this.removalTimers.set(agent.id, t);
  }

  private remove(id: string) {
    const t = this.removalTimers.get(id);
    if (t) this.relogio.clearTimeout(t);
    this.removalTimers.delete(id);
    const arrive = this.arrivalTimers.get(id);
    if (arrive) this.relogio.clearTimeout(arrive);
    this.arrivalTimers.delete(id);
    const vigia = this.visitorTimers.get(id);
    if (vigia !== undefined) this.relogio.clearTimeout(vigia);
    this.visitorTimers.delete(id);
    const trabalho = this.trabalhoTimers.get(id);
    if (trabalho !== undefined) this.relogio.clearTimeout(trabalho);
    this.trabalhoTimers.delete(id);
    this.emAndamento.delete(id);
    for (const [alias, visual] of this.aliases) {
      if (visual !== id) continue;
      this.aliases.delete(alias);
      this.stopped.delete(alias);
      this.chamadosDeNovo.delete(alias);
    }
    this.simplesDada.delete(id);
    this.bindings.delete(id);
    for (const [sessionId, visual] of this.lideres) if (visual === id) this.lideres.delete(sessionId);
    if (this.agents.delete(id)) this.emit({ type: "remove", id });
  }

  // ---------------------------------------------------------------- feed

  /** Nome curto do feed simples: o apelido do AGzinho ("Guto") ou o primeiro nome. */
  private nomeCurto(agent: Agent): string {
    const ag = agent.agzinho ? this.findAgzinho(agent.agzinho) : undefined;
    return nomeCurto(agent.name, ag?.apelido);
  }

  /** `text` é a versão técnica; `assunto` gera a versão simples (server/frases.ts). */
  private pushFeed(agent: Agent, text: string, kind: FeedItem["kind"], assunto: Evento | { tipo: "ferramenta"; tool: string; input: Record<string, unknown> }) {
    const ag = agent.agzinho ? this.findAgzinho(agent.agzinho) : undefined;
    const quem = { genero: ag?.genero, papel: agent.role };
    const frase = assunto.tipo === "ferramenta" ? fraseFerramenta(assunto.tool, assunto.input, quem) : fraseEvento(assunto, quem);
    const item: FeedItem = {
      id: ++this.feedSeq,
      at: this.now(),
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      text,
      kind,
      simples: frase.simples,
      quem: nomeCurto(agent.name, ag?.apelido),
      categoria: frase.categoria,
      ...(frase.contaComo ? { contaComo: frase.contaComo } : {}),
    };
    this.feed.push(item);
    if (this.feed.length > FEED_LIMIT) this.feed.splice(0, this.feed.length - FEED_LIMIT);
    this.emit({ type: "feed", item });
  }

  /** Preenche activitySimples (balão, crachá e lista do time) a partir da atividade técnica atual. */
  private comSimples(agent: Agent): Agent {
    const dada = this.simplesDada.get(agent.id);
    agent.activitySimples = dada && dada.de === agent.activity ? dada.simples : simplificarAtividade(agent.activity, agent.status);
    return agent;
  }

  private emit(msg: ServerMessage) {
    if (msg.type === "agent") {
      this.comSimples(msg.agent);
      this.vigiarVisitante(msg.agent);
      this.vigiarTrabalho(msg.agent);
    }
    // quem cabe na tela é decidido antes de avisar: o agente novo já chega com a marca certa
    const mudaram = msg.type === "agent" || msg.type === "remove" ? this.reordenarVisitantes() : [];
    for (const fn of this.listeners) fn(msg);
    for (const a of mudaram) {
      if (msg.type === "agent" && msg.agent === a) continue;
      const aviso: ServerMessage = { type: "agent", agent: this.comSimples(a) };
      for (const fn of this.listeners) fn(aviso);
    }
    // status de agente muda a fase (reserva sem lista) e o "de boa"
    if (msg.type === "agent" || msg.type === "remove") this.refreshProgress();
  }

  /** Recalcula o quadro de etapas; manda {type:"progress"} só quando o valor muda. */
  private refreshProgress() {
    const { progress, proximaMudanca } = this.tasks.compute([...this.agents.values()], this.now());
    if (this.progressTimer) this.relogio.clearTimeout(this.progressTimer);
    this.progressTimer = null;
    if (proximaMudanca !== undefined) {
      // a lista concluída sai do quadro sozinha depois de um tempo
      this.progressTimer = this.relogio.setTimeout(() => this.refreshProgress(), Math.max(0, proximaMudanca - this.now()) + 10);
      soltar(this.progressTimer);
    }
    if (sameProgress(progress, this.progress)) return;
    const antes = this.progress;
    this.progress = progress;
    this.contarEtapa(antes, progress);
    for (const fn of this.listeners) fn({ type: "progress", progress });
  }

  /** Etapa concluída na lista do líder vira linha de destaque no feed (e a lista inteira, "trabalho concluído"). */
  private contarEtapa(antes: Progress, agora: Progress) {
    if (antes.fonte !== "tarefas" || agora.fonte !== "tarefas" || !agora.sessionId || antes.sessionId !== agora.sessionId) return;
    if (agora.concluidas <= antes.concluidas || agora.total === 0) return;
    const lead = this.agents.get(this.leaderId(agora.sessionId));
    if (!lead) return;
    if (agora.concluidas === agora.total) {
      this.pushFeed(lead, `concluiu as ${agora.total} etapas da lista`, "done", { tipo: "tudoConcluido", total: agora.total });
    } else {
      this.pushFeed(lead, `concluiu a etapa ${agora.concluidas} de ${agora.total}`, "done", { tipo: "etapa", etapa: agora.concluidas, total: agora.total });
    }
  }
}

const subagentId = (key: string) => `ag:${key}`;

const STATUS_VALIDOS = new Set<string>(["chegando", "trabalhando", "pensando", "esperando", "ocioso", "saindo"]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** agente salvo com os campos que o estado usa */
function agenteValido(x: unknown): x is Agent {
  return (
    isObj(x) &&
    typeof x.id === "string" &&
    typeof x.sessionId === "string" &&
    typeof x.name === "string" &&
    typeof x.role === "string" &&
    typeof x.status === "string" &&
    STATUS_VALIDOS.has(x.status) &&
    typeof x.activity === "string" &&
    typeof x.startedAt === "number" &&
    typeof x.updatedAt === "number" &&
    typeof x.boundAt === "number" &&
    typeof x.tasksDone === "number"
  );
}

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
