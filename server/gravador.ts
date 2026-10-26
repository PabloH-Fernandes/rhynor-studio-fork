// Gravador de eventos crus dos hooks: com STUDIO_GRAVAR=1, cada POST /api/hook vira uma linha
// em data/eventos/AAAA-MM-DD.jsonl (data local), no formato que o server/replay.ts reproduz:
//   {"chegada": <ms>, "hookTs": <x-hook-ts ou null>, "evento": <corpo cru>}
//   {"chegada": <ms>, "marcador": "servidor_iniciou"}
//
// O arquivo tem prompts, comandos e caminhos da sua máquina: fica só local (data/ está no .gitignore).

import fs from "node:fs";
import path from "node:path";

/** Uma linha do arquivo de eventos. */
export type LinhaGravada =
  | { chegada: number; hookTs: number | null; evento: unknown }
  | { chegada: number; marcador: "servidor_iniciou" };

/** Pasta e data local do arquivo do dia (AAAA-MM-DD.jsonl). */
export function arquivoDoDia(pasta: string, quando: number): string {
  const d = new Date(quando);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return path.join(pasta, `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}.jsonl`);
}

/** x-hook-ts como número (ms) ou null se não veio / não é número. */
export function lerHookTs(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export class Gravador {
  /** appends encadeados: as linhas saem na ordem de chegada, sem nunca travar quem chama */
  private cadeia: Promise<void> = Promise.resolve();
  private avisou = false;

  constructor(
    private readonly pasta: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Grava o marcador de início do servidor (o replay recria o estado aqui). */
  servidorIniciou() {
    const chegada = this.now();
    this.gravar({ chegada, marcador: "servidor_iniciou" }, chegada);
  }

  /** Grava o corpo cru de um evento de hook. */
  evento(body: unknown, hookTs: number | null) {
    const chegada = this.now();
    // POST sem corpo: undefined sumiria do JSON e a linha ficaria sem "evento"
    this.gravar({ chegada, hookTs, evento: body ?? null }, chegada);
  }

  /** Espera as gravações pendentes (para testes e encerramento). */
  esvaziar(): Promise<void> {
    return this.cadeia;
  }

  private gravar(linha: LinhaGravada, chegada: number) {
    let texto: string;
    try {
      texto = JSON.stringify(linha) + "\n";
    } catch (err) {
      this.avisar(err);
      return;
    }
    const arquivo = arquivoDoDia(this.pasta, chegada);
    this.cadeia = this.cadeia
      .then(() => fs.promises.mkdir(this.pasta, { recursive: true }))
      .then(() => fs.promises.appendFile(arquivo, texto))
      .catch((err) => this.avisar(err));
  }

  /** erro de gravação só aparece uma vez no console: o servidor segue normal */
  private avisar(err: unknown) {
    if (this.avisou) return;
    this.avisou = true;
    console.warn("[gravador] não consegui gravar os eventos (aviso só uma vez):", err);
  }
}
