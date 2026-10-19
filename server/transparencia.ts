// Transparência (lógica pura): dado um evento de hook, diz se um agente abriu algo do vault e com que gravidade.
// Só PreToolUse, só as ferramentas de arquivo (Read, Edit, Write, MultiEdit) e de busca (Grep, Glob).
// O registro leva SÓ o caminho relativo ao vault e o que foi feito: NUNCA o conteúdo do arquivo, o padrão buscado
// (pattern/glob) nem o resultado da ferramenta. Fora do vault = ignora (devolve null).
//
// Confidencial = frontmatter com `confidencial: true` (lido só nos primeiros 4 KB), pasta 10-Reunioes/ ou 00-Inbox/
// (exceto o LEIA-ME.md). Níveis:
//   violacao    leitura de nota confidencial fora de /reuniao; leitura de 10-Reunioes/ em qualquer caso;
//               Grep/Glob cujo `path` é um lugar confidencial
//   informativo esperado: o /reuniao (sessão em reunião) abre a ata do Inbox ou outra nota confidencial;
//               aviso: Grep/Glob na RAIZ do vault (ancestral de 10-Reunioes e 00-Inbox: pode alcançar notas
//               confidenciais) e Write/Edit/MultiEdit em nota ou pasta confidencial, exceto o que o /reuniao
//               da mesma sessão faz (criar a nota de reunião e mexer no Inbox: isso é normal)
//   normal      o resto
// Duas fases, para o loop dos hooks continuar leve: `prepararEvento` (síncrona, sem disco: inclusive a decisão de
// /reuniao, que vale para o instante do evento) e `finalizarEvento` (assíncrona: realpath, começo do arquivo, nível).
// Limite honesto: só vê o que o Claude Code mandou pelo hook; `cat`/`type` num comando de shell não aparece. E o
// registro vem do PreToolUse, ANTES da permissão: uma leitura negada também aparece.

import fsp from "node:fs/promises";
import path from "node:path";
import type { Acao, Nivel, RegistroTransparencia } from "../shared/transparencia.ts";
import { temConfidencialTrue } from "./vault.ts";

/** quanto do começo da nota se lê para achar `confidencial: true` */
export const BYTES_FRONTMATTER = 4096;

const PASTA_REUNIOES = "10-reunioes";
const PASTA_INBOX = "00-inbox";
const LEIA_ME = "leia-me.md";

const ACAO_DA_FERRAMENTA: Record<string, Acao> = {
  Read: "leu",
  Write: "escreveu",
  Edit: "editou",
  MultiEdit: "editou",
  Grep: "buscou",
  Glob: "buscou",
};

type LeitorInicio = (arquivo: string) => string | null | Promise<string | null>;

export interface ContextoTransparencia {
  /** caminho do vault em uso (null = sem vault: nada é registrado) */
  vault: string | null;
  /** sessão da reunião (/reuniao) em andamento: state.getReuniao()?.sessionId */
  reuniaoSessionId: string | null;
  /** missão pedida por /time nessa sessão (ObservadorVault.getMissaoDaSessao) */
  missaoDaSessao: (sessionId: string) => string | null;
  agora?: () => number;
  /** compara caminhos sem diferenciar maiúsculas (padrão: só no Windows) */
  ignorarCaixa?: boolean;
  /** os primeiros 4 KB do arquivo, ou null se não der para ler (padrão: lê do disco, sem bloquear) */
  lerInicio?: LeitorInicio;
}

/** O que dá para decidir na hora, sem tocar no disco (roda no loop dos hooks): a decisão de /reuniao é daqui. */
export interface EventoPreparado {
  ts: number;
  sessao: string;
  agente: string;
  ferramenta: string;
  acao: Acao;
  /** caminho como veio (ainda não resolvido) */
  bruto: string;
  cwd: string | undefined;
  /** a sessão deste evento é a do /reuniao em andamento (decidido NA HORA do evento) */
  emReuniao: boolean;
  missao: string | null;
  vault: string;
  ignorarCaixa: boolean;
  lerInicio: LeitorInicio;
}

async function lerInicioDoDisco(arquivo: string): Promise<string | null> {
  let fh: fsp.FileHandle | null = null;
  try {
    fh = await fsp.open(arquivo, "r");
    const buf = Buffer.alloc(BYTES_FRONTMATTER);
    const { bytesRead } = await fh.read(buf, 0, BYTES_FRONTMATTER, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null; // não existe (Write novo), é pasta, está ocupado...
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

/** realpath do que existe; o resto (arquivo que ainda vai nascer) segue o caminho do jeito que veio */
async function realOuIgual(p: string): Promise<string> {
  try {
    return await fsp.realpath(p);
  } catch {
    const pai = path.dirname(p);
    if (pai === p) return p;
    return path.join(await realOuIgual(pai), path.basename(p));
  }
}

const barras = (s: string) => s.replaceAll("\\", "/");

/** caminho absoluto, ou relativo ao cwd: barras viram "/", `..` é resolvido, links simbólicos também. null = não deu. */
export async function resolverCaminho(bruto: string, cwd: string | undefined): Promise<string | null> {
  if (!bruto || bruto.includes("\u0000")) return null;
  const p = barras(bruto);
  let absoluto: string;
  if (path.isAbsolute(p)) absoluto = path.resolve(p);
  else if (cwd && path.isAbsolute(barras(cwd))) absoluto = path.resolve(barras(cwd), p);
  else return null;
  return realOuIgual(absoluto);
}

/** O caminho relativo ao vault (com "/"; "" = a própria raiz), ou null se está fora dele. */
export function relativoAoVault(real: string, vaultReal: string, ignorarCaixa: boolean): string | null {
  const norm = (s: string) => (ignorarCaixa ? s.toLowerCase() : s);
  const v = barras(vaultReal).replace(/\/+$/, "");
  const r = barras(real).replace(/\/+$/, "");
  if (norm(r) === norm(v)) return "";
  if (norm(r).startsWith(norm(v) + "/")) return r.slice(v.length + 1);
  return null;
}

function texto(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function limpo(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}

/**
 * Parte síncrona e barata (sem disco): o evento vira um "pedido de registro", ou null = não é para registrar
 * (outro evento, outra ferramenta, sem caminho). Nunca lança.
 */
export function prepararEvento(evento: unknown, ctx: ContextoTransparencia): EventoPreparado | null {
  try {
    if (!evento || typeof evento !== "object" || !ctx.vault) return null;
    const ev = evento as Record<string, unknown>;
    if (ev.hook_event_name !== "PreToolUse") return null; // PostToolUse tem a resposta da ferramenta: nem olhamos
    const ferramenta = texto(ev.tool_name);
    const sessao = texto(ev.session_id);
    if (!ferramenta || !sessao || !Object.hasOwn(ACAO_DA_FERRAMENTA, ferramenta)) return null;
    const acao = ACAO_DA_FERRAMENTA[ferramenta];
    const entrada = ev.tool_input && typeof ev.tool_input === "object" ? (ev.tool_input as Record<string, unknown>) : {};
    const cwd = texto(ev.cwd);
    // Read/Write/Edit/MultiEdit: file_path. Grep/Glob: path (sem ele, procuram no cwd). Nunca pattern/glob/conteúdo.
    const bruto = acao === "buscou" ? (texto(entrada.path) ?? cwd) : texto(entrada.file_path);
    if (!bruto) return null;
    return {
      ts: (ctx.agora ?? Date.now)(),
      sessao: limpo(sessao, 100),
      agente: limpo(texto(ev.agent_type) ?? "lider", 60),
      ferramenta,
      acao,
      bruto,
      cwd,
      emReuniao: ctx.reuniaoSessionId !== null && ctx.reuniaoSessionId === sessao,
      missao: ctx.missaoDaSessao(sessao),
      vault: ctx.vault,
      ignorarCaixa: ctx.ignorarCaixa ?? process.platform === "win32",
      lerInicio: ctx.lerInicio ?? lerInicioDoDisco,
    };
  } catch {
    return null;
  }
}

/** Parte assíncrona: resolve o caminho, lê o começo da nota e decide o nível. null = fora do vault. Nunca lança. */
export async function finalizarEvento(p: EventoPreparado): Promise<RegistroTransparencia | null> {
  try {
    const real = await resolverCaminho(p.bruto, p.cwd);
    if (!real) return null;
    const ci = p.ignorarCaixa;
    const rel = relativoAoVault(real, await realOuIgual(path.resolve(barras(p.vault))), ci);
    if (rel === null) return null; // fora do vault

    const norm = (s: string) => (ci ? s.toLowerCase() : s);
    const topo = norm(rel.split("/")[0] ?? "");
    const ehReunioes = topo === PASTA_REUNIOES;
    const ehInbox = topo === PASTA_INBOX && norm(rel) !== `${PASTA_INBOX}/${LEIA_ME}`;
    let confidencial = ehReunioes || ehInbox;
    if (!confidencial && rel !== "") {
      const inicio = await p.lerInicio(real);
      if (inicio !== null && temConfidencialTrue(inicio)) confidencial = true;
    }

    let nivel: Nivel = "normal";
    if (p.acao === "buscou") {
      // lugar confidencial = violação; a RAIZ do vault (ancestral de 10-Reunioes e 00-Inbox) só avisa
      if (confidencial) nivel = "violacao";
      else if (rel === "") nivel = "informativo";
    } else if (p.acao === "leu") {
      if (ehReunioes) nivel = "violacao";
      else if (confidencial) nivel = p.emReuniao ? "informativo" : "violacao";
    } else if (confidencial) {
      // Write/Edit/MultiEdit: no /reuniao, o Inbox e a nota de reunião são o trabalho dela (normal); o resto avisa
      nivel = p.emReuniao && (ehInbox || ehReunioes) ? "normal" : "informativo";
    }

    return {
      ts: p.ts,
      sessao: p.sessao,
      agente: p.agente,
      ferramenta: p.ferramenta,
      acao: p.acao,
      arquivo: limpo(rel === "" ? "." : rel, 300),
      confidencial,
      missao: p.missao,
      via: "PreToolUse",
      nivel,
    };
  } catch {
    return null;
  }
}

/** As duas partes juntas (testes e replay). */
export async function classificarEvento(evento: unknown, ctx: ContextoTransparencia): Promise<RegistroTransparencia | null> {
  const p = prepararEvento(evento, ctx);
  return p ? finalizarEvento(p) : null;
}
