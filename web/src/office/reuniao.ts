// Quem vai pra onde numa reunião (/reuniao): função pura, sem canvas. O motor chama a cada quadro
// com o que já tinha atribuído, então a escolha é estável: ninguém troca de lugar à toa.

import type { AgentStatus } from "../../../shared/types";

/** o que a atribuição precisa saber de cada personagem visível */
export interface CandidatoReuniao {
  id: string;
  status: AgentStatus;
  visitante: boolean;
  /** já está indo embora (porta) */
  saindo: boolean;
}

/**
 * - o líder da reunião apresenta (qualquer status, menos esperando uma permissão: quem espera
 *   fica na mesa) e é o único no `apresenta`;
 * - os demais só entram se estiverem ociosos, forem do time e não estiverem saindo;
 * - quem estava num lugar e continua elegível mantém o lugar; quem entra pega o primeiro livre;
 * - quem não couber (ou não for elegível) não aparece no resultado: fica na própria mesa;
 * - `donos` (lugar → id): lugar já reservado por alguém (casa de quem mora em pé ou descanso na
 *   maquete) só serve pra esse alguém; os outros pulam.
 *
 * Devolve id → id do lugar (`apresenta` ou um dos `lugares`).
 */
export function atribuirReuniao(
  liderId: string,
  candidatos: readonly CandidatoReuniao[],
  anterior: ReadonlyMap<string, string>,
  apresenta: string,
  lugares: readonly string[],
  donos: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
  const out = new Map<string, string>();
  const usados = new Set<string>();
  const valido = new Set(lugares);
  const serve = (lugar: string, id: string) => !usados.has(lugar) && (donos.get(lugar) ?? id) === id;

  const elegivel = (c: CandidatoReuniao): boolean => {
    if (c.saindo) return false;
    if (c.id === liderId) return c.status !== "esperando";
    return c.status === "ocioso" && !c.visitante;
  };
  const elegiveis = candidatos.filter(elegivel);

  const lider = elegiveis.find((c) => c.id === liderId);
  if (lider) {
    out.set(lider.id, apresenta);
    usados.add(apresenta);
  }
  // quem já tinha lugar e continua elegível o mantém
  for (const c of elegiveis) {
    if (c.id === liderId) continue;
    const antes = anterior.get(c.id);
    if (antes && valido.has(antes) && serve(antes, c.id)) {
      out.set(c.id, antes);
      usados.add(antes);
    }
  }
  // quem entra agora ocupa os livres, na ordem dos lugares
  for (const c of elegiveis) {
    if (c.id === liderId || out.has(c.id)) continue;
    const livre = lugares.find((l) => serve(l, c.id));
    if (!livre) continue;
    out.set(c.id, livre);
    usados.add(livre);
  }
  return out;
}
