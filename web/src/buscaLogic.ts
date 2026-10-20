// Lógica pura da busca no cérebro (sem React): validação da pergunta, textos em português simples,
// leitura segura da resposta do servidor e o comando "/memoria" para copiar. Nada aqui roda o Claude.

import type { BuscaItem } from "../../shared/types";

export const MIN_LETRAS = 2;
export const MAX_BUSCA = 80;
export const DEBOUNCE_BUSCA_MS = 300;
/** tamanho máximo da pergunta que vai no comando /memoria */
export const MAX_PERGUNTA = 200;

export const TEXTO_CADEADO = "Nota confidencial: só o título aparece";
export const TEXTO_DICA = "Escreva pelo menos 2 letras para buscar.";
export const TEXTO_VAZIO = "Não achei nenhuma nota com isso. Tente outras palavras.";
export const TEXTO_SEM_CEREBRO = "Não encontrei a pasta de notas. Confira o caminho do cérebro nas configurações.";

/** a busca só roda com pelo menos 2 letras (depois de tirar os espaços das pontas); null = não busca */
export function consultaDe(bruto: string): string | null {
  const t = bruto.trim().replace(/\s+/g, " ");
  if (t.length < MIN_LETRAS) return null;
  return t.slice(0, MAX_BUSCA);
}

export function urlBusca(q: string): string {
  return `/api/busca?q=${encodeURIComponent(q)}`;
}

/** só abre link do Obsidian: qualquer outra coisa não vira href */
export function ehUriObsidian(uri: unknown): uri is string {
  return typeof uri === "string" && uri.startsWith("obsidian://open?");
}

function textoComum(s: string): string {
  // tira quebras de linha e caracteres de controle (U+0000 a U+001F e U+007F a U+009F) e junta os espaços
  return s.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
}

/** o comando para copiar: `/memoria <pergunta>` em uma linha só e com no máximo ~200 caracteres de pergunta */
export function comandoPergunta(pergunta: string): string {
  return `/memoria ${textoComum(pergunta).slice(0, MAX_PERGUNTA).trim()}`;
}

export const TEXTO_MONTANDO = "Montando o índice das notas... um instante.";
export const RETENTAR_MONTANDO_MS = 1000;

export function textoContagem(mostrados: number, total: number, maisResultados = false): string {
  if (total === 0) return TEXTO_VAZIO;
  if (maisResultados) return `Mostrando ${mostrados}; refine a busca.`;
  if (total === 1) return "1 nota encontrada.";
  if (total > mostrados) return `${total} notas encontradas. Mostrando as ${mostrados} primeiras.`;
  return `${total} notas encontradas.`;
}

export function textoErroBusca(status: number | null): string {
  if (status === null) return "Sem conexão com o servidor. Tente de novo.";
  if (status === 400) return "Essa busca não vale. Use de 2 a 80 caracteres.";
  if (status === 403) return "O servidor não aceitou o pedido. Abra o painel pelo endereço do próprio servidor.";
  return "A busca não funcionou agora. Tente de novo.";
}

export interface RespostaBuscaLida {
  itens: BuscaItem[];
  total: number;
  semVault: boolean;
  maisResultados: boolean;
  /** o índice ainda está sendo montado: tente de novo */
  montando: boolean;
}

/** lê a resposta sem confiar nela: descarta item torto e nunca deixa passar trecho de nota confidencial */
export function lerRespostaBusca(json: unknown): RespostaBuscaLida | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.itens)) return null;
  const itens: BuscaItem[] = [];
  for (const bruto of o.itens) {
    if (typeof bruto !== "object" || bruto === null) continue;
    const i = bruto as Record<string, unknown>;
    if (typeof i.titulo !== "string" || typeof i.rel !== "string" || typeof i.uri !== "string") continue;
    const confidencial = i.confidencial === true;
    const trecho = !confidencial && typeof i.trecho === "string" && i.trecho ? i.trecho : undefined;
    itens.push({ titulo: i.titulo, rel: i.rel, confidencial, uri: i.uri, ...(trecho ? { trecho } : {}) });
  }
  const total = typeof o.total === "number" && Number.isFinite(o.total) ? Math.max(o.total, itens.length) : itens.length;
  return { itens, total, semVault: o.semVault === true, maisResultados: o.maisResultados === true, montando: o.montando === true };
}
