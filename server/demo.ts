// Simulação: dispara eventos falsos no mesmo formato dos hooks do Claude Code,
// pra você ver o escritório funcionando sem precisar abrir uma sessão real.

import type { HookInput, OfficeState } from "./state.ts";

type Step = [delayMs: number, input: Omit<HookInput, "session_id" | "cwd">];

export function runDemo(state: OfficeState) {
  const session_id = `demo-${Date.now().toString(36)}`;
  const cwd = "/home/pablo/projetos/portal-chamados";
  let tid = 0;
  const tool = (name: string, input: Record<string, any>, agent?: [string, string]): Step[1] => ({
    hook_event_name: "PreToolUse",
    tool_name: name,
    tool_input: input,
    tool_use_id: `demo-tool-${++tid}`,
    ...(agent ? { agent_id: agent[0], agent_type: agent[1] } : {}),
  });
  const done = (agent?: [string, string]): Step[1] => ({
    hook_event_name: "PostToolUse",
    tool_name: "Read",
    ...(agent ? { agent_id: agent[0], agent_type: agent[1] } : {}),
  });
  const spawn = (type: string, description: string): Step[1] => ({
    hook_event_name: "PreToolUse",
    tool_name: "Agent",
    tool_input: { subagent_type: type, description },
    tool_use_id: `demo-spawn-${type}`,
  });
  const start = (a: [string, string]): Step[1] => ({ hook_event_name: "SubagentStart", agent_id: a[0], agent_type: a[1] });
  const stop = (a: [string, string]): Step[1] => ({ hook_event_name: "SubagentStop", agent_id: a[0], agent_type: a[1] });
  const msg = (from: [string, string], to: string, message: string): Step[1] =>
    tool("SendMessage", { to, message }, from);

  const plan: [string, string] = [`${session_id}-plan`, "planejador"];
  const pesq: [string, string] = [`${session_id}-pesq`, "pesquisador"];
  const dev: [string, string] = [`${session_id}-dev`, "dev"];
  const test: [string, string] = [`${session_id}-test`, "testador"];
  const rev: [string, string] = [`${session_id}-rev`, "revisor"];
  const doc: [string, string] = [`${session_id}-doc`, "documentador"];

  const steps: Step[] = [
    [0, { hook_event_name: "SessionStart", source: "startup" }],
    [1500, { hook_event_name: "UserPromptSubmit", user_prompt: "Cria a tela de abertura de chamados com validação e testes" }],
    [2000, tool("Glob", { pattern: "src/**/*.tsx" })],
    [1500, tool("Read", { file_path: "src/pages/Chamados.tsx" })],
    [1500, spawn("planejador", "Quebrar a feature em tarefas")],
    [300, start(plan)],
    [600, spawn("pesquisador", "Ver boas práticas de validação com zod")],
    [300, start(pesq)],
    [2500, tool("Read", { file_path: "docs/requisitos.md" }, plan)],
    [800, tool("WebSearch", { query: "react hook form zod validação" }, pesq)],
    [2500, tool("TaskCreate", {}, plan)],
    [1800, tool("WebFetch", { url: "https://zod.dev/" }, pesq)],
    [2200, msg(plan, "dev", "Plano pronto: 4 tarefas, começa pelo formulário")],
    [1200, stop(plan)],
    [800, msg(pesq, "dev", "Use zodResolver no useForm, schema em arquivo separado")],
    [1000, stop(pesq)],
    [600, spawn("dev", "Implementar o formulário de chamados")],
    [300, start(dev)],
    [500, spawn("testador", "Escrever testes do formulário")],
    [300, start(test)],
    [2000, tool("Write", { file_path: "src/schemas/chamado.ts" }, dev)],
    [1200, tool("Read", { file_path: "src/pages/Chamados.tsx" }, test)],
    [2400, tool("Edit", { file_path: "src/pages/Chamados.tsx" }, dev)],
    [1500, tool("Write", { file_path: "tests/chamados.spec.ts" }, test)],
    [2500, tool("Bash", { command: "npm run lint", description: "Rodando o lint" }, dev)],
    [1500, { hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npx playwright test", description: "Rodando os testes E2E" }, agent_id: test[0], agent_type: test[1] }],
    [3500, tool("Bash", { command: "npx playwright test", description: "Rodando os testes E2E" }, test)],
    [3000, msg(test, "dev", "2 testes falharam: campo prioridade aceita vazio")],
    [1800, tool("Edit", { file_path: "src/schemas/chamado.ts" }, dev)],
    [2200, msg(dev, "testador", "Corrigido, pode rodar de novo")],
    [1500, tool("Bash", { command: "npx playwright test", description: "Rodando os testes de novo" }, test)],
    [3000, msg(test, "dev", "Tudo verde ✅")],
    [800, stop(dev)],
    [400, stop(test)],
    [800, spawn("revisor", "Revisar o código da feature")],
    [300, start(rev)],
    [600, spawn("documentador", "Atualizar o README")],
    [300, start(doc)],
    [1800, tool("Grep", { pattern: "any" }, rev)],
    [1200, tool("Read", { file_path: "README.md" }, doc)],
    [2200, tool("Read", { file_path: "src/pages/Chamados.tsx" }, rev)],
    [1800, tool("Edit", { file_path: "README.md" }, doc)],
    [2500, msg(rev, "lider", "Aprovado, só 1 sugestão de nome de variável")],
    [800, stop(rev)],
    [1500, stop(doc)],
    [1500, tool("Bash", { command: "git status", description: "Conferindo as mudanças" })],
    [2000, done()],
    [1500, { hook_event_name: "Stop" }],
  ];

  let at = 0;
  for (const [delay, input] of steps) {
    at += delay;
    setTimeout(() => state.handleHook({ ...input, session_id, cwd } as HookInput), at);
  }
  // encerra a sessão de demo um tempo depois
  setTimeout(() => state.handleHook({ hook_event_name: "SessionEnd", session_id, cwd }), at + 20_000);
  return { session_id, durationMs: at };
}
