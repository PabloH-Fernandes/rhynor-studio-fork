// Textos e regras da Caixa de entrada do painel (lógica pura, sem React).

import { dataBr, ehDataValida } from "../../shared/datas";
import type { CaixaAcao, CaixaAprovacao, CaixaItem, CaixaTarefa } from "../../shared/types";

/** a escolha de cada tarefa (número da tarefa → ação); tarefa sem chave ainda não foi escolhida */
export type Escolhas = Readonly<Record<number, CaixaAcao | undefined>>;

/** ícone (decorativo) e rótulo de cada ação: a escolha sempre aparece em texto, nunca só por cor */
export const ACOES_CAIXA: readonly { acao: CaixaAcao; icone: string; rotulo: string }[] = [
  { acao: "time", icone: "🤖", rotulo: "Time faz" },
  { acao: "eu", icone: "🙋", rotulo: "Eu faço" },
  { acao: "ignorar", icone: "🗑️", rotulo: "Ignorar" },
];

export function rotuloDaAcao(acao: CaixaAcao): string {
  return ACOES_CAIXA.find((a) => a.acao === acao)?.rotulo ?? acao;
}

/** "prazo 31/10/2026" ou "sem prazo" */
export function textoPrazo(prazo: string): string {
  return ehDataValida(prazo) ? `prazo ${dataBr(prazo.trim())}` : "sem prazo";
}

/** "Responsável A" ou "sem responsável" */
export function textoResponsavel(t: Pick<CaixaTarefa, "responsavel">): string {
  const r = t.responsavel.trim();
  return r ? r : "sem responsável";
}

/** a data da reunião em dd/mm/aaaa; vazio se não houver */
export function textoDataReuniao(data: string): string {
  return ehDataValida(data) ? dataBr(data.trim()) : "";
}

export function semTarefas(item: Pick<CaixaItem, "tarefas">): boolean {
  return item.tarefas.length === 0;
}

/** quantas tarefas da reunião já têm escolha */
export function escolhidas(item: Pick<CaixaItem, "tarefas">, escolhas: Escolhas): number {
  return item.tarefas.filter((t) => escolhas[t.n] !== undefined).length;
}

/** Aprovar só vale com todas as tarefas escolhidas (reunião sem tarefas usa "Arquivar") */
export function todasEscolhidas(item: Pick<CaixaItem, "tarefas">, escolhas: Escolhas): boolean {
  return item.tarefas.length > 0 && escolhidas(item, escolhas) === item.tarefas.length;
}

/** "2 de 4 tarefas escolhidas" (singular com 1) */
export function textoProgresso(item: Pick<CaixaItem, "tarefas">, escolhas: Escolhas): string {
  const total = item.tarefas.length;
  return `${escolhidas(item, escolhas)} de ${total} ${total === 1 ? "tarefa escolhida" : "tarefas escolhidas"}`;
}

/** O que o botão de aprovar diz: orienta quando ainda falta escolher */
export function rotuloAprovar(item: Pick<CaixaItem, "tarefas">, escolhas: Escolhas): string {
  if (semTarefas(item)) return "Arquivar";
  return todasEscolhidas(item, escolhas) ? "Aprovar" : "Aprovar (escolha todas)";
}

/** o corpo do POST; null se ainda falta escolher */
export function montarAprovacao(item: CaixaItem, escolhas: Escolhas): CaixaAprovacao | null {
  if (semTarefas(item)) return { reuniao: item.id, decisoes: [] };
  if (!todasEscolhidas(item, escolhas)) return null;
  return { reuniao: item.id, decisoes: item.tarefas.map((t) => ({ n: t.n, acao: escolhas[t.n] as CaixaAcao, ...(t.h ? { h: t.h } : {}) })) };
}

/** quantas ficaram em cada ação, para o resumo depois de aprovar */
export function contarAcoes(item: Pick<CaixaItem, "tarefas">, escolhas: Escolhas): Record<CaixaAcao, number> {
  const out: Record<CaixaAcao, number> = { time: 0, eu: 0, ignorar: 0 };
  for (const t of item.tarefas) {
    const a = escolhas[t.n];
    if (a) out[a]++;
  }
  return out;
}

/** "2 para o time, 1 para você, 1 ignorada"; vazio quando não havia tarefa */
export function resumoDecisao(c: Record<CaixaAcao, number>): string {
  const partes: string[] = [];
  if (c.time > 0) partes.push(`${c.time} para o time`);
  if (c.eu > 0) partes.push(`${c.eu} para você`);
  if (c.ignorar > 0) partes.push(c.ignorar === 1 ? "1 ignorada" : `${c.ignorar} ignoradas`);
  return partes.join(", ");
}

/** aviso quando a reunião tinha mais tarefas em aberto do que o painel mostra */
export const AVISO_TRUNCADA = "Mostrando as 40 primeiras tarefas; as demais ficam na nota";

/** mensagem em português para uma resposta de erro do servidor (no 409 vale o texto do servidor: "já aprovada" ou "a nota mudou") */
export function textoErroAprovacao(status: number, mensagem?: string): string {
  switch (status) {
    case 400:
      return "Algo não bateu: atualize a página e tente de novo.";
    case 403:
    case 415:
      return "O servidor recusou o pedido. Abra o painel pelo endereço do próprio servidor.";
    case 404:
      return "Não achei essa reunião no vault. Ela pode ter sido movida.";
    case 409:
      return mensagem ? `${mensagem}.` : "Essa reunião já foi aprovada.";
    case 503:
      return "O vault não está configurado: rode npm run setup.";
    default:
      return "Não consegui salvar a aprovação. Tente de novo.";
  }
}

export interface CopiaDeps {
  clipboard?: { writeText(texto: string): Promise<void> } | null;
  /** plano B quando a área de transferência moderna não está disponível (página sem https, por exemplo) */
  fallback?: (texto: string) => boolean;
}

/** Copia o texto. true = copiou. Tenta navigator.clipboard e, se falhar, o plano B. */
export async function copiarTexto(texto: string, deps: CopiaDeps = {}): Promise<boolean> {
  const clipboard = deps.clipboard === undefined ? (typeof navigator !== "undefined" ? navigator.clipboard : null) : deps.clipboard;
  if (clipboard) {
    try {
      await clipboard.writeText(texto);
      return true;
    } catch {
      // bloqueado pelo navegador: tenta o plano B
    }
  }
  try {
    return (deps.fallback ?? copiarComTextarea)(texto);
  } catch {
    return false;
  }
}

/** plano B no navegador: textarea escondido + execCommand("copy") */
function copiarComTextarea(texto: string): boolean {
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = texto;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}
