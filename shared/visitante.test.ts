import assert from "node:assert/strict";
import { test } from "node:test";
import { PAPEIS_DE_PRODUCAO, ehProducao } from "./producao.ts";
import { MAX_VISITANTES_NA_TELA, PAPEIS_DO_TIME, ehVisitante } from "./visitante.ts";

test("ehVisitante: só subagente de papel fora do time; time, variações e líder não são", () => {
  for (const role of PAPEIS_DO_TIME) assert.equal(ehVisitante({ parentId: "s:x", role }), false, role);
  // dev-2 e pesquisador-2 têm o papel do principal
  assert.equal(ehVisitante({ parentId: "s:x", role: "dev" }), false);
  // Diego, Cida, Ícaro (convidado) e extras (tipo desconhecido)
  assert.equal(ehVisitante({ parentId: "s:x", role: "convidado" }), true);
  assert.equal(ehVisitante({ parentId: "s:x", role: "code-reviewer" }), true);
  // sem parentId é líder (ou convidado que lidera uma 2ª sessão)
  assert.equal(ehVisitante({ role: "lider" }), false);
  assert.equal(ehVisitante({ role: "convidado" }), false);
  assert.equal(MAX_VISITANTES_NA_TELA, 3);
});

test("ehVisitante: toda a equipe de produção é visitante (não entra no time)", () => {
  for (const role of Object.keys(PAPEIS_DE_PRODUCAO)) {
    assert.ok(ehProducao(role), role);
    assert.equal(PAPEIS_DO_TIME.includes(role), false, role);
    assert.equal(ehVisitante({ parentId: "s:x", role }), true, role);
  }
  assert.equal(Object.keys(PAPEIS_DE_PRODUCAO).length, 9);
  assert.equal(ehProducao("dev"), false);
  assert.equal(ehProducao("revisor"), false);
});
