// Textos e contas da seção "Transparência" do painel (lógica pura, sem React). Os registros vêm prontos do servidor
// (só caminho relativo ao vault e a ação; nunca conteúdo). O estado nunca depende só da cor: sempre ícone + texto.

import type { Resultados } from "../../shared/resultados";
import { NOTA_LIMITE, TEXTO_INFORMATIVO, TEXTO_VIOLACAO, type Acao, type Nivel, type RegistroTransparencia, type ResumoTransparencia } from "../../shared/transparencia";

export { NOTA_LIMITE, TEXTO_INFORMATIVO, TEXTO_VIOLACAO } from "../../shared/transparencia";

const ACOES: readonly string[] = ["leu", "escreveu", "editou", "buscou"];
const NIVEIS: readonly string[] = ["normal", "informativo", "violacao"];

/** HH:MM:SS do instante (hora local) */
export function horaDe(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const VERBO: Record<Acao, string> = { leu: "leu", escreveu: "escreveu em", editou: "editou", buscou: "buscou em" };

export interface LinhaRecente {
  /** chave estável para a lista */
  id: string;
  hora: string;
  agente: string;
  acao: Acao;
  arquivo: string;
  nivel: Nivel;
  /** o que a linha diz além da cor: "ATENÇÃO", "Esperado" ou "" */
  marca: string;
  /** a linha em uma frase, para o leitor de tela */
  frase: string;
}

export function marcaDoNivel(nivel: Nivel): string {
  if (nivel === "violacao") return "ATENÇÃO";
  if (nivel === "informativo") return "Esperado";
  return "";
}

/** Os registros mais novos primeiro. */
export function montarLinhas(resumo: ResumoTransparencia, max = 20): LinhaRecente[] {
  return [...resumo.recentes]
    .reverse()
    .slice(0, max)
    .map((r, i) => {
      const marca = marcaDoNivel(r.nivel);
      const hora = horaDe(r.ts);
      return {
        id: `${r.ts}-${r.sessao}-${i}`,
        hora,
        agente: r.agente,
        acao: r.acao,
        arquivo: r.arquivo,
        nivel: r.nivel,
        marca,
        frase: `${hora}, ${r.agente} ${VERBO[r.acao]} ${r.arquivo}${marca ? ` (${marca})` : ""}`,
      };
    });
}

export function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

export interface AlertaTransparencia {
  tipo: "violacao" | "informativo";
  titulo: string;
  detalhe: string;
}

/** As faixas de cima: vermelha (violação) e âmbar (informativo). Vazio = nada a mostrar. */
export function montarAlertas(resumo: ResumoTransparencia): AlertaTransparencia[] {
  const out: AlertaTransparencia[] = [];
  if (resumo.violacoes > 0) {
    const ultima = [...resumo.recentes].reverse().find((r) => r.nivel === "violacao");
    out.push({
      tipo: "violacao",
      titulo: TEXTO_VIOLACAO,
      detalhe: `${plural(resumo.violacoes, "vez", "vezes")} neste mês${ultima ? `; a última às ${horaDe(ultima.ts)}, em ${ultima.arquivo}` : ""}. Veja a lista abaixo.`,
    });
  }
  if (resumo.informativos > 0) {
    out.push({
      tipo: "informativo",
      titulo: TEXTO_INFORMATIVO,
      detalhe: `${plural(resumo.informativos, "vez", "vezes")} neste mês. Isso é normal: o /reuniao precisa ler a ata.`,
    });
  }
  return out;
}

export interface ContadoresAtas {
  semIa: number;
  comIa: number;
  frase: string;
}

/** 'atas sem IA' e 'atas com IA (/reuniao)', do total contado em Resultados (null = ainda não chegou) */
export function contadoresAtas(r: Resultados | null): ContadoresAtas | null {
  if (!r) return null;
  const semIa = r.atasSemIa.total;
  const comIa = r.atasComIa.total;
  return { semIa, comIa, frase: `Atas sem IA: ${semIa}. Atas com IA (/reuniao): ${comIa}.` };
}

export function resumoVazio(resumo: ResumoTransparencia): boolean {
  return resumo.total === 0;
}

export function nomeArquivoMd(mes: string): string {
  return `${mes}.md`;
}

export function textoErroExportar(status: number): string {
  if (status === 403 || status === 415) return "O servidor não aceitou o pedido. Recarregue a página e tente de novo.";
  return "Não consegui gerar o resumo. Tente de novo.";
}

function ehRegistro(v: unknown): v is RegistroTransparencia {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<RegistroTransparencia>;
  return (
    typeof r.ts === "number" &&
    Number.isFinite(r.ts) &&
    typeof r.sessao === "string" &&
    typeof r.agente === "string" &&
    typeof r.acao === "string" &&
    ACOES.includes(r.acao) &&
    typeof r.arquivo === "string" &&
    typeof r.nivel === "string" &&
    NIVEIS.includes(r.nivel)
  );
}

/** confere a forma do resumo (do WebSocket ou de um servidor antigo que não tem a rota) */
export function ehResumoTransparencia(valor: unknown): valor is ResumoTransparencia {
  if (!valor || typeof valor !== "object") return false;
  const r = valor as Partial<ResumoTransparencia>;
  return (
    typeof r.mes === "string" &&
    Number.isFinite(r.total) &&
    Number.isFinite(r.normais) &&
    Number.isFinite(r.informativos) &&
    Number.isFinite(r.violacoes) &&
    Array.isArray(r.recentes) &&
    r.recentes.every(ehRegistro)
  );
}

/** o corpo de GET /api/transparencia (linhas + contagens) vira o mesmo resumo do WebSocket */
export function resumoDoGet(corpo: unknown): ResumoTransparencia | null {
  if (!corpo || typeof corpo !== "object") return null;
  const c = corpo as { mes?: unknown; linhas?: unknown; contagens?: Record<string, unknown> | null };
  const k = c.contagens;
  if (typeof c.mes !== "string" || !Array.isArray(c.linhas) || !k) return null;
  const resumo = {
    mes: c.mes,
    total: Number(k.total),
    normais: Number(k.normais),
    informativos: Number(k.informativos),
    violacoes: Number(k.violacoes),
    recentes: c.linhas.slice(-20),
  };
  return ehResumoTransparencia(resumo) ? resumo : null;
}
