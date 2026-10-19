// Motor do escritório: guarda a posição de cada personagem, decide pra onde ele vai
// (mesa, reunião, porta e, quando está de boa, o descanso do agendador em activities.ts),
// anda pelos caminhos e desenha tudo no canvas.

import type { AGzinho, Acessorio, Agent, Progress, ReuniaoAtiva, Roster } from "../../../shared/types";
import { textoDoProgresso, type TextoProgresso } from "../progresso";
import { HAIR_STYLE_INDEX } from "../../../shared/roster";
import { ehVisitante } from "../../../shared/visitante";
import { rotulosDasMesas } from "./deskLabel";
import { HAIRS, SKINS, palette, roleColor, theme, uniformFor, uniformForAgzinho } from "../theme";
import { AreaLayer, bakeCount, bakeDrawing, drawBaked, type Baked } from "./bake";
import { RestScheduler, type RallyFrame, type RestActor, type RestMover, type RestPose } from "./activities";
import { mostraBalaoDeTrabalho, placeBubbles, type BubbleReq, type FloatReq, type Placement } from "./bubbles";
import {
  NAME_FONT,
  NAME_SHIFTS,
  REST_FONT,
  REST_H,
  REST_MAX_W,
  WORK_FONT,
  WORK_MAX_W,
  drawBubbleAt,
  drawNameTag,
  drawThinkDots,
  drawWaitBadge,
  noLigatures,
  textosDoNome,
  wrap,
  type BubbleStyle,
} from "./overlay";
import { drawBall } from "./pingpong";
import { drawPingPongTable, fill, line, type Rect } from "./decor";
import { Lightmap, clockDate, windowLight, type LightScene } from "./daylight";
import { isReducedMotion } from "./motion";
import { desenharPlaca, escolherPortador, lugarDaPlaca } from "./placaAtrasada";
import { atribuirReuniao, type CandidatoReuniao } from "./reuniao";
import {
  AISLE_Y,
  BOARD,
  DESKS,
  DOOR_SPOT,
  MEETING_PRESENTER,
  MEETING_SEATS,
  MEETING_STOOLS,
  OVERFLOW_SPOTS,
  PAPO_PLACES,
  PINGPONG,
  PINGPONG_SPOTS,
  POCKET_PLAQUE,
  PROPS,
  REST_SPOTS,
  SIGN,
  TILE,
  H,
  W,
  deskPlateRect,
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
  drawStool,
  drawSign,
  drawSignGlow,
  monitorScreen,
  cupSurface,
  route,
  type BoardData,
  type CupSurface,
  type Desk,
  type Point,
  type Spot,
} from "./map";
import { clearSpriteCache, spriteCacheStats } from "./spriteCache";
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

const PROGRESSO_NADA: Progress = { fonte: "nada", etapa: 0, total: 0, concluidas: 0, titulo: "" };

const SPEED = 3.4; // tiles por segundo
/** as janelas são refeitas nesse intervalo (nuvens e guindaste andam menos de 1px nesse tempo) */
const WINDOW_FRAME_MS = 200;
/** chave do cache da mesa de reunião */
const MEETING_TABLE = {};
/** lugares da reunião por id (o motor guarda só o id de cada um) */
const MEETING_SPOTS = new Map<string, Spot>([MEETING_PRESENTER, ...MEETING_SEATS].map((s) => [s.id, s]));
const MEETING_SEAT_IDS = MEETING_SEATS.map((s) => s.id);
const PRESENTING_TEXT = "Apresentando a reunião";
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

/** balão de descanso (fala do papo): fica 2,5–3 s, no máximo 2 na tela, 1 a cada 12 s por AGzinho */
const REST_BUBBLE_MIN_MS = 2500;
const REST_BUBBLE_MAX_MS = 3000;
const REST_BUBBLE_MAX = 2;
const REST_BUBBLE_GAP_MS = 12_000;
/** sem lugar: a fala espera na fila, tenta de novo a cada 300 ms e desiste em 10 s */
const REST_RETRY_MS = 300;
const REST_GIVEUP_MS = 10_000;
/** quem não é do elenco (visitante extra) também puxa assunto */
const FALAS_VISITANTE = ["Tudo certo por aí?", "Bora um café depois?", "Que semana, hein!"];

/** prioridade no layout (menor entra primeiro) */
const PRI = { badge: 0, waiting: 0.5, work: 1, chat: 2, rest: 3, name: 4 } as const;

/**
 * Onde os balões e nomes não podem ficar (com 1 px de folga): placa, quadro, AG POCKET, plaquinhas
 * e o tampo do ping-pong (o nome de quem joga embaixo cobria a bolinha).
 */
const FORBIDDEN: Rect[] = [SIGN, BOARD, POCKET_PLAQUE, PINGPONG, ...DESKS.map((d) => deskPlateRect(d))].map((r) => ({
  x: r.x - 1,
  y: r.y - 1,
  w: r.w + 2,
  h: r.h + 2,
}));
const BOUNDS: Rect = { x: 1, y: 1, w: W - 2, h: H - 2 };



/** status em que o agente está "na tarefa" (vale espreguiçar ao ficar de boa) */
const BUSY = new Set<Agent["status"]>(["trabalhando", "pensando", "esperando"]);
/** "chegando" há mais que isso (ex.: estado restaurado depois de reiniciar o servidor) já está na mesa */
const ARRIVED_AFTER_MS = 15_000;

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

/** líder da sessão (não foi chamado por ninguém); subagentes têm parentId */
export function ehLider(agent: Agent): boolean {
  return !agent.parentId;
}

/** AGzinho do elenco que o agente está usando (undefined no visitante extra ou sem elenco) */
export function agzinhoOf(agent: Agent, roster: Roster | null): AGzinho | undefined {
  return agent.agzinho ? roster?.agzinhos.find((a) => a.key === agent.agzinho) : undefined;
}

/** Aparência do AGzinho do elenco; sem elenco ou visitante extra, a de sempre (papel + hash do id). */
export function lookFor(agent: Agent, roster: Roster | null): CharLook {
  const ag = agzinhoOf(agent, roster);
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
  /** último evento de trabalho visto (status ocupado): bloqueia o descanso por WORK_COOLDOWN_MS */
  workedAt: number;
  activityAt: number;
  leaving: boolean;
  fade: number; // 1 → 0 ao sair pela porta
  chat?: { text: string; until: number };
  anim?: { kind: CharAnim; start: number; until: number };
  /** largou o descanso com o copo de café: leva na mão até a mesa e deixa lá */
  cupInHand?: boolean;
  /** pose do quadro atual (calculada uma vez por quadro e usada no boneco, no copo e nos balões) */
  memo?: { at: number; rest: RestPose | null; pose?: PoseInfo };
}

/** linhas e tamanho de um balão */
interface BubbleLayout {
  lines: string[];
  w: number;
  h: number;
}

/** o que cada personagem pede pro overlay neste quadro */
interface OverlayItem {
  v: Visual;
  id: string;
  head: Point;
  top: number;
  badge: "esperando" | "pensando" | null;
  bubble?: { text: string; style: BubbleStyle; priority: number; lay: BubbleLayout };
  selected: boolean;
}

/** resultado do layout (balões e nomes colocados) e a assinatura que o gerou */
interface OverlayPlan {
  sig: string;
  bubbles: Map<string, Placement>;
  names: Map<string, Placement>;
}

/** pose de desenho de um quadro */
interface PoseInfo {
  anim?: { kind: CharAnim; t: number };
  seated: boolean;
  sitting: boolean;
  lift: number;
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
  /** segura a plaquinha de atrasada */
  placa: boolean;
}

declare global {
  interface Window {
    /** debug: quem está descansando, onde e em que fase */
    __agRest?: () => RestDebugRow[];
    /** debug: momento da partida de ping-pong (null sem partida) */
    __agRally?: () => RallyFrame | null;
    /** debug: balões e nomes do último quadro e as zonas proibidas (retângulos em px base) */
    /** debug: contadores de cache (assados, chaves de móveis, sprites) */
    __agPerf?: () => { bakes: number; bakedByName: number; sprites: ReturnType<typeof spriteCacheStats> };
    __agBubbles?: () => { placed: ({ id: string; side: string } & Rect)[]; forbidden: Rect[] };
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
  /** elenco por chave (falas, apelido e nome curto sem procurar na lista a cada quadro) */
  private agzByKey = new Map<string, AGzinho>();
  /** descanso de quem está de boa; as reservas também guardam quem mora em pé na reunião */
  private rest: RestScheduler;
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
  /** quadro de etapas (BOARD + sombra e bandeja); redesenhado só quando o conteúdo muda */
  private boardLayer = new AreaLayer({ x: BOARD.x, y: BOARD.y, w: BOARD.w + 1, h: BOARD.h + 3 });
  private boardKey = "";
  private progresso: TextoProgresso = textoDoProgresso(PROGRESSO_NADA);
  /** reunião em curso (vinda do servidor) e quem está em qual lugar dela (id do visual → id do lugar) */
  private reuniaoAtiva: ReuniaoAtiva | null = null;
  private meeting = new Map<string, string>();
  /**
   * Reservas feitas pela reunião (lugar → id): quem senta num lugar que também é da maquete
   * (reuniao:0/1) reserva o lugar, e o descanso não põe ninguém em pé ali por cima dele.
   */
  private meetingHolds = new Map<string, string>();
  /** buffers do updateMeeting (reusados a cada quadro) */
  private meetingCands: CandidatoReuniao[] = [];
  private meetingOwners = new Map<string, string>();
  /** nome da missão da reunião, pro quadro da parede */
  private missaoNome: string | undefined;
  /** quantas pendências estão atrasadas (vindo do painel) e quem segura a plaquinha de aviso por causa delas */
  private atrasadasN = 0;
  private placaId: string | null = null;
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
    say: (id, text) => this.queueRestLine(id, text, performance.now()),
  };
  /**
   * Falas de descanso aceitas (id → texto e até quando). `shown`: já apareceu num quadro; se não
   * aparecer, volta pra fila (com o `queuedAt` original) e o `lastRestAt` volta a `prevAt`.
   */
  private restBubbles = new Map<string, { text: string; until: number; shown: boolean; queuedAt: number; prevAt?: number }>();
  /** falas esperando lugar (desistem em REST_GIVEUP_MS) */
  private restQueue: { id: string; text: string; at: number }[] = [];
  private lastRestAt = new Map<string, number>();
  private restTryAt = 0;
  /** candidato usado por cada balão/nome no quadro anterior (evita ficar pulando de lado) */
  private prevCand = new Map<string, number>();
  /** retângulos dos balões (sem os nomes) do quadro anterior: a fila de descanso testa contra eles */
  private lastRects: Rect[] = [];
  private lastPlaced: Placement[] = [];
  /** larguras de texto medidas (fonte → texto → px) */
  private textW = new Map<string, Map<string, number>>();
  /** linhas e tamanho de cada balão (estilo|texto → layout) */
  private layoutCache = new Map<string, BubbleLayout>();
  /** nome inteiro → [inteiro, primeiro nome] */
  private nameCache = new Map<string, readonly string[]>();
  /** layout do overlay do último quadro; refeito só quando a assinatura muda */
  private plan: OverlayPlan | null = null;
  selectedId: string | null = null;
  hoverId: string | null = null;
  onSelect?: (id: string | null) => void;

  /** `restSeed`: semente do sorteio do descanso (os testes fixam; na tela é o relógio) */
  constructor(opts: { restSeed?: number } = {}) {
    this.rest = new RestScheduler(REST_SPOTS, { seed: opts.restSeed ?? Date.now() | 0, pingpong: PINGPONG_SPOTS, papoPlaces: PAPO_PLACES });
    // (Image e import.meta.env só existem no navegador/vite: os testes do motor rodam no node)
    if (theme.logoUrl && typeof Image !== "undefined") {
      const img = new Image();
      img.src = theme.logoUrl;
      this.logo = img;
    }
    // debug (só no dev server): `__agRest()` no console lista quem está descansando, onde e em que fase
    if (import.meta.env?.DEV && typeof window !== "undefined") {
      window.__agRest = () => this.restDebug();
      window.__agRally = () => this.rest.rally(performance.now());
      window.__agPerf = () => ({ bakes: bakeCount(), bakedByName: this.bakedByName.size, sprites: spriteCacheStats() });
      window.__agBubbles = () => ({ placed: this.lastPlaced.map((p) => ({ id: p.id, side: p.side, ...p.rect })), forbidden: FORBIDDEN });
    }
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
      placa: this.placaId === v.agent.id,
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
    this.agzByKey = new Map((roster?.agzinhos ?? []).map((a) => [a.key, a]));
    clearSpriteCache();
    for (const v of this.visuals.values()) v.look = lookFor(v.agent, roster);
  }

  /** andamento vindo do servidor (snapshot e mensagem "progress") */
  set progress(p: Progress | null) {
    this.progresso = textoDoProgresso(p ?? PROGRESSO_NADA);
  }

  /** reunião ligada: o líder apresenta e os ociosos sentam em volta da mesa; null manda todos pra casa */
  set reuniao(r: ReuniaoAtiva | null) {
    this.reuniaoAtiva = r;
    if (!r) {
      this.meeting.clear();
      this.releaseMeetingHolds();
    }
  }

  /** nome da missão em andamento (só as que nasceram de reunião); some do quadro com null */
  set missao(nome: string | null | undefined) {
    this.missaoNome = nome || undefined;
  }

  /** pendências atrasadas: com pelo menos uma, um AGzinho de boa segura a plaquinha de aviso */
  set atrasadas(n: number) {
    this.atrasadasN = Math.max(0, Math.floor(n) || 0);
  }

  // ------------------------------------------------------------ dados do servidor

  sync(todos: Agent[]) {
    // visitante excedente (além dos 3 da tela) não é desenhado; ele entra quando um dos 3 sai
    const agents = todos.filter((a) => !a.excedente);
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
    // evento de trabalho: o descanso fica bloqueado por um tempo (a entrega, ocupado→ocioso, não conta)
    if (BUSY.has(agent.status)) v.workedAt = now;
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
    // quem já estava trabalhando quando a tela abriu aparece direto na mesa; "chegando" também,
    // se entrou faz tempo (a caminhada da porta já teria acabado)
    const startAtHome = fromSnapshot && (agent.status !== "chegando" || Date.now() - agent.startedAt > ARRIVED_AFTER_MS);
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
      workedAt: BUSY.has(agent.status) ? performance.now() : -Infinity,
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
    // lugar que a reunião ocupava: a casa vence; no próximo quadro o updateMeeting vê o novo dono
    // e muda o participante de lugar
    const hold = this.meetingHolds.get(spot.id);
    if (hold !== undefined) {
      res.release(spot.id, hold);
      this.meetingHolds.delete(spot.id);
    }
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
    this.updateMeeting(now);
    const actors: RestActor[] = [];
    for (const v of this.visuals.values()) {
      if (v.anim && now >= v.anim.until) v.anim = undefined;
      actors.push({
        id: v.agent.id,
        session: v.agent.sessionId,
        // visitante nunca entra no descanso (sai ao entregar; "de boa" é só do elenco fixo)
        idle: v.agent.status === "ocioso" && !ehVisitante(v.agent) && !this.meeting.has(v.agent.id),
        idleSince: v.idleSince,
        workedAt: BUSY.has(v.agent.status) ? now : v.workedAt,
        leaving: v.leaving,
        walking: v.path.length > 0,
        busyAnim: !!v.anim,
        atId: v.at.id,
        homeId: v.home.id,
        hasDesk: !!v.deskId,
        x: v.x * TILE,
        y: v.y * TILE,
        falas: this.falasOf(v.agent),
      });
    }
    this.rest.update(now, actors, this.mover);

    for (const v of this.visuals.values()) {
      // fora do descanso, o lugar de cada um é a própria mesa (ou o da reunião, enquanto ela dura)
      const place = this.placeOf(v);
      if (!v.leaving && !this.rest.isResting(v.agent.id) && v.target.id !== place.id) this.goTo(v, place);

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
      // no papo, em pé: olha pra quem está falando
      const face = v.path.length ? undefined : this.rest.face(v.agent.id);
      if (face && v.at.id === v.target.id) v.dir = face;
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
   * Reavalia a cada quadro quem está na reunião; quem estava descansando larga o descanso.
   * reuniao:0/1 são também a casa de quem mora em pé e a maquete do descanso: um lugar reservado
   * por alguém de fora da reunião fica só pra ele (atribuirReuniao pula), e o lugar que a reunião
   * ocupa fica reservado enquanto ela usa (o descanso não manda ninguém pra lá).
   */
  private updateMeeting(now: number) {
    const r = this.reuniaoAtiva;
    if (!r) return;
    const cands = this.meetingCands;
    let n = 0;
    for (const v of this.visuals.values()) {
      const c = cands[n] ?? (cands[n] = { id: "", status: "ocioso", visitante: false, saindo: false });
      c.id = v.agent.id;
      c.status = v.agent.status;
      c.visitante = ehVisitante(v.agent);
      c.saindo = v.leaving;
      n++;
    }
    cands.length = n;

    const res = this.rest.reservations;
    const owners = this.meetingOwners;
    owners.clear();
    for (const seat of MEETING_SEAT_IDS) {
      const holder = res.holder(seat);
      // a reserva feita pela própria reunião não conta: quem fica com o lugar é o `anterior` que decide
      if (holder !== undefined && this.meetingHolds.get(seat) !== holder) owners.set(seat, holder);
    }
    this.meeting = atribuirReuniao(r.liderId, cands, this.meeting, MEETING_PRESENTER.id, MEETING_SEAT_IDS, owners);

    for (const [seat, id] of this.meetingHolds) {
      if (this.meeting.get(id) === seat) continue;
      res.release(seat, id);
      this.meetingHolds.delete(seat);
    }
    for (const [id, seat] of this.meeting) {
      // larga o descanso antes: quem estava na maquete e recebeu o mesmo lugar não fica um quadro sem reserva
      if (this.rest.isResting(id)) this.rest.interrupt(id, this.mover, now);
      // só reserva lugar livre (a casa de quem mora ali já é dele e não pode ser solta ao sair)
      if (seat !== MEETING_PRESENTER.id && res.holder(seat) === undefined && res.reserve(seat, id)) this.meetingHolds.set(seat, id);
    }
  }

  /** a reunião acabou: devolve os lugares que ela tinha reservado */
  private releaseMeetingHolds() {
    for (const [seat, id] of this.meetingHolds) this.rest.reservations.release(seat, id);
    this.meetingHolds.clear();
  }

  /** lugar de quem fica parado: o da reunião, se tem um, senão a própria mesa */
  private placeOf(v: Visual): Spot {
    const id = this.meeting.get(v.agent.id);
    return (id && MEETING_SPOTS.get(id)) || v.home;
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

  /** falas do bate-papo: as do AGzinho no elenco; visitante extra usa umas genéricas */
  private falasOf(agent: Agent): readonly string[] {
    const ag = agent.agzinho ? this.agzByKey.get(agent.agzinho) : undefined;
    return ag?.falas.length ? ag.falas : FALAS_VISITANTE;
  }

  /** fala nova do papo: entra na fila (uma por AGzinho; a nova substitui a que ainda esperava) */
  private queueRestLine(id: string, text: string, now: number) {
    const q = this.restQueue.find((e) => e.id === id);
    if (q) {
      q.text = text;
      q.at = now;
    } else this.restQueue.push({ id, text, at: now });
  }

  /** "Tomando café", "No celular"... (crachá da etapa 6); null se não está descansando */
  restLabel(id: string): string | null {
    return this.rest.restLabel(id);
  }

  /** Tem algum AGzinho sentado digitando agora? (mesmo critério do `typing` do desenho; alimenta o som do teclado) */
  alguemDigitando(): boolean {
    const now = performance.now();
    for (const v of this.visuals.values()) {
      if (v.leaving || v.agent.status !== "trabalhando") continue;
      const { anim, sitting } = this.poseOf(v, now);
      if (!anim && sitting) return true;
    }
    return false;
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
    this.placaId = this.escolherPlaca(active, now);
    // TIME não conta visitante; FAZENDO é quem está trabalhando no mapa (time + visitantes visíveis)
    this.drawBoardLayer(ctx, {
      progresso: this.progresso,
      total: active.filter((v) => !ehVisitante(v.agent)).length,
      visitors: active.filter((v) => ehVisitante(v.agent)).length,
      working: active.filter((v) => v.agent.status === "trabalhando" || v.agent.status === "pensando").length,
      waiting: active.filter((v) => v.agent.status === "esperando").length,
      missao: this.missaoNome,
    });

    // objetos com profundidade, desenhados de cima pra baixo
    const items: { y: number; draw: () => void }[] = [];

    const occupants = DESKS.map((d) => visuals.find((v) => v.deskId === d.id && !v.leaving));
    // a função de quem está em cada mesa (ex.: DESENVOLVIMENTO 2 com a dev-2); vazia, a do setor ou LIVRE
    const labels = rotulosDasMesas(
      DESKS.map((d, i) => ({ papel: d.role, quem: occupants[i]?.agent ?? null })),
      this.rosterData?.agzinhos ?? [],
    );
    for (const [i, d] of DESKS.entries()) {
      const seated = seatedAt.get(d.id);
      const deskTop = (d.cy + 0.55) * TILE;
      items.push({ y: (d.cy + 0.85) * TILE - 1, draw: () => this.drawBakedOr(ctx, d, (g) => drawChair(g, d, roleColor(d.role === "convidado" ? "convidado" : d.role))) });
      items.push({
        y: deskTop + 20,
        draw: () => {
          const opts = {
            active: !!seated && (seated.agent.status === "trabalhando" || seated.agent.status === "pensando"),
            waiting: !!seated && seated.agent.status === "esperando",
            label: labels[i],
            t: now,
            reducedMotion: isReducedMotion(),
          };
          // monitor desligado não anima: a mesa fica pronta no cache (uma por plaquinha)
          if (opts.active || opts.waiting) drawDesk(ctx, d, opts);
          else this.drawBakedOr(ctx, `mesa|${d.id}|${opts.label}`, (g) => drawDesk(g, d, opts));
        },
      });
    }
    items.push({ y: 11.2 * TILE + 10, draw: () => this.drawBakedOr(ctx, MEETING_TABLE, drawMeetingTable) });
    // banquinhos da reunião: sempre aqui, ordenados por profundidade (quem senta vem logo depois)
    for (const s of MEETING_STOOLS) items.push({ y: s.y * TILE + 2, draw: () => this.drawBakedOr(ctx, s, (g) => drawStool(g, s.x * TILE, s.y * TILE)) });
    items.push({ y: 16.1 * TILE, draw: () => drawCoffeeCorner(ctx, now, coffeeBusy, isReducedMotion()) });
    const inPlay = this.rest.pingpongInUse();
    for (const p of PROPS) {
      if (p.id === "pingpong" && inPlay) {
        // jogando: as raquetes estão na mão e a bolinha no ar
        const T = PINGPONG;
        items.push({ y: p.y, draw: () => this.drawBakedOr(ctx, "pingpong|jogo", (g) => drawPingPongTable(g, T.x, T.y, T.w, T.h, false)) });
        continue;
      }
      items.push({ y: p.y, draw: () => (p.live ? p.draw(ctx, isReducedMotion() ? -1 : now) : this.drawBakedOr(ctx, p, (g) => p.draw(g, now))) });
    }
    const rally = this.rest.rally(now);
    // depois da mesa (e de quem joga do lado de cima), antes de quem joga do lado de baixo
    if (rally) items.push({ y: PINGPONG.y + PINGPONG.h + 8.5, draw: () => drawBall(ctx, rally) });
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

    // plaquinha de atrasada: depois dos móveis, para nunca ficar atrás do monitor de quem está sentado
    const portador = this.placaId ? this.visuals.get(this.placaId) : undefined;
    if (portador) {
      const lugar = lugarDaPlaca(portador.x * TILE, portador.y * TILE, FORBIDDEN);
      if (lugar) desenharPlaca(ctx, lugar.rect, now, !isReducedMotion());
    }

    // iluminação: escurece cenário e personagens; o que vem depois (envelopes, "!", balões,
    // nomes, confete) fica fora do multiply e continua legível à noite
    this.lightmap.apply(ctx);
    this.drawEmissive(ctx, scene, daylight.night);

    // camada de cima: envelopes, balões e nomes (um passe de layout sem sobreposição)
    for (const e of this.envelopes) this.drawEnvelope(ctx, e, now);
    this.drawOverlays(ctx, visuals, now);
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
    // a camada continua sendo refeita a cada WINDOW_FRAME_MS (a luz do dia muda), mas com
    // reduced-motion as nuvens, o guindaste e o elevador de obra ficam parados (tempo 0)
    const slot = Math.floor(now / WINDOW_FRAME_MS);
    const t = isReducedMotion() ? 0 : now;
    if (this.windowLayer.scale !== k || this.windowSlot !== slot) {
      if (!this.windowLayer.paint(k, (g) => drawWindows(g, t, light))) {
        drawWindows(ctx, t, light);
        return;
      }
      this.windowSlot = slot;
    }
    const b = this.windowLayer.baked;
    if (b) drawBaked(ctx, b);
  }

  /** quadro de etapas: redesenhado só quando o progresso, os contadores, a escala ou a fonte mudam */
  private drawBoardLayer(ctx: CanvasRenderingContext2D, data: BoardData) {
    const k = this.scaleOf(ctx);
    const fontOk = typeof document !== "undefined" && !!document.fonts?.check("8px VT323");
    const key = `${k}|${fontOk}|${JSON.stringify(data)}`;
    if (this.boardKey !== key) {
      if (!this.boardLayer.paint(k, (g) => drawBoard(g, data, k))) {
        drawBoard(ctx, data, k);
        return;
      }
      this.boardKey = key;
    }
    const b = this.boardLayer.baked;
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
    if (v.memo?.at === now) return v.memo.rest;
    const rest = v.leaving ? null : this.rest.pose(v.agent.id, now, !v.path.length);
    v.memo = { at: now, rest };
    return rest;
  }

  /** animação em curso (só parado, no próprio lugar) e o progresso 0..1 */
  private animOf(v: Visual, now: number): { kind: CharAnim; t: number } | undefined {
    if (v.path.length) return undefined;
    const a = v.anim;
    if (a && now < a.until) return { kind: a.kind, t: (now - a.start) / (a.until - a.start) };
    // o líder parado no lugar da apresentação gesticula (com reduced-motion fica parado, com o braço erguido)
    if (this.meeting.get(v.agent.id) === MEETING_PRESENTER.id && v.at.id === MEETING_PRESENTER.id && v.target.id === v.at.id) {
      return { kind: "present", t: 0 };
    }
    const rest = this.restPose(v, now);
    // com reduced-motion o descanso continua (andar é preciso), mas o espreguiçar não se mexe
    if (!rest?.anim || (rest.anim === "stretch" && isReducedMotion())) return undefined;
    return { kind: rest.anim, t: rest.animT };
  }

  /**
   * Pose de desenho. Pra comemorar o personagem levanta da cadeira (atrás da mesa) e pula:
   * a mesa cobre pernas e sombra, e o tronco aparece mais acima do tampo a cada pulo.
   */
  private poseOf(v: Visual, now: number): PoseInfo {
    const cached = v.memo?.at === now ? v.memo.pose : undefined;
    if (cached) return cached;
    const anim = this.animOf(v, now);
    const seated = v.at.sitting && !v.path.length;
    const sitting = seated && !(anim?.kind === "cheer" && !isReducedMotion());
    const lift = animLift(anim?.kind, anim?.t ?? 0, isReducedMotion());
    const pose = { anim, seated, sitting, lift };
    // animOf já guardou o restPose deste quadro em v.memo
    if (v.memo?.at === now) v.memo.pose = pose;
    else v.memo = { at: now, rest: this.restPose(v, now), pose };
    return pose;
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
    if (seated && v.at.stool) stoolShins(ctx, x, y, v.dir, v.look.uniform.pants, v.look.uniform.shoes, v.fade);
  }

  /** quem segura a plaquinha de atrasada neste quadro: do time (não líder, não visitante), de boa, parado e sem atividade de descanso em curso */
  private escolherPlaca(ativos: Visual[], now: number): string | null {
    if (this.atrasadasN <= 0) return null;
    const elegiveis = ativos
      .filter((v) => {
        if (v.fade < 0.95 || v.agent.status !== "ocioso" || !v.agent.parentId || ehVisitante(v.agent)) return false;
        if (v.path.length || this.meeting.has(v.agent.id)) return false;
        return !this.animOf(v, now) && !this.restPose(v, now) && !v.cupInHand; // sem atividade de descanso em curso
      })
      .map((v) => v.agent.id);
    return escolherPortador(true, elegiveis, this.placaId);
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

  /** topo da cabeça e onde os balões terminam (acima do "!" ou dos pontinhos, se houver) */
  private anchorOf(v: Visual, now: number): { head: Point; top: number; badge: "esperando" | "pensando" | null } {
    const head = this.headPoint(v, now);
    const status = v.agent.status;
    if (status === "esperando" && !v.leaving) return { head, top: head.y - 2 - 14, badge: "esperando" };
    if (status === "pensando" && !v.path.length) return { head, top: head.y - 2 - 6, badge: "pensando" };
    return { head, top: head.y - 2, badge: null };
  }

  /**
   * Qual balão o personagem mostra: pedido de permissão > chat (envelope) > atividade recente >
   * fala do papo (só enquanto está no papo) > atividade de quem está selecionado. O ocioso só livre
   * ("De boa") não tem balão de trabalho, só as falas do descanso e o nome (mostraBalaoDeTrabalho).
   */
  private bubbleOf(v: Visual, now: number, selected: boolean): { text: string; style: BubbleStyle; priority: number } | null {
    const status = v.agent.status;
    if (!v.leaving && status === "esperando") return { text: v.agent.activity, style: "trabalho", priority: PRI.waiting };
    if (v.chat && now < v.chat.until) return { text: v.chat.text, style: "chat", priority: PRI.chat };
    if (v.leaving) return null;
    const trabalho = mostraBalaoDeTrabalho(status, v.agent.activity, ehLider(v.agent));
    if (trabalho && now - v.activityAt < BUBBLE_MS) return { text: v.agent.activity, style: "trabalho", priority: PRI.work };
    // apresentando: só quando não há atividade recente do líder (o trabalho de verdade vem antes).
    // O balão fica acima ou do lado da cabeça (y < 150 px), longe da maquete (y >= 164 px).
    if (!v.path.length && this.meeting.get(v.agent.id) === MEETING_PRESENTER.id && v.at.id === MEETING_PRESENTER.id) {
      return { text: PRESENTING_TEXT, style: "trabalho", priority: PRI.work };
    }
    const line = this.restBubbles.get(v.agent.id);
    if (line && now < line.until && this.rest.kind(v.agent.id) === "papo") return { text: line.text, style: "descanso", priority: PRI.rest };
    if (selected && trabalho) return { text: v.agent.activity, style: "trabalho", priority: PRI.work };
    return null;
  }

  /** largura do texto, guardada por fonte e texto */
  private measure(ctx: CanvasRenderingContext2D, font: string, text: string): number {
    let byText = this.textW.get(font);
    if (!byText) this.textW.set(font, (byText = new Map()));
    let w = byText.get(text);
    if (w === undefined) {
      if (byText.size > 400) byText.clear();
      ctx.font = font;
      w = ctx.measureText(text).width;
      byText.set(text, w);
    }
    return w;
  }

  /** linhas e tamanho de um balão (guardados por estilo e texto) */
  private bubbleLayout(ctx: CanvasRenderingContext2D, text: string, style: BubbleStyle): BubbleLayout {
    const key = `${style}|${text}`;
    const hit = this.layoutCache.get(key);
    if (hit) return hit;
    let lay: BubbleLayout;
    if (style === "descanso") {
      // uma linha só, letra menor; se passar de REST_MAX_W, corta com reticências
      let t = noLigatures(text);
      while (t.length > 1 && this.measure(ctx, REST_FONT, t) > REST_MAX_W - 6) t = `${t.slice(0, -2).trimEnd()}…`;
      lay = { lines: [t], w: Math.ceil(this.measure(ctx, REST_FONT, t) + 6), h: REST_H };
    } else {
      ctx.font = WORK_FONT;
      const lines = wrap(ctx, noLigatures(text), WORK_MAX_W - 8).slice(0, 2);
      const tw = Math.max(...lines.map((l) => this.measure(ctx, WORK_FONT, l)));
      lay = { lines, w: Math.ceil(tw + 8), h: lines.length * 8 + 4 };
    }
    if (this.layoutCache.size > 300) this.layoutCache.clear();
    this.layoutCache.set(key, lay);
    return lay;
  }

  /** pedido de layout de um balão em volta da cabeça */
  private bubbleReq(id: string, priority: number, style: BubbleStyle, size: { w: number; h: number }, head: Point, top: number): FloatReq {
    return {
      id,
      priority,
      sizes: [size],
      ax: head.x,
      ay: top,
      headY: head.y,
      tail: style === "descanso" ? 2 : 3,
      gap: 1,
      prefer: this.prevCand.get(id),
    };
  }

  /**
   * Fila das falas de descanso: a cada ~300 ms tenta mostrar quem está esperando, se houver menos
   * de 2 na tela, se o AGzinho não falou nos últimos 12 s e se o balão couber sem cobrir nada.
   */
  private tickRestSpeech(ctx: CanvasRenderingContext2D, now: number) {
    for (const [id, b] of this.restBubbles) if (now >= b.until) this.restBubbles.delete(id);
    if (!this.restQueue.length || now < this.restTryAt) return;
    this.restTryAt = now + REST_RETRY_MS;
    this.restQueue = this.restQueue.filter((q) => now - q.at < REST_GIVEUP_MS && this.visuals.has(q.id) && this.rest.kind(q.id) === "papo");
    for (const q of [...this.restQueue]) {
      if (this.restBubbles.size >= REST_BUBBLE_MAX) break;
      const prevAt = this.lastRestAt.get(q.id);
      if (now - (prevAt ?? -Infinity) < REST_BUBBLE_GAP_MS) continue;
      const v = this.visuals.get(q.id);
      if (!v || v.leaving) continue;
      const { head, top } = this.anchorOf(v, now);
      const size = this.bubbleLayout(ctx, q.text, "descanso");
      const req = this.bubbleReq(`b:${q.id}`, PRI.rest, "descanso", size, head, top);
      if (!placeBubbles([req], FORBIDDEN, BOUNDS, this.lastRects).placed.has(req.id)) continue;
      const span = REST_BUBBLE_MIN_MS + Math.random() * (REST_BUBBLE_MAX_MS - REST_BUBBLE_MIN_MS);
      this.restBubbles.set(q.id, { text: q.text, until: now + span, shown: false, queuedAt: q.at, prevAt });
      this.lastRestAt.set(q.id, now);
      this.restQueue = this.restQueue.filter((e) => e !== q);
    }
  }

  /**
   * Um passe de layout: "!" e pontinhos (fixos), pedido de permissão, balões de trabalho, chat,
   * falas de descanso e, por último, os nomes. Nada cobre placa, quadro, AG POCKET, plaquinhas
   * ou outro balão; quem não cabe espera (descanso), vira só o nome (trabalho) ou some/encurta
   * pro primeiro nome (nome). Selecionado ou com o mouse em cima sempre mostra o nome.
   * O layout só é refeito quando muda algo que o afeta (assinatura barata por quadro).
   */
  private drawOverlays(ctx: CanvasRenderingContext2D, visuals: Visual[], now: number) {
    this.tickRestSpeech(ctx, now);
    const reduced = isReducedMotion();
    const items: OverlayItem[] = [];
    let sig = `${this.restBubbles.size}`;
    for (const v of visuals) {
      if (v.fade <= 0.05) continue;
      const id = v.agent.id;
      const { head, top, badge } = this.anchorOf(v, now);
      const selected = this.selectedId === id || this.hoverId === id;
      const b = this.bubbleOf(v, now, selected);
      const bubble = b ? { ...b, lay: this.bubbleLayout(ctx, b.text, b.style) } : undefined;
      items.push({ v, id, head, top, badge, bubble, selected });
      sig += `;${id}|${Math.round(head.x)}|${Math.round(head.y)}|${badge ?? ""}|${selected ? 1 : 0}|${b ? `${b.style}|${b.text}` : ""}`;
    }
    if (!this.plan || this.plan.sig !== sig) this.plan = this.layoutOverlay(ctx, items, sig);
    const { bubbles, names } = this.plan;

    // fala de descanso aceita que nunca chegou a aparecer: volta pra fila sem gastar os 12 s
    for (const [id, line] of this.restBubbles) {
      if (line.shown) continue;
      if (bubbles.has(`b:${id}`)) {
        line.shown = true;
        continue;
      }
      this.restBubbles.delete(id);
      if (line.prevAt === undefined) this.lastRestAt.delete(id);
      else this.lastRestAt.set(id, line.prevAt);
      if (!this.restQueue.some((q) => q.id === id)) this.restQueue.push({ id, text: line.text, at: line.queuedAt });
    }

    // desenha do menos pro mais importante: nomes, descanso, chat, trabalho e o "!" por cima
    const byId = new Map(items.map((it) => [it.id, it]));
    for (const p of names.values()) {
      const it = byId.get(p.id.slice(2));
      if (it) drawNameTag(ctx, p.box, this.nameTexts(it.v.agent)[p.size], roleColor(it.v.agent.role));
    }
    for (const rank of ["descanso", "chat", "trabalho"] as const) {
      for (const it of items) {
        const b = it.bubble;
        const p = b?.style === rank ? bubbles.get(`b:${it.id}`) : undefined;
        if (b && p) drawBubbleAt(ctx, p, b.lay.lines, b.style, it.head.x, it.head.y);
      }
    }
    for (const it of items) {
      if (it.badge === "esperando") drawWaitBadge(ctx, it.head, now, reduced);
      else if (it.badge === "pensando") drawThinkDots(ctx, it.head, now, reduced);
    }
    // confete por cima de tudo
    for (const it of items) this.drawConfetti(ctx, it.v, now);
  }

  /** nome inteiro e, sem lugar pra ele, só o primeiro nome ("Tomás", "Bia") */
  private nameTexts(agent: Agent): readonly string[] {
    const lider = !agent.parentId;
    const key = lider ? `${agent.name}|${agent.project}` : agent.name;
    let texts = this.nameCache.get(key);
    if (!texts) {
      // a VT323 junta "fi" numa ligadura ("Sofia" virava "Sona"): textosDoNome quebra antes de medir
      texts = textosDoNome(agent.name, agent.project, lider);
      if (this.nameCache.size > 200) this.nameCache.clear();
      this.nameCache.set(key, texts);
    }
    return texts;
  }

  /** os dois passes de placeBubbles (balões, depois nomes) */
  private layoutOverlay(ctx: CanvasRenderingContext2D, items: OverlayItem[], sig: string): OverlayPlan {
    const reqs: BubbleReq[] = [];
    for (const it of items) {
      const hx = Math.round(it.head.x);
      const hy = Math.round(it.head.y);
      // o "!" pula de -1 a +2 px: o retângulo fixo cobre o pulo inteiro (não muda a cada quadro)
      if (it.badge === "esperando") reqs.push({ id: `!:${it.id}`, priority: PRI.badge, fixed: { x: hx - 5, y: hy - 16, w: 10, h: 15 } });
      else if (it.badge === "pensando") reqs.push({ id: `!:${it.id}`, priority: PRI.badge, fixed: { x: hx - 5, y: hy - 6, w: 10, h: 2 } });
      if (it.bubble) reqs.push(this.bubbleReq(`b:${it.id}`, it.bubble.priority, it.bubble.style, it.bubble.lay, it.head, it.top));
    }
    // cabeça de quem está sentado: evita cobrir (custo, não proibição; o pedido de permissão ao
    // lado caía na cabeça de quem senta na mesa vizinha)
    const seatedHeads: Rect[] = [];
    for (const it of items) {
      if (!it.v.at.sitting || it.v.path.length) continue;
      const x = Math.round(it.v.x * TILE);
      const y = Math.round(it.head.y);
      seatedHeads.push({ x: x + HIT_BOX.left, y, w: HIT_BOX.right - HIT_BOX.left, h: 14 });
    }
    const bubbles = placeBubbles(reqs, FORBIDDEN, BOUNDS, [], seatedHeads);

    // nomes: de quem não tem balão na tela (ou não coube)
    const nameReqs: FloatReq[] = [];
    // nome também não fica em cima da cabeça de ninguém (no sofá, o nome ao lado caía no vizinho)
    const occupied = bubbles.rects.slice();
    for (const it of items) occupied.push({ x: Math.round(it.head.x) - 7, y: Math.round(it.head.y), w: 14, h: 14 });
    for (const it of items) {
      if (bubbles.placed.has(`b:${it.id}`)) continue;
      const id = `n:${it.id}`;
      nameReqs.push({
        id,
        priority: PRI.name,
        sizes: this.nameTexts(it.v.agent).map((t) => ({ w: Math.round(this.measure(ctx, NAME_FONT, t) + 7), h: 7 })),
        ax: it.head.x,
        ay: it.top,
        headY: it.head.y,
        tail: 0,
        gap: 0,
        // sem ir longe (±16 cai em cima da cabeça do vizinho): perto, nem que seja só o primeiro nome
        shifts: NAME_SHIFTS,
        positionFirst: true,
        always: it.selected,
        prefer: this.prevCand.get(id),
      });
    }
    const names = placeBubbles(nameReqs, FORBIDDEN, BOUNDS, occupied);

    this.prevCand.clear();
    for (const p of bubbles.placed.values()) this.prevCand.set(p.id, p.cand);
    for (const p of names.placed.values()) this.prevCand.set(p.id, p.cand);
    this.lastRects = bubbles.rects;
    this.lastPlaced = [...bubbles.placed.values(), ...names.placed.values()];
    return { sig, bubbles: bubbles.placed, names: names.placed };
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

/**
 * Canelas penduradas de quem senta no banquinho (sem mesa na frente): de frente e de costas as
 * duas pernas, de lado uma coxa pra frente e a canela caindo, com o pé apontando pra onde olha.
 */
function stoolShins(ctx: CanvasRenderingContext2D, x: number, y: number, dir: Dir, pants: string, shoes: string, alpha: number) {
  const bx = Math.round(x);
  const by = Math.round(y);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (dir === "left" || dir === "right") {
    const s = dir === "right" ? 1 : -1;
    const thighX = s > 0 ? bx - 2 : bx - 3;
    fill(ctx, thighX, by - 4, 5, 2, pants);
    fill(ctx, s > 0 ? bx + 1 : bx - 4, by - 2, 3, 3, pants);
    fill(ctx, s > 0 ? bx + 1 : bx - 5, by + 1, 4, 1, shoes);
  } else {
    for (const lx of [bx - 4, bx + 1]) {
      fill(ctx, lx, by - 4, 3, 5, pants);
      fill(ctx, lx, by + 1, 3, 1, shoes);
    }
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
