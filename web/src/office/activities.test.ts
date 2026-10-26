// Testes do agendador de descanso (lógica pura, sem DOM): npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PapoPlace, RestSpot, Spot } from "./map";
import {
  CHECK_MS,
  GROUP_ON_FREE_CHANCE,
  DURATION_MAX_MS,
  DURATION_MIN_MS,
  GROUP_KINDS,
  IDLE_GRACE_MS,
  MISS_CHANCE,
  PAPO_RADIUS_PX,
  PARTNER_WAIT_MS,
  PAUSE_MAX_MS,
  REST_LABELS,
  Reservations,
  RestScheduler,
  WORK_COOLDOWN_MS,
  hash32,
  mulberry32,
  pickWeighted,
  podeDescansar,
  type RestActor,
  type RestKind,
  type RestMover,
} from "./activities";

const spot = (id: string, kind: RestSpot["kind"]): RestSpot => ({
  id,
  kind,
  x: 0,
  y: 0,
  laneX: 0,
  via: [],
  sitting: false,
  face: "down",
});

const SPOTS: RestSpot[] = [
  spot("cafe:0", "cafe"),
  spot("cafe:1", "cafe"),
  spot("sofa:0", "celular"),
  spot("reuniao:0", "maquete"),
  spot("planta", "regar"),
  spot("bebedouro", "bebedouro"),
];

/** mundo de mentira: andar é instantâneo (o mover já põe o ator no destino) */
function world(ids: string[], hasDesk = true) {
  const actors = new Map<string, RestActor>(
    ids.map((id) => [
      id,
      { id, session: "s1", idle: true, idleSince: 0, leaving: false, walking: false, busyAnim: false, atId: `desk:${id}`, homeId: `desk:${id}`, hasDesk, x: 0, y: 0 },
    ]),
  );
  const log: string[] = [];
  const mover: RestMover = {
    goTo: (id: string, s: Spot) => {
      actors.get(id)!.atId = s.id;
      log.push(`${id} goTo ${s.id}`);
    },
    goHome: (id: string) => {
      const a = actors.get(id)!;
      a.atId = a.homeId;
      log.push(`${id} goHome`);
    },
    dropCup: (id: string) => log.push(`${id} dropCup`),
    say: (id: string, text: string) => log.push(`${id} say ${text}`),
  };
  return { actors, mover, log };
}

/** roda o agendador de `from` até `to` em passos de `step` ms */
function run(s: RestScheduler, w: ReturnType<typeof world>, from: number, to: number, step = 100, onStep?: (now: number) => void) {
  for (let now = from; now <= to; now += step) {
    s.update(now, w.actors.values(), w.mover);
    onStep?.(now);
  }
}

describe("mulberry32 e hash32", () => {
  it("mesma semente dá a mesma sequência, sempre em [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      assert.equal(x, b());
      assert.ok(x >= 0 && x < 1);
    }
    assert.notEqual(mulberry32(1)(), mulberry32(2)());
  });

  it("hash32 é estável e muda com o texto", () => {
    assert.equal(hash32("p:dev|s1"), hash32("p:dev|s1"));
    assert.notEqual(hash32("p:dev|s1"), hash32("p:dev|s2"));
  });
});

describe("pickWeighted", () => {
  const opts = [
    { value: "a", weight: 3 },
    { value: "zero", weight: 0 },
    { value: "b", weight: 1 },
  ];

  it("divide [0, 1) pelos pesos e ignora peso zero", () => {
    assert.equal(pickWeighted(opts, 0), "a");
    assert.equal(pickWeighted(opts, 0.74), "a");
    assert.equal(pickWeighted(opts, 0.76), "b");
    assert.equal(pickWeighted(opts, 0.9999), "b");
  });

  it("sem opção válida devolve undefined", () => {
    assert.equal(pickWeighted([], 0.5), undefined);
    assert.equal(pickWeighted([{ value: "x", weight: 0 }], 0.5), undefined);
  });

  it("a frequência acompanha o peso (3:1)", () => {
    const rnd = mulberry32(7);
    let a = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) if (pickWeighted(opts, rnd()) === "a") a++;
    assert.ok(Math.abs(a / n - 0.75) < 0.02, `a saiu ${a / n}`);
  });
});

describe("Reservations", () => {
  it("um lugar, um dono; só o dono solta", () => {
    const r = new Reservations();
    assert.ok(r.reserve("cafe:0", "x"));
    assert.ok(r.reserve("cafe:0", "x"), "reservar de novo o próprio lugar não falha");
    assert.ok(!r.reserve("cafe:0", "y"));
    assert.ok(!r.isFree("cafe:0", "y"));
    assert.ok(r.isFree("cafe:0", "x"));
    r.release("cafe:0", "y");
    assert.equal(r.holder("cafe:0"), "x");
    r.release("cafe:0", "x");
    assert.equal(r.holder("cafe:0"), undefined);
  });

  it("releaseAll solta tudo de um dono só", () => {
    const r = new Reservations();
    r.reserve("a", "x");
    r.reserve("b", "x");
    r.reserve("c", "y");
    r.releaseAll("x");
    assert.deepEqual(r.heldBy("x"), []);
    assert.equal(r.holder("c"), "y");
    assert.equal(r.size, 1);
  });
});

describe("RestScheduler", () => {
  it("espera 4 s de ócio antes de sair da mesa", () => {
    const s = new RestScheduler(SPOTS, { seed: 1 });
    const w = world(["p:dev"]);
    run(s, w, 0, IDLE_GRACE_MS - 100);
    assert.ok(!s.isResting("p:dev"));
    run(s, w, IDLE_GRACE_MS, IDLE_GRACE_MS + CHECK_MS);
    assert.ok(s.isResting("p:dev"));
    assert.ok(s.restLabel("p:dev"));
  });

  it("trabalho recente bloqueia o descanso: não começa e, se já descansava, larga e volta pra mesa", () => {
    assert.equal(podeDescansar({ idle: true, workedAt: 1000 }, 1000 + WORK_COOLDOWN_MS - 1), false);
    assert.equal(podeDescansar({ idle: true, workedAt: 1000 }, 1000 + WORK_COOLDOWN_MS), true);
    assert.equal(podeDescansar({ idle: true }, 0), true, "sem trabalho visto, só o ócio conta");
    assert.equal(podeDescansar({ idle: false, workedAt: -Infinity }, 0), false);

    // ocioso há muito, mas trabalhou há 5 s: não sai da mesa até passar o cooldown
    const s = new RestScheduler(SPOTS, { seed: 1 });
    const w = world(["p:dev"]);
    w.actors.get("p:dev")!.workedAt = 5000;
    run(s, w, 10_000, 5000 + WORK_COOLDOWN_MS - 100);
    assert.ok(!s.isResting("p:dev"), "trabalhou há menos de 20 s");
    run(s, w, 5000 + WORK_COOLDOWN_MS, 5000 + WORK_COOLDOWN_MS + CHECK_MS);
    assert.ok(s.isResting("p:dev"), "passou o cooldown: pode descansar");

    // chegou trabalho enquanto descansava (status continua ocioso no ator): cancela e vai pra mesa
    const now = 5000 + WORK_COOLDOWN_MS + 2 * CHECK_MS;
    w.actors.get("p:dev")!.workedAt = now;
    w.log.length = 0;
    s.update(now, w.actors.values(), w.mover);
    assert.ok(!s.isResting("p:dev"));
    assert.ok(w.log.includes("p:dev goHome"), w.log.join(" | "));
    assert.equal(w.actors.get("p:dev")!.idle, true, "o agendador nunca muda o status");
  });

  it("não começa andando, saindo, comemorando ou fora do ócio", () => {
    const s = new RestScheduler(SPOTS, { seed: 1 });
    const w = world(["a", "b", "c", "d"]);
    w.actors.get("a")!.walking = true;
    w.actors.get("b")!.leaving = true;
    w.actors.get("c")!.busyAnim = true;
    Object.assign(w.actors.get("d")!, { idle: false, idleSince: Infinity });
    run(s, w, 0, 20_000);
    for (const id of ["a", "b", "c", "d"]) assert.ok(!s.isResting(id), id);
  });

  it("é determinístico com a mesma semente, id e sessão", () => {
    const trace = (seed: number) => {
      const s = new RestScheduler(SPOTS, { seed });
      const w = world(["p:dev", "p:testador"]);
      run(s, w, 0, 200_000, 250);
      return w.log.join("\n");
    };
    assert.equal(trace(5), trace(5));
    assert.notEqual(trace(5), trace(6));
  });

  it("passa por indo → fazendo → voltando e reserva o lugar enquanto está lá", () => {
    const s = new RestScheduler(SPOTS, { seed: 3 });
    const w = world(["x"]);
    const phases = new Set<string>();
    run(s, w, 0, 150_000, 100, () => {
      const p = s.phase("x");
      if (p) phases.add(p);
      const k = s.kind("x");
      const held = s.reservations.heldBy("x");
      if (p === "fazendo" && k !== "espreguicar" && w.actors.get("x")!.atId !== "desk:x") assert.equal(held.length, 1);
      if (!p) assert.equal(held.length, 0, "sem descanso, sem reserva");
    });
    for (const p of ["indo", "fazendo", "voltando"]) assert.ok(phases.has(p), `nunca passou por ${p}`);
  });

  it("dura de 20 a 60 s, pausa de 5 a 10 s na mesa e nunca repete a atividade anterior", () => {
    const s = new RestScheduler(SPOTS, { seed: 11 });
    const w = world(["x"]);
    const runs: { kind: RestKind; start: number; end: number }[] = [];
    let cur: { kind: RestKind; start: number } | null = null;
    run(s, w, 0, 1_500_000, 100, (now) => {
      const k = s.kind("x");
      if (k && !cur) cur = { kind: k, start: now };
      if (!k && cur) {
        runs.push({ ...cur, end: now });
        cur = null;
      }
    });
    assert.ok(runs.length >= 15, `só ${runs.length} atividades`);
    for (let i = 1; i < runs.length; i++) {
      assert.notEqual(runs[i].kind, runs[i - 1].kind, `repetiu ${runs[i].kind}`);
      const gap = runs[i].start - runs[i - 1].end;
      assert.ok(gap >= 5000 - 200 && gap <= PAUSE_MAX_MS + CHECK_MS + 200, `pausa de ${gap} ms`);
    }
    for (const r of runs) {
      const d = r.end - r.start;
      assert.ok(d >= 20_000 - 200 && d <= DURATION_MAX_MS + 1000, `${r.kind} durou ${d} ms`);
      if (r.kind === "espreguicar") assert.ok(d <= DURATION_MIN_MS + 300, `espreguiçar durou ${d} ms`);
    }
    // com o mundo instantâneo, todas as atividades de uma pessoa só aparecem (sem parceiro, sem grupo)
    const solo = Object.keys(REST_LABELS).filter((k) => !(GROUP_KINDS as readonly string[]).includes(k));
    assert.deepEqual(new Set(runs.map((r) => r.kind)), new Set(solo));
  });

  it("ninguém divide lugar: com o café cheio, o café sai do sorteio", () => {
    const s = new RestScheduler(SPOTS, { seed: 2 });
    s.reservations.reserve("cafe:0", "outro");
    s.reservations.reserve("cafe:1", "outro2");
    assert.ok(!s.options("x").includes("cafe"));
    assert.ok(s.options("x").includes("espreguicar"));
    const w = world(["a", "b", "c", "d", "e", "f"]);
    run(s, w, 0, 300_000, 100, () => {
      const seen = new Map<string, string>();
      for (const id of w.actors.keys()) {
        const k = s.kind(id);
        if (!k || k === "espreguicar") continue;
        const at = w.actors.get(id)!.atId;
        if (at.startsWith("desk:")) continue;
        assert.ok(!seen.has(at), `${id} e ${seen.get(at)} no mesmo lugar ${at}`);
        seen.set(at, id);
        assert.notEqual(at.slice(0, 5), "cafe:", "café estava todo reservado");
      }
    });
  });

  it("não usa o lugar em pé de quem mora na reunião", () => {
    const s = new RestScheduler(SPOTS, { seed: 4 });
    s.reservations.reserve("reuniao:0", "visitante");
    assert.ok(!s.options("x").includes("maquete"));
    assert.ok(!s.options("visitante").includes("maquete"), "nem o próprio dono usa a casa como descanso");
  });

  it("interrupt solta a reserva, larga o copo e manda pra mesa", () => {
    const s = new RestScheduler([spot("cafe:0", "cafe")], { seed: 9 });
    const w = world(["x"]);
    // força o café: única atividade com lugar (+ espreguiçar); tenta até cair no café
    let now = 0;
    while (s.kind("x") !== "cafe" && now < 600_000) {
      s.update(now, w.actors.values(), w.mover);
      now += 100;
    }
    assert.equal(s.kind("x"), "cafe");
    // anda (instantâneo) e começa a beber; passa do "pegando o copo"
    for (let i = 0; i < 30; i++, now += 100) s.update(now, w.actors.values(), w.mover);
    assert.equal(s.phase("x"), "fazendo");
    assert.equal(s.reservations.holder("cafe:0"), "x");
    w.log.length = 0;
    w.actors.get("x")!.idle = false;
    s.interrupt("x", w.mover, now);
    assert.ok(!s.isResting("x"));
    assert.equal(s.restLabel("x"), null);
    assert.equal(s.reservations.holder("cafe:0"), undefined);
    assert.deepEqual(w.log, ["x dropCup", "x goHome"]);
  });

  it("interrupt sem copo não larga nada; fora do descanso não faz nada", () => {
    const s = new RestScheduler([spot("planta", "regar")], { seed: 9 });
    const w = world(["x"]);
    s.interrupt("x", w.mover, 0);
    assert.deepEqual(w.log, []);
    let now = 0;
    while (s.kind("x") !== "regar" && now < 600_000) {
      s.update(now, w.actors.values(), w.mover);
      now += 100;
    }
    w.log.length = 0;
    s.interrupt("x", w.mover, now);
    assert.deepEqual(w.log, ["x goHome"]);
    assert.equal(s.reservations.size, 0);
  });

  it("saiu do ócio sem interrupt (snapshot): o update interrompe sozinho", () => {
    const s = new RestScheduler(SPOTS, { seed: 1 });
    const w = world(["x"]);
    run(s, w, 0, IDLE_GRACE_MS + CHECK_MS);
    assert.ok(s.isResting("x"));
    Object.assign(w.actors.get("x")!, { idle: false, idleSince: Infinity });
    run(s, w, IDLE_GRACE_MS + CHECK_MS + 100, IDLE_GRACE_MS + CHECK_MS + 200);
    assert.ok(!s.isResting("x"));
    assert.equal(s.reservations.size, 0);
  });

  it("remove esquece o ator e solta tudo (saindo pela porta)", () => {
    const s = new RestScheduler(SPOTS, { seed: 1 });
    const w = world(["x"]);
    run(s, w, 0, IDLE_GRACE_MS + CHECK_MS);
    s.remove("x");
    assert.ok(!s.isResting("x"));
    assert.equal(s.reservations.size, 0);
  });

  it("pose: gole de ~1,7 s com pausa segurando o copo", () => {
    const s = new RestScheduler([spot("cafe:0", "cafe")], { seed: 9 });
    const w = world(["x"]);
    let now = 0;
    while (s.kind("x") !== "cafe" && now < 600_000) {
      s.update(now, w.actors.values(), w.mover);
      now += 100;
    }
    s.update(now, w.actors.values(), w.mover); // chegou: fazendo
    const start = now;
    const kinds = new Set<string>();
    for (let t = start; t < start + 8000; t += 50) {
      const p = s.pose("x", t, true);
      kinds.add(p?.anim ?? p?.holding ?? "nada");
    }
    assert.deepEqual(kinds, new Set(["nada", "sip", "copo"]));
    // andando de volta com o copo só se levou o café pra mesa
    assert.equal(s.pose("x", start, false), null);
  });

  /** procura uma semente em que o café sai com "levar o copo pra mesa" e para no "voltando" com ele */
  function untilCarry(hasDesk = true) {
    for (let seed = 1; seed < 400; seed++) {
      const s = new RestScheduler([spot("cafe:0", "cafe")], { seed });
      const w = world(["x"], hasDesk);
      for (let now = 0; now < 400_000; now += 100) {
        s.update(now, w.actors.values(), w.mover);
        if (s.phase("x") === "voltando" && s.pose("x", now, false)?.holding === "copo") return { s, w, now };
      }
    }
    return null;
  }

  it("café levado pra mesa: volta com o copo, termina sentado e larga o copo na mesa no fim", () => {
    const found = untilCarry();
    assert.ok(found, "nenhuma semente levou o café");
    const { s, w } = found;
    let now = found.now;
    w.log.length = 0;
    let sawDesk = false;
    for (; s.isResting("x") && now < found.now + 120_000; now += 100) {
      s.update(now, w.actors.values(), w.mover);
      if (s.pose("x", now, true)?.cupOnDesk) sawDesk = true;
    }
    assert.ok(sawDesk, "não bebeu na mesa");
    assert.ok(w.log.includes("x dropCup"), "não deixou o copo na mesa");
    assert.ok(!s.isResting("x"));
  });

  it("quem não tem mesa (mora em pé na reunião) nunca leva o café", () => {
    assert.equal(untilCarry(false), null);
  });

  it("interrupt no voltando com o copo larga o copo", () => {
    const found = untilCarry();
    assert.ok(found);
    const { s, w, now } = found;
    w.log.length = 0;
    s.interrupt("x", w.mover, now);
    assert.deepEqual(w.log, ["x dropCup", "x goHome"]);
  });

  it("interrupt no indo do café não larga copo nenhum (ainda não pegou)", () => {
    const s = new RestScheduler([spot("cafe:0", "cafe")], { seed: 9 });
    const w = world(["x"]);
    let now = 0;
    while (s.kind("x") !== "cafe" && now < 600_000) {
      s.update(now, w.actors.values(), w.mover);
      now += 100;
    }
    assert.equal(s.phase("x"), "indo");
    w.log.length = 0;
    s.interrupt("x", w.mover, now);
    assert.deepEqual(w.log, ["x goHome"]);
    assert.equal(s.reservations.size, 0);
  });

  it("evict: quem descansa no lugar volta pra mesa e o lugar fica livre; casa de alguém não é mexida", () => {
    const s = new RestScheduler([spot("reuniao:0", "maquete")], { seed: 3 });
    const w = world(["x"]);
    let now = 0;
    while (!(s.kind("x") === "maquete" && s.phase("x") === "fazendo") && now < 600_000) {
      s.update(now, w.actors.values(), w.mover);
      now += 100;
    }
    assert.equal(s.reservations.holder("reuniao:0"), "x");
    w.log.length = 0;
    s.evict("reuniao:0", w.mover, now);
    assert.ok(!s.isResting("x"));
    assert.equal(s.reservations.holder("reuniao:0"), undefined);
    assert.deepEqual(w.log, ["x goHome"]);
    assert.ok(s.reservations.reserve("reuniao:0", "visitante"));
    // dono que mora ali (não descansa): evict não faz nada
    s.evict("reuniao:0", w.mover, now);
    assert.equal(s.reservations.holder("reuniao:0"), "visitante");
  });
});

// ------------------------------------------------------------------ ping-pong e papo

const PP: Spot[] = [
  { id: "pingpong:0", x: 34, y: 6.2, laneX: 32, via: [], sitting: false, face: "down" },
  { id: "pingpong:1", x: 34, y: 9.6, laneX: 32, via: [], sitting: false, face: "up" },
];

const papoSpot = (id: string, x: number, sitting = false): RestSpot => ({ ...spot(id, "papo"), x, y: 15, sitting, sofa: sitting });
const PAPO: PapoPlace[] = [{ id: "copa", spots: [papoSpot("cafe:0", 27), papoSpot("cafe:1", 28.5), papoSpot("cafe:2", 30)] }];

const FALAS: Record<string, string[]> = {
  a: ["Oi, tudo bem?", "Bora um café?", "Que dia!"],
  b: ["Tudo ótimo!", "Choveu ontem.", "Vi o jogo."],
  c: ["Eu também!", "Legal isso.", "Hum, sei."],
};

/**
 * Mundo com posições (px) e andar opcionalmente lento: quem está em `stuck` nunca chega (fica
 * andando pra sempre), pra testar a espera pelo parceiro.
 */
function groupWorld(ids: string[], opts: { far?: boolean; stuck?: string[] } = {}) {
  const w = world(ids);
  ids.forEach((id, i) => {
    const a = w.actors.get(id)!;
    a.x = opts.far ? i * (PAPO_RADIUS_PX + 50) : 100 + i * 20;
    a.y = 100;
    a.falas = FALAS[id];
  });
  const goTo = w.mover.goTo;
  w.mover.goTo = (id, s) => {
    if (opts.stuck?.includes(id)) {
      w.actors.get(id)!.walking = true;
      w.log.push(`${id} goTo ${s.id}`);
      return;
    }
    goTo(id, s);
  };
  const goHome = w.mover.goHome;
  w.mover.goHome = (id) => {
    w.actors.get(id)!.walking = false;
    goHome(id);
  };
  return w;
}

/** roda até `cond` (ou estoura); devolve o instante */
function until(s: RestScheduler, w: ReturnType<typeof world>, from: number, cond: () => boolean, max = 600_000, step = 100): number {
  for (let now = from; now < from + max; now += step) {
    s.update(now, w.actors.values(), w.mover);
    if (cond()) return now;
  }
  assert.fail("a condição nunca aconteceu");
}

describe("ping-pong", () => {
  it("só começa com 2 livres: sozinho nunca joga", () => {
    const s = new RestScheduler([], { seed: 1, pingpong: PP });
    const w = groupWorld(["a"]);
    run(s, w, 0, 300_000, 100, () => assert.notEqual(s.kind("a"), "pingpong"));
    assert.ok(!s.options("a").includes("pingpong"), "sem parceiro, sem ping-pong");
  });

  it("com 2 livres: os dois vão juntos, cada um num lado, e a partida começa quando os dois chegam", () => {
    const s = new RestScheduler([], { seed: 2, pingpong: PP });
    const w = groupWorld(["a", "b"]);
    const now = until(s, w, 0, () => s.kind("a") === "pingpong" || s.kind("b") === "pingpong");
    assert.equal(s.kind("a"), "pingpong");
    assert.equal(s.kind("b"), "pingpong");
    assert.deepEqual(new Set([s.reservations.holder("pingpong:0"), s.reservations.holder("pingpong:1")]), new Set(["a", "b"]));
    assert.deepEqual([...s.groupOf("a")].sort(), ["a", "b"]);
    const t = until(s, w, now + 100, () => s.phase("a") === "fazendo" && s.phase("b") === "fazendo", 5000);
    assert.equal(s.restLabel("a"), "Jogando ping-pong");
    // na partida: raquete no "swing", bolinha indo e voltando entre os lados
    const froms = new Set<number>();
    for (let k = t; k < t + 5000; k += 50) {
      assert.equal(s.pose("a", k, true)?.anim, "swing");
      const f = s.rally(k);
      assert.ok(f);
      if (f.state === "voo") froms.add(f.from);
    }
    assert.deepEqual(froms, new Set([0, 1]));
  });

  it("golpes de 500 a 800 ms, braço erguido na chegada da bolinha e ~1 erro em 12", () => {
    const s = new RestScheduler([], { seed: 5, pingpong: PP });
    const w = groupWorld(["a", "b"]);
    let t = until(s, w, 0, () => s.phase("a") === "fazendo" && s.phase("b") === "fazendo");
    let strokes = 0;
    let misses = 0;
    let last: { from: number; startedAt: number } | null = null;
    // várias partidas seguidas (cada uma dura 20–60 s) até juntar golpes suficientes
    for (let rounds = 0; rounds < 40 && strokes < 600; rounds++) {
      for (; s.phase("a") === "fazendo"; t += 10) {
        const f = s.rally(t);
        if (f?.state === "voo") {
          if (!last || last.from !== f.from || t - last.startedAt > 900) {
            strokes++;
            if (f.miss) misses++;
            last = { from: f.from, startedAt: t };
          }
          // quem recebe ergue o braço (animT > 0,8) só no fim do voo
          const receiver = s.pose(f.from === 0 ? who(s, 1) : who(s, 0), t, true);
          if (f.p < 0.7) assert.ok((receiver?.animT ?? 0) <= 0.8, "ergueu cedo demais");
          if (f.p > 0.85) assert.ok((receiver?.animT ?? 0) > 0.8, "não ergueu o braço na chegada");
        } else last = null;
        s.update(t, w.actors.values(), w.mover);
      }
      t = until(s, w, t, () => s.phase("a") === "fazendo" && s.phase("b") === "fazendo" && s.kind("a") === "pingpong", 900_000);
    }
    assert.ok(strokes >= 600, `só ${strokes} golpes`);
    const rate = misses / strokes;
    assert.ok(Math.abs(rate - MISS_CHANCE) < 0.04, `taxa de erro ${rate.toFixed(3)}`);
  });

  /** quem está no lado `side` da mesa */
  function who(s: RestScheduler, side: 0 | 1): string {
    return s.reservations.holder(PP[side].id) ?? "";
  }

  it("quem chega primeiro espera até ~8 s; o outro não veio: soltam a mesa e escolhem outra coisa", () => {
    const s = new RestScheduler([spot("planta", "regar")], { seed: 3, pingpong: PP });
    const w = groupWorld(["a", "b"], { stuck: ["b"] });
    // o "a" pode ser quem chamou ou quem foi chamado; o "b" nunca chega
    const start = until(s, w, 0, () => s.kind("a") === "pingpong");
    const arrived = until(s, w, start, () => !w.actors.get("a")!.walking && s.kind("a") === "pingpong", 2000);
    // ainda esperando um pouco antes do limite
    run(s, w, arrived + 100, arrived + PARTNER_WAIT_MS - 300);
    assert.equal(s.kind("a"), "pingpong");
    assert.equal(s.phase("a"), "indo", "sem o parceiro a partida não começa");
    assert.equal(s.rally(arrived + PARTNER_WAIT_MS - 300), null);
    run(s, w, arrived + PARTNER_WAIT_MS - 200, arrived + PARTNER_WAIT_MS + 300);
    assert.notEqual(s.kind("a"), "pingpong");
    assert.notEqual(s.kind("b"), "pingpong");
    assert.equal(s.reservations.holder("pingpong:0"), undefined);
    assert.equal(s.reservations.holder("pingpong:1"), undefined);
    assert.ok(!s.pingpongInUse());
  });

  it("interrupt de um acaba a partida: o outro solta a mesa e escolhe outra atividade", () => {
    // com a planta também no sorteio, procura uma semente em que os dois ficam livres juntos
    let found: { s: RestScheduler; w: ReturnType<typeof groupWorld>; t: number } | null = null;
    for (let seed = 1; seed < 100 && !found; seed++) {
      const s = new RestScheduler([spot("planta", "regar")], { seed, pingpong: PP });
      const w = groupWorld(["a", "b"]);
      for (let now = 0; now < 300_000; now += 100) {
        s.update(now, w.actors.values(), w.mover);
        if (s.kind("a") === "pingpong" && s.phase("a") === "fazendo" && s.phase("b") === "fazendo") {
          found = { s, w, t: now };
          break;
        }
      }
    }
    assert.ok(found, "nenhuma semente formou partida");
    const { s, w, t } = found;
    w.log.length = 0;
    w.actors.get("a")!.idle = false;
    s.interrupt("a", w.mover, t);
    assert.ok(!s.isResting("a"));
    assert.equal(s.kind("b"), undefined, "o parceiro larga a partida na hora");
    assert.equal(s.reservations.holder("pingpong:0"), undefined);
    assert.equal(s.reservations.holder("pingpong:1"), undefined);
    assert.equal(s.rally(t), null);
    // no próximo passo o "b" escolhe outra coisa (ou volta pra mesa se não houver nada)
    s.update(t + 100, w.actors.values(), w.mover);
    assert.notEqual(s.kind("b"), "pingpong");
    assert.ok(w.log.some((l) => l === "b goTo planta" || l === "b goHome"), w.log.join(" | "));
  });
it("grupo desfeito e quem sobrou é chamado antes do próximo passo: vai pra mesa (não trabalha em pé no jogo)", () => {
    const s = new RestScheduler([spot("planta", "regar")], { seed: 2, pingpong: PP });
    const w = groupWorld(["a", "b"]);
    const t = until(s, w, 0, () => s.kind("a") === "pingpong" && s.phase("a") === "fazendo" && s.phase("b") === "fazendo");
    w.actors.get("a")!.idle = false;
    s.interrupt("a", w.mover, t);
    // o "b" ficou sem descanso, esperando escolher outra coisa: ainda conta como descansando
    assert.equal(s.kind("b"), undefined);
    assert.ok(s.isResting("b"), "o motor precisa saber que ele ainda não está na mesa");
    // chamado pro trabalho antes do update: o upsert chama interrupt
    w.log.length = 0;
    w.actors.get("b")!.idle = false;
    if (s.isResting("b")) s.interrupt("b", w.mover, t + 10);
    assert.deepEqual(w.log, ["b goHome"]);
    assert.ok(!s.isResting("b"));
    s.update(t + 100, w.actors.values(), w.mover);
    assert.equal(s.kind("b"), undefined);
    assert.ok(!w.log.some((l) => l.startsWith("b goTo")), w.log.join(" | "));
  });

  it("grupo desfeito e quem sobrou já não está ocioso no update (snapshot): volta pra mesa", () => {
    const s = new RestScheduler([spot("planta", "regar")], { seed: 2, pingpong: PP });
    const w = groupWorld(["a", "b"]);
    const t = until(s, w, 0, () => s.kind("a") === "pingpong" && s.phase("a") === "fazendo" && s.phase("b") === "fazendo");
    w.actors.get("a")!.idle = false;
    s.interrupt("a", w.mover, t);
    w.log.length = 0;
    w.actors.get("b")!.idle = false;
    s.update(t + 100, w.actors.values(), w.mover);
    assert.ok(w.log.includes("b goHome"), w.log.join(" | "));
    assert.ok(!s.isResting("b"));
  });
});

describe("bate-papo", () => {
  it("não forma sem parceiro por perto (> 200 px)", () => {
    const s = new RestScheduler([], { seed: 1, papoPlaces: PAPO });
    const w = groupWorld(["a", "b", "c"], { far: true });
    run(s, w, 0, 300_000, 100, () => {
      for (const id of ["a", "b", "c"]) assert.notEqual(s.kind(id), "papo");
    });
  });

  it("forma com 2 ou 3 por perto, reserva os lugares, se olham e revezam falas sem repetir a mesma seguida", () => {
    const s = new RestScheduler([], { seed: 7, papoPlaces: PAPO });
    const w = groupWorld(["a", "b", "c"]);
    const t = until(s, w, 0, () => ["a", "b", "c"].some((id) => s.kind(id) === "papo" && s.phase(id) === "fazendo"));
    const crew = ["a", "b", "c"].filter((id) => s.kind(id) === "papo");
    assert.ok(crew.length >= 2 && crew.length <= 3, `grupo de ${crew.length}`);
    assert.deepEqual([...s.groupOf(crew[0])].sort(), [...crew].sort());
    for (const id of crew) assert.equal(s.reservations.heldBy(id).length, 1);
    assert.equal(s.restLabel(crew[0]), "Batendo papo");
    w.log.length = 0;
    const faces = new Set<string>();
    for (let k = t; s.phase(crew[0]) === "fazendo"; k += 100) {
      s.update(k, w.actors.values(), w.mover);
      for (const id of crew) {
        const f = s.face(id);
        if (f) faces.add(f);
      }
    }
    // em pé lado a lado: olham pra esquerda e pra direita
    assert.ok(faces.has("left") && faces.has("right"), [...faces].join(","));
    const says = w.log.filter((l) => l.includes(" say ")).map((l) => ({ id: l.split(" ")[0], text: l.split(" say ")[1] }));
    assert.ok(says.length >= 2, `${says.length} falas`);
    assert.ok(new Set(says.map((x) => x.id)).size >= 2, "só um falou");
    for (const x of says) assert.ok(FALAS[x.id].includes(x.text), `${x.text} não é fala de ${x.id}`);
    for (const id of crew) {
      const mine = says.filter((x) => x.id === id).map((x) => x.text);
      for (let i = 1; i < mine.length; i++) assert.notEqual(mine[i], mine[i - 1], `${id} repetiu "${mine[i]}"`);
    }
    // ninguém fala duas vezes seguidas: reveza
    for (let i = 1; i < says.length; i++) assert.notEqual(says[i].id, says[i - 1].id);
  });

  it("interrupt desfaz aos poucos: com 3 os outros 2 continuam; com 2, quem sobra volta a escolher", () => {
    let found: { s: RestScheduler; w: ReturnType<typeof groupWorld>; t: number; crew: string[] } | null = null;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const s = new RestScheduler([spot("planta", "regar")], { seed, papoPlaces: PAPO });
      const w = groupWorld(["a", "b", "c"]);
      for (let now = 0; now < 200_000; now += 100) {
        s.update(now, w.actors.values(), w.mover);
        const crew = ["a", "b", "c"].filter((id) => s.kind(id) === "papo" && s.phase(id) === "fazendo");
        if (crew.length === 3) {
          found = { s, w, t: now, crew };
          break;
        }
      }
    }
    assert.ok(found, "nenhuma semente formou papo de 3");
    const { s, w, t, crew } = found;
    const [x, y, z] = crew;
    w.actors.get(x)!.idle = false;
    s.interrupt(x, w.mover, t);
    assert.ok(!s.isResting(x));
    for (const id of [y, z]) {
      assert.equal(s.kind(id), "papo");
      assert.equal(s.phase(id), "fazendo");
    }
    assert.deepEqual([...s.groupOf(y)].sort(), [y, z].sort());
    s.update(t + 100, w.actors.values(), w.mover);
    assert.equal(s.kind(y), "papo", "com 2 a conversa segue");
    w.actors.get(y)!.idle = false;
    s.interrupt(y, w.mover, t + 200);
    assert.equal(s.kind(z), undefined, "sozinho não tem papo");
    assert.equal(s.reservations.heldBy(z).length, 0, "soltou o lugar");
    s.update(t + 300, w.actors.values(), w.mover);
    assert.notEqual(s.kind(z), "papo");
  });

  it("remove (saiu pela porta) também desfaz o grupo", () => {
    const s = new RestScheduler([], { seed: 2, pingpong: PP });
    const w = groupWorld(["a", "b"]);
    until(s, w, 0, () => s.kind("a") === "pingpong");
    s.remove("b");
    assert.equal(s.kind("a"), undefined);
    assert.equal(s.reservations.size, 0);
  });
});

describe("grupo espontâneo (dois livres)", () => {
  const isGroup = (k: RestKind | undefined) => k === "pingpong" || k === "papo";

  it("dois livres juntos formam ping-pong ou papo logo depois da carência", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const s = new RestScheduler([], { seed, pingpong: PP, papoPlaces: PAPO });
      const w = groupWorld(["a", "b"]);
      const t = until(s, w, 0, () => isGroup(s.kind("a")), 30_000);
      assert.ok(t <= IDLE_GRACE_MS + 10 * CHECK_MS + 500, `seed ${seed}: formou só em ${t} ms`);
      assert.ok(isGroup(s.kind("b")), "o parceiro entra junto");
      assert.equal(s.kind("a"), s.kind("b"));
    }
  });

  it("sozinho nunca forma grupo", () => {
    const s = new RestScheduler([], { seed: 1, pingpong: PP, papoPlaces: PAPO });
    const w = groupWorld(["a"]);
    run(s, w, 0, 300_000, 100, () => assert.ok(!isGroup(s.kind("a"))));
  });

  it("papo não forma com parceiro a mais de 200 px; ping-pong só com a mesa livre", () => {
    const far = new RestScheduler([], { seed: 1, papoPlaces: PAPO });
    const wf = groupWorld(["a", "b"], { far: true });
    run(far, wf, 0, 120_000, 100, () => assert.ok(!isGroup(far.kind("a")) && !isGroup(far.kind("b"))));

    const busy = new RestScheduler([], { seed: 1, pingpong: PP });
    busy.reservations.reserve("pingpong:0", "x");
    const wb = groupWorld(["a", "b"]);
    run(busy, wb, 0, 120_000, 100, () => assert.notEqual(busy.kind("a"), "pingpong"));
  });

  /** primeira atividade de qualquer um dos dois, com lugares de sobra */
  const firstKind = (seed: number, chance: number): RestKind => {
    const s = new RestScheduler(SPOTS, { seed, pingpong: PP, papoPlaces: PAPO, groupOnFreeChance: chance });
    const w = groupWorld(["a", "b"]);
    let k: RestKind | undefined;
    until(s, w, 0, () => (k = s.kind("a") ?? s.kind("b")) !== undefined, 60_000);
    return k!;
  };

  it("com lugares de sobra, forma grupo na primeira decisão mais vezes do que sem o atalho", () => {
    const N = 300;
    let on = 0;
    let off = 0;
    for (let seed = 1; seed <= N; seed++) {
      if (isGroup(firstKind(seed, GROUP_ON_FREE_CHANCE))) on++;
      if (isGroup(firstKind(seed, 0))) off++;
    }
    assert.ok(on / N < 0.65, `atalho forte demais: ${on / N}`);
    assert.ok(on / N > off / N + 0.1, `com atalho ${on / N}, sem ${off / N}`);
  });

  it("sem dominância: um par não repete o tipo e os grupos ficam abaixo de 40% num intervalo longo", () => {
    const s = new RestScheduler(SPOTS, { seed: 9, pingpong: PP, papoPlaces: PAPO });
    const w = groupWorld(["a", "b"]);
    const runs: RestKind[] = [];
    let cur: RestKind | undefined;
    run(s, w, 0, 3_000_000, 100, () => {
      const k = s.kind("a");
      if (k && !cur) runs.push(k);
      cur = k;
    });
    for (let i = 1; i < runs.length; i++) assert.notEqual(runs[i], runs[i - 1], `repetiu ${runs[i]}`);
    const groups = runs.filter(isGroup).length;
    assert.ok(groups / runs.length < 0.4, `grupos dominam: ${groups}/${runs.length}`);
  });

  it("atalho espontâneo: parceiro em pausa não é puxado (strict); o sorteio normal ainda puxa", () => {
    const log = (seed: number, chance: number) => {
      const s = new RestScheduler(SPOTS, { seed, pingpong: PP, papoPlaces: PAPO, groupOnFreeChance: chance });
      const w = groupWorld(["a", "b"]);
      s.update(0, w.actors.values(), w.mover); // cria as agendas
      // b em pausa (só um campo interno, como depois de uma atividade)
      (s as unknown as { tracks: Map<string, { pauseUntil: number }> }).tracks.get("b")!.pauseUntil = 40_000;
      run(s, w, 100, 39_000, 100);
      return w.log.join("\n");
    };
    let pulled = 0;
    for (let seed = 1; seed <= 30; seed++) {
      // chance 1 não puxa b: a agenda é igual à do atalho desligado
      assert.equal(log(seed, 1), log(seed, 0), `seed ${seed}: atalho puxou parceiro em pausa`);
      if (log(seed, 0).includes("b goTo")) pulled++;
    }
    assert.ok(pulled > 0, "o sorteio normal deveria puxar o parceiro em pausa em alguma semente");
  });

  it("sem grupo possível (sozinho) a agenda é idêntica à de um scheduler sem ping-pong/papo", () => {
    const trace = (withGroups: boolean) => {
      const s = new RestScheduler(SPOTS, withGroups ? { seed: 4, pingpong: PP, papoPlaces: PAPO } : { seed: 4 });
      const w = groupWorld(["a"]);
      run(s, w, 0, 400_000, 250);
      return w.log.join("\n");
    };
    assert.equal(trace(true), trace(false));
  });

  it("é determinístico com a mesma semente (dois livres, lugares de sobra)", () => {
    const trace = (seed: number) => {
      const s = new RestScheduler(SPOTS, { seed, pingpong: PP, papoPlaces: PAPO });
      const w = groupWorld(["a", "b"]);
      run(s, w, 0, 300_000, 250);
      return w.log.join("\n");
    };
    assert.equal(trace(5), trace(5));
    assert.notEqual(trace(5), trace(6));
  });
});
