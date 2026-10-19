// Textos e contas da seção "Transparência" do painel (lógica pura, sem React). Os registros vêm prontos do servidor
// (só caminho relativo ao vault e a ação; nunca conteúdo). O estado nunca depende só da cor: sempre ícone + texto.

import {
  MARCA_INFORMATIVO,
  MAX_RECENTES,
  MAX_VIOLACOES,
  NOTA_LIMITE,
  NOTA_PERMISSAO,
  TEXTOS_INFORMATIVO,
  TEXTO_INFORMATIVO,
  TEXTO_VIOLACAO,
  TIPOS_INFORMATIVO,
  semTipos,
  tipoInformativo,
  type Acao,
  type Nivel,
  type RegistroTransparencia,
  type ResumoTransparencia,
  type TipoInformativo,
} from "../../shared/transparencia";

export { NOTA_LIMITE, NOTA_PERMISSAO, TEXTO_INFORMATIVO, TEXTO_VIOLACAO } from "../../shared/transparencia";

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
  /** o que a linha diz além da cor: "ATENÇÃO", "Esperado", "Aviso" ou "" */
  marca: string;
  /** a linha em uma frase, para o leitor de tela */
  frase: string;
}

export function marcaDoNivel(nivel: Nivel, tipo: TipoInformativo | null = null): string {
  if (nivel === "violacao") return "ATENÇÃO";
  if (nivel === "informativo") return tipo ? MARCA_INFORMATIVO[tipo] : "Esperado";
  return "";
}

function linhaDe(r: RegistroTransparencia, id: string): LinhaRecente {
  const marca = marcaDoNivel(r.nivel, tipoInformativo(r));
  const hora = horaDe(r.ts);
  return {
    id,
    hora,
    agente: r.agente,
    acao: r.acao,
    arquivo: r.arquivo,
    nivel: r.nivel,
    marca,
    frase: `${hora}, ${r.agente} ${VERBO[r.acao]} ${r.arquivo}${marca ? ` (${marca})` : ""}`,
  };
}

/** chave estável: instante + sessão + ação + arquivo (+ nº da repetição igual); não muda quando a lista anda */
function comIds(regs: readonly RegistroTransparencia[], prefixo: string): LinhaRecente[] {
  const vistos = new Map<string, number>();
  return regs.map((r) => {
    const base = `${prefixo}${r.ts}-${r.sessao}-${r.acao}-${r.arquivo}`;
    const n = vistos.get(base) ?? 0;
    vistos.set(base, n + 1);
    return linhaDe(r, n === 0 ? base : `${base}#${n}`);
  });
}

/** Os registros mais novos primeiro. */
export function montarLinhas(resumo: ResumoTransparencia, max = MAX_RECENTES): LinhaRecente[] {
  return comIds(resumo.recentes, "r:").reverse().slice(0, max);
}

/** As violações do mês (até 5, mesmo as que já saíram da lista curta), as mais novas primeiro. */
export function montarViolacoes(resumo: ResumoTransparencia, max = MAX_VIOLACOES): LinhaRecente[] {
  return comIds(resumo.violacoesRecentes, "v:").reverse().slice(0, max);
}

export function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

export interface AlertaTransparencia {
  /** chave da faixa (uma por tipo de aviso) */
  chave: string;
  tipo: "violacao" | "informativo";
  titulo: string;
  /** a frase inteira (testes e leitor de tela) */
  detalhe: string;
  /** a frase em partes, para o arquivo da última violação sair na mesma fonte do resto da lista */
  antes: string;
  ultima: { hora: string; arquivo: string } | null;
  depois: string;
}

/** As faixas de cima: vermelha (violação) e âmbar (um aviso por tipo informativo). Vazio = nada a mostrar. */
export function montarAlertas(resumo: ResumoTransparencia): AlertaTransparencia[] {
  const out: AlertaTransparencia[] = [];
  if (resumo.violacoes > 0) {
    // sempre a última do mês (guardada no resumo), mesmo que já tenha saído da lista curta
    const u = resumo.ultimaViolacao ?? [...resumo.recentes].reverse().find((r) => r.nivel === "violacao") ?? null;
    const antes = `${plural(resumo.violacoes, "vez", "vezes")} neste mês`;
    const ultima = u ? { hora: horaDe(u.ts), arquivo: u.arquivo } : null;
    const depois = ". Veja a seção Violações abaixo.";
    out.push({
      chave: "violacao",
      tipo: "violacao",
      titulo: TEXTO_VIOLACAO,
      antes: ultima ? `${antes}; a última às ${ultima.hora}, em ` : antes,
      ultima,
      depois,
      detalhe: `${antes}${ultima ? `; a última às ${ultima.hora}, em ${ultima.arquivo}` : ""}${depois}`,
    });
  }
  const por = resumo.informativosPor ?? semTipos();
  for (const t of TIPOS_INFORMATIVO) {
    if (!por[t]) continue;
    const esperado = MARCA_INFORMATIVO[t] === "Esperado";
    const antes = `${plural(por[t], "vez", "vezes")} neste mês.`;
    const depois = esperado ? " Isso é normal: o /reuniao precisa ler a ata e criar a nota." : " Confira se foi o que você esperava.";
    out.push({ chave: t, tipo: "informativo", titulo: TEXTOS_INFORMATIVO[t], antes, ultima: null, depois, detalhe: antes + depois });
  }
  return out;
}

export interface ContadoresAtas {
  mes: string;
  semIa: number;
  comIa: number;
  rotulo: string;
  frase: string;
}

/** 'atas sem IA' e 'atas com IA (/reuniao)' DO MÊS do resumo (o mesmo número do GET e do export); null = ainda não veio */
export function contadoresAtas(resumo: ResumoTransparencia | null): ContadoresAtas | null {
  if (!resumo?.atas) return null;
  const { semIa, comIa } = resumo.atas;
  const rotulo = `Atas neste mês (${resumo.mes})`;
  return { mes: resumo.mes, semIa, comIa, rotulo, frase: `${rotulo}: ${semIa} sem IA, ${comIa} com IA (/reuniao).` };
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
  const por = r.informativosPor as Record<string, unknown> | undefined;
  return (
    typeof r.mes === "string" &&
    Number.isFinite(r.total) &&
    Number.isFinite(r.normais) &&
    Number.isFinite(r.informativos) &&
    Number.isFinite(r.violacoes) &&
    !!por &&
    TIPOS_INFORMATIVO.every((t) => Number.isFinite(por[t])) &&
    Array.isArray(r.recentes) &&
    r.recentes.every(ehRegistro) &&
    Array.isArray(r.violacoesRecentes) &&
    r.violacoesRecentes.every(ehRegistro) &&
    (r.ultimaViolacao === null || (!!r.ultimaViolacao && Number.isFinite(r.ultimaViolacao.ts) && typeof r.ultimaViolacao.arquivo === "string")) &&
    (r.atas === null || (!!r.atas && Number.isFinite(r.atas.semIa) && Number.isFinite(r.atas.comIa)))
  );
}

/** o corpo de GET /api/transparencia (linhas + contagens + alerta + atas do mês) vira o mesmo resumo do WebSocket */
export function resumoDoGet(corpo: unknown): ResumoTransparencia | null {
  if (!corpo || typeof corpo !== "object") return null;
  const c = corpo as {
    mes?: unknown;
    linhas?: unknown;
    contagens?: Record<string, unknown> | null;
    alerta?: { ultima?: unknown; ultimaArquivo?: unknown; recentes?: unknown } | null;
    atas?: { semIa?: unknown; comIa?: unknown } | null;
  };
  const k = c.contagens;
  if (typeof c.mes !== "string" || !Array.isArray(c.linhas) || !k) return null;
  const linhas = c.linhas as RegistroTransparencia[];
  const por = { ...semTipos(), ...((k.informativosPor as object | undefined) ?? {}) };
  const recentesViolacao = Array.isArray(c.alerta?.recentes)
    ? (c.alerta.recentes as RegistroTransparencia[])
    : linhas.filter((r) => r?.nivel === "violacao").slice(-MAX_VIOLACOES);
  const ts = c.alerta?.ultima;
  const arq = c.alerta?.ultimaArquivo;
  const ultima = recentesViolacao.at(-1);
  const resumo = {
    mes: c.mes,
    total: Number(k.total),
    normais: Number(k.normais),
    informativos: Number(k.informativos),
    informativosPor: por,
    violacoes: Number(k.violacoes),
    ultimaViolacao:
      typeof ts === "number" && typeof arq === "string" ? { ts, arquivo: arq } : ultima ? { ts: ultima.ts, arquivo: ultima.arquivo } : null,
    violacoesRecentes: recentesViolacao,
    atas: c.atas && Number.isFinite(c.atas.semIa) && Number.isFinite(c.atas.comIa) ? { semIa: Number(c.atas.semIa), comIa: Number(c.atas.comIa) } : null,
    recentes: linhas.slice(-MAX_RECENTES),
  };
  return ehResumoTransparencia(resumo) ? resumo : null;
}
