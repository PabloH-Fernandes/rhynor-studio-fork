// Agendador de descanso: quem está "De boa" escolhe uma atividade (café, sofá com celular,
// maquete, bebedouro, regar a planta, espreguiçar), vai até o lugar, fica um tempo e volta pra mesa.
// Lógica pura (sem DOM nem canvas): o motor passa os atores e um "mover" que anda com eles,
// e pergunta a pose de cada um na hora de desenhar. Testes em activities.test.ts.

import type { RestSpot, Spot } from "./map";
import type { CharAnim, Holding } from "./sprites";

export type RestKind = "cafe" | "celular" | "maquete" | "bebedouro" | "regar" | "espreguicar";
export type RestPhase = "indo" | "fazendo" | "voltando";

/** peso no sorteio (ping-pong e papo entram na etapa 5) */
export const REST_WEIGHTS: Record<RestKind, number> = {
  cafe: 3,
  celular: 2,
  maquete: 1,
  bebedouro: 1,
  regar: 1,
  espreguicar: 1,
};

/** o que aparece no crachá ("agora") */
export const REST_LABELS: Record<RestKind, string> = {
  cafe: "Tomando café",
  celular: "No celular",
  maquete: "Olhando a maquete",
  bebedouro: "No bebedouro",
  regar: "Regando a planta",
  espreguicar: "Se espreguiçando",
};

/** ocioso há pelo menos isso antes de sair da mesa */
export const IDLE_GRACE_MS = 4000;
/** de quanto em quanto tempo cada ator livre tenta sortear */
export const CHECK_MS = 500;
export const DURATION_MIN_MS = 20_000;
export const DURATION_MAX_MS = 60_000;
/** pausa na mesa entre uma atividade e outra */
export const PAUSE_MIN_MS = 5000;
export const PAUSE_MAX_MS = 10_000;
/** chance de levar o café pra mesa e terminar de beber lá */
export const CARRY_CUP_CHANCE = 0.35;
/** parte do tempo do café que fica na copa quando vai levar o copo */
const COPA_SHARE = 0.45;
/** um gole: leva o copo à boca, segura e abaixa (o "sip" dos sprites foi feito pra ~1,7 s) */
export const SIP_MS = 1700;
/** pegar o copo na cafeteira / no bebedouro antes do primeiro gole */
const PICKUP_MS = 1200;
const PHONE_LOOP_MS = 2400;
const CHIN_LOOP_MS = 4000;
const WATER_LOOP_MS = 1800;
const STRETCH_MS = 1600;
/** espreguiçar: um gesto a cada ~10 s, sempre pelo tempo mínimo de atividade */
const STRETCH_LOOP_MS = 10_000;

// ------------------------------------------------------------------ PRNG

/** PRNG pequeno e estável (mulberry32): mesma semente, mesma sequência */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32 bits (semente por id e sessão) */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Sorteio com peso. `r` em [0, 1). Opções com peso <= 0 nunca saem; sem opção válida, undefined. */
export function pickWeighted<T>(options: readonly { value: T; weight: number }[], r: number): T | undefined {
  const valid = options.filter((o) => o.weight > 0);
  const total = valid.reduce((sum, o) => sum + o.weight, 0);
  if (total <= 0) return undefined;
  let x = r * total;
  for (const o of valid) {
    if (x < o.weight) return o.value;
    x -= o.weight;
  }
  return valid[valid.length - 1].value;
}

// ------------------------------------------------------------------ reservas

/** Quem está em cada lugar (spotId → id do visual). Também guarda os lugares em pé da reunião. */
export class Reservations {
  private byspot = new Map<string, string>();

  holder(spotId: string): string | undefined {
    return this.byspot.get(spotId);
  }

  /** livre ou já é de `by` */
  isFree(spotId: string, by?: string): boolean {
    const h = this.byspot.get(spotId);
    return h === undefined || h === by;
  }

  /** reserva se estiver livre (ou já for de `by`); devolve se conseguiu */
  reserve(spotId: string, by: string): boolean {
    if (!this.isFree(spotId, by)) return false;
    this.byspot.set(spotId, by);
    return true;
  }

  release(spotId: string, by: string) {
    if (this.byspot.get(spotId) === by) this.byspot.delete(spotId);
  }

  releaseAll(by: string) {
    for (const [spot, h] of this.byspot) if (h === by) this.byspot.delete(spot);
  }

  /** lugares reservados por `by` */
  heldBy(by: string): string[] {
    return [...this.byspot].filter(([, h]) => h === by).map(([s]) => s);
  }

  get size(): number {
    return this.byspot.size;
  }
}

// ------------------------------------------------------------------ atores e pose

/** O que o agendador precisa saber de cada personagem (o motor monta a partir do Visual). */
export interface RestActor {
  id: string;
  /** sessão do Claude Code: entra na semente do sorteio */
  session: string;
  /** status "ocioso" */
  idle: boolean;
  /** desde quando está ocioso (Infinity se não está) */
  idleSince: number;
  leaving: boolean;
  /** ainda tem caminho pela frente */
  walking: boolean;
  /** comemorar ou espreguiçar (do motor) em curso */
  busyAnim: boolean;
  /** id do lugar onde está (ou de onde saiu) */
  atId: string;
  homeId: string;
  /** tem mesa própria (quem mora em pé na reunião não leva o café pra "casa") */
  hasDesk: boolean;
}

/** Como o agendador mexe nos personagens (o motor implementa; os testes usam um falso). */
export interface RestMover {
  goTo(id: string, spot: Spot): void;
  goHome(id: string): void;
  /** larga o copo de café: o motor leva até a mesa dele e deixa lá (decal que some sozinho) */
  dropCup(id: string): void;
}

/** Pose de descanso pra desenhar quando o personagem está parado no lugar (ou o objeto na mão andando). */
export interface RestPose {
  anim?: CharAnim;
  animT: number;
  holding?: Holding;
  /** sentado no sofá: o motor desenha as canelas */
  sofa?: boolean;
  /** copo de café em cima da própria mesa (entre um gole e outro, já sentado) */
  cupOnDesk?: boolean;
}

interface Rest {
  kind: RestKind;
  phase: RestPhase;
  /** lugar reservado (undefined: espreguiçar, na própria mesa) */
  spot?: RestSpot;
  /** quando chegou no lugar (início do "fazendo") */
  doingAt: number;
  /** fim do "fazendo" atual */
  endsAt: number;
  durationMs: number;
  /** café: leva o copo e termina de beber na mesa */
  carry: boolean;
  /** café: já está na mesa bebendo */
  atDesk: boolean;
  /** pausa entre goles (sorteada por atividade) */
  sipPauseMs: number;
}

interface Track {
  rnd: () => number;
  nextCheckAt: number;
  pauseUntil: number;
  last?: RestKind;
  rest?: Rest;
}

export interface RestSchedulerOptions {
  /**
   * semente base, misturada com o id e a sessão de cada ator. Os testes passam uma fixa;
   * o motor usa uma por carregamento (Date.now), pra cada aba não repetir a mesma agenda.
   */
  seed?: number;
  reservations?: Reservations;
}

export class RestScheduler {
  readonly reservations: Reservations;
  private tracks = new Map<string, Track>();
  private seed: number;

  constructor(
    private spots: readonly RestSpot[],
    opts: RestSchedulerOptions = {},
  ) {
    this.seed = opts.seed ?? 0;
    this.reservations = opts.reservations ?? new Reservations();
  }

  private track(actor: { id: string; session: string }): Track {
    let t = this.tracks.get(actor.id);
    if (!t) {
      t = { rnd: mulberry32(hash32(`${this.seed}|${actor.id}|${actor.session}`)), nextCheckAt: 0, pauseUntil: 0 };
      this.tracks.set(actor.id, t);
    }
    return t;
  }

  /** pode sair da mesa pra descansar agora? */
  eligible(a: RestActor, now: number): boolean {
    const t = this.tracks.get(a.id);
    if (t?.rest) return false;
    return (
      a.idle &&
      !a.leaving &&
      !a.walking &&
      !a.busyAnim &&
      now - a.idleSince >= IDLE_GRACE_MS &&
      now >= (t?.pauseUntil ?? 0)
    );
  }

  /**
   * Lugares livres pra uma atividade. Só os sem dono nenhum: um lugar já de `by` é a casa dele
   * (em pé na reunião), e soltar a reserva do descanso soltaria a casa junto.
   */
  freeSpots(kind: RestKind): RestSpot[] {
    return this.spots.filter((s) => s.kind === kind && this.reservations.holder(s.id) === undefined);
  }

  /** atividades possíveis agora: com lugar livre e diferente da anterior */
  options(id: string): RestKind[] {
    const last = this.tracks.get(id)?.last;
    return (Object.keys(REST_WEIGHTS) as RestKind[]).filter(
      (k) => k !== last && (k === "espreguicar" || this.freeSpots(k).length > 0),
    );
  }

  /** Um passo do agendador. Chamar todo quadro; os sorteios acontecem a cada ~CHECK_MS por ator. */
  update(now: number, actors: Iterable<RestActor>, mover: RestMover) {
    for (const a of actors) {
      // quem está saindo e não descansava não precisa de agenda
      if (a.leaving && !this.tracks.has(a.id)) continue;
      const t = this.track(a);
      const r = t.rest;
      if (!r) {
        if (now < t.nextCheckAt) continue;
        t.nextCheckAt = now + CHECK_MS;
        if (this.eligible(a, now)) this.start(a, t, now, mover);
        continue;
      }
      // trabalho chegou sem passar pelo upsert (ex.: snapshot): larga tudo
      if (!a.idle || a.leaving) {
        if (a.leaving) this.remove(a.id);
        else this.interrupt(a.id, mover, now);
        continue;
      }
      this.advance(a, t, r, now, mover);
    }
  }

  private start(a: RestActor, t: Track, now: number, mover: RestMover) {
    const kind = pickWeighted(
      this.options(a.id).map((k) => ({ value: k, weight: REST_WEIGHTS[k] })),
      t.rnd(),
    );
    if (!kind) return;
    const span = Math.round(DURATION_MIN_MS + t.rnd() * (DURATION_MAX_MS - DURATION_MIN_MS));
    // espreguiçar 60 s seguidos não tem graça: sempre o mínimo
    const durationMs = kind === "espreguicar" ? DURATION_MIN_MS : span;
    const rest: Rest = {
      kind,
      phase: "indo",
      doingAt: now,
      endsAt: now + durationMs,
      durationMs,
      carry: false,
      atDesk: false,
      sipPauseMs: Math.round(1600 + t.rnd() * 1800),
    };
    if (kind === "espreguicar") {
      // fica na mesa
      rest.phase = "fazendo";
    } else {
      const free = this.freeSpots(kind);
      const spot = free[Math.floor(t.rnd() * free.length)];
      if (!spot || !this.reservations.reserve(spot.id, a.id)) return;
      rest.spot = spot;
      rest.carry = kind === "cafe" && a.hasDesk && t.rnd() < CARRY_CUP_CHANCE;
      mover.goTo(a.id, spot);
    }
    t.rest = rest;
  }

  private advance(a: RestActor, t: Track, r: Rest, now: number, mover: RestMover) {
    if (r.phase === "indo") {
      if (a.walking) return;
      if (r.spot && a.atId !== r.spot.id) {
        mover.goTo(a.id, r.spot); // o motor mudou o destino: tenta de novo
        return;
      }
      r.phase = "fazendo";
      r.doingAt = now;
      r.endsAt = now + (r.carry ? Math.round(r.durationMs * COPA_SHARE) : r.durationMs);
      return;
    }
    if (r.phase === "fazendo") {
      if (now < r.endsAt) return;
      if (!r.spot || r.atDesk) {
        this.finish(a.id, t, now, mover, r.atDesk);
        return;
      }
      this.reservations.release(r.spot.id, a.id);
      r.phase = "voltando";
      mover.goHome(a.id);
      return;
    }
    // voltando
    if (a.walking) return;
    if (a.atId !== a.homeId) {
      mover.goHome(a.id);
      return;
    }
    if (r.carry && !r.atDesk) {
      // chegou com o copo: termina o café na mesa
      r.atDesk = true;
      r.phase = "fazendo";
      r.doingAt = now;
      r.endsAt = now + Math.max(SIP_MS * 2, r.durationMs - Math.round(r.durationMs * COPA_SHARE));
      return;
    }
    this.finish(a.id, t, now, mover, false);
  }

  private finish(id: string, t: Track, now: number, mover: RestMover, leaveCup: boolean) {
    const r = t.rest;
    if (!r) return;
    if (leaveCup) mover.dropCup(id);
    if (r.spot) this.reservations.release(r.spot.id, id);
    t.last = r.kind;
    t.rest = undefined;
    t.pauseUntil = now + Math.round(PAUSE_MIN_MS + t.rnd() * (PAUSE_MAX_MS - PAUSE_MIN_MS));
    t.nextCheckAt = t.pauseUntil;
  }

  /**
   * Trabalho tem prioridade: solta as reservas de descanso, larga o copo (se estiver com ele)
   * e manda o personagem pra mesa na hora. Não mexe em quem não está descansando.
   */
  interrupt(id: string, mover: RestMover, now = Infinity) {
    const t = this.tracks.get(id);
    const r = t?.rest;
    if (!t || !r) return;
    if (this.hasCup(r, now)) mover.dropCup(id);
    if (r.spot) this.reservations.release(r.spot.id, id);
    t.last = r.kind;
    t.rest = undefined;
    t.pauseUntil = 0;
    mover.goHome(id);
  }

  /**
   * Alguém vai morar no lugar `spotId` (em pé na reunião): quem descansa ali larga o descanso
   * e volta pra mesa, e o lugar fica livre pra reservar.
   */
  evict(spotId: string, mover: RestMover, now = Infinity) {
    const holder = this.reservations.holder(spotId);
    if (holder !== undefined && this.tracks.get(holder)?.rest?.spot?.id === spotId) this.interrupt(holder, mover, now);
  }

  /** saiu do escritório: esquece o ator e solta tudo que era dele */
  remove(id: string) {
    this.tracks.delete(id);
    this.reservations.releaseAll(id);
  }

  isResting(id: string): boolean {
    return !!this.tracks.get(id)?.rest;
  }

  phase(id: string): RestPhase | undefined {
    return this.tracks.get(id)?.rest?.phase;
  }

  kind(id: string): RestKind | undefined {
    return this.tracks.get(id)?.rest?.kind;
  }

  /** "Tomando café", "No celular"... ou null se não está descansando */
  restLabel(id: string): string | null {
    const k = this.kind(id);
    return k ? REST_LABELS[k] : null;
  }

  /** está com o copo de café (na mão ou na mesa, bebendo)? `now` = Infinity conta o "pegando" como já pegou */
  private hasCup(r: Rest, now: number): boolean {
    if (r.kind !== "cafe") return false;
    if (r.phase === "voltando") return r.carry;
    if (r.phase !== "fazendo") return false;
    return r.atDesk || now - r.doingAt >= PICKUP_MS;
  }

  /** Pose do momento. `arrived` = parado no lugar (sem caminho pela frente). */
  pose(id: string, now: number, arrived: boolean): RestPose | null {
    const r = this.tracks.get(id)?.rest;
    if (!r) return null;
    if (r.phase !== "fazendo" || !arrived) {
      // andando: só o objeto na mão
      if (r.kind === "regar") return { animT: 0, holding: "regador" };
      if (r.kind === "cafe" && r.phase === "voltando" && r.carry) return { animT: 0, holding: "copo" };
      return null;
    }
    const t = now - r.doingAt;
    const loop = (ms: number) => (((t % ms) + ms) % ms) / ms;
    switch (r.kind) {
      case "cafe":
      case "bebedouro": {
        const pickup = r.atDesk ? 0 : PICKUP_MS;
        if (t < pickup) return { animT: 0 };
        const period = SIP_MS + r.sipPauseMs;
        const k = (t - pickup) % period;
        if (k < SIP_MS) return { anim: "sip", animT: k / SIP_MS };
        return r.atDesk ? { animT: 0, cupOnDesk: true } : { animT: 0, holding: "copo" };
      }
      case "celular":
        return { anim: "phone", animT: loop(PHONE_LOOP_MS), sofa: r.spot?.sofa };
      case "maquete":
        return { anim: "chin", animT: loop(CHIN_LOOP_MS) };
      case "regar":
        return { anim: "water", animT: loop(WATER_LOOP_MS) };
      case "espreguicar": {
        const k = t % STRETCH_LOOP_MS;
        return k < STRETCH_MS ? { anim: "stretch", animT: k / STRETCH_MS } : { animT: 0 };
      }
    }
  }
}
