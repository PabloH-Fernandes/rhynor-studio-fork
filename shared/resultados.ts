// Resultados: os números do painel e do resumo exportado. Tipos e textos compartilhados entre servidor e painel.

/** Minutos que cada coisa "vale" no cálculo do tempo economizado (data/estimativas.json). É uma estimativa. */
export interface Estimativas {
  ataProcessada: number;
  tarefaAprovada: number;
  missaoConcluida: number;
  pendenciaFechada: number;
}

export const ESTIMATIVAS_PADRAO: Readonly<Estimativas> = {
  ataProcessada: 20,
  tarefaAprovada: 10,
  missaoConcluida: 60,
  pendenciaFechada: 5,
};

/** Uma contagem em três janelas: hoje, últimos 7 dias corridos (contando hoje) e total */
export interface Periodos {
  hoje: number;
  semana: number;
  total: number;
}

export interface Resultados {
  /** AAAA-MM-DD do dia em que os números foram calculados */
  hoje: string;
  /** primeiro dia da "semana" (hoje menos 6 dias) */
  semanaDesde: string;
  /** atas processadas = sem IA + com IA */
  atas: Periodos;
  atasSemIa: Periodos;
  atasComIa: Periodos;
  tarefasAprovadas: Periodos;
  missoesConcluidas: Periodos;
  pendenciasFechadas: Periodos;
  /** minutos: contagem x estimativa de cada tipo. SEMPRE uma estimativa. */
  tempoEconomizado: Periodos;
  estimativas: Estimativas;
  /** quantas missões concluídas usaram a data do arquivo (a nota não tem `concluida_em`) */
  missoesDataAproximada: number;
  /** itens sem nenhuma data: só entram no total */
  semData: number;
  /** quantos itens contados vêm de notas de demonstração (`ficticia: true`) */
  ficticias: number;
  incluiFicticias: boolean;
}

export const FRASE_ESTIMATIVA = "O tempo economizado é uma estimativa, não uma medição exata.";

/** minutos em texto simples: "0 min", "45 min", "1 h", "1 h 20 min" */
export function formatarMinutos(min: number): string {
  const m = Math.max(0, Math.round(Number.isFinite(min) ? min : 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
