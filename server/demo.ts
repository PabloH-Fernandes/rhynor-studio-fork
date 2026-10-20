// Simulação: dispara eventos falsos no mesmo formato dos hooks do Claude Code,
// pra você ver o escritório funcionando sem precisar abrir uma sessão real.
// Os timers ficam guardados para o "Limpar" (cancelDemo) parar tudo de verdade.
//
// Roteiro (~2 min 46 s), em segundos desde o "Rodar simulação":
//   0–12    o líder recebe o pedido e chama pesquisador e planejador em paralelo (quadro: Ação → Planejamento);
//           a Marina (planejadora) lê 5 arquivos seguidos, que viram 1 linha no feed ("está estudando o
//           projeto (5 arquivos)"), e o pesquisador pesquisa na internet um tema curto ("validação de formulários")
//   13–15   o líder monta a lista de 6 tarefas (quadro: Etapa 1 de 6)
//   27      planejador e pesquisador entregam juntos: comemoram e FICAM; ~20 s depois vão descansar
//   29–66   dev (Bia) e um 2º dev (Yasmin, dev-2) em paralelo, o testador, envelopes e o "!" de permissão (46 → 52)
//   46      🙋 o testador pede autorização (PermissionRequest); você libera em 52
//   69      dev-2, testador e dev entregam no mesmo instante: 5 AGzinhos de boa ao mesmo tempo por ~30 s
//           (o agendador do front espera IDLE_GRACE de 4 s e só chama pra ping-pong/papo quem já passou
//           dele: entregar junto é o que dá chance de grupo; com 68/68,5/69 s quase sempre saía tudo solo)
//   76      a conversa do líder é resumida (SessionStart "compact"): ninguém sai, o time continua
//   99      o líder retoma o pesquisador (SendMessage pro agent_id dele) no meio do descanso: larga tudo,
//           volta pra mesma mesa e entrega (2 entregas, mesmo agent_id)
//   117–145 revisor e depois documentador; o quadro chega a "concluíram 6 de 6"
//           (no feed: ✅ a cada SubagentStop, 🏁 a cada etapa concluída e 🎉 quando a lista fecha)
//   151     Stop do líder ("Terminou, esperando você"); ele também descansa um pouco
//   166     SessionEnd: todo mundo vai até a porta

import type { HookInput, OfficeState, Relogio, Timer } from "./state.ts";

type Input = Omit<HookInput, "session_id" | "cwd">;
/** [quando, em segundos desde o início; evento] */
type Step = [atSec: number, input: Input];
type Who = [agentId: string, agentType: string];

/** depois do Stop do líder, o time fica de boa no escritório por esse tempo antes do SessionEnd */
export const DEMO_END_AFTER_STOP_MS = 15_000;

/** só os timers: o servidor usa os globais; o teste pode usar o RelogioVirtual do replay */
type Agenda = Pick<Relogio, "setTimeout" | "clearTimeout">;

/** os globais, resolvidos na hora da chamada (os testes trocam o setTimeout pelo mock do node:test) */
const AGENDA_PADRAO: Agenda = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
};

const timers = new Set<Timer>();
let agenda: Agenda = AGENDA_PADRAO;
let activeSession: string | null = null;
/** a última simulação iniciada por pedido (POST /api/demo): serve para ignorar o pedido repetido */
let ultimoInicio: { em: number; info: ResultadoDemo } | null = null;

/** pedido repetido dentro dessa janela devolve a mesma simulação, sem reiniciar */
export const DEMO_JANELA_REPETIDO_MS = 5_000;

type ResultadoDemo = { session_id: string; durationMs: number };

/** Para a simulação em andamento (nenhum evento dela chega depois). Devolve a sessão dela, se havia. */
export function cancelDemo(): string | null {
  for (const t of timers) agenda.clearTimeout(t);
  timers.clear();
  const session = activeSession;
  activeSession = null;
  ultimoInicio = null;
  agenda = AGENDA_PADRAO;
  return session;
}

function schedule(ms: number, fn: () => void) {
  const t = agenda.setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
}

/**
 * O que o POST /api/demo faz: se uma simulação começou há menos de DEMO_JANELA_REPETIDO_MS, devolve a mesma
 * resposta sem reiniciar (pedido duplicado por recarga, duas abas ou clique duplo); senão para a anterior (e tira a
 * sessão dela do escritório) e começa uma nova. `repetido` diz qual dos dois aconteceu.
 */
export function iniciarDemo(
  state: OfficeState,
  agora: () => number = Date.now,
  relogio: Agenda = AGENDA_PADRAO,
): { info: ResultadoDemo; repetido: boolean } {
  const t = agora();
  if (ultimoInicio && activeSession === ultimoInicio.info.session_id && t >= ultimoInicio.em && t - ultimoInicio.em < DEMO_JANELA_REPETIDO_MS) {
    return { info: ultimoInicio.info, repetido: true };
  }
  const anterior = cancelDemo();
  if (anterior) state.endSession(anterior, "Saiu (simulação reiniciada)");
  const info = runDemo(state, relogio);
  ultimoInicio = { em: t, info };
  return { info, repetido: false };
}

export function runDemo(state: OfficeState, relogio: Agenda = AGENDA_PADRAO) {
  cancelDemo();
  agenda = relogio;
  const session_id = `demo-${Date.now().toString(36)}`;
  activeSession = session_id;
  const cwd = "/home/usuario/projetos/portal-chamados";
  let tid = 0;
  const tool = (name: string, input: Record<string, any>, agent?: Who): Input => ({
    hook_event_name: "PreToolUse",
    tool_name: name,
    tool_input: input,
    tool_use_id: `demo-tool-${++tid}`,
    ...(agent ? { agent_id: agent[0], agent_type: agent[1] } : {}),
  });
  const done = (agent?: Who): Input => ({
    hook_event_name: "PostToolUse",
    tool_name: "Read",
    ...(agent ? { agent_id: agent[0], agent_type: agent[1] } : {}),
  });
  // cada chamada da ferramenta Agent tem o próprio tool_use_id (2 devs em paralelo)
  const spawn = (type: string, description: string): Input => ({
    hook_event_name: "PreToolUse",
    tool_name: "Agent",
    tool_input: { subagent_type: type, description },
    tool_use_id: `${session_id}-spawn-${++tid}`,
  });
  const start = (a: Who): Input => ({ hook_event_name: "SubagentStart", agent_id: a[0], agent_type: a[1] });
  const stop = (a: Who): Input => ({ hook_event_name: "SubagentStop", agent_id: a[0], agent_type: a[1] });
  const msg = (from: Who, to: string, message: string): Input => tool("SendMessage", { to, message }, from);
  const permission = (a: Who, command: string, description: string): Input => ({
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: { command, description },
    agent_id: a[0],
    agent_type: a[1],
  });
  // lista de tarefas no formato real: TaskCreate (Pre + Post com tool_response.task.id) e TaskUpdate (Pre + Post)
  const taskCreate = (at: number, id: string, subject: string, activeForm: string): Step[] => {
    const pre = tool("TaskCreate", { subject, description: subject, activeForm });
    const post: Input = { ...pre, hook_event_name: "PostToolUse", tool_response: { task: { id, subject } } };
    return [
      [at, pre],
      [at + 0.05, post],
    ];
  };
  const taskUpdate = (at: number, id: string, status: string): Step[] => {
    const pre = tool("TaskUpdate", { taskId: id, status });
    const post: Input = { ...pre, hook_event_name: "PostToolUse", tool_response: { success: true, taskId: id, updatedFields: ["status"] } };
    return [
      [at, pre],
      [at + 0.05, post],
    ];
  };

  const plan: Who = [`${session_id}-plan`, "planejador"];
  const pesq: Who = [`${session_id}-pesq`, "pesquisador"];
  const dev: Who = [`${session_id}-dev`, "dev"];
  const dev2: Who = [`${session_id}-dev2`, "dev"]; // com a Bia ocupada, vira a Yasmin (dev-2)
  const test: Who = [`${session_id}-test`, "testador"];
  const rev: Who = [`${session_id}-rev`, "revisor"];
  const doc: Who = [`${session_id}-doc`, "documentador"];

  const steps: Step[] = [
    // a) pedido, pesquisador e planejador em paralelo, lista de tarefas
    [0, { hook_event_name: "SessionStart", source: "startup" }],
    [1.5, { hook_event_name: "UserPromptSubmit", user_prompt: "Cria a tela de abertura de chamados com anexos, validação e testes" }],
    [3, tool("Glob", { pattern: "src/**/*.tsx" })],
    [4.5, tool("Read", { file_path: "src/pages/Chamados.tsx" })],
    [6, spawn("pesquisador", "Ver boas práticas de validação com zod")],
    [6.3, start(pesq)],
    [6.9, spawn("planejador", "Quebrar a feature em tarefas")],
    [7.2, start(plan)],
    // a Marina lê 5 arquivos seguidos: no feed vira "Marina está estudando o projeto (5 arquivos)"
    [8, tool("Read", { file_path: "docs/requisitos.md" }, plan)],
    [9, tool("Read", { file_path: "src/pages/Chamados.tsx" }, plan)],
    // tema curto e sem nada técnico: "está pesquisando na internet sobre “validação de formulários”"
    [10, tool("WebSearch", { query: "validação de formulários" }, pesq)],
    [10.5, tool("Read", { file_path: "src/api/chamados.ts" }, plan)],
    [11.3, tool("Read", { file_path: "src/components/Formulario.tsx" }, plan)],
    // o planejador é o último do time a mexer: o quadro (sem lista ainda) mostra "Planejamento"
    [12, tool("Read", { file_path: "src/types/chamado.ts" }, plan)],
    ...taskCreate(13, "1", "Planejar a tela de chamados", "Planejando a tela de chamados"),
    ...taskCreate(13.4, "2", "Implementar o formulário", "Construindo o formulário"),
    ...taskCreate(13.8, "3", "Escrever os testes", "Escrevendo os testes"),
    ...taskCreate(14.2, "4", "Pesquisar o upload de anexos", "Pesquisando o upload de anexos"),
    ...taskCreate(14.6, "5", "Revisar o código", "Revisando o código"),
    ...taskCreate(15, "6", "Atualizar o README", "Atualizando o README"),
    ...taskUpdate(15.4, "1", "in_progress"),
    [17, tool("WebFetch", { url: "https://zod.dev/" }, pesq)],
    [19, tool("Write", { file_path: "docs/plano.md" }, plan)],
    [22, msg(pesq, "planejador", "zodResolver no useForm, schema em arquivo separado")],
    [24.5, msg(plan, "lider", "Plano pronto: 6 tarefas, começa pelo formulário")],
    // b) os dois entregam no mesmo instante: comemoram e ficam (o descanso começa ~20 s depois)
    [27, stop(plan)],
    [27, stop(pesq)],
    ...taskUpdate(28, "1", "completed"),
    ...taskUpdate(28.3, "2", "in_progress"),
    // c) dois devs em paralelo, testador, "!" de permissão e envelopes
    [29, spawn("dev", "Implementar o formulário de chamados")],
    [29.3, start(dev)],
    [29.6, spawn("dev", "Implementar a validação do formulário")],
    [29.9, start(dev2)],
    [30.5, spawn("testador", "Escrever testes do formulário")],
    [30.8, start(test)],
    [34, tool("Write", { file_path: "src/pages/NovoChamado.tsx" }, dev)],
    [35.5, tool("Write", { file_path: "src/schemas/chamado.ts" }, dev2)],
    [37, tool("Read", { file_path: "src/pages/NovoChamado.tsx" }, test)],
    [39, tool("Edit", { file_path: "src/pages/NovoChamado.tsx" }, dev)],
    [40.5, tool("Edit", { file_path: "src/schemas/chamado.ts" }, dev2)],
    [42, tool("Write", { file_path: "tests/chamados.spec.ts" }, test)],
    [43.5, msg(dev2, "dev", "Schema pronto, é só ligar o zodResolver")],
    [45, tool("Bash", { command: "npm run lint", description: "Rodando o lint" }, dev)],
    [46, permission(test, "npx playwright test", "Rodando os testes E2E")],
    // você liberou: o testador volta a trabalhar
    [52, tool("Bash", { command: "npx playwright test", description: "Rodando os testes E2E" }, test)],
    [55, msg(test, "dev", "2 testes falharam: campo prioridade aceita vazio")],
    [57, tool("Edit", { file_path: "src/schemas/chamado.ts" }, dev2)],
    [59, msg(dev2, "testador", "Corrigido, pode rodar de novo")],
    [60.5, tool("Edit", { file_path: "src/pages/NovoChamado.tsx" }, dev)],
    [62, tool("Bash", { command: "npx playwright test", description: "Rodando os testes de novo" }, test)],
    [66, msg(test, "dev", "Tudo verde ✅")],
    // d) os três entregam no mesmo instante: com o planejador e o pesquisador, 5 de boa ao mesmo tempo
    [69, stop(dev2)],
    [69, stop(test)],
    [69, stop(dev)],
    ...taskUpdate(70, "2", "completed"),
    ...taskUpdate(70.3, "3", "completed"),
    ...taskUpdate(70.6, "4", "in_progress"),
    [73, tool("Read", { file_path: "src/api/anexos.ts" })],
    // a conversa do líder fica grande e é resumida no meio do trabalho: o time todo continua
    [76, { hook_event_name: "SessionStart", source: "compact" }],
    [80, tool("Grep", { pattern: "multipart" })],
    [88, tool("Read", { file_path: "server/routes/chamados.ts" })],
    // e) ~20 s depois dos grupos formados, o líder retoma o pesquisador (SendMessage pro agent_id
    // dele) no meio do descanso: mesmo agent_id, mesmo AGzinho, larga tudo e volta pra mesa
    [98.7, tool("SendMessage", { to: pesq[0], message: "Ver limite de tamanho do upload de anexos" })],
    [99, tool("WebSearch", { query: "limite de tamanho de anexos" }, pesq)],
    [106, tool("WebFetch", { url: "https://github.com/expressjs/multer" }, pesq)],
    [109, tool("Read", { file_path: "server/routes/anexos.ts" }, pesq)],
    [112.5, msg(pesq, "lider", "Limite de 10 MB com multer, valide o tipo no front")],
    [115, stop(pesq)],
    ...taskUpdate(116, "4", "completed"),
    ...taskUpdate(116.3, "5", "in_progress"),
    // f) revisor e depois documentador; o quadro chega a "concluíram 6 de 6"
    [117, spawn("revisor", "Revisar o código da feature")],
    [117.3, start(rev)],
    [121, tool("Grep", { pattern: "any" }, rev)],
    [124.5, tool("Read", { file_path: "src/pages/NovoChamado.tsx" }, rev)],
    [128, msg(rev, "lider", "Aprovado, só 1 sugestão de nome de variável")],
    [130, stop(rev)],
    ...taskUpdate(130.5, "5", "completed"),
    ...taskUpdate(130.8, "6", "in_progress"),
    [131.5, spawn("documentador", "Atualizar o README")],
    [131.8, start(doc)],
    [137, tool("Read", { file_path: "README.md" }, doc)],
    [141, tool("Edit", { file_path: "README.md" }, doc)],
    [145, stop(doc)],
    ...taskUpdate(145.5, "6", "completed"),
    // g) o líder confere e termina a vez dele
    [147, tool("Bash", { command: "git status", description: "Conferindo as mudanças" })],
    [149, done()],
    [151, { hook_event_name: "Stop" }],
  ];

  let at = 0;
  for (const [sec, input] of steps) {
    at = Math.round(sec * 1000);
    schedule(at, () => state.handleHook({ ...input, session_id, cwd } as HookInput));
  }
  // h) encerra a sessão de demo um tempo depois (até lá o time todo fica de boa no escritório)
  schedule(at + DEMO_END_AFTER_STOP_MS, () => {
    activeSession = null;
    state.handleHook({ hook_event_name: "SessionEnd", session_id, cwd });
  });
  return { session_id, durationMs: at + DEMO_END_AFTER_STOP_MS };
}
