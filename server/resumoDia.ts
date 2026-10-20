// Resumo LEVE do dia para o "Replay do dia": SEMPRE gravado (o gravador completo continua desligado), em
// data/replay/AAAA-MM-DD.jsonl (dia local). Cada linha tem o formato do gravador ({chegada, hookTs, evento}), então o
// reproduzir do server/replay.ts aceita o arquivo sem adaptação.
//
// O evento é ENXUTO: ficam só identificadores curtos e a estrutura (tipo do evento, ferramenta, tipo de agente,
// status das tarefas). SOMEM prompt, mensagem, resposta da ferramenta, comando, busca e qualquer texto livre; o cwd
// vira "/projeto" e os caminhos viram "arquivo-N.ext". Ver enxugarEvento em server/replay.ts.
//
// Regras: `evento` NUNCA lança nem espera (é chamado na fila dos hooks): a gravação é uma corrente de promessas em
// segundo plano. Limite de ~5 MB por dia (depois para e avisa uma vez) e retenção de ~30 dias (limpeza no boot).

import fs from "node:fs";
import path from "node:path";
import { arquivoDoDia, type LinhaGravada } from "./gravador.ts";
import { criarRotulos, enxugarEvento } from "./replay.ts";

export const LIMITE_BYTES_DIA = 5 * 1024 * 1024;
export const RETENCAO_DIAS = 30;
/** campos de texto curtos (ids, tipos) que passam; o que for maior é cortado */
const MAX_TEXTO = 80;

const NOME_ARQUIVO = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/;

export interface OpcoesResumoDia {
  now?: () => number;
  limiteBytes?: number;
  retencaoDias?: number;
}

/** corta strings longas (profundidade pequena: o evento enxuto é raso) */
function limitar(v: unknown, nivel = 0): unknown {
  if (typeof v === "string") return v.length > MAX_TEXTO ? v.slice(0, MAX_TEXTO) : v;
  if (Array.isArray(v)) return nivel > 4 ? [] : v.slice(0, 200).map((x) => limitar(x, nivel + 1));
  if (typeof v === "object" && v !== null) {
    if (nivel > 4) return {};
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = limitar(x, nivel + 1);
    return out;
  }
  return v;
}

export class ResumoDia {
  private cadeia: Promise<void> = Promise.resolve();
  private avisouErro = false;
  /** rótulos do dia atual ("arquivo-N" estável dentro do dia) */
  private diaDosRotulos = "";
  private rotulos = criarRotulos();
  /** bytes já escritos por arquivo (lido do disco na primeira vez) */
  private tamanhos = new Map<string, number>();
  private estourou = new Set<string>();
  private readonly now: () => number;
  private readonly limiteBytes: number;
  private readonly retencaoDias: number;

  constructor(
    private readonly pasta: string,
    opts: OpcoesResumoDia = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.limiteBytes = opts.limiteBytes ?? LIMITE_BYTES_DIA;
    this.retencaoDias = opts.retencaoDias ?? RETENCAO_DIAS;
  }

  /** Marcador de início do servidor (o replay recria o estado aqui). */
  servidorIniciou() {
    const chegada = this.now();
    this.gravar({ chegada, marcador: "servidor_iniciou" }, chegada);
  }

  /** Grava a versão enxuta do evento. Nunca lança e não espera nada. */
  evento(body: unknown, hookTs: number | null) {
    try {
      if (typeof body !== "object" || body === null || Array.isArray(body)) return;
      const chegada = this.now();
      const arquivo = arquivoDoDia(this.pasta, chegada);
      if (arquivo !== this.diaDosRotulos) {
        this.diaDosRotulos = arquivo;
        this.rotulos = criarRotulos();
      }
      const enxuto = limitar(enxugarEvento(body as Record<string, unknown>, this.rotulos));
      this.gravar({ chegada, hookTs, evento: enxuto }, chegada);
    } catch (err) {
      this.avisar(err);
    }
  }

  /** Espera as gravações pendentes (testes e encerramento). */
  esvaziar(): Promise<void> {
    return this.cadeia;
  }

  /** Apaga os dias além da retenção (só arquivos AAAA-MM-DD.jsonl desta pasta). Roda no boot; nunca lança. */
  async limpar(): Promise<string[]> {
    const apagados: string[] = [];
    try {
      const corte = new Date(this.now());
      corte.setHours(0, 0, 0, 0);
      corte.setDate(corte.getDate() - this.retencaoDias);
      for (const nome of await fs.promises.readdir(this.pasta)) {
        const m = NOME_ARQUIVO.exec(nome);
        if (!m) continue;
        const dia = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        if (dia.getTime() >= corte.getTime()) continue;
        try {
          await fs.promises.unlink(path.join(this.pasta, nome));
          apagados.push(nome);
        } catch {
          /* arquivo em uso: fica para o próximo boot */
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") this.avisar(err);
    }
    return apagados;
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
    const bytes = Buffer.byteLength(texto);
    this.cadeia = this.cadeia
      .then(async () => {
        if (this.estourou.has(arquivo)) return;
        let atual = this.tamanhos.get(arquivo);
        if (atual === undefined) {
          await fs.promises.mkdir(this.pasta, { recursive: true });
          atual = await fs.promises.stat(arquivo).then((s) => s.size, () => 0);
        }
        if (atual + bytes > this.limiteBytes) {
          this.estourou.add(arquivo);
          console.warn(`[resumo do dia] limite de ${Math.round(this.limiteBytes / 1024 / 1024)} MB do dia atingido: o replay deste dia para por aqui (aviso só uma vez)`);
          return;
        }
        await fs.promises.appendFile(arquivo, texto);
        this.tamanhos.set(arquivo, atual + bytes);
      })
      .catch((err) => this.avisar(err));
  }

  private avisar(err: unknown) {
    if (this.avisouErro) return;
    this.avisouErro = true;
    console.warn("[resumo do dia] não consegui gravar (aviso só uma vez):", err instanceof Error ? err.message : err);
  }
}
