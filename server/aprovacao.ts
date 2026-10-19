// Aprovação da Caixa de entrada: POST /api/caixa/aprovar.
//
// Para cada tarefa em aberto da reunião você escolhe "time" (🤖), "eu" (🙋) ou "ignorar" (🗑️). Aqui o servidor:
//   1. grava a escolha na própria linha da nota em 10-Reunioes/ (`classe: time|eu`; ignorar vira `- [-]`);
//   2. se houver ao menos uma "time", cria UMA missão em 20-Missoes/ (formato do passo 7 de commands/reuniao.md);
//   3. preenche "## Missões geradas" e troca `status: rascunho` por `status: processada`;
//   4. devolve o comando `/time ...` pronto. O servidor NUNCA dispara o Claude: quem roda é você, no terminal.
//
// Segurança: o corpo só aceita o id da reunião (letras, números e hífen) e números de tarefa; o caminho dos
// arquivos é montado aqui, sempre dentro de 10-Reunioes/ e 20-Missoes/. Reuniões são aprovadas uma de cada vez
// (fila) e a missão é gravada com a flag `wx` (nunca sobrescreve). A nota mantém CRLF e BOM.

import express, { type Express } from "express";
import fsp from "node:fs/promises";
import path from "node:path";
import { diaLocal } from "../shared/datas.ts";
import type { CaixaAcao, CaixaResposta } from "../shared/types.ts";
import { MAX_BYTES_NOTA, MAX_TAREFAS, hashTarefa, idValido, lerTarefasDaNota, tituloDe, type ObservadorCaixa } from "./caixa.ts";
import { nomeLivre, slugDe } from "./reunioesVault.ts";
import { writeAtomic } from "./roster.ts";
import { exigirHostLocal, exigirPostSeguro } from "./seguranca.ts";
import { chave, cortar, lerFrontmatter, semLinks } from "./vault.ts";

/** o painel mostra (e o servidor exige decisão de) no máximo MAX_TAREFAS tarefas por reunião */
const MAX_DECISOES = MAX_TAREFAS;
const MAX_TEXTO_MISSAO = 200;
const ACOES: readonly CaixaAcao[] = ["time", "eu", "ignorar"];

export type RespostaAprovacao = { status: 200; corpo: CaixaResposta } | { status: number; corpo: { ok: false; erros: string[] } };

function erro(status: number, ...erros: string[]): RespostaAprovacao {
  return { status, corpo: { ok: false, erros } };
}

export interface CorpoValido {
  reuniao: string;
  decisoes: Map<number, { acao: CaixaAcao; h?: string }>;
}

/** Confere o corpo do POST sem confiar em nada: devolve os erros em português. */
export function validarCorpo(corpo: unknown): { ok: true; valor: CorpoValido } | { ok: false; erros: string[] } {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { ok: false, erros: ["Corpo inválido"] };
  const { reuniao, decisoes } = corpo as { reuniao?: unknown; decisoes?: unknown };
  if (!idValido(reuniao)) return { ok: false, erros: ["Reunião inválida"] };
  if (!Array.isArray(decisoes) || decisoes.length > MAX_DECISOES) return { ok: false, erros: ["Lista de decisões inválida"] };
  const mapa = new Map<number, { acao: CaixaAcao; h?: string }>();
  for (const d of decisoes) {
    const { n, acao, h } = (d && typeof d === "object" ? d : {}) as { n?: unknown; acao?: unknown; h?: unknown };
    if (h !== undefined && (typeof h !== "string" || !/^[0-9a-f]{8}$/.test(h))) return { ok: false, erros: ["Conferência da tarefa inválida"] };
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 1000) return { ok: false, erros: ["Número de tarefa inválido"] };
    if (typeof acao !== "string" || !(ACOES as readonly string[]).includes(acao)) return { ok: false, erros: ["Ação inválida"] };
    if (mapa.has(n)) return { ok: false, erros: [`Tarefa ${n} repetida`] };
    mapa.set(n, { acao: acao as CaixaAcao, h });
  }
  return { ok: true, valor: { reuniao, decisoes: mapa } };
}

// ---------------------------------------------------------------- reescrita da nota

/** troca (ou acrescenta) uma chave do frontmatter; `fim` é a linha do `---` de fechamento. Devolve o novo `fim`. */
export function definirChave(linhas: string[], fim: number, nome: string, valor: string): number {
  const re = new RegExp(`^\\s*${nome}\\s*:`, "i");
  let achou = false;
  for (let i = 1; i < fim; i++) {
    if (re.test(linhas[i])) {
      linhas[i] = `${nome}: ${valor}`;
      achou = true;
    }
  }
  if (achou) return fim;
  linhas.splice(fim, 0, `${nome}: ${valor}`);
  return fim + 1;
}

/** `classe: ?` vira `classe: time|eu` (acrescenta o campo se a linha não tinha) */
function comClasse(linha: string, classe: string): string {
  return /\|\s*classe\s*:[^|]*/i.test(linha) ? linha.replace(/(\|\s*classe\s*:)[^|]*/i, `$1 ${classe}`) : `${linha} | classe: ${classe}`;
}

/** "## Missões geradas": troca os marcadores da seção por `- [[missão]]` (ou `- nenhuma`), sem mexer no resto */
function preencherMissoesGeradas(linhas: string[], marcador: string): string[] {
  const cab = linhas.findIndex((l) => /^##\s+Miss(?:ões|oes)\s+geradas\b/i.test(l));
  if (cab < 0) return [...linhas, "", "## Missões geradas", marcador, ""];
  let fim = linhas.findIndex((l, i) => i > cab && /^##\s/.test(l));
  if (fim < 0) fim = linhas.length;
  const primeiro = linhas.findIndex((l, i) => i > cab && i < fim && /^\s*-\s/.test(l));
  if (primeiro < 0) return [...linhas.slice(0, cab + 1), marcador, ...linhas.slice(cab + 1)];
  let ultimo = primeiro;
  while (ultimo + 1 < fim && /^\s*-\s/.test(linhas[ultimo + 1])) ultimo++;
  return [...linhas.slice(0, primeiro), marcador, ...linhas.slice(ultimo + 1)];
}

/** crase vira aspa simples: o comando sugerido fica dentro de um bloco de código e a crase o quebraria */
function semCrase(valor: string): string {
  return valor.replace(/`/g, "'");
}

function frontmatterSeguro(valor: string): string {
  return semCrase(valor.replace(/[\r\n]+/g, " ").replace(/#/g, "")).trim();
}

const MSG_NOTA_MUDOU = "A nota mudou, tente de novo";

// ---------------------------------------------------------------- fila

/** uma aprovação por vez: duas pessoas (ou dois cliques) na mesma reunião não criam duas missões */
let fila: Promise<unknown> = Promise.resolve();

function naFila<T>(fn: () => Promise<T>): Promise<T> {
  const rodar = fila.then(fn, fn);
  fila = rodar.catch(() => undefined);
  return rodar;
}

// ---------------------------------------------------------------- aprovação

export interface AprovarOpcoes {
  now?: () => Date;
  /** só para teste: roda logo antes da conferência final da nota (simula edição no meio da aprovação) */
  antesDeGravar?: () => void | Promise<void>;
}

export function aprovarReuniao(vault: string, corpo: unknown, opts: AprovarOpcoes = {}): Promise<RespostaAprovacao> {
  const v = validarCorpo(corpo);
  if (!v.ok) return Promise.resolve(erro(400, ...v.erros));
  return naFila(() => aprovar(vault, v.valor, opts.now ?? (() => new Date()), opts.antesDeGravar));
}

async function nomesMd(dir: string): Promise<Set<string>> {
  try {
    return new Set((await fsp.readdir(dir)).filter((n) => /\.md$/i.test(n)).map((n) => n.replace(/\.md$/i, "")));
  } catch {
    return new Set();
  }
}

async function aprovar(vault: string, { reuniao, decisoes }: CorpoValido, now: () => Date, antesDeGravar?: () => void | Promise<void>): Promise<RespostaAprovacao> {
  const dirReunioes = path.join(vault, "10-Reunioes");
  const dirMissoes = path.join(vault, "20-Missoes");
  // o id já passou pela regex (sem barra nem ponto): o arquivo só pode estar dentro de 10-Reunioes
  const arquivo = path.join(dirReunioes, `${reuniao}.md`);

  let st;
  try {
    st = await fsp.lstat(arquivo);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return erro(404, "Não achei essa reunião");
    throw err;
  }
  if (!st.isFile()) return erro(400, "Reunião inválida");
  if (st.size > MAX_BYTES_NOTA) return erro(400, "A nota é grande demais para aprovar pelo painel");

  const bruto = await fsp.readFile(arquivo, "utf8");
  const fm = lerFrontmatter(bruto);
  if (!fm || chave(fm.tipo ?? "") !== "reuniao" || chave(fm.origem ?? "") !== "leitura-automatica") {
    return erro(400, "Essa nota não é da Caixa de entrada");
  }
  if (chave(fm.status ?? "") !== "rascunho") return erro(409, "Essa reunião já foi aprovada");

  const temBom = bruto.charCodeAt(0) === 0xfeff;
  const nl = bruto.includes("\r\n") ? "\r\n" : "\n";
  const linhas = (temBom ? bruto.slice(1) : bruto).split(/\r?\n/);
  const tarefas = lerTarefasDaNota(linhas);
  // só as primeiras MAX_TAREFAS em aberto (as que o painel mostra) exigem decisão; as demais ficam intocadas
  const abertas = tarefas.filter((t) => t.marca === " ").slice(0, MAX_TAREFAS);

  for (const n of decisoes.keys()) {
    if (!abertas.some((t) => t.n === n)) return erro(400, `A tarefa ${n} não está em aberto nessa reunião`);
  }
  const faltam = abertas.filter((t) => !decisoes.has(t.n)).map((t) => t.n);
  if (faltam.length > 0) return erro(400, `Falta escolher a tarefa ${faltam.join(", ")}`);
  // o painel guardou o texto de cada tarefa: se a nota mudou desde então, o número pode apontar para outra tarefa
  for (const t of abertas) {
    const h = decisoes.get(t.n)?.h;
    if (h !== undefined && h !== hashTarefa(t.texto)) return erro(409, MSG_NOTA_MUDOU);
  }

  // 1. a escolha vai para a linha de cada tarefa
  const doTime = [];
  for (const t of abertas) {
    const acao = (decisoes.get(t.n) as { acao: CaixaAcao }).acao;
    if (acao === "ignorar") {
      linhas[t.indice] = linhas[t.indice].replace("[ ]", "[-]");
    } else {
      linhas[t.indice] = comClasse(linhas[t.indice], acao);
      if (acao === "time") doTime.push(t);
    }
  }

  const agora = now();
  const hoje = diaLocal(agora.getTime());
  const titulo = semCrase(tituloDe(linhas) || reuniao);
  const projeto = semCrase(cortar(semLinks(fm.projeto ?? ""), 120));

  // 2. uma missão por reunião, com todas as tarefas "Time faz"
  let missao: string | null = null;
  let comando: string | null = null;
  if (doTime.length > 0) {
    const usados = new Set([...(await nomesMd(dirMissoes)), ...(await nomesMd(dirReunioes))]);
    const descricao = `Fazer ${doTime.length === 1 ? "a tarefa" : `as ${doTime.length} tarefas`} da reunião ${titulo}`;
    const itens = doTime.map((t) => {
      const texto = semCrase(cortar(semLinks(t.texto) || t.texto, MAX_TEXTO_MISSAO));
      return `- [ ] ${texto}${t.prazo ? ` | prazo: ${t.prazo}` : ""}`;
    });
    await fsp.mkdir(dirMissoes, { recursive: true });
    for (let tentativa = 0; tentativa < 50 && missao === null; tentativa++) {
      const nome = nomeLivre(hoje, `${slugDe(titulo)}-missao`, usados);
      const cmd = `/time Missão [[${nome}]]: ${descricao}.${projeto ? ` Projeto: ${projeto}` : ""}`;
      const texto = [
        "---",
        "tipo: missao",
        `projeto: ${frontmatterSeguro(projeto)}`,
        `data: ${hoje}`,
        "status: a fazer",
        "origem: reuniao",
        `reuniao: ${reuniao}`,
        `reuniao_titulo: ${frontmatterSeguro(titulo)}`,
        "classe: time",
        "tags: [missao]",
        "confidencial: false",
        `aprovada_em: ${agora.toISOString()}`,
        "---",
        "",
        `# Tarefas: ${titulo}`,
        "",
        `**Origem:** [[${reuniao}]]${projeto ? ` · **Projeto:** [[${projeto}]]` : ""}`,
        "",
        "## Objetivo",
        `${descricao}, como aprovado na Caixa de entrada.`,
        "",
        "## Tarefas",
        ...itens,
        "",
        "## Comando sugerido",
        `\`${cmd}\``,
        "",
        "## Resultado",
        "- Commits:",
        "- O que mudou:",
        "- Sessão:",
        "",
      ].join("\n");
      try {
        await fsp.writeFile(path.join(dirMissoes, `${nome}.md`), texto, { encoding: "utf8", flag: "wx" });
        missao = nome;
        comando = cmd;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        usados.add(nome);
      }
    }
    if (missao === null) return erro(500, "Não achei um nome livre para a missão");
  }

  // 3. a reunião vira "processada" e aponta para a missão
  let fim = linhas.findIndex((l, i) => i > 0 && l.trim() === "---");
  fim = definirChave(linhas, fim, "status", "processada");
  definirChave(linhas, fim, "aprovada_em", agora.toISOString());
  const final = preencherMissoesGeradas(linhas, missao ? `- [[${missao}]]` : "- nenhuma");
  try {
    // a nota pode ter sido editada (OneDrive, Obsidian) desde a leitura: confere de novo antes de sobrescrever
    await antesDeGravar?.();
    const agoraSt = await fsp.lstat(arquivo).catch(() => null);
    if (!agoraSt || agoraSt.size !== st.size || agoraSt.mtimeMs !== st.mtimeMs) {
      if (missao) await fsp.rm(path.join(dirMissoes, `${missao}.md`), { force: true }).catch(() => undefined);
      return erro(409, MSG_NOTA_MUDOU);
    }
    await writeAtomic(arquivo, (temBom ? "﻿" : "") + final.join(nl));
  } catch (err) {
    // a missão acabou de ser criada por nós e a reunião continua rascunho: desfaz para não duplicar na próxima tentativa
    if (missao) await fsp.rm(path.join(dirMissoes, `${missao}.md`), { force: true }).catch(() => undefined);
    throw err;
  }
  return { status: 200, corpo: { ok: true, comando, missao } };
}

// ---------------------------------------------------------------- rotas

export interface RotasCaixaDeps {
  resolverVault: () => string | null;
  caixa: ObservadorCaixa;
  /** porta do servidor (para conferir o Origin) */
  porta: () => number;
  now?: () => Date;
}

/** GET /api/caixa e POST /api/caixa/aprovar */
export function registrarCaixa(app: Express, deps: RotasCaixaDeps) {
  app.get("/api/caixa", exigirHostLocal(deps.porta), async (_req, res) => {
    await Promise.race([deps.caixa.pronto, new Promise((r) => setTimeout(r, 3000).unref())]);
    res.json({ itens: deps.caixa.getItens() });
  });

  app.post("/api/caixa/aprovar", exigirPostSeguro(deps.porta), express.json({ limit: "16kb" }), async (req, res) => {
    const vault = deps.resolverVault();
    if (!vault) {
      res.status(503).json({ ok: false, erros: ["O vault não está configurado. Rode npm run setup."] });
      return;
    }
    try {
      const r = await aprovarReuniao(vault, req.body, { now: deps.now });
      if (r.status === 200) await deps.caixa.recarregar();
      res.status(r.status).json(r.corpo);
    } catch (err) {
      console.error("[caixa] erro ao aprovar:", err instanceof Error ? err.message : err);
      res.status(500).json({ ok: false, erros: ["Não consegui salvar a aprovação no vault. Tente de novo."] });
    }
  });
}
