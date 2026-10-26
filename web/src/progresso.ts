// Textos do quadro de etapas, usados no quadro da parede (canvas) e no topo do painel.

import type { Progress } from "../../shared/types";

export type EstadoProgresso = "tarefas" | "concluido" | "papel" | "nada";

export interface TextoProgresso {
  estado: EstadoProgresso;
  /** "Time na Etapa 4 de 7" */
  titulo: string;
  /** versão curta, pra quando o título não cabe no quadro ("Etapa 4 de 7") */
  curto: string;
  /** o que está sendo feito ("Construindo novas funções"); vazio fora de "tarefas" */
  detalhe: string;
  /** posição da barra (etapa atual) e total; 0/0 sem lista */
  valor: number;
  max: number;
}

/** "Time na Etapa 2 de 6" vira frase "Time na Etapa " + contagem "2 de 6" (que não quebra no meio) */
export function separarContagem(titulo: string): { frase: string; contagem: string } {
  const num = /^(.*?)(\d+ de \d+)$/.exec(titulo);
  return num ? { frase: num[1], contagem: num[2] } : { frase: titulo, contagem: "" };
}

/** quantos dos segmentos da barra ficam cheios */
export const SEGMENTOS = 10;

export function textoDoProgresso(p: Progress): TextoProgresso {
  if (p.fonte === "tarefas" && p.total > 0) {
    if (p.concluidas >= p.total) {
      return {
        estado: "concluido",
        titulo: `Time concluiu ${p.total} de ${p.total}`,
        curto: `Concluíram ${p.total} de ${p.total}`,
        detalhe: "",
        valor: p.total,
        max: p.total,
      };
    }
    return {
      estado: "tarefas",
      titulo: `Time na Etapa ${p.etapa} de ${p.total}`,
      curto: `Etapa ${p.etapa} de ${p.total}`,
      detalhe: p.titulo,
      valor: p.etapa,
      max: p.total,
    };
  }
  if (p.fonte === "papel") {
    return { estado: "papel", titulo: `Personagens em ${p.titulo}`, curto: `Em ${p.titulo}`, detalhe: "", valor: 0, max: 0 };
  }
  return { estado: "nada", titulo: "Time de boa", curto: "De boa", detalhe: "", valor: 0, max: 0 };
}

/** segmentos cheios da barra de 10 (etapa 4 de 7 → 6) */
export function segmentosCheios(valor: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(SEGMENTOS, Math.round((valor / max) * SEGMENTOS)));
}
