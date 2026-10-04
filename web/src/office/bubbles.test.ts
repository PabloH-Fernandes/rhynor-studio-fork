// Testes do layout de balões (lógica pura, sem DOM): npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Rect } from "./decor";
import { inside, overlaps, placeBubbles, type BubbleReq, type FloatReq } from "./bubbles";

const BOUNDS: Rect = { x: 1, y: 1, w: 574, h: 286 };

/** balão de 40x12 acima de uma cabeça em (x, y) */
function bubble(id: string, x: number, y: number, priority = 1, extra: Partial<FloatReq> = {}): FloatReq {
  return { id, priority, sizes: [{ w: 40, h: 12 }], ax: x, ay: y - 2, headY: y, tail: 3, gap: 1, ...extra };
}

function assertNoOverlap(rects: Rect[], forbidden: Rect[] = []) {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) assert.ok(!overlaps(rects[i], rects[j]), `sobrepõe: ${JSON.stringify(rects[i])} ${JSON.stringify(rects[j])}`);
    for (const f of forbidden) assert.ok(!overlaps(rects[i], f), `em zona proibida: ${JSON.stringify(rects[i])}`);
  }
}

describe("placeBubbles", () => {
  it("sozinho e com espaço: fica bem acima da cabeça, com o rabinho dentro do retângulo", () => {
    const { placed } = placeBubbles([bubble("a", 100, 100)], [], BOUNDS);
    const p = placed.get("a");
    assert.ok(p);
    assert.equal(p.side, "above");
    assert.deepEqual(p.box, { x: 80, y: 82, w: 40, h: 12 });
    assert.deepEqual(p.rect, { x: 80, y: 82, w: 40, h: 15 });
  });

  it("nunca sobrepõe: cabeças coladas (sofá lotado) se espalham (acima deslocado, lados) ou ficam de fora", () => {
    const reqs = Array.from({ length: 12 }, (_, i) => bubble(`b${i}`, 200 + i * 6, 150));
    const { placed, rects } = placeBubbles(reqs, [], BOUNDS);
    assertNoOverlap(rects);
    assert.ok(placed.size >= 2 && placed.size < 12, `${placed.size} colocados`);
    const sides = new Set([...placed.values()].map((p) => p.side));
    assert.ok(sides.has("above"));
  });

  it("muitas cabeças aleatórias: nada sobrepõe nada, nem zona proibida, e tudo fica no canvas", () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const forbidden: Rect[] = [
      { x: 203, y: 4, w: 106, h: 37 },
      { x: 120, y: 148, w: 42, h: 9 },
      { x: 300, y: 212, w: 42, h: 9 },
    ];
    for (let round = 0; round < 50; round++) {
      const reqs: BubbleReq[] = Array.from({ length: 30 }, (_, i) =>
        bubble(`r${i}`, 10 + Math.round(rnd() * 556), 20 + Math.round(rnd() * 260), Math.floor(rnd() * 5), { sizes: [{ w: 20 + Math.round(rnd() * 80), h: 7 + Math.round(rnd() * 13) }] }),
      );
      const { rects } = placeBubbles(reqs, forbidden, BOUNDS);
      assertNoOverlap(rects, forbidden);
      for (const r of rects) assert.ok(inside(r, BOUNDS), `fora do canvas: ${JSON.stringify(r)}`);
    }
  });

  it("respeita zona proibida: com a plaquinha em cima da cabeça, vai pro lado", () => {
    const plate: Rect = { x: 60, y: 80, w: 80, h: 8 };
    const { placed } = placeBubbles([bubble("a", 100, 100)], [plate], BOUNDS);
    const p = placed.get("a");
    assert.ok(p);
    assert.ok(!overlaps(p.rect, plate));
  });

  it("acima deslocado antes dos lados", () => {
    // bloqueia só o meio: o +-8 já escapa
    const block: Rect = { x: 96, y: 70, w: 8, h: 30 };
    const p = placeBubbles([bubble("a", 100, 100, 1, { sizes: [{ w: 10, h: 12 }] })], [block], BOUNDS).placed.get("a");
    assert.ok(p);
    assert.equal(p.side, "above");
    assert.ok(Math.abs(p.box.x + p.box.w / 2 - 100) <= 16);
  });

  it("sem lugar nenhum: fica de fora (a não ser que seja `always`)", () => {
    const wall: Rect = { x: 0, y: 0, w: 576, h: 288 };
    assert.equal(placeBubbles([bubble("a", 100, 100)], [wall], BOUNDS).placed.size, 0);
    const forced = placeBubbles([bubble("a", 100, 100, 1, { always: true })], [wall], BOUNDS).placed.get("a");
    assert.ok(forced?.forced);
  });

  it("prioridade: o mais importante fica com o lugar, mesmo vindo depois na lista", () => {
    // só cabe um (cabeça encostada no topo do canvas; os lados estão bloqueados)
    const sides: Rect[] = [
      { x: 0, y: 0, w: 85, h: 288 },
      { x: 115, y: 0, w: 461, h: 288 },
    ];
    const reqs = [bubble("descanso", 100, 60, 3, { sizes: [{ w: 28, h: 10 }] }), bubble("trabalho", 100, 60, 1, { sizes: [{ w: 28, h: 12 }] })];
    const { placed } = placeBubbles(reqs, sides, BOUNDS);
    assert.ok(placed.has("trabalho"));
    assert.ok(!placed.has("descanso"));
  });

  it('o "!" (fixo) sempre entra, mesmo em zona proibida, e os outros desviam dele', () => {
    const forbidden: Rect[] = [{ x: 90, y: 80, w: 20, h: 20 }];
    const reqs: BubbleReq[] = [bubble("b", 100, 110, 1), { id: "!", priority: 0, fixed: { x: 95, y: 85, w: 10, h: 12 } }];
    const { placed, rects } = placeBubbles(reqs, forbidden, BOUNDS);
    assert.deepEqual(placed.get("!")?.rect, { x: 95, y: 85, w: 10, h: 12 });
    const b = placed.get("b");
    if (b) assert.ok(!overlaps(b.rect, { x: 95, y: 85, w: 10, h: 12 }));
    assert.equal(rects[0], placed.get("!")?.rect);
  });

  it("ocupados de um passe anterior bloqueiam (nomes depois dos balões)", () => {
    const first = placeBubbles([bubble("balao", 100, 100)], [], BOUNDS);
    const name: FloatReq = { id: "nome", priority: 4, sizes: [{ w: 40, h: 7 }], ax: 100, ay: 98, headY: 100, tail: 0, gap: 0 };
    const second = placeBubbles([name], [], BOUNDS, first.rects);
    const n = second.placed.get("nome");
    assert.ok(n);
    assert.ok(!overlaps(n.rect, first.rects[0]));
  });

  it("tamanho alternativo: sem lugar pro nome inteiro, usa o apelido", () => {
    // espaço de 30 px entre dois bloqueios, só acima
    const forbidden: Rect[] = [
      { x: 0, y: 0, w: 85, h: 288 },
      { x: 115, y: 0, w: 461, h: 288 },
    ];
    const name: FloatReq = { id: "n", priority: 4, sizes: [{ w: 50, h: 7 }, { w: 20, h: 7 }], ax: 100, ay: 98, headY: 100, tail: 0, gap: 0 };
    const p = placeBubbles([name], forbidden, BOUNDS).placed.get("n");
    assert.ok(p);
    assert.equal(p.size, 1);
  });

  it("prefer: repete o candidato do quadro anterior se ainda couber (não fica pulando)", () => {
    const a = placeBubbles([bubble("a", 100, 100, 1, { prefer: 5 })], [], BOUNDS).placed.get("a");
    assert.equal(a?.side, "left");
    assert.equal(a?.cand, 5);
  });
  it("positionFirst: o apelido bem em cima ganha do nome inteiro deslocado", () => {
    // o nome inteiro (60) só cabe deslocado +8; o apelido (20) cabe centrado
    const block: Rect = { x: 60, y: 80, w: 12, h: 30 };
    const base: FloatReq = { id: "n", priority: 4, sizes: [{ w: 60, h: 7 }, { w: 20, h: 7 }], ax: 100, ay: 98, headY: 100, tail: 0, gap: 0, shifts: [0, -8, 8] };
    const sizeFirst = placeBubbles([base], [block], BOUNDS).placed.get("n");
    assert.equal(sizeFirst?.size, 0, "por padrão tenta todas as posições do nome inteiro antes");
    const near = placeBubbles([{ ...base, positionFirst: true }], [block], BOUNDS).placed.get("n");
    assert.equal(near?.size, 1);
    assert.equal(near?.box.x, 90);
  });
  it("avoid é custo: evita a cabeça se houver outro lugar, cobre se não houver", () => {
    const head: Rect = { x: 115, y: 95, w: 14, h: 14 };
    // à direita cobriria a cabeça do vizinho; acima está bloqueado, sobra a esquerda
    const top: Rect = { x: 0, y: 0, w: 576, h: 95 };
    const req = bubble("a", 100, 100, 1, { sizes: [{ w: 20, h: 12 }], prefer: 6 });
    const p = placeBubbles([req], [top], BOUNDS, [], [head]).placed.get("a");
    assert.equal(p?.side, "left");
    // esquerda também bloqueada: aceita cobrir a cabeça
    const left: Rect = { x: 0, y: 0, w: 95, h: 288 };
    const q = placeBubbles([req], [top, left], BOUNDS, [], [head]).placed.get("a");
    assert.equal(q?.side, "right");
    assert.ok(overlaps(q!.rect, head));
  });
});
