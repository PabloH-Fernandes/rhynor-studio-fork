// Gasto de tokens do dia, lido do registro (transcript) do Claude Code. NÃO é custo em dinheiro.
//
// Formato lido (uma linha JSON por evento): só as linhas `assistant` com `message.id`, `message.usage` e `timestamp`.
// Só números e o id da mensagem são lidos: texto de conversa NUNCA é guardado nem escrito em log.
// - O mesmo `message.id` aparece em várias linhas (streaming): conta UMA vez (vale o maior valor de cada campo).
// - Subagente tem registro próprio (`<sessão>/subagents/agent-<id>.jsonl`; o SubagentStop traz `agent_transcript_path`).
//   Não se soma o `totalTokens` do resultado do Agent (seria contar duas vezes).
// - Leitura incremental por arquivo: guarda o deslocamento em bytes e só lê o que chegou depois, parando na última
//   linha completa. O registro é gravado de forma assíncrona e pode atrasar: relê ~1,5 s após o Stop e no próximo evento.
// - O dia vem do `timestamp` da linha (dia local).
// - Segurança: /api/hook é aberto e o caminho vem do corpo; só vale arquivo .jsonl, que NÃO seja link simbólico, dentro de
//   ~/.claude/projects (STUDIO_PROJETOS_DIR troca a pasta nos testes). A checagem do caminho é LÉXICA, antes de tocar no
//   disco (nada de UNC, \\?\ nem \\.\: evita acesso de rede a host arbitrário). Fora disso: ignora em silêncio.
// - Registro grande (>= 50 MB): lê só os últimos 50 MB (alinhado à próxima quebra de linha) e avisa uma vez no log; o que
//   veio antes disso não entra na conta (subconta conhecida, documentada no README).
// Persistência: data/gasto/AAAA-MM-DD.json (totais por papel) e data/gasto/_arquivos.json (deslocamento por arquivo e
// últimas mensagens vistas), para o reinício não recontar nem zerar.

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { diaLocal } from "../shared/datas.ts";
import type { GastoHoje, GastoValores } from "../shared/gasto.ts";
import { somarTokensNaMissao } from "./gastoMissao.ts";
import { writeAtomic } from "./roster.ts";

export const MAX_BYTES_TRANSCRITO = 50 * 1024 * 1024;
const TRECHO_BYTES = 4 * 1024 * 1024;
const MAX_IDS_POR_ARQUIVO = 200;
const MAX_ARQUIVOS = 300;
const MAX_RELER = 200;
const ESPERA_STOP_MS = 1500;
const EMITIR_MS = 1000;
const NOTA_INTERVALO_MS = 60_000;
/** depois de um Stop, o próximo evento da sessão (até este prazo) relê o arquivo uma vez */
const RELER_PRAZO_MS = 30_000;
const PAPEL_LIDER = "lider";
const ARQUIVO_ESTADO = "_arquivos.json";

type Quatro = [number, number, number, number];
/** entrada, saída, criação de cache, leitura de cache */
interface Contagem {
  entrada: number;
  saida: number;
  cacheCriacao: number;
  cacheLeitura: number;
}
interface DiaGasto {
  dia: string;
  porPapel: Record<string, Contagem>;
}
interface EstadoArquivo {
  offset: number;
  papel: string;
  /** message.id → [dia, entrada, saída, criação, leitura]; só os últimos MAX_IDS_POR_ARQUIVO */
  ids: Record<string, [string, number, number, number, number]>;
}
interface Missao {
  id: string;
  /** ms em que a sessão pediu a missão, se conhecido */
  desde: number | null;
}
interface Alvo {
  caminho: unknown;
  papel: string;
}

export interface OpcoesGasto {
  /** pasta data/gasto */
  dir: string;
  /** pasta dos registros do Claude (padrão: ~/.claude/projects ou STUDIO_PROJETOS_DIR) */
  projetosDir?: () => string;
  agora?: () => number;
  esperaMs?: number;
  emitirMs?: number;
  notaIntervaloMs?: number;
  /** missão pedida pela sessão (/time Missão [[id]]) e ainda aberta; null = sem missão */
  missaoDaSessao?: (sessionId: string) => string | null;
  /** quando a sessão pediu a missão (ms); só linhas do registro a partir daí contam para a nota */
  missaoDesde?: (sessionId: string) => number | null;
  vault?: () => string | null;
}

export function projetosDirPadrao(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  const c = env.STUDIO_PROJETOS_DIR?.trim();
  return c ? path.resolve(c) : path.join(home, ".claude", "projects");
}

const vazia = (): Contagem => ({ entrada: 0, saida: 0, cacheCriacao: 0, cacheLeitura: 0 });
const tokensDe = (c: Contagem) => c.entrada + c.saida + c.cacheCriacao;

/** nome de papel seguro (vira chave de JSON e texto no painel) */
export function papelSeguro(bruto: unknown): string {
  const p = typeof bruto === "string" ? bruto.trim().toLowerCase() : "";
  return /^[a-z0-9_-]{1,40}$/.test(p) ? p : "outro";
}

function numero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1e12) : 0;
}

/** dentro da pasta, só por texto (sem tocar no disco); no Windows não diferencia maiúsculas */
function dentroLexico(caminho: string, base: string): boolean {
  const norm = (x: string) => (process.platform === "win32" ? x.toLowerCase() : x);
  const rel = path.relative(norm(path.resolve(base)), norm(path.resolve(caminho)));
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

/**
 * Caminho aceito? Devolve o caminho real, ou null. Regras: texto sem NUL, absoluto (com `~/` expandido), termina em
 * .jsonl, sem prefixo de rede/dispositivo (barras duplas no começo), dentro da pasta de registros (conferido por texto
 * ANTES de tocar no disco), não é link simbólico e o realpath também está dentro da pasta.
 */
export async function caminhoPermitido(bruto: unknown, projetosDir: string, home = os.homedir()): Promise<string | null> {
  if (typeof bruto !== "string" || bruto.length === 0 || bruto.length > 1024 || bruto.includes("\u0000")) return null;
  const expandido = /^~[\\/]/.test(bruto) ? path.join(home, bruto.slice(2)) : bruto;
  if (/^[\\/]{2}/.test(expandido)) return null; // UNC, \\?\ e \\.\ (e as versões com /)
  if (!path.isAbsolute(expandido) || !/\.jsonl$/i.test(expandido)) return null;
  if (!dentroLexico(expandido, projetosDir)) return null;
  try {
    const st = await fsp.lstat(expandido);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    const real = await fsp.realpath(expandido);
    const base = await fsp.realpath(projetosDir);
    const rel = path.relative(base, real);
    if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return null;
    return real;
  } catch {
    return null;
  }
}

interface LinhaUso {
  id: string;
  ts: number;
  v: Quatro;
}

/** Lê uma linha do registro e devolve só id, hora e os 4 números; qualquer outra coisa → null. Nunca guarda texto. */
export function lerLinhaDeUso(linha: string): LinhaUso | null {
  if (!linha.includes('"usage"')) return null;
  let o: unknown;
  try {
    o = JSON.parse(linha);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const r = o as { type?: unknown; timestamp?: unknown; message?: { id?: unknown; usage?: Record<string, unknown> } };
  if (r.type !== "assistant" || !r.message || typeof r.message !== "object") return null;
  const id = r.message.id;
  const u = r.message.usage;
  if (typeof id !== "string" || id.length === 0 || id.length > 200 || !u || typeof u !== "object") return null;
  const ts = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN;
  // thinking_tokens já está dentro de output_tokens: não soma de novo
  return { id, ts, v: [numero(u.input_tokens), numero(u.output_tokens), numero(u.cache_creation_input_tokens), numero(u.cache_read_input_tokens)] };
}

type Ouvinte = (hoje: GastoHoje | null) => void;

export class GastoTokens {
  private readonly o: OpcoesGasto;
  private readonly agora: () => number;
  private dias = new Map<string, DiaGasto>();
  private sujos = new Set<string>();
  private arquivos = new Map<string, EstadoArquivo>();
  private estadoSujo = false;
  private fila: Promise<unknown> = Promise.resolve();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private ouvintes = new Set<Ouvinte>();
  private ultimaAssinatura = "";
  private ultimaEmissao = 0;
  private timerEmitir: ReturnType<typeof setTimeout> | null = null;
  /** sessão → o que reler no próximo evento (depois de um Stop) */
  private reler = new Map<string, { alvos: Alvo[]; missao: Missao | null; ate: number }>();
  private avisadosGrandes = new Set<string>();
  /** missão → tokens ainda não gravados na nota */
  private pendenteNota = new Map<string, number>();
  private ultimaNota = new Map<string, number>();
  private parado = false;

  constructor(opts: OpcoesGasto) {
    this.o = opts;
    this.agora = opts.agora ?? (() => Date.now());
  }

  /** Carrega o que já foi contado (deslocamentos e o dia de hoje). Nunca lança. */
  async iniciar(): Promise<void> {
    try {
      const bruto = JSON.parse(await fsp.readFile(path.join(this.o.dir, ARQUIVO_ESTADO), "utf8")) as { arquivos?: Record<string, unknown> };
      for (const [k, v] of Object.entries(bruto.arquivos ?? {}).slice(-MAX_ARQUIVOS)) {
        const e = v as Partial<EstadoArquivo> | null;
        if (!e || typeof e.offset !== "number" || !(e.offset >= 0)) continue;
        const ids: EstadoArquivo["ids"] = {};
        for (const [id, t] of Object.entries(e.ids ?? {})) {
          if (Array.isArray(t) && t.length === 5 && /^\d{4}-\d{2}-\d{2}$/.test(String(t[0]))) {
            ids[id] = [String(t[0]), numero(t[1]), numero(t[2]), numero(t[3]), numero(t[4])];
          }
        }
        this.arquivos.set(k, { offset: Math.floor(e.offset), papel: papelSeguro(e.papel), ids });
      }
    } catch {
      // primeira vez ou arquivo ilegível: começa do zero
    }
    await this.carregarDia(diaLocal(this.agora()));
    this.ultimaAssinatura = JSON.stringify(this.getHoje());
  }

  getHoje(): GastoHoje | null {
    const d = this.dias.get(diaLocal(this.agora()));
    if (!d) return null;
    const porPapel: Record<string, GastoValores> = {};
    const total: GastoValores = { tokens: 0, cacheLeitura: 0 };
    for (const [papel, c] of Object.entries(d.porPapel)) {
      const v = { tokens: tokensDe(c), cacheLeitura: c.cacheLeitura };
      if (v.tokens === 0 && v.cacheLeitura === 0) continue;
      porPapel[papel] = v;
      total.tokens += v.tokens;
      total.cacheLeitura += v.cacheLeitura;
    }
    return Object.keys(porPapel).length > 0 ? { total, porPapel } : null;
  }

  subscribe(fn: Ouvinte): () => void {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  }

  /**
   * Chamado para cada evento de hook. Síncrono e leve: só decide o que ler e enfileira o resto. Nunca lança.
   * Stop / SubagentStop / SessionEnd leem na hora e (menos o SessionEnd) de novo ~1,5 s depois; o próximo evento da
   * sessão relê o que ficou pendente.
   */
  registrar(corpo: unknown): void {
    try {
      if (this.parado || !corpo || typeof corpo !== "object") return;
      const b = corpo as Record<string, unknown>;
      const evento = b.hook_event_name;
      const sid = typeof b.session_id === "string" ? b.session_id : "";
      const lider: Alvo = { caminho: b.transcript_path, papel: PAPEL_LIDER };
      if (evento === "Stop" || evento === "SubagentStop" || evento === "SessionEnd") {
        const alvos: Alvo[] = evento === "SubagentStop" ? [{ caminho: b.agent_transcript_path, papel: papelSeguro(b.agent_type) }, lider] : [lider];
        const fim = evento === "SessionEnd";
        const idMissao = sid ? (this.o.missaoDaSessao?.(sid) ?? null) : null;
        const missao: Missao | null = idMissao ? { id: idMissao, desde: this.o.missaoDesde?.(sid) ?? null } : null;
        if (sid) this.reler.delete(sid);
        this.enfileirar(() => this.lerAlvos(alvos, missao, fim));
        if (!fim) {
          if (sid) {
            this.reler.set(sid, { alvos, missao, ate: this.agora() + RELER_PRAZO_MS });
            while (this.reler.size > MAX_RELER) this.reler.delete(this.reler.keys().next().value as string);
          }
          const t = setTimeout(() => {
            this.timers.delete(t);
            this.enfileirar(() => this.lerAlvos(alvos, missao, false));
          }, this.o.esperaMs ?? ESPERA_STOP_MS);
          t.unref();
          this.timers.add(t);
        }
        return;
      }
      const pend = sid ? this.reler.get(sid) : undefined;
      if (pend) {
        this.reler.delete(sid);
        if (this.agora() <= pend.ate) this.enfileirar(() => this.lerAlvos(pend.alvos, pend.missao, false));
      }
    } catch {
      // nunca atrapalha o loop dos hooks
    }
  }

  /** Espera a fila de leituras (testes e desligamento). */
  esperar(): Promise<void> {
    return this.fila.then(() => undefined);
  }

  /** Desligando: grava o que falta na nota das missões e o estado (uma tentativa por missão). */
  async fechar(): Promise<void> {
    this.parar();
    await this.esperar();
    for (const id of [...this.pendenteNota.keys()]) await this.gravarNota(id, true);
    await this.gravarArquivos().catch(() => undefined);
  }

  parar() {
    this.parado = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.timerEmitir) clearTimeout(this.timerEmitir);
    this.timerEmitir = null;
  }

  // ---------------------------------------------------------------- interno

  private enfileirar(fn: () => Promise<void>) {
    this.fila = this.fila.then(fn).catch((err) => {
      console.warn("[gasto] erro ao ler o registro:", (err as NodeJS.ErrnoException | null)?.code ?? "erro");
    });
  }

  private async lerAlvos(alvos: Alvo[], missao: Missao | null, fimDaSessao: boolean) {
    const projetos = (this.o.projetosDir ?? (() => projetosDirPadrao()))();
    let mudou = false;
    for (const alvo of alvos) {
      const real = await caminhoPermitido(alvo.caminho, projetos);
      if (!real) continue;
      try {
        const r = await this.lerArquivo(real, alvo.papel, missao?.desde ?? null, missao !== null);
        if (r.mudou) mudou = true;
        if (missao && r.missao > 0) this.pendenteNota.set(missao.id, (this.pendenteNota.get(missao.id) ?? 0) + r.missao);
      } catch (err) {
        console.warn("[gasto] não consegui ler um registro:", (err as NodeJS.ErrnoException).code ?? "erro");
      }
    }
    if (mudou || this.estadoSujo) await this.gravarTudo();
    if (missao) await this.gravarNota(missao.id, fimDaSessao);
    if (mudou) this.notificar();
  }

  /**
   * Lê o que chegou depois do deslocamento. `missao` = tokens novos que contam para a nota da missão: só linhas com hora
   * >= `desde` (quando a sessão pediu a missão); sem `desde`, só o que chegou depois da primeira leitura do arquivo.
   */
  private async lerArquivo(real: string, papelDoAlvo: string, desde: number | null, querMissao: boolean): Promise<{ mudou: boolean; missao: number }> {
    let est = this.arquivos.get(real);
    const jaConhecido = est !== undefined;
    if (est) {
      this.arquivos.delete(real); // último uso vai para o fim: o descarte tira o mais parado, não o mais antigo
      if (est.papel === "outro" && papelDoAlvo !== "outro") est.papel = papelDoAlvo;
    } else {
      est = { offset: 0, papel: papelDoAlvo, ids: {} };
    }
    this.arquivos.set(real, est);
    while (this.arquivos.size > MAX_ARQUIVOS) this.arquivos.delete(this.arquivos.keys().next().value as string);
    const contaMissao = querMissao && (desde !== null || jaConhecido);
    const hoje = diaLocal(this.agora());
    let somaMissao = 0;
    let mudou = false;
    const lst = await fsp.lstat(real);
    if (lst.isSymbolicLink() || !lst.isFile()) return { mudou, missao: 0 };
    const fh = await fsp.open(real, "r");
    try {
      const st = await fh.stat();
      // o arquivo aberto tem de ser o mesmo que o lstat viu (troca no meio do caminho = ignora); no Windows o lstat dá dev 0
      if (st.ino !== lst.ino || (lst.dev !== 0 && st.dev !== 0 && st.dev !== lst.dev)) return { mudou, missao: 0 };
      const { size } = st;
      let alinhar = false;
      if (size - est.offset > MAX_BYTES_TRANSCRITO) {
        // registro grande: só os últimos 50 MB, começando na próxima quebra de linha (o resto NÃO é contado)
        if (!this.avisadosGrandes.has(real)) {
          this.avisadosGrandes.add(real);
          if (this.avisadosGrandes.size > MAX_ARQUIVOS) this.avisadosGrandes.delete(this.avisadosGrandes.values().next().value as string);
          console.warn("[gasto] registro com 50 MB ou mais: lendo só o final; o gasto anterior não entra na conta");
        }
        est.offset = size - MAX_BYTES_TRANSCRITO;
        alinhar = true;
        this.estadoSujo = true;
      }
      if (size < est.offset) {
        // arquivo reescrito/encurtado: não dá para saber o que já foi contado; segue do fim
        est.offset = size;
        this.estadoSujo = true;
        return { mudou, missao: 0 };
      }
      while (est.offset < size) {
        const buf = Buffer.alloc(Math.min(TRECHO_BYTES, size - est.offset));
        const { bytesRead } = await fh.read(buf, 0, buf.length, est.offset);
        if (bytesRead <= 0) break;
        const fimDoArquivo = est.offset + bytesRead >= size;
        if (alinhar) {
          // começo no meio do arquivo: joga fora a linha cortada ao meio e recomeça na seguinte
          const q = buf.subarray(0, bytesRead).indexOf(0x0a);
          if (q >= 0) {
            alinhar = false;
            est.offset += q + 1;
          } else if (fimDoArquivo) {
            break;
          } else {
            est.offset += bytesRead;
          }
          continue;
        }
        // corta na última quebra de linha em BYTES (um caractere acentuado nunca fica pela metade)
        let usar = buf.subarray(0, bytesRead).lastIndexOf(0x0a) + 1;
        if (usar === 0) {
          if (!fimDoArquivo) {
            if (bytesRead >= TRECHO_BYTES) {
              est.offset += bytesRead; // linha gigante, sem quebra: pula
              this.estadoSujo = true;
              continue;
            }
            break;
          }
          // última linha sem "\n": só vale se já estiver completa
          if (!this.linhaCompleta(buf.toString("utf8", 0, bytesRead))) break;
          usar = bytesRead;
        }
        for (const linha of buf.toString("utf8", 0, usar).split("\n")) {
          const u = lerLinhaDeUso(linha);
          if (!u) continue;
          const dia = est.ids[u.id]?.[0] ?? (diaLocal(u.ts) || hoje);
          if (!this.dias.has(dia)) await this.carregarDia(dia);
          const delta = this.aplicar(est, u, dia);
          if (delta !== null) {
            mudou = true;
            if (contaMissao && (desde === null || u.ts >= desde)) somaMissao += delta;
          }
        }
        est.offset += usar;
        this.estadoSujo = true;
      }
    } finally {
      await fh.close().catch(() => undefined);
    }
    return { mudou, missao: somaMissao };
  }

  private linhaCompleta(txt: string): boolean {
    try {
      JSON.parse(txt);
      return true;
    } catch {
      return false;
    }
  }

  /** Soma a diferença desta linha (maior valor por campo, por message.id). Devolve os tokens novos, ou null se nada mudou. */
  private aplicar(est: EstadoArquivo, u: LinhaUso, dia: string): number | null {
    const prev = est.ids[u.id];
    const antes: Quatro = prev ? [prev[1], prev[2], prev[3], prev[4]] : [0, 0, 0, 0];
    const novo = u.v.map((x, i) => Math.max(x, antes[i])) as Quatro;
    const d = novo.map((x, i) => x - antes[i]);
    delete est.ids[u.id];
    est.ids[u.id] = [dia, ...novo];
    const chaves = Object.keys(est.ids);
    if (chaves.length > MAX_IDS_POR_ARQUIVO) for (const k of chaves.slice(0, chaves.length - MAX_IDS_POR_ARQUIVO)) delete est.ids[k];
    if (d.every((x) => x === 0)) return null;
    let dg = this.dias.get(dia);
    if (!dg) {
      dg = { dia, porPapel: {} };
      this.dias.set(dia, dg);
    }
    const c = (dg.porPapel[est.papel] ??= vazia());
    c.entrada += d[0];
    c.saida += d[1];
    c.cacheCriacao += d[2];
    c.cacheLeitura += d[3];
    this.sujos.add(dia);
    return d[0] + d[1] + d[2];
  }

  private async carregarDia(dia: string) {
    if (this.dias.has(dia)) return;
    try {
      const j = JSON.parse(await fsp.readFile(path.join(this.o.dir, `${dia}.json`), "utf8")) as { porPapel?: Record<string, Partial<Contagem>> };
      const d: DiaGasto = { dia, porPapel: {} };
      for (const [p, c] of Object.entries(j.porPapel ?? {})) {
        d.porPapel[papelSeguro(p)] = { entrada: numero(c?.entrada), saida: numero(c?.saida), cacheCriacao: numero(c?.cacheCriacao), cacheLeitura: numero(c?.cacheLeitura) };
      }
      this.dias.set(dia, d);
    } catch {
      // sem arquivo ainda
    }
  }

  /** totais dos dias primeiro, deslocamentos depois (uma queda no meio recontaria um pouco, nunca perderia o que já foi somado) */
  private async gravarTudo() {
    for (const dia of [...this.sujos]) {
      const d = this.dias.get(dia);
      if (d) await writeAtomic(path.join(this.o.dir, `${dia}.json`), JSON.stringify(d));
      this.sujos.delete(dia);
    }
    await this.gravarArquivos();
  }

  private async gravarArquivos() {
    if (!this.estadoSujo) return;
    this.estadoSujo = false;
    await writeAtomic(path.join(this.o.dir, ARQUIVO_ESTADO), JSON.stringify({ arquivos: Object.fromEntries(this.arquivos) }));
  }

  /** No máximo 1 vez por minuto por missão (ou `forcar`), só se há valor novo. Conflito/erro: guarda para a próxima. */
  private async gravarNota(missao: string, forcar: boolean) {
    const pend = this.pendenteNota.get(missao) ?? 0;
    const vault = this.o.vault?.() ?? null;
    if (pend <= 0 || !vault) return;
    const t = this.agora();
    if (!forcar && t - (this.ultimaNota.get(missao) ?? 0) < (this.o.notaIntervaloMs ?? NOTA_INTERVALO_MS)) return;
    this.ultimaNota.set(missao, t);
    try {
      const r = await somarTokensNaMissao(vault, missao, pend, { agora: () => new Date(t) });
      if (r !== "conflito") this.pendenteNota.delete(missao);
    } catch (err) {
      console.warn("[gasto] não consegui gravar na nota da missão:", (err as NodeJS.ErrnoException).code ?? "erro");
    }
  }

  private notificar() {
    if (this.parado || this.ouvintes.size === 0) return;
    const espera = (this.o.emitirMs ?? EMITIR_MS) - (this.agora() - this.ultimaEmissao);
    if (espera > 0) {
      if (!this.timerEmitir) {
        this.timerEmitir = setTimeout(() => {
          this.timerEmitir = null;
          this.notificar();
        }, espera);
        this.timerEmitir.unref();
      }
      return;
    }
    const hoje = this.getHoje();
    const assinatura = JSON.stringify(hoje);
    if (assinatura === this.ultimaAssinatura) return;
    this.ultimaAssinatura = assinatura;
    this.ultimaEmissao = this.agora();
    for (const fn of this.ouvintes) {
      try {
        fn(hoje);
      } catch (err) {
        console.error("[gasto] erro num ouvinte:", err);
      }
    }
  }
}
