// Motor do escritório: guarda a posição de cada personagem, decide pra onde ele vai
// (mesa, reunião, porta e, quando está de boa, o descanso do agendador em activities.ts),
// anda pelos caminhos e desenha tudo no canvas.

import type { AGzinho, Acessorio, Agent, Roster } from "../../../shared/types";
import { HAIR_STYLE_INDEX, agzinhoDoPapel } from "../../../shared/roster";
import { HAIRS, SKINS, inkAlpha, palette, roleColor, theme, uniformFor, uniformForAgzinho } from "../theme";
import { AreaLayer, bakeDrawing, drawBaked, type Baked } from "./bake";
import { RestScheduler, type RestActor, type RestMover, type RestPose } from "./activities";
import { fill, line } from "./decor";
import { Lightmap, clockDate, windowLight, type LightScene } from "./daylight";
import { isReducedMotion } from "./motion";
import {
  AISLE_Y,
  DESKS,
  DOOR_SPOT,
  OVERFLOW_SPOTS,
  PROPS,
  REST_SPOTS,
  SIGN,
  TILE,
  H,
  W,
  deskSpot,
  drawBoard,
  drawChair,
  drawClock,
  drawCoffeeCorner,
  drawDecor,
  drawDesk,
  drawFloor,
  drawWindows,
  drawMeetingTable,
  drawSign,
  drawSignGlow,
  monitorScreen,
  cupSurface,
  route,
  type CupSurface,
  type Desk,
  type Point,
  type Spot,
} from "./map";
import { clearSpriteCache } from "./spriteCache";
import {
  HAIR_STYLE_COUNT,
  HEAD_TOP_SIT,
  HEAD_TOP_STAND,
  HIT_BOX,
  animLift,
  drawCharacter,
  hashString,
  type CharAnim,
  type CharLook,
  type Dir,
  type Mood,
} from "./sprites";

const SPEED = 3.4; // tiles por segundo
/** as janelas são refeitas nesse intervalo (nuvens e guindaste andam menos de 1px nesse tempo) */
const WINDOW_FRAME_MS = 200;
/** chave do cache da mesa de reunião */
const MEETING_TABLE = {};
/** copo largado numa mesa (interrompido ou terminou o café sentado) some depois disso */
const CUP_DECAL_MS = 60_000;
const BUBBLE_MS = 3800;
const CHAT_MS = 4500;
const STRETCH_MS = 1600;
const CHEER_MS = 1300;
/** com prefers-reduced-motion as duas viram um gesto curto de braços */
const REDUCED_ANIM_MS = 700;
const CONFETTI_COUNT = 8;
const CONFETTI_AT_MS = 150; // sai no primeiro impulso do pulo
const CONFETTI_LIFE_MS = 800;
const CONFETTI_GRAVITY = 0.00012; // px/ms²


/** status em que o agente está "na tarefa" (vale espreguiçar ao ficar de boa) */
const BUSY = new Set<Agent["status"]>(["trabalhando", "pensando", "esperando"]);

/** sobrancelha: sobe esperando, inclina pensando */
const MOOD: Partial<Record<Agent["status"], Mood>> = { esperando: "esperando", pensando: "pensando" };

/** aparência fixa de cada papel (tabela de uniformes); o que não está aqui sai do hash do id */
const ROLE_LOOK: Record<string, { hairStyle: number; accessories?: Acessorio[] }> = {
  lider: { hairStyle: 6, accessories: ["relogio"] },
  planejador: { hairStyle: 3, accessories: [] },
  revisor: { hairStyle: 0, accessories: ["oculos"] },
  pesquisador: { hairStyle: 2 }, // óculos por hash
  testador: { hairStyle: 4, accessories: ["relogio"] },
  dev: { hairStyle: 5, accessories: ["headset"] },
  documentador: { hairStyle: 1, accessories: ["lapis"] },
};
const GUEST_ACCESSORIES: Acessorio[][] = [[], [], ["barba"], ["oculos"]];

/** Aparência do AGzinho do elenco; sem elenco ou visitante extra, a de sempre (papel + hash do id). */
function lookFor(agent: Agent, roster: Roster | null): CharLook {
  const ag = agent.agzinho ? roster?.agzinhos.find((a) => a.key === agent.agzinho) : undefined;
  return ag ? lookOfAgzinho(ag) : lookByHash(agent, hashString(agent.id));
}

/** aparência de um AGzinho do elenco: todos os acessórios, cada um na sua camada */
export function lookOfAgzinho(ag: AGzinho): CharLook {
  return {
    uniform: uniformForAgzinho(ag),
    skin: ag.pele,
    hair: ag.cabelo.cor,
    hairStyle: HAIR_STYLE_INDEX[ag.cabelo.estilo] ?? 0,
    accessories: [...ag.acessorios],
    feminine: ag.genero === "feminino",
  };
}

function lookByHash(agent: Agent, h: number): CharLook {
  const fixed = Object.hasOwn(ROLE_LOOK, agent.role) ? ROLE_LOOK[agent.role] : undefined;
  const accessories: Acessorio[] =
    fixed?.accessories ??
    (agent.role === "pesquisador" ? ((h >>> 13) % 2 ? ["oculos"] : []) : GUEST_ACCESSORIES[(h >>> 13) % GUEST_ACCESSORIES.length]);
  return {
    uniform: uniformFor(agent.role),
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >>> 4) % HAIRS.length],
    hairStyle: fixed?.hairStyle ?? (h >>> 9) % HAIR_STYLE_COUNT,
    accessories,
    feminine: false,
  };
}

interface Visual {
  agent: Agent;
  x: number;
  y: number;
  dir: Dir;
  path: Point[];
  /** lugar onde está (ou de onde saiu) */
  at: Spot;
  /** pra onde está indo */
  target: Spot;
  home: Spot;
  deskId?: string;
  look: CharLook;
  phase: number;
  /** semente do piscar (hash do id) */
  seed: number;
  idleSince: number;
  activityAt: number;
  leaving: boolean;
  fade: number; // 1 → 0 ao sair pela porta
  chat?: { text: string; until: number };
  anim?: { kind: CharAnim; start: number; until: number };
  /** largou o descanso com o copo de café: leva na mão até a mesa e deixa lá */
  cupInHand?: boolean;
}

/** copo de café largado em cima de uma mesa */
interface CupDecal {
  deskId: string;
  surface: CupSurface;
  until: number;
}

/** linha do `__agRest()` (debug no console) */
interface RestDebugRow {
  id: string;
  name: string;
  status: Agent["status"];
  label: string | null;
  phase: string | null;
  anim: string | null;
  holding: string | null;
  at: string;
  x: number;
  y: number;
  cups: number;
  cupInHand: boolean;
}

declare global {
  interface Window {
    /** debug: quem está descansando, onde e em que fase */
    __agRest?: () => RestDebugRow[];
  }
}

interface Envelope {
  fromId: string;
  toId: string;
  start: number;
  text: string;
}

export class OfficeEngine {
  private visuals = new Map<string, Visual>();
  private envelopes: Envelope[] = [];
  private logo: HTMLImageElement | null = null;
  private lightmap = new Lightmap();
  private rosterData: Roster | null = null;
  /** descanso de quem está de boa; as reservas também guardam quem mora em pé na reunião */
  private rest = new RestScheduler(REST_SPOTS, { seed: Date.now() | 0 });
  private cups: CupDecal[] = [];
  /** camada estática (chão, parede, quadros, placa) na escala k */
  private staticLayer: HTMLCanvasElement | null = null;
  private staticKey = "";
  /** móveis estáticos já desenhados na escala bakedK */
  private baked = new WeakMap<object, Baked | null>();
  private bakedByName = new Map<string, Baked | null>();
  private bakedK = 0;
  /** faixa das janelas na parede (moldura e peitoril cabem em y 0..40) */
  private windowLayer = new AreaLayer({ x: 0, y: 0, w: W, h: 40 });
  private windowSlot = -1;
  /** relógio (centro 176, 21; raio 10 + sombra) */
  private clockLayer = new AreaLayer({ x: 164, y: 9, w: 24, h: 25 });
  private clockSec = -1;
  private mover: RestMover = {
    goTo: (id, spot) => {
      const v = this.visuals.get(id);
      if (v && !v.leaving) this.goTo(v, spot);
    },
    goHome: (id) => {
      const v = this.visuals.get(id);
      if (v && !v.leaving) this.goTo(v, v.home);
    },
    dropCup: (id) => {
      const v = this.visuals.get(id);
      if (v && !v.leaving) v.cupInHand = true;
    },
  };
  selectedId: string | null = null;
  hoverId: string | null = null;
  onSelect?: (id: string | null) => void;

  constructor() {
    if (theme.logoUrl) {
      const img = new Image();
      img.src = theme.logoUrl;
      this.logo = img;
    }
    // debug (só no dev server): `__agRest()` no console lista quem está descansando, onde e em que fase
    if (import.meta.env.DEV && typeof window !== "undefined") window.__agRest = () => this.restDebug();
  }

  private restDebug(): RestDebugRow[] {
    const now = performance.now();
    return [...this.visuals.values()].map((v) => ({
      id: v.agent.id,
      name: v.agent.name,
      status: v.agent.status,
      label: this.rest.restLabel(v.agent.id),
      phase: this.rest.phase(v.agent.id) ?? null,
      anim: this.animOf(v, now)?.kind ?? null,
      holding: this.restPose(v, now)?.holding ?? null,
      at: v.at.id,
      x: +(v.x * TILE).toFixed(1),
      y: +(v.y * TILE).toFixed(1),
      cups: this.cups.length,
      cupInHand: !!v.cupInHand,
    }));
  }

  /** elenco vindo do servidor; null até o primeiro snapshot */
  get roster(): Roster | null {
    return this.rosterData;
  }

  /** elenco novo (PUT no vestiário): os bonecos na tela trocam de aparência na hora */
  set roster(roster: Roster | null) {
    if (roster === this.rosterData) return;
    this.rosterData = roster;
    clearSpriteCache();
    for (const v of this.visuals.values()) v.look = lookFor(v.agent, roster);
  }

  // ------------------------------------------------------------ dados do servidor

  sync(agents: Agent[]) {
    const ids = new Set(agents.map((a) => a.id));
    for (const v of this.visuals.values()) if (!ids.has(v.agent.id)) this.startLeaving(v);
    for (const a of agents) this.upsert(a, true);
  }

  upsert(agent: Agent, fromSnapshot = false) {
    const now = performance.now();
    let v = this.visuals.get(agent.id);
    // já foi embora na tela, mas o servidor ainda guarda o "saindo" por uns segundos: não ressuscita
    if (!v && agent.status === "saindo") return;
    if (!v) {
      v = this.create(agent, fromSnapshot);
      this.visuals.set(agent.id, v);
    }
    const prev = v.agent.status;
    const delivered = agent.tasksDone !== v.agent.tasksDone && agent.tasksDone > 0;
    if (agent.agzinho !== v.agent.agzinho) v.look = lookFor(agent, this.rosterData);
    if (agent.status !== "ocioso" && this.rest.isResting(agent.id)) {
      // chamado no meio do descanso: larga tudo e volta pra mesa (trabalho tem prioridade)
      this.rest.interrupt(agent.id, this.mover, now);
    }
    if (agent.role !== v.agent.role && !v.leaving) {
      // trocou de papel (ex.: líder da simulação cede o Guto à sessão real): muda de mesa
      this.rest.reservations.release(v.home.id, agent.id);
      const { spot, deskId } = this.claimHome(agent);
      v.home = spot;
      v.deskId = deskId;
    }
    const seated = v.at.id === v.home.id && v.at.sitting && !v.path.length && !v.leaving;
    if (agent.activity !== v.agent.activity) v.activityAt = now;
    if (agent.status === "ocioso" && prev !== "ocioso") v.idleSince = now;
    if (agent.status !== "ocioso") v.idleSince = Infinity;
    // o snapshot inicial (create) chega com prev === status, então não anima
    const short = isReducedMotion();
    if (seated && delivered && agent.status !== "saindo") {
      // entregou o trabalho (SubagentStop): comemora na mesa e fica no escritório
      v.anim = { kind: "cheer", start: now, until: now + (short ? REDUCED_ANIM_MS : CHEER_MS) };
    } else if (seated && agent.status !== prev) {
      if (agent.status === "ocioso" && BUSY.has(prev)) {
        // fim de turno (ex.: Stop do líder): espreguiça na cadeira
        v.anim = { kind: "stretch", start: now, until: now + (short ? REDUCED_ANIM_MS : STRETCH_MS) };
      } else if (v.anim?.kind === "stretch") {
        v.anim = undefined; // voltou ao trabalho no meio do espreguiçar
      }
    }
    v.agent = agent;
    if (agent.status === "saindo") this.startLeaving(v);
  }

  remove(id: string) {
    const v = this.visuals.get(id);
    if (v) this.startLeaving(v);
  }

  chat(fromId: string, toId: string, text: string) {
    const from = this.visuals.get(fromId);
    if (!from) return;
    from.chat = { text, until: performance.now() + CHAT_MS };
    if (this.visuals.has(toId)) this.envelopes.push({ fromId, toId, start: performance.now(), text });
  }

  private create(agent: Agent, fromSnapshot: boolean): Visual {
    const h = hashString(agent.id);
    const { spot, deskId } = this.claimHome(agent);
    // quem já estava trabalhando quando a tela abriu aparece direto na mesa
    const startAtHome = fromSnapshot && agent.status !== "chegando";
    const start = startAtHome ? spot : DOOR_SPOT;
    return {
      agent,
      x: start.x,
      y: start.y,
      dir: "right",
      path: startAtHome ? [] : route(DOOR_SPOT, spot),
      at: start,
      target: spot,
      home: spot,
      deskId,
      look: lookFor(agent, this.rosterData),
      phase: h % 1000,
      seed: h,
      idleSince: agent.status === "ocioso" ? performance.now() : Infinity,
      activityAt: performance.now(),
      leaving: false,
      fade: 1,
    };
  }

  /** Mesa do papel → mesa de convidado → em pé na reunião. */
  private claimHome(agent: Agent): { spot: Spot; deskId?: string } {
    const taken = new Set([...this.visuals.values()].filter((v) => !v.leaving).map((v) => v.home.id));
    const free = (d: Desk) => !taken.has(deskSpot(d).id);
    const own = DESKS.find((d) => d.role === agent.role && free(d));
    const guest = DESKS.find((d) => d.role === "convidado" && free(d));
    const desk = own ?? guest;
    if (desk) return { spot: deskSpot(desk), deskId: desk.id };
    // em pé na reunião: a reserva é a mesma do descanso (a maquete usa 2 desses lugares)
    // (quem estiver descansando nele volta pra mesa: morar ali tem prioridade)
    const res = this.rest.reservations;
    const spot =
      OVERFLOW_SPOTS.find((s) => !taken.has(s.id) && res.isFree(s.id, agent.id)) ??
      OVERFLOW_SPOTS.find((s) => !taken.has(s.id)) ??
      OVERFLOW_SPOTS[agent.id.length % OVERFLOW_SPOTS.length];
    this.rest.evict(spot.id, this.mover, performance.now());
    res.reserve(spot.id, agent.id);
    return { spot };
  }

  private startLeaving(v: Visual) {
    if (v.leaving) return;
    v.leaving = true;
    this.rest.remove(v.agent.id);
    this.goTo(v, DOOR_SPOT);
  }

  private goTo(v: Visual, spot: Spot) {
    if (v.target.id === spot.id) return;
    const walking = v.path.length > 0;
    let from: Spot = v.at;
    if (walking) {
      // mudou de ideia no meio do caminho: sai de onde está
      const onAisle = Math.abs(v.y - AISLE_Y) < 0.05;
      const lane = onAisle
        ? v.x
        : Math.abs(v.at.laneX - v.x) < Math.abs(v.target.laneX - v.x)
          ? v.at.laneX
          : v.target.laneX;
      // fora do corredor e fora da lane (ex.: andando de lado rumo ao sofá): volta primeiro na
      // horizontal até a lane, senão cortaria em diagonal por cima da mesa de alguém
      const via = !onAisle && Math.abs(v.x - lane) > 0.01 ? [{ x: lane, y: v.y }] : [];
      from = { id: "aqui", x: v.x, y: v.y, laneX: lane, via, sitting: false };
    }
    v.path = route(from, spot);
    v.target = spot;
  }

  // ------------------------------------------------------------ simulação

  update(dt: number, now: number) {
    // descanso: sorteia atividades pra quem está de boa e avança as fases (indo/fazendo/voltando)
    const actors: RestActor[] = [];
    for (const v of this.visuals.values()) {
      if (v.anim && now >= v.anim.until) v.anim = undefined;
      actors.push({
        id: v.agent.id,
        session: v.agent.sessionId,
        idle: v.agent.status === "ocioso",
        idleSince: v.idleSince,
        leaving: v.leaving,
        walking: v.path.length > 0,
        busyAnim: !!v.anim,
        atId: v.at.id,
        homeId: v.home.id,
        hasDesk: !!v.deskId,
      });
    }
    this.rest.update(now, actors, this.mover);

    for (const v of this.visuals.values()) {
      // fora do descanso, o lugar de cada um é a própria mesa
      if (!v.leaving && !this.rest.isResting(v.agent.id) && v.target.id !== v.home.id) this.goTo(v, v.home);

      // anda
      let budget = SPEED * dt;
      while (budget > 0 && v.path.length) {
        const p = v.path[0];
        const dx = p.x - v.x;
        const dy = p.y - v.y;
        const dist = Math.hypot(dx, dy);
        if (Math.abs(dx) > Math.abs(dy)) v.dir = dx > 0 ? "right" : "left";
        else if (dist > 0) v.dir = dy > 0 ? "down" : "up";
        if (dist <= budget) {
          v.x = p.x;
          v.y = p.y;
          budget -= dist;
          v.path.shift();
        } else {
          v.x += (dx / dist) * budget;
          v.y += (dy / dist) * budget;
          budget = 0;
        }
      }
      if (!v.path.length && v.at.id !== v.target.id) {
        v.at = v.target;
        v.dir = this.restingDir(v);
      }
      if (v.leaving) v.cupInHand = false;
      else if (v.cupInHand && !v.path.length && v.at.id === v.home.id) this.putCupDown(v, now);
      if (v.leaving && !v.path.length) v.fade = Math.max(0, v.fade - dt * 2.5);
    }

    for (const [id, v] of this.visuals) {
      if (v.leaving && v.fade <= 0) {
        this.visuals.delete(id);
        this.rest.remove(id);
      }
    }
    this.envelopes = this.envelopes.filter((e) => now - e.start < 1400);
    if (this.cups.length) this.cups = this.cups.filter((c) => now < c.until);
  }

  /**
   * Chegou em casa com o copo: deixa na própria mesa. Quem mora em pé na reunião deixa na mesa
   * livre mais perto (sem livre, na mais perto). Um copo por mesa; some em CUP_DECAL_MS.
   */
  private putCupDown(v: Visual, now: number) {
    v.cupInHand = false;
    let desk = DESKS.find((d) => d.id === v.deskId);
    if (!desk) {
      const used = new Set([...this.visuals.values()].filter((o) => !o.leaving && o.deskId).map((o) => o.deskId));
      const dist = (d: Desk) => Math.hypot(d.cx - v.x, d.cy - v.y);
      const byDist = [...DESKS].sort((a, b) => dist(a) - dist(b));
      desk = byDist.find((d) => !used.has(d.id)) ?? byDist[0];
    }
    const id = desk.id;
    this.cups = this.cups.filter((c) => c.deskId !== id);
    this.cups.push({ deskId: id, surface: cupSurface(desk), until: now + CUP_DECAL_MS });
  }

  /** "Tomando café", "No celular"... (crachá da etapa 6); null se não está descansando */
  restLabel(id: string): string | null {
    return this.rest.restLabel(id);
  }

  private restingDir(v: Visual): Dir {
    if (v.at.face) return v.at.face;
    if (v.at.sitting) return "down";
    if (v.at.id.startsWith("reuniao:")) return v.at.x < 16 ? "right" : v.at.x > 16 ? "left" : v.at.y < 11 ? "down" : "up";
    return "down";
  }

  // ------------------------------------------------------------ desenho

  render(ctx: CanvasRenderingContext2D, now: number) {
    ctx.imageSmoothingEnabled = false;
    const visuals = [...this.visuals.values()];
    const seatedAt = new Map<string, Visual>();
    for (const v of visuals) if (v.at.sitting && !v.path.length && v.deskId && v.at.id === v.home.id) seatedAt.set(v.deskId, v);
    const coffeeBusy = visuals.some((v) => v.at.id.startsWith("cafe:") && !v.path.length);

    // luz do momento (hora real ou ?hora=) e o mapa de luz, refeito ~4x por segundo
    const scene: LightScene = { activeScreens: [], waitingScreens: [], coffeeBusy };
    for (const d of DESKS) {
      const st = seatedAt.get(d.id)?.agent.status;
      if (st === "trabalhando" || st === "pensando") scene.activeScreens.push(monitorScreen(d));
      else if (st === "esperando") scene.waitingScreens.push(monitorScreen(d));
    }
    this.lightmap.refresh(now, scene);
    const daylight = this.lightmap.daylight;

    this.drawStatic(ctx);
    this.drawWindowLayer(ctx, now, windowLight(daylight));
    this.drawClockLayer(ctx);

    const active = visuals.filter((v) => !v.leaving);
    drawBoard(ctx, {
      total: active.length,
      working: active.filter((v) => v.agent.status === "trabalhando" || v.agent.status === "pensando").length,
      waiting: active.filter((v) => v.agent.status === "esperando").length,
    });

    // objetos com profundidade, desenhados de cima pra baixo
    const items: { y: number; draw: () => void }[] = [];

    for (const d of DESKS) {
      const occupant = visuals.find((v) => v.deskId === d.id && !v.leaving);
      const seated = seatedAt.get(d.id);
      const deskTop = (d.cy + 0.55) * TILE;
      items.push({ y: (d.cy + 0.85) * TILE - 1, draw: () => this.drawBakedOr(ctx, d, (g) => drawChair(g, d, roleColor(d.role === "convidado" ? "convidado" : d.role))) });
      items.push({
        y: deskTop + 20,
        draw: () => {
          const opts = {
            active: !!seated && (seated.agent.status === "trabalhando" || seated.agent.status === "pensando"),
            waiting: !!seated && seated.agent.status === "esperando",
            occupantName: occupant ? this.nicknameOf(occupant.agent) : undefined,
            nickname: this.rosterData ? agzinhoDoPapel(this.rosterData, d.role)?.apelido : undefined,
            t: now,
            reducedMotion: isReducedMotion(),
          };
          // monitor desligado não anima: a mesa fica pronta no cache (uma por plaquinha)
          if (opts.active || opts.waiting) drawDesk(ctx, d, opts);
          else this.drawBakedOr(ctx, `mesa|${d.id}|${opts.occupantName ?? ""}|${opts.nickname ?? ""}`, (g) => drawDesk(g, d, opts));
        },
      });
    }
    items.push({ y: 11.2 * TILE + 10, draw: () => this.drawBakedOr(ctx, MEETING_TABLE, drawMeetingTable) });
    items.push({ y: 16.1 * TILE, draw: () => drawCoffeeCorner(ctx, now, coffeeBusy) });
    for (const p of PROPS) {
      items.push({ y: p.y, draw: () => (p.live ? p.draw(ctx, now) : this.drawBakedOr(ctx, p, (g) => p.draw(g, now))) });
    }
    for (const c of this.cups) items.push({ y: c.surface.depth, draw: () => drawCup(ctx, c.surface.x, c.surface.y) });

    for (const v of visuals) {
      const still = !v.path.length;
      // café terminando na mesa: o copo fica no tampo entre um gole e outro
      const rest = this.restPose(v, now);
      const desk = rest?.cupOnDesk ? DESKS.find((d) => d.id === v.deskId) : undefined;
      if (desk) {
        const surface = cupSurface(desk);
        items.push({ y: surface.depth, draw: () => drawCup(ctx, surface.x, surface.y) });
      }
      items.push({
        // no sofá: logo depois do sofá (o boneco senta na frente do encosto)
        y: still && v.at.depth !== undefined ? v.at.depth : v.y * TILE + (v.at.sitting && still ? 0 : 0.5),
        draw: () => this.drawVisual(ctx, v, now),
      });
    }

    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    // iluminação: escurece cenário e personagens; o que vem depois (envelopes, "!", balões,
    // nomes, confete) fica fora do multiply e continua legível à noite
    this.lightmap.apply(ctx);
    this.drawEmissive(ctx, scene, daylight.night);

    // camada de cima: envelopes e balões
    for (const e of this.envelopes) this.drawEnvelope(ctx, e, now);
    for (const v of visuals) this.drawOverlay(ctx, v, now);
  }

  /**
   * Chão, parede, quadros, placa e plaquinha não mudam: são desenhados uma vez num canvas fora da
   * tela na escala atual (k) e copiados 1:1 a cada quadro. Eram milhares de fillRect por quadro.
   * Refaz quando k muda ou quando a logo da placa termina de carregar.
   */
  private drawStatic(ctx: CanvasRenderingContext2D) {
    const m = ctx.getTransform();
    const k = Math.max(1, Math.round(m.a));
    const logoReady = !!this.logo && this.logo.complete && this.logo.naturalWidth > 0;
    const key = `${k}|${logoReady}`;
    if (!this.staticLayer || this.staticKey !== key) {
      const c = typeof document !== "undefined" ? document.createElement("canvas") : null;
      const g = c?.getContext("2d");
      if (!c || !g) {
        drawFloor(ctx);
        drawDecor(ctx);
        drawSign(ctx, this.logo);
        return;
      }
      c.width = W * k;
      c.height = H * k;
      g.setTransform(k, 0, 0, k, 0, 0);
      g.imageSmoothingEnabled = false;
      drawFloor(g);
      drawDecor(g);
      drawSign(g, this.logo);
      this.staticLayer = c;
      this.staticKey = key;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, m.e, m.f);
    ctx.drawImage(this.staticLayer, 0, 0);
    ctx.restore();
  }

  /** escala inteira atual (o render roda com setTransform(k)) */
  private scaleOf(ctx: CanvasRenderingContext2D): number {
    return Math.max(1, Math.round(ctx.getTransform().a));
  }

  /** móvel estático: desenha uma vez por escala e depois só copia (sem canvas 2D, desenha direto) */
  private drawBakedOr(ctx: CanvasRenderingContext2D, key: object | string, draw: (g: CanvasRenderingContext2D) => void) {
    const k = this.scaleOf(ctx);
    if (this.bakedK !== k) {
      this.baked = new WeakMap();
      this.bakedByName.clear();
      this.bakedK = k;
    }
    let b = typeof key === "string" ? this.bakedByName.get(key) : this.baked.get(key);
    if (b === undefined) {
      b = bakeDrawing(k, draw);
      if (typeof key === "string") {
        // plaquinhas mudam pouco, mas nomes de visitantes extras podem ir se acumulando
        if (this.bakedByName.size > 64) this.bakedByName.clear();
        this.bakedByName.set(key, b);
      } else this.baked.set(key, b);
    }
    if (b) drawBaked(ctx, b);
    else draw(ctx);
  }

  /**
   * Janelas (céu, nuvens, guindaste): mexem devagar, então são refeitas numa camada a cada
   * WINDOW_FRAME_MS (ou quando a escala muda) em vez de todo quadro.
   */
  private drawWindowLayer(ctx: CanvasRenderingContext2D, now: number, light: ReturnType<typeof windowLight>) {
    const k = this.scaleOf(ctx);
    const slot = Math.floor(now / WINDOW_FRAME_MS);
    if (this.windowLayer.scale !== k || this.windowSlot !== slot) {
      if (!this.windowLayer.paint(k, (g) => drawWindows(g, now, light))) {
        drawWindows(ctx, now, light);
        return;
      }
      this.windowSlot = slot;
    }
    const b = this.windowLayer.baked;
    if (b) drawBaked(ctx, b);
  }

  /** relógio de parede: redesenhado só quando o segundo muda */
  private drawClockLayer(ctx: CanvasRenderingContext2D) {
    const k = this.scaleOf(ctx);
    const date = clockDate();
    const sec = Math.floor(date.getTime() / 1000);
    if (this.clockLayer.scale !== k || this.clockSec !== sec) {
      if (!this.clockLayer.paint(k, (g) => drawClock(g, date))) {
        drawClock(ctx, date);
        return;
      }
      this.clockSec = sec;
    }
    const b = this.clockLayer.baked;
    if (b) drawBaked(ctx, b);
  }

  /** apelido do AGzinho (plaquinha da mesa de convidado); visitante extra usa o nome */
  private nicknameOf(agent: Agent): string {
    const ag = agent.agzinho ? this.rosterData?.agzinhos.find((a) => a.key === agent.agzinho) : undefined;
    return ag?.apelido ?? agent.name;
  }

  /** brilho leve ("lighter") nas telas ligadas e na logo da placa, por cima do multiply */
  private drawEmissive(ctx: CanvasRenderingContext2D, scene: LightScene, night: number) {
    if (night <= 0.05) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.16 * night;
    ctx.fillStyle = palette.night.monitorLight;
    for (const r of scene.activeScreens) ctx.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    ctx.globalAlpha = 0.3 * night;
    drawSignGlow(ctx, this.logo);
    ctx.restore();
  }

  /** pose do descanso (objeto na mão, gesto no lugar), ou null fora do descanso */
  private restPose(v: Visual, now: number): RestPose | null {
    if (v.leaving) return null;
    return this.rest.pose(v.agent.id, now, !v.path.length);
  }

  /** animação em curso (só parado, no próprio lugar) e o progresso 0..1 */
  private animOf(v: Visual, now: number): { kind: CharAnim; t: number } | undefined {
    if (v.path.length) return undefined;
    const a = v.anim;
    if (a && now < a.until) return { kind: a.kind, t: (now - a.start) / (a.until - a.start) };
    const rest = this.restPose(v, now);
    // com reduced-motion o descanso continua (andar é preciso), mas o espreguiçar não se mexe
    if (!rest?.anim || (rest.anim === "stretch" && isReducedMotion())) return undefined;
    return { kind: rest.anim, t: rest.animT };
  }

  /**
   * Pose de desenho. Pra comemorar o personagem levanta da cadeira (atrás da mesa) e pula:
   * a mesa cobre pernas e sombra, e o tronco aparece mais acima do tampo a cada pulo.
   */
  private poseOf(v: Visual, now: number) {
    const anim = this.animOf(v, now);
    const seated = v.at.sitting && !v.path.length;
    const sitting = seated && !(anim?.kind === "cheer" && !isReducedMotion());
    const lift = animLift(anim?.kind, anim?.t ?? 0, isReducedMotion());
    return { anim, seated, sitting, lift };
  }

  private drawVisual(ctx: CanvasRenderingContext2D, v: Visual, now: number) {
    const { anim, seated, sitting } = this.poseOf(v, now);
    const x = v.x * TILE;
    const y = v.y * TILE;
    const selected = this.selectedId === v.agent.id;
    if ((selected || this.hoverId === v.agent.id) && !seated) {
      selectionRing(ctx, x, y, selected ? palette.navy900 : palette.navy500);
    }
    const rest = this.restPose(v, now);
    drawCharacter(ctx, x, y, v.look, {
      dir: v.dir,
      walking: v.path.length > 0,
      sitting,
      typing: !anim && sitting && v.agent.status === "trabalhando",
      t: now,
      phase: v.phase,
      seed: v.seed,
      alpha: v.fade,
      mood: MOOD[v.agent.status],
      anim: anim?.kind,
      animT: anim?.t ?? 0,
      holding: rest?.holding ?? (v.cupInHand ? "copo" : undefined),
      reducedMotion: isReducedMotion(),
    });
    if (seated && v.at.depth !== undefined && rest?.sofa && v.dir === "down") sofaShins(ctx, x, y, v.look.uniform.pants, v.look.uniform.shoes, v.fade);
  }

  private headPoint(v: Visual, now: number): Point {
    const { sitting, lift } = this.poseOf(v, now);
    return { x: v.x * TILE, y: v.y * TILE + (sitting ? HEAD_TOP_SIT : HEAD_TOP_STAND) + lift };
  }

  /** confete do comemorar: sai de cima da cabeça, cai com gravidade e some em ~800ms */
  private drawConfetti(ctx: CanvasRenderingContext2D, v: Visual, now: number) {
    const a = v.anim;
    if (!a || a.kind !== "cheer" || isReducedMotion() || v.path.length) return;
    const age = now - a.start - CONFETTI_AT_MS;
    if (age < 0 || age > CONFETTI_LIFE_MS) return;
    // origem fixa no mundo (não acompanha o pulo): acima da cabeça de quem está em pé
    const ox = v.x * TILE;
    const oy = v.y * TILE + HEAD_TOP_STAND - 2;
    const colors = [palette.navy900, palette.navy500, roleColor(v.agent.role)];
    const seed = hashString(`${v.agent.id}:${Math.round(a.start)}`);
    ctx.save();
    ctx.globalAlpha = age > CONFETTI_LIFE_MS - 200 ? (CONFETTI_LIFE_MS - age) / 200 : 1;
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      const r = (seed >>> (i * 3)) & 7; // 0..7 por partícula
      // leque pra cima, de -150° a -30°, com velocidades variadas (px/ms)
      const ang = (-150 + (120 * (i + r / 8)) / CONFETTI_COUNT) * (Math.PI / 180);
      const sp = 0.04 + r * 0.004;
      const px = Math.round(ox + Math.cos(ang) * sp * age);
      const py = Math.round(oy + Math.sin(ang) * sp * age + 0.5 * CONFETTI_GRAVITY * age * age);
      // 2x2 pra aparecer sobre o piso e os balões claros
      fill(ctx, px, py, 2, 2, colors[i % colors.length]);
    }
    ctx.restore();
  }

  private drawOverlay(ctx: CanvasRenderingContext2D, v: Visual, now: number) {
    if (v.fade <= 0.05) return;
    const head = this.headPoint(v, now);
    const selected = this.selectedId === v.agent.id || this.hoverId === v.agent.id;
    const status = v.agent.status;
    let top = head.y - 2;

    // ícone de status
    if (status === "esperando" && !v.leaving) {
      // selo marinho com borda e "!" laranja; a borda pisca entre laranja e branco
      // (com reduced-motion: parado e com a borda laranja fixa)
      const b = isReducedMotion() ? 0 : Math.round(Math.sin(now / 150) * 1.5);
      const sx = Math.round(head.x - 5);
      const sy = Math.round(top - 13 + b);
      const ring = !isReducedMotion() && Math.floor(now / 400) % 2 ? palette.white : palette.signal.waiting;
      roundBox(ctx, sx, sy, 10, 12, ring, palette.navy950);
      ctx.fillStyle = palette.navy900;
      ctx.fillRect(sx + 2, sy + 2, 6, 8);
      ctx.fillStyle = palette.signal.waiting;
      ctx.fillRect(sx + 4, sy + 3, 2, 4);
      ctx.fillRect(sx + 4, sy + 8, 2, 1);
      top -= 14;
    } else if (status === "pensando" && !v.path.length) {
      const k = Math.floor(now / 300) % 4;
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < k ? palette.white : "rgba(255,255,255,0.35)";
        ctx.fillRect(Math.round(head.x - 5 + i * 4), Math.round(top - 4), 2, 2);
      }
      top -= 6;
    }

    // balão: mensagem de chat > atividade recente > selecionado > esperando
    let text: string | null = null;
    let color: string = palette.white;
    if (v.chat && now < v.chat.until) {
      text = v.chat.text;
      color = palette.navy100;
    } else if (!v.leaving && (now - v.activityAt < BUBBLE_MS || selected || status === "esperando")) {
      text = v.agent.activity;
    }

    if (text) {
      drawBubble(ctx, head.x, top, head.y, text, color);
    } else {
      // só o nome
      ctx.font = `7px VT323, monospace`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      const name = v.agent.name;
      // quadradinho 2x2 na cor do papel antes do nome (+3 px na largura)
      const w = Math.round(ctx.measureText(name).width + 7);
      const lx = Math.round(head.x - w / 2);
      const ly = Math.round(top - 7);
      ctx.fillStyle = inkAlpha(0.7);
      ctx.fillRect(lx, ly, w, 7);
      fill(ctx, lx + 2, ly + 3, 2, 2, roleColor(v.agent.role));
      ctx.fillStyle = palette.white;
      ctx.fillText(name, lx + 5, top);
    }

    // confete por cima do balão
    this.drawConfetti(ctx, v, now);
  }

  private drawEnvelope(ctx: CanvasRenderingContext2D, e: Envelope, now: number) {
    const a = this.visuals.get(e.fromId);
    const b = this.visuals.get(e.toId);
    if (!a || !b) return;
    const p = Math.min(1, (now - e.start) / 1200);
    const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const ha = this.headPoint(a, now);
    const hb = this.headPoint(b, now);
    const x = ha.x + (hb.x - ha.x) * ease;
    const y = ha.y + (hb.y - ha.y) * ease - Math.sin(ease * Math.PI) * 26;
    // envelope branco com contorno marinho, aba em 1px e lacre navy900
    const ex = Math.round(x - 6);
    const ey = Math.round(y - 4);
    fill(ctx, ex, ey, 12, 9, palette.navy900);
    fill(ctx, ex + 1, ey + 1, 10, 7, palette.white);
    line(ctx, ex + 1, ey + 1, ex + 5, ey + 4, palette.navy300);
    line(ctx, ex + 10, ey + 1, ex + 6, ey + 4, palette.navy300);
    fill(ctx, ex + 5, ey + 4, 2, 2, palette.navy900);
  }

  // ------------------------------------------------------------ interação

  hitTest(bx: number, by: number): string | null {
    let best: { id: string; y: number } | null = null;
    for (const v of this.visuals.values()) {
      if (v.leaving) continue;
      const x = v.x * TILE;
      const y = v.y * TILE;
      if (bx >= x + HIT_BOX.left && bx <= x + HIT_BOX.right && by >= y + HIT_BOX.top && by <= y + HIT_BOX.bottom) {
        if (!best || y > best.y) best = { id: v.agent.id, y };
      }
    }
    return best?.id ?? null;
  }

  count() {
    return [...this.visuals.values()].filter((v) => !v.leaving).length;
  }
}

// ------------------------------------------------------------------ helpers de desenho

function roundBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, stroke: string) {
  x = Math.round(x);
  y = Math.round(y);
  ctx.fillStyle = stroke;
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
}

/**
 * Copo AG largado em cima de uma mesa: boca com café, corpo branco com faixa marinho, asa de 1px
 * à direita e contorno só nas bordas (sem caixa em volta). (x, y) = canto de cima do corpo.
 */
function drawCup(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const ink = palette.navy950;
  fill(ctx, x, y - 1, 3, 1, ink); // borda de cima
  fill(ctx, x - 1, y, 1, 4, ink); // lados
  fill(ctx, x + 3, y, 1, 4, ink);
  fill(ctx, x, y + 4, 3, 1, ink); // fundo
  fill(ctx, x, y, 3, 1, palette.furniture.woodShade); // café
  fill(ctx, x, y + 1, 3, 3, palette.white);
  fill(ctx, x, y + 2, 3, 1, palette.navy900);
  fill(ctx, x + 4, y + 1, 1, 2, ink); // asa
}

/**
 * Canelas e sapatos de quem está sentado no sofá, de frente: o sprite sentado não tem pernas
 * (na mesa o tampo esconde), e no sofá elas aparecem na frente do assento.
 */
function sofaShins(ctx: CanvasRenderingContext2D, x: number, y: number, pants: string, shoes: string, alpha: number) {
  const bx = Math.round(x);
  const by = Math.round(y);
  ctx.save();
  ctx.globalAlpha = alpha;
  fill(ctx, bx - 5, by - 4, 10, 7, palette.navy950);
  for (const lx of [bx - 4, bx + 1]) {
    fill(ctx, lx, by - 4, 3, 5, pants);
    fill(ctx, lx, by + 1, 3, 1, shoes);
  }
  ctx.restore();
}

/** anel de seleção em pixel (oval 17x7, da largura da HIT_BOX) no chão, embaixo do personagem */
function selectionRing(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  x = Math.round(x);
  y = Math.round(y);
  fill(ctx, x - 5, y - 3, 11, 1, color);
  fill(ctx, x - 7, y - 2, 2, 1, color);
  fill(ctx, x + 6, y - 2, 2, 1, color);
  fill(ctx, x - 8, y - 1, 1, 3, color);
  fill(ctx, x + 8, y - 1, 1, 3, color);
  fill(ctx, x - 7, y + 2, 2, 1, color);
  fill(ctx, x + 6, y + 2, 2, 1, color);
  fill(ctx, x - 5, y + 3, 11, 1, color);
}

const BUBBLE_INK = palette.navy900;
const BUBBLE_BORDER = palette.navy950;

/**
 * Balão de fala acima da cabeça. Se ele cairia em cima da placa da logo (líder sentado ou
 * andando perto dela), vai pro lado da cabeça, logo abaixo da placa, com o rabinho virado pra ela.
 */
function drawBubble(ctx: CanvasRenderingContext2D, cx: number, bottom: number, headY: number, text: string, bg: string) {
  ctx.font = `8px VT323, monospace`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const maxW = 120;
  const lines = wrap(ctx, text, maxW - 8).slice(0, 2);
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const w = Math.ceil(tw + 8);
  const h = lines.length * 8 + 4;
  let x = Math.round(cx - w / 2);
  x = Math.max(2, Math.min(W - w - 2, x));
  let y = Math.round(bottom - h - 4);
  const signBottom = SIGN.y + SIGN.h;
  const overSign = y < signBottom && x < SIGN.x + SIGN.w && x + w > SIGN.x;
  if (overSign) {
    // ao lado: à esquerda da cabeça (ou à direita, se não couber), centrado na altura do rosto
    const left = cx - 10 - w >= 2;
    x = Math.round(left ? cx - 10 - w : cx + 10);
    y = Math.max(signBottom + 1, Math.round(headY + 2 - h / 2));
    roundBox(ctx, x, y, w, h, bg, BUBBLE_BORDER);
    const ty = Math.round(Math.max(y + 2, Math.min(y + h - 7, headY)));
    // rabinho lateral apontando pra cabeça
    const ex = left ? x + w - 1 : x;
    const s = left ? 1 : -1;
    ctx.fillStyle = BUBBLE_BORDER;
    ctx.fillRect(left ? ex : ex - 1, ty, 2, 5);
    ctx.fillRect(ex + 2 * s, ty + 1, 1, 3);
    ctx.fillRect(ex + 3 * s, ty + 2, 1, 1);
    ctx.fillStyle = bg;
    ctx.fillRect(ex, ty + 1, 1, 3);
    ctx.fillRect(ex + s, ty + 2, 1, 1);
  } else {
    roundBox(ctx, x, y, w, h, bg, BUBBLE_BORDER);
    // rabinho
    const tx = Math.round(Math.max(x + 3, Math.min(x + w - 6, cx - 2)));
    ctx.fillStyle = BUBBLE_BORDER;
    ctx.fillRect(tx, y + h - 1, 5, 2);
    ctx.fillRect(tx + 1, y + h + 1, 3, 1);
    ctx.fillRect(tx + 2, y + h + 2, 1, 1);
    ctx.fillStyle = bg;
    ctx.fillRect(tx + 1, y + h - 1, 3, 1);
    ctx.fillRect(tx + 2, y + h, 1, 1);
  }
  ctx.fillStyle = BUBBLE_INK;
  lines.forEach((l, i) => ctx.fillText(l, x + 4, y + 6 + i * 8));
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > 2) lines[1] = lines[1].replace(/.{0,2}$/, "…");
  return lines;
}
