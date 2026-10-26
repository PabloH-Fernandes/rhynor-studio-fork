// Transparência: classificação (níveis, caminhos), replay de sessões gravadas, log sem conteúdo, throttle e rotas.
// Só dados fictícios e pastas temporárias (mkdtemp): nunca o vault de verdade.
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CAMPOS_REGISTRO, tipoInformativo, type RegistroTransparencia } from "../shared/transparencia.ts";
import { lerJsonl } from "./replay.ts";
import { OfficeState } from "./state.ts";
import { classificarEvento, type ContextoTransparencia } from "./transparencia.ts";
import { LogTransparencia, ehMes, lerLinha, mesDe, montarMd, registrarTransparencia, resumirLinhas } from "./transparenciaLog.ts";
import { ObservadorResultados } from "./resultados.ts";
import { AGORA, criarReuniao, novoVaultDeTeste, type VaultDeTeste } from "./testeVault.ts";
import { ObservadorVault } from "./vaultWatcher.ts";

const PASTA = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "sessoes");
const SEGREDO = "SEGREDO-NUNCA-NO-LOG";

/** vault fictício: uma nota aberta, uma confidencial pelo frontmatter e uma reunião */
function vaultComNotas(): VaultDeTeste {
  const v = novoVaultDeTeste();
  fs.mkdirSync(path.join(v.vault, "30-Projetos"));
  fs.writeFileSync(path.join(v.vault, "30-Projetos", "projeto-alfa.md"), `---\ntipo: projeto\nconfidencial: false\n---\n# Alfa\n${SEGREDO}\n`);
  fs.writeFileSync(path.join(v.vault, "30-Projetos", "nota-reservada.md"), `---\ntipo: projeto\nconfidencial: true\n---\n# Reservada\n${SEGREDO}\n`);
  fs.writeFileSync(path.join(v.reunioes, "2026-10-17-reuniao-ficticia.md"), `---\ntipo: reuniao\nconfidencial: true\n---\n${SEGREDO}\n`);
  fs.writeFileSync(path.join(v.vault, "00-Inbox", "2026-10-17-ata-ficticia.md"), `${SEGREDO}\n`);
  fs.writeFileSync(path.join(v.vault, "00-Inbox", "LEIA-ME.md"), "Coloque as atas aqui.\n");
  return v;
}

const contexto = (v: VaultDeTeste, extra: Partial<ContextoTransparencia> = {}): ContextoTransparencia => ({
  vault: v.vault,
  reuniaoSessionId: null,
  missaoDaSessao: () => null,
  ...extra,
});

const pre = (tool: string, tool_input: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  hook_event_name: "PreToolUse",
  session_id: "s1",
  cwd: "/qualquer/lugar",
  tool_name: tool,
  tool_input,
  ...extra,
});

// ---------------------------------------------------------------- classificação

test("só PreToolUse das ferramentas de arquivo e busca; PostToolUse e outras ferramentas não geram registro", async () => {
  const v = vaultComNotas();
  try {
    const arq = path.join(v.vault, "30-Projetos", "projeto-alfa.md");
    const r = (await classificarEvento(pre("Read", { file_path: arq }), contexto(v)));
    assert.ok(r);
    assert.deepEqual([r.acao, r.arquivo, r.nivel, r.confidencial, r.agente, r.ferramenta, r.via], ["leu", "30-Projetos/projeto-alfa.md", "normal", false, "lider", "Read", "PreToolUse"]);
    assert.equal((await classificarEvento({ ...pre("Read", { file_path: arq }), hook_event_name: "PostToolUse", tool_response: { x: SEGREDO } }, contexto(v))), null);
    assert.equal((await classificarEvento(pre("Bash", { command: `cat ${arq}` }), contexto(v))), null);
    assert.equal((await classificarEvento({ hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: arq }, contexto(v))), null);
    assert.equal((await classificarEvento(pre("Read", { file_path: arq }), { ...contexto(v), vault: null })), null);
    assert.equal((await classificarEvento(null, contexto(v))), null);
    assert.equal((await classificarEvento(pre("Read", {}), contexto(v))), null);
    // ações
    for (const [tool, acao] of [["Write", "escreveu"], ["Edit", "editou"], ["MultiEdit", "editou"]] as const) {
      assert.equal((await classificarEvento(pre(tool, { file_path: arq }), contexto(v)))?.acao, acao);
    }
  } finally {
    v.limpar();
  }
});

test("fora do vault é ignorado (inclusive pasta irmã com o mesmo começo de nome)", async () => {
  const v = vaultComNotas();
  try {
    assert.equal((await classificarEvento(pre("Read", { file_path: path.join(os.tmpdir(), "fora.md") }), contexto(v))), null);
    assert.equal((await classificarEvento(pre("Read", { file_path: `${v.vault}-irmao/10-Reunioes/x.md` }), contexto(v))), null);
    assert.equal((await classificarEvento(pre("Grep", { pattern: "x", path: os.tmpdir() }), contexto(v))), null);
    // caminho relativo sem cwd não dá para resolver
    assert.equal((await classificarEvento({ ...pre("Read", { file_path: "10-Reunioes/x.md" }), cwd: undefined }, contexto(v))), null);
  } finally {
    v.limpar();
  }
});

test("níveis: leitura de 10-Reunioes e de nota confidencial = violação; ata do Inbox na sessão do /reuniao = informativo", async () => {
  const v = vaultComNotas();
  try {
    const ata = path.join(v.vault, "00-Inbox", "2026-10-17-ata-ficticia.md");
    const reuniao = path.join(v.reunioes, "2026-10-17-reuniao-ficticia.md");
    const reservada = path.join(v.vault, "30-Projetos", "nota-reservada.md");
    const nivel = async (arq: string, extra: Partial<ContextoTransparencia> = {}, ev: Record<string, unknown> = {}) =>
      classificarEvento(pre("Read", { file_path: arq }, ev), contexto(v, extra));

    // fora de /reuniao
    assert.equal((await nivel(ata))?.nivel, "violacao");
    assert.equal((await nivel(ata))?.confidencial, true);
    assert.equal((await nivel(reservada))?.nivel, "violacao");
    assert.equal((await nivel(reservada))?.confidencial, true);
    assert.equal((await nivel(reuniao, {}, { agent_type: "dev" }))?.nivel, "violacao");
    assert.equal((await nivel(reuniao, {}, { agent_type: "dev" }))?.agente, "dev");
    // /reuniao desta sessão: a ata do Inbox é esperada; outra sessão continua sendo violação
    assert.equal((await nivel(ata, { reuniaoSessionId: "s1" }))?.nivel, "informativo");
    assert.equal((await nivel(ata, { reuniaoSessionId: "outra" }))?.nivel, "violacao");
    // 10-Reunioes é violação mesmo na reunião
    assert.equal((await nivel(reuniao, { reuniaoSessionId: "s1" }))?.nivel, "violacao");
    // LEIA-ME do Inbox não é confidencial
    const leia = (await nivel(path.join(v.vault, "00-Inbox", "LEIA-ME.md")));
    assert.deepEqual([leia?.nivel, leia?.confidencial], ["normal", false]);
    // escrever/editar nota confidencial fora do /reuniao: registra, marca confidencial e avisa (informativo)
    const w = await classificarEvento(pre("Write", { file_path: reuniao }), contexto(v));
    assert.deepEqual([w?.acao, w?.nivel, w?.confidencial], ["escreveu", "informativo", true]);
    assert.equal(tipoInformativo(w!), "alteracao");
    const e = await classificarEvento(pre("Edit", { file_path: reservada }), contexto(v));
    assert.deepEqual([e?.nivel, e?.confidencial], ["informativo", true]);
    // dentro do /reuniao da mesma sessão: Inbox e nota de reunião são o trabalho dela (normal); outra nota confidencial avisa
    const dentro = (arq: string, tool = "Write") => classificarEvento(pre(tool, { file_path: arq }), contexto(v, { reuniaoSessionId: "s1" }));
    assert.equal((await dentro(reuniao))?.nivel, "normal");
    assert.equal((await dentro(ata, "Edit"))?.nivel, "normal");
    assert.equal((await dentro(reservada))?.nivel, "informativo");
    // outra sessão em reunião não vale
    assert.equal((await classificarEvento(pre("Write", { file_path: reuniao }), contexto(v, { reuniaoSessionId: "outra" })))?.nivel, "informativo");
    // nota comum e LEIA-ME seguem normais
    assert.equal((await classificarEvento(pre("MultiEdit", { file_path: path.join(v.vault, "30-Projetos", "projeto-alfa.md") }), contexto(v)))?.nivel, "normal");
    assert.equal((await classificarEvento(pre("Edit", { file_path: path.join(v.vault, "00-Inbox", "LEIA-ME.md") }), contexto(v)))?.nivel, "normal");
    // tipos de aviso das leituras na reunião: ata do Inbox x outra nota confidencial
    const ataR = await nivel(ata, { reuniaoSessionId: "s1" });
    const notaR = await nivel(reservada, { reuniaoSessionId: "s1" });
    assert.deepEqual([tipoInformativo(ataR!), tipoInformativo(notaR!)], ["reuniao-ata", "reuniao-nota"]);
  } finally {
    v.limpar();
  }
});

test("Grep e Glob: pasta confidencial = violação; pasta comum = normal; sem path usa o cwd; padrão buscado nunca vai no registro", async () => {
  const v = vaultComNotas();
  try {
    const g = (await classificarEvento(pre("Grep", { pattern: SEGREDO, path: path.join(v.vault, "10-Reunioes") }), contexto(v)));
    assert.deepEqual([g?.acao, g?.nivel, g?.arquivo, g?.confidencial], ["buscou", "violacao", "10-Reunioes", true]);
    assert.ok(!JSON.stringify(g).includes(SEGREDO));
    assert.equal((await classificarEvento(pre("Glob", { pattern: "**/*.md", path: path.join(v.vault, "00-Inbox") }), contexto(v)))?.nivel, "violacao");
    const comum = (await classificarEvento(pre("Glob", { pattern: "*.md", path: path.join(v.vault, "30-Projetos") }), contexto(v)));
    assert.deepEqual([comum?.nivel, comum?.arquivo], ["normal", "30-Projetos"]);
    // sem path: vale o cwd
    const cwd = (await classificarEvento(pre("Grep", { pattern: "x" }, { cwd: path.join(v.vault, "10-Reunioes") }), contexto(v)));
    assert.equal(cwd?.nivel, "violacao");
    const raiz = await classificarEvento(pre("Grep", { pattern: SEGREDO }, { cwd: v.vault }), contexto(v));
    assert.deepEqual([raiz?.arquivo, raiz?.nivel], [".", "informativo"]);
    assert.equal(tipoInformativo(raiz!), "busca-raiz");
    // path explícito na raiz (Grep e Glob), com barra final ou invertida: mesmo aviso, sem alarme falso
    for (const [tool, entrada] of [
      ["Grep", { pattern: SEGREDO, path: v.vault }],
      ["Glob", { pattern: "**/*.md", path: v.vault + "/" }],
      ["Grep", { pattern: SEGREDO, path: v.vault.replaceAll("/", "\\") }],
    ] as const) {
      const r = await classificarEvento(pre(tool, entrada), contexto(v));
      assert.deepEqual([r?.nivel, r?.arquivo], ["informativo", "."], tool);
      assert.ok(!JSON.stringify(r).includes(SEGREDO) && !JSON.stringify(r).includes("**/*.md"), "nunca grava pattern/glob");
    }
    // a própria pasta confidencial continua sendo violação; a pasta comum, normal
    assert.equal((await classificarEvento(pre("Grep", { pattern: "x", path: path.join(v.vault, "10-Reunioes", "sub") }), contexto(v)))?.nivel, "violacao");
  } finally {
    v.limpar();
  }
});

test("variações de caminho: barra invertida, maiúsculas, '..', relativo ao cwd e link simbólico dão o mesmo resultado", async () => {
  const v = vaultComNotas();
  try {
    const ctx = contexto(v, { ignorarCaixa: true });
    const alvo = "10-Reunioes/2026-10-17-reuniao-ficticia.md";
    const abs = path.join(v.vault, ...alvo.split("/"));
    const variacoes: [string, Record<string, unknown>][] = [
      [abs, {}],
      [abs.replaceAll("/", "\\"), {}],
      [abs.toUpperCase(), {}],
      [path.join(v.vault, "30-Projetos", "..", "10-Reunioes", "2026-10-17-reuniao-ficticia.md"), {}],
      [`${v.vault}\\30-Projetos\\..\\10-Reunioes\\2026-10-17-reuniao-ficticia.md`, {}],
      [alvo, { cwd: v.vault }],
      ["..\\10-Reunioes\\2026-10-17-reuniao-ficticia.md", { cwd: path.join(v.vault, "30-Projetos") }],
      [alvo.toUpperCase().replace(".MD", ".md"), { cwd: v.vault.toUpperCase() }],
    ];
    for (const [arq, extra] of variacoes) {
      const r = (await classificarEvento(pre("Read", { file_path: arq }, extra), ctx));
      assert.ok(r, `deveria registrar: ${arq}`);
      assert.equal(r.nivel, "violacao", arq);
      assert.equal(r.arquivo.toLowerCase(), alvo.toLowerCase(), arq);
      assert.ok(!r.arquivo.includes("\\") && !r.arquivo.includes(".."), arq);
    }
    // '..' que sai do vault = fora
    assert.equal((await classificarEvento(pre("Read", { file_path: path.join(v.vault, "..", "outro.md") }), ctx)), null);
    // link simbólico para fora do vault (pode não ser permitido no Windows sem privilégio: pula)
    const fora = fs.mkdtempSync(path.join(os.tmpdir(), "fora-"));
    try {
      fs.symlinkSync(fora, path.join(v.vault, "40-Conhecimento", "atalho"), "junction");
      assert.equal((await classificarEvento(pre("Read", { file_path: path.join(v.vault, "40-Conhecimento", "atalho", "x.md") }), ctx)), null);
    } catch (err) {
      if (!["EPERM", "EEXIST", "ENOENT"].includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
    } finally {
      fs.rmSync(fora, { recursive: true, force: true });
    }
  } finally {
    v.limpar();
  }
});

test("sem ignorar maiúsculas (Linux): '10-reunioes' em minúsculas não é a pasta confidencial", async () => {
  const v = vaultComNotas();
  try {
    const r = (await classificarEvento(pre("Read", { file_path: `${v.vault}/10-reunioes-outra/x.md` }), contexto(v, { ignorarCaixa: false, lerInicio: () => null })));
    assert.equal(r?.nivel, "normal");
  } finally {
    v.limpar();
  }
});

test("frontmatter: só os primeiros 4 KB contam e 'confidencial: true' é achado em qualquer variação", async () => {
  const v = vaultComNotas();
  try {
    const arq = path.join(v.vault, "30-Projetos", "qualquer.md");
    const com = async (frontmatter: string) => (await classificarEvento(pre("Read", { file_path: arq }), contexto(v, { lerInicio: () => frontmatter })))?.confidencial;
    assert.equal((await com("---\nconfidencial: true\n---\n")), true);
    assert.equal((await com("---\nConfidencial: Sim\n---\n")), true);
    assert.equal((await com("---\nconfidencial: false\n---\n")), false);
    assert.equal((await com("sem frontmatter")), false);
  } finally {
    v.limpar();
  }
});

// ---------------------------------------------------------------- replay das sessões gravadas

/** passa os eventos pelo mesmo caminho do servidor: classifica ANTES do handleHook, na ordem */
async function reproduzirComLog(arquivo: string, v: VaultDeTeste, observadorVault?: ObservadorVault): Promise<RegistroTransparencia[]> {
  const texto = fs.readFileSync(path.join(PASTA, arquivo), "utf8").replaceAll("{{VAULT}}", JSON.stringify(v.vault).slice(1, -1));
  const state = new OfficeState({ sweepEveryMs: 0 });
  const out: RegistroTransparencia[] = [];
  for (const l of lerJsonl(texto)) {
    if (!("evento" in l)) continue;
    const ev = l.evento as { hook_event_name?: string; session_id?: string; user_prompt?: string; prompt?: string };
    if (ev.hook_event_name === "UserPromptSubmit" && ev.session_id) observadorVault?.notarPrompt(ev.session_id, String(ev.prompt ?? ""));
    const r = (await classificarEvento(l.evento, {
      vault: v.vault,
      reuniaoSessionId: state.getReuniao()?.sessionId ?? null,
      missaoDaSessao: (sid) => observadorVault?.getMissaoDaSessao(sid) ?? null,
    }));
    if (r) out.push(r);
    state.handleHook(l.evento as never);
  }
  return out;
}

test("replay: o /reuniao lendo a ata do Inbox é informativo (esperado), nunca violação", async () => {
  const v = vaultComNotas();
  try {
    const regs = await reproduzirComLog("transparencia-reuniao-le-ata.jsonl", v);
    // a ata (barra normal), o LEIA-ME (barra invertida) e a escrita da nota em 10-Reunioes; o PostToolUse não gera linha
    assert.deepEqual(
      regs.map((r) => [r.acao, r.arquivo, r.nivel, r.confidencial]),
      [
        ["leu", "00-Inbox/2026-10-17-ata-ficticia.md", "informativo", true],
        ["leu", "00-Inbox/LEIA-ME.md", "normal", false],
        ["escreveu", "10-Reunioes/2026-10-17-reuniao-ficticia.md", "normal", true], // dentro do /reuniao: é o trabalho dela
      ],
    );
    assert.ok(regs.every((r) => r.agente === "lider" && r.sessao === "sessao-reuniao"));
    assert.ok(!JSON.stringify(regs).includes("SEGREDO"));
  } finally {
    v.limpar();
  }
});

test("replay: leitura indevida de 10-Reunioes e de nota confidencial = violação; traz agente e missão", async () => {
  const v = vaultComNotas();
  const obs = new ObservadorVault(() => v.vault, { semWatch: true, intervaloMs: 0 });
  try {
    const regs = await reproduzirComLog("transparencia-leitura-indevida.jsonl", v, obs);
    assert.deepEqual(
      regs.map((r) => [r.acao, r.arquivo, r.nivel, r.agente]),
      [
        ["leu", "30-Projetos/projeto-alfa.md", "normal", "dev"],
        ["leu", "10-Reunioes/2026-10-17-reuniao-ficticia.md", "violacao", "dev"],
        ["leu", "30-Projetos/nota-reservada.md", "violacao", "dev"],
        ["buscou", "00-Inbox", "violacao", "dev"],
      ],
    );
    // a missão veio do prompt "/time Missão [[missao-alfa]]"
    assert.ok(regs.every((r) => r.missao === "missao-alfa"));
    assert.ok(!JSON.stringify(regs).includes("SEGREDO"));
  } finally {
    v.limpar();
  }
});

test("getMissaoDaSessao: some com o fim da sessão e não inventa missão", async () => {
  const obs = new ObservadorVault(() => null, { semWatch: true, intervaloMs: 0 });
  assert.equal(obs.getMissaoDaSessao("s1"), null);
  obs.notarPrompt("s1", "/time Missão [[missao-alfa]] fazer");
  assert.equal(obs.getMissaoDaSessao("s1"), "missao-alfa");
  assert.equal(obs.getMissaoDaSessao("s2"), null);
  obs.esquecerSessao("s1");
  assert.equal(obs.getMissaoDaSessao("s1"), null);
});

// ---------------------------------------------------------------- log

const semConsole = async <T>(fn: () => Promise<T> | T): Promise<{ r: T; avisos: string[] }> => {
  const original = console.warn;
  const avisos: string[] = [];
  console.warn = (...a: unknown[]) => void avisos.push(a.join(" "));
  try {
    return { r: await fn(), avisos };
  } finally {
    console.warn = original;
  }
};

test("log: o .jsonl só tem os campos do registro, nenhum conteúdo, e PostToolUse não gera linha", async () => {
  const v = vaultComNotas();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transp-"));
  try {
    const log = new LogTransparencia(() => contexto(v), { dir, now: () => AGORA.getTime() });
    const arq = path.join(v.vault, "30-Projetos", "projeto-alfa.md");
    log.registrar(pre("Read", { file_path: arq }));
    log.registrar({ ...pre("Read", { file_path: arq }), hook_event_name: "PostToolUse", tool_response: { file: { content: SEGREDO } } });
    log.registrar(pre("Write", { file_path: arq, content: SEGREDO }));
    log.registrar(pre("Edit", { file_path: arq, old_string: SEGREDO, new_string: "x" }));
    log.registrar(pre("Grep", { pattern: SEGREDO, path: v.vault }));
    await log.esperarGravacoes();

    const arquivo = path.join(dir, `${mesDe(AGORA.getTime())}.jsonl`);
    assert.equal(arquivo.endsWith("2026-10.jsonl"), true);
    const bruto = fs.readFileSync(arquivo, "utf8");
    assert.ok(!bruto.includes(SEGREDO), "nenhum conteúdo no log");
    const linhas = bruto.trim().split("\n");
    assert.equal(linhas.length, 4);
    for (const l of linhas) {
      assert.deepEqual(Object.keys(JSON.parse(l) as object), [...CAMPOS_REGISTRO]);
      assert.ok(lerLinha(l));
    }
    assert.deepEqual(
      linhas.map((l) => (JSON.parse(l) as RegistroTransparencia).acao),
      ["leu", "escreveu", "editou", "buscou"],
    );
    // os dados de um mês ficam no arquivo do mês do evento
    const lidas = await log.lerMes("2026-10");
    assert.equal(lidas.length, 4);
    assert.deepEqual(await log.lerMes("2026-09"), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    v.limpar();
  }
});

test("log: falha de escrita só avisa (não lança, não atrasa); linha quebrada no arquivo é ignorada", async () => {
  const v = vaultComNotas();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "transp-"));
  try {
    // a "pasta" do log é um arquivo: mkdir/append falham
    const dir = path.join(base, "arquivo-no-lugar-da-pasta");
    fs.writeFileSync(dir, "x");
    const log = new LogTransparencia(() => contexto(v), { dir, now: () => AGORA.getTime() });
    const arq = path.join(v.vault, "30-Projetos", "projeto-alfa.md");
    const { r, avisos } = await semConsole(async () => {
      const antes = Date.now();
      const promessa = log.registrar(pre("Read", { file_path: arq }));
      const ms = Date.now() - antes;
      const reg = await promessa;
      await log.esperarGravacoes();
      return { reg, ms };
    });
    assert.ok(r.reg, "o registro existe mesmo sem conseguir gravar");
    assert.ok(avisos.length >= 1 && avisos[0].includes("[transparencia]"));
    assert.equal(log.getResumo().total, 1);

    // contexto que lança: registrar devolve null e não propaga
    const ruim = new LogTransparencia(() => {
      throw new Error("quebrou");
    });
    assert.equal(await ruim.registrar(pre("Read", { file_path: arq })), null);

    // arquivo do mês com lixo no meio
    const dir2 = path.join(base, "ok");
    fs.mkdirSync(dir2);
    const boa = JSON.stringify({ ts: 1, sessao: "s", agente: "lider", ferramenta: "Read", acao: "leu", arquivo: "a.md", confidencial: false, missao: null, via: "PreToolUse", nivel: "normal" });
    fs.writeFileSync(path.join(dir2, "2026-10.jsonl"), `${boa}\nnao-e-json\n{"ts":"x"}\n${boa}\n`);
    assert.equal((await new LogTransparencia(() => contexto(v), { dir: dir2 }).lerMes("2026-10")).length, 2);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    v.limpar();
  }
});

test("resumo e ws: conta por nível, guarda só as últimas e respeita o throttle (violação sai rápido, com piso)", async () => {
  const v = vaultComNotas();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transp-"));
  let agora = AGORA.getTime();
  try {
    // relógio e agendamento falsos: o teste não depende de quanto o disco demora (antes, um disco
    // lento deixava o setTimeout real disparar no meio da rajada e saía [1, 17])
    const pendentes: { fn: () => void; ms: number; vivo: boolean }[] = [];
    const agendar = (fn: () => void, ms: number) => {
      const p = { fn, ms, vivo: true };
      pendentes.push(p);
      return { cancelar: () => void (p.vivo = false) };
    };
    const rodarPendentes = () => {
      for (const p of pendentes.splice(0)) if (p.vivo) p.fn();
    };
    const log = new LogTransparencia(() => contexto(v), { dir, now: () => agora, throttleMs: 1500, pisoViolacaoMs: 150, agendar });
    const envios: number[] = [];
    log.subscribe((r) => envios.push(r.total));
    const arq = path.join(v.vault, "30-Projetos", "projeto-alfa.md");
    for (let i = 0; i < 30; i++) void log.registrar(pre("Read", { file_path: arq }));
    await log.esperarGravacoes();
    assert.deepEqual(envios, [1], "30 eventos seguidos: só o primeiro sai na hora");
    assert.deepEqual(
      pendentes.filter((p) => p.vivo).map((p) => p.ms),
      [1500],
      "um envio atrasado só, no fim do throttle",
    );
    agora += 1500;
    rodarPendentes();
    // o último estado sempre sai (trailing)
    assert.deepEqual(envios, [1, 30]);
    assert.equal(log.getResumo().recentes.length, 20);
    // violação com o relógio já adiante do piso: sai na hora, sem esperar o throttle
    agora += 2000;
    void log.registrar(pre("Read", { file_path: path.join(v.reunioes, "2026-10-17-reuniao-ficticia.md") }));
    await log.esperarGravacoes();
    assert.deepEqual(envios, [1, 30, 31], "violação não espera o throttle");
    const r = log.getResumo();
    assert.deepEqual([r.total, r.normais, r.violacoes, r.informativos], [31, 30, 1, 0]);
    assert.deepEqual(r.ultimaViolacao, { ts: agora, arquivo: "10-Reunioes/2026-10-17-reuniao-ficticia.md" });
    assert.deepEqual([envios.length], [3]);
    log.parar();
    await log.esperarGravacoes();

    // depois de um reinício o resumo volta do arquivo
    const novo = new LogTransparencia(() => contexto(v), { dir, now: () => agora });
    await novo.iniciar();
    assert.deepEqual([novo.getResumo().total, novo.getResumo().violacoes], [31, 1]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    v.limpar();
  }
});

test("violações em rajada: o piso entre envios segura a mensagem e uma só mensagem leva o estado final", async () => {
  const v = vaultComNotas();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transp-"));
  try {
    const log = new LogTransparencia(() => contexto(v), { dir, now: () => AGORA.getTime(), throttleMs: 5000, pisoViolacaoMs: 800 });
    const envios: number[] = [];
    log.subscribe((r) => envios.push(r.total));
    const reuniao = path.join(v.reunioes, "2026-10-17-reuniao-ficticia.md");
    void log.registrar(pre("Read", { file_path: reuniao }));
    await log.esperarGravacoes();
    assert.deepEqual(envios, [1], "a primeira violação sai na hora");
    for (let i = 0; i < 5; i++) void log.registrar(pre("Read", { file_path: reuniao }));
    await log.esperarGravacoes();
    assert.deepEqual(envios, [1], "dentro do piso: ninguém sai ainda");
    await new Promise((r) => setTimeout(r, 1000));
    assert.deepEqual(envios, [1, 6], "uma só mensagem com o estado final");
    log.parar();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    v.limpar();
  }
});

test("resumo: última violação (hora + arquivo) e até 5 violações ficam no resumo mesmo fora da janela das 20 mais recentes", async () => {
  const v = vaultComNotas();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transp-"));
  let agora = AGORA.getTime();
  try {
    const log = new LogTransparencia(() => contexto(v), { dir, now: () => agora, throttleMs: 1 });
    const comum = path.join(v.vault, "30-Projetos", "projeto-alfa.md");
    let ultimaTs = 0;
    let ultimoArq = "";
    for (let i = 0; i < 7; i++) {
      agora += 1000;
      const reuniao = i % 2 === 0;
      void log.registrar(pre("Read", { file_path: reuniao ? path.join(v.reunioes, "2026-10-17-reuniao-ficticia.md") : path.join(v.vault, "30-Projetos", "nota-reservada.md") }));
      ultimaTs = agora;
      ultimoArq = reuniao ? "10-Reunioes/2026-10-17-reuniao-ficticia.md" : "30-Projetos/nota-reservada.md";
    }
    for (let i = 0; i < 25; i++) {
      agora += 1000;
      void log.registrar(pre("Read", { file_path: comum }));
    }
    await log.esperarGravacoes();
    const r = log.getResumo();
    assert.ok(r.recentes.every((x) => x.nivel === "normal"), "as violações já saíram da janela das 20 mais recentes");
    assert.equal(r.violacoes, 7);
    assert.equal(r.violacoesRecentes.length, 5);
    assert.deepEqual(r.ultimaViolacao, { ts: ultimaTs, arquivo: ultimoArq });
    // o mesmo vem do disco depois de um reinício e do resumo da rota (resumirLinhas)
    const novo = new LogTransparencia(() => contexto(v), { dir, now: () => agora });
    await novo.iniciar();
    assert.deepEqual(novo.getResumo().ultimaViolacao, r.ultimaViolacao);
    assert.equal(novo.getResumo().violacoesRecentes.length, 5);
    const s = resumirLinhas("2026-10", await novo.lerMes("2026-10"), 3);
    assert.equal(s.violacoesRecentes.length, 5);
    assert.equal(s.ultimaViolacaoReg?.ts, ultimaTs);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    v.limpar();
  }
});

test("resumo: atas do MÊS entram no resumo e o mês que vira sem evento novo zera sozinho ao consultar", async () => {
  const v = vaultComNotas();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transp-"));
  let agora = AGORA.getTime();
  const atas: Record<string, { semIa: number; comIa: number }> = { "2026-10": { semIa: 3, comIa: 1 }, "2026-11": { semIa: 0, comIa: 0 } };
  try {
    const log = new LogTransparencia(() => contexto(v), { dir, now: () => agora, atasDoMes: (m) => atas[m] ?? { semIa: 0, comIa: 0 } });
    void log.registrar(pre("Read", { file_path: path.join(v.vault, "30-Projetos", "projeto-alfa.md") }));
    await log.esperarGravacoes();
    assert.deepEqual(log.getResumo().atas, { semIa: 3, comIa: 1 });
    assert.equal(log.getResumo().total, 1);
    atas["2026-10"] = { semIa: 4, comIa: 1 };
    assert.deepEqual(log.getResumo().atas, { semIa: 4, comIa: 1 }, "recalcula a cada consulta");
    agora = new Date(2026, 10, 2, 9, 0, 0).getTime(); // novembro, sem nenhum evento novo
    const novo = log.getResumo();
    assert.deepEqual([novo.mes, novo.total, novo.violacoes, novo.recentes.length], ["2026-11", 0, 0, 0]);
    assert.deepEqual(novo.atas, { semIa: 0, comIa: 0 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    v.limpar();
  }
});

test("lerMes não fica preso se a corrente de gravações travar; registrar não espera o disco", async () => {
  const v = vaultComNotas();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transp-"));
  try {
    const log = new LogTransparencia(() => contexto(v, { lerInicio: () => new Promise<string | null>(() => undefined) }), {
      dir,
      now: () => AGORA.getTime(),
      esperaMaxMs: 60,
    });
    const antes = performance.now();
    void log.registrar(pre("Read", { file_path: path.join(v.vault, "30-Projetos", "projeto-alfa.md") })); // trava ao ler o começo do arquivo
    assert.ok(performance.now() - antes < 50, "registrar volta na hora");
    const t0 = performance.now();
    assert.deepEqual(await log.lerMes("2026-10"), []);
    const gasto = performance.now() - t0;
    assert.ok(gasto >= 40 && gasto < 1500, `esperou só o limite (${gasto.toFixed(0)} ms)`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    v.limpar();
  }
});

test("desempenho: a parte síncrona do registro (no loop dos hooks) fica leve: mediana < 2 ms em 200 eventos seguidos", async () => {
  const v = vaultComNotas();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transp-"));
  try {
    const log = new LogTransparencia(() => contexto(v), { dir });
    const arq = path.join(v.vault, "30-Projetos", "projeto-alfa.md");
    const tempos: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      void log.registrar(pre(i % 3 === 0 ? "Grep" : "Read", { file_path: arq, path: v.vault, pattern: "x" }));
      tempos.push(performance.now() - t0);
    }
    await log.esperarGravacoes();
    tempos.sort((a, b) => a - b);
    assert.ok(tempos[100] < 2, `mediana ${tempos[100].toFixed(3)} ms`);
    assert.equal(log.getResumo().total, 200, "todos foram registrados, na ordem");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    v.limpar();
  }
});

test("resumirLinhas e montarMd: contagens, alerta e só caminhos relativos", async () => {
  const reg = (nivel: RegistroTransparencia["nivel"], acao: RegistroTransparencia["acao"], arquivo: string): RegistroTransparencia => ({
    ts: AGORA.getTime(), sessao: "s", agente: "dev", ferramenta: "Read", acao, arquivo, confidencial: nivel !== "normal", missao: null, via: "PreToolUse", nivel,
  });
  const s = resumirLinhas("2026-10", [reg("normal", "leu", "a.md"), reg("informativo", "leu", "00-Inbox/x|y.md"), reg("violacao", "buscou", "10-Reunioes")], 2);
  assert.deepEqual([s.total, s.normais, s.informativos, s.violacoes, s.linhas.length], [3, 1, 1, 1, 2]);
  assert.deepEqual(s.porAcao, { leu: 2, escreveu: 0, editou: 0, buscou: 1 });
  const md = montarMd(s, { semIa: 2, comIa: 1 });
  assert.ok(md.includes("ATENÇÃO"));
  assert.ok(md.includes("Atas processadas sem IA (2026-10): 2") && md.includes("com IA (/reuniao) (2026-10): 1"));
  assert.ok(md.includes("x y.md"), "a barra vertical não quebra a tabela");
  assert.ok(md.includes("antes de o Claude Code pedir ou negar a permissão"));
  // nome de arquivo com crase e ](: escapados para não virar código nem link
  const estranho = montarMd(resumirLinhas("2026-10", [reg("normal", "leu", "30-Projetos/a`b](http://x).md")], 5), { semIa: 0, comIa: 0 });
  assert.ok(estranho.includes("a\\`b]\\(http://x).md"), estranho);
  assert.ok(!estranho.includes("](http"));
  assert.ok(md.includes("leituras feitas por comandos de shell"));
  assert.ok(ehMes("2026-10") && !ehMes("2026-13") && !ehMes("../x") && !ehMes("2026-1") && !ehMes(undefined));
});

// ---------------------------------------------------------------- rotas

test("rotas: GET valida mês e Host; POST exportar exige JSON e Origin do painel e grava o .md", async () => {
  const v = vaultComNotas();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transp-"));
  await criarReuniao(v, "projeto-software");
  const resultados = new ObservadorResultados(() => v.vault, undefined, { semWatch: true, intervaloMs: 0, now: () => AGORA });
  await resultados.iniciar();
  const log = new LogTransparencia(() => contexto(v), { dir, now: () => AGORA.getTime() });
  const app = express();
  let porta = 0;
  registrarTransparencia(app, { log, atasDoMes: (m) => resultados.atasDoMes(m), porta: () => porta, now: () => AGORA.getTime() });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  porta = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${porta}`;
  try {
    log.registrar(pre("Read", { file_path: path.join(v.reunioes, "2026-10-17-reuniao-ficticia.md") }));
    log.registrar(pre("Read", { file_path: path.join(v.vault, "30-Projetos", "projeto-alfa.md") }));

    const get = await fetch(`${base}/api/transparencia?mes=2026-10`);
    assert.equal(get.status, 200);
    const corpo = (await get.json()) as {
      mes: string;
      linhas: RegistroTransparencia[];
      contagens: { total: number; violacoes: number };
      alerta: { violacao: boolean };
      atas: { semIa: number; comIa: number };
      nota: string;
    };
    assert.equal(corpo.mes, "2026-10");
    assert.equal(corpo.linhas.length, 2);
    assert.deepEqual([corpo.contagens.total, corpo.contagens.violacoes, corpo.alerta.violacao], [2, 1, true]);
    assert.deepEqual(corpo.atas, { semIa: 1, comIa: 0 });
    assert.ok(corpo.nota.includes("cat, type"));
    assert.ok(!JSON.stringify(corpo).includes(SEGREDO));
    // sem ?mes vale o mês de agora
    assert.equal(((await (await fetch(`${base}/api/transparencia`)).json()) as { mes: string }).mes, "2026-10");
    // mês inválido
    for (const ruim of ["2026-13", "..%2F..%2Fx", "2026-1", "abc", "2026-10&mes=2026-11"]) {
      assert.equal((await fetch(`${base}/api/transparencia?mes=${ruim}`)).status, 400, ruim);
    }
    // o fetch não deixa trocar o Host: usa o http cru
    const statusComHost = await new Promise<number>((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port: porta, path: "/api/transparencia?mes=2026-10", headers: { Host: "evil.com" } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        })
        .on("error", reject);
    });
    assert.equal(statusComHost, 403);

    const post = (headers: Record<string, string>, corpoPost = "{}") => fetch(`${base}/api/transparencia/exportar`, { method: "POST", headers, body: corpoPost });
    assert.equal((await post({ "Content-Type": "text/plain" })).status, 415);
    assert.equal((await post({ "Content-Type": "application/json", Origin: "http://evil.com" })).status, 403);
    assert.equal((await post({ "Content-Type": "application/json", Origin: base }, '{"mes":"../../x"}')).status, 400);
    assert.ok(!fs.existsSync(path.join(dir, "2026-10.md")), "pedido recusado não grava nada");

    const ok = await post({ "Content-Type": "application/json", Origin: base });
    assert.equal(ok.status, 200);
    const exp = (await ok.json()) as { ok: boolean; arquivo: string; texto: string };
    assert.equal(exp.arquivo, "2026-10.md");
    assert.ok(exp.texto.includes("ATENÇÃO") && exp.texto.includes("10-Reunioes/2026-10-17-reuniao-ficticia.md"));
    assert.ok(!exp.texto.includes(SEGREDO));
    assert.equal(fs.readFileSync(path.join(dir, "2026-10.md"), "utf8"), exp.texto);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    resultados.parar();
    fs.rmSync(dir, { recursive: true, force: true });
    v.limpar();
  }
});

test("atasDoMes: separa sem IA e com IA pelo mês da ata", async () => {
  const v = novoVaultDeTeste();
  try {
    await criarReuniao(v, "projeto-software");
    fs.writeFileSync(path.join(v.reunioes, "ata-com-ia.md"), "---\ntipo: reuniao\norigem: facilitator\ndata: 2026-09-30\nconfidencial: true\n---\n");
    const obs = new ObservadorResultados(() => v.vault, undefined, { semWatch: true, intervaloMs: 0, now: () => AGORA });
    await obs.iniciar();
    assert.deepEqual(obs.atasDoMes("2026-10"), { semIa: 1, comIa: 0 });
    assert.deepEqual(obs.atasDoMes("2026-09"), { semIa: 0, comIa: 1 });
    assert.deepEqual(obs.atasDoMes("2026-08"), { semIa: 0, comIa: 0 });
    obs.parar();
  } finally {
    v.limpar();
  }
});
