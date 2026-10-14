// Reunião no motor (sem canvas: só update e o estado interno): npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Agent, AgentStatus, ReuniaoAtiva } from "../../../shared/types";
import type { RestScheduler } from "./activities";
import { OfficeEngine } from "./engine";
import { MEETING_PRESENTER, MEETING_STOOLS, type Point, type Spot } from "./map";

/**
 * O que os testes leem do motor (campos privados; o motor não expõe estado de simulação).
 * Atenção: o cast `as unknown as MotorInterno` não é checado pelo TypeScript. Se um desses campos
 * privados for renomeado no engine.ts, o typecheck passa e o teste quebra só ao rodar.
 */
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
  meetingHolds: Map<string, string>;
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

/** semente fixa do descanso: o sorteio (café, planta, papo...) é o mesmo a cada rodada */
const SEED = 1234;
const DT = 0.05;

/** relógio próprio: o motor recebe `now` de fora */
function motor(agents: Agent[], seed = SEED) {
  const e = new OfficeEngine({ restSeed: seed });
  e.sync(agents);
  let now = performance.now();
  const step = () => {
    now += DT * 1000;
    e.update(DT, now);
  };
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += DT) step();
  };
  /** roda em passos curtos até `ok()` (no máximo `seconds`); devolve se chegou */
  const runUntil = (ok: () => boolean, seconds: number) => {
    for (let t = 0; t < seconds && !ok(); t += DT) step();
    return ok();
  };
  return { e, m: interno(e), run, step, runUntil };
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
    const { e, m, runUntil } = motor([ag(LIDER, "lider", "trabalhando"), ag("ag:dev", "dev"), ag("ag:testador", "testador", "trabalhando")]);
    const lider = m.visuals.get(LIDER)!;
    const dev = m.visuals.get("ag:dev")!;
    const testador = m.visuals.get("ag:testador")!;
    e.reuniao = reuniao();
    runUntil(() => lider.at.id === MEETING_PRESENTER.id && dev.at.id === MEETING_STOOLS[0].id, 15);
    assert.equal(m.placeOf(lider).id, MEETING_PRESENTER.id);
    assert.equal(lider.at.id, MEETING_PRESENTER.id);
    assert.equal(m.placeOf(dev).id, MEETING_STOOLS[0].id);
    assert.equal(dev.at.id, MEETING_STOOLS[0].id);
    // trabalhando fica na mesa
    assert.equal(m.placeOf(testador).id, testador.home.id);
    assert.equal(testador.at.id, testador.home.id);

    e.reuniao = null;
    assert.equal(m.meeting.size, 0);
    runUntil(() => lider.at.id === lider.home.id && !lider.path.length, 15);
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

  it("morador novo sem lugar em pé livre fica com a casa que a reunião ocupava (fallback do claimHome)", () => {
    // 10 mesas cheias: líder + 6 papéis (ociosos, vão pra reunião) + 3 convidados trabalhando
    const time = ["planejador", "pesquisador", "dev", "testador", "revisor", "documentador"].map((r) => ag(`ag:${r}`, r));
    const convidados = [1, 2, 3].map((i) => ag(`ag:c${i}`, "dev", "trabalhando"));
    const { e, m, run, step } = motor([ag(LIDER, "lider"), ...time, ...convidados]);
    e.reuniao = reuniao();
    step();
    for (const seat of MAQUETE) assert.ok(m.meetingHolds.has(seat), `${seat} sem reserva da reunião`);
    // 4 moradores pegam reuniao:2..5 (reuniao:0/1 estão reservados pela reunião)
    for (let i = 0; i < 4; i++) e.upsert(ag(`ag:m${i}`, "dev", "trabalhando"));
    assert.deepEqual(
      [0, 1, 2, 3].map((i) => m.visuals.get(`ag:m${i}`)!.home.id),
      ["reuniao:2", "reuniao:3", "reuniao:4", "reuniao:5"],
    );
    // o 15º não tem lugar livre: fica com reuniao:0 e a reserva é dele, não da reunião
    e.upsert(ag("ag:novo", "dev", "trabalhando"));
    const novo = m.visuals.get("ag:novo")!;
    assert.equal(novo.home.id, "reuniao:0");
    assert.equal(m.rest.reservations.holder("reuniao:0"), "ag:novo");
    assert.equal(m.meetingHolds.has("reuniao:0"), false);
    step();
    assert.ok(![...m.meeting.values()].includes("reuniao:0"), "participante continua na casa do novo");
    assert.equal(m.rest.reservations.holder("reuniao:0"), "ag:novo");
    run(25);
    assert.equal(novo.at.id, "reuniao:0");
    semSobreposicao(m);
  });

  it("quem descansava na maquete e recebe o mesmo lugar na reunião não fica nem um quadro sem reserva", () => {
    // só o último (dev) fica de boa antes da reunião; os outros 4 trabalham até ela começar
    const outros = ["planejador", "pesquisador", "testador", "revisor"];
    const RESTER = "ag:dev";
    // procura (em sementes fixas, então sempre a mesma) uma em que ele vai pra maquete reuniao:0
    let achou: ReturnType<typeof motor> | null = null;
    for (let seed = 1; seed <= 60 && !achou; seed++) {
      const t = motor([ag(LIDER, "lider", "trabalhando"), ...outros.map((r) => ag(`ag:${r}`, r, "trabalhando")), ag(RESTER, "dev")], seed);
      const v = t.m.visuals.get(RESTER)!;
      if (t.runUntil(() => t.m.rest.kind(RESTER) === "maquete" && v.at.id === "reuniao:0" && !v.path.length, 120)) achou = t;
    }
    assert.ok(achou, "nenhuma semente mandou o dev pra maquete reuniao:0");
    const { e, m, step } = achou;
    for (const r of outros) e.upsert(ag(`ag:${r}`, r, "ocioso"));
    e.reuniao = reuniao();
    step();
    assert.equal(m.meeting.get(RESTER), "reuniao:0");
    assert.equal(m.rest.isResting(RESTER), false);
    assert.equal(m.rest.reservations.holder("reuniao:0"), RESTER);
    assert.equal(m.meetingHolds.get("reuniao:0"), RESTER);
  });

  it("o líder com o copo na mão apresenta segurando o copo e deixa na mesa ao voltar", () => {
    const { e, m, run, runUntil } = motor([ag(LIDER, "lider"), ag("ag:dev", "dev")]);
    e.reuniao = reuniao();
    run(0.1);
    const lider = m.visuals.get(LIDER)!;
    assert.ok(lider.path.length > 0);
    lider.cupInHand = true;
    assert.ok(runUntil(() => lider.at.id === MEETING_PRESENTER.id, 15));
    run(2);
    assert.equal(lider.at.id, MEETING_PRESENTER.id);
    assert.equal(lider.cupInHand, true, "o copo continua com ele (desenhado na mão esquerda)");
    assert.equal(m.cups.length, 0);
    e.reuniao = null;
    // para no quadro em que chega em casa (depois, de boa, o descanso pode levá-lo pra outro lugar)
    assert.ok(runUntil(() => lider.at.id === lider.home.id && !lider.path.length, 15));
    assert.equal(lider.cupInHand, false);
    assert.deepEqual(
      m.cups.map((c) => c.deskId),
      ["lider"],
    );
  });
});
