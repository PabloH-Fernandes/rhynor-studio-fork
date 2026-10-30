// Replay de uma sessão real de produção (anonimizada): o showrunner chama os 9 papéis em 3 lotes em
// background e o Stop do líder chega entre os SubagentStop. Ninguém pode sair com "foi embora" antes
// de entregar: cada papel termina com "entregou o trabalho".
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PAPEIS_DE_PRODUCAO } from "../shared/producao.ts";
import { lerJsonl, reproduzir } from "./replay.ts";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "sessoes", "producao-lotes-background.jsonl");
const TEXTO = fs.readFileSync(FIXTURE, "utf8");

test("produção em background: o Stop do líder no meio do lote não expulsa quem ainda não entregou", () => {
  const { state } = reproduzir(lerJsonl(TEXTO));
  const snap = state.snapshot();
  const feed = snap.type === "snapshot" ? snap.feed : [];

  const papeis = Object.keys(PAPEIS_DE_PRODUCAO);
  assert.equal(papeis.length, 9);
  for (const papel of papeis) {
    const itens = feed.filter((f) => f.role === papel);
    assert.ok(itens.length > 0, `${papel}: apareceu no feed`);
    const ultimo = itens[itens.length - 1];
    assert.equal(ultimo.kind, "done", `${papel}: último item é de saída`);
    assert.equal(ultimo.text, "entregou o trabalho", `${papel}: ${JSON.stringify(itens.map((f) => f.text))}`);
    assert.match(ultimo.simples ?? "", /^terminou a parte del[ea] e foi embora$/, papel);
    assert.ok(!itens.some((f) => f.text === "foi embora"), `${papel}: não foi expulso pelo Stop`);
  }
});
