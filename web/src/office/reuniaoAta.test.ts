import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentStatus } from "../../../shared/types";
import { ATA_JANELA_MS, QUADRO_ATA, escolherLiderDeAta, reuniaoDeAta, type CandidatoLiderAta } from "./reuniaoAta";

function ag(id: string, o: Partial<CandidatoLiderAta> = {}): CandidatoLiderAta {
  return { id, role: o.parentId ? "dev" : "lider", status: "ocioso" as AgentStatus, startedAt: 1000, ...o };
}

test("o líder da sessão apresenta a ata", () => {
  const lista = [ag("ag:dev", { parentId: "s:1", role: "dev", startedAt: 1 }), ag("s:1", { startedAt: 500 })];
  assert.equal(escolherLiderDeAta(lista), "s:1");
});

test("com mais de um líder, o mais antigo; empate pelo id", () => {
  assert.equal(escolherLiderDeAta([ag("s:2", { startedAt: 900 }), ag("s:1", { startedAt: 100 })]), "s:1");
  assert.equal(escolherLiderDeAta([ag("s:b"), ag("s:a")]), "s:a");
});

test("sem líder livre, o AGzinho do time mais antigo", () => {
  const lista = [
    ag("s:1", { status: "esperando" }),
    ag("ag:dev", { parentId: "s:1", role: "dev", startedAt: 300 }),
    ag("ag:revisor", { parentId: "s:1", role: "revisor", startedAt: 200 }),
  ];
  assert.equal(escolherLiderDeAta(lista), "ag:revisor");
});

test("quem espera uma permissão, quem está saindo e visitante não apresentam", () => {
  const lista = [
    ag("s:1", { status: "esperando" }),
    ag("s:2", { status: "saindo" }),
    ag("ag:convidado", { parentId: "s:1", role: "convidado" }),
  ];
  assert.equal(escolherLiderDeAta(lista), null);
  assert.equal(escolherLiderDeAta([]), null);
  assert.equal(reuniaoDeAta(lista, 5), null);
});

test("quem está trabalhando ainda pode apresentar (como numa reunião de verdade)", () => {
  assert.equal(escolherLiderDeAta([ag("s:1", { status: "trabalhando" })]), "s:1");
});

test("a reunião local da ata tem sessão própria e o quadro não leva título", () => {
  assert.deepEqual(reuniaoDeAta([ag("s:1")], 1234), { sessionId: "ata-nova", liderId: "s:1", desde: 1234 });
  assert.equal(QUADRO_ATA, "Nova ata: Chegou uma ata");
  assert.equal(ATA_JANELA_MS, 12_000);
});
