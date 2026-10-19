// Modo privacidade da apresentação (lógica pura, sem React): troca nomes reais por apelidos estáveis em tudo
// que aparece na tela (projeto, arquivos, títulos de reunião e de missão, responsáveis, tarefas).
//
// É "melhor esforço" no cliente: os dados reais ainda chegam ao navegador (aba Rede, WebSocket). Cobre o que
// o painel e o escritório desenham, não impede quem abrir as ferramentas do navegador. Numa apresentação de
// verdade o ideal é usar um vault fictício.
//
// Estável = a mesma entrada dá sempre o mesmo apelido (dentro da mesma `Privacidade`), e entradas diferentes
// dão apelidos diferentes. Os apelidos seguem a ordem em que cada nome aparece pela primeira vez.

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
  missao(nome: string): string;
  responsavel(nome: string): string;
  tarefa(texto: string): string;
  /** texto livre (atividade, linha do feed): arquivos, caminhos, comandos, buscas e nomes já conhecidos viram apelidos */
  texto(texto: string): string;
}

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
      regexConhecidos = new RegExp(nomes.join("|"), "gi");
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
    missao: (nome) => apelidar("missao", nome, true),
    responsavel(nome) {
      if (JA_APELIDO_RESPONSAVEL.test(nome.trim())) return nome.trim();
      return apelidar("responsavel", nome, true);
    },
    tarefa: (texto) => apelidar("tarefa", texto, false),
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
    activity: p.texto(a.activity),
    ...(a.activitySimples !== undefined ? { activitySimples: p.texto(a.activitySimples) } : {}),
  }));
}

export function mascararFeed(p: Privacidade, feed: readonly FeedItem[]): FeedItem[] {
  return feed.map((f) => ({ ...f, text: p.texto(f.text), ...(f.simples !== undefined ? { simples: p.texto(f.simples) } : {}) }));
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
      id: p.missao(m.id),
      nome: p.missao(m.nome),
      projeto: p.projeto(m.projeto),
      reuniaoTitulo: p.reuniao(m.reuniaoTitulo),
      itens: m.itens.map((i) => ({ ...i, texto: p.tarefa(i.texto) })),
      objetivo: "",
    })),
    atual: info.atual ? { id: p.missao(info.atual.id), nome: p.missao(info.atual.nome), reuniaoTitulo: p.reuniao(info.atual.reuniaoTitulo) } : null,
  };
}

/** Quadro de etapas: com lista de tarefas o título é texto livre e vira "Etapa N"; a fase por papel ("Testes") fica. */
export function mascararProgress(progress: Progress | null): Progress | null {
  if (!progress || progress.fonte !== "tarefas") return progress;
  return { ...progress, titulo: `Etapa ${progress.etapa}` };
}
