// Reprodutor dos eventos gravados pelo server/gravador.ts (data/eventos/AAAA-MM-DD.jsonl).
//
// Passa as linhas por um OfficeState novo com relógio virtual, na mesma ordem em que o
// server/index.ts processaria (fila segurando ~150 ms e ordenada por x-hook-ts), e devolve o
// estado final e a linha do tempo de status/atividade de cada AGzinho.
//
// O servidor esvazia a fila com polling de 50 ms: na vida real cada evento é processado até 50 ms
// depois do instante usado aqui (max(ts + 150, chegada)). A varredura de sessões roda a cada 60 s
// contados do boot, como no servidor.
//
// Os timers do OfficeState (chegada de 12 s, saída pela porta, fallback do spawn) rodam num
// RelogioVirtual injetado: o tempo só anda quando o replay manda, sem timers de verdade.
//
// CLI:
//   npm run replay -- data/eventos/2026-10-05.jsonl
//   npm run replay -- --anonimizar entrada.jsonl saida.jsonl

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Agent, AgentStatus, ServerMessage } from "../shared/types.ts";
import { DEFAULT_ROSTER, type Roster } from "../shared/roster.ts";
import type { LinhaGravada } from "./gravador.ts";
import { OfficeState, type HookInput, type Relogio, type Timer } from "./state.ts";

/** quanto o server/index.ts segura cada evento antes de processar (fila ordenada por x-hook-ts) */
const ATRASO_FILA_MS = 150;
/** a varredura de sessões sem sinal roda a cada minuto no servidor */
const VARREDURA_MS = 60_000;

export interface Mudanca {
  /** relógio virtual (ms) */
  t: number;
  /** id do agente no estado ("" no reinício do servidor) */
  id: string;
  nome: string;
  status: AgentStatus | "saiu" | "reiniciou";
  atividade: string;
}

export interface ReproduzirOpts {
  /** timeout de sessão sem sinal (padrão: o do OfficeState, 30 min) */
  sessionTimeoutMs?: number;
  /** elenco (padrão: DEFAULT_ROSTER) */
  roster?: Roster;
  /** depois da última linha, deixa o relógio correr mais esse tanto (ex.: ver quem sai pela porta) */
  depoisDoFimMs?: number;
  /**
   * Marcador servidor_iniciou: devolve o estado do servidor novo (padrão: um OfficeState vazio).
   * Os timers do anterior já foram cancelados (o processo morreu). Serve para a etapa 3 simular a
   * persistência; o estado criado deve usar o `relogio` recebido.
   */
  aoReiniciar?: (anterior: OfficeState, relogio: RelogioVirtual) => OfficeState;
  /**
   * Chamado com cada mensagem que o estado (virtual) emite, no instante `t` do relógio virtual: serve para o
   * replay do dia mandar ao painel o que mudou. O estado é novo e isolado: nada disso chega ao estado real.
   */
  aoMensagem?: (t: number, msg: ServerMessage) => void;
}

export interface Reproducao {
  state: OfficeState;
  linhaDoTempo: Mudanca[];
  /** o relógio do estado: avance com avancarAte() para continuar usando o estado depois */
  relogio: RelogioVirtual;
}

interface ItemFila {
  ts: number;
  seq: number;
  chegada: number;
  evento: unknown;
}

interface TimerVirtual {
  quando: number;
  fn: () => void;
}

/** Relógio e timers virtuais para o OfficeState: o tempo só anda em avancarAte(). */
export class RelogioVirtual implements Relogio {
  private timers = new Map<number, TimerVirtual>();
  private proximoId = 0;

  constructor(private t: number) {}

  now = (): number => this.t;

  setTimeout = (fn: () => void, ms: number): Timer => {
    const id = ++this.proximoId;
    this.timers.set(id, { quando: this.t + Math.max(0, ms), fn });
    return id;
  };

  clearTimeout = (timer: Timer): void => {
    if (typeof timer === "number") this.timers.delete(timer);
  };

  /** dispara, em ordem de instante (e de criação), os timers até `ate`, inclusive os criados no caminho */
  avancarAte(ate: number) {
    for (;;) {
      let proximo: [number, TimerVirtual] | undefined;
      for (const entrada of this.timers) {
        if (entrada[1].quando <= ate && (!proximo || entrada[1].quando < proximo[1].quando)) proximo = entrada;
      }
      if (!proximo) break;
      this.timers.delete(proximo[0]);
      this.t = Math.max(this.t, proximo[1].quando);
      proximo[1].fn();
    }
    this.t = Math.max(this.t, ate);
  }

  /** o processo morreu: nenhum timer pendente dispara mais */
  cancelarTodos() {
    this.timers.clear();
  }
}

/** Lê o .jsonl do gravador. Linha em branco e evento null são ignorados; linha inválida dá erro com o número dela. */
export function lerJsonl(texto: string): LinhaGravada[] {
  const linhas: LinhaGravada[] = [];
  texto.split(/\r?\n/).forEach((bruta, i) => {
    if (!bruta.trim()) return;
    let obj: unknown;
    try {
      obj = JSON.parse(bruta);
    } catch {
      throw new Error(`linha ${i + 1}: JSON inválido`);
    }
    if (!isObj(obj) || typeof obj.chegada !== "number") throw new Error(`linha ${i + 1}: sem "chegada"`);
    if (obj.marcador === "servidor_iniciou") linhas.push({ chegada: obj.chegada, marcador: "servidor_iniciou" });
    else if (!("evento" in obj)) throw new Error(`linha ${i + 1}: sem "evento" nem "marcador"`);
    // POST sem corpo: o servidor não faz nada com ele
    else if (obj.evento !== null) linhas.push({ chegada: obj.chegada, hookTs: typeof obj.hookTs === "number" ? obj.hookTs : null, evento: obj.evento });
  });
  return linhas;
}

/** Reproduz as linhas gravadas num OfficeState novo. Marcador servidor_iniciou recria o estado. */
export function reproduzir(linhas: readonly LinhaGravada[], opts: ReproduzirOpts = {}): Reproducao {
  return drenar(reproduzirPassos(linhas, opts));
}

/** Roda um gerador até o fim, sem ceder o event loop (uso síncrono: testes e CLI). */
export function drenar<T>(passos: Generator<void, T>): T {
  for (let r = passos.next(); ; r = passos.next()) if (r.done) return r.value;
}

/**
 * Roda um gerador até o fim cedendo o event loop a cada ~`fatiaMs` ms de trabalho: o servidor segue atendendo
 * os hooks enquanto um dia grande é reproduzido.
 */
export async function drenarCedendo<T>(passos: Generator<void, T>, fatiaMs = 8): Promise<T> {
  let inicio = performance.now();
  for (let r = passos.next(); ; r = passos.next()) {
    if (r.done) return r.value;
    if (performance.now() - inicio >= fatiaMs) {
      await new Promise<void>((ok) => setImmediate(ok));
      inicio = performance.now();
    }
  }
}

/** Mesmo que `reproduzir`, mas como gerador: cede (yield) depois de cada linha, para quem quiser fatiar o trabalho. */
export function* reproduzirPassos(linhas: readonly LinhaGravada[], opts: ReproduzirOpts = {}): Generator<void, Reproducao> {
  const relogio = new RelogioVirtual(linhas.length ? linhas[0].chegada : 0);
  const linhaDoTempo: Mudanca[] = [];
  const ultimo = new Map<string, string>();
  const nomes = new Map<string, string>();
  const fila: ItemFila[] = [];
  let seq = 0;
  let desligar = () => {};

  const estadoNovo = () => {
    const s = new OfficeState({ relogio, sweepEveryMs: 0, sessionTimeoutMs: opts.sessionTimeoutMs });
    s.setRoster(structuredClone(opts.roster ?? DEFAULT_ROSTER));
    return s;
  };

  /** liga a linha do tempo e a varredura de 60 s (o intervalo recomeça no boot, como no servidor) */
  const ligar = (s: OfficeState) => {
    desligar();
    ultimo.clear();
    const varrer = () => {
      s.sweep();
      relogio.setTimeout(varrer, VARREDURA_MS);
    };
    relogio.setTimeout(varrer, VARREDURA_MS);
    desligar = s.subscribe((msg) => {
      const t = relogio.now();
      if (opts.aoMensagem) {
        try {
          opts.aoMensagem(t, msg);
        } catch (err) {
          console.error("[replay] erro em aoMensagem:", err);
        }
      }
      if (msg.type === "agent") {
        const a = msg.agent;
        nomes.set(a.id, a.name);
        const assinatura = `${a.status}\u0000${a.activity}`;
        if (ultimo.get(a.id) === assinatura) return;
        ultimo.set(a.id, assinatura);
        linhaDoTempo.push({ t, id: a.id, nome: a.name, status: a.status, atividade: a.activity });
      } else if (msg.type === "remove") {
        ultimo.delete(msg.id);
        linhaDoTempo.push({ t, id: msg.id, nome: nomes.get(msg.id) ?? msg.id, status: "saiu", atividade: "" });
      }
    });
    return s;
  };

  let state = ligar(estadoNovo());

  /** processa, na ordem do servidor, o que já teria saído da fila até `limite` */
  const processarAte = (limite: number) => {
    while (fila.length) {
      fila.sort((a, b) => a.ts - b.ts || a.seq - b.seq);
      const item = fila[0];
      const quando = Math.max(item.ts + ATRASO_FILA_MS, item.chegada, relogio.now());
      if (quando > limite) return;
      fila.shift();
      relogio.avancarAte(quando);
      if (!isObj(item.evento)) continue;
      try {
        state.handleHook(item.evento as HookInput);
      } catch (err) {
        console.error("[replay] erro ao processar evento:", err);
      }
    }
  };

  for (const [i, linha] of linhas.entries()) {
    processarAte(linha.chegada);
    if ("marcador" in linha) {
      // o servidor anterior caiu: o que estava na fila é processado e os timers morrem com o processo
      processarAte(Infinity);
      relogio.avancarAte(linha.chegada);
      if (i === 0) continue; // o estado inicial já é o do primeiro boot
      relogio.cancelarTodos();
      desligar();
      state = ligar(opts.aoReiniciar ? opts.aoReiniciar(state, relogio) : estadoNovo());
      linhaDoTempo.push({ t: relogio.now(), id: "", nome: "(servidor)", status: "reiniciou", atividade: "Servidor reiniciou" });
      yield;
      continue;
    }
    const ts = Math.min(linha.hookTs || linha.chegada, linha.chegada);
    fila.push({ ts, seq: ++seq, chegada: linha.chegada, evento: linha.evento });
    yield;
  }
  processarAte(Infinity);
  if (opts.depoisDoFimMs && opts.depoisDoFimMs > 0) relogio.avancarAte(relogio.now() + opts.depoisDoFimMs);
  desligar();
  return { state, linhaDoTempo, relogio };
}

// ---------------------------------------------------------------- consultas (testes e CLI)

export function agentes(state: OfficeState): Agent[] {
  const snap = state.snapshot();
  return snap.type === "snapshot" ? snap.agents : [];
}

/** Agente pela key do AGzinho (ex.: "dev", "lider") ou pelo id no estado. */
export function agentePorKey(state: OfficeState, key: string): Agent | undefined {
  return agentes(state).find((a) => a.agzinho === key || a.id === key);
}

/** Agente pelo nome do AGzinho, primeiro nome ou apelido, sem diferenciar maiúsculas ("Bia", "Beatriz"). */
export function agentePorNome(state: OfficeState, nome: string): Agent | undefined {
  const alvo = nome.trim().toLowerCase();
  const roster = state.getRoster().agzinhos;
  return agentes(state).find((a) => {
    const ag = roster.find((r) => r.key === a.agzinho);
    const nomes = [a.name, a.name.split(" ")[0], ag?.apelido ?? ""].map((n) => n.toLowerCase());
    return nomes.includes(alvo);
  });
}

// ---------------------------------------------------------------- anonimizador

/** quantos textos diferentes um conjunto de rótulos guarda; depois disso, todo texto novo vira o rótulo genérico */
export const MAX_ROTULOS = 5000;

/**
 * troca textos por rótulos estáveis: o mesmo original vira sempre o mesmo "Prefixo N". Guarda só um hash curto do
 * original (nunca o texto) e tem teto de entradas, então POSTs forjados não fazem a memória crescer sem limite.
 */
export class Rotulos {
  private mapa = new Map<string, string>();
  constructor(
    private readonly fazer: (n: number, original: string) => string,
    private readonly generico: string,
    private readonly teto = MAX_ROTULOS,
  ) {}
  get tamanho(): number {
    return this.mapa.size;
  }
  de(original: unknown): string {
    const s = String(original ?? "");
    const chave = createHash("sha1").update(s.slice(0, 4096)).digest("hex").slice(0, 8);
    let r = this.mapa.get(chave);
    if (r === undefined) {
      if (this.mapa.size >= this.teto) return this.generico;
      r = this.fazer(this.mapa.size + 1, s);
      this.mapa.set(chave, r);
    }
    return r;
  }
}

const ID_SEGURO = /^[\w.:-]{1,40}$/;
const EXTENSAO_SEGURA = /^\.[A-Za-z0-9]{1,8}$/;

/** id/tipo curto só com letras, números e _ . : - (até 40); o resto vira `generico` */
function curto(v: unknown, generico: string): string {
  return typeof v === "string" && ID_SEGURO.test(v) ? v : generico;
}

/** número e booleano passam; texto só se tiver cara de identificador curto */
function escalar(v: unknown): string | number | boolean {
  return typeof v === "number" || typeof v === "boolean" ? v : curto(v, "outro");
}

/** identificador que o estado usa como chave (sessão, agente, tool_use): fora do padrão vira um hash estável */
function idEstavel(v: unknown): string {
  if (typeof v === "string" && ID_SEGURO.test(v)) return v;
  return `id-${createHash("sha1").update(String(v).slice(0, 4096)).digest("hex").slice(0, 8)}`;
}

/** o nome da ferramenta MCP (mcp__servidor__ferramenta) pode revelar cliente/serviço: só o prefixo fica */
function ferramentaSegura(v: unknown): string {
  const s = typeof v === "string" ? v : "";
  if (s.startsWith("mcp__")) return "mcp__*";
  return curto(s, "Ferramenta");
}

/** campos do evento que o state/progress leem e que não têm texto da pessoa: passam iguais */
const CAMPOS_MANTIDOS = [
  "hook_event_name",
  "session_id",
  "agent_id",
  "agent_type",
  "tool_name",
  "tool_use_id",
  "source",
  "notification_type",
  "matcher",
] as const;

/**
 * Cópia anonimizada das linhas: só os campos que o escritório lê; cwd vira "/projeto", caminhos
 * viram "arquivo-N.ext", comandos/prompts/descrições/mensagens viram textos genéricos e as listas
 * de tarefas mantêm status e estrutura com os assuntos trocados por "Tarefa N".
 */
export function anonimizar(linhas: readonly LinhaGravada[]): LinhaGravada[] {
  const r = criarRotulos();
  return linhas.map((linha) => {
    if ("marcador" in linha) return { ...linha };
    return { chegada: linha.chegada, hookTs: linha.hookTs, evento: isObj(linha.evento) ? anonimizarEvento(linha.evento, r) : null };
  });
}

/** Rótulos estáveis para um conjunto de eventos (o mesmo arquivo vira sempre o mesmo "arquivo-N"). */
export function criarRotulos(): RotulosAnon {
  return {
    arquivo: new Rotulos((n, orig) => {
      const ext = path.extname(orig);
      return `arquivo-${n}${EXTENSAO_SEGURA.test(ext) ? ext : ""}`;
    }, "arquivo-?"),
    tarefa: new Rotulos((n) => `Tarefa ${n}`, "Tarefa ?"),
    pedido: new Rotulos((n) => `Pedido ${n}`, "Pedido ?"),
    descricao: new Rotulos((n) => `Descrição ${n}`, "Descrição ?"),
    comando: new Rotulos((n) => `Comando ${n}`, "Comando ?"),
    padrao: new Rotulos((n) => `padrão ${n}`, "padrão ?"),
    busca: new Rotulos((n) => `Busca ${n}`, "Busca ?"),
    mensagem: new Rotulos((n) => `Mensagem ${n}`, "Mensagem ?"),
  };
}

/**
 * Versão ENXUTA do evento para o resumo do dia (server/resumoDia.ts): o anonimizar, mais: sem prompt, sem
 * user_prompt, sem busca/padrão/URL/mensagem de SendMessage. Fica só estrutura e identificadores curtos.
 */
export function enxugarEvento(ev: Record<string, unknown>, r: RotulosAnon): Record<string, unknown> {
  const out = anonimizarEvento(ev, r);
  delete out.prompt;
  delete out.user_prompt;
  if (isObj(out.tool_input)) {
    for (const c of ["pattern", "query", "url", "message", "content", "text"]) delete out.tool_input[c];
  }
  return out;
}

export type RotulosAnon = Record<"arquivo" | "tarefa" | "pedido" | "descricao" | "comando" | "padrao" | "busca" | "mensagem", Rotulos>;

function anonimizarEvento(ev: Record<string, unknown>, r: RotulosAnon): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const campo of CAMPOS_MANTIDOS) if (ev[campo] !== undefined) out[campo] = campoMantido(campo, ev[campo]);
  if (ev.cwd !== undefined) out.cwd = "/projeto";
  if (ev.user_prompt !== undefined) out.user_prompt = r.pedido.de(ev.user_prompt);
  if (ev.prompt !== undefined) out.prompt = r.pedido.de(ev.prompt);
  if (ev.message !== undefined) out.message = mensagemGenerica(String(ev.message));
  const tool = String(ev.tool_name ?? "");
  if (isObj(ev.tool_input)) out.tool_input = anonimizarToolInput(tool, ev.tool_input, r);
  const resp = anonimizarResposta(tool, ev.tool_response);
  if (resp !== undefined) out.tool_response = resp;
  return out;
}

/** os campos "mantidos" não são texto da pessoa, mas vêm do corpo do POST: só passa o que tem cara de identificador */
function campoMantido(campo: (typeof CAMPOS_MANTIDOS)[number], v: unknown): string {
  switch (campo) {
    case "session_id":
    case "agent_id":
    case "tool_use_id":
      return idEstavel(v);
    case "tool_name":
      return ferramentaSegura(v);
    default:
      return curto(v, "outro");
  }
}

/** a Notification sem notification_type é classificada pelo texto: mantém só a classe */
function mensagemGenerica(msg: string): string {
  if (/waiting for your input/i.test(msg)) return "Claude is waiting for your input";
  if (/permiss/i.test(msg)) return "Claude needs your permission";
  if (/needs your|precisa de voc/i.test(msg)) return "Claude needs your attention";
  return msg ? "Aviso" : "";
}

function anonimizarToolInput(tool: string, ti: Record<string, unknown>, r: RotulosAnon): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const copiar = (...campos: string[]) => {
    for (const c of campos) if (ti[c] !== undefined) out[c] = escalar(ti[c]);
  };
  switch (tool) {
    case "Agent":
    case "Task":
      copiar("subagent_type", "name");
      if (ti.description !== undefined) out.description = r.descricao.de(ti.description);
      break;
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
      if (ti.file_path !== undefined) out.file_path = r.arquivo.de(ti.file_path);
      break;
    case "NotebookEdit":
      if (ti.notebook_path !== undefined) out.notebook_path = r.arquivo.de(ti.notebook_path);
      break;
    case "Bash":
      // sem o comando: a descrição genérica é o que aparece no balão
      out.description = r.comando.de(ti.description ?? ti.command);
      break;
    case "Grep":
    case "Glob":
      if (ti.pattern !== undefined) out.pattern = r.padrao.de(ti.pattern);
      break;
    case "WebSearch":
      if (ti.query !== undefined) out.query = r.busca.de(ti.query);
      break;
    case "WebFetch":
      out.url = "https://exemplo.invalid/";
      break;
    case "Skill":
      copiar("skill", "name");
      break;
    case "SendMessage":
      copiar("to", "recipient", "name");
      for (const c of ["message", "content", "text"]) if (ti[c] !== undefined) out[c] = r.mensagem.de(ti[c]);
      break;
    case "TodoWrite":
      if (Array.isArray(ti.todos)) {
        out.todos = ti.todos.map((t) => {
          if (!isObj(t)) return null;
          const assunto = r.tarefa.de(t.content ?? t.subject);
          const item: Record<string, unknown> = { content: assunto, status: escalar(t.status) };
          if (t.activeForm !== undefined || t.active_form !== undefined) item.activeForm = `Fazendo ${assunto.toLowerCase()}`;
          return item;
        });
      }
      break;
    case "TaskCreate":
    case "TaskUpdate": {
      copiar("taskId", "id", "task_id", "status");
      const assunto = ti.subject ?? (tool === "TaskCreate" ? ti.description : undefined);
      if (assunto !== undefined) out.subject = r.tarefa.de(assunto);
      if (tool === "TaskCreate" && ti.description !== undefined) out.description = r.tarefa.de(ti.description);
      if (ti.activeForm !== undefined || ti.active_form !== undefined) out.activeForm = `Fazendo ${r.tarefa.de(assunto).toLowerCase()}`;
      break;
    }
    default:
      // AskUserQuestion, mcp__* e o resto: o escritório não lê nada do tool_input
      break;
  }
  return out;
}

/** só TaskCreate/TaskUpdate leem a resposta (o id da tarefa e se deu certo) */
function anonimizarResposta(tool: string, resp: unknown): unknown {
  if ((tool !== "TaskCreate" && tool !== "TaskUpdate") || !isObj(resp)) return undefined;
  const out: Record<string, unknown> = {};
  if (isObj(resp.task) && resp.task.id !== undefined) out.task = { id: escalar(resp.task.id) };
  for (const c of ["taskId", "id", "success"]) if (resp[c] !== undefined) out[c] = escalar(resp[c]);
  return out;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------- CLI

function hora(ms: number): string {
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

function cli(args: string[]): number {
  if (args[0] === "--anonimizar") {
    const [, entrada, saida] = args;
    if (!entrada || !saida) {
      console.error("uso: npm run replay -- --anonimizar <entrada.jsonl> <saida.jsonl>");
      return 1;
    }
    const linhas = anonimizar(lerJsonl(fs.readFileSync(entrada, "utf8")));
    fs.writeFileSync(saida, linhas.map((l) => JSON.stringify(l)).join("\n") + "\n");
    console.log(`${linhas.length} linhas anonimizadas em ${saida}`);
    return 0;
  }
  const arquivo = args[0];
  if (!arquivo) {
    console.error("uso: npm run replay -- <arquivo.jsonl>  |  npm run replay -- --anonimizar <entrada> <saida>");
    return 1;
  }
  const { state, linhaDoTempo } = reproduzir(lerJsonl(fs.readFileSync(arquivo, "utf8")));
  console.log("Linha do tempo:");
  for (const m of linhaDoTempo) {
    console.log(`  ${hora(m.t)} ${m.nome}: ${m.status}${m.atividade ? ` · ${m.atividade}` : ""}`);
  }
  console.log("\nEstado final:");
  const lista = agentes(state);
  if (!lista.length) console.log("  (escritório vazio)");
  for (const a of lista) console.log(`  ${a.name} [${a.agzinho ?? a.id}]: ${a.status} · ${a.activity}`);
  const p = state.getProgress();
  if (p.fonte !== "nada") console.log(`  Quadro: ${p.titulo} (${p.concluidas}/${p.total})`);
  return 0;
}

const diretamente = process.argv[1] !== undefined && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (diretamente) process.exitCode = cli(process.argv.slice(2));
