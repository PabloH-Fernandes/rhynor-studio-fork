// Simulação: dispara eventos falsos no mesmo formato dos hooks do Claude Code,
// pra você ver o escritório funcionando sem precisar abrir uma sessão real.
// Os timers ficam guardados para o "Limpar" (cancelDemo) parar tudo de verdade.

import type { HookInput, OfficeState } from "./state.ts";

type Step = [delayMs: number, input: Omit<HookInput, "session_id" | "cwd">];

const timers = new Set<NodeJS.Timeout>();
let activeSession: string | null = null;

/** Para a simulação em andamento (nenhum evento dela chega depois). Devolve a sessão dela, se havia. */
export function cancelDemo(): string | null {
  for (const t of timers) clearTimeout(t);
  timers.clear();
  const session = activeSession;
  activeSession = null;
  return session;
}

function schedule(ms: number, fn: () => void) {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
}

export function runDemo(state: OfficeState) {
  cancelDemo();
  const session_id = `demo-${Date.now().toString(36)}`;
  activeSession = session_id;
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
    tool_use_id: `${session_id}-spawn-${type}`,
  });
  const start = (a: [string, string]): Step[1] => ({ hook_event_name: "SubagentStart", agent_id: a[0], agent_type: a[1] });
  const stop = (a: [string, string]): Step[1] => ({ hook_event_name: "SubagentStop", agent_id: a[0], agent_type: a[1] });
  const msg = (from: [string, string], to: string, message: string): Step[1] =>
    tool("SendMessage", { to, message }, from);
  // lista de tarefas no formato real: TaskCreate (Pre + Post com tool_response.task.id) e TaskUpdate (Pre + Post)
  const taskCreate = (id: string, subject: string, activeForm: string, agent?: [string, string]): Step[] => {
    const pre = tool("TaskCreate", { subject, description: subject, activeForm }, agent);
    const post: Step[1] = { ...pre, hook_event_name: "PostToolUse", tool_response: { task: { id, subject } } };
    return [
      [250, pre],
      [50, post],
    ];
  };
  const taskUpdate = (id: string, status: string, delay = 200, agent?: [string, string]): Step[] => {
    const pre = tool("TaskUpdate", { taskId: id, status }, agent);
    const post: Step[1] = { ...pre, hook_event_name: "PostToolUse", tool_response: { success: true, taskId: id, updatedFields: ["status"] } };
    return [
      [delay, pre],
      [50, post],
    ];
  };

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
    // o planejador monta a lista (uma tarefa por etapa) e já começa a 1ª
    [2200, tool("Read", { file_path: "src/pages/Chamados.tsx" }, plan)],
    ...taskCreate("1", "Planejar a tela de chamados", "Planejando a tela de chamados", plan),
    ...taskCreate("2", "Implementar o formulário", "Construindo o formulário", plan),
    ...taskCreate("3", "Escrever os testes", "Escrevendo os testes", plan),
    ...taskCreate("4", "Revisar o código", "Revisando o código", plan),
    ...taskCreate("5", "Atualizar o README", "Atualizando o README", plan),
    ...taskUpdate("1", "in_progress", 200, plan),
    [1800, tool("WebFetch", { url: "https://zod.dev/" }, pesq)],
    [2200, msg(plan, "dev", "Plano pronto: 5 tarefas, começa pelo formulário")],
    ...taskUpdate("1", "completed", 600),
    [600, stop(plan)],
    [800, msg(pesq, "dev", "Use zodResolver no useForm, schema em arquivo separado")],
    [1000, stop(pesq)],
    ...taskUpdate("2", "in_progress", 300),
    [300, spawn("dev", "Implementar o formulário de chamados")],
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
    ...taskUpdate("2", "completed", 400),
    ...taskUpdate("3", "in_progress", 200),
    [2400, msg(test, "dev", "Tudo verde ✅")],
    [800, stop(dev)],
    [400, stop(test)],
    ...taskUpdate("3", "completed", 300),
    ...taskUpdate("4", "in_progress", 200),
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
    ...taskUpdate("4", "completed", 200),
    ...taskUpdate("5", "in_progress", 200),
    [1300, stop(doc)],
    ...taskUpdate("5", "completed", 200),
    [1500, tool("Bash", { command: "git status", description: "Conferindo as mudanças" })],
    [2000, done()],
    [1500, { hook_event_name: "Stop" }],
  ];

  let at = 0;
  for (const [delay, input] of steps) {
    at += delay;
    schedule(at, () => state.handleHook({ ...input, session_id, cwd } as HookInput));
  }
  // encerra a sessão de demo um tempo depois (até lá o time fica de boa no escritório)
  schedule(at + 20_000, () => {
    activeSession = null;
    state.handleHook({ hook_event_name: "SessionEnd", session_id, cwd });
  });
  return { session_id, durationMs: at };
}
