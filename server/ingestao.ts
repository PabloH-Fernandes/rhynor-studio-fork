// Ingestão sem IA: quando uma ata chega na raiz de <vault>/00-Inbox/, o servidor lê (ataParser.ts), grava a
// nota em 10-Reunioes/ (reunioesVault.ts) e arquiva a ata bruta em 00-Inbox/processadas/. O Claude não entra.
//
// - Só a raiz do Inbox; ignora .tmp (arquivo ainda sendo gravado), LEIA-ME.md, subpastas e arquivos que não são .md.
// - Espera o arquivo ficar quieto (mesmo tamanho e mesma data por ~2 s) antes de ler: o OneDrive pode entregar
//   a ata pela metade.
// - Ata fora do formato não é tocada: continua no Inbox e só entra na contagem `foraDoFormato` ("precisa do /reuniao").
// - Nada é apagado: a ata bruta vai para processadas/ (com -2, -3 se o nome já existir).
// - Rodar de novo não duplica: a nota é procurada por reuniao_id, ou por fonte + hash do conteúdo, antes de gravar.
// - Privacidade: o nome do arquivo pode ter o título da reunião; nos logs ele aparece só como um id curto (idCurto).
// - fs.watch no OneDrive é instável: cada evento só agenda uma varredura completa (debounce) e um relógio de
//   30 s repete a varredura.

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { diaLocal } from "../shared/datas.ts";
import { ehForaDoFormato, parseAta } from "./ataParser.ts";
import { writeAtomic } from "./roster.ts";
import {
  hashDaAta,
  indexarReunioes,
  marcarProcessada,
  montarNota,
  notaExistente,
  slugDe,
  gravarNotaNova,
} from "./reunioesVault.ts";
import { lerFrontmatter, chave } from "./vault.ts";

export const MAX_BYTES_ATA = 512 * 1024;
const DEBOUNCE_MS = 1000;
const ESTABILIDADE_MS = 2000;
const INTERVALO_MS = 30_000;

export interface AtaIngerida {
  /** título já com os nomes trocados */
  titulo: string;
  hora: string;
  /** nome da nota criada (ou já existente) em 10-Reunioes, sem .md */
  nota: string;
}

export interface IngestaoOpcoes {
  debounceMs?: number;
  /** quanto tempo o arquivo precisa ficar sem mudar; 0 = não espera (testes) */
  estabilidadeMs?: number;
  /** 0 desliga o relógio de segurança (testes) */
  intervaloMs?: number;
  /** não liga o fs.watch (testes) */
  semWatch?: boolean;
  now?: () => Date;
  /** ata lida e arquivada depois que o servidor subiu (as que já estavam no Inbox ao ligar não avisam) */
  aoIngerir?: (ata: AtaIngerida) => void;
  /** quantas atas ficaram no Inbox por estarem fora do formato (chamado quando o número muda) */
  aoMudarForaDoFormato?: (n: number) => void;
}

export interface ResumoVarredura {
  ingeridas: number;
  foraDoFormato: number;
  /** arquivos que deram erro e serão tentados de novo na próxima varredura */
  erros: number;
}

/** id curto e estável do arquivo para os logs (o nome pode carregar o título da reunião) */
export function idCurto(nome: string): string {
  return createHash("sha1").update(nome).digest("hex").slice(0, 6);
}

function codigoDe(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? code : "erro";
}

/** Ata que o fluxo ainda não terminou de gravar, ou que o sistema deixou de lado. */
function nomeIgnorado(nome: string): boolean {
  const k = nome.toLowerCase();
  return !k.endsWith(".md") || k === "leia-me.md" || nome.startsWith(".") || nome.startsWith("~$");
}

async function renomear(de: string, para: string): Promise<void> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await fsp.rename(de, para);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (tentativa >= 4 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      await new Promise((r) => setTimeout(r, 100 * tentativa));
    }
  }
}

export class IngestaoInbox {
  private readonly resolver: () => string | null;
  private readonly debounceMs: number;
  private readonly estabilidadeMs: number;
  private readonly intervaloMs: number;
  private readonly semWatch: boolean;
  private readonly now: () => Date;
  private readonly aoIngerir?: (ata: AtaIngerida) => void;
  private readonly aoMudarFora?: (n: number) => void;

  private caminho: string | null = null;
  private watcher: fs.FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private recheca: ReturnType<typeof setTimeout> | null = null;
  private intervalo: ReturnType<typeof setInterval> | null = null;
  private emCurso: Promise<ResumoVarredura> | null = null;
  private pendente = false;
  private parado = false;

  /** nomes que já estavam no Inbox na primeira varredura deste vault: não avisam `aoIngerir` */
  private existentes: Set<string> | null = null;
  /** arquivo → última observação de tamanho e data, e desde quando está igual */
  private observados = new Map<string, { size: number; mtime: number; desde: number }>();
  /** arquivo fora do formato (ou grande demais) → versão que já foi julgada */
  private foraDoFormato = new Map<string, { size: number; mtime: number }>();
  /** ata já marcada como processada que ficou na raiz: nem entra na conta nem é lida de novo */
  private ignoradas = new Map<string, { size: number; mtime: number }>();
  /** ata processada na raiz cujo rename falhou: o aviso sai uma vez só por arquivo */
  private avisadasMover = new Set<string>();
  private ultimoFora = -1;
  private ultimo: ResumoVarredura = { ingeridas: 0, foraDoFormato: 0, erros: 0 };

  constructor(resolver: () => string | null, opts: IngestaoOpcoes = {}) {
    this.resolver = resolver;
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
    this.estabilidadeMs = opts.estabilidadeMs ?? ESTABILIDADE_MS;
    this.intervaloMs = opts.intervaloMs ?? INTERVALO_MS;
    this.semWatch = opts.semWatch ?? false;
    this.now = opts.now ?? (() => new Date());
    this.aoIngerir = opts.aoIngerir;
    this.aoMudarFora = opts.aoMudarForaDoFormato;
  }

  /** Primeira varredura + watch + relógio de segurança. */
  iniciar(): Promise<ResumoVarredura> {
    this.parado = false;
    const primeira = this.varrer();
    if (this.intervaloMs > 0 && !this.intervalo) {
      this.intervalo = setInterval(() => void this.varrer(), this.intervaloMs);
      this.intervalo.unref();
    }
    return primeira;
  }

  parar() {
    this.parado = true;
    for (const t of [this.timer, this.recheca]) if (t) clearTimeout(t);
    this.timer = null;
    this.recheca = null;
    if (this.intervalo) clearInterval(this.intervalo);
    this.intervalo = null;
    this.fecharWatch();
  }

  /** Uma varredura completa. Uma por vez: pedido no meio de outra agenda mais uma logo depois. */
  varrer(): Promise<ResumoVarredura> {
    if (this.emCurso) {
      this.pendente = true;
      return this.emCurso;
    }
    const rodar = async () => {
      try {
        do {
          this.pendente = false;
          try {
            this.ultimo = await this.passada();
          } catch (err) {
            console.warn("[ingestão] erro ao ler o Inbox:", err instanceof Error ? err.message : err);
          }
        } while (this.pendente && !this.parado);
      } finally {
        this.emCurso = null;
      }
      return this.ultimo;
    };
    this.emCurso = rodar();
    return this.emCurso;
  }

  // ---------------------------------------------------------------- interno

  private agendar(ms = this.debounceMs) {
    if (this.parado) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.varrer();
    }, ms);
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

  private avisarFora(n: number) {
    if (n === this.ultimoFora) return;
    this.ultimoFora = n;
    try {
      this.aoMudarFora?.(n);
    } catch (err) {
      console.error("[ingestão] erro num ouvinte:", err);
    }
  }

  private async passada(): Promise<ResumoVarredura> {
    const vault = this.resolver();
    if (vault !== this.caminho) {
      this.fecharWatch();
      this.caminho = vault;
      this.existentes = null;
      this.observados.clear();
      this.foraDoFormato.clear();
      this.ignoradas.clear();
      this.avisadasMover.clear();
    }
    const resumo: ResumoVarredura = { ingeridas: 0, foraDoFormato: 0, erros: 0 };
    if (!vault) {
      this.avisarFora(0);
      return resumo;
    }
    const dirInbox = path.join(vault, "00-Inbox");
    const dirReunioes = path.join(vault, "10-Reunioes");
    const dirMissoes = path.join(vault, "20-Missoes");
    this.ligarWatch(dirInbox);

    let entradas: fs.Dirent[];
    try {
      entradas = await fsp.readdir(dirInbox, { withFileTypes: true });
    } catch {
      this.foraDoFormato.clear();
      this.avisarFora(0);
      return resumo;
    }
    const nomes = entradas.filter((e) => e.isFile() && !nomeIgnorado(e.name)).map((e) => e.name);
    const primeira = this.existentes === null;
    if (primeira) this.existentes = new Set(nomes);

    const vistos = new Set(nomes);
    for (const n of [...this.observados.keys()]) if (!vistos.has(n)) this.observados.delete(n);
    for (const n of [...this.foraDoFormato.keys()]) if (!vistos.has(n)) this.foraDoFormato.delete(n);
    for (const n of [...this.ignoradas.keys()]) if (!vistos.has(n)) this.ignoradas.delete(n);
    for (const n of [...this.avisadasMover]) if (!vistos.has(n)) this.avisadasMover.delete(n);

    // sem 10-Reunioes não há onde gravar: a ata fica quieta no Inbox (o /reuniao avisa o que falta)
    const temDestino = await fsp.stat(dirReunioes).then((s) => s.isDirectory(), () => false);
    let indice: Awaited<ReturnType<typeof indexarReunioes>> | null = null;
    let faltaConferir = false;

    for (const nome of nomes) {
      const arq = path.join(dirInbox, nome);
      try {
        const st = await fsp.stat(arq);
        const mtime = Math.floor(st.mtimeMs);
        const julgada = this.foraDoFormato.get(nome);
        if (julgada && julgada.size === st.size && julgada.mtime === mtime) continue;
        const ignorada = this.ignoradas.get(nome);
        if (ignorada && ignorada.size === st.size && ignorada.mtime === mtime) continue;
        if (!temDestino) continue;

        // estabilidade: tamanho e data iguais em duas olhadas separadas por estabilidadeMs
        const agora = Date.now();
        const antes = this.observados.get(nome);
        if (!antes || antes.size !== st.size || antes.mtime !== mtime) {
          this.observados.set(nome, { size: st.size, mtime, desde: agora });
          if (this.estabilidadeMs > 0) {
            faltaConferir = true;
            continue;
          }
        } else if (agora - antes.desde < this.estabilidadeMs) {
          faltaConferir = true;
          continue;
        }

        if (st.size > MAX_BYTES_ATA) {
          console.warn(`[ingestão] ata ${idCurto(nome)} tem ${Math.round(st.size / 1024)} KB (limite ${MAX_BYTES_ATA / 1024} KB): fica no Inbox`);
          this.foraDoFormato.set(nome, { size: st.size, mtime });
          continue;
        }
        const texto = await fsp.readFile(arq, "utf8");
        const fm = lerFrontmatter(texto);
        if (fm && chave(fm.status ?? "") === "processada") {
          if (await this.notaDaAtaExiste(dirReunioes, fm.reuniao)) {
            // já lida e com nota: só falta sair da raiz (sem reescrever nada)
            try {
              await this.moverParaProcessadas(dirInbox, nome);
            } catch (err) {
              if (!this.avisadasMover.has(nome)) {
                this.avisadasMover.add(nome);
                console.warn(`[ingestão] ata ${idCurto(nome)} já processada, mas não consegui movê-la para processadas/ (${codigoDe(err)}); tento de novo nas próximas varreduras`);
              }
            }
          } else {
            this.ignoradas.set(nome, { size: st.size, mtime }); // sem nota conhecida: não mexe
          }
          continue;
        }

        const ata = parseAta(texto, nome);
        if (ehForaDoFormato(ata)) {
          this.foraDoFormato.set(nome, { size: st.size, mtime });
          continue;
        }

        indice ??= await indexarReunioes(dirReunioes, dirMissoes);
        const fonteHash = hashDaAta(texto);
        let nota = notaExistente(indice, ata, nome, fonteHash);
        if (!nota) {
          const agoraData = this.now();
          const dataValida = ata.data !== "";
          const data = dataValida ? ata.data : diaLocal(agoraData.getTime());
          nota = await gravarNotaNova(
            dirReunioes,
            indice,
            data,
            slugDe(ata.titulo),
            montarNota(ata, { data, fonte: nome, fonteHash, processadaEm: agoraData, dataSubstituida: !dataValida }),
          );
        }
        const arquivada = await this.arquivar(dirInbox, nome, texto, nota, st);
        this.observados.delete(nome);
        if (!arquivada) {
          // a ata mudou depois da leitura: a bruta não pode ser sobrescrita por uma versão velha; a próxima varredura lê de novo
          continue;
        }
        resumo.ingeridas++;
        if (!this.existentes?.has(nome)) {
          try {
            this.aoIngerir?.({ titulo: ata.titulo, hora: ata.hora, nota });
          } catch (err) {
            console.error("[ingestão] erro num ouvinte:", err);
          }
        }
      } catch (err) {
        // EBUSY, "só online" do OneDrive...: tenta de novo na próxima varredura
        resumo.erros++;
        console.warn(`[ingestão] não consegui ler a ata ${idCurto(nome)} (${codigoDe(err)}); tento de novo na próxima varredura`);
      }
    }

    resumo.foraDoFormato = this.foraDoFormato.size;
    this.avisarFora(resumo.foraDoFormato);
    if (faltaConferir) this.agendar(Math.max(this.estabilidadeMs, 50));
    return resumo;
  }

  private async notaDaAtaExiste(dirReunioes: string, nota: string | undefined): Promise<boolean> {
    if (!nota || /[\\/]/.test(nota) || nota.includes("..")) return false;
    return fsp.stat(path.join(dirReunioes, `${nota}.md`)).then((s) => s.isFile(), () => false);
  }

  /** move a ata da raiz do Inbox para processadas/ (com -2, -3 se o nome já existir). Nunca apaga. */
  private async moverParaProcessadas(dirInbox: string, nome: string) {
    const origem = path.join(dirInbox, nome);
    const destinoDir = path.join(dirInbox, "processadas");
    await fsp.mkdir(destinoDir, { recursive: true });
    const base = nome.replace(/\.md$/i, "");
    let alvo = path.join(destinoDir, `${base}.md`);
    for (let k = 2; fs.existsSync(alvo); k++) alvo = path.join(destinoDir, `${base}-${k}.md`);
    await renomear(origem, alvo);
  }

  /**
   * frontmatter da ata (processada + nota + confidencial) e move para 00-Inbox/processadas/. Nunca apaga.
   * Antes de regravar confere tamanho e data: se a ata mudou desde a leitura devolve false e não toca nela.
   */
  private async arquivar(dirInbox: string, nome: string, texto: string, nota: string, lido: fs.Stats): Promise<boolean> {
    const novo = marcarProcessada(texto, nota);
    const fm = novo ? lerFrontmatter(novo) : null;
    if (!novo || fm?.confidencial !== "true") throw new Error("não consegui marcar a ata como processada");
    const origem = path.join(dirInbox, nome);
    const agora = await fsp.stat(origem);
    if (agora.size !== lido.size || Math.floor(agora.mtimeMs) !== Math.floor(lido.mtimeMs)) return false;
    await writeAtomic(origem, novo);
    await this.moverParaProcessadas(dirInbox, nome);
    return true;
  }
}
