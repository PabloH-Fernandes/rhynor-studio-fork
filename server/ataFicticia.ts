// Gerador de atas FICTÍCIAS para testar e apresentar o AG Pocket (npm run ata-ficticia).
// Gera o mesmo formato que o fluxo do Power Automate vai gravar (docs/power-automate-reunioes.md) e salva
// em <vault>/00-Inbox/. Nomes, empresas e projetos são todos inventados; nenhum dado real da AG.
//
// Uso:
//   npm run ata-ficticia                                 (cenário aleatório, vault configurado)
//   npm run ata-ficticia -- --cenario=alinhamento-bi
//   npm run ata-ficticia -- --vault=C:\caminho\do\vault  (senão usa AGPOCKET_VAULT ou o settings.json)
//   npm run ata-ficticia -- --sem-gravar                 (só mostra o texto)
//
// Cenários: projeto-software, alinhamento-bi, so-decisoes, tarefas-sem-prazo e bagunçado
// (transcrição sem seções: de propósito cai em "fora do formato"; vale também "baguncado", sem cedilha).

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chave, expandeCaminho, resolverVault } from "./vault.ts";

export const CENARIOS = ["projeto-software", "alinhamento-bi", "so-decisoes", "tarefas-sem-prazo", "bagunçado"] as const;
export type NomeCenario = (typeof CENARIOS)[number];

export interface OpcoesGerador {
  /** o "agora" da reunião (data, hora e prazos saem dele) */
  agora?: Date;
  /** sorteio em [0, 1); injetável para testes */
  rng?: () => number;
}

export interface AtaGerada {
  /** ata-AAAA-MM-DD-HHmm-<slug>.md */
  nomeArquivo: string;
  texto: string;
}

// ---------------------------------------------------------------- dados inventados

export const PESSOAS_FICTICIAS = [
  "Heitor Quintanilha",
  "Isadora Vellani",
  "Otávio Brandalise",
  "Luana Cabrera",
  "Tomás Ravanelli",
  "Yasmin Torquato",
  "Egídio Marcondi",
  "Valentina Aurelli",
];

const PROJETOS_SOFTWARE = ["Projeto Gaivota", "Projeto Girassol", "Projeto Pé de Vento", "Projeto Jabuticaba"];
const EMPRESAS = ["Cafeteria Lunaris", "Transportes Rio Manso", "Doceria Zefa & Filhas", "Estaleiro Brisa Azul"];

interface TarefaModelo {
  texto: string;
  /** índice em `pessoas`; undefined = ata sem responsável */
  quem?: number;
  /** dias a partir da reunião (pode ser negativo = já vencido); undefined = sem prazo */
  prazoDias?: number;
}

interface Modelo {
  titulo: string;
  slug: string;
  notas: string[];
  decisoes: string[];
  tarefas: TarefaModelo[];
  /** só o cenário bagunçado: texto solto, sem seções */
  transcricao?: string[];
}

type Ctx = { p: string[]; projeto: string; empresa: string };

function primeiroNome(n: string): string {
  return n.split(" ")[0];
}

function modeloDo(cenario: NomeCenario, c: Ctx): Modelo {
  const [a, b, d] = c.p;
  switch (cenario) {
    case "projeto-software":
      return {
        titulo: `Planejamento da sprint do ${c.projeto}`,
        slug: "planejamento-sprint",
        notas: [
          `O ${c.projeto} entra na terceira sprint, com foco no cadastro de clientes da ${c.empresa}.`,
          `${primeiroNome(a)} mostrou o protótipo da tela de cadastro e a equipe achou o fluxo claro.`,
          "O login ainda usa o sistema antigo e atrapalha os testes.",
          "A lista de pendências do backlog foi revisada e três itens saíram do escopo.",
          `${primeiroNome(b)}: preciso de um ambiente de testes antes de começar a integração.`,
        ],
        decisoes: ["A sprint tem duas semanas e termina numa sexta-feira.", "O login novo entra antes do cadastro."],
        tarefas: [
          { texto: "Criar o ambiente de testes com dados inventados", quem: 0, prazoDias: 1 },
          { texto: "Escrever a API de cadastro de clientes", quem: 1, prazoDias: 10 },
          { texto: "Trocar o login antigo pelo novo", quem: 1, prazoDias: -3 },
          { texto: "Documentar como rodar o projeto do zero", quem: 2, prazoDias: 14 },
          { texto: "Marcar uma conversa com a equipe da " + c.empresa + " para validar a tela", quem: 0, prazoDias: 7 },
        ],
      };
    case "alinhamento-bi":
      return {
        titulo: `Alinhamento do painel de BI do ${c.projeto}`,
        slug: "alinhamento-bi",
        notas: [
          "O painel de vendas mostra números diferentes dos da planilha mensal.",
          `${primeiroNome(a)} explicou que a diferença vem de pedidos cancelados que ainda contam no painel.`,
          "Os gráficos de estoque demoram para carregar nas segundas-feiras.",
          `A ${c.empresa} pediu um indicador novo: ticket médio por região.`,
        ],
        decisoes: ["Pedidos cancelados saem da conta do painel.", "O indicador de ticket médio entra na próxima versão."],
        tarefas: [
          { texto: "Corrigir a regra de pedidos cancelados na consulta do painel", quem: 1, prazoDias: 5 },
          { texto: "Comparar o painel com a planilha mensal e listar as diferenças", quem: 2, prazoDias: 4 },
          { texto: "Descobrir por que o gráfico de estoque demora na segunda-feira", quem: 1, prazoDias: 9 },
          { texto: "Desenhar o indicador de ticket médio por região", quem: 0, prazoDias: 12 },
        ],
      };
    case "so-decisoes":
      return {
        titulo: "Definição das regras do comitê de arquitetura",
        slug: "regras-do-comite",
        notas: [
          "A reunião serviu para fechar pontos que estavam em aberto desde o mês passado.",
          `${primeiroNome(a)}: apresentei a proposta de pastas por área, que separa os serviços por time.`,
          "A segunda proposta, por tipo de tecnologia, foi considerada mais difícil de manter.",
          `${primeiroNome(d)}: lembrei que a ${c.empresa} depende de uma entrega estável.`,
        ],
        decisoes: [
          "Os serviços novos seguem a proposta de pastas por área.",
          "Mudança grande de arquitetura precisa de uma página de justificativa.",
          "O comitê se reúne toda primeira terça-feira do mês.",
          "O repositório antigo fica só para leitura até o fim do trimestre.",
        ],
        tarefas: [],
      };
    case "tarefas-sem-prazo":
      return {
        titulo: `Retrospectiva do ${c.projeto}`,
        slug: "retrospectiva",
        notas: [
          "A equipe achou o ritmo bom, mas as reuniões de acompanhamento estão longas.",
          `${primeiroNome(b)} sugeriu um quadro de tarefas mais simples, só com três colunas.`,
          "Ninguém lembra quem cuida das cópias de segurança do servidor de testes.",
        ],
        decisoes: ["As reuniões de acompanhamento passam a durar no máximo 30 minutos."],
        tarefas: [
          { texto: "Montar o quadro de tarefas com três colunas", quem: 1 },
          { texto: "Revisar as cópias de segurança do servidor de testes", quem: 2 },
          { texto: "Escrever um resumo das lições da retrospectiva", quem: 0, prazoDias: 6 },
          { texto: "Combinar com a equipe um horário fixo para o acompanhamento" },
          { texto: "Pesquisar ferramentas gratuitas de quadro de tarefas", quem: 1 },
        ],
      };
    case "bagunçado":
      return {
        titulo: `Conversa solta sobre o ${c.projeto}`,
        slug: "conversa-solta",
        notas: [],
        decisoes: [],
        tarefas: [],
        transcricao: [
          `00:00:04 ${primeiroNome(a)}: bom dia, pessoal, vamos ver o ${c.projeto} rapidinho`,
          `00:00:11 ${primeiroNome(b)}: eu travei na parte do login, acho que preciso de ajuda`,
          `00:00:19 ${primeiroNome(a)}: a gente vê isso, depois eu te chamo`,
          `00:00:27 ${primeiroNome(d)}: e aquele relatório da ${c.empresa}, quem fica com ele?`,
          `00:00:35 ${primeiroNome(b)}: acho que eu, mas só semana que vem, talvez`,
          `00:00:44 ${primeiroNome(a)}: beleza, fecha assim`,
        ],
      };
  }
}

// ---------------------------------------------------------------- formato

/** acha o cenário pelo nome, sem ligar para maiúscula nem acento ("baguncado" vale); null se não existir */
export function acharCenario(entrada: string): NomeCenario | null {
  const k = chave(entrada);
  return CENARIOS.find((c) => chave(c) === k) ?? null;
}

const dois = (n: number) => String(n).padStart(2, "0");

function diaIso(d: Date): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

function maisDias(d: Date, dias: number): string {
  return diaIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias));
}

/** sorteia `n` itens diferentes (embaralha uma cópia) */
function sortear<T>(lista: readonly T[], n: number, rng: () => number): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.slice(0, n);
}

function hex4(rng: () => number): string {
  return Math.floor(rng() * 0x10000)
    .toString(16)
    .padStart(4, "0");
}

/** Gera uma ata fictícia completa. Mesmo `agora` e mesmo `rng` dão sempre o mesmo texto. */
export function gerarAta(cenario: NomeCenario, opts: OpcoesGerador = {}): AtaGerada {
  const agora = opts.agora ?? new Date();
  const rng = opts.rng ?? Math.random;
  const ctx: Ctx = {
    p: sortear(PESSOAS_FICTICIAS, 3, rng),
    projeto: sortear(PROJETOS_SOFTWARE, 1, rng)[0],
    empresa: sortear(EMPRESAS, 1, rng)[0],
  };
  const m = modeloDo(cenario, ctx);

  const data = diaIso(agora);
  const hora = `${dois(agora.getHours())}:${dois(agora.getMinutes())}`;
  const carimbo = `${data}-${dois(agora.getHours())}${dois(agora.getMinutes())}`;
  const reuniaoId = `ficticia-${carimbo.replace(/-/g, "")}-${m.slug}-${hex4(rng)}`;

  const out: string[] = [
    "---",
    "tipo: ata-bruta",
    "origem: copilot-insights",
    `data: ${data}`,
    `hora: "${hora}"`,
    `titulo: ${m.titulo}`,
    `reuniao_id: ${reuniaoId}`,
    "status: nova",
    "ficticia: true",
    "confidencial: true",
    "---",
    "",
    `# ${m.titulo}`,
    "",
  ];

  if (m.transcricao) {
    out.push("Texto corrido da reunião, sem resumo nem seções:", "", ...m.transcricao, "");
  } else {
    out.push("## Notas da reunião (Copilot)", ...m.notas.map((n) => `- ${n}`), "");
    if (m.decisoes.length > 0) out.push("## Decisões", ...m.decisoes.map((x) => `- ${x}`), "");
    if (m.tarefas.length > 0) {
      out.push("## Tarefas");
      for (const t of m.tarefas) {
        let linha = `- [ ] ${t.texto}`;
        if (t.quem !== undefined) linha += ` (responsável: ${ctx.p[t.quem]})`;
        if (t.prazoDias !== undefined) linha += ` (prazo: ${maisDias(agora, t.prazoDias)})`;
        out.push(linha);
      }
      out.push("");
    }
  }

  return { nomeArquivo: `ata-${carimbo}-${m.slug}.md`, texto: out.join("\n") };
}

// ---------------------------------------------------------------- gravar

/** Grava em <inbox>/<nome>.md.tmp e renomeia; se o nome já existe, acrescenta -2, -3... Devolve o caminho final. */
export async function gravarAta(inbox: string, ata: AtaGerada): Promise<string> {
  await fsp.mkdir(inbox, { recursive: true });
  const base = ata.nomeArquivo.replace(/\.md$/i, "");
  let destino = path.join(inbox, `${base}.md`);
  for (let k = 2; fs.existsSync(destino); k++) destino = path.join(inbox, `${base}-${k}.md`);
  const tmp = `${destino}.tmp`;
  await fsp.writeFile(tmp, ata.texto, { encoding: "utf8", flag: "wx" });
  await fsp.rename(tmp, destino);
  return destino;
}

// ---------------------------------------------------------------- CLI

interface ArgsCli {
  cenario: string | null;
  vault: string | null;
  semGravar: boolean;
  erro: string | null;
}

export function lerArgs(argv: string[]): ArgsCli {
  const r: ArgsCli = { cenario: null, vault: null, semGravar: false, erro: null };
  for (const a of argv) {
    if (a === "--sem-gravar") r.semGravar = true;
    else if (a.startsWith("--cenario=")) r.cenario = a.slice("--cenario=".length).trim();
    else if (a.startsWith("--vault=")) r.vault = a.slice("--vault=".length).trim();
    else r.erro ??= `Opção desconhecida: ${a}`;
  }
  return r;
}

async function cli(argv: string[]): Promise<number> {
  const args = lerArgs(argv);
  if (args.erro) {
    console.error(`${args.erro}\nUso: npm run ata-ficticia -- [--cenario=<nome>] [--vault=<caminho>] [--sem-gravar]`);
    return 2;
  }
  let cenario: NomeCenario;
  if (args.cenario) {
    const achado = acharCenario(args.cenario);
    if (!achado) {
      console.error(`Cenário "${args.cenario}" não existe. Os cenários são: ${CENARIOS.join(", ")}.`);
      return 2;
    }
    cenario = achado;
  } else {
    cenario = CENARIOS[Math.floor(Math.random() * CENARIOS.length)];
  }

  const ata = gerarAta(cenario);
  if (args.semGravar) {
    console.log(`# ${ata.nomeArquivo}\n\n${ata.texto}`);
    return 0;
  }

  const vault = args.vault ? expandeCaminho(args.vault, os.homedir()) : resolverVault(process.env, os.homedir());
  if (!vault) {
    console.error(
      args.vault
        ? "O caminho do --vault precisa ser absoluto (ex.: C:\\Users\\voce\\AG-Cerebro-teste)."
        : "Vault não configurado. Rode npm run setup, defina AGPOCKET_VAULT ou passe --vault=<caminho>.",
    );
    return 1;
  }
  if (!fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) {
    console.error(`A pasta do vault não existe: ${vault}`);
    return 1;
  }
  const destino = await gravarAta(path.join(vault, "00-Inbox"), ata);
  console.log(`Ata fictícia (${cenario}) salva em: ${destino}`);
  return 0;
}

const diretamente = process.argv[1] !== undefined && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (diretamente) {
  cli(process.argv.slice(2)).then(
    (codigo) => {
      process.exitCode = codigo;
    },
    (err) => {
      console.error("Não consegui gerar a ata:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    },
  );
}
