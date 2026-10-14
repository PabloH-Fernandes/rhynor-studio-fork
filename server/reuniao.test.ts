import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { ServerMessage } from "../shared/types.ts";
import { OfficeState, REUNIAO_MAX_MS, type HookInput } from "./state.ts";

const S1 = "sessao-1";
const S2 = "sessao-2";
const ATA = "ATA-CONFIDENCIAL: o cliente Fulano vai cancelar o contrato em março";

let t: number;
let state: OfficeState;
let msgs: ServerMessage[];

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t = Date.parse("2026-10-13T10:00:00");
  state = new OfficeState({ now: () => t, sweepEveryMs: 0 });
  msgs = [];
  state.subscribe((m) => msgs.push(m));
});

afterEach(() => {
  mock.timers.reset();
});

function advance(ms: number) {
  while (ms > 0) {
    const step = Math.min(ms, 1000);
    t += step;
    mock.timers.tick(step);
    ms -= step;
  }
}

function hook(ev: string, extra: Partial<HookInput> = {}, session = S1) {
  state.handleHook({ hook_event_name: ev, session_id: session, cwd: "/home/pablo/portal", ...extra });
}

const prompt = (p: string, session = S1) => hook("UserPromptSubmit", { prompt: p }, session);
const reunioes = () => msgs.filter((m) => m.type === "reuniao");

test("/reuniao liga a reunião e avisa", () => {
  hook("SessionStart", { source: "startup" });
  assert.equal(state.getReuniao(), null);
  prompt(`/reuniao ${ATA}`);
  const r = state.getReuniao();
  assert.ok(r);
  assert.equal(r.sessionId, S1);
  assert.equal(r.liderId, `s:${S1}`);
  assert.equal(r.desde, t);
  assert.deepEqual(reunioes().at(-1), { type: "reuniao", reuniao: r });
  const snap = state.snapshot();
  assert.equal(snap.type === "snapshot" ? snap.reuniao?.sessionId : "x", S1);
});

test("Stop, outro prompt, SessionEnd e reset desligam", () => {
  prompt("/reuniao");
  hook("Stop");
  assert.equal(state.getReuniao(), null);
  assert.deepEqual(reunioes().at(-1), { type: "reuniao", reuniao: null });

  prompt("/reuniao");
  prompt("agora faça outra coisa");
  assert.equal(state.getReuniao(), null);

  prompt("/reuniao");
  hook("SessionEnd", { reason: "other" });
  assert.equal(state.getReuniao(), null);

  hook("SessionStart", { source: "startup" }, S2);
  prompt("/reuniao", S2);
  assert.ok(state.getReuniao());
  state.reset();
  assert.equal(state.getReuniao(), null);
  const snap = state.snapshot();
  assert.equal(snap.type === "snapshot" ? snap.reuniao : "x", null);
});

test("desliga sozinha em 15 min (Esc não dispara Stop)", () => {
  prompt("/reuniao");
  advance(REUNIAO_MAX_MS - 1000);
  assert.ok(state.getReuniao());
  advance(2000);
  assert.equal(state.getReuniao(), null);
  assert.deepEqual(reunioes().at(-1), { type: "reuniao", reuniao: null });
});

test("reunião de outra sessão não é afetada", () => {
  prompt("/reuniao", S1);
  prompt("olá", S2);
  hook("Stop", {}, S2);
  hook("SessionEnd", { reason: "other" }, S2);
  assert.equal(state.getReuniao()?.sessionId, S1);
});

test("o texto da ata não vai para o feed nem para o estado salvo", () => {
  prompt(`/reuniao ${ATA}`);
  prompt(`<command-name>/reuniao</command-name><command-args>${ATA}</command-args>`);
  const snap = state.snapshot();
  const feed = snap.type === "snapshot" ? snap.feed : [];
  assert.ok(feed.some((f) => f.text === "começou uma reunião (/reuniao)"));
  assert.equal(JSON.stringify(feed).includes("CONFIDENCIAL"), false);
  assert.equal(JSON.stringify(state.serializar()).includes("CONFIDENCIAL"), false);
  assert.equal(JSON.stringify(msgs).includes("CONFIDENCIAL"), false);
  assert.equal(JSON.stringify(state.serializar()).includes("reuniao\":"), false, "a reunião é passageira: não é salva");
});

test("prompt comum continua com o texto no feed", () => {
  prompt("arrume o botão");
  const snap = state.snapshot();
  const feed = snap.type === "snapshot" ? snap.feed : [];
  assert.ok(feed.some((f) => f.text.includes("arrume o botão")));
});
