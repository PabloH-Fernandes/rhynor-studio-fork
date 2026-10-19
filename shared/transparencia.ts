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

export interface ResumoTransparencia {
  /** AAAA-MM */
  mes: string;
  total: number;
  normais: number;
  informativos: number;
  violacoes: number;
  /** as mais recentes, da mais antiga para a mais nova */
  recentes: RegistroTransparencia[];
}

export const MAX_RECENTES = 20;

export const NOTA_LIMITE =
  "Só registra o que chegou do Claude Code ao servidor; leituras feitas por comandos de shell (cat, type) não são vistas.";
export const TEXTO_VIOLACAO = "ATENÇÃO: um agente leu uma nota confidencial";
export const TEXTO_INFORMATIVO = "Esperado: a reunião (/reuniao) abriu a ata do Inbox";

export function resumoVazio(mes: string): ResumoTransparencia {
  return { mes, total: 0, normais: 0, informativos: 0, violacoes: 0, recentes: [] };
}
