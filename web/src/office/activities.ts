// Agendador de descanso: quem está "De boa" escolhe uma atividade (café, sofá com celular,
// maquete, bebedouro, regar a planta, espreguiçar, ping-pong em dupla, bate-papo de 2 ou 3),
// vai até o lugar, fica um tempo e volta pra mesa.
// Lógica pura (sem DOM nem canvas): o motor passa os atores e um "mover" que anda com eles,
// e pergunta a pose de cada um na hora de desenhar. Testes em activities.test.ts.

import type { PapoPlace, RestSpot, Spot } from "./map";
import { type RallyFrame, type RallyState, rallyOf } from "./rally";
import type { CharAnim, Dir, Holding } from "./sprites";

// o ping-pong mora em rally.ts; reexportado aqui pra quem importa tudo de "./activities"
export * from "./rally";

/** atividades de uma pessoa só */
export type SoloKind = "cafe" | "celular" | "maquete" | "bebedouro" | "regar" | "espreguicar";
/** atividades em grupo: ping-pong (2) e bate-papo (2 ou 3) */
export type GroupKind = "pingpong" | "papo";
export type RestKind = SoloKind | GroupKind;
export type RestPhase = "indo" | "fazendo" | "voltando";

export const GROUP_KINDS: readonly GroupKind[] = ["pingpong", "papo"];

/** peso no sorteio */
export const REST_WEIGHTS: Record<RestKind, number> = {
  cafe: 3,
  celular: 2,
  maquete: 1,
  bebedouro: 1,
  regar: 1,
  espreguicar: 1,
  pingpong: 2,
  papo: 3,
};

/** o que aparece no crachá ("agora") */
export const REST_LABELS: Record<RestKind, string> = {
  cafe: "Tomando café",
  celular: "No celular",
  maquete: "Olhando a maquete",
  bebedouro: "No bebedouro",
  regar: "Regando a planta",
  espreguicar: "Se espreguiçando",
  pingpong: "Jogando ping-pong",
  papo: "Batendo papo",
};

/** ocioso há pelo menos isso antes de sair da mesa */
export const IDLE_GRACE_MS = 4000;
/** quem recebeu evento de trabalho há menos que isso não começa nem continua descansando */
export const WORK_COOLDOWN_MS = 20_000;

/**
 * Pode estar no descanso agora? Só ocioso e sem trabalho recente: trabalho ganha do descanso.
 * (o agendador só lê o status; quem muda status é o servidor)
 */
export function podeDescansar(a: Pick<RestActor, "idle" | "workedAt">, now: number): boolean {
  return a.idle && now - (a.workedAt ?? -Infinity) >= WORK_COOLDOWN_MS;
}
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

/** grupo: quem chega primeiro espera os outros até isso; depois desiste e escolhe outra coisa */
export const PARTNER_WAIT_MS = 8000;
/** papo: parceiros vêm de quem está livre a menos disso (px base) */
export const PAPO_RADIUS_PX = 200;
/** chance (a cada CHECK_MS) de um livre com parceiro livre formar ping-pong/papo, antes do sorteio normal */
export const GROUP_ON_FREE_CHANCE = 0.3;
/** papo: uma fala a cada 6–8 s, revezando (o motor ainda segura 12 s por AGzinho) */
export const PAPO_LINE_MIN_MS = 6000;
export const PAPO_LINE_MAX_MS = 8000;
/** tile em px base (as posições dos atores vêm em px; as dos lugares, em tiles) */
const TILE_PX = 16;

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
  /** último instante com evento de trabalho (status trabalhando/pensando/esperando); sem isso, nunca */
  workedAt?: number;
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
  /** posição em px base (o papo chama parceiros por perto) */
  x: number;
  y: number;
  /** falas do AGzinho pro bate-papo (sem falas: entra no papo, mas só escuta) */
  falas?: readonly string[];
}

/** Como o agendador mexe nos personagens (o motor implementa; os testes usam um falso). */
export interface RestMover {
  goTo(id: string, spot: Spot): void;
  goHome(id: string): void;
  /** larga o copo de café: o motor leva até a mesa dele e deixa lá (decal que some sozinho) */
  dropCup(id: string): void;
  /** fala do bate-papo: o motor põe na fila de balões de descanso */
  say(id: string, text: string): void;
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

interface Group extends RallyState {
  kind: GroupKind;
  /** ids na ordem; o primeiro "puxa" o relógio do grupo (falas) */
  members: string[];
  arrived: Set<string>;
  firstArrivalAt?: number;
  /** todos chegaram: começou a partida/conversa */
  readyAt?: number;
  endsAt: number;
  durationMs: number;
  /** acabou o tempo: cada um volta sozinho, e sair do grupo não mexe nos outros */
  over: boolean;
  /** papo: de quem é a vez, quando sai a próxima fala e quem falou por último */
  turn: number;
  nextLineAt: number;
  speaker?: string;
}

interface Rest {
  kind: RestKind;
  phase: RestPhase;
  /** lugar reservado (undefined: espreguiçar, na própria mesa) */
  spot?: Spot & { sofa?: boolean };
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
  /** ping-pong ou papo */
  group?: Group;
}

interface Track {
  rnd: () => number;
  nextCheckAt: number;
  pauseUntil: number;
  last?: RestKind;
  rest?: Rest;
  /** o grupo desfez (parceiro chamado, ninguém veio): escolhe outra atividade já no próximo passo */
  rechoose?: boolean;
  /** última fala no papo (não repete a mesma seguida) */
  lastLine?: string;
  /** falas do ator, guardadas a cada passo */
  falas?: readonly string[];
}

export interface RestSchedulerOptions {
  /**
   * semente base, misturada com o id e a sessão de cada ator. Os testes passam uma fixa;
   * o motor usa uma por carregamento (Date.now), pra cada aba não repetir a mesma agenda.
   */
  seed?: number;
  reservations?: Reservations;
  /** os 2 lados da mesa de ping-pong (sem isso, não tem ping-pong) */
  pingpong?: readonly Spot[];
  /** pontos de encontro do bate-papo (sem isso, não tem papo) */
  papoPlaces?: readonly PapoPlace[];
  /** chance de grupo espontâneo entre livres (padrão GROUP_ON_FREE_CHANCE; 0 desliga) */
  groupOnFreeChance?: number;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** centro de um lugar em px base */
const spotPx = (s: Spot) => ({ x: s.x * TILE_PX, y: s.y * TILE_PX });

export class RestScheduler {
  readonly reservations: Reservations;
  private tracks = new Map<string, Track>();
  private seed: number;
  private pingpongSpots: readonly Spot[];
  private papoPlaces: readonly PapoPlace[];
  private groupOnFreeChance: number;
  /** partida em andamento (só há uma mesa) */
  private match?: Group;

  constructor(
    private spots: readonly RestSpot[],
    opts: RestSchedulerOptions = {},
  ) {
    this.seed = opts.seed ?? 0;
    this.groupOnFreeChance = opts.groupOnFreeChance ?? GROUP_ON_FREE_CHANCE;
    this.reservations = opts.reservations ?? new Reservations();
    this.pingpongSpots = opts.pingpong?.length === 2 ? opts.pingpong : [];
    this.papoPlaces = opts.papoPlaces ?? [];
  }

  private track(actor: { id: string; session: string }): Track {
    let t = this.tracks.get(actor.id);
    if (!t) {
      t = { rnd: mulberry32(hash32(`${this.seed}|${actor.id}|${actor.session}`)), nextCheckAt: 0, pauseUntil: 0 };
      this.tracks.set(actor.id, t);
    }
    return t;
  }

  /**
   * Pode sair da mesa pra descansar agora? `asPartner`: chamado por alguém pro ping-pong ou papo
   * (vale também na pausa entre atividades; senão os dois quase nunca ficariam livres juntos).
   */
  eligible(a: RestActor, now: number, asPartner = false): boolean {
    const t = this.tracks.get(a.id);
    if (t?.rest) return false;
    return (
      podeDescansar(a, now) &&
      !a.leaving &&
      !a.walking &&
      !a.busyAnim &&
      now - a.idleSince >= IDLE_GRACE_MS &&
      (asPartner || now >= (t?.pauseUntil ?? 0))
    );
  }

  /**
   * Lugares livres pra uma atividade. Só os sem dono nenhum: um lugar já de `by` é a casa dele
   * (em pé na reunião), e soltar a reserva do descanso soltaria a casa junto.
   */
  freeSpots(kind: RestKind): RestSpot[] {
    return this.spots.filter((s) => s.kind === kind && this.reservations.holder(s.id) === undefined);
  }

  /**
   * Atividades possíveis agora: com lugar livre e diferente da anterior. As de grupo só entram
   * com `ctx` (precisam de parceiro livre); com `ctx`, espreguiçar só parado na própria mesa.
   */
  options(id: string, ctx?: { actor: RestActor; now: number; pool: readonly RestActor[]; strict?: boolean }): RestKind[] {
    const last = this.tracks.get(id)?.last;
    return (Object.keys(REST_WEIGHTS) as RestKind[]).filter((k) => {
      if (k === last) return false;
      if (k === "espreguicar") return !ctx || (ctx.actor.atId === ctx.actor.homeId && !ctx.actor.walking);
      if (k === "pingpong") return !!ctx && this.pingpongFree() && this.partners(ctx.actor, k, ctx.now, ctx.pool, ctx.strict).length > 0;
      if (k === "papo") return !!ctx && this.papoPlan(ctx.actor, ctx.now, ctx.pool, 2, 0, ctx.strict) !== null;
      return this.freeSpots(k).length > 0;
    });
  }

  private pingpongFree(): boolean {
    return this.pingpongSpots.length === 2 && this.pingpongSpots.every((s) => this.reservations.holder(s.id) === undefined);
  }

  /** quem pode entrar num grupo agora: livre, ocioso, sem pausa e sem ter acabado de fazer a mesma coisa */
  private partners(a: RestActor, kind: GroupKind, now: number, pool: readonly RestActor[], strict = false): RestActor[] {
    return pool
      .filter((p) => {
        if (p.id === a.id || !this.eligible(p, now, !strict)) return false;
        const t = this.tracks.get(p.id);
        return t?.last !== kind && !t?.rechoose;
      })
      .sort((p, q) => dist(a, p) - dist(a, q));
  }

  /** papo: um ponto de encontro com `size` lugares livres e parceiros por perto (ou null). `r` escolhe o ponto. */
  private papoPlan(a: RestActor, now: number, pool: readonly RestActor[], size: number, r: number, strict = false) {
    const near = this.partners(a, "papo", now, pool, strict).filter((p) => dist(a, p) < PAPO_RADIUS_PX);
    if (near.length < size - 1) return null;
    const places = this.papoPlaces
      .map((place) => ({ place, free: place.spots.filter((s) => this.reservations.holder(s.id) === undefined) }))
      .filter((p) => p.free.length >= size);
    if (!places.length) return null;
    return { ...places[Math.floor(r * places.length)], near };
  }

  /** Um passo do agendador. Chamar todo quadro; os sorteios acontecem a cada ~CHECK_MS por ator. */
  update(now: number, actors: Iterable<RestActor>, mover: RestMover) {
    const pool = [...actors];
    for (const a of pool) {
      // quem está saindo e não descansava não precisa de agenda
      if (a.leaving && !this.tracks.has(a.id)) continue;
      const t = this.track(a);
      t.falas = a.falas;
      const r = t.rest;
      if (!r) {
        if (t.rechoose) {
          // o grupo desfez: escolhe outra atividade de onde está; sem nada (ou chamado pro
          // trabalho nesse meio-tempo), volta pra mesa
          t.rechoose = false;
          if (!a.leaving && !(podeDescansar(a, now) && this.start(a, t, now, mover, pool))) mover.goHome(a.id);
          continue;
        }
        if (now < t.nextCheckAt) continue;
        t.nextCheckAt = now + CHECK_MS;
        if (this.eligible(a, now) && !this.startGroupOnFree(a, t, now, mover, pool)) this.start(a, t, now, mover, pool);
        continue;
      }
      // trabalho chegou (agora ou há menos de WORK_COOLDOWN_MS) sem passar pelo upsert: larga tudo
      if (!podeDescansar(a, now) || a.leaving) {
        if (a.leaving) this.remove(a.id);
        else this.interrupt(a.id, mover, now);
        continue;
      }
      if (r.group) this.advanceGroup(a, t, r, r.group, now, mover);
      else this.advance(a, t, r, now, mover);
    }
  }

  /**
   * Dois "de boa" juntos: com ao menos um grupo possível (parceiro elegível, mesa livre / lugar de
   * papo por perto, diferente da anterior), tenta formar ping-pong ou papo com GROUP_ON_FREE_CHANCE.
   * Sem grupo possível não consome `rnd()`. Devolve se formou.
   */
  private startGroupOnFree(a: RestActor, t: Track, now: number, mover: RestMover, pool: readonly RestActor[]): boolean {
    const kinds = this.options(a.id, { actor: a, now, pool, strict: true }).filter((k): k is GroupKind => (GROUP_KINDS as readonly RestKind[]).includes(k));
    if (!kinds.length || t.rnd() >= this.groupOnFreeChance) return false;
    const kind = pickWeighted(kinds.map((k) => ({ value: k, weight: REST_WEIGHTS[k] })), t.rnd());
    return !!kind && this.startGroup(kind, a, t, now, mover, pool, true);
  }

  /** sorteia e começa uma atividade; devolve se começou */
  private start(a: RestActor, t: Track, now: number, mover: RestMover, pool: readonly RestActor[]): boolean {
    const kind = pickWeighted(
      this.options(a.id, { actor: a, now, pool }).map((k) => ({ value: k, weight: REST_WEIGHTS[k] })),
      t.rnd(),
    );
    if (!kind) return false;
    if (kind === "pingpong" || kind === "papo") return this.startGroup(kind, a, t, now, mover, pool);
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
      if (!spot || !this.reservations.reserve(spot.id, a.id)) return false;
      rest.spot = spot;
      rest.carry = kind === "cafe" && a.hasDesk && t.rnd() < CARRY_CUP_CHANCE;
      mover.goTo(a.id, spot);
    }
    t.rest = rest;
    return true;
  }

  /**
   * Ping-pong: chama o livre mais perto e reserva os 2 lados da mesa.
   * Papo: escolhe um ponto de encontro com lugar e chama 1 ou 2 livres por perto.
   */
  private startGroup(kind: GroupKind, a: RestActor, t: Track, now: number, mover: RestMover, pool: readonly RestActor[], strict = false): boolean {
    let crew: { actor: RestActor; spot: Spot }[];
    if (kind === "pingpong") {
      const partner = this.partners(a, kind, now, pool, strict)[0];
      if (!partner || !this.pingpongFree()) return false;
      // cada um no lado que dá menos caminho pros dois
      const [s0, s1] = this.pingpongSpots;
      const straight = dist(a, spotPx(s0)) + dist(partner, spotPx(s1));
      const crossed = dist(a, spotPx(s1)) + dist(partner, spotPx(s0));
      crew =
        straight <= crossed
          ? [{ actor: a, spot: s0 }, { actor: partner, spot: s1 }]
          : [{ actor: a, spot: s1 }, { actor: partner, spot: s0 }];
    } else {
      const want = t.rnd() < 0.5 ? 3 : 2;
      const plan = this.papoPlan(a, now, pool, want, t.rnd(), strict) ?? this.papoPlan(a, now, pool, 2, t.rnd(), strict);
      if (!plan) return false;
      const size = Math.min(want, plan.free.length, plan.near.length + 1);
      crew = [a, ...plan.near.slice(0, size - 1)].map((actor, i) => ({ actor, spot: plan.free[i] }));
    }
    if (crew.some((c) => !this.reservations.isFree(c.spot.id))) return false;
    const durationMs = Math.round(DURATION_MIN_MS + t.rnd() * (DURATION_MAX_MS - DURATION_MIN_MS));
    const g: Group = {
      kind,
      members: crew.map((c) => c.actor.id),
      arrived: new Set(),
      endsAt: Infinity,
      durationMs,
      over: false,
      rnd: mulberry32(Math.floor(t.rnd() * 4294967296)),
      turn: 0,
      nextLineAt: Infinity,
    };
    for (const c of crew) {
      this.reservations.reserve(c.spot.id, c.actor.id);
      this.track(c.actor).rest = {
        kind,
        phase: "indo",
        spot: c.spot,
        doingAt: now,
        endsAt: Infinity,
        durationMs,
        carry: false,
        atDesk: false,
        sipPauseMs: 0,
        group: g,
      };
      mover.goTo(c.actor.id, c.spot);
    }
    if (kind === "pingpong") this.match = g;
    return true;
  }

  /** todos chegaram: começa a partida/conversa, com o mesmo relógio pra todos */
  private groupReady(g: Group, now: number) {
    g.readyAt = now;
    g.endsAt = now + g.durationMs;
    for (const id of g.members) {
      const r = this.tracks.get(id)?.rest;
      if (!r) continue;
      r.phase = "fazendo";
      r.doingAt = now;
      r.endsAt = g.endsAt;
    }
    if (g.kind === "papo") g.nextLineAt = now + 800 + Math.round(g.rnd() * 1500);
  }

  private removeFromGroup(id: string, g: Group) {
    g.members = g.members.filter((m) => m !== id);
    g.arrived.delete(id);
    if (g.speaker === id) g.speaker = undefined;
    if (this.match === g && (g.members.length < 2 || g.over)) this.match = undefined;
  }

  /** tira alguém do grupo sem mandar pra mesa: solta o lugar e escolhe outra atividade no próximo passo */
  private dropMember(id: string, g: Group) {
    const t = this.tracks.get(id);
    const r = t?.rest;
    if (t && r?.group === g) {
      if (r.spot) this.reservations.release(r.spot.id, id);
      t.last = r.kind;
      t.rest = undefined;
      t.pauseUntil = 0;
      t.rechoose = true;
    }
    this.removeFromGroup(id, g);
  }

  /**
   * Alguém saiu do grupo (chamado pro trabalho, foi embora). Ping-pong acaba; papo continua
   * se sobrarem 2. Quem sobra sozinho solta a reserva e escolhe outra atividade.
   */
  private leaveGroup(id: string, g: Group) {
    this.removeFromGroup(id, g);
    if (g.over) return;
    if (g.kind === "pingpong" || g.members.length < 2) for (const m of [...g.members]) this.dropMember(m, g);
  }

  /** ninguém mais veio: quem não chegou sai; com menos de 2 (ou ping-pong), desfaz */
  private groupTimeout(g: Group, now: number) {
    for (const m of g.members.filter((m) => !g.arrived.has(m))) this.dropMember(m, g);
    if (g.kind === "pingpong" || g.members.length < 2) {
      for (const m of [...g.members]) this.dropMember(m, g);
      return;
    }
    this.groupReady(g, now);
  }

  private advanceGroup(a: RestActor, t: Track, r: Rest, g: Group, now: number, mover: RestMover) {
    if (r.phase === "indo") {
      if (a.walking) return;
      if (r.spot && a.atId !== r.spot.id) {
        mover.goTo(a.id, r.spot);
        return;
      }
      g.arrived.add(a.id);
      g.firstArrivalAt ??= now;
      if (g.members.every((m) => g.arrived.has(m))) this.groupReady(g, now);
      else if (now - g.firstArrivalAt >= PARTNER_WAIT_MS) this.groupTimeout(g, now);
      return;
    }
    if (r.phase === "fazendo") {
      if (g.kind === "papo" && a.id === g.members[0]) this.talk(g, now, mover);
      if (now < r.endsAt) return;
      // acabou: cada um volta pra mesa por conta própria
      g.over = true;
      if (this.match === g) this.match = undefined;
      if (r.spot) this.reservations.release(r.spot.id, a.id);
      r.phase = "voltando";
      mover.goHome(a.id);
      return;
    }
    if (a.walking) return;
    if (a.atId !== a.homeId) {
      mover.goHome(a.id);
      return;
    }
    this.finish(a.id, t, now, mover, false);
  }

  /** papo: a vez de alguém falar (revezando), uma fala dele diferente da última */
  private talk(g: Group, now: number, mover: RestMover) {
    if (now < g.nextLineAt || !g.members.length) return;
    g.nextLineAt = now + Math.round(PAPO_LINE_MIN_MS + g.rnd() * (PAPO_LINE_MAX_MS - PAPO_LINE_MIN_MS));
    const id = g.members[g.turn % g.members.length];
    g.turn++;
    const t = this.tracks.get(id);
    const options = (t?.falas ?? []).filter((f) => f !== t?.lastLine);
    if (!t || !options.length) return;
    const line = options[Math.floor(g.rnd() * options.length)];
    t.lastLine = line;
    g.speaker = id;
    mover.say(id, line);
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
    if (t?.rechoose && !r) {
      // o grupo tinha acabado de desfazer e ele ainda estava no lugar do jogo/papo
      t.rechoose = false;
      t.pauseUntil = 0;
      mover.goHome(id);
      return;
    }
    if (!t || !r) return;
    if (r.group) this.leaveGroup(id, r.group);
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
    const g = this.tracks.get(id)?.rest?.group;
    if (g) this.leaveGroup(id, g);
    this.tracks.delete(id);
    this.reservations.releaseAll(id);
  }

  /** descansando (ou com o grupo recém-desfeito, ainda fora da mesa esperando escolher outra coisa) */
  isResting(id: string): boolean {
    const t = this.tracks.get(id);
    return !!t?.rest || !!t?.rechoose;
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
    if (r.group && arrived && r.phase !== "voltando") return this.groupPose(id, r, r.group, now);
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
      case "pingpong":
      case "papo":
        return { animT: 0 };
    }
  }

  /**
   * No lugar do grupo. Ping-pong: raquete na mão esperando o parceiro; na partida, o braço
   * sobe ("swing" > 0,8) quando a bolinha chega e fica erguido logo depois do golpe.
   */
  private groupPose(id: string, r: Rest, g: Group, now: number): RestPose {
    if (g.kind === "papo") return { animT: 0, sofa: r.spot?.sofa };
    const side = this.sideOf(r);
    const f = g.readyAt !== undefined ? rallyOf(g, now) : null;
    if (!f || side === undefined) return { animT: 0, holding: "raquete" };
    let animT = 0.3;
    if (f.state === "voo") {
      if (side === f.from) animT = f.p < 0.15 ? 0.9 : 0.3;
      else animT = f.p;
    } else if (f.state === "saque" && side === f.from) {
      animT = Math.min(0.99, f.p);
    }
    return { anim: "swing", animT };
  }

  private sideOf(r: Rest): 0 | 1 | undefined {
    const i = this.pingpongSpots.findIndex((s) => s.id === r.spot?.id);
    return i === 0 ? 0 : i === 1 ? 1 : undefined;
  }

  /** partida de ping-pong em andamento (todos na mesa), pro motor desenhar a bolinha */
  rally(now: number): RallyFrame | null {
    const g = this.match;
    return g && !g.over && g.members.length === 2 ? rallyOf(g, now) : null;
  }

  /** alguém já está na mesa de ping-pong com a raquete (o motor tira as raquetes e a bolinha do tampo) */
  pingpongInUse(): boolean {
    return !!this.match && this.match.arrived.size > 0;
  }

  /** ids do grupo de quem está no ping-pong ou no papo (vazio fora de grupo) */
  groupOf(id: string): readonly string[] {
    return this.tracks.get(id)?.rest?.group?.members ?? [];
  }

  /**
   * Pra onde olhar no papo (em pé): pra quem está falando; quem fala olha pro mais perto.
   * Sentado no sofá continua de frente. undefined fora do papo.
   */
  face(id: string): Dir | undefined {
    const r = this.tracks.get(id)?.rest;
    const g = r?.group;
    if (!r || !g || g.kind !== "papo" || r.phase === "voltando" || !r.spot || r.spot.sitting) return undefined;
    const me = r.spot;
    const spotOf = (m: string) => this.tracks.get(m)?.rest?.spot;
    let target: Spot | undefined = g.speaker && g.speaker !== id ? spotOf(g.speaker) : undefined;
    if (!target) {
      let best = Infinity;
      for (const m of g.members) {
        const s = m === id ? undefined : spotOf(m);
        if (s && dist(me, s) < best) {
          best = dist(me, s);
          target = s;
        }
      }
    }
    if (!target) return undefined;
    const dx = target.x - me.x;
    const dy = target.y - me.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
    return dy >= 0 ? "down" : "up";
  }
}
