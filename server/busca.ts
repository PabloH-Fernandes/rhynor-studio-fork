// Busca no cérebro (vault): texto local, sem IA, só leitura. GET /api/busca?q=...
//
// Privacidade (segunda barreira, decisão D4): nota confidencial entra no índice SÓ com o título (nome do arquivo)
// e o caminho relativo. O corpo dela nunca vai para a memória e a busca compara só o título (casar o corpo
// seria um oráculo de vazamento: "tem a palavra X?"). É confidencial: `confidencial: true` no frontmatter,
// frontmatter ilegível/duvidoso/não fechado, ou nota dentro de 00-Inbox/ ou 10-Reunioes/ (mesmo sem a flag;
// essas pastas nem são abertas). O cliente nunca manda caminho: a resposta só traz o caminho relativo que
// veio do índice, nunca o absoluto.
//
// Limite do link do Obsidian: o link usa só o NOME da pasta do vault (obsidian://open?vault=NOME&file=...).
// Dois vaults com o mesmo nome de pasta podem abrir o errado.
//
// Mesmo padrão do ObservadorCaixa: lstat primeiro (cache por data e tamanho), fs.watch só agenda uma
// releitura (debounce) e um relógio de 30 s religa o watch.

import type { Express } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { BuscaItem, BuscaResposta } from "../shared/types.ts";
import { exigirHostLocal } from "./seguranca.ts";
import { chave, corpoDe, cortar, frontmatterMencionaConfidencial, lerFrontmatter, linhasDeTexto, semLinks, temConfidencialTrue } from "./vault.ts";

export const MAX_BYTES_BUSCA = 200 * 1024;
export const MAX_ARQUIVOS = 5000;
export const MAX_PROFUNDIDADE = 6;
export const MIN_Q = 2;
export const MAX_Q = 80;
export const MAX_RESULTADOS = 20;
const TAM_TRECHO = 160;
/** teto da soma dos tamanhos das notas com texto no índice; as demais entram só pelo título */
export const MAX_BYTES_INDICE = 100 * 1024 * 1024;
/** cabeçalho maior que isso é cortado ANTES de qualquer regex (as de link são quadráticas) */
const MAX_CABECALHO = 200;
/** a consulta cede o loop (setImmediate) se passar disso */
const FATIA_MS = 25;
const LEITURA_TRECHOS_MS = 1500;
const DEBOUNCE_MS = 800;
const INTERVALO_MS = 30_000;
/** o GET relê o vault (barato, por cache) se a última leitura tem mais que isso */
const VELHICE_MS = 5000;

const PASTAS_IGNORADAS = new Set([".obsidian", ".trash", ".git", "templates"]);
const PASTAS_CONFIDENCIAIS = new Set(["00-inbox", "10-reunioes"]);

export interface Entrada {
  rel: string;
  titulo: string;
  tituloN: string;
  confidencial: boolean;
  /** cabeçalhos (#) normalizados; vazio em nota confidencial */
  cabsN: string;
  /** corpo normalizado; vazio em nota confidencial (o trecho vem da releitura do arquivo, não daqui) */
  corpoN: string;
  /** nota não confidencial indexada só pelo título (índice cheio) */
  soTitulo: boolean;
}

/** `maxBytes` limita a leitura (só os primeiros bytes do arquivo) */
export type LerTexto = (arq: string, maxBytes?: number) => Promise<string>;

/** teto da releitura de cada item do topo */
export const MAX_BYTES_RELEITURA = 256 * 1024;
/** nota além do teto do índice: só o início é lido para conferir o frontmatter */
const BYTES_INICIO = 4096;
/** espera máxima da consulta pelo índice inicial antes de responder "montando" */
export const ESPERA_INDICE_MS = 300;

async function lerArquivoPadrao(arq: string, maxBytes?: number): Promise<string> {
  if (maxBytes === undefined) return fsp.readFile(arq, "utf8");
  const fh = await fsp.open(arq, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }
}

/** resolve com o valor, ou com null se passar de `ms` (leitura travada); nunca rejeita */
function comLimite<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    t.unref();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

// ---------------------------------------------------------------- construção do índice

/** minúscula e sem acento, caractere a caractere, para o texto normalizado ter o MESMO tamanho do original */
export function normalizarIgualTamanho(s: string): string {
  if (!/[^\x00-\x7f]/.test(s)) return s.toLowerCase();
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c.charCodeAt(0) < 128) {
      out += c.toLowerCase();
      continue;
    }
    const n = c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    out += n.length === 1 ? n : c;
  }
  return out;
}

/** a nota é confidencial pelo conteúdo? (flag, frontmatter duvidoso ou não fechado) */
export function confidencialPeloTexto(texto: string): boolean {
  if (temConfidencialTrue(texto) || frontmatterMencionaConfidencial(texto)) return true;
  const sem = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const linhas = sem.split(/\r?\n/, 40);
  if (linhas[0]?.trim() === "---") {
    const fm = lerFrontmatter(texto);
    if (!fm) return true; // bloco que não fecha
    if (fm.confidencial !== undefined && !["false", "no", "nao", "0"].includes(chave(fm.confidencial))) return true;
    return false;
  }
  // "---" depois de linhas em branco ou de texto: o Obsidian não trata como frontmatter, mas na dúvida a nota fica fechada
  const primeira = linhas.findIndex((l) => l.trim() !== "");
  if (primeira > 0 && linhas[primeira].trim() === "---") return true;
  return false;
}

function entradaConfidencial(rel: string, titulo: string): Entrada {
  return { rel, titulo, tituloN: normalizarIgualTamanho(titulo), confidencial: true, cabsN: "", corpoN: "", soTitulo: false };
}

/** Monta a entrada de uma nota. `texto` é null quando a nota nem deve ser aberta (pasta confidencial). */
export function montarEntrada(rel: string, texto: string | null, soTitulo = false): Entrada {
  const titulo = (rel.split("/").pop() ?? rel).replace(/\.md$/i, "").normalize("NFC");
  const pasta = rel.split("/")[0].normalize("NFC").toLowerCase();
  if (texto === null || PASTAS_CONFIDENCIAIS.has(chave(pasta).normalize("NFC")) || confidencialPeloTexto(texto)) {
    return entradaConfidencial(rel, titulo);
  }
  if (soTitulo) return { rel, titulo, tituloN: normalizarIgualTamanho(titulo), confidencial: false, cabsN: "", corpoN: "", soTitulo: true };
  const linhas = corpoDe(texto);
  const corpo = linhas.join("\n").normalize("NFC");
  const cabs: string[] = [];
  for (const l of linhas) {
    const c = l.slice(0, MAX_CABECALHO * 2); // antes de qualquer regex
    if (!/^#{1,6}\s+\S/.test(c)) continue;
    cabs.push(semLinks(c.replace(/^#{1,6}\s+/, "").slice(0, MAX_CABECALHO), MAX_CABECALHO));
  }
  return {
    rel,
    titulo,
    tituloN: normalizarIgualTamanho(titulo),
    confidencial: false,
    cabsN: normalizarIgualTamanho(cabs.join("\n")),
    corpoN: normalizarIgualTamanho(corpo),
    soTitulo: false,
  };
}

// ---------------------------------------------------------------- consulta

export type ConsultaValida = { ok: true; palavras: string[] } | { ok: false; erro: string };

export function validarConsulta(q: unknown): ConsultaValida {
  if (typeof q !== "string") return { ok: false, erro: "Escreva o que você quer buscar." };
  const t = q.trim();
  if (t.length < MIN_Q) return { ok: false, erro: `Escreva pelo menos ${MIN_Q} letras.` };
  if (t.length > MAX_Q) return { ok: false, erro: `Use no máximo ${MAX_Q} caracteres.` };
  const palavras = chave(t).split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return { ok: false, erro: `Escreva pelo menos ${MIN_Q} letras.` };
  return { ok: true, palavras };
}

/** toda palavra aparece em pelo menos um dos textos (sem criar string nova) */
function todasEm(palavras: readonly string[], a: string, b?: string): boolean {
  for (const p of palavras) {
    if (!a.includes(p) && !(b !== undefined && b.includes(p))) return false;
  }
  return true;
}

/** trecho de uma nota a partir do texto do arquivo (relido na hora): sem comentário HTML nem bloco de código */
export function trechoDoTexto(texto: string, palavras: readonly string[]): string | undefined {
  const corpo = linhasDeTexto(corpoDe(texto)).join("\n").normalize("NFC");
  const corpoN = normalizarIgualTamanho(corpo);
  let pos = -1;
  for (const p of palavras) {
    const i = corpoN.indexOf(p);
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }
  const ini = Math.max(0, pos < 0 ? 0 : pos - 60);
  const fim = Math.min(corpo.length, ini + 220);
  let t = semLinks(corpo.slice(ini, fim));
  t = t.replace(/^[#>\-*\s]+/, "");
  if (!t) return undefined;
  const cortado = cortar(t, TAM_TRECHO);
  return (ini > 0 ? "…" : "") + cortado + (fim < corpo.length && cortado === t ? "…" : "");
}

export function uriObsidian(nomeVault: string, rel: string): string {
  return `obsidian://open?vault=${encodeURIComponent(nomeVault)}&file=${encodeURIComponent(rel.replace(/\.md$/i, ""))}`;
}

export interface OpcoesConsulta {
  /** raiz do vault e leitor: com eles o trecho vem da releitura do arquivo (e a privacidade é conferida de novo) */
  raiz?: string;
  ler?: LerTexto;
  /** tempo máximo de cada releitura e do conjunto (testes) */
  limiteLeituraMs?: number;
}

/**
 * Procura no índice em fatias (cede o loop se passar de ~25 ms). O trecho dos primeiros resultados vem de uma
 * releitura do arquivo: se a nota virou confidencial desde a indexação, o item some (ou fica só com o título,
 * se o título casa) e o texto nunca sai.
 */
export async function buscarNoIndice(
  entradas: Iterable<Entrada>,
  palavras: readonly string[],
  nomeVault: string,
  opc: OpcoesConsulta = {},
): Promise<{ itens: BuscaItem[]; total: number; maisResultados: boolean }> {
  const achados: { e: Entrada; nivel: number }[] = [];
  let t0 = performance.now();
  let n = 0;
  for (const e of entradas) {
    if (++n % 128 === 0 && performance.now() - t0 > FATIA_MS) {
      await new Promise<void>((r) => setImmediate(r));
      t0 = performance.now();
    }
    let nivel = 0;
    if (todasEm(palavras, e.tituloN)) nivel = 3;
    else if (!e.confidencial && !e.soTitulo && todasEm(palavras, e.tituloN, e.cabsN)) nivel = 2;
    else if (!e.confidencial && !e.soTitulo && todasEm(palavras, e.tituloN, e.corpoN)) nivel = 1;
    if (nivel > 0) achados.push({ e, nivel });
  }
  achados.sort((a, b) => b.nivel - a.nivel || (a.e.rel < b.e.rel ? -1 : a.e.rel > b.e.rel ? 1 : 0));
  const topo = achados.slice(0, MAX_RESULTADOS);
  const { raiz, ler } = opc;
  const limiteMs = opc.limiteLeituraMs ?? LEITURA_TRECHOS_MS;
  // tentou: houve releitura; texto null com tentou = a releitura falhou ou estourou o tempo (fail-closed)
  const naoLe = (e: Entrada) => e.confidencial || e.soTitulo;
  let leituras: { tentou: boolean; texto: string | null }[] = topo.map(() => ({ tentou: false, texto: null }));
  if (raiz && ler) {
    const lendo = Promise.all(
      topo.map(async ({ e }) => {
        if (naoLe(e)) return { tentou: false, texto: null };
        const texto = await comLimite(Promise.resolve().then(() => ler(path.join(raiz, ...e.rel.split("/")), MAX_BYTES_RELEITURA)), limiteMs);
        return { tentou: true, texto };
      }),
    );
    // limite do conjunto: se estourar, todas as releituras contam como falha
    leituras = (await comLimite(lendo, limiteMs)) ?? topo.map(({ e }) => ({ tentou: !naoLe(e), texto: null }));
  }
  const mais = achados.length > MAX_RESULTADOS;
  // com mais que o limite, o número exato seria um oráculo de existência: devolve só o limite
  let total = mais ? MAX_RESULTADOS : achados.length;
  const itens: BuscaItem[] = [];
  topo.forEach(({ e, nivel }, i) => {
    const { tentou, texto } = leituras[i];
    let confidencial = e.confidencial;
    let trecho: string | undefined;
    if (tentou && texto === null) {
      // não deu para conferir: se casou só pelo conteúdo, some; se casou pelo título, fica fechada
      if (nivel < 3) {
        total--;
        return;
      }
      confidencial = true;
    } else if (texto !== null) {
      if (confidencialPeloTexto(texto)) {
        if (nivel < 3) {
          total--; // casou só pelo conteúdo de uma nota que agora é confidencial: nem aparece
          return;
        }
        confidencial = true;
      } else {
        trecho = trechoDoTexto(texto, palavras);
      }
    }
    itens.push({ titulo: e.titulo, rel: e.rel, ...(trecho ? { trecho } : {}), confidencial, uri: uriObsidian(nomeVault, e.rel) });
  });
  return { itens, total, maisResultados: mais };
}

// ---------------------------------------------------------------- observador

export interface ObservadorBuscaOpcoes {
  debounceMs?: number;
  /** 0 desliga a rede de segurança (testes) */
  intervaloMs?: number;
  /** não liga o fs.watch (testes) */
  semWatch?: boolean;
  /** leitor de arquivo (testes simulam falha) */
  lerArquivo?: LerTexto;
  /** teto de bytes do índice (testes) */
  maxBytesIndice?: number;
}

export class ObservadorBusca {
  private readonly resolver: () => string | null;
  private readonly debounceMs: number;
  private readonly intervaloMs: number;
  private readonly semWatch: boolean;
  readonly lerArquivo: LerTexto;
  private readonly maxBytesIndice: number;

  private caminho: string | null = null;
  private watcher: fs.FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalo: ReturnType<typeof setInterval> | null = null;
  private emCurso: Promise<void> | null = null;
  private pendente = false;
  private parado = false;
  private ultimaLeitura = 0;

  /** caminho relativo → último resultado bom (mantido se a leitura falhar) */
  private cache = new Map<string, { mtime: number; size: number; entrada: Entrada }>();
  private entradas: Entrada[] = [];
  pronto: Promise<void> = Promise.resolve();

  constructor(resolver: () => string | null, opts: ObservadorBuscaOpcoes = {}) {
    this.resolver = resolver;
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
    this.intervaloMs = opts.intervaloMs ?? INTERVALO_MS;
    this.semWatch = opts.semWatch ?? false;
    this.lerArquivo = opts.lerArquivo ?? lerArquivoPadrao;
    this.maxBytesIndice = opts.maxBytesIndice ?? MAX_BYTES_INDICE;
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

  /** responde com o índice atual; se está velho, relê em segundo plano (não bloqueia a consulta) */
  async garantir(): Promise<void> {
    await this.pronto;
    if (this.ultimaLeitura === 0) await this.recarregar();
    else if (Date.now() - this.ultimaLeitura > VELHICE_MS) void this.recarregar();
  }

  /** como garantir(), mas devolve false se o índice inicial não ficou pronto em `ms` (a montagem segue em segundo plano) */
  async garantirAte(ms: number): Promise<boolean> {
    return (await comLimite(this.garantir().then(() => true), ms)) === true;
  }

  getEntradas(): readonly Entrada[] {
    return this.entradas;
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
            console.warn("[busca] erro ao ler o vault:", err instanceof Error ? err.message : err);
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
    try {
      this.watcher?.close();
    } catch {
      // já fechado
    }
    this.watcher = null;
  }

  private ligarWatch(dir: string) {
    if (this.semWatch || this.parado || this.watcher) return;
    try {
      const w = fs.watch(dir, { persistent: false, recursive: true }, () => this.agendar());
      w.on("error", () => {
        try {
          w.close();
        } catch {
          // já fechado
        }
        if (this.watcher === w) this.watcher = null; // o relógio de 30 s religa
      });
      this.watcher = w;
    } catch {
      // sem watch recursivo neste sistema: o relógio de 30 s e o GET mantêm o índice em dia
    }
  }

  /** os arquivos .md do vault: sem links simbólicos, pastas ignoradas, profundidade e quantidade limitadas */
  private async listar(raiz: string): Promise<string[]> {
    const achados: string[] = [];
    let estourou = false;
    const andar = async (dirRel: string, profundidade: number): Promise<void> => {
      if (estourou) return;
      let entradas: fs.Dirent[];
      try {
        entradas = await fsp.readdir(path.join(raiz, dirRel), { withFileTypes: true });
      } catch {
        return;
      }
      entradas.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const ent of entradas) {
        if (estourou) return;
        if (ent.isSymbolicLink()) continue;
        const rel = dirRel ? `${dirRel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
          if (PASTAS_IGNORADAS.has(ent.name.toLowerCase())) continue;
          if (profundidade + 1 > MAX_PROFUNDIDADE) continue;
          await andar(rel, profundidade + 1);
        } else if (ent.isFile() && /\.md$/i.test(ent.name)) {
          if (achados.length >= MAX_ARQUIVOS) {
            estourou = true;
            console.warn(`[busca] o vault tem mais de ${MAX_ARQUIVOS} notas: as demais ficam fora da busca`);
            return;
          }
          achados.push(rel);
        }
      }
    };
    await andar("", 0);
    return achados;
  }

  private async ler() {
    const vault = this.resolver();
    if (vault !== this.caminho) {
      this.fecharWatch();
      this.cache.clear();
      this.caminho = vault;
    }
    if (!vault) {
      this.entradas = [];
      this.ultimaLeitura = Date.now();
      return;
    }
    this.ligarWatch(vault);
    const arquivos = await this.listar(vault);
    const vistos = new Set(arquivos);
    for (const rel of [...this.cache.keys()]) if (!vistos.has(rel)) this.cache.delete(rel);
    let bytes = 0;
    let avisou = false;
    for (const rel of arquivos) {
      try {
        const arq = path.join(vault, ...rel.split("/"));
        const st = await fsp.lstat(arq);
        if (st.isSymbolicLink() || !st.isFile()) {
          this.cache.delete(rel);
          continue;
        }
        if (st.size > MAX_BYTES_BUSCA) {
          this.cache.delete(rel);
          continue;
        }
        const mtime = Math.floor(st.mtimeMs);
        const antes = this.cache.get(rel);
        const cabe = bytes + st.size <= this.maxBytesIndice;
        if (antes && antes.mtime === mtime && antes.size === st.size && !(antes.entrada.soTitulo && cabe)) {
          if (!antes.entrada.confidencial && !antes.entrada.soTitulo) bytes += st.size;
          continue; // não abre de novo
        }
        if (!cabe) {
          if (!avisou) console.warn(`[busca] o índice passou de ${Math.round(this.maxBytesIndice / 1048576)} MB: as demais notas entram só pelo título`);
          avisou = true;
          // além do teto: lê só o início para conferir o frontmatter (fail-closed: sem frontmatter fechado, é confidencial)
          let inicio: string | null = null;
          try {
            inicio = (await this.lerArquivo(arq, BYTES_INICIO)).slice(0, BYTES_INICIO);
          } catch {
            inicio = null;
          }
          this.cache.set(rel, { mtime, size: st.size, entrada: montarEntrada(rel, inicio, true) });
          continue;
        }
        const pastaFechada = PASTAS_CONFIDENCIAIS.has(rel.split("/")[0].normalize("NFC").toLowerCase());
        const texto = pastaFechada ? null : await this.lerArquivo(arq);
        const entrada = montarEntrada(rel, texto);
        if (!entrada.confidencial) bytes += st.size;
        this.cache.set(rel, { mtime, size: st.size, entrada });
      } catch {
        // EBUSY, "só online" do OneDrive...: a nota mudou (ou sumiu) e não deu para ler. Não dá para saber se
        // virou confidencial, então fecha por segurança (só o título) e tenta de novo na próxima releitura
        this.cache.set(rel, { mtime: -1, size: -1, entrada: montarEntrada(rel, null) });
      }
    }
    this.entradas = [...this.cache.values()].map((c) => c.entrada);
    this.ultimaLeitura = Date.now();
  }
}

// ---------------------------------------------------------------- rota

export interface RotasBuscaDeps {
  resolverVault: () => string | null;
  busca: ObservadorBusca;
  porta: () => number;
  /** espera pelo índice inicial antes de responder "montando" (testes) */
  esperaIndiceMs?: number;
}

export function registrarBusca(app: Express, deps: RotasBuscaDeps) {
  // só lê: nada aqui grava no vault, chama o Claude ou recebe caminho de arquivo
  app.get("/api/busca", exigirHostLocal(deps.porta), async (req, res) => {
    const c = validarConsulta(req.query.q);
    if (!c.ok) {
      res.status(400).json({ ok: false, erros: [c.erro] });
      return;
    }
    const vault = deps.resolverVault();
    if (!vault) {
      res.json({ ok: true, itens: [], total: 0, semVault: true } satisfies BuscaResposta);
      return;
    }
    if (!(await deps.busca.garantirAte(deps.esperaIndiceMs ?? ESPERA_INDICE_MS))) {
      res.json({ ok: true, itens: [], total: 0, montando: true } satisfies BuscaResposta);
      return;
    }
    const { itens, total, maisResultados } = await buscarNoIndice(deps.busca.getEntradas(), c.palavras, path.basename(vault), { raiz: vault, ler: deps.busca.lerArquivo });
    res.json({ ok: true, itens, total, ...(maisResultados ? { maisResultados: true } : {}) } satisfies BuscaResposta);
  });
}
