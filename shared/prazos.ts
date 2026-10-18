// Urgência de um prazo (AAAA-MM-DD) em relação a hoje. Pura: o mesmo cálculo no servidor e no painel.
// "Dia" aqui é o dia local de quem usa (diaLocal em datas.ts), sem hora: prazo de hoje não está atrasado.

import { ehDataValida } from "./datas.ts";

export type Urgencia = "atrasada" | "logo" | "sem-prazo" | "no-prazo";

/** quantos dias à frente de hoje ainda contam como "vence em breve" (hoje, amanhã e depois de amanhã) */
export const DIAS_LOGO = 2;

/** soma dias a um AAAA-MM-DD válido (em UTC, só para o calendário: vira o mês e o ano, respeita 29/02) */
export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.trim().split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${String(t.getUTCFullYear()).padStart(4, "0")}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`;
}

/**
 * atrasada (prazo antes de hoje) | logo (de hoje até hoje + 2 dias) | no-prazo (mais longe) |
 * sem-prazo (vazio ou data inválida, e também quando `hoje` não é uma data válida).
 */
export function urgenciaDe(prazo: string, hoje: string): Urgencia {
  if (!ehDataValida(prazo) || !ehDataValida(hoje)) return "sem-prazo";
  const p = prazo.trim();
  const h = hoje.trim();
  if (p < h) return "atrasada";
  if (p <= somarDias(h, DIAS_LOGO)) return "logo";
  return "no-prazo";
}
