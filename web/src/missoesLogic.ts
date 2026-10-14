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
