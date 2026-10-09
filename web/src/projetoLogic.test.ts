// Testes do filtro por projeto (lógica pura): npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Agent, Progress } from "../../shared/types";
import { TODAS, esperandoDe, filtrarPorProjeto, progressoDoFiltro, projetoEfetivo, projetosDe, textoEspera } from "./projetoLogic";

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

describe("esperandoDe / textoEspera", () => {
  const e = (project: string, status: Agent["status"]) => ({ project, status });
  const todosAgentes = [e("loja", "esperando"), e("api", "esperando"), e("api", "trabalhando"), e("web", "esperando"), e("loja", "ocioso")];

  it("com 'todas' conta todo mundo e não fala de outro projeto", () => {
    const r = esperandoDe(todosAgentes, TODAS);
    assert.deepEqual(r, { total: 3, fora: 0, projetos: ["api", "loja", "web"], projetosFora: [] });
    assert.equal(textoEspera(r), "3 agentes te esperando");
  });

  it("com filtro, o pedido de outro projeto continua contando e diz onde está", () => {
    const r = esperandoDe(todosAgentes, "loja");
    assert.equal(r.total, 3);
    assert.equal(r.fora, 2);
    assert.deepEqual(r.projetosFora, ["api", "web"]);
    assert.equal(textoEspera(r), "3 agentes te esperando (2 em outros projetos: api, web)");
  });

  it("um só, no singular, só em outro projeto", () => {
    const r = esperandoDe([e("api", "esperando"), e("loja", "trabalhando")], "loja");
    assert.equal(textoEspera(r), "1 agente te esperando (1 em outro projeto: api)");
    assert.equal(r.total, 1);
  });

  it("ninguém esperando: total 0", () => {
    const r = esperandoDe([e("loja", "ocioso")], "loja");
    assert.equal(r.total, 0);
    assert.deepEqual(r.projetos, []);
  });
});