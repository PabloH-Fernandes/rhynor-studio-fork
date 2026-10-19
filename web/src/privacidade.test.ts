import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent, CaixaItem, FeedItem, MissoesInfo, Pendencia, Progress } from "../../shared/types";
import { lerFlags } from "./apresentacao";
import { criarPrivacidade, mascararAgentes, mascararCaixa, mascararFeed, mascararMissoes, mascararPendencias, mascararProgress } from "./privacidade";

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
