// Pendências: as tarefas em aberto (`- [ ]`) de 10-Reunioes/ e 20-Missoes/, com prazo e dono, para o painel.
//
// O que entra:
//   - Reunião (tipo: reuniao): só linha `- [ ]` com `classe: eu` (a tarefa que ficou com você). As de `classe: time`
//     já foram copiadas para a missão da reunião, e as de `classe: ?` ainda esperam a Caixa de entrada.
//   - Missão (tipo: missao, não concluída e não confidencial): toda linha `- [ ]`. O dono é o time; missão criada
//     pelo /reuniao com `classe: humano` ou `duvida` fica com você (dono = eu).
// Limitação: a tabela de `## Tarefas` do /reuniao (colunas com `|`, sem checkbox) NÃO entra, só linhas `- [ ] ...`.
//
// Privacidade: como na Caixa, a nota de reunião é confidencial só no corpo. O painel recebe título da nota, texto,
// responsável e prazo da tarefa; pauta, decisões, dúvidas e transcrição nunca saem daqui. Nada vai para o Claude e
// o servidor nunca roda o Claude.
//
// Observador no mesmo padrão do ObservadorCaixa: stat primeiro (cache por data e tamanho), fs.watch só agenda uma
// releitura completa (debounce) e um relógio de 30 s religa o watch (e vira a urgência na virada do dia).
//
// Concluir (POST /api/pendencias/concluir): marca `- [x]` e acrescenta `| concluída: AAAA-MM-DD` na linha. Confere
// o hash da linha inteira (409 se a nota mudou), lstat antes de gravar (409 se mudou no meio), mantém CRLF e BOM.
// O id nunca é caminho: só `r|m`, nome da nota (letras, números, `_`, espaço e hífen), posição e hash.
// A missão NÃO muda de status quando todas as tarefas ficam feitas (fica para a Etapa 4).

import express, { type Express } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { diaLocal, ehDataValida } from "../shared/datas.ts";
import { urgenciaDe } from "../shared/prazos.ts";
import type { Pendencia, PendenciaDono } from "../shared/types.ts";
import { MAX_BYTES_NOTA, hashTarefa, lerTarefasDaNota, tituloDe } from "./caixa.ts";
import { writeAtomic } from "./roster.ts";
import { exigirHostLocal, exigirPostSeguro } from "./seguranca.ts";
import { chave, cortar, lerFrontmatter, semLinks, temConfidencialTrue } from "./vault.ts";

const MAX_PENDENCIAS = 100;
const MAX_TEXTO = 140;
const MAX_TITULO = 120;
const MAX_RESPONSAVEL = 60;
const MAX_NOME = 120;
const DEBOUNCE_MS = 800;
const INTERVALO_MS = 30_000;

export type Pasta = "r" | "m";
const DIRETORIO: Record<Pasta, string> = { r: "10-Reunioes", m: "20-Missoes" };
const MSG_NOTA_MUDOU = "A nota mudou, tente de novo";

/** nome da nota: sem barra, sem ponto, sem ":" (o id usa ":" como separador) e sem espaço nas pontas */
const NOME_NOTA = /^[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+)*$/u;
const ID_PENDENCIA = /^([rm]):([^:]+):(\d{1,4}):([0-9a-f]{8})$/;

export function nomeNotaValido(nome: string): boolean {
  return nome.length > 0 && nome.length <= MAX_NOME && NOME_NOTA.test(nome);
}

export type PendenciaBruta = Omit<Pendencia, "urgencia">;

// ---------------------------------------------------------------- leitura de uma nota

/** As pendências de uma nota (já sem urgência: ela depende do dia). Vazio se a nota não conta. */
export function lerPendenciasDaNota(pasta: Pasta, nomeArquivo: string, texto: string): PendenciaBruta[] {
  const nota = nomeArquivo.replace(/\.md$/i, "").normalize("NFC");
  if (!nomeNotaValido(nota)) return [];
  const fm = lerFrontmatter(texto);
  if (!fm) return [];
  const tipo = chave(fm.tipo ?? "");
  if (tipo !== (pasta === "r" ? "reuniao" : "missao")) return [];

  let donoMissao: PendenciaDono = "time";
  let status: PendenciaBruta["status"] = "a fazer";
  if (pasta === "m") {
    if (temConfidencialTrue(texto)) return [];
    const st = chave(fm.status ?? "");
    if (st === "concluida") return [];
    if (st === "em andamento") status = "em andamento";
    const classe = chave(fm.classe ?? "");
    if (classe === "humano" || classe === "duvida") donoMissao = "eu";
  }

  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/);
  const origem = cortar(semLinks(pasta === "m" ? fm.reuniao_titulo ?? "" : "") || tituloDe(linhas) || nota, MAX_TITULO);
  const out: PendenciaBruta[] = [];
  for (const t of lerTarefasDaNota(linhas)) {
    if (t.marca !== " ") continue;
    if (pasta === "r" && chave(t.classe) !== "eu") continue;
    out.push({
      id: `${pasta}:${nota}:${t.n}:${hashTarefa(t.texto)}`,
      h: hashTarefa(linhas[t.indice]),
      texto: cortar(semLinks(t.texto) || t.texto, MAX_TEXTO),
      responsavel: cortar(semLinks(t.responsavel), MAX_RESPONSAVEL),
      prazo: ehDataValida(t.prazo) ? t.prazo.trim() : "",
      origem,
      dono: pasta === "r" ? "eu" : donoMissao,
      status,
    });
  }
  return out;
}

const PESO = { atrasada: 0, logo: 1, "no-prazo": 2, "sem-prazo": 3 } as const;

/** Acrescenta a urgência e ordena: atrasadas, vencem logo, no prazo (pelo prazo), sem prazo. Corta em MAX_PENDENCIAS. */
export function montarPendencias(brutas: readonly PendenciaBruta[], hoje: string): Pendencia[] {
  return brutas
    .map((b): Pendencia => ({ ...b, urgencia: urgenciaDe(b.prazo, hoje) }))
    .sort(
      (a, b) =>
        PESO[a.urgencia] - PESO[b.urgencia] ||
        (a.prazo < b.prazo ? -1 : a.prazo > b.prazo ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, MAX_PENDENCIAS);
}

// ---------------------------------------------------------------- observador

export interface ObservadorPendenciasOpcoes {
  debounceMs?: number;
  /** 0 desliga a rede de segurança (testes) */
  intervaloMs?: number;
  /** não liga o fs.watch (testes) */
  semWatch?: boolean;
  now?: () => Date;
}

type Ouvinte = (itens: Pendencia[]) => void;

export class ObservadorPendencias {
  private readonly resolver: () => string | null;
  private readonly debounceMs: number;
  private readonly intervaloMs: number;
  private readonly semWatch: boolean;
  private readonly now: () => Date;

  private caminho: string | null = null;
  private watchers = new Map<Pasta, fs.FSWatcher>();
  private ouvintes = new Set<Ouvinte>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalo: ReturnType<typeof setInterval> | null = null;
  private emCurso: Promise<void> | null = null;
  private pendente = false;
  private parado = false;

  /** "r:nome.md" → último resultado bom (mantido se a leitura falhar) */
  private cache = new Map<string, { mtime: number; size: number; itens: PendenciaBruta[] }>();
  private itens: Pendencia[] = [];
  private assinatura = "[]";
  pronto: Promise<void> = Promise.resolve();

  constructor(resolver: () => string | null, opts: ObservadorPendenciasOpcoes = {}) {
    this.resolver = resolver;
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
    this.intervaloMs = opts.intervaloMs ?? INTERVALO_MS;
    this.semWatch = opts.semWatch ?? false;
    this.now = opts.now ?? (() => new Date());
  }

  iniciar(): Promise<void> {
    this.parado = false;
    this.pronto = this.recarregar();
    if (this.intervaloMs > 0 && !this.intervalo) {
      this.intervalo = setInterval(() => void this.recarregar(), this.intervaloMs);
      this.intervalo.unref();
    }
    return this.pronto;
  }

  parar() {
    this.parado = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.intervalo) clearInterval(this.intervalo);
    this.intervalo = null;
    this.fecharWatch();
  }

  getItens(): Pendencia[] {
    return this.itens;
  }

  subscribe(fn: Ouvinte): () => void {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  }

  /** Releitura completa. Uma por vez: pedido no meio da leitura agenda outra logo depois. */
  recarregar(): Promise<void> {
    if (this.emCurso) {
      this.pendente = true;
      return this.emCurso;
    }
    const rodar = async () => {
      try {
        do {
          this.pendente = false;
          try {
            await this.ler();
          } catch (err) {
            console.warn("[pendencias] erro ao ler reuniões e missões:", err instanceof Error ? err.message : err);
          }
        } while (this.pendente && !this.parado);
      } finally {
        this.emCurso = null;
      }
    };
    this.emCurso = rodar();
    return this.emCurso;
  }

  // ---------------------------------------------------------------- interno

  private agendar() {
    if (this.parado) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.recarregar();
    }, this.debounceMs);
    this.timer.unref();
  }

  private fecharWatch() {
    for (const w of this.watchers.values()) {
      try {
        w.close();
      } catch {
        // já fechado
      }
    }
    this.watchers.clear();
  }

  private ligarWatch(pasta: Pasta, dir: string) {
    if (this.semWatch || this.parado || this.watchers.has(pasta)) return;
    try {
      const w = fs.watch(dir, { persistent: false }, () => this.agendar());
      w.on("error", () => {
        try {
          w.close();
        } catch {
          // já fechado
        }
        if (this.watchers.get(pasta) === w) this.watchers.delete(pasta); // o relógio de 30 s religa
      });
      this.watchers.set(pasta, w);
    } catch {
      // pasta ainda não existe: o relógio tenta de novo
    }
  }

  /** Relê uma pasta. `false` = pasta ocupada (mantém o que tinha); `true` = leu (ou ela não existe e foi esvaziada). */
  private async lerPasta(pasta: Pasta, dir: string) {
    this.ligarWatch(pasta, dir);
    let entradas: fs.Dirent[];
    try {
      entradas = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        for (const k of [...this.cache.keys()]) if (k.startsWith(`${pasta}:`)) this.cache.delete(k);
      }
      return; // outro erro (pasta ocupada): mantém
    }
    const nomes = entradas.filter((e) => e.isFile() && /\.md$/i.test(e.name)).map((e) => e.name);
    const vistos = new Set(nomes.map((n) => `${pasta}:${n}`));
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${pasta}:`) && !vistos.has(k)) this.cache.delete(k);
    for (const nome of nomes) {
      const k = `${pasta}:${nome}`;
      try {
        const arq = path.join(dir, nome);
        const st = await fsp.stat(arq);
        const mtime = Math.floor(st.mtimeMs);
        const antes = this.cache.get(k);
        if (antes && antes.mtime === mtime && antes.size === st.size) continue; // não abre de novo
        if (st.size > MAX_BYTES_NOTA) {
          this.cache.set(k, { mtime, size: st.size, itens: [] });
          continue;
        }
        const texto = await fsp.readFile(arq, "utf8");
        this.cache.set(k, { mtime, size: st.size, itens: lerPendenciasDaNota(pasta, nome, texto) });
      } catch {
        // EBUSY, "só online" do OneDrive...: fica o valor anterior
      }
    }
  }

  private async ler() {
    const vault = this.resolver();
    if (vault !== this.caminho) {
      this.fecharWatch();
      this.cache.clear();
      this.caminho = vault;
    }
    if (vault) {
      for (const pasta of ["r", "m"] as const) await this.lerPasta(pasta, path.join(vault, DIRETORIO[pasta]));
    }
    const brutas = vault ? [...this.cache.values()].flatMap((c) => c.itens) : [];
    this.itens = montarPendencias(brutas, diaLocal(this.now().getTime()));
    this.publicar();
  }

  private publicar() {
    const assinatura = JSON.stringify(this.itens);
    if (assinatura === this.assinatura) return;
    this.assinatura = assinatura;
    for (const fn of this.ouvintes) {
      try {
        fn(this.itens);
      } catch (err) {
        console.error("[pendencias] erro num ouvinte:", err);
      }
    }
  }
}

// ---------------------------------------------------------------- concluir

export type RespostaConclusao = { status: 200; corpo: { ok: true; concluidaEm: string } } | { status: number; corpo: { ok: false; erros: string[] } };

function erro(status: number, ...erros: string[]): RespostaConclusao {
  return { status, corpo: { ok: false, erros } };
}

export interface CorpoConclusao {
  pasta: Pasta;
  nota: string;
  n: number;
  hTexto: string;
  h: string;
}

/** Confere o corpo do POST sem confiar em nada. */
export function validarConclusao(corpo: unknown): { ok: true; valor: CorpoConclusao } | { ok: false; erros: string[] } {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { ok: false, erros: ["Corpo inválido"] };
  const { id, h } = corpo as { id?: unknown; h?: unknown };
  if (typeof id !== "string" || id.length > MAX_NOME + 20) return { ok: false, erros: ["Pendência inválida"] };
  const m = ID_PENDENCIA.exec(id.normalize("NFC"));
  if (!m || !nomeNotaValido(m[2])) return { ok: false, erros: ["Pendência inválida"] };
  const n = Number(m[3]);
  if (n < 1 || n > 1000) return { ok: false, erros: ["Pendência inválida"] };
  if (typeof h !== "string" || !/^[0-9a-f]{8}$/.test(h)) return { ok: false, erros: ["Conferência da pendência inválida"] };
  return { ok: true, valor: { pasta: m[1] as Pasta, nota: m[2], n, hTexto: m[4], h } };
}

/** uma conclusão por vez: dois cliques não gravam por cima um do outro */
let fila: Promise<unknown> = Promise.resolve();

function naFila<T>(fn: () => Promise<T>): Promise<T> {
  const rodar = fila.then(fn, fn);
  fila = rodar.catch(() => undefined);
  return rodar;
}

const LINHA_ABERTA = /^(\s*[-*]\s+\[) (\]\s+)(\S.*?)\s*$/;

export interface ConcluirOpcoes {
  now?: () => Date;
  /** só para teste: roda logo antes da conferência final da nota (simula edição no meio) */
  antesDeGravar?: () => void | Promise<void>;
}

export function concluirPendencia(vault: string, corpo: unknown, opts: ConcluirOpcoes = {}): Promise<RespostaConclusao> {
  const v = validarConclusao(corpo);
  if (!v.ok) return Promise.resolve(erro(400, ...v.erros));
  return naFila(() => concluir(vault, v.valor, opts.now ?? (() => new Date()), opts.antesDeGravar));
}

async function concluir(vault: string, c: CorpoConclusao, now: () => Date, antesDeGravar?: () => void | Promise<void>): Promise<RespostaConclusao> {
  // o nome já passou pela regex (sem barra, ponto nem ":"): o arquivo só pode estar dentro da pasta certa
  const arquivo = path.join(vault, DIRETORIO[c.pasta], `${c.nota}.md`);

  let st;
  try {
    st = await fsp.lstat(arquivo);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return erro(404, "Não achei essa nota");
    throw err;
  }
  if (!st.isFile()) return erro(400, "Nota inválida");
  if (st.size > MAX_BYTES_NOTA) return erro(400, "A nota é grande demais para concluir pelo painel");

  const bruto = await fsp.readFile(arquivo, "utf8");
  const temBom = bruto.charCodeAt(0) === 0xfeff;
  const nl = bruto.includes("\r\n") ? "\r\n" : "\n";
  const linhas = (temBom ? bruto.slice(1) : bruto).split(/\r?\n/);

  // a pendência tem que ser exatamente a que o painel mostrou: mesma posição, mesmo texto, mesma linha
  const t = lerTarefasDaNota(linhas).find((x) => x.n === c.n);
  const nota = lerPendenciasDaNota(c.pasta, `${c.nota}.md`, bruto);
  if (
    !t ||
    t.marca !== " " ||
    hashTarefa(t.texto) !== c.hTexto ||
    hashTarefa(linhas[t.indice]) !== c.h ||
    !nota.some((p) => p.id === `${c.pasta}:${c.nota}:${c.n}:${c.hTexto}`)
  ) {
    return erro(409, MSG_NOTA_MUDOU);
  }
  const m = LINHA_ABERTA.exec(linhas[t.indice]);
  if (!m) return erro(409, MSG_NOTA_MUDOU);

  const hoje = diaLocal(now().getTime());
  linhas[t.indice] = `${m[1]}x${m[2]}${m[3]} | concluída: ${hoje}`;

  await antesDeGravar?.();
  // a nota pode ter sido editada (OneDrive, Obsidian) desde a leitura: confere de novo antes de sobrescrever
  const agoraSt = await fsp.lstat(arquivo).catch(() => null);
  if (!agoraSt || agoraSt.size !== st.size || agoraSt.mtimeMs !== st.mtimeMs) return erro(409, MSG_NOTA_MUDOU);
  await writeAtomic(arquivo, (temBom ? "﻿" : "") + linhas.join(nl));
  return { status: 200, corpo: { ok: true, concluidaEm: hoje } };
}

// ---------------------------------------------------------------- rotas

export interface RotasPendenciasDeps {
  resolverVault: () => string | null;
  pendencias: ObservadorPendencias;
  /** porta do servidor (para conferir o Host e o Origin) */
  porta: () => number;
  now?: () => Date;
}

/** GET /api/pendencias e POST /api/pendencias/concluir */
export function registrarPendencias(app: Express, deps: RotasPendenciasDeps) {
  app.get("/api/pendencias", exigirHostLocal(deps.porta), async (_req, res) => {
    await Promise.race([deps.pendencias.pronto, new Promise((r) => setTimeout(r, 3000).unref())]);
    res.json({ itens: deps.pendencias.getItens() });
  });

  app.post("/api/pendencias/concluir", exigirPostSeguro(deps.porta), express.json({ limit: "2kb" }), async (req, res) => {
    const vault = deps.resolverVault();
    if (!vault) {
      res.status(503).json({ ok: false, erros: ["O vault não está configurado. Rode npm run setup."] });
      return;
    }
    try {
      const r = await concluirPendencia(vault, req.body, { now: deps.now });
      if (r.status === 200) await deps.pendencias.recarregar();
      res.status(r.status).json(r.corpo);
    } catch (err) {
      console.error("[pendencias] erro ao concluir:", err instanceof Error ? err.message : err);
      res.status(500).json({ ok: false, erros: ["Não consegui salvar no vault. Tente de novo."] });
    }
  });
}
