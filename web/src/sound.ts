import type { AgentStatus } from "../../shared/types";

/** Som que uma mudança de estado pede (null = silêncio). */
export type SomEvento = "atencao" | "ding";

/** O que a decisão precisa de um agente: o status e o contador de tarefas entregues. */
export interface EstadoSom {
  status: AgentStatus;
  tasksDone: number;
}

/**
 * Decide o som de uma transição. Pura (sem navegador). `prev` indefinido = agente que acabou de
 * aparecer no snapshot inicial ou numa reconexão: não toca nada. "te esperando" novo chama a
 * atenção; um tasksDone maior (mesmo critério da comemoração no engine) é o "ding" de concluído.
 */
export function somDaTransicao(prev: EstadoSom | undefined, next: EstadoSom, ativo = true): SomEvento | null {
  if (!ativo || !prev) return null;
  if (next.status === "esperando" && prev.status !== "esperando") return "atencao";
  if (next.tasksDone > prev.tasksDone && next.tasksDone > 0 && next.status !== "saindo") return "ding";
  return null;
}

/**
 * Entre os agentes que mudaram no mesmo lote, qual som tocar: o "!" vence o ding; sem eventos, nada.
 */
export function eventoDoLote(eventos: readonly (SomEvento | null)[]): SomEvento | null {
  if (eventos.includes("atencao")) return "atencao";
  return eventos.includes("ding") ? "ding" : null;
}

const VOLUME_MESTRE = 0.12;
/** cliques de teclado agregados: no máximo ~4 por segundo no total */
export const INTERVALO_TECLADO_MS = 250;

type Ctor = typeof AudioContext;

let ativo = true;
let ctx: AudioContext | null = null;
let mestre: GainNode | null = null;
let ruido: AudioBuffer | null = null;
let ouvindo = false;
let ultimoClique = 0;
const ouvintes = new Set<() => void>();

function ctorDoNavegador(): Ctor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext;
}

function avisar() {
  ouvintes.forEach((f) => f());
}

/**
 * Cria o contexto (uma vez) e tenta retomá-lo; só funciona de verdade depois de um gesto do usuário.
 * Devolve se o áudio ficou rodando (false sem AudioContext ou se o navegador ainda recusa).
 */
export async function destravarSom(): Promise<boolean> {
  try {
    if (!ctx) {
      const C = ctorDoNavegador();
      if (!C) return false;
      ctx = new C();
      mestre = ctx.createGain();
      mestre.gain.value = VOLUME_MESTRE;
      mestre.connect(ctx.destination);
      ctx.addEventListener("statechange", avisar);
      avisar();
    }
    if (ctx.state === "suspended") await ctx.resume();
    return ctx.state === "running";
  } catch {
    return false; // sem áudio: segue em silêncio
  }
}

const GESTOS = ["pointerdown", "pointerup", "click", "keydown", "touchend"] as const;

/**
 * Gesto do usuário: destrava o áudio. No toque (celular) o pointerdown não conta como ativação,
 * por isso também ouvimos pointerup/click/touchend. Sai de cena quando o contexto está rodando.
 */
function aoGesto(): void {
  void destravarSom().then((rodando) => {
    if (rodando) desinstalar();
  });
}

let desinstalar: () => void = () => undefined;

/** Liga os gestos que destravam o áudio (autoplay). Idempotente; devolve o desfazer. */
export function instalarGestos(): () => void {
  if (typeof window === "undefined" || ouvindo) return () => undefined;
  ouvindo = true;
  for (const g of GESTOS) window.addEventListener(g, aoGesto, true);
  desinstalar = () => {
    for (const g of GESTOS) window.removeEventListener(g, aoGesto, true);
    ouvindo = false;
  };
  return desinstalar;
}

export function setAtivo(v: boolean): void {
  ativo = v;
  if (v) void destravarSom(); // vindo de um clique no botão, isso já serve de gesto
  avisar();
}

/** true só quando o som está ativo E o navegador deixa tocar (contexto rodando). */
export function somFuncionando(): boolean {
  return ativo && !!ctx && ctx.state === "running";
}

/** Para a UI reagir a mudanças do estado do contexto. */
export function observarSom(f: () => void): () => void {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
}

function pronto(): { c: AudioContext; out: GainNode } | null {
  if (!ativo || !ctx || !mestre || ctx.state !== "running") return null;
  return { c: ctx, out: mestre };
}

function bip(c: AudioContext, out: AudioNode, freq: number, inicio: number, dur: number, pico: number, tipo: OscillatorType = "triangle") {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = tipo;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, inicio);
  g.gain.exponentialRampToValueAtTime(pico, inicio + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, inicio + dur);
  o.connect(g).connect(out);
  o.start(inicio);
  o.stop(inicio + dur + 0.02);
}

/** O "!": dois bips curtos, o segundo mais agudo. */
export function tocarAtencao(): void {
  try {
    const p = pronto();
    if (!p) return;
    const t = p.c.currentTime + 0.01;
    bip(p.c, p.out, 660, t, 0.09, 0.8);
    bip(p.c, p.out, 880, t + 0.12, 0.12, 0.8);
  } catch {
    // ignora
  }
}

/** Clique de teclado leve: ruído curtíssimo passado por um filtro passa-banda. */
export function tocarTeclado(): void {
  try {
    const p = pronto();
    if (!p) return;
    if (!ruido) {
      const n = Math.floor(p.c.sampleRate * 0.02);
      ruido = p.c.createBuffer(1, n, p.c.sampleRate);
      const d = ruido.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    }
    const src = p.c.createBufferSource();
    src.buffer = ruido;
    const f = p.c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 2200 + Math.random() * 1200;
    f.Q.value = 1.2;
    const g = p.c.createGain();
    g.gain.value = 0.35;
    src.connect(f).connect(g).connect(p.out);
    src.start();
  } catch {
    // ignora
  }
}

/** Clique agregado com limite de taxa (compartilhado por todos os AGzinhos). */
export function tocarTecladoLimitado(agora: number = Date.now()): void {
  if (agora - ultimoClique < INTERVALO_TECLADO_MS - 10) return;
  ultimoClique = agora;
  tocarTeclado();
}

/** "Ding" de tarefa concluída: duas notas agudas que se sobrepõem. */
export function tocarDing(): void {
  try {
    const p = pronto();
    if (!p) return;
    const t = p.c.currentTime + 0.01;
    bip(p.c, p.out, 1319, t, 0.22, 0.7, "sine");
    bip(p.c, p.out, 1760, t + 0.07, 0.3, 0.5, "sine");
  } catch {
    // ignora
  }
}

export function tocar(ev: SomEvento): void {
  if (ev === "atencao") tocarAtencao();
  else tocarDing();
}
