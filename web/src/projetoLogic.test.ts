// Testes do filtro por projeto (lógica pura): npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Progress } from "../../shared/types";
import { TODAS, filtrarPorProjeto, progressoDoFiltro, projetoEfetivo, projetosDe } from "./projetoLogic";

const ag = (id: string, project: string, sessionId = id) => ({ id, project, sessionId });
const todos = [ag("a", "loja"), ag("b", "api"), ag("c", "loja", "a"), ag("d", "")];

describe("projetosDe", () => {
  it("lista os projetos sem repetir, em ordem, ignorando vazio", () => {
    assert.deepEqual(projetosDe(todos), ["api", "loja"]);
    assert.deepEqual(projetosDe([]), []);
  });
});

describe("projetoEfetivo", () => {
  it("usa o salvo se existir; senão mostra todas", () => {
    assert.equal(projetoEfetivo("loja", ["api", "loja"]), "loja");
    assert.equal(projetoEfetivo("sumiu", ["api", "loja"]), TODAS);
    assert.equal(projetoEfetivo(TODAS, ["api"]), TODAS);
    assert.equal(projetoEfetivo("loja", []), TODAS);
  });
});

describe("filtrarPorProjeto", () => {
  it("todas devolve a mesma lista; projeto filtra (subagente herda o projeto)", () => {
    assert.equal(filtrarPorProjeto(todos, TODAS), todos);
    assert.deepEqual(filtrarPorProjeto(todos, "loja").map((a) => a.id), ["a", "c"]);
    assert.deepEqual(filtrarPorProjeto(todos, "nada"), []);
  });
});

describe("progressoDoFiltro", () => {
  const p: Progress = { fonte: "tarefas", etapa: 2, total: 4, concluidas: 1, titulo: "x", sessionId: "b" };
  it("sem filtro, passa direto", () => {
    assert.equal(progressoDoFiltro(p, todos, TODAS), p);
    assert.equal(progressoDoFiltro(null, todos, "loja"), null);
  });
  it("com filtro, só mostra se a sessão está no projeto", () => {
    assert.equal(progressoDoFiltro(p, filtrarPorProjeto(todos, "api"), "api"), p);
    const vazio = progressoDoFiltro(p, filtrarPorProjeto(todos, "loja"), "loja");
    assert.equal(vazio?.fonte, "nada");
  });
  it("progresso sem sessão, num filtro, não aparece", () => {
    const sem: Progress = { ...p, sessionId: undefined };
    assert.equal(progressoDoFiltro(sem, todos, "loja")?.fonte, "nada");
  });
});
