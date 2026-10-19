// Log da Transparência: data/transparencia/AAAA-MM.jsonl (uma linha por abertura de arquivo do vault, SEM conteúdo),
// a API (GET /api/transparencia, POST /api/transparencia/exportar) e o resumo que vai pelo WebSocket.
//
// Regras: `registrar` NUNCA lança nem espera (é chamado na fila dos hooks, que não pode atrasar): a gravação é
// uma corrente de promessas em segundo plano; se falhar, só avisa no log do servidor (no máximo 1 aviso por minuto).

import express, { type Express } from "express";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  CAMPOS_REGISTRO,
  MAX_RECENTES,
  NOTA_LIMITE,
  resumoVazio,
  type Acao,
  type Nivel,
  type RegistroTransparencia,
  type ResumoTransparencia,
} from "../shared/transparencia.ts";
import { DATA_DIR, writeAtomic } from "./roster.ts";
import { exigirHostLocal, exigirPostSeguro } from "./seguranca.ts";
import { classificarEvento, type ContextoTransparencia } from "./transparencia.ts";

export const DIR_TRANSPARENCIA = path.join(DATA_DIR, "transparencia");
/** linhas devolvidas por GET /api/transparencia */
export const MAX_LINHAS_API = 100;
/** linhas no .md exportado */
export const MAX_LINHAS_EXPORTAR = 500;
/** lê no máximo o final de um arquivo deste tamanho (um mês enorme não trava o servidor) */
const MAX_BYTES_LEITURA = 8 * 1024 * 1024;
export const THROTTLE_MS = 1000;
const AVISO_A_CADA_MS = 60_000;

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
export const ehMes = (v: unknown): v is string => typeof v === "string" && MES.test(v);

const NIVEIS: readonly string[] = ["normal", "informativo", "violacao"];
const ACOES: readonly string[] = ["leu", "escreveu", "editou", "buscou"];

/** "AAAA-MM" do instante, pelo relógio local */
export function mesDe(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Uma linha do .jsonl → registro, ou null se estiver quebrada. Só os campos conhecidos passam. */
export function lerLinha(bruta: string): RegistroTransparencia | null {
  let o: unknown;
  try {
    o = JSON.parse(bruta);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (
    typeof r.ts !== "number" ||
    !Number.isFinite(r.ts) ||
    typeof r.sessao !== "string" ||
    typeof r.agente !== "string" ||
    typeof r.ferramenta !== "string" ||
    typeof r.acao !== "string" ||
    !ACOES.includes(r.acao) ||
    typeof r.arquivo !== "string" ||
    typeof r.confidencial !== "boolean" ||
    !(r.missao === null || typeof r.missao === "string") ||
    typeof r.nivel !== "string" ||
    !NIVEIS.includes(r.nivel)
  ) {
    return null;
  }
  return {
    ts: r.ts,
    sessao: r.sessao,
    agente: r.agente,
    ferramenta: r.ferramenta,
    acao: r.acao as Acao,
    arquivo: r.arquivo,
    confidencial: r.confidencial,
    missao: r.missao,
    via: "PreToolUse",
    nivel: r.nivel as Nivel,
  };
}

/** a linha do .jsonl: exatamente os campos do registro, na ordem fixa */
export function linhaJsonl(r: RegistroTransparencia): string {
  const saida: Record<string, unknown> = {};
  for (const k of CAMPOS_REGISTRO) saida[k] = r[k];
  return JSON.stringify(saida) + "\n";
}

export interface ResumoDoMes {
  mes: string;
  total: number;
  normais: number;
  informativos: number;
  violacoes: number;
  porAcao: Record<Acao, number>;
  /** a violação mais recente (instante) ou null */
  ultimaViolacao: number | null;
  /** as últimas linhas, da mais antiga para a mais nova */
  linhas: RegistroTransparencia[];
}

/** Conta as linhas de um mês (função pura). `max` = quantas linhas finais devolver. */
export function resumirLinhas(mes: string, registros: readonly RegistroTransparencia[], max: number): ResumoDoMes {
  const r: ResumoDoMes = {
    mes,
    total: registros.length,
    normais: 0,
    informativos: 0,
    violacoes: 0,
    porAcao: { leu: 0, escreveu: 0, editou: 0, buscou: 0 },
    ultimaViolacao: null,
    linhas: registros.slice(-max),
  };
  for (const x of registros) {
    if (x.nivel === "violacao") {
      r.violacoes++;
      r.ultimaViolacao = x.ts;
    } else if (x.nivel === "informativo") r.informativos++;
    else r.normais++;
    r.porAcao[x.acao]++;
  }
  return r;
}

/** o .md exportado: contagens e a lista. Só caminhos relativos ao vault e ações; nada de conteúdo. */
export function montarMd(resumo: ResumoDoMes, atas: AtasDoMes): string {
  const celula = (s: string) => s.replace(/[|\r\n]/g, " ");
  const hora = (ts: number) => {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const nome: Record<Nivel, string> = { normal: "normal", informativo: "esperado (/reuniao)", violacao: "ATENÇÃO: nota confidencial" };
  const out = [
    `# Transparência — ${resumo.mes}`,
    "",
    `> ${NOTA_LIMITE}`,
    "",
    `- Aberturas de arquivo do vault registradas: ${resumo.total}`,
    `- Esperadas (a reunião /reuniao abriu a ata): ${resumo.informativos}`,
    `- Com atenção (agente leu nota confidencial): ${resumo.violacoes}`,
    `- Atas processadas sem IA: ${atas.semIa}`,
    `- Atas processadas com IA (/reuniao): ${atas.comIa}`,
    "",
  ];
  if (resumo.violacoes > 0) {
    out.push("**ATENÇÃO: um agente leu uma nota confidencial neste mês. Veja as linhas marcadas abaixo.**", "");
  }
  if (resumo.linhas.length === 0) {
    out.push("Nenhum registro neste mês.", "");
    return out.join("\n");
  }
  out.push(
    resumo.total > resumo.linhas.length ? `Últimos ${resumo.linhas.length} registros (de ${resumo.total}):` : "Registros:",
    "",
    "| Quando | Agente | Ação | Arquivo | Situação |",
    "|---|---|---|---|---|",
  );
  for (const x of [...resumo.linhas].reverse()) {
    out.push(`| ${hora(x.ts)} | ${celula(x.agente)} | ${x.acao} | ${celula(x.arquivo)} | ${nome[x.nivel]} |`);
  }
  out.push("");
  return out.join("\n");
}

type Ouvinte = (r: ResumoTransparencia) => void;

export interface LogTransparenciaOpcoes {
  dir?: string;
  now?: () => number;
  throttleMs?: number;
}

export class LogTransparencia {
  readonly dir: string;
  private readonly now: () => number;
  private readonly throttleMs: number;
  private readonly contexto: () => ContextoTransparencia;
  private corrente: Promise<void> = Promise.resolve();
  private ouvintes = new Set<Ouvinte>();
  private resumo: ResumoTransparencia;
  private ultimoAviso = 0;
  private ultimoEnvio = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  pronto: Promise<void> = Promise.resolve();

  constructor(contexto: () => ContextoTransparencia, opts: LogTransparenciaOpcoes = {}) {
    this.contexto = contexto;
    this.dir = opts.dir ?? DIR_TRANSPARENCIA;
    this.now = opts.now ?? (() => Date.now());
    this.throttleMs = opts.throttleMs ?? THROTTLE_MS;
    this.resumo = resumoVazio(mesDe(this.now()));
  }

  /** Lê o mês atual do disco para o resumo (o que já foi gravado antes de um reinício). Nunca lança. */
  iniciar(): Promise<void> {
    this.pronto = (async () => {
      try {
        const mes = mesDe(this.now());
        const s = resumirLinhas(mes, await this.lerMes(mes), MAX_RECENTES);
        this.resumo = this.paraResumo(s);
      } catch (err) {
        this.avisar("não consegui ler o log do mês", err);
      }
    })();
    return this.pronto;
  }

  parar() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getResumo(): ResumoTransparencia {
    return this.resumo;
  }

  subscribe(fn: Ouvinte): () => void {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  }

  /** Resolve quando as gravações pedidas até agora terminaram (testes e desligamento). */
  esperarGravacoes(): Promise<void> {
    return this.corrente;
  }

  /**
   * Chamado para TODO evento de hook, antes do state.handleHook. Não espera nada e não lança.
   * Devolve o registro (testes) ou null.
   */
  registrar(evento: unknown): RegistroTransparencia | null {
    try {
      const reg = classificarEvento(evento, { ...this.contexto(), agora: this.now });
      if (!reg) return null;
      this.gravar(reg);
      this.contar(reg);
      return reg;
    } catch (err) {
      this.avisar("erro ao registrar", err);
      return null;
    }
  }

  /** As linhas de um mês (as quebradas são ignoradas). Espera as gravações pendentes. */
  async lerMes(mes: string): Promise<RegistroTransparencia[]> {
    await this.corrente;
    const arquivo = path.join(this.dir, `${mes}.jsonl`);
    let texto: string;
    try {
      const st = await fsp.stat(arquivo);
      if (st.size <= MAX_BYTES_LEITURA) texto = await fsp.readFile(arquivo, "utf8");
      else {
        const fh = await fsp.open(arquivo, "r");
        try {
          const buf = Buffer.alloc(MAX_BYTES_LEITURA);
          const { bytesRead } = await fh.read(buf, 0, MAX_BYTES_LEITURA, st.size - MAX_BYTES_LEITURA);
          texto = buf.subarray(0, bytesRead).toString("utf8");
          texto = texto.slice(texto.indexOf("\n") + 1); // a primeira linha pode estar cortada
        } finally {
          await fh.close();
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const out: RegistroTransparencia[] = [];
    for (const l of texto.split("\n")) {
      if (!l) continue;
      const r = lerLinha(l);
      if (r) out.push(r);
    }
    return out;
  }

  // ---------------------------------------------------------------- interno

  private gravar(reg: RegistroTransparencia) {
    const arquivo = path.join(this.dir, `${mesDe(reg.ts)}.jsonl`);
    const linha = linhaJsonl(reg);
    this.corrente = this.corrente.then(async () => {
      try {
        try {
          await fsp.appendFile(arquivo, linha, "utf8");
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          await fsp.mkdir(this.dir, { recursive: true });
          await fsp.appendFile(arquivo, linha, "utf8");
        }
      } catch (err) {
        this.avisar("não consegui gravar o log", err);
      }
    });
  }

  private paraResumo(s: ResumoDoMes): ResumoTransparencia {
    return { mes: s.mes, total: s.total, normais: s.normais, informativos: s.informativos, violacoes: s.violacoes, recentes: s.linhas };
  }

  private contar(reg: RegistroTransparencia) {
    const mes = mesDe(reg.ts);
    if (this.resumo.mes !== mes) this.resumo = resumoVazio(mes);
    const r = this.resumo;
    r.total++;
    if (reg.nivel === "violacao") r.violacoes++;
    else if (reg.nivel === "informativo") r.informativos++;
    else r.normais++;
    r.recentes = [...r.recentes, reg].slice(-MAX_RECENTES);
    this.avisarOuvintes(reg.nivel === "violacao");
  }

  /** no máximo 1 mensagem por throttleMs (a última sempre sai); uma violação sai na hora */
  private avisarOuvintes(urgente: boolean) {
    const agora = this.now();
    if (urgente || agora - this.ultimoEnvio >= this.throttleMs) {
      this.enviar();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.enviar();
    }, Math.max(0, this.throttleMs - (agora - this.ultimoEnvio)));
    this.timer.unref();
  }

  private enviar() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ultimoEnvio = this.now();
    for (const fn of this.ouvintes) {
      try {
        fn(this.resumo);
      } catch (err) {
        console.error("[transparencia] erro num ouvinte:", err);
      }
    }
  }

  private avisar(msg: string, err: unknown) {
    const agora = Date.now();
    if (agora - this.ultimoAviso < AVISO_A_CADA_MS) return;
    this.ultimoAviso = agora;
    console.warn(`[transparencia] ${msg}:`, err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------- rotas

/** quantas atas foram lidas sem IA e com IA num mês (varredura de Resultados) */
export interface AtasDoMes {
  semIa: number;
  comIa: number;
}

export interface RotasTransparenciaDeps {
  log: LogTransparencia;
  /** atas do mês, da varredura de Resultados (server/resultados.ts) */
  atasDoMes: (mes: string) => AtasDoMes;
  porta: () => number;
  now?: () => number;
}

export function registrarTransparencia(app: Express, deps: RotasTransparenciaDeps) {
  const now = deps.now ?? (() => Date.now());

  // só LÊ o log: nada aqui chama o Claude
  app.get("/api/transparencia", exigirHostLocal(deps.porta), async (req, res) => {
    const pedido = req.query.mes;
    const mes = pedido === undefined ? mesDe(now()) : pedido;
    if (!ehMes(mes)) {
      res.status(400).json({ ok: false, erros: ["Mês inválido: use AAAA-MM"] });
      return;
    }
    try {
      const s = resumirLinhas(mes, await deps.log.lerMes(mes), MAX_LINHAS_API);
      res.json({
        ok: true,
        mes,
        linhas: s.linhas,
        contagens: { total: s.total, normais: s.normais, informativos: s.informativos, violacoes: s.violacoes, porAcao: s.porAcao },
        alerta: { violacao: s.violacoes > 0, violacoes: s.violacoes, ultima: s.ultimaViolacao },
        atas: deps.atasDoMes(mes),
        nota: NOTA_LIMITE,
      });
    } catch (err) {
      console.error("[transparencia] erro ao ler o log:", err instanceof Error ? err.message : err);
      res.status(500).json({ ok: false, erros: ["Não consegui ler o registro. Tente de novo."] });
    }
  });

  app.post("/api/transparencia/exportar", exigirPostSeguro(deps.porta), express.json({ limit: "1kb" }), async (req, res) => {
    const pedido = (req.body as { mes?: unknown } | undefined)?.mes;
    const mes = pedido === undefined ? mesDe(now()) : pedido;
    if (!ehMes(mes)) {
      res.status(400).json({ ok: false, erros: ["Mês inválido: use AAAA-MM"] });
      return;
    }
    try {
      const s = resumirLinhas(mes, await deps.log.lerMes(mes), MAX_LINHAS_EXPORTAR);
      const texto = montarMd(s, deps.atasDoMes(mes));
      const arquivo = `${mes}.md`;
      await writeAtomic(path.join(deps.log.dir, arquivo), texto);
      res.json({ ok: true, arquivo, texto });
    } catch (err) {
      console.error("[transparencia] erro ao exportar:", err instanceof Error ? err.message : err);
      res.status(500).json({ ok: false, erros: ["Não consegui salvar o resumo. Tente de novo."] });
    }
  });
}
