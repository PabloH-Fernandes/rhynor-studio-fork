// Animação de "ata nova": quando o servidor lê uma ata, o painel monta uma reunião local de poucos segundos
// (os Personagens livres sentam na mesa, um deles apresenta) sem mexer no motor do escritório: é só uma
// ReuniaoAtiva local passada ao OfficeCanvas. Função pura, sem canvas.

import type { AgentStatus, ReuniaoAtiva } from "../../../shared/types";
import { ehVisitante } from "../../../shared/visitante";

/** quanto tempo a reunião da ata dura na tela */
export const ATA_JANELA_MS = 12_000;

/** o que o quadro da parede mostra durante a janela: sem título da reunião (privacidade) */
export const QUADRO_ATA = "Nova ata";

/** o que a escolha precisa saber de cada agente (o Agent serve) */
export interface CandidatoLiderAta {
  id: string;
  role: string;
  parentId?: string;
  status: AgentStatus;
  startedAt: number;
}

/**
 * Quem apresenta a ata: o líder (a sessão principal) se estiver livre para isso; senão o Personagem do time
 * mais antigo no escritório. Quem espera uma permissão ("te esperando"), quem está saindo e visitante
 * não apresentam. Sem ninguém elegível devolve null (não há reunião).
 */
export function escolherLiderDeAta(agents: readonly CandidatoLiderAta[]): string | null {
  const elegiveis = agents.filter((a) => a.status !== "esperando" && a.status !== "saindo" && !ehVisitante(a));
  if (elegiveis.length === 0) return null;
  const maisAntigo = (lista: readonly CandidatoLiderAta[]) => lista.reduce((a, b) => (b.startedAt < a.startedAt || (b.startedAt === a.startedAt && b.id < a.id) ? b : a));
  const lideres = elegiveis.filter((a) => !a.parentId);
  return maisAntigo(lideres.length > 0 ? lideres : elegiveis).id;
}

/** A reunião local da ata, ou null se não dá para montar (sem líder possível). */
export function reuniaoDeAta(agents: readonly CandidatoLiderAta[], agora: number): ReuniaoAtiva | null {
  const liderId = escolherLiderDeAta(agents);
  return liderId ? { sessionId: "ata-nova", liderId, desde: agora } : null;
}
