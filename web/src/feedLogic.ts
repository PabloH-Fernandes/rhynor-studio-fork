// Lógica pura do feed "O que tá rolando": junta repetições e decide o destaque.
// As frases em si vêm prontas do servidor (server/frases.ts).

import type { FeedCategoria, FeedItem } from "../../shared/types";
import { fraseAgrupada, fraseGenerica } from "../../shared/frases";

/** linhas do mesmo AGzinho e assunto só se juntam se a anterior for recente */
export const JANELA_AGRUPAR_MS = 10 * 60_000;

export interface LinhaFeed {
  /** item mais recente do grupo (hora, id e frase) */
  item: FeedItem;
  /** quantas linhas foram juntadas */
  n: number;
  /** o grupo juntou frases diferentes ("sobre X" + "sobre Y"): mostra a do assunto, sem detalhe */
  variou?: boolean;
}

/**
 * Junta, em ordem cronológica, as linhas seguidas do mesmo AGzinho com o mesmo assunto
 * ("Marina está estudando o projeto (12 arquivos)"). "Seguidas" é na história de cada AGzinho:
 * outro AGzinho trabalhando em paralelo não quebra o grupo. O grupo sobe pro fim (mais recente).
 * Só junta o que tem `contaComo` (ações repetitivas); destaques e o feed antigo nunca se juntam.
 */
export function agruparFeed(items: readonly FeedItem[], janelaMs = JANELA_AGRUPAR_MS): LinhaFeed[] {
  const linhas: LinhaFeed[] = [];
  const ultima = new Map<string, LinhaFeed>();
  for (const item of items) {
    const ant = ultima.get(item.agentId);
    if (ant && item.contaComo && ant.item.contaComo && ant.item.categoria === item.categoria && item.at - ant.item.at <= janelaMs) {
      if (item.simples !== ant.item.simples) ant.variou = true;
      ant.item = item;
      ant.n += 1;
      linhas.splice(linhas.indexOf(ant), 1);
      linhas.push(ant);
      continue;
    }
    const nova = { item, n: 1 };
    linhas.push(nova);
    ultima.set(item.agentId, nova);
  }
  return linhas;
}

/** o que merece destaque (cor + ícone + negrito) */
export type Destaque = "precisa" | "etapa" | "concluido" | "terminou";

export function destaqueDe(c: FeedCategoria | undefined): Destaque | undefined {
  return c === "precisa" || c === "etapa" || c === "concluido" || c === "terminou" ? c : undefined;
}

const ICONE: Record<FeedCategoria, string> = {
  estudo: "📖",
  busca: "🔎",
  mudanca: "✏️",
  teste: "🧪",
  comando: "⚙️",
  internet: "🌐",
  tarefas: "📋",
  recado: "💬",
  ferramenta: "🧰",
  chegada: "👋",
  pedido: "📝",
  precisa: "🙋",
  erro: "⚠️",
  info: "•",
  terminou: "✅",
  etapa: "🏁",
  concluido: "🎉",
  saiu: "🚪",
};

export function iconeDe(c: FeedCategoria | undefined): string {
  return c ? ICONE[c] : "•";
}

/** Frase simples da linha (sem o nome); null no feed salvo antigo, que só tem a versão técnica. */
export function fraseDaLinha(l: LinhaFeed): string | null {
  const { simples, categoria, contaComo } = l.item;
  if (!simples) return null;
  return fraseAgrupada(l.variou ? fraseGenerica(categoria, simples) : simples, l.n, contaComo);
}
