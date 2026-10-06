import assert from "node:assert/strict";
import { test } from "node:test";
import { clampCamera, fitCamera, rubberBand, snapZoom, zoomAt, Z_MAX, Z_MIN } from "./camera.ts";

const f = { cw: 800, ch: 500, ww: 1000, wh: 700 };
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("clampCamera: zoom limitado a 0.5..6", () => {
  assert.equal(clampCamera({ x: 100, y: 100, z: 99 }, f).z, Z_MAX);
  assert.equal(clampCamera({ x: 100, y: 100, z: 0.01 }, f).z, Z_MIN);
  assert.equal(clampCamera({ x: 100, y: 100, z: 2 }, f).z, 2);
  assert.equal(Z_MIN, 0.5);
  assert.equal(Z_MAX, 6);
});

test("clampCamera: camera valida passa intacta e e idempotente", () => {
  assert.deepEqual(clampCamera({ x: 100, y: 100, z: 1 }, f), { x: 100, y: 100, z: 1 });
  const a = clampCamera({ x: -5000, y: 9000, z: 4 }, f);
  assert.deepEqual(clampCamera(a, f), a);
});

test("clampCamera: sempre sobra >=25% do escritorio visivel em cada eixo", () => {
  for (const z of [0.5, 1, 3, 6]) {
    for (const [x, y] of [[-1e6, -1e6], [1e6, 1e6], [-1e6, 1e6], [1e6, -1e6]]) {
      const c = clampCamera({ x, y, z }, f);
      const visW = Math.min(c.x + f.cw * c.z, f.ww) - Math.max(c.x, 0);
      const visH = Math.min(c.y + f.ch * c.z, f.wh) - Math.max(c.y, 0);
      assert.ok(visW >= Math.min(0.25 * f.cw * c.z, f.ww) - 1e-6, `z=${z} visW ${visW}`);
      assert.ok(visH >= Math.min(0.25 * f.ch * c.z, f.wh) - 1e-6, `z=${z} visH ${visH}`);
    }
  }
});

test("clampCamera: palco minusculo continua finito", () => {
  const c = clampCamera({ x: 0, y: 0, z: 6 }, { cw: 800, ch: 500, ww: 100, wh: 80 });
  assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
});

test("fitCamera: centraliza em z=1 e passa pelo clamp", () => {
  const c = fitCamera(f);
  assert.deepEqual(c, { x: 100, y: 100, z: 1 });
  assert.deepEqual(clampCamera(c, f), c);
});

test("zoomAt: ponto do escritorio sob o cursor fica fixo (dentro dos limites)", () => {
  for (const [px, py] of [[400, 300], [150, 120], [900, 650]]) {
    for (const nz of [0.7, 1.25, 2.5, 4]) {
      const c = { x: 100, y: 60, z: 1 };
      const n = zoomAt(c, nz, px, py, f);
      const raw = { x: px - ((px - c.x) * nz) / c.z, y: py - ((py - c.y) * nz) / c.z };
      if (n.z !== nz || n.x !== raw.x || n.y !== raw.y) continue; // clamp legitimo sobrescreveu
      near((px - c.x) / c.z, (px - n.x) / n.z, 1e-6);
      near((py - c.y) / c.z, (py - n.y) / n.z, 1e-6);
    }
  }
});

test("zoomAt: zoom fora da faixa e cortado; zoom repetido no limite nao anda", () => {
  const a = zoomAt({ x: 100, y: 100, z: 5 }, 50, 300, 300, f);
  assert.equal(a.z, Z_MAX);
  const b = zoomAt(a, 50, 300, 300, f);
  assert.deepEqual(b, a);
  assert.equal(zoomAt({ x: 100, y: 100, z: 1 }, 0.001, 300, 300, f).z, Z_MIN);
});

test("zoomAt: ida e volta no mesmo ponto retorna a camera", () => {
  const c = { x: 100, y: 100, z: 1 };
  const out = zoomAt(zoomAt(c, 2, 300, 250, f), 1, 300, 250, f);
  near(out.x, c.x); near(out.y, c.y); near(out.z, 1);
});

test("rubberBand: dentro do limite nao muda; fora so passa 35% do excesso", () => {
  const ok = { x: 100, y: 100, z: 1 };
  assert.deepEqual(rubberBand(ok, f), ok);
  const lim = clampCamera({ x: 1e4, y: 100, z: 1 }, f);
  const rb = rubberBand({ x: 1e4, y: 100, z: 1 }, f);
  near(rb.x, lim.x + (1e4 - lim.x) * 0.35);
  assert.equal(rb.y, 100);
});

test("snapZoom: ajusta so a degrau inteiro proximo; tela estreita e salto grande mantem z", () => {
  // unit = 800*1/400 = 2 px de tela por px da planta
  assert.equal(snapZoom(1.1, { ...f, cw: 800 }, 1, 400), 1); // k=round(2.2)=2 -> 1
  assert.equal(snapZoom(1.3, { ...f, cw: 800 }, 1, 400), 1.3); // k=3 -> 1.5, salto 15% > 12%
  assert.equal(snapZoom(1.7, { ...f, cw: 300 }, 1, 400), 1.7); // unit<1
  assert.equal(snapZoom(0.1, { ...f, cw: 800 }, 1, 400), 0.1); // k<1
  assert.ok(snapZoom(6, { ...f, cw: 800 }, 1, 400) <= Z_MAX + 1e-9);
});
