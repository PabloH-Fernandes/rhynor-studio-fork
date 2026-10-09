// Filtro por projeto do painel e do canvas (lógica pura, sem DOM): npm test
import type { Agent, Progress } from "../../shared/types";

/** valor do seletor (e da preferência salva) que mostra todas as sessões */
export const TODAS = "todas";

const PROGRESSO_NADA: Progress = { fonte: "nada", etapa: 0, total: 0, concluidas: 0, titulo: "" };

/** projetos presentes nos agentes, sem repetir e em ordem alfabética */
export function projetosDe(agents: readonly Pick<Agent, "project">[]): string[] {
  const set = new Set<string>();
  for (const a of agents) if (a.project) set.add(a.project);
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Projeto que vale agora: o salvo, se ainda existe entre os agentes; senão "todas". A preferência
 * salva não é apagada (se o projeto voltar, o filtro volta).
 */
export function projetoEfetivo(salvo: string, projetos: readonly string[]): string {
  return salvo !== TODAS && projetos.includes(salvo) ? salvo : TODAS;
}

/** só os agentes do projeto (subagentes herdam o projeto do líder); "todas" devolve a mesma lista */
export function filtrarPorProjeto<T extends Pick<Agent, "project">>(agents: T[], projeto: string): T[] {
  return projeto === TODAS ? agents : agents.filter((a) => a.project === projeto);
}

/**
 * Quadro da parede seguindo o filtro: se a sessão de onde veio o progresso não tem ninguém no
 * projeto escolhido, o quadro fica vazio em vez de mostrar etapas de outro projeto.
 */
export function progressoDoFiltro(progress: Progress | null, visiveis: readonly Pick<Agent, "sessionId">[], projeto: string): Progress | null {
  if (projeto === TODAS || !progress) return progress;
  if (progress.fonte === "nada") return progress;
  return progress.sessionId && visiveis.some((a) => a.sessionId === progress.sessionId) ? progress : PROGRESSO_NADA;
}

/** quem está esperando você, contando TODOS os agentes (o filtro de projeto não esconde um pedido seu) */
export interface Espera {
  total: number;
  /** esperando em projeto diferente do escolhido no filtro (0 com "todas") */
  fora: number;
  /** projetos com alguém esperando, em ordem alfabética */
  projetos: string[];
  /** projetos de quem espera fora do filtro, em ordem alfabética */
  projetosFora: string[];
}

export function esperandoDe(agents: readonly Pick<Agent, "status" | "project">[], projeto: string): Espera {
  const esperando = agents.filter((a) => a.status === "esperando");
  const foraDoFiltro = projeto === TODAS ? [] : esperando.filter((a) => a.project !== projeto);
  return {
    total: esperando.length,
    fora: foraDoFiltro.length,
    projetos: projetosDe(esperando),
    projetosFora: projetosDe(foraDoFiltro),
  };
}

/** "2 agentes te esperando (1 em outro projeto: api)"; sem ninguém fora do filtro, não tem parênteses */
export function textoEspera(e: Espera): string {
  const quem = e.total === 1 ? "1 agente" : `${e.total} agentes`;
  if (e.fora === 0) return `${quem} te esperando`;
  const onde = e.projetosFora.length > 0 ? `: ${e.projetosFora.join(", ")}` : "";
  return `${quem} te esperando (${e.fora} em ${e.fora === 1 ? "outro projeto" : "outros projetos"}${onde})`;
}