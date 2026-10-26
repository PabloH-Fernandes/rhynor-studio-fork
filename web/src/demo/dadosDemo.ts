// Dados 100% fictícios da demonstração (lógica pura, sem React). Nomes inventados: nada daqui vem do vault.
// Vivem só no navegador e substituem, na tela, os dados do servidor nas seções Caixa, Pendências e Resultados.
// A demo NUNCA escreve no vault: o único pedido ao servidor é a simulação de Personagens (POST /api/demo).

import type { CaixaAcao, CaixaItem, Pendencia } from "../../../shared/types";
import type { Periodos, Resultados } from "../../../shared/resultados";
import { ESTIMATIVAS_PADRAO } from "../../../shared/resultados";
import { somarDias } from "../../../shared/datas";
import { contarAcoes, resumoDecisao } from "../caixaLogic";

/** o cartão "Aprovada" da Caixa (mesma forma que a Caixa monta quando você aprova de verdade) */
export interface AprovadaDemo {
  id: string;
  titulo: string;
  resumo: string;
  comando: string | null;
}

export const ATA_ID = "demo-planejamento-loja-aurora";
export const ATA_TITULO = "Planejamento da Loja Aurora";

/** a ata fictícia que "chega" no passo 1 */
export function ataDemo(hoje: string): CaixaItem {
  return {
    id: ATA_ID,
    titulo: ATA_TITULO,
    data: hoje,
    tarefas: [
      { n: 1, texto: "Montar a lista de produtos da vitrine de primavera", responsavel: "Responsável A", prazo: somarDias(hoje, 5) },
      { n: 2, texto: "Escrever o texto do e-mail de lançamento", responsavel: "Responsável A", prazo: somarDias(hoje, 3) },
      { n: 3, texto: "Ligar para o fornecedor de embalagens", responsavel: "Responsável B", prazo: somarDias(hoje, 4) },
      { n: 4, texto: "Conferir o orçamento da campanha", responsavel: "Responsável B", prazo: somarDias(hoje, 7) },
    ],
  };
}

/** as escolhas que a demo "faz sozinha", em ordem: 2 tarefas para o time e 2 para a pessoa */
export const ESCOLHAS_DEMO: readonly { n: number; acao: CaixaAcao; noMs: number }[] = [
  { n: 1, acao: "time", noMs: 2000 },
  { n: 2, acao: "time", noMs: 4000 },
  { n: 3, acao: "eu", noMs: 6000 },
  { n: 4, acao: "eu", noMs: 8000 },
];
/** a aprovação acontece depois da última escolha */
export const APROVA_NO_MS = 10_000;

export const COMANDO_DEMO = `/time Missão [[vitrine-de-primavera-missao]]: Fazer as 2 tarefas da reunião ${ATA_TITULO}.`;

/** pendências que já existiam antes da ata (uma delas atrasada, para a plaquinha do escritório) */
function pendenciasBase(hoje: string): Pendencia[] {
  return [
    {
      id: "demo:p1",
      h: "demo",
      texto: "Revisar o contrato da gráfica",
      responsavel: "Responsável B",
      prazo: somarDias(hoje, -2),
      origem: "Reunião de abertura da campanha",
      dono: "eu",
      status: "a fazer",
      urgencia: "atrasada",
    },
    {
      id: "demo:p2",
      h: "demo",
      texto: "Enviar as fotos da vitrine para a revista",
      responsavel: "Responsável A",
      prazo: somarDias(hoje, 1),
      origem: "Reunião de abertura da campanha",
      dono: "eu",
      status: "em andamento",
      urgencia: "logo",
    },
    {
      id: "demo:p3",
      h: "demo",
      texto: "Atualizar a planilha de estoque",
      responsavel: "",
      prazo: somarDias(hoje, 6),
      origem: "Reorganização do estoque",
      dono: "time",
      status: "em andamento",
      urgencia: "no-prazo",
    },
  ];
}

/** o que a aprovação cria: 2 pendências do time e 2 suas */
function pendenciasDaAta(hoje: string): Pendencia[] {
  const a = ataDemo(hoje);
  const dono = (n: number): "eu" | "time" => (ESCOLHAS_DEMO.find((e) => e.n === n)?.acao === "time" ? "time" : "eu");
  return a.tarefas.map((t) => ({
    id: `demo:a${t.n}`,
    h: "demo",
    texto: t.texto,
    responsavel: t.responsavel,
    prazo: t.prazo,
    origem: ATA_TITULO,
    dono: dono(t.n),
    status: dono(t.n) === "time" ? "em andamento" : "a fazer",
    urgencia: "no-prazo",
  }));
}

const p = (hoje: number, semana: number, total: number): Periodos => ({ hoje, semana, total });

/** a estimativa de minutos: a mesma conta do servidor (ata processada + missão concluída) */
function tempo(atas: Periodos, missoes: Periodos): Periodos {
  const f = (a: number, m: number) => a * ESTIMATIVAS_PADRAO.ataProcessada + m * ESTIMATIVAS_PADRAO.missaoConcluida;
  return p(f(atas.hoje, missoes.hoje), f(atas.semana, missoes.semana), f(atas.total, missoes.total));
}

function montarResultados(hoje: string, v: { atasSemIa: Periodos; atasComIa: Periodos; tarefas: Periodos; missoes: Periodos; pendencias: Periodos }): Resultados {
  const atas = p(v.atasSemIa.hoje + v.atasComIa.hoje, v.atasSemIa.semana + v.atasComIa.semana, v.atasSemIa.total + v.atasComIa.total);
  return {
    hoje,
    semanaDesde: somarDias(hoje, -6),
    atas,
    atasSemIa: v.atasSemIa,
    atasComIa: v.atasComIa,
    tarefasAprovadas: v.tarefas,
    missoesConcluidas: v.missoes,
    pendenciasFechadas: v.pendencias,
    tempoEconomizado: tempo(atas, v.missoes),
    estimativas: { ...ESTIMATIVAS_PADRAO },
    missoesDataAproximada: 0,
    semData: 0,
    ficticias: 1,
    incluiFicticias: true,
  };
}

/** os números antes de a ata chegar */
export function resultadosAntes(hoje: string): Resultados {
  return montarResultados(hoje, {
    atasSemIa: p(0, 2, 4),
    atasComIa: p(0, 0, 1),
    tarefas: p(0, 5, 12),
    missoes: p(0, 1, 3),
    pendencias: p(0, 3, 9),
  });
}

/** os números depois de a ata ser aprovada e o time terminar a missão */
export function resultadosDepois(hoje: string): Resultados {
  return montarResultados(hoje, {
    atasSemIa: p(1, 3, 5),
    atasComIa: p(0, 0, 1),
    tarefas: p(2, 7, 14),
    missoes: p(1, 2, 4),
    pendencias: p(2, 5, 11),
  });
}

const interpola = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
const interpolaPeriodos = (a: Periodos, b: Periodos, t: number): Periodos => p(interpola(a.hoje, b.hoje, t), interpola(a.semana, b.semana, t), interpola(a.total, b.total, t));

/** os números a meio caminho (t de 0 a 1), para o contador subir aos poucos */
export function interpolarResultados(de: Resultados, ate: Resultados, t: number): Resultados {
  const k = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 1));
  return {
    ...ate,
    atas: interpolaPeriodos(de.atas, ate.atas, k),
    atasSemIa: interpolaPeriodos(de.atasSemIa, ate.atasSemIa, k),
    atasComIa: interpolaPeriodos(de.atasComIa, ate.atasComIa, k),
    tarefasAprovadas: interpolaPeriodos(de.tarefasAprovadas, ate.tarefasAprovadas, k),
    missoesConcluidas: interpolaPeriodos(de.missoesConcluidas, ate.missoesConcluidas, k),
    pendenciasFechadas: interpolaPeriodos(de.pendenciasFechadas, ate.pendenciasFechadas, k),
    tempoEconomizado: interpolaPeriodos(de.tempoEconomizado, ate.tempoEconomizado, k),
  };
}

/** quanto tempo os contadores levam para subir no passo 5 */
export const CONTADOR_MS = 3000;

export interface VisaoDemo {
  /** a Caixa: vazia antes da ata chegar e depois de aprovada */
  caixa: CaixaItem[];
  /** as escolhas já marcadas (reunião → tarefa → ação) */
  escolhas: Record<string, Record<number, CaixaAcao>>;
  /** o cartão "Aprovada" com o comando pronto */
  aprovadas: AprovadaDemo[];
  pendencias: Pendencia[];
  resultados: Resultados;
}

/**
 * O que a tela mostra em cada passo da demo. `passo` é de 1 a 5 e `ms` é o tempo dentro do passo.
 * Os cartões vêm do tempo, não de eventos: avançar com a tecla → só muda o passo e a tela acompanha.
 */
export function visaoDoPasso(passo: number, ms: number, hoje: string, semAnimacao = false): VisaoDemo {
  const ata = ataDemo(hoje);
  const antes = resultadosAntes(hoje);
  const depois = resultadosDepois(hoje);
  const base = pendenciasBase(hoje);

  if (passo <= 1) return { caixa: [], escolhas: {}, aprovadas: [], pendencias: base, resultados: antes };

  if (passo === 2) return { caixa: [ata], escolhas: {}, aprovadas: [], pendencias: base, resultados: antes };

  const decididas: Record<number, CaixaAcao> = {};
  if (passo === 3) {
    for (const e of ESCOLHAS_DEMO) if (ms >= e.noMs) decididas[e.n] = e.acao;
    if (ms < APROVA_NO_MS) return { caixa: [ata], escolhas: { [ATA_ID]: decididas }, aprovadas: [], pendencias: base, resultados: antes };
  } else {
    for (const e of ESCOLHAS_DEMO) decididas[e.n] = e.acao;
  }

  const aprovada: AprovadaDemo = { id: ATA_ID, titulo: ATA_TITULO, resumo: resumoDecisao(contarAcoes(ata, decididas)), comando: COMANDO_DEMO };
  const aposAprovar = [...pendenciasDaAta(hoje), ...base];
  if (passo <= 4) return { caixa: [], escolhas: {}, aprovadas: [aprovada], pendencias: aposAprovar, resultados: antes };

  // passo 5: o time terminou as 2 tarefas dele, as pendências do time saem e os contadores sobem
  const t = semAnimacao ? 1 : ms / CONTADOR_MS;
  return {
    caixa: [],
    escolhas: {},
    aprovadas: [aprovada],
    pendencias: aposAprovar.filter((x) => !(x.id.startsWith("demo:a") && x.dono === "time")),
    resultados: interpolarResultados(antes, depois, t),
  };
}
