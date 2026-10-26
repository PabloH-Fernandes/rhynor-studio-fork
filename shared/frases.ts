// Frases simples do feed "O que tá rolando" (e do balão, crachá e lista do time), sem jargão.
// Ficam em shared: o servidor gera, o front agrupa (fraseAgrupada, nomeCurto).
// Nada de nome de ferramenta, comando ou caminho de arquivo: quem lê não precisa ser de TI.
// A versão técnica (ferramenta, arquivo, comando) continua em FeedItem.text.
//
// A frase não leva o nome: o feed escreve "<nome> <frase>" (comNome); a mesma frase serve pro
// agrupamento ("Otto está estudando o projeto (12 arquivos)").

import type { FeedCategoria, Genero } from "./types.ts";

export interface Frase {
  /** sem o nome: "está testando se tudo funciona" */
  simples: string;
  categoria: FeedCategoria;
  /** só em ações que se repetem: o que contar quando agrupa ("arquivos" → "(12 arquivos)") */
  contaComo?: string;
}

/** quem fala: o gênero muda "dele/dela" e "chamado/chamada"; o papel ajuda a entender comandos */
export interface Quem {
  genero?: Genero;
  papel?: string;
}

/** o que aconteceu no escritório (além das ferramentas) */
export type Evento =
  | { tipo: "chegou" }
  | { tipo: "voltou" }
  | { tipo: "resumiu" }
  | { tipo: "conversaNova" }
  | { tipo: "pedido" }
  | { tipo: "chamado"; deNovo: boolean }
  | { tipo: "pergunta" }
  | { tipo: "autorizacao" }
  | { tipo: "precisa" }
  | { tipo: "aviso" }
  | { tipo: "falhou" }
  | { tipo: "terminouParte" }
  | { tipo: "terminouVez" }
  | { tipo: "etapa"; etapa: number; total: number }
  | { tipo: "tudoConcluido"; total: number }
  | { tipo: "recado"; para?: string }
  | { tipo: "saiu"; motivo: "embora" | "entregou" | "semSinal" };

const VOLTE = "volte ao terminal";

const dele = (q: Quem) => (q.genero === "feminino" ? "dela" : "dele");
const o = (q: Quem) => (q.genero === "feminino" ? "a" : "o");

/** "<nome> <frase>" */
export function comNome(nome: string, simples: string): string {
  return `${nome} ${simples}`;
}

/** Nome curto do feed: o apelido da plaquinha ("HELÔ" → "Helô") ou o primeiro nome. */
export function nomeCurto(nome: string, apelido?: string): string {
  const base = apelido?.trim() || nome.trim().split(/\s+/)[0] || nome;
  return base.charAt(0).toLocaleUpperCase("pt-BR") + base.slice(1).toLocaleLowerCase("pt-BR");
}

/** Frase agrupada: "está estudando o projeto (12 arquivos)"; com 1 fica a frase sozinha. */
export function fraseAgrupada(simples: string, n: number, contaComo?: string): string {
  return n > 1 ? `${simples} (${n} ${contaComo ?? "vezes"})` : simples;
}

const TESTE = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(jest|vitest|pytest|mocha|playwright|cypress)\b|--test\b|\.(test|spec)\.|\btest(e|es|s)?\b|\btestando\b/i;
const CONFERE = /\b(tsc|typecheck|lint|eslint|prettier|build)\b/i;
const INSTALA = /\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b|\bpip3?\s+install\b/i;
const GIT = /(^|[\s;&|])git\s/i;

/** nome de ferramenta, comando, caminho, extensão, URL, variável... */
const JARGAO =
  /\b(read|write|edit|multiedit|notebookedit|bash|grep|glob|websearch|webfetch|todowrite|taskcreate|taskupdate|sendmessage|skill|agent|mcp|npm|npx|node|git|yarn|pnpm|bun|pip|tsc|tsx|jsx?|json|cjs|mjs|curl|sudo|docker|playwright|vitest|jest|pytest|test|tests|commit|push|pull|merge|install|build|deploy|lint|cd|ls|rm|cat)\b|[/\\]|\.\p{L}{1,5}\b|\w_\w|__|\$|`|\||https?:/iu;

/** O texto tem cara de coisa técnica (não serve pra quem não é de TI)? */
export function temJargao(s: string): boolean {
  return JARGAO.test(s);
}

/** Tema da pesquisa só quando é curto e sem nada técnico; senão a frase fica genérica. */
function temaSeguro(q: unknown): string | null {
  if (typeof q !== "string") return null;
  const s = q.replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 40 || s.split(" ").length > 6) return null;
  return /^[\p{L}\p{N} ,-]+$/u.test(s) && !temJargao(s) ? s : null;
}

/** Frase simples de uma ferramenta (as mesmas que o describeTool do state.ts entende). */
export function fraseFerramenta(tool: string, input: Record<string, unknown>, quem: Quem = {}): Frase {
  switch (tool) {
    case "Read":
      return { simples: "está estudando o projeto", categoria: "estudo", contaComo: "arquivos" };
    case "Grep":
    case "Glob":
      return { simples: "está procurando algo no projeto", categoria: "busca", contaComo: "buscas" };
    case "Write": {
      const doc = /\.(md|mdx|txt)$/i.test(String(input.file_path ?? ""));
      return { simples: doc ? "está escrevendo a documentação" : "está criando algo novo no sistema", categoria: "mudanca", contaComo: "mudanças" };
    }
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit": {
      const doc = /\.(md|mdx|txt)$/i.test(String(input.file_path ?? ""));
      return { simples: doc ? "está atualizando a documentação" : "está fazendo mudanças no sistema", categoria: "mudanca", contaComo: "mudanças" };
    }
    case "Bash": {
      const cmd = `${String(input.command ?? "")} ${String(input.description ?? "")}`;
      if (TESTE.test(cmd) || quem.papel === "testador") return { simples: "está testando se tudo funciona", categoria: "teste", contaComo: "rodadas" };
      if (INSTALA.test(cmd)) return { simples: "está instalando o que o projeto precisa", categoria: "comando", contaComo: "passos" };
      if (CONFERE.test(cmd)) return { simples: "está conferindo se está tudo em ordem", categoria: "comando", contaComo: "passos" };
      if (GIT.test(cmd)) return { simples: "está salvando uma versão do trabalho", categoria: "comando", contaComo: "passos" };
      return { simples: "está executando uma tarefa no computador", categoria: "comando", contaComo: "passos" };
    }
    case "WebSearch": {
      const tema = temaSeguro(input.query);
      return { simples: tema ? `está pesquisando na internet sobre “${tema}”` : "está pesquisando na internet", categoria: "internet", contaComo: "consultas" };
    }
    case "WebFetch":
      return { simples: "está lendo uma página da internet", categoria: "internet", contaComo: "consultas" };
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
      return { simples: "está organizando a lista de tarefas", categoria: "tarefas", contaComo: "atualizações" };
    case "SendMessage":
      return { simples: "está conversando com o time", categoria: "recado" };
    case "Skill":
      return { simples: "está seguindo um passo a passo pronto", categoria: "ferramenta", contaComo: "vezes" };
    case "Agent":
    case "Task":
      return { simples: "está chamando alguém do time para ajudar", categoria: "chegada" };
    case "AskUserQuestion":
      return fraseEvento({ tipo: "pergunta" }, quem);
    default:
      return { simples: "está usando uma ferramenta", categoria: "ferramenta", contaComo: "vezes" };
  }
}

/** Frase simples de um acontecimento (chegou, terminou, precisa de você...). */
export function fraseEvento(e: Evento, quem: Quem = {}): Frase {
  switch (e.tipo) {
    case "chegou":
      return { simples: "chegou ao escritório", categoria: "chegada" };
    case "voltou":
      return { simples: "voltou ao trabalho", categoria: "info" };
    case "resumiu":
      return { simples: "organizou as anotações da conversa para continuar", categoria: "info" };
    case "conversaNova":
      return { simples: "começou uma conversa nova, e o time continua", categoria: "info" };
    case "pedido":
      return { simples: "recebeu um pedido seu", categoria: "pedido" };
    case "chamado":
      return { simples: e.deNovo ? `foi chamad${o(quem)} de novo para ajudar` : "chegou para ajudar", categoria: "chegada" };
    case "pergunta":
      return { simples: `tem uma pergunta para você: ${VOLTE}`, categoria: "precisa" };
    case "autorizacao":
      return { simples: `precisa da sua autorização: ${VOLTE}`, categoria: "precisa" };
    case "precisa":
      return { simples: `precisa de você: ${VOLTE}`, categoria: "precisa" };
    case "aviso":
      return { simples: "deixou um aviso", categoria: "info" };
    case "falhou":
      return { simples: "encontrou um problema e está tentando de outro jeito", categoria: "erro" };
    case "terminouParte":
      return { simples: `terminou a parte ${dele(quem)}`, categoria: "terminou" };
    case "terminouVez":
      return { simples: `terminou a vez ${dele(quem)}, esperando você`, categoria: "info" };
    case "etapa":
      return { simples: `marcou a etapa ${e.etapa} de ${e.total} como concluída`, categoria: "etapa" };
    case "tudoConcluido":
      return {
        simples: e.total === 1 ? "concluiu a única etapa: trabalho concluído" : `concluiu as ${e.total} etapas: trabalho concluído`,
        categoria: "concluido",
      };
    case "recado":
      return { simples: e.para ? `mandou um recado para ${e.para}` : "mandou um recado para o time", categoria: "recado" };
    case "saiu":
      if (e.motivo === "entregou") return { simples: `terminou a parte ${dele(quem)} e foi embora`, categoria: "saiu" };
      if (e.motivo === "semSinal") return { simples: "saiu do escritório", categoria: "saiu" };
      return { simples: "foi embora", categoria: "saiu" };
  }
}

/** Frase do assunto sem detalhe: usada quando um grupo junta frases diferentes ("sobre X" + "sobre Y"). */
const GENERICA: Partial<Record<FeedCategoria, string>> = {
  estudo: "está estudando o projeto",
  busca: "está procurando algo no projeto",
  mudanca: "está fazendo mudanças no sistema",
  teste: "está testando se tudo funciona",
  comando: "está executando tarefas no computador",
  internet: "está pesquisando na internet",
  tarefas: "está organizando a lista de tarefas",
  ferramenta: "está usando uma ferramenta",
};

export function fraseGenerica(categoria: FeedCategoria | undefined, simples: string): string {
  return (categoria && GENERICA[categoria]) ?? simples;
}

/** "está fazendo mudanças no sistema" → "Fazendo mudanças no sistema" (balão, crachá, lista do time). */
export function comoAtividade(simples: string): string {
  const s = simples.replace(/^está /, "");
  return s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1);
}

const ATIVIDADE_DO_STATUS: Record<string, string> = {
  chegando: "Chegando",
  trabalhando: "Trabalhando numa tarefa",
  pensando: "Pensando",
  esperando: "Precisa de você",
  ocioso: "De boa",
  saindo: "Indo embora",
};

/** Rótulo fixo por papel do time (só os papéis conhecidos; nunca o nome cru do agente). */
const ATIVIDADE_DO_PAPEL: Record<string, string> = {
  planejador: "Planejando as etapas",
  dev: "Programando",
  testador: "Testando",
  revisor: "Revisando o trabalho",
  documentador: "Escrevendo a documentação",
  pesquisador: "Pesquisando",
};

/**
 * Atividade genérica pelo status; com status 'trabalhando' e um papel conhecido, o rótulo do papel.
 * Papel desconhecido (general-purpose, personalizado) continua 'Trabalhando numa tarefa'.
 */
export function atividadeGenerica(status: string, papel?: string): string {
  if (status === "trabalhando" && papel) {
    const rotulo = Object.hasOwn(ATIVIDADE_DO_PAPEL, papel) ? ATIVIDADE_DO_PAPEL[papel] : undefined;
    if (rotulo) return rotulo;
  }
  return ATIVIDADE_DO_STATUS[status] ?? "Trabalhando numa tarefa";
}

/** Atividade sem jargão: a própria, se já for simples; senão uma frase pelo status (e pelo papel, se trabalhando). */
export function simplificarAtividade(activity: string, status: string, papel?: string): string {
  return activity && !temJargao(activity) ? activity : atividadeGenerica(status, papel);
}
