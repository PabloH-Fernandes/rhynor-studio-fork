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
