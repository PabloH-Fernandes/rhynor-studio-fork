// Atribuição dos lugares da reunião e rotas dos lugares novos (sem DOM): npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentStatus } from "../../../shared/types";
import { AISLE_Y, DESKS, DOOR_SPOT, MEETING_PRESENTER, MEETING_SEATS, MEETING_STOOLS, OVERFLOW_SPOTS, deskSpot, route, type Point } from "./map";
import { atribuirReuniao, type CandidatoReuniao } from "./reuniao";

const PRESENTER = MEETING_PRESENTER.id;
const LUGARES = MEETING_SEATS.map((s) => s.id);
const LIDER = "s:lider";

function c(id: string, status: AgentStatus = "ocioso", extra: Partial<CandidatoReuniao> = {}): CandidatoReuniao {
  return { id, status, visitante: false, saindo: false, ...extra };
}
const atribui = (cands: CandidatoReuniao[], antes = new Map<string, string>()) => atribuirReuniao(LIDER, cands, antes, PRESENTER, LUGARES);

describe("atribuirReuniao", () => {
  it("o líder vai pro presenter, mesmo trabalhando", () => {
    const r = atribui([c(LIDER, "trabalhando"), c("a")]);
    assert.equal(r.get(LIDER), PRESENTER);
    assert.equal(r.get("a"), LUGARES[0]);
  });

  it("quem está ocioso entra, em ordem, e ninguém usa o presenter", () => {
    const r = atribui([c(LIDER), c("a"), c("b"), c("c")]);
    assert.deepEqual([r.get("a"), r.get("b"), r.get("c")], LUGARES.slice(0, 3));
  });

  it("trabalhando, pensando, esperando, chegando, visitante e saindo não saem da mesa", () => {
    const r = atribui([
      c(LIDER),
      c("t", "trabalhando"),
      c("p", "pensando"),
      c("e", "esperando"),
      c("ch", "chegando"),
      c("v", "ocioso", { visitante: true }),
      c("s", "ocioso", { saindo: true }),
      c("ok"),
    ]);
    for (const id of ["t", "p", "e", "ch", "v", "s"]) assert.equal(r.has(id), false, id);
    assert.equal(r.get("ok"), LUGARES[0]);
  });

  it("líder esperando uma permissão fica na mesa; saindo também", () => {
    assert.equal(atribui([c(LIDER, "esperando")]).has(LIDER), false);
    assert.equal(atribui([c(LIDER, "ocioso", { saindo: true })]).has(LIDER), false);
  });

  it("é estável entre quadros: quem entrou depois não tira o lugar de ninguém", () => {
    const q1 = atribui([c(LIDER), c("a"), c("b")]);
    const q2 = atribui([c("novo"), c(LIDER), c("b"), c("a")], q1);
    assert.equal(q2.get("a"), q1.get("a"));
    assert.equal(q2.get("b"), q1.get("b"));
    assert.equal(q2.get("novo"), LUGARES[2]);
  });

  it("muda de elegibilidade no meio: quem recebe trabalho volta, o lugar liberado é reaproveitado", () => {
    const q1 = atribui([c(LIDER), c("a"), c("b"), c("x", "trabalhando")]);
    assert.equal(q1.has("x"), false);
    // a pega trabalho; x fica livre
    const q2 = atribui([c(LIDER), c("a", "trabalhando"), c("b"), c("x")], q1);
    assert.equal(q2.has("a"), false);
    assert.equal(q2.get("b"), q1.get("b"));
    assert.equal(q2.get("x"), q1.get("a"));
  });

  it("com mais gente que lugares, os últimos ficam na mesa e ninguém repete lugar", () => {
    const gente = Array.from({ length: LUGARES.length + 3 }, (_, i) => c(`g${i}`));
    const r = atribui([c(LIDER), ...gente]);
    assert.equal(r.size, 1 + LUGARES.length);
    assert.equal(new Set(r.values()).size, r.size);
    for (const g of gente.slice(LUGARES.length)) assert.equal(r.has(g.id), false);
    // alguém sai da reunião: o primeiro que sobrava entra no lugar dele, sem mexer nos outros
    const q2 = atribuirReuniao(LIDER, [c(LIDER), ...gente.map((g) => (g.id === "g1" ? c("g1", "trabalhando") : g))], r, PRESENTER, LUGARES);
    assert.equal(q2.get(`g${LUGARES.length}`), r.get("g1"));
    assert.equal(q2.get("g0"), r.get("g0"));
  });

  it("sem candidatos elegíveis ou com Map anterior velho, devolve só o que vale; reunião acabou = Map vazio do motor", () => {
    const velho = new Map([["fantasma", LUGARES[0]], ["a", "lugar:que-nao-existe"]]);
    const r = atribui([c("a")], velho);
    assert.equal(r.has("fantasma"), false);
    assert.equal(r.get("a"), LUGARES[0]);
  });
});

// ---------------------------------------------------------------- rotas

/** onde a mesa redonda (oval 25x12 px + sombra) ocupa, em tiles, com folga de meio boneco */
const MESA = { x0: 14.4, x1: 17.6, y0: 10.4, y1: 12.2 };

function cruzaMesa(pts: Point[]): boolean {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    for (let s = 0; s <= 40; s++) {
      const x = a.x + ((b.x - a.x) * s) / 40;
      const y = a.y + ((b.y - a.y) * s) / 40;
      if (x > MESA.x0 && x < MESA.x1 && y > MESA.y0 && y < MESA.y1) return true;
    }
  }
  return false;
}

describe("rotas da reunião", () => {
  // reuniao:4 (em pé atrás da mesa, lane x 16) já descia por cima da mesa antes desta etapa: fora do teste
  const origens = [DOOR_SPOT, ...DESKS.map(deskSpot), ...OVERFLOW_SPOTS.filter((s) => s.id !== "reuniao:4")];

  it("nenhuma rota até os lugares da reunião (nem de volta) atravessa a mesa", () => {
    for (const to of [MEETING_PRESENTER, ...MEETING_SEATS]) {
      for (const from of origens) {
        assert.equal(cruzaMesa([{ x: from.x, y: from.y }, ...route(from, to)]), false, `${from.id} -> ${to.id}`);
        assert.equal(cruzaMesa([{ x: to.x, y: to.y }, ...route(to, from)]), false, `${to.id} -> ${from.id}`);
      }
    }
    // e entre os próprios lugares da reunião
    for (const a of [MEETING_PRESENTER, ...MEETING_SEATS]) {
      for (const b of [MEETING_PRESENTER, ...MEETING_SEATS]) {
        if (a.id !== b.id) assert.equal(cruzaMesa([{ x: a.x, y: a.y }, ...route(a, b)]), false, `${a.id} -> ${b.id}`);
      }
    }
  });

  it("os lugares ficam fora da mesa, têm ids únicos e os banquinhos não coincidem com os em pé", () => {
    const todos = [MEETING_PRESENTER, ...MEETING_SEATS];
    assert.equal(new Set(todos.map((s) => s.id)).size, todos.length);
    for (const s of todos) assert.equal(cruzaMesa([{ x: s.x, y: s.y }]), false, s.id);
    for (const b of MEETING_STOOLS) {
      for (const o of OVERFLOW_SPOTS) assert.ok(Math.hypot(b.x - o.x, b.y - o.y) >= 0.7, `${b.id} em cima de ${o.id}`);
    }
  });

  it("sentados olham pra mesa e o presenter fica acima dela, de frente", () => {
    const [esq, dir, bEsq, bDir] = MEETING_STOOLS;
    assert.equal(esq.face, "right");
    assert.equal(dir.face, "left");
    assert.equal(bEsq.face, "up");
    assert.equal(bDir.face, "up");
    assert.ok(MEETING_STOOLS.every((s) => s.sitting && s.stool));
    assert.ok(MEETING_PRESENTER.y < MESA.y0 && MEETING_PRESENTER.face === "down");
    assert.ok(MEETING_STOOLS.every((s) => s.y < AISLE_Y));
  });
});
