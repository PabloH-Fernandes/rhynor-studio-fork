// Motor do escritório: guarda a posição de cada personagem, decide pra onde ele vai
// (mesa, café, reunião, porta), anda pelos caminhos e desenha tudo no canvas.

import type { Agent } from "../../../shared/types";
import { HAIRS, SKINS, inkAlpha, palette, roleColor, theme, uniformFor } from "../theme";
import { fill, line } from "./decor";
import {
  AISLE_Y,
  COFFEE_SPOTS,
  DESKS,
  DOOR_SPOT,
  OVERFLOW_SPOTS,
  PROPS,
  SIGN,
  TILE,
  W,
  deskSpot,
  drawBoard,
  drawChair,
  drawClock,
  drawCoffeeCorner,
  drawDecor,
  drawDesk,
  drawFloor,
  drawMeetingTable,
  drawSign,
  route,
  type Desk,
  type Point,
  type Spot,
} from "./map";
import { HAIR_STYLE_COUNT, drawCharacter, hashString, type Accessory, type CharLook, type Dir } from "./sprites";

const SPEED = 3.4; // tiles por segundo
const COFFEE_AFTER_MS = 15_000; // ocioso por esse tempo → vai tomar café
const BUBBLE_MS = 3800;
const CHAT_MS = 4500;

/** aparência fixa de cada papel (tabela de uniformes); o que não está aqui sai do hash do id */
const ROLE_LOOK: Record<string, { hairStyle: number; accessory?: Accessory }> = {
  lider: { hairStyle: 6, accessory: "relogio" },
  planejador: { hairStyle: 3, accessory: "nenhum" },
  revisor: { hairStyle: 0, accessory: "oculos" },
  pesquisador: { hairStyle: 2 }, // óculos por hash
  testador: { hairStyle: 4, accessory: "relogio" },
  dev: { hairStyle: 5, accessory: "headset" },
  documentador: { hairStyle: 1, accessory: "lapis" },
};
const GUEST_ACCESSORIES: Accessory[] = ["nenhum", "nenhum", "barba", "oculos"];

function lookFor(agent: Agent, h: number): CharLook {
  const fixed = Object.hasOwn(ROLE_LOOK, agent.role) ? ROLE_LOOK[agent.role] : undefined;
  const accessory: Accessory =
    fixed?.accessory ??
    (agent.role === "pesquisador" ? ((h >>> 13) % 2 ? "oculos" : "nenhum") : GUEST_ACCESSORIES[(h >>> 13) % GUEST_ACCESSORIES.length]);
  return {
    uniform: uniformFor(agent.role),
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >>> 4) % HAIRS.length],
    hairStyle: fixed?.hairStyle ?? (h >>> 9) % HAIR_STYLE_COUNT,
    accessory,
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
  idleSince: number;
  activityAt: number;
  leaving: boolean;
  fade: number; // 1 → 0 ao sair pela porta
  chat?: { text: string; until: number };
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
  selectedId: string | null = null;
  hoverId: string | null = null;
  onSelect?: (id: string | null) => void;

  constructor() {
    if (theme.logoUrl) {
      const img = new Image();
      img.src = theme.logoUrl;
      this.logo = img;
    }
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
    if (!v) {
      v = this.create(agent, fromSnapshot);
      this.visuals.set(agent.id, v);
    }
    if (agent.activity !== v.agent.activity) v.activityAt = now;
    if (agent.status === "ocioso" && v.agent.status !== "ocioso") v.idleSince = now;
    if (agent.status !== "ocioso") v.idleSince = Infinity;
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
      look: lookFor(agent, h),
      phase: h % 1000,
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
    const spot = OVERFLOW_SPOTS.find((s) => !taken.has(s.id)) ?? OVERFLOW_SPOTS[agent.id.length % OVERFLOW_SPOTS.length];
    return { spot };
  }

  private startLeaving(v: Visual) {
    if (v.leaving) return;
    v.leaving = true;
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
      from = { id: "aqui", x: v.x, y: v.y, laneX: lane, via: [], sitting: false };
    }
    v.path = route(from, spot);
    v.target = spot;
  }

  // ------------------------------------------------------------ simulação

  update(dt: number, now: number) {
    const busyCoffee = new Set([...this.visuals.values()].filter((v) => v.target.id.startsWith("cafe:")).map((v) => v.target.id));

    for (const v of this.visuals.values()) {
      // decide o destino
      if (!v.leaving) {
        const wantsCoffee = v.agent.status === "ocioso" && now - v.idleSince > COFFEE_AFTER_MS;
        if (wantsCoffee && !v.target.id.startsWith("cafe:")) {
          const spot = COFFEE_SPOTS.find((s) => !busyCoffee.has(s.id));
          if (spot) {
            busyCoffee.add(spot.id);
            this.goTo(v, spot);
          }
        } else if (!wantsCoffee && v.target.id !== v.home.id) {
          this.goTo(v, v.home);
        }
      }

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
      if (v.leaving && !v.path.length) v.fade = Math.max(0, v.fade - dt * 2.5);
    }

    for (const [id, v] of this.visuals) if (v.leaving && v.fade <= 0) this.visuals.delete(id);
    this.envelopes = this.envelopes.filter((e) => now - e.start < 1400);
  }

  private restingDir(v: Visual): Dir {
    if (v.at.sitting || v.at.id.startsWith("cafe:")) return "down";
    if (v.at.id.startsWith("reuniao:")) return v.at.x < 16 ? "right" : v.at.x > 16 ? "left" : v.at.y < 11 ? "down" : "up";
    return "down";
  }

  // ------------------------------------------------------------ desenho

  render(ctx: CanvasRenderingContext2D, now: number) {
    ctx.imageSmoothingEnabled = false;
    drawFloor(ctx, now);
    drawDecor(ctx);
    drawSign(ctx, this.logo);
    drawClock(ctx, new Date());

    const visuals = [...this.visuals.values()];
    const active = visuals.filter((v) => !v.leaving);
    drawBoard(ctx, {
      total: active.length,
      working: active.filter((v) => v.agent.status === "trabalhando" || v.agent.status === "pensando").length,
      waiting: active.filter((v) => v.agent.status === "esperando").length,
    });

    // objetos com profundidade, desenhados de cima pra baixo
    const items: { y: number; draw: () => void }[] = [];
    const seatedAt = new Map<string, Visual>();
    for (const v of visuals) if (v.at.sitting && !v.path.length && v.deskId && v.at.id === v.home.id) seatedAt.set(v.deskId, v);

    for (const d of DESKS) {
      const occupant = [...this.visuals.values()].find((v) => v.deskId === d.id && !v.leaving);
      const seated = seatedAt.get(d.id);
      const deskTop = (d.cy + 0.55) * TILE;
      items.push({ y: (d.cy + 0.85) * TILE - 1, draw: () => drawChair(ctx, d, roleColor(d.role === "convidado" ? "convidado" : d.role)) });
      items.push({
        y: deskTop + 20,
        draw: () =>
          drawDesk(ctx, d, {
            active: !!seated && (seated.agent.status === "trabalhando" || seated.agent.status === "pensando"),
            waiting: !!seated && seated.agent.status === "esperando",
            occupantName: occupant?.agent.name,
            t: now,
          }),
      });
    }
    items.push({ y: 11.2 * TILE + 10, draw: () => drawMeetingTable(ctx) });
    items.push({ y: 16.1 * TILE, draw: () => drawCoffeeCorner(ctx, now, visuals.some((v) => v.at.id.startsWith("cafe:") && !v.path.length)) });
    for (const p of PROPS) items.push({ y: p.y, draw: () => p.draw(ctx, now) });

    for (const v of visuals) {
      items.push({
        y: v.y * TILE + (v.at.sitting && !v.path.length ? 0 : 0.5),
        draw: () => this.drawVisual(ctx, v, now),
      });
    }

    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    // camada de cima: envelopes e balões
    for (const e of this.envelopes) this.drawEnvelope(ctx, e, now);
    for (const v of visuals) this.drawOverlay(ctx, v, now);
  }

  private drawVisual(ctx: CanvasRenderingContext2D, v: Visual, now: number) {
    const sitting = v.at.sitting && !v.path.length;
    const x = v.x * TILE;
    const y = v.y * TILE;
    const selected = this.selectedId === v.agent.id;
    if ((selected || this.hoverId === v.agent.id) && !sitting) {
      selectionRing(ctx, x, y, selected ? palette.navy900 : palette.navy500);
    }
    drawCharacter(ctx, x, y, v.look, {
      dir: v.dir,
      walking: v.path.length > 0,
      sitting,
      typing: sitting && v.agent.status === "trabalhando",
      t: now,
      phase: v.phase,
      alpha: v.fade,
    });
  }

  private headPoint(v: Visual): Point {
    const sitting = v.at.sitting && !v.path.length;
    return { x: v.x * TILE, y: v.y * TILE - (sitting ? 22 : 24) };
  }

  private drawOverlay(ctx: CanvasRenderingContext2D, v: Visual, now: number) {
    if (v.fade <= 0.05) return;
    const head = this.headPoint(v);
    const selected = this.selectedId === v.agent.id || this.hoverId === v.agent.id;
    const status = v.agent.status;
    let top = head.y - 2;

    // ícone de status
    if (status === "esperando" && !v.leaving) {
      // selo marinho com borda e "!" laranja; a borda pisca entre laranja e branco
      const b = Math.round(Math.sin(now / 150) * 1.5);
      const sx = Math.round(head.x - 5);
      const sy = Math.round(top - 13 + b);
      const ring = Math.floor(now / 400) % 2 ? palette.white : palette.signal.waiting;
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
    } else if (v.at.id.startsWith("cafe:") && !v.path.length) {
      ctx.fillStyle = palette.white;
      ctx.fillRect(Math.round(head.x + 5), Math.round(top + 10), 4, 4);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillRect(Math.round(head.x + 6), Math.round(top + 6 - (Math.floor(now / 300) % 2)), 1, 3);
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
  }

  private drawEnvelope(ctx: CanvasRenderingContext2D, e: Envelope, now: number) {
    const a = this.visuals.get(e.fromId);
    const b = this.visuals.get(e.toId);
    if (!a || !b) return;
    const p = Math.min(1, (now - e.start) / 1200);
    const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const ha = this.headPoint(a);
    const hb = this.headPoint(b);
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
      if (bx >= x - 8 && bx <= x + 8 && by >= y - 26 && by <= y + 3) {
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

/** anel de seleção em pixel (oval 17x7) no chão, embaixo do personagem */
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
