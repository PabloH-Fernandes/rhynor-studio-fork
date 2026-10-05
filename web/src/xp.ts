// "XP" do crachá: as entregas do dia viram nível de personagem (a cada 10 entregas, sobe um nível).
// Sem tom de ranking: antes da 10ª entrega não existe "Nível 0", só a barra rumo ao Nível 1.

/** entregas por nível: é também o número de segmentos da barrinha */
export const XP_POR_NIVEL = 10;

export interface Xp {
  /** níveis completos: 0 até a 10ª entrega (aí o crachá não mostra nível nenhum) */
  nivel: number;
  /** entregas dentro do nível atual (0 a XP_POR_NIVEL - 1) */
  noNivel: number;
  /** quanto falta pro próximo nível */
  faltam: number;
  total: number;
}

export function xpDasEntregas(entregas: number): Xp {
  const total = Math.max(0, Math.floor(Number.isFinite(entregas) ? entregas : 0));
  const noNivel = total % XP_POR_NIVEL;
  return { nivel: Math.floor(total / XP_POR_NIVEL), noNivel, faltam: XP_POR_NIVEL - noNivel, total };
}

/** "3 entregas hoje, faltam 7 pro Nível 1" (singular e plural certos) */
export function legendaXp({ total, faltam, nivel }: Xp): string {
  const hoje = total === 1 ? "1 entrega hoje" : `${total} entregas hoje`;
  return `${hoje}, ${faltam === 1 ? "falta 1" : `faltam ${faltam}`} pro Nível ${nivel + 1}`;
}
