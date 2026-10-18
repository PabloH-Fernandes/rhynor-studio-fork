// Caixa de entrada: as reuniões lidas sem IA (10-Reunioes/, `status: rascunho` e `origem: leitura-automatica`)
// que esperam a sua aprovação no painel.
//
// Privacidade: o servidor roda só na máquina local (127.0.0.1). Aqui ele lê as notas de 10-Reunioes/ e
// entrega ao painel SÓ o título, a data e as tarefas em aberto (texto, responsável e prazo). Pauta, notas,
// decisões e dúvidas nunca saem daqui. Nada vai para o Claude.
//
// Mesmo padrão do ObservadorVault: stat primeiro (cache por data e tamanho), fs.watch só agenda uma releitura
// completa (debounce) e um relógio de 30 s religa o watch. Arquivo que falha ao ler mantém o valor anterior.

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { ehDataValida } from "../shared/datas.ts";
import type { CaixaItem } from "../shared/types.ts";
import { chave, cortar, lerFrontmatter, semLinks } from "./vault.ts";

export const MAX_BYTES_NOTA = 256 * 1024;
const MAX_ITENS = 30;
/** quantas tarefas em aberto o painel mostra (e o servidor exige decisão); as demais ficam na nota, intocadas */
export const MAX_TAREFAS = 40;
const MAX_TITULO = 120;
const MAX_TEXTO = 140;
const MAX_RESPONSAVEL = 60;
const DEBOUNCE_MS = 800;
const INTERVALO_MS = 30_000;

/** o id de uma reunião é o nome do arquivo: só letras, números e hífen (nunca um caminho) */
export const ID_REUNIAO = /^[0-9A-Za-z-]+$/;
export const MAX_ID = 120;

export function idValido(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= MAX_ID && ID_REUNIAO.test(id);
}

// ---------------------------------------------------------------- tarefas da nota

/** Uma linha de checkbox da seção "## Tarefas" da nota de reunião. */
export interface LinhaTarefa {
  /** posição da linha no array de linhas da nota (para reescrever) */
  indice: number;
  /** 1, 2, 3...: ordem entre TODAS as linhas de checkbox da seção (abertas, feitas e ignoradas) */
  n: number;
  /** " " em aberto, "x" feita, "-" ignorada */
  marca: " " | "x" | "-";
  texto: string;
  responsavel: string;
  prazo: string;
  classe: string;
}

const LINHA_TAREFA = /^(\s*[-*]\s+\[)( |x|X|-)(\]\s+)(\S.*)$/;

/**
 * As tarefas da seção "## Tarefas" (linhas cruas, sem tirar comentário nem código: o índice precisa bater
 * com o arquivo). Formato: `- [ ] texto | responsável: X | prazo: AAAA-MM-DD | classe: ?`.
 */
export function lerTarefasDaNota(linhas: readonly string[]): LinhaTarefa[] {
  let ini = 0;
  if (linhas[0]?.replace(/^﻿/, "").trim() === "---") {
    const fim = linhas.findIndex((l, i) => i > 0 && l.trim() === "---");
    ini = fim < 0 ? 0 : fim + 1;
  }
  const cab = linhas.findIndex((l, i) => i >= ini && /^##\s+Tarefas\b/i.test(l));
  if (cab < 0) return [];
  const out: LinhaTarefa[] = [];
  for (let i = cab + 1; i < linhas.length && !/^##\s/.test(linhas[i]); i++) {
    const m = LINHA_TAREFA.exec(linhas[i]);
    if (!m) continue;
    const [texto, ...campos] = m[4].split(/\s*\|\s*/);
    const meta: Record<string, string> = {};
    for (const c of campos) {
      const kv = /^([^:]+):\s*(.*)$/.exec(c);
      if (kv) meta[chave(kv[1])] = kv[2].trim();
    }
    out.push({
      indice: i,
      n: out.length + 1,
      marca: m[2] === " " ? " " : m[2] === "-" ? "-" : "x",
      texto: texto.trim(),
      responsavel: meta.responsavel ?? "",
      prazo: meta.prazo ?? "",
      classe: meta.classe ?? "",
    });
  }
  return out;
}

/** hash curto (8 hex) do texto cru da tarefa: o painel devolve no POST para provar que a nota não mudou */
export function hashTarefa(texto: string): string {
  return createHash("sha1").update(texto.trim()).digest("hex").slice(0, 8);
}

/** o primeiro `#título` depois do frontmatter, sem links (vazio se não houver) */
export function tituloDe(linhas: readonly string[]): string {
  let ini = 0;
  if (linhas[0]?.replace(/^﻿/, "").trim() === "---") {
    const fim = linhas.findIndex((l, i) => i > 0 && l.trim() === "---");
    ini = fim < 0 ? 0 : fim + 1;
  }
  for (let i = ini; i < linhas.length; i++) {
    const m = /^#\s+(.+?)\s*$/.exec(linhas[i]);
    if (m) return cortar(semLinks(m[1]), MAX_TITULO);
  }
  return "";
}

/** O item da Caixa de entrada para uma nota de 10-Reunioes; null se a nota não é para a caixa. */
export function lerCaixaItem(nomeArquivo: string, texto: string): CaixaItem | null {
  const id = nomeArquivo.replace(/\.md$/i, "").normalize("NFC");
  if (!idValido(id)) return null;
  const fm = lerFrontmatter(texto);
  if (!fm) return null;
  if (chave(fm.tipo ?? "") !== "reuniao") return null;
  if (chave(fm.status ?? "") !== "rascunho") return null;
  if (chave(fm.origem ?? "") !== "leitura-automatica") return null;

  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/);
  const data = ehDataValida(fm.data ?? "") ? fm.data.trim() : "";
  const emAberto = lerTarefasDaNota(linhas).filter((t) => t.marca === " ");
  const tarefas = emAberto.slice(0, MAX_TAREFAS).map((t) => ({
      n: t.n,
      h: hashTarefa(t.texto),
      texto: cortar(semLinks(t.texto) || t.texto, MAX_TEXTO),
      responsavel: cortar(semLinks(t.responsavel), MAX_RESPONSAVEL),
      prazo: ehDataValida(t.prazo) ? t.prazo.trim() : "",
    }));
  return { id, titulo: tituloDe(linhas) || id, data, tarefas, ...(emAberto.length > MAX_TAREFAS ? { truncada: true } : {}) };
}

/** mais recentes primeiro (data, desempate pelo id) */
export function ordenarCaixa(itens: CaixaItem[]): CaixaItem[] {
  return [...itens].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, MAX_ITENS);
}

// ---------------------------------------------------------------- observador

export interface ObservadorCaixaOpcoes {
  debounceMs?: number;
  /** 0 desliga a rede de segurança (testes) */
  intervaloMs?: number;
  /** não liga o fs.watch (testes) */
  semWatch?: boolean;
}

type Ouvinte = (itens: CaixaItem[]) => void;

export class ObservadorCaixa {
  private readonly resolver: () => string | null;
  private readonly debounceMs: number;
  private readonly intervaloMs: number;
  private readonly semWatch: boolean;

  private caminho: string | null = null;
  private watcher: fs.FSWatcher | null = null;
  private ouvintes = new Set<Ouvinte>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalo: ReturnType<typeof setInterval> | null = null;
  private emCurso: Promise<void> | null = null;
  private pendente = false;
  private parado = false;

  /** nome do arquivo → último resultado bom (mantido se a leitura falhar) */
  private cache = new Map<string, { mtime: number; size: number; item: CaixaItem | null }>();
  private itens: CaixaItem[] = [];
  private assinatura = "[]";
  pronto: Promise<void> = Promise.resolve();

  constructor(resolver: () => string | null, opts: ObservadorCaixaOpcoes = {}) {
    this.resolver = resolver;
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
    this.intervaloMs = opts.intervaloMs ?? INTERVALO_MS;
    this.semWatch = opts.semWatch ?? false;
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

  getItens(): CaixaItem[] {
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
            console.warn("[caixa] erro ao ler 10-Reunioes:", err instanceof Error ? err.message : err);
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
      const w = fs.watch(dir, { persistent: false }, () => this.agendar());
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
      // pasta ainda não existe: o relógio tenta de novo
    }
  }

  private async ler() {
    const vault = this.resolver();
    if (vault !== this.caminho) {
      this.fecharWatch();
      this.cache.clear();
      this.caminho = vault;
    }
    if (!vault) {
      this.itens = [];
      this.publicar();
      return;
    }
    const dir = path.join(vault, "10-Reunioes");
    this.ligarWatch(dir);

    let entradas: fs.Dirent[];
    try {
      entradas = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        this.cache.clear();
        this.itens = [];
        this.publicar();
      }
      return; // pasta ocupada: mantém
    }
    const nomes = entradas.filter((e) => e.isFile() && /\.md$/i.test(e.name)).map((e) => e.name);
    const vistos = new Set(nomes);
    for (const nome of [...this.cache.keys()]) if (!vistos.has(nome)) this.cache.delete(nome);
    for (const nome of nomes) {
      try {
        const arq = path.join(dir, nome);
        const st = await fsp.stat(arq);
        const mtime = Math.floor(st.mtimeMs);
        const antes = this.cache.get(nome);
        if (antes && antes.mtime === mtime && antes.size === st.size) continue; // não abre de novo
        if (st.size > MAX_BYTES_NOTA) {
          this.cache.set(nome, { mtime, size: st.size, item: null });
          continue;
        }
        const texto = await fsp.readFile(arq, "utf8");
        this.cache.set(nome, { mtime, size: st.size, item: lerCaixaItem(nome, texto) });
      } catch {
        // EBUSY, "só online" do OneDrive...: fica o valor anterior
      }
    }
    this.itens = ordenarCaixa([...this.cache.values()].map((c) => c.item).filter((i): i is CaixaItem => i !== null));
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
        console.error("[caixa] erro num ouvinte:", err);
      }
    }
  }
}
