// Quem é visitante: subagente (tem parentId) cujo papel NÃO é um dos 6 do time. Inclui os
// convidados do elenco (Iara, Jorge, Sofia) e os extras sem AGzinho (ag:extra:<id>). As variações
// do time (dev-2, pesquisador-2) têm o mesmo papel do principal, então continuam sendo do time.
// Um módulo só, usado pelo servidor e pelo front, para a lista de papéis não ser duplicada.

/** os 6 papéis do time (fora o líder); qualquer outro papel de subagente é visitante */
export const PAPEIS_DO_TIME: readonly string[] = ["planejador", "pesquisador", "dev", "testador", "revisor", "documentador"];

/** no máximo isso de visitantes aparece no mapa; o resto fica só no contador "+N visitantes" */
export const MAX_VISITANTES_NA_TELA = 3;

/** o que `ehVisitante` lê do agente (o Agent serve) */
export interface DadosDeVisitante {
  parentId?: string;
  role: string;
}

export function ehVisitante(agent: DadosDeVisitante): boolean {
  return !!agent.parentId && !PAPEIS_DO_TIME.includes(agent.role);
}
