// Quadro de etapas: transforma a lista de tarefas do Claude Code (TodoWrite ou TaskCreate/TaskUpdate,
// que chegam pelos hooks) no "AGzinhos na Etapa X de Y". Sem lista, deduz a fase pelo papel de quem
// está trabalhando; sem ninguém trabalhando, o time está de boa.
//
// Formato real dos eventos (capturado com os hooks, ver server/fixtures/):
// - TodoWrite: tool_input.todos[] = { content, status: pending|in_progress|completed, activeForm? };
//   a lista inteira vem a cada chamada (o Post traz também tool_response.oldTodos/newTodos).
// - TaskCreate: tool_input = { subject, description, activeForm? }; o id só vem no PostToolUse,
//   em tool_response.task.id (ids "1", "2"... por sessão).
// - TaskUpdate: tool_input = { taskId, status?, subject?, activeForm? } (o modelo às vezes manda id ou
//   task_id); status inclui "deleted". O Post traz tool_response { success, taskId, statusChange }.
//
// Quem mexe na lista:
// - TodoWrite só vale do líder (sem agent_id): cada agente tem a própria lista de todos, e a de um
//   subagente substituiria a do líder inteira.
// - TaskCreate/TaskUpdate valem do líder e dos subagentes: a lista de Tasks é uma só por sessão.
// - TaskCreate aparece já no Pre (pendente pelo tool_use_id) e ganha o id no Post; pendente sem Post
//   some em PENDENTE_MS ou no Stop do líder. TaskCreate vazio (sem subject nem description) é ignorado.
// - TaskUpdate só vale no Post com sucesso (o Pre pode falhar).
// - Um TaskCreate numa lista já 100% concluída começa uma lista nova.
//
// Módulo puro: sem timers nem I/O. O relógio vem de quem chama (server/state.ts).

import type { Agent, Progress } from "../shared/types.ts";
import { ehVisitante } from "../shared/visitante.ts";

export type { Progress } from "../shared/types.ts";

/** lista 100% concluída fica no quadro ("concluíram N de N") por esse tempo e depois sai */
export const DONE_HOLD_MS = 2 * 60_000;

/** TaskCreate visto no Pre e sem Post sai do quadro depois disso */
export const PENDENTE_MS = 60_000;

/**
 * Na escolha da sessão, a que tem lista de tarefas leva essa vantagem sobre a que só tem gente
 * trabalhando: com duas sessões ativas, o quadro não fica pulando de uma pra outra a cada evento,
 * e uma lista parada há mais que isso perde pra quem está trabalhando agora.
 */
export const LISTA_PREFERIDA_MS = 5 * 60_000;

/** fase de cada papel na reserva sem lista de tarefas */
export const FASE_DO_PAPEL: Record<string, string> = {
  planejador: "Planejamento",
  pesquisador: "Pesquisa",
  dev: "Construção",
  testador: "Testes",
  revisor: "Revisão",
  documentador: "Documentação",
};
/** líder (ou convidado que lidera uma 2ª sessão) trabalhando sem nenhum papel do time ativo; visitantes não contam */
export const FASE_GERAL = "Ação";

export const PROGRESS_NADA: Progress = { fonte: "nada", etapa: 0, total: 0, concluidas: 0, titulo: "" };

/** ferramentas de lista de tarefas do Claude Code */
export const TASK_TOOLS: ReadonlySet<string> = new Set(["TodoWrite", "TaskCreate", "TaskUpdate"]);

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

interface Task {
  subject: string;
  activeForm?: string;
  status: TaskStatus;
}

interface Pendente extends Task {
  /** quando o Pre chegou */
  at: number;
}

interface SessionTasks {
  /** TodoWrite: a lista inteira, na ordem (substituída a cada chamada) */
  todos: Task[] | null;
  /** TaskCreate/TaskUpdate: id → tarefa (na ordem de criação) */
  tasks: Map<string, Task>;
  /** TaskCreate cujo id ainda não chegou: tool_use_id → tarefa */
  pendentes: Map<string, Pendente>;
  /** TaskCreate já resolvido no Post: tool_use_id → quando (um Pre atrasado não cria pendente de novo) */
  resolvidos: Map<string, number>;
  /** último evento de tarefa da sessão */
  lastAt: number;
  /** quando a lista ficou 100% concluída (undefined enquanto não estiver) */
  doneAt?: number;
}

/** As listas de tarefas em JSON puro (data/escritorio.json). */
export type TarefasSalvas = {
  sessionId: string;
  todos: Task[] | null;
  tasks: [string, Task][];
  pendentes: [string, Pendente][];
  resolvidos: [string, number][];
  lastAt: number;
  doneAt?: number;
}[];

/** Só o que o rastreador lê do evento de hook. */
export interface ProgressHook {
  hook_event_name: string;
  session_id: string;
  /** preenchido quando o evento vem de dentro de um subagente */
  agent_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  tool_response?: unknown;
}

/** quem conta como "na tarefa" para a fase */
const ATIVO = new Set<Agent["status"]>(["trabalhando", "pensando", "esperando"]);

export class ProgressTracker {
  private sessions = new Map<string, SessionTasks>();

  /** Processa um evento. Devolve true se a lista de alguma sessão mudou. */
  handle(input: ProgressHook, now: number): boolean {
    if (!input.session_id) return false;
    const ev = input.hook_event_name;
    // Stop do líder: o turno acabou, TaskCreate sem Post não vai mais chegar
    if (ev === "Stop" && !input.agent_id) {
      const s = this.sessions.get(input.session_id);
      if (!s?.pendentes.size) return false;
      s.pendentes.clear();
      marcarConcluida(s, now);
      return true;
    }
    const tool = input.tool_name;
    if (!tool || !TASK_TOOLS.has(tool)) return false;
    if (ev !== "PreToolUse" && ev !== "PostToolUse" && ev !== "PostToolUseFailure") return false;
    // a lista de todos de um subagente é dele: não substitui a do líder
    if (tool === "TodoWrite" && input.agent_id) return false;
    const ti = input.tool_input ?? {};
    const s = this.session(input.session_id);
    const before = signature(s);
    expirar(s, now);

    if (tool === "TodoWrite") {
      if (ev === "PostToolUseFailure") return false;
      const raw = Array.isArray(ti.todos) ? ti.todos : null;
      if (!raw) return false;
      s.todos = raw.map(toTodo).filter((t): t is Task => t !== null);
    } else if (tool === "TaskCreate") {
      this.taskCreate(s, ev, ti, input.tool_use_id, input.tool_response, now);
    } else {
      this.taskUpdate(s, ev, ti, input.tool_response);
    }

    s.lastAt = now;
    marcarConcluida(s, now);
    return signature(s) !== before;
  }

  endSession(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  reset() {
    this.sessions.clear();
  }

  /** As listas de todas as sessões, em JSON puro (persistência do estado). */
  serializar(): TarefasSalvas {
    return [...this.sessions].map(([id, s]) => ({
      sessionId: id,
      todos: s.todos,
      tasks: [...s.tasks],
      pendentes: [...s.pendentes],
      resolvidos: [...s.resolvidos],
      lastAt: s.lastAt,
      doneAt: s.doneAt,
    }));
  }

  /**
   * Troca as listas pelas salvas (só das sessões aceitas por `manter`). Entrada inválida é
   * descartada item por item; nunca lança.
   */
  restaurar(dados: unknown, manter: (sessionId: string) => boolean = () => true) {
    this.sessions.clear();
    if (!Array.isArray(dados)) return;
    for (const raw of dados) {
      if (!isObj(raw) || typeof raw.sessionId !== "string" || !manter(raw.sessionId)) continue;
      const tasks = new Map<string, Task>();
      for (const [k, t] of pares(raw.tasks)) {
        const task = taskSalva(t);
        if (task) tasks.set(k, task);
      }
      const pendentes = new Map<string, Pendente>();
      for (const [k, p] of pares(raw.pendentes)) {
        const task = taskSalva(p);
        if (task && isObj(p) && typeof p.at === "number") pendentes.set(k, { ...task, at: p.at });
      }
      const resolvidos = new Map<string, number>();
      for (const [k, at] of pares(raw.resolvidos)) if (typeof at === "number") resolvidos.set(k, at);
      const todos = Array.isArray(raw.todos) ? raw.todos.map(taskSalva).filter((t): t is Task => t !== null) : null;
      this.sessions.set(raw.sessionId, {
        todos,
        tasks,
        pendentes,
        resolvidos,
        lastAt: typeof raw.lastAt === "number" ? raw.lastAt : 0,
        doneAt: typeof raw.doneAt === "number" ? raw.doneAt : undefined,
      });
    }
  }

  /**
   * Progresso a mostrar. Vem da sessão com o evento mais recente entre as que têm algo a mostrar
   * (lista de tarefas válida ou alguém ativo); a lista ganha LISTA_PREFERIDA_MS de vantagem.
   * `proximaMudanca`: quando o valor muda sozinho (lista concluída saindo do quadro, pendente
   * expirando), pra quem chama agendar um refresh.
   */
  compute(agents: Agent[], now: number): { progress: Progress; proximaMudanca?: number } {
    const ultimo = new Map<string, number>();
    const ativos = new Map<string, Agent[]>();
    for (const a of agents) {
      // visitante não conta na fase nem serve de pool (passa pouco tempo e não é do time)
      if (a.status === "saindo" || ehVisitante(a)) continue;
      ultimo.set(a.sessionId, Math.max(ultimo.get(a.sessionId) ?? 0, a.updatedAt));
      if (ATIVO.has(a.status) || (a.status === "chegando" && a.parentId)) {
        const list = ativos.get(a.sessionId) ?? [];
        list.push(a);
        ativos.set(a.sessionId, list);
      }
    }

    let melhor: { at: number; progress: Progress; proximaMudanca?: number } | null = null;
    const sessionIds = new Set([...this.sessions.keys(), ...ativos.keys()]);
    for (const sessionId of sessionIds) {
      const s = this.sessions.get(sessionId);
      const lista = s ? this.daLista(s, sessionId, now) : null;
      const papel = lista ? null : daFase(ativos.get(sessionId) ?? [], sessionId);
      const progress = lista?.progress ?? papel;
      if (!progress) continue;
      const at = Math.max(s?.lastAt ?? 0, ultimo.get(sessionId) ?? 0) + (lista ? LISTA_PREFERIDA_MS : 0);
      if (!melhor || at > melhor.at) melhor = { at, progress, proximaMudanca: lista?.proximaMudanca };
    }
    return melhor ? { progress: melhor.progress, proximaMudanca: melhor.proximaMudanca } : { progress: PROGRESS_NADA };
  }

  // ------------------------------------------------------------ TaskCreate / TaskUpdate

  private taskCreate(s: SessionTasks, ev: string, ti: Record<string, unknown>, toolUseId: string | undefined, response: unknown, now: number) {
    const key = toolUseId ?? "";
    if (ev === "PostToolUseFailure") {
      s.pendentes.delete(key);
      return;
    }
    const subject = str(ti.subject) || str(ti.description);
    if (!subject) return; // TaskCreate vazio não é uma tarefa
    // a lista anterior está toda concluída: este TaskCreate começa uma rodada nova
    if (s.doneAt !== undefined && !s.todos) {
      s.tasks.clear();
      s.pendentes.clear();
      s.doneAt = undefined;
    }
    const nova: Pendente = { subject, activeForm: activeFormOf(ti), status: "pending", at: now };
    if (ev === "PreToolUse") {
      // Post deste tool_use_id já processado (fora de ordem): a tarefa já está na lista
      if (key && !s.resolvidos.has(key)) s.pendentes.set(key, nova);
      return;
    }
    // PostToolUse: o id chegou
    const id = idDaResposta(response);
    if (!id) {
      // sem id na resposta: continua contando como pendente (e expira como as outras)
      if (key && !s.pendentes.has(key)) s.pendentes.set(key, nova);
      return;
    }
    if (key) s.resolvidos.set(key, now);
    const pend: Task = (key && s.pendentes.get(key)) || nova;
    s.pendentes.delete(key);
    const ja = s.tasks.get(id);
    if (ja) {
      // um TaskUpdate deste id chegou antes do Post do TaskCreate: mantém o status dele
      ja.subject ||= pend.subject;
      ja.activeForm ??= pend.activeForm;
    } else {
      s.tasks.set(id, { subject: pend.subject, activeForm: pend.activeForm, status: pend.status });
    }
  }

  private taskUpdate(s: SessionTasks, ev: string, ti: Record<string, unknown>, response: unknown) {
    // só o Post com sucesso vale: o Pre pode falhar (PostToolUseFailure) e aí nada mudou
    if (ev !== "PostToolUse") return;
    const r = isObj(response) ? response : {};
    if (r.success === false) return;
    const id = str(ti.taskId) || str(ti.id) || str(ti.task_id) || str(r.taskId);
    if (!id) return;
    let task = s.tasks.get(id);
    if (!task) {
      // o TaskCreate dela ainda não chegou (fora de ordem): cria e ele completa o assunto depois
      task = { subject: "", status: "pending" };
      s.tasks.set(id, task);
    }
    const status = toStatus(ti.status);
    if (status) task.status = status;
    if (str(ti.subject)) task.subject = str(ti.subject);
    const af = activeFormOf(ti);
    if (af) task.activeForm = af;
  }

  // ------------------------------------------------------------ cálculo

  private session(id: string): SessionTasks {
    let s = this.sessions.get(id);
    if (!s) {
      s = { todos: null, tasks: new Map(), pendentes: new Map(), resolvidos: new Map(), lastAt: 0 };
      this.sessions.set(id, s);
    }
    return s;
  }

  private daLista(s: SessionTasks, sessionId: string, now: number): { progress: Progress; proximaMudanca?: number } | null {
    const lista = listaDe(s, now);
    if (!lista.length) return null;
    const total = lista.length;
    const concluidas = lista.filter((t) => t.status === "completed").length;
    // a próxima pendente sem Post a expirar muda o total sozinha
    const expira = s.todos ? [] : [...s.pendentes.values()].map((p) => p.at + PENDENTE_MS).filter((t) => t > now);
    const proxima = expira.length ? Math.min(...expira) : undefined;
    if (concluidas === total) {
      // concluída: "AGzinhos concluíram N de N" por um tempo, depois volta pra fase ou "de boa"
      const ate = (s.doneAt ?? s.lastAt) + DONE_HOLD_MS;
      if (now >= ate) return null;
      return { progress: { fonte: "tarefas", etapa: total, total, concluidas, titulo: "", sessionId }, proximaMudanca: ate };
    }
    const iAtual = lista.findIndex((t) => t.status === "in_progress");
    const etapa = iAtual >= 0 ? iAtual + 1 : Math.min(concluidas + 1, total);
    const atual = iAtual >= 0 ? lista[iAtual] : lista.find((t) => t.status === "pending");
    const titulo = atual ? (iAtual >= 0 && atual.activeForm ? atual.activeForm : atual.subject) : "";
    return { progress: { fonte: "tarefas", etapa, total, concluidas, titulo, sessionId }, proximaMudanca: proxima };
  }
}

/** Fase pelo papel ativo mais recente (papéis do time primeiro); null se ninguém está ativo. */
function daFase(ativos: Agent[], sessionId: string): Progress | null {
  if (!ativos.length) return null;
  const doTime = ativos.filter((a) => FASE_DO_PAPEL[a.role]);
  const pool = doTime.length ? doTime : ativos;
  const recente = pool.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
  return { fonte: "papel", etapa: 0, total: 0, concluidas: 0, titulo: FASE_DO_PAPEL[recente.role] ?? FASE_GERAL, sessionId };
}

/** tarefas visíveis da sessão, na ordem: TodoWrite manda; senão as Tasks (por id) + as pendentes ainda válidas */
function listaDe(s: SessionTasks, now: number): Task[] {
  if (s.todos) return s.todos.filter((t) => t.status !== "deleted");
  const tasks = [...s.tasks.entries()].sort(([a], [b]) => compareIds(a, b)).map(([, t]) => t);
  const pendentes = [...s.pendentes.values()].filter((p) => now - p.at < PENDENTE_MS);
  return [...tasks, ...pendentes].filter((t) => t.status !== "deleted");
}

/** tira as pendentes sem Post e os tool_use_id resolvidos antigos */
function expirar(s: SessionTasks, now: number) {
  for (const [k, p] of s.pendentes) if (now - p.at >= PENDENTE_MS) s.pendentes.delete(k);
  for (const [k, at] of s.resolvidos) if (now - at >= PENDENTE_MS) s.resolvidos.delete(k);
}

/** guarda quando a lista ficou 100% concluída (pro "concluíram N de N" sair depois de um tempo) */
function marcarConcluida(s: SessionTasks, now: number) {
  const lista = listaDe(s, now);
  const concluidas = lista.filter((t) => t.status === "completed").length;
  if (lista.length > 0 && concluidas === lista.length) s.doneAt ??= now;
  else s.doneAt = undefined;
}

/** só o que aparece no quadro (o horário das pendentes não entra) */
function signature(s: SessionTasks): string {
  return JSON.stringify([s.todos, [...s.tasks], [...s.pendentes].map(([k, p]) => [k, p.subject, p.activeForm, p.status])]);
}

/** ids numéricos ("2" antes de "10"); outros na ordem do texto */
function compareIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

function toTodo(raw: unknown): Task | null {
  if (!isObj(raw)) return null;
  const status = toStatus(raw.status) ?? "pending";
  return { subject: str(raw.content) || str(raw.subject), activeForm: activeFormOf(raw), status };
}

function toStatus(v: unknown): TaskStatus | undefined {
  return v === "pending" || v === "in_progress" || v === "completed" || v === "deleted" ? v : undefined;
}

function activeFormOf(o: Record<string, unknown>): string | undefined {
  return str(o.activeForm) || str(o.active_form) || undefined;
}

function idDaResposta(response: unknown): string {
  if (!isObj(response)) return "";
  const task = response.task;
  return (isObj(task) && str(task.id)) || str(response.taskId) || str(response.id);
}

/** tarefa como foi salva ({ subject, activeForm?, status }); inválida → null */
function taskSalva(raw: unknown): Task | null {
  if (!isObj(raw) || typeof raw.subject !== "string") return null;
  const status = toStatus(raw.status);
  if (!status) return null;
  return { subject: raw.subject, activeForm: typeof raw.activeForm === "string" ? raw.activeForm : undefined, status };
}

/** [chave, valor][] salvo; o que não for par com chave texto fica de fora */
function pares(v: unknown): [string, unknown][] {
  if (!Array.isArray(v)) return [];
  return v.filter((p): p is [string, unknown] => Array.isArray(p) && p.length === 2 && typeof p[0] === "string");
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

/** dois progressos iguais (pra só mandar pelo WS quando mudar) */
export function sameProgress(a: Progress, b: Progress): boolean {
  return (
    a.fonte === b.fonte &&
    a.etapa === b.etapa &&
    a.total === b.total &&
    a.concluidas === b.concluidas &&
    a.titulo === b.titulo &&
    a.sessionId === b.sessionId
  );
}
