// Roteiro da demonstração (lógica pura, sem React): 5 passos com duração fixa, que avançam sozinhos.
// O relógio é injetado (`agora`), então dá para testar sem esperar. Pausar vale só para o roteiro:
// a simulação de AGzinhos do servidor (POST /api/demo) continua rodando.

export interface PassoRoteiro {
  /** 1 a N */
  n: number;
  /** o que a legenda diz */
  titulo: string;
  /** quanto o passo dura se ninguém avançar */
  duracaoMs: number;
}

/** ~3 minutos no total. O passo 4 é o mais longo: é quando a simulação do servidor (~2 min 46 s) roda. */
export const PASSOS: readonly PassoRoteiro[] = [
  { n: 1, titulo: "Chega a ata da reunião", duracaoMs: 10_000 },
  { n: 2, titulo: "A ata aparece na Caixa de entrada", duracaoMs: 12_000 },
  { n: 3, titulo: "Aprovamos duas tarefas para o time", duracaoMs: 16_000 },
  { n: 4, titulo: "O time trabalhando", duracaoMs: 132_000 },
  { n: 5, titulo: "Pendências e Resultados atualizam", duracaoMs: 30_000 },
];

export const TOTAL_PASSOS = PASSOS.length;

export interface EstadoRoteiro {
  /** índice (0-based) do passo atual; no fim fica no último */
  indice: number;
  /** o passo atual (n de 1 a TOTAL_PASSOS) */
  passo: PassoRoteiro;
  /** quanto do passo atual já passou (ms) */
  decorridoMs: number;
  pausado: boolean;
  /** o último passo acabou */
  fim: boolean;
}

export interface Roteiro {
  /** o estado agora; também faz o roteiro andar se o tempo do passo acabou */
  estado(): EstadoRoteiro;
  pausar(): void;
  retomar(): void;
  /** pausa se está rodando, retoma se está pausado (no fim não faz nada) */
  alternar(): void;
  /** vai para o próximo passo (no último, termina o roteiro) */
  avancar(): void;
}

/** Cria um roteiro que começa agora (`agora()` em ms). */
export function criarRoteiro(agora: () => number, passos: readonly PassoRoteiro[] = PASSOS): Roteiro {
  if (passos.length === 0) throw new Error("o roteiro precisa de pelo menos um passo");
  let indice = 0;
  let fim = false;
  /** tempo já gasto no passo antes da última retomada */
  let acumulado = 0;
  /** quando o relógio do passo voltou a andar; null = pausado */
  let correndoDesde: number | null = agora();

  const decorrido = () => acumulado + (correndoDesde === null ? 0 : Math.max(0, agora() - correndoDesde));

  /** consome o tempo vencido: pode passar por vários passos de uma vez (aba que ficou oculta) */
  const andar = () => {
    if (fim || correndoDesde === null) return;
    let t = decorrido();
    while (!fim && t >= passos[indice].duracaoMs) {
      t -= passos[indice].duracaoMs;
      if (indice === passos.length - 1) {
        fim = true;
        t = passos[indice].duracaoMs;
      } else {
        indice++;
      }
    }
    acumulado = t;
    correndoDesde = agora();
  };

  return {
    estado() {
      andar();
      return { indice, passo: passos[indice], decorridoMs: Math.min(decorrido(), passos[indice].duracaoMs), pausado: correndoDesde === null, fim };
    },
    pausar() {
      andar();
      if (fim || correndoDesde === null) return;
      acumulado = decorrido();
      correndoDesde = null;
    },
    retomar() {
      if (fim || correndoDesde !== null) return;
      correndoDesde = agora();
    },
    alternar() {
      if (fim) return;
      if (correndoDesde === null) this.retomar();
      else this.pausar();
    },
    avancar() {
      andar();
      if (fim) return;
      const pausado = correndoDesde === null;
      if (indice === passos.length - 1) {
        fim = true;
        acumulado = passos[indice].duracaoMs;
        correndoDesde = null;
        return;
      }
      indice++;
      acumulado = 0;
      correndoDesde = pausado ? null : agora();
    },
  };
}
