import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Gravador, arquivoDoDia, lerHookTs } from "./gravador.ts";
import { lerJsonl } from "./replay.ts";

test("gravador acrescenta marcador e eventos em ordem, no arquivo do dia, no formato do replay", async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "studio-gravador-"));
  try {
    let t = new Date(2026, 9, 5, 10, 0, 0).getTime();
    const g = new Gravador(pasta, () => t);
    g.servidorIniciou();
    for (let i = 0; i < 20; i++) {
      t += 10;
      g.evento({ hook_event_name: "PreToolUse", session_id: "s", n: i }, i % 2 ? t - 5 : null);
    }
    await g.esvaziar();
    const arquivo = arquivoDoDia(pasta, t);
    assert.equal(path.basename(arquivo), "2026-10-05.jsonl");
    const linhas = lerJsonl(fs.readFileSync(arquivo, "utf8"));
    assert.equal(linhas.length, 21);
    assert.deepEqual(linhas[0], { chegada: new Date(2026, 9, 5, 10, 0, 0).getTime(), marcador: "servidor_iniciou" });
    const ns = linhas.slice(1).map((l) => ("evento" in l ? (l.evento as { n: number }).n : -1));
    assert.deepEqual(ns, [...Array(20).keys()]);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

test("lerHookTs: número válido ou null", () => {
  assert.equal(lerHookTs("1700000000000"), 1700000000000);
  assert.equal(lerHookTs(undefined), null);
  assert.equal(lerHookTs(""), null);
  assert.equal(lerHookTs("abc"), null);
});
