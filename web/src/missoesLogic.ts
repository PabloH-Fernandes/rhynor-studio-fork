// Textos e regras do painel de missões (lógica pura, sem React).

import type { Missao, MissaoStatus, MissoesInfo } from "../../shared/types";

/** ícone (texto, decorativo) e rótulo de cada status: o status nunca depende só da cor */
export const STATUS_MISSAO: Record<MissaoStatus, { rotulo: string; icone: string; classe: string }> = {
  "a fazer": { rotulo: "a fazer", icone: "○", classe: "afazer" },
  "em andamento": { rotulo: "em andamento", icone: "▶", classe: "andamento" },
  "concluída": { rotulo: "concluída", icone: "✓", classe: "concluida" },
};

/** "2 de 5 tarefas feitas" (singular com 1 tarefa) */
export function textoTarefas(feitas: number, total: number): string {
  return `${feitas} de ${total} ${total === 1 ? "tarefa feita" : "tarefas feitas"}`;
}

/** "📋 da reunião X": só missão que nasceu de reunião e tem título */
export function textoReuniao(m: Pick<Missao, "origem" | "reuniaoTitulo">): string | null {
  if (m.origem !== "reuniao") return null;
  const t = m.reuniaoTitulo.trim();
  return t ? `📋 da reunião ${t}` : null;
}

/** aviso do Inbox; null quando não há ata nova */
export function textoAtaNova(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n === 1 ? "📥 Chegou uma ata nova: rode /reuniao" : `📥 Chegaram ${n} atas novas: rode /reuniao`;
}

export type VazioMissoes = "sem-vault" | "sem-missao" | null;

/** qual mensagem de "nada aqui" mostrar (null = tem missão para listar) */
export function vazioDe(info: MissoesInfo | null): VazioMissoes {
  if (!info) return null; // ainda carregando
  if (info.vault === "sem-vault") return "sem-vault";
  if (info.missoes.length === 0) return "sem-missao";
  return null;
}

export function ehAtual(info: MissoesInfo | null, m: Pick<Missao, "id">): boolean {
  return info?.atual?.id === m.id;
}

/** as abas só aparecem com pelo menos 1 missão (carregando, sem vault, sem pasta ou vazio: não) */
export function mostraAbas(info: MissoesInfo | null): boolean {
  return info !== null && vazioDe(info) === null;
}

/** abas da seção: abertas (a fazer + em andamento) e concluídas */
export type AbaMissoes = "abertas" | "concluidas";
export const ABAS_MISSOES: readonly AbaMissoes[] = ["abertas", "concluidas"];

/** valor salvo no navegador → aba conhecida (qualquer outra coisa volta para "abertas") */
export function abaValida(salva: string): AbaMissoes {
  return (ABAS_MISSOES as readonly string[]).includes(salva) ? (salva as AbaMissoes) : "abertas";
}

/** separa por status, mantendo a ordem que veio do servidor */
export function separarMissoes<T extends Pick<Missao, "status">>(missoes: readonly T[]): { abertas: T[]; concluidas: T[] } {
  const abertas: T[] = [];
  const concluidas: T[] = [];
  for (const m of missoes) (m.status === "concluída" ? concluidas : abertas).push(m);
  return { abertas, concluidas };
}

/** texto de aba vazia (null = a aba tem missão) */
export function vazioDaAba(aba: AbaMissoes, separadas: { abertas: readonly unknown[]; concluidas: readonly unknown[] }): string | null {
  if (aba === "concluidas") return separadas.concluidas.length === 0 ? "Nenhuma missão concluída ainda." : null;
  return separadas.abertas.length === 0 ? "Nenhuma missão aberta. As concluídas estão na outra aba." : null;
}

/** navegação das abas pelo teclado (circular); null = tecla que não mexe na aba */
export function abaPelaTecla(atual: AbaMissoes, tecla: string): AbaMissoes | null {
  const i = ABAS_MISSOES.indexOf(atual);
  const n = ABAS_MISSOES.length;
  switch (tecla) {
    case "ArrowRight":
      return ABAS_MISSOES[(i + 1) % n];
    case "ArrowLeft":
      return ABAS_MISSOES[(i - 1 + n) % n];
    case "Home":
      return ABAS_MISSOES[0];
    case "End":
      return ABAS_MISSOES[n - 1];
    default:
      return null;
  }
}

const dois = (n: number) => String(n).padStart(2, "0");

/**
 * "dd/mm/aaaa" da nota: a data do frontmatter (AAAA-MM-DD, lida como texto para não cair no dia
 * anterior pelo fuso) e, sem ela, a data local de atualizadoEm. null quando não há nenhuma.
 */
export function textoDataMissao(m: Pick<Missao, "data" | "atualizadoEm">): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(m.data.trim());
  if (iso) {
    const [ano, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    // confere de volta em UTC (só para validar: 2026-02-31 vira março e é recusada)
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31 && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia) {
      return `${iso[3]}/${iso[2]}/${iso[1]}`;
    }
  }
  if (!Number.isFinite(m.atualizadoEm) || m.atualizadoEm <= 0) return null;
  const d = new Date(m.atualizadoEm);
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** totais antes do corte do servidor; servidor antigo (sem totais) cai no tamanho das listas */
export function totaisDe(
  info: Pick<MissoesInfo, "totais"> | null,
  separadas: { abertas: readonly unknown[]; concluidas: readonly unknown[] },
): { abertas: number; concluidas: number } {
  return {
    abertas: Math.max(info?.totais?.abertas ?? 0, separadas.abertas.length),
    concluidas: Math.max(info?.totais?.concluidas ?? 0, separadas.concluidas.length),
  };
}

/** aviso abaixo da lista quando o servidor cortou (total maior que o mostrado); senão null */
export function textoLimiteConcluidas(mostradas: number, total: number): string | null {
  if (!Number.isFinite(total) || total <= mostradas) return null;
  return `Mostrando as ${mostradas} mais recentes de ${total}`;
}
