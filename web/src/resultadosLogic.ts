// Textos e contas da seção "Resultados" do painel (lógica pura, sem React). Os números vêm prontos do servidor
// (contados das notas do vault); aqui só viram tabela, resumo e avisos. O tempo economizado é SEMPRE uma estimativa.

import { formatarMinutos, type Periodos, type Resultados } from "../../shared/resultados";

export { FRASE_ESTIMATIVA } from "../../shared/resultados";

export interface LinhaResultado {
  id: "atas" | "atas-sem-ia" | "atas-com-ia" | "tarefas" | "missoes" | "pendencias" | "tempo";
  rotulo: string;
  /** linha de detalhe (sem IA / com IA), recuada abaixo das atas */
  detalhe: boolean;
  /** o tempo economizado: o rótulo já leva "(estimativa)" */
  estimativa: boolean;
  hoje: string;
  semana: string;
  total: string;
  /** a linha em uma frase, para o leitor de tela (a tabela só repete as colunas) */
  frase: string;
}

function linha(id: LinhaResultado["id"], rotulo: string, p: Periodos, opcoes: { detalhe?: boolean; estimativa?: boolean; formato?: (n: number) => string } = {}): LinhaResultado {
  const f = opcoes.formato ?? String;
  return {
    id,
    rotulo,
    detalhe: opcoes.detalhe ?? false,
    estimativa: opcoes.estimativa ?? false,
    hoje: f(p.hoje),
    semana: f(p.semana),
    total: f(p.total),
    frase: `${rotulo}: hoje ${f(p.hoje)}, na semana ${f(p.semana)}, no total ${f(p.total)}`,
  };
}

/** as linhas da tabela, na ordem em que aparecem */
export function montarLinhas(r: Resultados): LinhaResultado[] {
  return [
    linha("atas", "Atas processadas", r.atas),
    linha("atas-sem-ia", "lidas sem IA", r.atasSemIa, { detalhe: true }),
    linha("atas-com-ia", "com IA (/reuniao)", r.atasComIa, { detalhe: true }),
    linha("tarefas", "Tarefas aprovadas", r.tarefasAprovadas),
    linha("missoes", "Missões concluídas", r.missoesConcluidas),
    linha("pendencias", "Pendências fechadas", r.pendenciasFechadas),
    linha("tempo", "Tempo economizado (estimativa)", r.tempoEconomizado, { estimativa: true, formato: formatarMinutos }),
  ];
}

export function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** ainda não há nada contado (nem no total) */
export function semResultados(r: Resultados): boolean {
  return r.atas.total + r.tarefasAprovadas.total + r.missoesConcluidas.total + r.pendenciasFechadas.total === 0;
}

/** o resumo pequeno do topo do painel: o dia de hoje, com a palavra "estimativa" junto do tempo */
export function resumoTopo(r: Resultados): string {
  const hoje = [
    plural(r.atas.hoje, "ata", "atas"),
    plural(r.tarefasAprovadas.hoje, "tarefa aprovada", "tarefas aprovadas"),
    plural(r.missoesConcluidas.hoje, "missão concluída", "missões concluídas"),
    plural(r.pendenciasFechadas.hoje, "pendência fechada", "pendências fechadas"),
  ].join(" · ");
  return `Hoje: ${hoje}`;
}

/** o tempo do topo: sempre com o rótulo visível */
export function tempoTopo(r: Resultados): string {
  return `${formatarMinutos(r.tempoEconomizado.hoje)} economizados hoje (estimativa)`;
}

/** "como estimamos": os minutos de cada coisa, em uma frase */
export function comoEstimamos(r: Resultados): string {
  const e = r.estimativas;
  return (
    `Cada ata vale ${formatarMinutos(e.ataProcessada)}, cada tarefa aprovada ${formatarMinutos(e.tarefaAprovada)}, ` +
    `cada missão concluída ${formatarMinutos(e.missaoConcluida)} e cada pendência fechada ${formatarMinutos(e.pendenciaFechada)}. ` +
    "Os valores se somam: tarefa e pendência podem ser parte do trabalho de uma missão, então valores acima de 0 nelas podem contar o mesmo trabalho mais de uma vez. " +
    "Você muda esses valores em data/estimativas.json."
  );
}

/** avisos que mudam como ler os números (vazio = nenhum) */
export function avisosDosResultados(r: Resultados): string[] {
  const out: string[] = [];
  if (r.incluiFicticias) out.push("Estes números incluem dados de demonstração (fictícios).");
  if (r.missoesDataAproximada > 0) {
    out.push(`${plural(r.missoesDataAproximada, "missão concluída está", "missões concluídas estão")} sem data de conclusão (data aproximada).`);
  }
  if (r.semData > 0) out.push(`${plural(r.semData, "item sem data entra", "itens sem data entram")} só no total.`);
  return out;
}

export function nomeArquivoResumo(hoje: string): string {
  return `resultados-${hoje}.md`;
}

export function textoErroExportar(status: number): string {
  if (status === 403 || status === 415) return "O servidor não aceitou o pedido. Recarregue a página e tente de novo.";
  return "Não consegui gerar o resumo. Tente de novo.";
}

/** confere que o corpo de GET /api/resultados tem a forma esperada (um servidor antigo não tem a rota) */
export function ehResultados(valor: unknown): valor is Resultados {
  if (!valor || typeof valor !== "object") return false;
  const r = valor as Partial<Resultados>;
  const periodos = (p: unknown): boolean => {
    if (!p || typeof p !== "object") return false;
    const x = p as Partial<Periodos>;
    return Number.isFinite(x.hoje) && Number.isFinite(x.semana) && Number.isFinite(x.total);
  };
  return (
    typeof r.hoje === "string" &&
    periodos(r.atas) &&
    periodos(r.atasSemIa) &&
    periodos(r.atasComIa) &&
    periodos(r.tarefasAprovadas) &&
    periodos(r.missoesConcluidas) &&
    periodos(r.pendenciasFechadas) &&
    periodos(r.tempoEconomizado) &&
    typeof r.estimativas === "object" &&
    r.estimativas !== null
  );
}
