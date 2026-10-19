// Modo privacidade da apresentação (lógica pura, sem React): troca nomes reais por apelidos estáveis em tudo
// que aparece na tela (projeto, arquivos, títulos de reunião e de missão, responsáveis, tarefas).
//
// É "melhor esforço" no cliente: os dados reais ainda chegam ao navegador (aba Rede, WebSocket). Cobre o que
// o painel e o escritório desenham, não impede quem abrir as ferramentas do navegador. Numa apresentação de
// verdade o ideal é usar um vault fictício.
//
// Estável = a mesma entrada dá sempre o mesmo apelido (dentro da mesma `Privacidade`), e entradas diferentes
// dão apelidos diferentes. Os apelidos seguem a ordem em que cada nome aparece pela primeira vez.

import { atividadeGenerica } from "../../shared/frases";
import type { Agent, CaixaItem, FeedItem, MissoesInfo, Pendencia, Progress } from "../../shared/types";

type Categoria = "projeto" | "reuniao" | "missao" | "responsavel" | "arquivo" | "tarefa" | "assunto";

const GREGO = ["Alfa", "Beta", "Gama", "Delta", "Épsilon", "Zeta", "Eta", "Teta", "Iota", "Capa"];
const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const APELIDO: Record<Categoria, (n: number) => string> = {
  projeto: (n) => `Projeto ${n < GREGO.length ? GREGO[n] : n + 1}`,
  reuniao: (n) => `Reunião ${n + 1}`,
  missao: (n) => `Missão ${n + 1}`,
  responsavel: (n) => `Responsável ${n < LETRAS.length ? LETRAS[n] : n + 1}`,
  arquivo: (n) => `arquivo ${n + 1}`,
  tarefa: (n) => `Tarefa ${n + 1}`,
  assunto: (n) => `assunto ${n + 1}`,
};

/** um nome já do formato do servidor ("Responsável A") não é trocado de novo */
const JA_APELIDO_RESPONSAVEL = /^Responsável [A-Z]$/;

export interface Privacidade {
  projeto(valor: string): string;
  reuniao(titulo: string): string;
  /** `sinonimos`: outros nomes da mesma missão (o nome legível, além do id) que também viram o mesmo apelido */
  missao(chave: string, sinonimos?: readonly string[]): string;
  responsavel(nome: string): string;
  tarefa(texto: string): string;
  /** texto livre (atividade, linha do feed): arquivos, caminhos, comandos, buscas e nomes já conhecidos viram apelidos */
  texto(texto: string): string;
  /**
   * Atividade do balão/crachá/lista: só frases conhecidas (arquivo, frase pronta do sistema) passam; texto livre
   * (descrição de subagente ou de comando, busca, prompt) vira um rótulo genérico por tipo ou pelo status.
   */
  atividade(texto: string, status?: string, papel?: string): string;
  /** linha do feed: o que vem depois de "recebeu:", "avisou:", "entrou para:", "→ Fulano:" etc. some */
  linhaFeed(texto: string, kind?: string): string;
  /** o conteúdo de uma conversa entre agentes nunca vai à tela na apresentação */
  conversa(): string;
}

/** frases prontas do sistema (shared/frases.ts e state.ts): não têm texto livre */
const FRASES_PRONTAS = new RegExp(
  "^(?:" +
    [
      "Estudando o projeto",
      "Procurando algo no projeto",
      "Escrevendo a documentação",
      "Atualizando a documentação",
      "Criando algo novo no sistema",
      "Fazendo mudanças no sistema",
      "Testando se tudo funciona",
      "Instalando o que o projeto precisa",
      "Conferindo se está tudo em ordem",
      "Salvando uma versão do trabalho",
      "Executando uma tarefa no computador",
      "Pesquisando na internet",
      "Lendo uma página da internet",
      "Lendo uma página",
      "Organizando a lista de tarefas",
      "Organizando as tarefas",
      "Conversando com o time",
      "Mandando mensagem pro time",
      "Seguindo um passo a passo pronto",
      "Chamando alguém do time para ajudar",
      "Usando uma ferramenta",
      "Usando uma skill",
      "Trabalhando numa tarefa",
      "Chegando",
      "Pensando",
      "Precisa de você",
      "De boa",
      "Indo embora",
      "Indo pra mesa",
      "Voltando pra mesa",
      "Voltou ao trabalho",
    ].join("|") +
    ")(?:\\.{1,3}|…)?$",
  "iu",
);

function chaveDe(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** o último pedaço de um caminho (aceita / e \) */
function ultimoSegmento(caminho: string): string {
  const partes = caminho.split(/[\\/]+/).filter(Boolean);
  return partes.length > 0 ? partes[partes.length - 1] : caminho;
}

/** a parte do caminho depois de "Users"/"home": o nome da pessoa dona do computador */
function nomesDeUsuario(caminho: string): string[] {
  const partes = caminho.split(/[\\/]+/).filter(Boolean);
  const out: string[] = [];
  partes.forEach((p, i) => {
    if (/^(users|home|usuarios|usuários)$/i.test(p) && partes[i + 1] && i + 1 < partes.length - 1) out.push(partes[i + 1]);
  });
  return out;
}

export function criarPrivacidade(): Privacidade {
  const mapas: Record<Categoria, Map<string, string>> = {
    projeto: new Map(),
    reuniao: new Map(),
    missao: new Map(),
    responsavel: new Map(),
    arquivo: new Map(),
    tarefa: new Map(),
    assunto: new Map(),
  };
  /** nomes reais conhecidos (minúsculos) → apelido, para trocar também dentro de texto livre */
  const conhecidos = new Map<string, string>();
  let regexConhecidos: RegExp | null = null;

  const lembrar = (original: string, apelido: string) => {
    const o = original.trim();
    if (o.length < 3 || conhecidos.has(o.toLowerCase())) return;
    conhecidos.set(o.toLowerCase(), apelido);
    regexConhecidos = null;
  };

  const apelidar = (cat: Categoria, valor: string, lembra: boolean): string => {
    const chave = chaveDe(valor);
    if (!chave) return "";
    const mapa = mapas[cat];
    let a = mapa.get(chave);
    if (a === undefined) {
      a = APELIDO[cat](mapa.size);
      mapa.set(chave, a);
    }
    if (lembra) lembrar(valor, a);
    return a;
  };

  const trocarConhecidos = (t: string): string => {
    if (conhecidos.size === 0) return t;
    if (!regexConhecidos) {
      const nomes = [...conhecidos.keys()].sort((a, b) => b.length - a.length).map(escapar);
      // fronteira de palavra: "Ana" não corrompe "Analisando", "web" não corrompe "webpack"
      regexConhecidos = new RegExp(`(?<![\\p{L}\\p{N}])(?:${nomes.join("|")})(?![\\p{L}\\p{N}])`, "giu");
    }
    return t.replace(regexConhecidos, (m) => conhecidos.get(m.toLowerCase()) ?? m);
  };

  const pareceArquivoOuCaminho = (core: string): boolean => {
    if (/[\\/]/.test(core) || /@/.test(core)) return true;
    // nome.ext com uma letra na extensão (versão "1.2.3" e fim de frase "pronto." não contam)
    return /^[^\s.][^\s]*\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(core);
  };

  return {
    projeto(valor) {
      const bruto = valor.trim();
      if (!bruto) return "";
      const a = apelidar("projeto", ultimoSegmento(bruto), true);
      for (const u of nomesDeUsuario(bruto)) lembrar(u, "usuário");
      return a;
    },
    reuniao: (titulo) => apelidar("reuniao", titulo, true),
    missao(chave, sinonimos = []) {
      const a = apelidar("missao", chave, true);
      if (a) for (const s of sinonimos) lembrar(s, a);
      return a;
    },
    responsavel(nome) {
      if (JA_APELIDO_RESPONSAVEL.test(nome.trim())) return nome.trim();
      return apelidar("responsavel", nome, true);
    },
    tarefa: (texto) => apelidar("tarefa", texto, false),
    atividade(texto, status = "trabalhando", papel) {
      const t = texto.trim();
      if (!t) return texto;
      if (/^(Rodando|Executando)\b[^:]*:/.test(t)) return "Executando uma tarefa no computador";
      if (/^Pesquisando\s*:/.test(t)) return "Pesquisando";
      if (/^Usando a skill\b/i.test(t)) return "Usando uma skill";
      if (/^Usando \S+:/.test(t) || /^Usando mcp__/.test(t)) return "Usando uma ferramenta";
      if (/^Procurando arquivos\b/.test(t)) return "Procurando arquivos";
      if (/^Procurando “[^”]*”$/.test(t)) return this.texto(t);
      // arquivo, caminho ou site: "Lendo x.docx" (um único termo com cara de arquivo)
      const arq = /^(Lendo|Criando|Editando) (\S+)$/.exec(t);
      if (arq && (pareceArquivoOuCaminho(arq[2]) || arq[2] === "arquivo")) return this.texto(t);
      if (FRASES_PRONTAS.test(t)) return this.texto(t);
      // "Pesquisando na internet sobre “tema”": o tema entre aspas vira apelido
      if (/^Pesquisando na internet sobre “[^”]*”$/.test(t)) return this.texto(t);
      return atividadeGenerica(status, papel);
    },
    linhaFeed(texto, kind) {
      if (kind === "tool") return this.atividade(texto);
      const t = texto.replace(
        /^(\s*(?:recebeu|avisou|entrou para|foi chamado de novo|→[^:]*)):\s*.+$/s,
        (_m, pre: string) => (pre.trim().startsWith("→") ? "→ mandou um recado" : pre),
      );
      return this.texto(t.replace(/^(\s*pediu permissão)\s*→.*$/s, "$1"));
    },
    conversa: () => "Conversando",
    texto(texto) {
      let t = trocarConhecidos(texto);
      // o que vem depois de "Rodando:" / "Pesquisando:" é livre (comando, busca): some inteiro
      t = t.replace(/^(\s*(?:Rodando|Executando)[^:]*:)\s*.+$/s, "$1 um comando");
      t = t.replace(/^(\s*Pesquisando[^:]*:)\s*.+$/s, "$1 um assunto");
      t = t.replace(/^(\s*Usando a skill)\s+.+$/s, "$1");
      // termos entre aspas (busca, padrão de arquivo)
      t = t.replace(/[“"]([^”"]+)[”"]/g, (_m, dentro: string) => `“${apelidar("assunto", dentro, false)}”`);
      // arquivos, caminhos, sites e e-mails
      t = t.replace(/\S+/g, (token) => {
        const m = /^([([{'‘]*)(.*?)([)\]}'’,;:!?]*)$/s.exec(token);
        if (!m) return token;
        const [, antes, core, depois] = m;
        if (!core || !pareceArquivoOuCaminho(core)) return token;
        return `${antes}${apelidar("arquivo", core, false)}${depois}`;
      });
      return t;
    },
  };
}

// ---------------------------------------------------------------- pontos de aplicação (um por tipo de dado)

/** Agentes: projeto e atividade trocados. O nome do AGzinho é do elenco (fictício) e não muda. */
export function mascararAgentes(p: Privacidade, agentes: readonly Agent[]): Agent[] {
  // primeiro todos os projetos: assim o nome da pasta já é "conhecido" quando aparece dentro de uma atividade
  for (const a of agentes) p.projeto(a.project);
  return agentes.map((a) => ({
    ...a,
    project: p.projeto(a.project),
    activity: p.atividade(a.activity, a.status, a.role),
    ...(a.activitySimples !== undefined ? { activitySimples: p.atividade(a.activitySimples, a.status, a.role) } : {}),
  }));
}

export function mascararFeed(p: Privacidade, feed: readonly FeedItem[]): FeedItem[] {
  return feed.map((f) => ({ ...f, text: p.linhaFeed(f.text, f.kind), ...(f.simples !== undefined ? { simples: p.linhaFeed(f.simples) } : {}) }));
}

/** Caixa: título, texto das tarefas e responsável. `id`, `n` e `h` ficam (é o que volta ao servidor). */
export function mascararCaixa(p: Privacidade, itens: readonly CaixaItem[]): CaixaItem[] {
  return itens.map((i) => ({
    ...i,
    titulo: p.reuniao(i.titulo),
    tarefas: i.tarefas.map((t) => ({ ...t, texto: p.tarefa(t.texto), responsavel: p.responsavel(t.responsavel) })),
  }));
}

export function mascararPendencias(p: Privacidade, itens: readonly Pendencia[]): Pendencia[] {
  return itens.map((i) => ({ ...i, texto: p.tarefa(i.texto), responsavel: p.responsavel(i.responsavel), origem: p.reuniao(i.origem) }));
}

export function mascararMissoes(p: Privacidade, info: MissoesInfo | null): MissoesInfo | null {
  if (!info) return info;
  return {
    ...info,
    missoes: info.missoes.map((m) => ({
      ...m,
      // id e nome da mesma missão: a mesma chave (o id, único) dá o mesmo apelido
      id: p.missao(m.id, [m.nome]),
      nome: p.missao(m.id, [m.nome]),
      projeto: p.projeto(m.projeto),
      reuniaoTitulo: p.reuniao(m.reuniaoTitulo),
      itens: m.itens.map((i) => ({ ...i, texto: p.tarefa(i.texto) })),
      objetivo: "",
    })),
    atual: info.atual ? { id: p.missao(info.atual.id, [info.atual.nome]), nome: p.missao(info.atual.id, [info.atual.nome]), reuniaoTitulo: p.reuniao(info.atual.reuniaoTitulo) } : null,
  };
}

/** Quadro de etapas: com lista de tarefas o título é texto livre e vira "Etapa N"; a fase por papel ("Testes") fica. */
export function mascararProgress(progress: Progress | null): Progress | null {
  if (!progress || progress.fonte !== "tarefas") return progress;
  return { ...progress, titulo: `Etapa ${progress.etapa}` };
}

export interface DadosBrutos {
  agentes: readonly Agent[];
  feed: readonly FeedItem[];
  caixa: readonly CaixaItem[] | null;
  pendencias: readonly Pendencia[] | null;
  missoes: MissoesInfo | null;
}

export interface DadosMascarados {
  agentes: Agent[];
  feed: FeedItem[];
  caixa: CaixaItem[] | null;
  pendencias: Pendencia[] | null;
  missoes: MissoesInfo | null;
}

/**
 * Primeiro registra os nomes reais de TUDO (projeto, reunião, missão, responsável); só depois mascara o texto
 * livre e o feed. Assim um nome que só aparece num dado (ex.: responsável nas pendências) já é conhecido quando
 * aparece dentro de uma atividade, seja qual for a ordem em que os dados chegaram.
 */
export function mascararTudo(p: Privacidade, d: DadosBrutos): DadosMascarados {
  for (const a of d.agentes) p.projeto(a.project);
  for (const c of d.caixa ?? []) {
    p.reuniao(c.titulo);
    for (const t of c.tarefas) p.responsavel(t.responsavel);
  }
  for (const i of d.pendencias ?? []) {
    p.responsavel(i.responsavel);
    p.reuniao(i.origem);
  }
  for (const m of d.missoes?.missoes ?? []) {
    p.missao(m.id, [m.nome]);
    p.projeto(m.projeto);
    p.reuniao(m.reuniaoTitulo);
  }
  if (d.missoes?.atual) {
    p.missao(d.missoes.atual.id, [d.missoes.atual.nome]);
    p.reuniao(d.missoes.atual.reuniaoTitulo);
  }
  return {
    agentes: mascararAgentes(p, d.agentes),
    feed: mascararFeed(p, d.feed),
    caixa: d.caixa ? mascararCaixa(p, d.caixa) : null,
    pendencias: d.pendencias ? mascararPendencias(p, d.pendencias) : null,
    missoes: mascararMissoes(p, d.missoes),
  };
}
