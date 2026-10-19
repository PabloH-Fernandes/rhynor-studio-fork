// Transparência: o que os agentes abriram no vault, segundo os hooks do Claude Code. Tipos e textos compartilhados
// entre servidor e painel. NUNCA leva conteúdo de arquivo, só o caminho (relativo ao vault) e o que foi feito.

export type Nivel = "normal" | "informativo" | "violacao";
export type Acao = "leu" | "escreveu" | "editou" | "buscou";

/** Uma linha do log (data/transparencia/AAAA-MM.jsonl). Só estes campos. */
export interface RegistroTransparencia {
  /** instante do evento (ms desde 1970) */
  ts: number;
  sessao: string;
  /** tipo do subagente (dev, revisor...) ou "lider" */
  agente: string;
  ferramenta: string;
  acao: Acao;
  /** relativo ao vault, com "/" ("." = a raiz) */
  arquivo: string;
  confidencial: boolean;
  /** id da missão pedida por /time nessa sessão (nome da nota) ou null */
  missao: string | null;
  /** de onde veio o registro */
  via: "PreToolUse";
  nivel: Nivel;
}

export const CAMPOS_REGISTRO = ["ts", "sessao", "agente", "ferramenta", "acao", "arquivo", "confidencial", "missao", "via", "nivel"] as const;

/** Os avisos de nível 'informativo', cada um com texto próprio (derivados do registro: ação, arquivo e nível). */
export type TipoInformativo = "reuniao-ata" | "reuniao-nota" | "busca-raiz" | "alteracao";
export const TIPOS_INFORMATIVO: readonly TipoInformativo[] = ["reuniao-ata", "reuniao-nota", "busca-raiz", "alteracao"];

export type ContagemPorTipo = Record<TipoInformativo, number>;
export const semTipos = (): ContagemPorTipo => ({ "reuniao-ata": 0, "reuniao-nota": 0, "busca-raiz": 0, alteracao: 0 });

/** Qual aviso informativo é este registro (null = não é informativo). */
export function tipoInformativo(r: Pick<RegistroTransparencia, "nivel" | "acao" | "arquivo">): TipoInformativo | null {
  if (r.nivel !== "informativo") return null;
  if (r.acao === "buscou") return "busca-raiz";
  if (r.acao === "escreveu" || r.acao === "editou") return "alteracao";
  return r.arquivo.toLowerCase().startsWith("00-inbox/") ? "reuniao-ata" : "reuniao-nota";
}

export interface ResumoTransparencia {
  /** AAAA-MM */
  mes: string;
  total: number;
  normais: number;
  informativos: number;
  /** o mesmo total de `informativos`, por tipo de aviso */
  informativosPor: ContagemPorTipo;
  violacoes: number;
  /** a violação mais recente do mês (mesmo que já tenha saído da lista curta), ou null */
  ultimaViolacao: { ts: number; arquivo: string } | null;
  /** até MAX_VIOLACOES violações do mês, da mais antiga para a mais nova (ficam visíveis fora da janela de `recentes`) */
  violacoesRecentes: RegistroTransparencia[];
  /** atas processadas NESTE MÊS (a mesma conta do GET e do export); null = ainda não calculado */
  atas: { semIa: number; comIa: number } | null;
  /** as mais recentes, da mais antiga para a mais nova */
  recentes: RegistroTransparencia[];
}

export const MAX_RECENTES = 20;
export const MAX_VIOLACOES = 5;

export const NOTA_LIMITE =
  "Só registra o que chegou do Claude Code ao servidor; leituras feitas por comandos de shell (cat, type) não são vistas.";
export const NOTA_PERMISSAO =
  "O registro é feito antes de o Claude Code pedir ou negar a permissão: uma leitura negada também aparece aqui, então \"abriu\" pode ser só uma tentativa.";
export const TEXTO_VIOLACAO = "ATENÇÃO: um agente leu uma nota confidencial";
export const TEXTO_INFORMATIVO = "Esperado: a reunião (/reuniao) abriu a ata do Inbox";
export const TEXTOS_INFORMATIVO: Record<TipoInformativo, string> = {
  "reuniao-ata": TEXTO_INFORMATIVO,
  "reuniao-nota": "Esperado: a reunião abriu uma nota confidencial",
  "busca-raiz": "Aviso: busca na raiz do vault pode alcançar notas confidenciais",
  alteracao: "Aviso: um agente alterou uma nota em pasta confidencial",
};
/** a palavra da marca de cada linha informativa */
export const MARCA_INFORMATIVO: Record<TipoInformativo, string> = {
  "reuniao-ata": "Esperado",
  "reuniao-nota": "Esperado",
  "busca-raiz": "Aviso",
  alteracao: "Aviso",
};

export function resumoVazio(mes: string): ResumoTransparencia {
  return {
    mes,
    total: 0,
    normais: 0,
    informativos: 0,
    informativosPor: semTipos(),
    violacoes: 0,
    ultimaViolacao: null,
    violacoesRecentes: [],
    atas: null,
    recentes: [],
  };
}
