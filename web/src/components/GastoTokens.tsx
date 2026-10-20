// Gasto de tokens de hoje. Só números lidos do registro do Claude: NÃO é custo. Sem dado, "—" (nunca 0 nem estimativa).

import type { GastoHoje, GastoValores } from "../../../shared/gasto";
import { ROTULO_GASTO, SEM_DADO, formatarTokens } from "../../../shared/gasto";

/** total pequeno no topo do painel */
export function GastoTotal({ hoje }: { hoje: GastoHoje | null }) {
  const v = hoje?.total;
  return (
    <p className="gasto-total" title={ROTULO_GASTO}>
      <span className="gasto-total-rotulo">Tokens hoje:</span> <strong>{v ? formatarTokens(v.tokens) : SEM_DADO}</strong>
      <span className="sr-only"> ({ROTULO_GASTO})</span>
    </p>
  );
}

/** linha do crachá: tokens do papel hoje; o cache lido aparece à parte */
export function GastoDoPapel({ valores, id }: { valores: GastoValores | null; id: string }) {
  return (
    <div className="cracha-gasto">
      <dt id={id}>Tokens hoje:</dt>
      <dd aria-describedby={`${id}-nota`}>
        {valores ? formatarTokens(valores.tokens) : SEM_DADO}
        {valores && valores.cacheLeitura > 0 && <span className="cracha-gasto-cache"> (+ {formatarTokens(valores.cacheLeitura)} de cache lido)</span>}
        <span id={`${id}-nota`} className="cracha-gasto-nota">
          {ROTULO_GASTO}
        </span>
      </dd>
    </div>
  );
}
