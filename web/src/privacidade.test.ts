import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent, CaixaItem, FeedItem, MissoesInfo, Pendencia, Progress } from "../../shared/types";
import { lerFlags } from "./apresentacao";
import { criarPrivacidade, mascararAgentes, mascararCaixa, mascararFeed, mascararMissoes, mascararPendencias, mascararProgress, mascararTudo } from "./privacidade";

test("flags: apresentacao e demo", () => {
  assert.deepEqual(lerFlags(""), { apresentacao: false, demo: false });
  assert.deepEqual(lerFlags("?apresentacao=1"), { apresentacao: true, demo: false });
  assert.deepEqual(lerFlags("?apresentacao=1&demo=1"), { apresentacao: true, demo: true });
  assert.deepEqual(lerFlags("?demo=1"), { apresentacao: false, demo: false });
  assert.deepEqual(lerFlags("?apresentacao=0&demo=1"), { apresentacao: false, demo: false });
  assert.deepEqual(lerFlags("?apresentacao=true"), { apresentacao: false, demo: false });
  assert.deepEqual(lerFlags("?galeria=1&apresentacao=1"), { apresentacao: true, demo: false });
});

const CWD_X = "C:\\Users\\fulano\\clienteX";
const CWD_Y = "C:\\Users\\fulano\\clienteY";

test("apelidos são estáveis e distintos", () => {
  const p = criarPrivacidade();
  const a = p.projeto(CWD_X);
  const b = p.projeto(CWD_Y);
  assert.notEqual(a, b);
  assert.equal(p.projeto(CWD_X), a);
  assert.equal(p.projeto("clienteX"), a, "só o nome da pasta dá o mesmo apelido");
  assert.equal(p.projeto("CLIENTEX"), a);
  assert.equal(p.projeto("/home/fulano/clienteX"), a, "caminho no estilo Linux também");
  assert.match(a, /^Projeto /);
  // outra instância repete a mesma ordem
  assert.equal(criarPrivacidade().projeto("clienteX"), a);
  assert.equal(p.responsavel("Maria Souza"), p.responsavel("maria souza"));
  assert.match(p.responsavel("Maria Souza"), /^Responsável /);
  assert.notEqual(p.responsavel("João Pereira"), p.responsavel("Maria Souza"));
  assert.equal(p.responsavel(""), "");
  assert.equal(p.responsavel("Responsável C"), "Responsável C", "o apelido do servidor não é trocado de novo");
});

test("muitos projetos não repetem apelido", () => {
  const p = criarPrivacidade();
  const vistos = new Set<string>();
  for (let i = 0; i < 40; i++) vistos.add(p.projeto(`proj${i}`));
  assert.equal(vistos.size, 40);
});

const AGORA = 1_700_000_000_000;
const agente = (id: string, over: Partial<Agent> = {}): Agent => ({
  id,
  sessionId: "s1",
  role: "dev",
  name: "Beatriz Lima",
  status: "trabalhando",
  activity: "Editando contratos-acme.docx",
  activitySimples: "Fazendo mudanças no sistema",
  project: CWD_X,
  startedAt: AGORA,
  updatedAt: AGORA,
  boundAt: AGORA,
  tasksDone: 0,
  tasksDay: "2026-10-19",
  ...over,
});

const ORIGINAIS = [
  "fulano",
  "clienteX",
  "contratos-acme",
  "acme",
  "folha-pagamento",
  "Maria Souza",
  "Proposta Banco Aurora",
  "orcamento-2026",
  "segredo.example.com",
  "lancamento-secreto",
  "Joana Prado",
  "Plano Secreto",
];

function semOriginais(valor: unknown) {
  const texto = JSON.stringify(valor).toLowerCase();
  for (const o of ORIGINAIS) assert.ok(!texto.includes(o.toLowerCase()), `sobrou "${o}" em ${texto}`);
}

test("agentes, feed, caixa, pendências, missões e quadro: nenhuma substring original sobra", () => {
  const p = criarPrivacidade();
  const agentes: Agent[] = [
    agente("a", { activity: "Editando C:\\Users\\fulano\\clienteX\\docs\\contratos-acme.docx" }),
    agente("b", { activity: "Lendo folha-pagamento.xlsx", activitySimples: "Estudando os arquivos do projeto" }),
    agente("c", { activity: "Rodando: git commit -m 'Proposta Banco Aurora para acme'" }),
    agente("d", { activity: "Pesquisando: lancamento-secreto da acme" }),
    agente("e", { activity: "Lendo segredo.example.com" }),
    agente("f", { activity: "Procurando “orcamento-2026”" }),
    agente("g", { activity: "Usando a skill clienteX" }),
    agente("h", { activity: "Lendo /home/fulano/clienteX/src/app.ts", activitySimples: "Olhando clienteX" }),
  ];
  const ags = mascararAgentes(p, agentes);
  semOriginais(ags);
  assert.equal(ags[0].name, "Beatriz Lima", "o nome do AGzinho é do elenco: não muda");
  assert.equal(ags[0].activitySimples, "Fazendo mudanças no sistema");
  assert.equal(ags[0].project, ags[1].project, "mesmo projeto, mesmo apelido");
  assert.ok(ags[0].activity.startsWith("Editando "));

  const feed: FeedItem[] = [
    { id: 1, at: AGORA, agentId: "a", agentName: "Beatriz Lima", role: "dev", text: "Editando orcamento-2026.xlsx em C:/Users/fulano/clienteX", kind: "tool", simples: "está mexendo em contratos-acme.docx" },
    { id: 2, at: AGORA, agentId: "a", agentName: "Beatriz Lima", role: "dev", text: "Rodando: cd clienteX && npm test", kind: "tool" },
  ];
  semOriginais(mascararFeed(p, feed));

  const caixa: CaixaItem[] = [
    {
      id: "2026-10-19-proposta-banco-aurora",
      titulo: "Proposta Banco Aurora",
      data: "2026-10-19",
      tarefas: [
        { n: 1, texto: "Mandar orcamento-2026 para a acme", responsavel: "Maria Souza", prazo: "2026-10-30", h: "abc" },
        { n: 2, texto: "Revisar a folha-pagamento do clienteX", responsavel: "", prazo: "" },
      ],
    },
  ];
  const cx = mascararCaixa(p, caixa);
  // id, número e hash seguem iguais: o que volta ao servidor não muda
  assert.equal(cx[0].id, caixa[0].id);
  assert.equal(cx[0].tarefas[0].h, "abc");
  assert.equal(cx[0].tarefas[0].n, 1);
  semOriginais({ ...cx[0], id: "" });

  const pend: Pendencia[] = [
    {
      id: "r:nota:1:abc",
      h: "abc",
      texto: "Ligar para Joana Prado sobre o lancamento-secreto",
      responsavel: "Maria Souza",
      prazo: "2026-10-30",
      origem: "Proposta Banco Aurora",
      dono: "eu",
      status: "a fazer",
      urgencia: "no-prazo",
    },
  ];
  const pd = mascararPendencias(p, pend);
  assert.equal(pd[0].id, pend[0].id);
  assert.equal(pd[0].h, "abc");
  semOriginais({ ...pd[0], id: "" });
  // a mesma reunião tem o mesmo apelido na caixa e nas pendências
  assert.equal(cx[0].titulo, pd[0].origem);
  assert.equal(cx[0].tarefas[0].responsavel, pd[0].responsavel);

  const info: MissoesInfo = {
    vault: "ok",
    missoes: [
      {
        id: "2026-10-19-plano-secreto",
        nome: "Plano Secreto",
        status: "em andamento",
        origem: "reuniao",
        projeto: "clienteX",
        reuniaoTitulo: "Proposta Banco Aurora",
        classe: "time",
        data: "2026-10-19",
        tarefas: { feitas: 0, total: 1 },
        itens: [{ texto: "Mandar orcamento-2026 para a acme", feita: false }],
        objetivo: "Fechar com a acme",
        atualizadoEm: AGORA,
      },
    ],
    inbox: { novas: 0 },
    atual: { id: "2026-10-19-plano-secreto", nome: "Plano Secreto", reuniaoTitulo: "Proposta Banco Aurora" },
  };
  const ms = mascararMissoes(p, info);
  semOriginais(ms);
  assert.equal(ms?.atual?.nome, ms?.missoes[0].nome);
  assert.equal(mascararMissoes(p, null), null);

  const prog: Progress = { fonte: "tarefas", etapa: 2, total: 5, concluidas: 1, titulo: "Fechar proposta do Banco Aurora para acme" };
  const pg = mascararProgress(prog);
  semOriginais(pg);
  assert.equal(pg?.etapa, 2);
  assert.equal(pg?.total, 5);
  assert.equal(mascararProgress(null), null);
  assert.equal(mascararProgress({ fonte: "papel", etapa: 0, total: 0, concluidas: 0, titulo: "Testes" })?.titulo, "Testes");
});

test("texto sem nada sensível passa igual", () => {
  const p = criarPrivacidade();
  assert.equal(p.texto("Esperando seu próximo pedido"), "Esperando seu próximo pedido");
  assert.equal(p.texto("De boa"), "De boa");
  assert.equal(p.texto("Organizando as tarefas"), "Organizando as tarefas");
  assert.equal(p.texto("Versão 1.2.3 pronta."), "Versão 1.2.3 pronta.");
});

test("o mesmo arquivo recebe o mesmo apelido nas atividades", () => {
  const p = criarPrivacidade();
  const a = p.texto("Editando src/contratos/acme-folha.xlsx");
  const b = p.texto("Lendo src/contratos/acme-folha.xlsx");
  assert.equal(a.replace("Editando ", ""), b.replace("Lendo ", ""));
  assert.ok(!a.includes("acme"));
  assert.ok(!a.includes("contratos"));
});

// ---------------------------------------------------------------- correções da revisão da Etapa 6

test("descrição livre de subagente/comando vira rótulo genérico: nada vai ao canvas", () => {
  const p = criarPrivacidade();
  const livres = [
    "Ajustar contrato-acme para fulano",
    "Revisar a proposta do cliente acme",
  ];
  for (const descricao of livres) {
    const [a] = mascararAgentes(p, [agente("x", { activity: descricao, activitySimples: descricao, status: "trabalhando", role: "general-purpose" })]);
    assert.equal(a.activity, "Trabalhando numa tarefa");
    assert.equal(a.activitySimples, "Trabalhando numa tarefa");
    const texto = JSON.stringify(a).toLowerCase();
    for (const proibido of ["contrato", "acme", "fulano", "proposta"]) assert.ok(!texto.includes(proibido), `sobrou ${proibido}`);
  }
  assert.equal(p.atividade("Rodando: npm test -- acme", "trabalhando"), "Executando uma tarefa no computador");
  assert.equal(p.atividade("Pesquisando: preço da acme", "trabalhando"), "Pesquisando");
  assert.equal(p.atividade("Usando a skill acme-folha", "trabalhando"), "Usando uma skill");
  assert.equal(p.atividade("Usando github: create_issue", "trabalhando"), "Usando uma ferramenta");
  assert.equal(p.atividade("Pensando...", "pensando"), "Pensando...");
  assert.equal(p.atividade("Fazendo mudanças no sistema", "trabalhando"), "Fazendo mudanças no sistema");
  // descrição de Bash que imita um verbo de arquivo mas não é arquivo
  assert.equal(p.atividade("Editando contrato acme", "pensando"), "Pensando");
});

test("feed: texto livre depois de 'entrou para:', 'avisou:', '→' e 'recebeu:' some", () => {
  const p = criarPrivacidade();
  const mk = (text: string, kind: FeedItem["kind"]): FeedItem => ({ id: 1, at: AGORA, agentId: "a", agentName: "B", role: "dev", text, kind });
  const out = mascararFeed(p, [
    mk("entrou para: Ajustar contrato-acme para fulano", "spawn"),
    mk("avisou: ligar para fulano sobre a acme", "info"),
    mk("→ Guto: mande o contrato da acme", "message"),
    mk("pediu permissão → Bash: rm contrato-acme", "alert"),
    mk("Mandar contrato da acme para fulano", "tool"),
  ]);
  const texto = JSON.stringify(out).toLowerCase();
  for (const proibido of ["contrato", "acme", "fulano"]) assert.ok(!texto.includes(proibido), `sobrou ${proibido}: ${texto}`);
  assert.equal(out[0].text, "entrou para");
});

test("conversa entre agentes: o texto do balão é genérico", () => {
  assert.equal(criarPrivacidade().conversa(), "Conversando");
});

test("nome conhecido só troca como palavra inteira", () => {
  const p = criarPrivacidade();
  const ana = p.responsavel("Ana");
  p.projeto("web");
  assert.equal(p.texto("Analisando o webpack"), "Analisando o webpack");
  assert.ok(p.texto("Falar com Ana").includes(ana));
  assert.ok(!p.texto("Falar com Ana").includes("Ana"), "palavra inteira é trocada");
  assert.ok(p.texto("Subir a web hoje").includes("Projeto"), "web como palavra inteira é trocada");
  assert.equal(p.texto("Instalar o webpack"), "Instalar o webpack");
  // nomes com menos de 3 letras não são registrados
  const p2 = criarPrivacidade();
  p2.responsavel("Jo");
  assert.equal(p2.texto("Jo foi ao Joinville"), "Jo foi ao Joinville");
});

test("registra todos os nomes antes de mascarar: ordem dos dados não importa", () => {
  const p = criarPrivacidade();
  // "Joana Prado" só aparece como responsável nas pendências; a atividade do agente já a cita
  const pend: Pendencia[] = [
    { id: "1", texto: "Ligar", responsavel: "Joana Prado", origem: "Proposta Banco Aurora", prazo: null, estado: "aberta", missao: null } as unknown as Pendencia,
  ];
  const out = mascararTudo(p, {
    agentes: [agente("a", { activity: "Lendo Joana Prado", activitySimples: undefined })],
    feed: [],
    caixa: null,
    pendencias: pend,
    missoes: null,
  });
  semOriginais(out);
  assert.equal(out.pendencias?.[0].responsavel, "Responsável A");
});

test("missão: id e nome do mesmo item recebem o mesmo apelido", () => {
  const p = criarPrivacidade();
  const a = p.missao("2026-10-19-plano-secreto", ["Plano Secreto"]);
  assert.equal(a, "Missão 1");
  assert.equal(p.missao("2026-10-19-plano-secreto", ["Plano Secreto"]), a);
  assert.equal(p.texto("Retomar o Plano Secreto"), "Retomar o Missão 1");
});

test("atividade: rótulo por papel só quando trabalhando; papel desconhecido nunca ecoa o nome do agente", () => {
  const p = criarPrivacidade();
  assert.equal(p.atividade("Revisar a proposta do cliente acme", "trabalhando", "dev"), "Programando");
  assert.equal(p.atividade("Revisar a proposta do cliente acme", "trabalhando", "testador"), "Testando");
  assert.equal(p.atividade("Revisar a proposta do cliente acme", "trabalhando", "revisor"), "Revisando o trabalho");
  assert.equal(p.atividade("Revisar a proposta do cliente acme", "trabalhando", "general-purpose"), "Trabalhando numa tarefa");
  assert.equal(p.atividade("Revisar a proposta do cliente acme", "trabalhando", "agente-da-acme"), "Trabalhando numa tarefa");
  assert.equal(p.atividade("Revisar a proposta do cliente acme", "pensando", "dev"), "Pensando");
  // "Rodando:" continua com a frase própria
  assert.equal(p.atividade("Rodando: npm test", "trabalhando", "dev"), "Executando uma tarefa no computador");
  const [a] = mascararAgentes(p, [agente("x", { activity: "Revisar a proposta do cliente acme", activitySimples: "Revisar a proposta do cliente acme", status: "trabalhando", role: "pesquisador" })]);
  assert.equal(a.activity, "Pesquisando");
  assert.equal(a.activitySimples, "Pesquisando");
});
