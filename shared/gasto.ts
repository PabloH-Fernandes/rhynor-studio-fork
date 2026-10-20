// Gasto de tokens lido do registro do Claude Code (transcript). Tipos e textos compartilhados entre servidor e painel.
// São só números: nada do conteúdo das conversas passa por aqui. NÃO é custo em dinheiro.

export interface GastoValores {
  /** input + output + cache_creation */
  tokens: number;
  /** cache_read, à parte */
  cacheLeitura: number;
}

export interface GastoHoje {
  total: GastoValores;
  /** papel (lider, dev, testador...) → tokens de hoje */
  porPapel: Record<string, GastoValores>;
}

export const ROTULO_GASTO = "tokens lidos do registro do Claude (não é custo)";

/** sem dado → "—" (nunca 0 nem estimativa) */
export const SEM_DADO = "—";

/** 1234 → "1,2 mil"; 1500000 → "1,5 mi"; abaixo de mil, o número inteiro */
export function formatarTokens(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return SEM_DADO;
  if (n < 1000) return String(Math.round(n));
  const um = (v: number) => (Math.round(v * 10) / 10).toString().replace(".", ",");
  if (n < 1_000_000) return `${um(n / 1000)} mil`;
  return `${um(n / 1_000_000)} mi`;
}

/** confere a mensagem vinda do servidor (não confia no formato) */
export function ehGastoHoje(v: unknown): v is GastoHoje {
  if (!v || typeof v !== "object") return false;
  const o = v as { total?: unknown; porPapel?: unknown };
  const ok = (x: unknown) =>
    !!x && typeof x === "object" && Number.isFinite((x as GastoValores).tokens) && Number.isFinite((x as GastoValores).cacheLeitura);
  if (!ok(o.total) || !o.porPapel || typeof o.porPapel !== "object") return false;
  return Object.values(o.porPapel as Record<string, unknown>).every(ok);
}
