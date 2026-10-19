// Frases simples do feed: nenhum jargão, comando ou caminho vaza. npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FeedItem } from "../shared/types.ts";
import { agruparFeed, fraseDaLinha } from "../web/src/feedLogic.ts";
import { comNome, comoAtividade, fraseAgrupada, fraseEvento, fraseFerramenta, nomeCurto, simplificarAtividade, type Evento } from "./frases.ts";
import { OfficeState } from "./state.ts";

/** o que não pode aparecer no modo simples */
const JARGAO =
  /\b(Read|Write|Edit|MultiEdit|NotebookEdit|Bash|Grep|Glob|WebSearch|WebFetch|TodoWrite|TaskCreate|TaskUpdate|SendMessage|Skill|Agent|mcp|npm|node|git|tsc|cjs|tsx?|jsx?|json|md)\b|[/\\]|\.\w{1,4}\b|__|\$|`/i;

const CASOS: [string, Record<string, unknown>][] = [
  ["Read", { file_path: "C:\\proj\\server\\state.ts" }],
  ["Write", { file_path: "/home/p/web/src/App.tsx", content: "x" }],
  ["Write", { file_path: "/home/p/README.md" }],
  ["Edit", { file_path: "server/state.ts" }],
  ["MultiEdit", { file_path: "server/state.ts" }],
  ["NotebookEdit", { notebook_path: "a/b.ipynb" }],
  ["Bash", { command: "node intr.cjs" }],
  ["Bash", { command: "npm test -- --grep foo", description: "Run tests" }],
  ["Bash", { command: "npx tsc --noEmit", description: "Typecheck" }],
  ["Bash", { command: "npm install express" }],
  ["Bash", { command: "git status && git diff server/state.ts" }],
  ["Bash", { command: "rm -rf /tmp/x; ls ~/.claude" }],
  ["Grep", { pattern: "pushFeed\\(", path: "server/" }],
  ["Glob", { pattern: "**/*.test.ts" }],
  ["WebSearch", { query: "upload 10MB" }],
  ["WebSearch", { query: "express.json() limit site:github.com" }],
  ["WebSearch", { query: "como fazer um bolo de cenoura fofinho com cobertura de chocolate" }],
  ["WebFetch", { url: "https://nodejs.org/api/fs.html" }],
  ["TodoWrite", { todos: [] }],
  ["TaskCreate", { subject: "Editar server/state.ts" }],
  ["TaskUpdate", { taskId: "1", status: "completed" }],
  ["SendMessage", { to: "dev", message: "rode npm test em server/" }],
  ["Skill", { skill: "frontend-design:frontend-design" }],
  ["Agent", { subagent_type: "dev", description: "Editar App.tsx" }],
  ["AskUserQuestion", { questions: [] }],
  ["mcp__github__create_pr", { title: "x" }],
  ["FerramentaNova", {}],
];

const EVENTOS: Evento[] = [
  { tipo: "chegou" },
  { tipo: "voltou" },
  { tipo: "resumiu" },
  { tipo: "conversaNova" },
  { tipo: "pedido" },
  { tipo: "chamado", deNovo: false },
  { tipo: "chamado", deNovo: true },
  { tipo: "pergunta" },
  { tipo: "autorizacao" },
  { tipo: "precisa" },
  { tipo: "aviso" },
  { tipo: "falhou" },
  { tipo: "terminouParte" },
  { tipo: "terminouVez" },
  { tipo: "etapa", etapa: 3, total: 7 },
  { tipo: "tudoConcluido", total: 7 },
  { tipo: "recado", para: "Caio" },
  { tipo: "recado" },
  { tipo: "saiu", motivo: "embora" },
  { tipo: "saiu", motivo: "entregou" },
  { tipo: "saiu", motivo: "semSinal" },
];

test("toda ferramenta vira frase sem nome de ferramenta, comando nem caminho", () => {
  for (const [tool, input] of CASOS) {
    for (const papel of ["dev", "testador", "lider"]) {
      const f = fraseFerramenta(tool, input, { papel });
      assert.ok(f.simples.length > 0, tool);
      assert.doesNotMatch(f.simples, JARGAO, `${tool} ${JSON.stringify(input)} → ${f.simples}`);
    }
  }
});

test("todo evento vira frase sem jargão", () => {
  for (const e of EVENTOS) {
    for (const genero of ["feminino", "masculino"] as const) {
      const f = fraseEvento(e, { genero });
      assert.ok(f.simples.length > 0, e.tipo);
      assert.doesNotMatch(f.simples, JARGAO, `${e.tipo} → ${f.simples}`);
    }
  }
});

test("exemplos do pedido", () => {
  const caio = { genero: "masculino" as const, papel: "dev" };
  assert.equal(comNome("Yasmin", fraseFerramenta("Bash", { command: "node intr.cjs" }, { papel: "testador" }).simples), "Yasmin está testando se tudo funciona");
  assert.equal(comNome("Caio", fraseFerramenta("Edit", { file_path: "server/state.ts" }, caio).simples), "Caio está fazendo mudanças no sistema");
  assert.equal(comNome("Lúcia", fraseFerramenta("WebSearch", { query: "upload 10MB" }).simples), "Lúcia está pesquisando na internet sobre “upload 10MB”");
  assert.equal(fraseFerramenta("WebSearch", { query: "express.json() limit" }).simples, "está pesquisando na internet");
  assert.equal(comNome("Marina", fraseFerramenta("Read", { file_path: "a.ts" }).simples), "Marina está estudando o projeto");
  assert.equal(comNome("Guto", fraseEvento({ tipo: "autorizacao" }).simples), "Guto precisa da sua autorização: volte ao terminal");
  assert.equal(comNome("Caio", fraseEvento({ tipo: "terminouParte" }, caio).simples), "Caio terminou a parte dele");
  assert.equal(fraseEvento({ tipo: "terminouParte" }, { genero: "feminino" }).simples, "terminou a parte dela");
});

test("testes são detectados pelo comando mesmo fora do testador", () => {
  for (const command of ["npm test", "npm run test", "npx vitest run", "tsx --test server/x.test.ts", "node a.test.mjs", "pytest -q"]) {
    assert.equal(fraseFerramenta("Bash", { command }, { papel: "dev" }).categoria, "teste", command);
  }
  assert.equal(fraseFerramenta("Bash", { command: "ls" }, { papel: "dev" }).categoria, "comando");
});

test("nome curto: apelido da plaquinha ou primeiro nome", () => {
  assert.equal(nomeCurto("Augusto Vilela", "GUTO"), "Guto");
  assert.equal(nomeCurto("Lúcia Ferraz", "LÚCIA"), "Lúcia");
  assert.equal(nomeCurto("Explorador"), "Explorador");
  assert.equal(nomeCurto("Marina Toledo"), "Marina");
});

const item = (id: number, agentId: string, tool: string, at = id * 1000): FeedItem => {
  const f = fraseFerramenta(tool, {});
  return { id, at, agentId, agentName: agentId, role: "dev", text: tool, kind: "tool", ...f, quem: agentId };
};

test("agrupamento: 12 leituras seguidas viram uma linha com contador", () => {
  const feed = Array.from({ length: 12 }, (_, i) => item(i + 1, "Marina", "Read"));
  const linhas = agruparFeed(feed);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].n, 12);
  assert.equal(linhas[0].item.id, 12, "fica com a mais recente");
  assert.equal(fraseDaLinha(linhas[0]), "está estudando o projeto (12 arquivos)");
  assert.equal(fraseAgrupada("x", 1, "arquivos"), "x");
});

test("agrupamento: outro AGzinho em paralelo não quebra; mudar de assunto quebra", () => {
  const feed = [item(1, "Marina", "Read"), item(2, "Caio", "Edit"), item(3, "Marina", "Read"), item(4, "Marina", "Grep"), item(5, "Marina", "Read")];
  const linhas = agruparFeed(feed);
  assert.deepEqual(
    linhas.map((l) => [l.item.agentId, l.item.categoria, l.n]),
    [
      ["Caio", "mudanca", 1],
      ["Marina", "estudo", 2],
      ["Marina", "busca", 1],
      ["Marina", "estudo", 1],
    ],
  );
});

test("agrupamento: destaques, feed antigo e linhas distantes no tempo não se juntam", () => {
  const precisa = (id: number): FeedItem => ({ id, at: id, agentId: "G", agentName: "G", role: "lider", text: "x", kind: "alert", ...fraseEvento({ tipo: "autorizacao" }) });
  assert.equal(agruparFeed([precisa(1), precisa(2)]).length, 2);
  const antigo = (id: number): FeedItem => ({ id, at: id, agentId: "G", agentName: "G", role: "lider", text: "Lendo a.ts", kind: "tool" });
  const velhos = agruparFeed([antigo(1), antigo(2)]);
  assert.equal(velhos.length, 2);
  assert.equal(fraseDaLinha(velhos[0]), null, "sem simples: o front mostra o técnico");
  assert.equal(agruparFeed([item(1, "M", "Read", 0), item(2, "M", "Read", 11 * 60_000)]).length, 2);
});

test("estado: o feed ganha a versão simples com o nome curto, e a etapa concluída vira destaque", () => {
  const s = new OfficeState({ now: () => 1_000, sweepEveryMs: 0 });
  const h = (hook_event_name: string, extra: Record<string, unknown> = {}) => s.handleHook({ hook_event_name, session_id: "sx", cwd: "/p/proj", ...extra });
  h("SessionStart", { source: "startup" });
  h("PermissionRequest", { tool_name: "Bash", tool_input: { command: "rm -rf build" } });
  const todos = (feitas: number) => ({
    tool_name: "TodoWrite",
    tool_input: { todos: [0, 1, 2].map((i) => ({ content: `T${i}`, activeForm: `T${i}`, status: i < feitas ? "completed" : i === feitas ? "in_progress" : "pending" })) },
  });
  h("PreToolUse", todos(0));
  h("PreToolUse", todos(1));
  h("PreToolUse", todos(3));
  const snap = s.snapshot();
  const feed = snap.type === "snapshot" ? snap.feed : [];
  const autorizacao = feed.find((f) => f.categoria === "precisa");
  assert.equal(autorizacao && comNome(autorizacao.quem ?? "", autorizacao.simples ?? ""), "Guto precisa da sua autorização: volte ao terminal");
  assert.match(autorizacao?.text ?? "", /rm -rf build/, "o técnico continua com o comando");
  assert.deepEqual(
    feed.filter((f) => f.categoria === "etapa" || f.categoria === "concluido").map((f) => f.simples),
    ["marcou a etapa 1 de 3 como concluída", "concluiu as 3 etapas: trabalho concluído"],
  );
  for (const f of feed) assert.doesNotMatch(f.simples ?? "", JARGAO, f.simples);
});

test("agrupado com temas diferentes perde o tema; Stop do líder não é 'concluído'", () => {
  const busca = (id: number, query: string): FeedItem => ({ id, at: id, agentId: "L", agentName: "L", role: "pesquisador", text: "x", kind: "tool", ...fraseFerramenta("WebSearch", { query }) });
  assert.equal(fraseDaLinha(agruparFeed([busca(1, "bolo de cenoura"), busca(2, "bolo de cenoura")])[0]), "está pesquisando na internet sobre “bolo de cenoura” (2 consultas)");
  assert.equal(fraseDaLinha(agruparFeed([busca(1, "bolo de cenoura"), busca(2, "pão de queijo")])[0]), "está pesquisando na internet (2 consultas)");
  for (const query of ["npm install express", "git commit", "playwright test", "Read file"]) {
    assert.equal(fraseFerramenta("WebSearch", { query }).simples, "está pesquisando na internet", query);
  }
  const stop = fraseEvento({ tipo: "terminouVez" }, { genero: "feminino" });
  assert.deepEqual(stop, { simples: "terminou a vez dela, esperando você", categoria: "info" });
});

test("atividade simples do balão, crachá e lista do time", () => {
  assert.equal(comoAtividade(fraseFerramenta("Edit", { file_path: "a.ts" }).simples), "Fazendo mudanças no sistema");
  assert.equal(simplificarAtividade("Editando state.ts", "trabalhando"), "Trabalhando numa tarefa");
  assert.equal(simplificarAtividade("Pedindo permissão: Rodando: npm test", "esperando"), "Precisa de você");
  assert.equal(simplificarAtividade("Implementar o formulário de chamados", "pensando"), "Implementar o formulário de chamados");
  const s = new OfficeState({ now: () => 1_000, sweepEveryMs: 0 });
  s.handleHook({ hook_event_name: "SessionStart", session_id: "sy", cwd: "/p/proj", source: "startup" });
  s.handleHook({ hook_event_name: "PreToolUse", session_id: "sy", cwd: "/p/proj", tool_name: "Bash", tool_input: { command: "git push" } });
  const snap = s.snapshot();
  const lider = snap.type === "snapshot" ? snap.agents[0] : undefined;
  assert.match(lider?.activity ?? "", /git push/);
  assert.equal(lider?.activitySimples, "Salvando uma versão do trabalho");
});

test("simplificarAtividade: rótulo por papel só quando trabalhando e simplificada; papel desconhecido fica genérico", () => {
  const rotulos: Record<string, string> = {
    planejador: "Planejando as etapas",
    dev: "Programando",
    testador: "Testando",
    revisor: "Revisando o trabalho",
    documentador: "Escrevendo a documentação",
    pesquisador: "Pesquisando",
  };
  for (const [papel, rotulo] of Object.entries(rotulos)) assert.equal(simplificarAtividade("Rodando: npm test", "trabalhando", papel), rotulo, papel);
  for (const papel of ["general-purpose", "lider", "convidado", "meu-agente-secreto", "__proto__", "constructor", ""]) {
    assert.equal(simplificarAtividade("Rodando: npm test", "trabalhando", papel), "Trabalhando numa tarefa", papel);
  }
  assert.equal(simplificarAtividade("Rodando: npm test", "trabalhando"), "Trabalhando numa tarefa");
  // outros status ignoram o papel; atividade já simples passa como está
  assert.equal(simplificarAtividade("Rodando: npm test", "pensando", "dev"), "Pensando");
  assert.equal(simplificarAtividade("Pedindo permissão: Rodando: npm test", "esperando", "dev"), "Precisa de você");
  assert.equal(simplificarAtividade("Implementar o formulário de chamados", "trabalhando", "dev"), "Implementar o formulário de chamados");
});
