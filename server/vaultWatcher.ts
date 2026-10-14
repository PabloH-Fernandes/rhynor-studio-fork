// Observador do vault: lê <vault>/20-Missoes/*.md e a raiz de <vault>/00-Inbox/*.md e avisa quando muda.
//
// - Nunca entra em 10-Reunioes/ (confidencial), nem em subpastas (00-Inbox/processadas/).
// - fs.watch no OneDrive é instável: cada evento só agenda uma releitura COMPLETA (debounce), e um
//   relógio de 30 s religa o watch e resolve o caminho de novo.
// - Arquivo que falha ao ler (EBUSY, "só online") é pulado e mantém o valor anterior.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Missao, MissoesInfo } from "../shared/types.ts";
import { ehAtaNova, escolherAtual, missaoDoPrompt, parseMissao } from "./vault.ts";

const MAX_BYTES_MISSAO = 256 * 1024;
const BYTES_DA_ATA = 4096;
const MAX_MISSOES = 50;
const MAX_PEDIDAS = 50;
const DEBOUNCE_MS = 800;
const INTERVALO_MS = 30_000;
/** missão pedida por /time deixa de ser a atual depois disso sem novo pedido (a sessão pode ter morrido) */
export const PEDIDA_TTL_MS = 15 * 60_000;

const ORDEM_STATUS: Record<Missao["status"], number> = { "em andamento": 0, "a fazer": 1, "concluída": 2 };

export interface ObservadorOpcoes {
  debounceMs?: number;
  /** 0 desliga a rede de segurança (testes) */
  intervaloMs?: number;
  /** não liga o fs.watch (testes) */
  semWatch?: boolean;
  now?: () => number;
}

type Ouvinte = (info: MissoesInfo) => void;

const VAZIO: MissoesInfo = { vault: "sem-vault", missoes: [], inbox: { novas: 0 }, atual: null };

/** Missões em ordem de exibição: em andamento, a fazer, concluída; em cada grupo a data mais recente primeiro. */
export function ordenarMissoes(missoes: Missao[]): Missao[] {
  return [...missoes]
    .sort(
      (a, b) =>
        ORDEM_STATUS[a.status] - ORDEM_STATUS[b.status] ||
        (a.data < b.data ? 1 : a.data > b.data ? -1 : 0) ||
        b.atualizadoEm - a.atualizadoEm ||
        (a.id < b.id ? -1 : 1),
    )
    .slice(0, MAX_MISSOES);
}

export class ObservadorVault {
  private readonly resolver: () => string | null;
  private readonly debounceMs: number;
  private readonly intervaloMs: number;
  private readonly semWatch: boolean;
  private readonly now: () => number;

  private caminho: string | null = null;
  private watchers = new Map<string, fs.FSWatcher>();
  private ouvintes = new Set<Ouvinte>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalo: ReturnType<typeof setInterval> | null = null;
  private emCurso: Promise<void> | null = null;
  private pendente = false;
  private parado = false;

  /** a última leitura, sem a missão atual (ela depende dos prompts) */
  private vault: MissoesInfo["vault"] = "sem-vault";
  private missoes: Missao[] = [];
  private novas = 0;
  /** nome do arquivo → último resultado bom (valor mantido se a leitura falhar) */
  private cacheMissoes = new Map<string, { mtime: number; size: number; missao: Missao | null }>();
  private cacheAtas = new Map<string, { mtime: number; size: number; nova: boolean }>();
  /** arquivos grandes demais já avisados (1 aviso por tamanho) */
  private grandesAvisados = new Map<string, number>();
  /** sessão → missão pedida por /time e quando */
  private pedidas = new Map<string, { id: string; em: number }>();
  private info: MissoesInfo = VAZIO;
  private assinatura = JSON.stringify(VAZIO);
  /** resolve quando a primeira leitura termina */
  pronto: Promise<void> = Promise.resolve();

  constructor(resolver: () => string | null, opts: ObservadorOpcoes = {}) {
    this.resolver = resolver;
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
    this.intervaloMs = opts.intervaloMs ?? INTERVALO_MS;
    this.semWatch = opts.semWatch ?? false;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Faz a primeira leitura, liga os watches e a rede de segurança. */
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
    this.fecharWatches();
  }

  getInfo(): MissoesInfo {
    return this.info;
  }

  /** Caminho do vault em uso (só para o log do servidor). */
  getCaminho(): string | null {
    return this.caminho;
  }

  subscribe(fn: Ouvinte): () => void {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  }

  /** UserPromptSubmit: se o prompt for "/time ... Missão [[nota]]", essa passa a ser a missão atual. */
  notarPrompt(sessionId: string, prompt: string) {
    const id = missaoDoPrompt(prompt);
    if (!id) return;
    this.pedidas.delete(sessionId);
    this.pedidas.set(sessionId, { id, em: this.now() });
    while (this.pedidas.size > MAX_PEDIDAS) this.pedidas.delete(this.pedidas.keys().next().value as string);
    this.publicar();
  }

  esquecerSessao(sessionId: string) {
    if (this.pedidas.delete(sessionId)) this.publicar();
  }

  /** reset / "Limpar": ninguém mais está trabalhando */
  esquecerTodas() {
    if (this.pedidas.size === 0) return;
    this.pedidas.clear();
    this.publicar();
  }

  /** Releitura completa. Uma por vez: pedido no meio da leitura agenda outra logo depois. */
  recarregar(): Promise<void> {
    if (this.emCurso) {
      this.pendente = true;
      return this.emCurso; // a leitura em andamento repete até não haver pedido novo
    }
    const rodar = async () => {
      try {
        do {
          this.pendente = false;
          try {
            await this.ler();
          } catch (err) {
            console.warn("[vault] erro ao ler o vault:", err instanceof Error ? err.message : err);
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

  private fecharWatches() {
    for (const w of this.watchers.values()) {
      try {
        w.close();
      } catch {
        // já fechado
      }
    }
    this.watchers.clear();
  }

  private ligarWatch(dir: string) {
    if (this.semWatch || this.parado || this.watchers.has(dir)) return;
    try {
      const w = fs.watch(dir, { persistent: false }, () => this.agendar());
      w.on("error", () => {
        try {
          w.close();
        } catch {
          // já fechado
        }
        if (this.watchers.get(dir) === w) this.watchers.delete(dir); // o relógio de 30 s religa
      });
      this.watchers.set(dir, w);
    } catch {
      // pasta ainda não existe ou sem permissão: o relógio de 30 s tenta de novo
    }
  }

  private async ler() {
    const novoCaminho = this.resolver();
    if (novoCaminho !== this.caminho) {
      this.fecharWatches();
      this.cacheMissoes.clear();
      this.cacheAtas.clear();
      this.caminho = novoCaminho;
    }
    if (!novoCaminho) {
      this.vault = "sem-vault";
      this.missoes = [];
      this.novas = 0;
      this.publicar();
      return;
    }
    const dirMissoes = path.join(novoCaminho, "20-Missoes");
    const dirInbox = path.join(novoCaminho, "00-Inbox");
    this.ligarWatch(dirMissoes);
    this.ligarWatch(dirInbox);

    const lidas = await this.lerMissoes(dirMissoes);
    if (lidas === null) {
      this.vault = "sem-pasta";
      this.missoes = [];
    } else {
      this.vault = "ok";
      this.missoes = ordenarMissoes(lidas);
    }
    this.novas = await this.contarAtas(dirInbox);
    this.publicar();
  }

  /** null = a pasta 20-Missoes não existe */
  private async lerMissoes(dir: string): Promise<Missao[] | null> {
    let entradas: fs.Dirent[];
    try {
      entradas = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ENOTDIR") return null;
      return this.missoesDoCache(); // pasta ocupada: mantém
    }
    const nomes = entradas.filter((e) => e.isFile() && /\.md$/i.test(e.name)).map((e) => e.name);
    const vistos = new Set(nomes);
    for (const nome of [...this.cacheMissoes.keys()]) if (!vistos.has(nome)) this.cacheMissoes.delete(nome);
    for (const nome of nomes) {
      try {
        const arq = path.join(dir, nome);
        const st = await fsp.stat(arq);
        const mtime = Math.floor(st.mtimeMs);
        const antes = this.cacheMissoes.get(nome);
        // stat primeiro: arquivo "só online" do OneDrive não é aberto (nem baixado) se nada mudou
        if (antes && antes.mtime === mtime && antes.size === st.size) continue;
        if (st.size > MAX_BYTES_MISSAO) {
          if (this.grandesAvisados.get(nome) !== st.size) {
            this.grandesAvisados.set(nome, st.size);
            console.warn(`[vault] ${nome} tem ${Math.round(st.size / 1024)} KB (limite ${MAX_BYTES_MISSAO / 1024} KB): ignorada`);
          }
          this.cacheMissoes.set(nome, { mtime, size: st.size, missao: null });
          continue;
        }
        const texto = await fsp.readFile(arq, "utf8");
        this.cacheMissoes.set(nome, { mtime, size: st.size, missao: parseMissao(nome, texto, mtime) });
      } catch {
        // EBUSY, só online do OneDrive...: fica o valor anterior
      }
    }
    return this.missoesDoCache();
  }

  private missoesDoCache(): Missao[] {
    return [...this.cacheMissoes.values()].map((c) => c.missao).filter((m): m is Missao => m !== null);
  }

  /** conta as atas com status: nova na raiz do Inbox; lê só os primeiros 4 KB de cada uma */
  private async contarAtas(dir: string): Promise<number> {
    let entradas: fs.Dirent[];
    try {
      entradas = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") this.cacheAtas.clear();
      return this.novasDoCache();
    }
    const nomes = entradas
      .filter((e) => e.isFile() && /\.md$/i.test(e.name) && e.name.toLowerCase() !== "leia-me.md")
      .map((e) => e.name);
    const vistos = new Set(nomes);
    for (const nome of [...this.cacheAtas.keys()]) if (!vistos.has(nome)) this.cacheAtas.delete(nome);
    for (const nome of nomes) {
      let fh: fsp.FileHandle | null = null;
      try {
        const arq = path.join(dir, nome);
        const st = await fsp.stat(arq);
        const mtime = Math.floor(st.mtimeMs);
        const antes = this.cacheAtas.get(nome);
        if (antes && antes.mtime === mtime && antes.size === st.size) continue; // não abre de novo
        fh = await fsp.open(arq, "r");
        const buf = Buffer.alloc(BYTES_DA_ATA);
        const { bytesRead } = await fh.read(buf, 0, BYTES_DA_ATA, 0);
        this.cacheAtas.set(nome, { mtime, size: st.size, nova: ehAtaNova(buf.toString("utf8", 0, bytesRead)) });
      } catch {
        // mantém o valor anterior
      } finally {
        await fh?.close().catch(() => undefined);
      }
    }
    return this.novasDoCache();
  }

  private novasDoCache(): number {
    return [...this.cacheAtas.values()].filter((c) => c.nova).length;
  }

  /** monta o MissoesInfo e avisa só se a assinatura mudou */
  private publicar() {
    // pedido antigo some: a sessão pode ter morrido sem SessionEnd (e o relógio de 30 s reavalia)
    const agora = this.now();
    for (const [sid, p] of this.pedidas) if (agora - p.em > PEDIDA_TTL_MS) this.pedidas.delete(sid);
    const ordenadas = [...this.pedidas.values()].sort((a, b) => b.em - a.em).map((p) => p.id);
    const atual = escolherAtual(this.missoes, ordenadas);
    const info: MissoesInfo = {
      vault: this.vault,
      missoes: this.missoes,
      inbox: { novas: this.novas },
      atual: atual ? { id: atual.id, nome: atual.nome, reuniaoTitulo: atual.reuniaoTitulo } : null,
    };
    const assinatura = JSON.stringify(info);
    if (assinatura === this.assinatura) return;
    this.assinatura = assinatura;
    this.info = info;
    for (const fn of this.ouvintes) {
      try {
        fn(info);
      } catch (err) {
        console.error("[vault] erro num ouvinte:", err);
      }
    }
  }
}
