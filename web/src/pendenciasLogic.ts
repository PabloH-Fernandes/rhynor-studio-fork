// Textos e regras da seção "Pendências" do painel (lógica pura, sem React).
// A urgência é recalculada aqui com o dia do navegador: o servidor manda a dele, mas a virada do dia
// não deve esperar a próxima leitura do vault.

import { diaLocal } from "../../shared/datas";
import { urgenciaDe, type Urgencia } from "../../shared/prazos";
import type { Pendencia } from "../../shared/types";

export type FiltroPendencias = "minhas" | "time" | "atrasadas";

/** rótulo de cada filtro: o nome do botão e a frase quando não sobra nada */
export const FILTROS_PENDENCIAS: readonly { filtro: FiltroPendencias; rotulo: string; vazio: string }[] = [
  { filtro: "minhas", rotulo: "Minhas", vazio: "Nenhuma pendência sua." },
  { filtro: "time", rotulo: "Do time", vazio: "Nenhuma pendência do time." },
  { filtro: "atrasadas", rotulo: "Atrasadas", vazio: "Nada atrasado." },
];

export function filtroValido(texto: string): FiltroPendencias {
  return texto === "time" || texto === "atrasadas" ? texto : "minhas";
}

/** ícone (decorativo) e frase de cada urgência: o status sempre aparece em texto, nunca só por cor */
export const URGENCIAS: Readonly<Record<Urgencia, { icone: string; texto: string }>> = {
  atrasada: { icone: "🔴", texto: "Atrasada" },
  logo: { icone: "🟠", texto: "Vence em até 2 dias" },
  "no-prazo": { icone: "🟢", texto: "No prazo" },
  "sem-prazo": { icone: "⚪", texto: "Sem prazo" },
};

const PESO: Readonly<Record<Urgencia, number>> = { atrasada: 0, logo: 1, "no-prazo": 2, "sem-prazo": 3 };

/** a pendência com a urgência do dia `hoje` (AAAA-MM-DD local) */
export function comUrgencia(itens: readonly Pendencia[], hoje: string): Pendencia[] {
  return itens.map((p) => ({ ...p, urgencia: urgenciaDe(p.prazo, hoje) }));
}

/** atrasadas primeiro, depois as que vencem logo, as no prazo (pelo prazo) e as sem prazo */
export function ordenarPendencias(itens: readonly Pendencia[]): Pendencia[] {
  return [...itens].sort(
    (a, b) => PESO[a.urgencia] - PESO[b.urgencia] || (a.prazo < b.prazo ? -1 : a.prazo > b.prazo ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** o que cada filtro mostra: Minhas = dono eu; Do time = dono time; Atrasadas = de qualquer dono */
export function filtrarPendencias(itens: readonly Pendencia[], filtro: FiltroPendencias): Pendencia[] {
  switch (filtro) {
    case "minhas":
      return itens.filter((p) => p.dono === "eu");
    case "time":
      return itens.filter((p) => p.dono === "time");
    case "atrasadas":
      return itens.filter((p) => p.urgencia === "atrasada");
  }
}

export interface ContagemPendencias {
  minhas: number;
  time: number;
  atrasadas: number;
  total: number;
}

export function contarPendencias(itens: readonly Pendencia[]): ContagemPendencias {
  let minhas = 0;
  let time = 0;
  let atrasadas = 0;
  for (const p of itens) {
    if (p.dono === "eu") minhas++;
    else time++;
    if (p.urgencia === "atrasada") atrasadas++;
  }
  return { minhas, time, atrasadas, total: itens.length };
}

/** o dia local de hoje (AAAA-MM-DD) */
export function hojeLocal(agora: number = Date.now()): string {
  return diaLocal(agora);
}

/** dono em texto: sempre escrito, o ícone é só enfeite */
export function textoDono(dono: Pendencia["dono"]): { icone: string; texto: string } {
  return dono === "eu" ? { icone: "🙋", texto: "Com você" } : { icone: "🤖", texto: "Com o time" };
}

/** "Em andamento" só quando a missão já está rodando; vazio quando é "a fazer" (o padrão) */
export function textoEstado(status: Pendencia["status"]): string {
  return status === "em andamento" ? "Em andamento" : "A fazer";
}

/** nome do botão de concluir para quem usa leitor de tela */
export function rotuloConcluir(p: Pick<Pendencia, "texto" | "origem">): string {
  return `Concluir: ${p.texto} (de ${p.origem})`;
}

/**
 * Depois de concluir `id`, quem recebe o foco: o próximo da lista (ou o anterior, se era o último).
 * null quando não sobra ninguém (o foco vai para o título da seção).
 */
export function proximoFoco(ids: readonly string[], concluido: string): string | null {
  const i = ids.indexOf(concluido);
  if (i < 0) return null;
  return ids[i + 1] ?? ids[i - 1] ?? null;
}

/** frase de resumo da seção: "3 pendências, 1 atrasada" */
export function resumoPendencias(c: ContagemPendencias): string {
  if (c.total === 0) return "nenhuma pendência";
  const base = `${c.total} ${c.total === 1 ? "pendência" : "pendências"}`;
  if (c.atrasadas === 0) return base;
  return `${base}, ${c.atrasadas} ${c.atrasadas === 1 ? "atrasada" : "atrasadas"}`;
}

/** mensagem em português para uma resposta de erro do servidor ao concluir */
export function textoErroConclusao(status: number): string {
  switch (status) {
    case 400:
      return "Algo não bateu: atualize a página e tente de novo.";
    case 403:
    case 415:
      return "O servidor recusou o pedido. Abra o painel pelo endereço do próprio servidor.";
    case 404:
      return "Não achei essa nota no vault. Ela pode ter sido movida.";
    case 409:
      return "A nota mudou. A lista já foi atualizada: confira e tente de novo.";
    case 503:
      return "O vault não está configurado: rode npm run setup.";
    default:
      return "Não consegui salvar. Tente de novo.";
  }
}
