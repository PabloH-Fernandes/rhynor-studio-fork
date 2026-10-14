// Reunião no motor (sem canvas: só update e o estado interno): npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Agent, AgentStatus, ReuniaoAtiva } from "../../../shared/types";
import type { RestScheduler } from "./activities";
import { OfficeEngine } from "./engine";
import { MEETING_PRESENTER, MEETING_STOOLS, type Point, type Spot } from "./map";

/** o que os testes leem do motor (campos privados; o motor não expõe estado de simulação) */
interface VisualInterno {
  agent: Agent;
  x: number;
  y: number;
  at: Spot;
  target: Spot;
  home: Spot;
  path: Point[];
  cupInHand?: boolean;
}
interface MotorInterno {
  visuals: Map<string, VisualInterno>;
  meeting: Map<string, string>;
  rest: RestScheduler;
  cups: { deskId: string }[];
  placeOf(v: VisualInterno): Spot;
}
const interno = (e: OfficeEngine) => e as unknown as MotorInterno;

const LIDER = "s:lider";
const MAQUETE = ["reuniao:0", "reuniao:1"];

function ag(id: string, role: string, status: AgentStatus = "ocioso", extra: Partial<Agent> = {}): Agent {
  const lider = role === "lider";
  return {
    id,
    sessionId: "s1",
    parentId: lider ? undefined : LIDER,
    role,
    name: id,
    status,
    activity: "",
    project: "p",
    startedAt: 0,
    updatedAt: 0,
    boundAt: 0,
    tasksDone: 0,
    tasksDay: "2026-10-14",
    ...extra,
  };
}

function reuniao(liderId = LIDER): ReuniaoAtiva {
  return { sessionId: "s1", liderId, desde: 0 };
}

/** relógio próprio: o motor recebe `now` de fora */
function motor(agents: Agent[]) {
  const e = new OfficeEngine();
  e.sync(agents);
  let now = performance.now();
  const run = (seconds: number) => {
    const dt = 0.05;
    for (let t = 0; t < seconds; t += dt) {
      now += dt * 1000;
      e.update(dt, now);
    }
  };
  return { e, m: interno(e), run };
}

const parado = (v: VisualInterno) => !v.path.length;

/** ninguém parado no mesmo ponto que outro (folga de meio boneco) */
function semSobreposicao(m: MotorInterno) {
  const vs = [...m.visuals.values()].filter(parado);
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) {
      const d = Math.hypot(vs[i].x - vs[j].x, vs[i].y - vs[j].y);
      assert.ok(d >= 0.5, `${vs[i].agent.id} (${vs[i].at.id}) em cima de ${vs[j].agent.id} (${vs[j].at.id})`);
    }
  }
}

describe("reunião no motor", () => {
  it("líder vai pro presenter e os ociosos pros lugares (placeOf); acabou, todo mundo volta pra casa", () => {
    const { e, m, run } = motor([ag(LIDER, "lider", "trabalhando"), ag("ag:dev", "dev"), ag("ag:testador", "testador", "trabalhando")]);
    e.reuniao = reuniao();
    run(12);
    const lider = m.visuals.get(LIDER)!;
    const dev = m.visuals.get("ag:dev")!;
    const testador = m.visuals.get("ag:testador")!;
    assert.equal(m.placeOf(lider).id, MEETING_PRESENTER.id);
    assert.equal(lider.at.id, MEETING_PRESENTER.id);
    assert.equal(m.placeOf(dev).id, MEETING_STOOLS[0].id);
    assert.equal(dev.at.id, MEETING_STOOLS[0].id);
    // trabalhando fica na mesa
    assert.equal(m.placeOf(testador).id, testador.home.id);
    assert.equal(testador.at.id, testador.home.id);

    e.reuniao = null;
    assert.equal(m.meeting.size, 0);
    run(12);
    for (const v of m.visuals.values()) {
      assert.equal(m.placeOf(v).id, v.home.id, v.agent.id);
      // (o dev, de boa, pode já ter saído pro descanso)
      if (!m.rest.isResting(v.agent.id)) assert.equal(v.at.id, v.home.id, v.agent.id);
    }
    assert.ok(![...m.visuals.values()].some((v) => v.at.stool || v.at.id === MEETING_PRESENTER.id));
  });

  it("troca de líder: o novo apresenta e o antigo, ocioso, vira participante", () => {
    const outro = "s:outro";
    const { e, m, run } = motor([ag(LIDER, "lider"), ag(outro, "lider", "ocioso", { sessionId: "s2" }), ag("ag:dev", "dev")]);
    e.reuniao = reuniao(LIDER);
    run(12);
    assert.equal(m.meeting.get(LIDER), MEETING_PRESENTER.id);
    e.reuniao = reuniao(outro);
    run(15);
    assert.equal(m.meeting.get(outro), MEETING_PRESENTER.id);
    assert.equal(m.visuals.get(outro)!.at.id, MEETING_PRESENTER.id);
    const antigo = m.meeting.get(LIDER);
    assert.ok(antigo && antigo !== MEETING_PRESENTER.id, `antigo líder em ${antigo}`);
    assert.equal(m.visuals.get(LIDER)!.at.id, antigo);
    assert.equal([...m.meeting.values()].filter((s) => s === MEETING_PRESENTER.id).length, 1);
    semSobreposicao(m);
  });

  it("quem mora em pé em reuniao:0/1 e está trabalhando não divide o lugar com quem senta", () => {
    // 1 mesa de dev + 3 de convidado: d4 e d5 moram em reuniao:0 e reuniao:1
    const devs = Array.from({ length: 10 }, (_, i) => ag(`ag:d${i}`, "dev", i === 4 || i === 5 ? "trabalhando" : "ocioso"));
    const { e, m, run } = motor([ag(LIDER, "lider"), ...devs]);
    assert.equal(m.visuals.get("ag:d4")!.home.id, "reuniao:0");
    assert.equal(m.visuals.get("ag:d5")!.home.id, "reuniao:1");
    e.reuniao = reuniao();
    run(20);
    for (const [id, seat] of m.meeting) assert.ok(!MAQUETE.includes(seat), `${id} recebeu ${seat}, casa de quem trabalha`);
    assert.equal(m.visuals.get("ag:d4")!.at.id, "reuniao:0");
    assert.equal(m.visuals.get("ag:d5")!.at.id, "reuniao:1");
    semSobreposicao(m);
  });

  it("os lugares da maquete ocupados pela reunião ficam reservados (o descanso não põe ninguém por cima) e voltam no fim", () => {
    // 6 participantes (4 banquinhos + reuniao:0/1) e um 7º ocioso que não cabe
    const roles = ["planejador", "pesquisador", "dev", "testador", "revisor", "documentador", "dev"];
    const { e, m, run } = motor([ag(LIDER, "lider"), ...roles.map((r, i) => ag(`ag:${r}-${i}`, r))]);
    e.reuniao = reuniao();
    run(1);
    const sentados = new Map([...m.meeting].map(([id, seat]) => [seat, id]));
    for (const seat of MAQUETE) {
      assert.ok(sentados.has(seat), `${seat} sem ninguém`);
      assert.equal(m.rest.reservations.holder(seat), sentados.get(seat));
    }
    assert.equal(m.rest.freeSpots("maquete").length, 0);
    // o 7º fica de boa por bastante tempo e nunca para em cima de quem senta
    for (let i = 0; i < 12; i++) {
      run(5);
      semSobreposicao(m);
    }
    e.reuniao = null;
    for (const seat of MAQUETE) assert.equal(m.rest.reservations.holder(seat), undefined, seat);
  });

  it("lugar reservado por alguém de fora (descanso na maquete) não vai pra reunião", () => {
    const { e, m, run } = motor([ag(LIDER, "lider"), ...["planejador", "pesquisador", "dev", "testador", "revisor", "documentador"].map((r) => ag(`ag:${r}`, r))]);
    m.rest.reservations.reserve("reuniao:0", "ag:de-fora");
    e.reuniao = reuniao();
    run(1);
    assert.ok(![...m.meeting.values()].includes("reuniao:0"));
    // 6 ociosos, 5 lugares livres: um fica na mesa
    assert.equal(m.meeting.size, 1 + 5);
    assert.equal(m.rest.reservations.holder("reuniao:0"), "ag:de-fora");
  });

  it("o líder com o copo na mão apresenta segurando o copo e deixa na mesa ao voltar", () => {
    const { e, m, run } = motor([ag(LIDER, "lider"), ag("ag:dev", "dev")]);
    e.reuniao = reuniao();
    run(0.1);
    const lider = m.visuals.get(LIDER)!;
    assert.ok(lider.path.length > 0);
    lider.cupInHand = true;
    run(12);
    assert.equal(lider.at.id, MEETING_PRESENTER.id);
    assert.equal(lider.cupInHand, true, "o copo continua com ele (desenhado na mão esquerda)");
    assert.equal(m.cups.length, 0);
    e.reuniao = null;
    run(12);
    assert.equal(lider.at.id, lider.home.id);
    assert.equal(lider.cupInHand, false);
    assert.deepEqual(
      m.cups.map((c) => c.deskId),
      ["lider"],
    );
  });
});
