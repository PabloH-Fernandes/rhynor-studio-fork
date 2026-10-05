// Textos do quadro de etapas, usados no quadro da parede (canvas) e no topo do painel.

import type { Progress } from "../../shared/types";

export type EstadoProgresso = "tarefas" | "concluido" | "papel" | "nada";

export interface TextoProgresso {
  estado: EstadoProgresso;
  /** "AGzinhos na Etapa 4 de 7" */
  titulo: string;
  /** versão curta, pra quando o título não cabe no quadro ("Etapa 4 de 7") */
  curto: string;
  /** o que está sendo feito ("Construindo novas funções"); vazio fora de "tarefas" */
  detalhe: string;
  /** posição da barra (etapa atual) e total; 0/0 sem lista */
  valor: number;
  max: number;
}

/** quantos dos segmentos da barra ficam cheios */
export const SEGMENTOS = 10;

export function textoDoProgresso(p: Progress): TextoProgresso {
  if (p.fonte === "tarefas" && p.total > 0) {
    if (p.concluidas >= p.total) {
      return {
        estado: "concluido",
        titulo: `AGzinhos concluíram ${p.total} de ${p.total}`,
        curto: `Concluíram ${p.total} de ${p.total}`,
        detalhe: "",
        valor: p.total,
        max: p.total,
      };
    }
    return {
      estado: "tarefas",
      titulo: `AGzinhos na Etapa ${p.etapa} de ${p.total}`,
      curto: `Etapa ${p.etapa} de ${p.total}`,
      detalhe: p.titulo,
      valor: p.etapa,
      max: p.total,
    };
  }
  if (p.fonte === "papel") {
    return { estado: "papel", titulo: `AGzinhos em ${p.titulo}`, curto: `Em ${p.titulo}`, detalhe: "", valor: 0, max: 0 };
  }
  return { estado: "nada", titulo: "AGzinhos de boa", curto: "De boa", detalhe: "", valor: 0, max: 0 };
}

/** segmentos cheios da barra de 10 (etapa 4 de 7 → 6) */
export function segmentosCheios(valor: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(SEGMENTOS, Math.round((valor / max) * SEGMENTOS)));
}
