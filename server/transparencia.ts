// Transparência (lógica pura): dado um evento de hook, diz se um agente abriu algo do vault e com que gravidade.
// Só PreToolUse, só as ferramentas de arquivo (Read, Edit, Write, MultiEdit) e de busca (Grep, Glob).
// O registro leva SÓ o caminho relativo ao vault e o que foi feito: NUNCA o conteúdo do arquivo, o padrão buscado
// nem o resultado da ferramenta. Fora do vault = ignora (devolve null).
//
// Confidencial = frontmatter com `confidencial: true` (lido só nos primeiros 4 KB), pasta 10-Reunioes/ ou 00-Inbox/
// (exceto o LEIA-ME.md). Níveis:
//   violacao    leitura de nota confidencial fora de /reuniao; leitura de 10-Reunioes/ em qualquer caso;
//               Grep/Glob em lugar confidencial
//   informativo esperado: o /reuniao (sessão em reunião) abre a ata do Inbox ou outra nota confidencial por exceção
//   normal      o resto
// Limite honesto: só vê o que o Claude Code mandou pelo hook; `cat`/`type` num comando de shell não aparece.

import fs from "node:fs";
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
  /** os primeiros 4 KB do arquivo, ou null se não der para ler (padrão: lê do disco) */
  lerInicio?: (arquivo: string) => string | null;
}

function lerInicioDoDisco(arquivo: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(arquivo, "r");
    const buf = Buffer.alloc(BYTES_FRONTMATTER);
    const n = fs.readSync(fd, buf, 0, BYTES_FRONTMATTER, 0);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return null; // não existe (Write novo), é pasta, está ocupado...
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // já fechado
      }
    }
  }
}

/** realpath do que existe; o resto (arquivo que ainda vai nascer) segue o caminho do jeito que veio */
function realOuIgual(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    const pai = path.dirname(p);
    if (pai === p) return p;
    return path.join(realOuIgual(pai), path.basename(p));
  }
}

const barras = (s: string) => s.replaceAll("\\", "/");

/** caminho absoluto, ou relativo ao cwd: barras viram "/", `..` é resolvido, links simbólicos também. null = não deu. */
export function resolverCaminho(bruto: string, cwd: string | undefined): string | null {
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
 * O evento de hook vira (no máximo) uma linha do log. null = não é para registrar (outro evento, outra ferramenta,
 * fora do vault ou sem caminho). Nunca lança.
 */
export function classificarEvento(evento: unknown, ctx: ContextoTransparencia): RegistroTransparencia | null {
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

    // Read/Write/Edit/MultiEdit: file_path. Grep/Glob: path (sem ele, procuram no cwd).
    const bruto = acao === "buscou" ? (texto(entrada.path) ?? cwd) : texto(entrada.file_path);
    if (!bruto) return null;
    const real = resolverCaminho(bruto, cwd);
    if (!real) return null;

    const ci = ctx.ignorarCaixa ?? process.platform === "win32";
    const rel = relativoAoVault(real, realOuIgual(path.resolve(barras(ctx.vault))), ci);
    if (rel === null) return null; // fora do vault

    const norm = (s: string) => (ci ? s.toLowerCase() : s);
    const topo = norm(rel.split("/")[0] ?? "");
    const ehReunioes = topo === PASTA_REUNIOES;
    const ehInbox = topo === PASTA_INBOX && norm(rel) !== `${PASTA_INBOX}/${LEIA_ME}`;
    let confidencial = ehReunioes || ehInbox;
    if (!confidencial && rel !== "") {
      const inicio = (ctx.lerInicio ?? lerInicioDoDisco)(real);
      if (inicio !== null && temConfidencialTrue(inicio)) confidencial = true;
    }

    const emReuniao = ctx.reuniaoSessionId !== null && ctx.reuniaoSessionId === sessao;
    let nivel: Nivel = "normal";
    if (acao === "buscou") {
      if (confidencial) nivel = "violacao";
    } else if (acao === "leu") {
      if (ehReunioes) nivel = "violacao";
      else if (confidencial) nivel = emReuniao ? "informativo" : "violacao";
    }

    return {
      ts: (ctx.agora ?? Date.now)(),
      sessao: limpo(sessao, 100),
      agente: limpo(texto(ev.agent_type) ?? "lider", 60),
      ferramenta,
      acao,
      arquivo: limpo(rel === "" ? "." : rel, 300),
      confidencial,
      missao: ctx.missaoDaSessao(sessao),
      via: "PreToolUse",
      nivel,
    };
  } catch {
    return null;
  }
}
