// Persistência do estado do escritório em data/escritorio.json, para o time sobreviver ao reinício
// do servidor (o `npm run dev` usa tsx watch, que reinicia quando o próprio time edita server/).
//
// Grava ~1 s depois de cada mudança (debounce) e, de forma síncrona, ao desligar. No Windows o
// tsx watch mata o processo sem sinal, então o debounce curto é a garantia principal. A gravação
// assíncrona reaproveita a escrita atômica do elenco (tmp + fsync + rename com retry).

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, RENAME_BACKOFF_MS, RENAME_RETRIES, RETRY_CODES, writeAtomic } from "./roster.ts";
import type { OfficeState } from "./state.ts";

export const ESTADO_FILE = path.join(DATA_DIR, "escritorio.json");
export const SALVAR_DEPOIS_MS = 1000;

export class PersistenciaEstado {
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** gravação em andamento (uma por vez) e se o estado mudou de novo enquanto ela rodava */
  private gravando: Promise<void> | null = null;
  private deNovo = false;

  constructor(
    private readonly state: OfficeState,
    private readonly file = ESTADO_FILE,
    private readonly esperaMs = SALVAR_DEPOIS_MS,
  ) {}

  /**
   * Lê o arquivo e restaura o estado. Sem arquivo, ou com ele quebrado, começa vazio (só avisa).
   * Devolve quantos agentes voltaram.
   */
  carregar(): number {
    let texto: string;
    try {
      texto = fs.readFileSync(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[estado] não consegui ler ${this.file}:`, err);
      return 0;
    }
    let dados: unknown;
    try {
      dados = JSON.parse(texto);
    } catch {
      console.warn(`[estado] ${this.file} está inválido: o escritório começa vazio`);
      return 0;
    }
    return this.state.restaurar(dados);
  }

  /** Salva sozinho a cada mudança do estado. Devolve a função que desliga. */
  ligar(): () => void {
    const desligar = this.state.subscribe(() => this.agendar());
    return () => {
      desligar();
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    };
  }

  /** Pede uma gravação daqui a ~1 s (várias mudanças seguidas viram uma gravação só). */
  agendar() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.salvar().catch((err) => console.error("[estado] erro ao salvar:", err));
    }, this.esperaMs);
    this.timer.unref();
  }

  /**
   * Grava agora (assíncrono, atômico). Uma gravação por vez: pedidos durante uma em andamento
   * viram UMA gravação a mais no fim, com o estado do momento (não acumulam).
   */
  salvar(): Promise<void> {
    if (this.gravando) {
      this.deNovo = true;
      return this.gravando;
    }
    const run = (async () => {
      try {
        do {
          this.deNovo = false;
          await writeAtomic(this.file, JSON.stringify(this.state.serializar()));
        } while (this.deNovo);
      } finally {
        this.gravando = null;
      }
    })();
    this.gravando = run;
    return run;
  }

  /** Grava agora de forma síncrona: para o desligamento, quando não dá para esperar promessa. */
  salvarSync() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      writeAtomicSync(this.file, JSON.stringify(this.state.serializar()));
    } catch (err) {
      console.error("[estado] erro ao salvar ao desligar:", err);
    }
  }

  /** Apaga o arquivo (botão "Limpar"): o próximo boot começa vazio. */
  async limpar(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deNovo = false;
    await this.flush();
    await fsp.rm(this.file, { force: true });
  }

  /** Resolve quando as gravações pedidas até agora terminaram (com sucesso ou não). */
  flush(): Promise<void> {
    return (this.gravando ?? Promise.resolve()).catch(() => undefined);
  }
}

/** a mesma escrita atômica do elenco, síncrona (o retry espera com Atomics.wait) */
function writeAtomicSync(file: string, data: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.sync.tmp`; // não colide com o .tmp de uma gravação assíncrona em andamento
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, data, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!RETRY_CODES.has(code) || attempt >= RENAME_RETRIES) {
        fs.rmSync(tmp, { force: true });
        throw err;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
}
