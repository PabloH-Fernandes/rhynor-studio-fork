// Testes do agendador de descanso (lógica pura, sem DOM): npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RestSpot } from "./map";
import type { Spot } from "./map";
import {
  CHECK_MS,
  DURATION_MAX_MS,
  DURATION_MIN_MS,
  IDLE_GRACE_MS,
  PAUSE_MAX_MS,
  REST_LABELS,
  Reservations,
  RestScheduler,
  hash32,
  mulberry32,
  pickWeighted,
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
      { id, session: "s1", idle: true, idleSince: 0, leaving: false, walking: false, busyAnim: false, atId: `desk:${id}`, homeId: `desk:${id}`, hasDesk },
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
    assert.equal(hash32("ag:dev|s1"), hash32("ag:dev|s1"));
    assert.notEqual(hash32("ag:dev|s1"), hash32("ag:dev|s2"));
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
    const w = world(["ag:dev"]);
    run(s, w, 0, IDLE_GRACE_MS - 100);
    assert.ok(!s.isResting("ag:dev"));
    run(s, w, IDLE_GRACE_MS, IDLE_GRACE_MS + CHECK_MS);
    assert.ok(s.isResting("ag:dev"));
    assert.ok(s.restLabel("ag:dev"));
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
      const w = world(["ag:dev", "ag:testador"]);
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
    // com o mundo instantâneo, todas as atividades aparecem
    assert.deepEqual(new Set(runs.map((r) => r.kind)), new Set(Object.keys(REST_LABELS)));
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
