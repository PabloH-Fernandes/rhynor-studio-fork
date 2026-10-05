// Texto da plaquinha da mesa: a FUNÇÃO de quem está sentado (o nome fica na etiqueta da cabeça).
// Funções puras (sem canvas): npm test.

import type { AGzinho } from "../../../shared/types";
import { theme } from "../theme";

/** quem ocupa a mesa: papel do AGzinho e o número dele no papel (1 o principal, 2 a 1ª variação...) */
export interface OcupanteMesa {
  papel: string;
  numero?: number;
}

/**
 * Número do AGzinho no papel: o principal é 1; as variações (dev-2...) contam a partir de 2, na
 * ordem do elenco. Sem o AGzinho no elenco, 1.
 */
export function numeroNoPapel(agzinhos: readonly AGzinho[], key: string): number {
  const a = agzinhos.find((x) => x.key === key);
  if (!a?.variacaoDe) return 1;
  const irmas = agzinhos.filter((x) => x.variacaoDe === a.variacaoDe);
  return 2 + irmas.indexOf(a);
}

/** função de um papel em caixa alta; papel desconhecido (visitante extra) é CONVIDADO */
export function funcaoDoPapel(papel: string): string {
  return Object.hasOwn(theme.deskLabels, papel) ? theme.deskLabels[papel] : theme.deskLabels.convidado;
}

/**
 * Plaquinha: a função de quem está na mesa ("DESENVOLVIMENTO 2" para a 1ª variação do dev).
 * Mesa vazia: a do papel mostra a função do setor; a de convidado, LIVRE.
 */
export function rotuloDaMesa(papelDaMesa: string, ocupante: OcupanteMesa | null | undefined): string {
  if (!ocupante) return papelDaMesa === "convidado" ? "LIVRE" : funcaoDoPapel(papelDaMesa);
  const base = funcaoDoPapel(ocupante.papel);
  return ocupante.numero && ocupante.numero > 1 ? `${base} ${ocupante.numero}` : base;
}

/** quem está sentado (o Agent serve): key do AGzinho (ausente no visitante extra) e papel do agente */
export interface QuemSenta {
  agzinho?: string;
  role: string;
}

/** papel sem setor próprio (convidado, tipo desconhecido do visitante extra) */
const ehConvidado = (papel: string) => papel === "convidado" || !Object.hasOwn(theme.deskLabels, papel);

/**
 * Plaquinhas de todas as mesas de uma vez. Variações do mesmo papel levam o número fixo do elenco
 * (dev-2 → 2). Convidados sentados juntos são numerados pela ordem no elenco (os extras sem
 * AGzinho no fim, na ordem das mesas): CONVIDADO, CONVIDADO 2... Sozinho, é só CONVIDADO.
 */
export function rotulosDasMesas(mesas: readonly { papel: string; quem: QuemSenta | null }[], agzinhos: readonly AGzinho[]): string[] {
  const ocupantes = mesas.map((m): OcupanteMesa | null => {
    if (!m.quem) return null;
    const agz = m.quem.agzinho ? agzinhos.find((a) => a.key === m.quem!.agzinho) : undefined;
    return agz ? { papel: agz.papel, numero: numeroNoPapel(agzinhos, agz.key) } : { papel: m.quem.role };
  });
  const ordem = (i: number) => {
    const j = agzinhos.findIndex((a) => a.key === mesas[i].quem?.agzinho);
    return j < 0 ? agzinhos.length + i : j;
  };
  const convidados = ocupantes.flatMap((o, i) => (o && ehConvidado(o.papel) ? [i] : []));
  convidados.sort((a, b) => ordem(a) - ordem(b)).forEach((i, n) => (ocupantes[i]!.numero = n + 1));
  return mesas.map((m, i) => rotuloDaMesa(m.papel, ocupantes[i]));
}

/** palavras longas e a forma curta usada quando o rótulo não cabe na plaquinha */
const ABREVIACOES: [RegExp, string][] = [
  [/DESENVOLVIMENTO/, "DESENVOLV."],
  [/DOCUMENTAÇÃO/, "DOCUMENT."],
  [/PLANEJAMENTO/, "PLANEJAM."],
];

/** até quanto o texto pode ser espremido (fillText com maxWidth) antes de abreviar */
export const MAX_APERTO = 0.86;

/**
 * Texto que cabe em `maxW` (px base): o rótulo inteiro se couber, mesmo levemente espremido
 * (até MAX_APERTO); senão, a forma abreviada (ex.: "DESENVOLV. 2"). `medir` devolve a largura
 * do texto na fonte da plaquinha.
 */
export function rotuloQueCabe(rotulo: string, maxW: number, medir: (s: string) => number): string {
  if (medir(rotulo) * MAX_APERTO <= maxW) return rotulo;
  let curto = rotulo;
  for (const [longo, abrev] of ABREVIACOES) curto = curto.replace(longo, abrev);
  return curto;
}
