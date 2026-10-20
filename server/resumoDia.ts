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
/** parte da cota do dia que sessões ainda desconhecidas podem usar; o resto é de quem abriu sessão de verdade */
export const FRACAO_COTA_DESCONHECIDAS = 0.7;
/** sessões "conhecidas" (viram com SessionStart/UserPromptSubmit) por dia, e quantas podem virar por minuto */
const MAX_CONHECIDAS = 300;
const MAX_PROMOCOES_POR_MINUTO = 30;
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
  /** datas (AAAA-MM-DD) em que algum evento foi descartado por falta de cota */
  private cortados = new Set<string>();
  private avisouCota = new Set<string>();
  /** sessões que já mostraram um SessionStart/UserPromptSubmit neste dia: podem usar a cota inteira */
  private conhecidas = new Set<string>();
  private promocoesNoMinuto = { inicio: 0, n: 0 };
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
        this.conhecidas.clear();
      }
      const enxuto = limitar(enxugarEvento(body as Record<string, unknown>, this.rotulos));
      this.gravar({ chegada, hookTs, evento: enxuto }, chegada, this.sessaoConhecida(body as Record<string, unknown>, chegada));
    } catch (err) {
      this.avisar(err);
    }
  }

  /** O dia perdeu eventos por falta de cota? (`bytes`: tamanho do arquivo, para o caso do servidor ter reiniciado) */
  limiteAtingido(data: string, bytes = 0): boolean {
    return this.cortados.has(data) || (bytes > 0 && bytes + 4096 > this.limiteBytes);
  }

  /**
   * Um flood de POSTs com sessões inventadas não pode esgotar a cota do dia: sessão só vira "conhecida" ao mandar
   * SessionStart/UserPromptSubmit (no máximo 30 por minuto e 300 por dia); as desconhecidas
   * usam só uma parte da cota.
   */
  private sessaoConhecida(body: Record<string, unknown>, agora: number): boolean {
    const sid = typeof body.session_id === "string" ? body.session_id.slice(0, 200) : "";
    if (!sid) return false;
    if (this.conhecidas.has(sid)) return true;
    const nome = body.hook_event_name;
    if (nome !== "SessionStart" && nome !== "UserPromptSubmit") return false;
    if (this.conhecidas.size >= MAX_CONHECIDAS) return false;
    const j = this.promocoesNoMinuto;
    if (agora - j.inicio >= 60_000) {
      j.inicio = agora;
      j.n = 0;
    }
    if (j.n >= MAX_PROMOCOES_POR_MINUTO) return false;
    j.n++;
    this.conhecidas.add(sid);
    return true;
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

  private gravar(linha: LinhaGravada, chegada: number, conhecida = true) {
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
        let atual = this.tamanhos.get(arquivo);
        if (atual === undefined) {
          await fs.promises.mkdir(this.pasta, { recursive: true });
          atual = await fs.promises.stat(arquivo).then((s) => s.size, () => 0);
        }
        const teto = conhecida ? this.limiteBytes : Math.floor(this.limiteBytes * FRACAO_COTA_DESCONHECIDAS);
        if (atual + bytes > teto) {
          const data = path.basename(arquivo, ".jsonl");
          this.cortados.add(data);
          if (!this.avisouCota.has(data + conhecida)) {
            this.avisouCota.add(data + conhecida);
            console.warn(
              `[resumo do dia] limite do dia atingido (${Math.round(teto / 1024 / 1024 * 10) / 10} MB para ${conhecida ? "sessões conhecidas" : "sessões novas"}): o replay deste dia fica incompleto (aviso só uma vez)`,
            );
          }
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
