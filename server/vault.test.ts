import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Missao } from "../shared/types.ts";
import {
  ehAtaNova,
  ehComandoReuniao,
  escolherAtual,
  lerFrontmatter,
  missaoDoPrompt,
  missaoReaberta,
  parseMissao,
  resolverVault,
  textoSemSufixo,
} from "./vault.ts";
import {
  MAX_ABERTAS,
  MAX_CONCLUIDAS,
  ObservadorVault,
  PEDIDA_TTL_MS,
  contarTotais,
  ordenarMissoes,
} from "./vaultWatcher.ts";
import { dataEfetiva } from "../shared/datas.ts";

const MISSAO = [
  "---",
  "tipo: missao",
  "projeto: portal",
  "data: 2026-10-10",
  "status: em andamento",
  "origem: reuniao",
  "reuniao: 2026-10-10-alinhamento",
  "reuniao_titulo: Alinhamento do portal",
  "classe: time",
  "tags: [missao]",
  "confidencial: false",
  "---",
  "",
  "# Migrar o login",
  "",
  "## Objetivo",
  "Trocar o login antigo. Veja [[2026-10-10-alinhamento]] e [doc](https://x.y/z).",
  "",
  "## Tarefas",
  "- [x] Mapear telas",
  "- [ ] Trocar a API",
  "- [ ]",
  "",
  "## Resultado",
  "- [x] isto não é tarefa",
].join("\n");

function missao(extra: Partial<Missao> = {}): Missao {
  return {
    id: "m",
    nome: "M",
    status: "a fazer",
    origem: "reuniao",
    projeto: "",
    reuniaoTitulo: "",
    classe: "time",
    data: "2026-10-01",
    tarefas: { feitas: 0, total: 0 },
    itens: [],
    objetivo: "",
    atualizadoEm: 0,
    ...extra,
  };
}

test("parseMissao: nota normal", () => {
  const m = parseMissao("2026-10-10-login.md", MISSAO, 123);
  assert.ok(m);
  assert.equal(m.id, "2026-10-10-login");
  assert.equal(m.nome, "Migrar o login");
  assert.equal(m.status, "em andamento");
  assert.equal(m.origem, "reuniao");
  assert.equal(m.projeto, "portal");
  assert.equal(m.reuniaoTitulo, "Alinhamento do portal");
  assert.equal(m.classe, "time");
  assert.equal(m.data, "2026-10-10");
  assert.deepEqual(m.tarefas, { feitas: 1, total: 2 }, "item vazio e checkbox fora de ## Tarefas não contam");
  assert.deepEqual(m.itens, [
    { texto: "Mapear telas", feita: true },
    { texto: "Trocar a API", feita: false },
  ]);
  assert.equal(m.objetivo, "Trocar o login antigo. Veja 2026-10-10-alinhamento e doc.");
  assert.equal(m.atualizadoEm, 123);
  assert.equal(JSON.stringify(m).includes("reuniao:"), false);
  assert.equal(JSON.stringify(m).includes("2026-10-10-alinhamento\""), false, "o nome da nota de reunião não vai pro painel");
});

test("parseMissao: BOM e CRLF", () => {
  const m = parseMissao("a.md", "﻿" + MISSAO.replace(/\n/g, "\r\n"), 1);
  assert.ok(m);
  assert.equal(m.nome, "Migrar o login");
  assert.equal(m.status, "em andamento");
  assert.deepEqual(m.tarefas, { feitas: 1, total: 2 });
});

test("parseMissao: confidencial true, \"true\" e True ficam de fora (mesmo com comentário)", () => {
  for (const v of ["true", '"true"', "True", "true # só eu", "TRUE"]) {
    const texto = MISSAO.replace("confidencial: false", `confidencial: ${v}`);
    assert.equal(parseMissao("a.md", texto, 1), null, v);
  }
  assert.ok(parseMissao("a.md", MISSAO.replace("confidencial: false", "confidencial: false # ok"), 1));
});

test("parseMissao: qualquer confidencial true no frontmatter descarta (repetida, lista)", () => {
  const com = (linhas: string) => MISSAO.replace("confidencial: false", linhas);
  assert.equal(parseMissao("a.md", com("confidencial: true\nconfidencial: false"), 1), null, "true e depois false");
  assert.equal(parseMissao("a.md", com("confidencial: false\nconfidencial: true"), 1), null);
  assert.equal(parseMissao("a.md", com("confidencial: [true]"), 1), null);
  assert.equal(parseMissao("a.md", com("confidencial: sim"), 1), null);
  assert.equal(parseMissao("a.md", com("confidencial: false # antes era true"), 1)?.nome, "Migrar o login");
});

test("parseMissao: linha enorme de [ sem ] termina rápido", () => {
  const lixo = "[".repeat(256 * 1024);
  const texto = `---\ntipo: missao\nprojeto: ${lixo}\n---\n# ${lixo}\n## Objetivo\n${lixo}\n${lixo}\n## Tarefas\n- [ ] ${lixo}\n`;
  const ini = Date.now();
  const m = parseMissao("a.md", texto, 1);
  assert.ok(Date.now() - ini < 1500, `demorou ${Date.now() - ini} ms`);
  assert.ok(m);
  assert.ok(m.nome.length <= 120 && m.objetivo.length <= 300 && m.itens[0].texto.length <= 140);
});

test("parseMissao: tipo errado, sem frontmatter e frontmatter aberto viram null", () => {
  assert.equal(parseMissao("a.md", MISSAO.replace("tipo: missao", "tipo: reuniao"), 1), null);
  assert.equal(parseMissao("a.md", "# Só um texto\n- [ ] x", 1), null);
  assert.equal(parseMissao("a.md", "---\ntipo: missao\n# Sem fechar", 1), null);
  assert.ok(parseMissao("a.md", MISSAO.replace("tipo: missao", "tipo: missão"), 1));
});

test("parseMissao: nome do H1, {{title}} e nome do arquivo", () => {
  const fm = "---\ntipo: missao\n---\n";
  assert.equal(parseMissao("2026-10-01-x.md", fm + "# {{title}}\n\n# Nome de verdade\n", 1)?.nome, "Nome de verdade");
  assert.equal(parseMissao("2026-10-01-x.md", fm + "# {{title}}\n\ntexto", 1)?.nome, "2026-10-01-x");
  assert.equal(parseMissao("2026-10-01-x.md", fm + "texto sem título\n## Objetivo\nx", 1)?.nome, "2026-10-01-x");
  assert.equal(parseMissao("a.md", fm + "# [[outra-nota]]\n", 1)?.nome, "outra-nota");
  assert.equal(parseMissao("a.md", fm + "```\n# dentro do código\n```\n# Fora\n", 1)?.nome, "Fora");
});

test("parseMissao: status sem acento e desconhecido", () => {
  const com = (s: string) => parseMissao("a.md", MISSAO.replace("status: em andamento", `status: ${s}`), 1)?.status;
  assert.equal(com("concluida"), "concluída");
  assert.equal(com("Concluída"), "concluída");
  assert.equal(com("EM ANDAMENTO"), "em andamento");
  assert.equal(com("a fazer"), "a fazer");
  assert.equal(com("pausada"), "a fazer");
});

test("parseMissao: limites de itens, texto e objetivo; código não conta", () => {
  const itens = Array.from({ length: 25 }, (_, i) => `- [ ] item ${i} ${"x".repeat(200)}`).join("\n");
  const texto = `---\ntipo: missao\n---\n# N\n## Objetivo\n${"y".repeat(500)}\n## Tarefas\n${itens}\n\`\`\`\n- [x] dentro do código\n\`\`\`\n`;
  const m = parseMissao("a.md", texto, 1)!;
  assert.equal(m.itens.length, 20);
  assert.equal(m.tarefas.total, 25);
  assert.equal(m.tarefas.feitas, 0);
  assert.ok(m.itens.every((i) => i.texto.length <= 140));
  assert.ok(m.objetivo.length <= 300);
});

test("parseMissao: template cru (comentário HTML, {{title}}, - [ ] vazio)", () => {
  const modelo = fs.readFileSync(new URL("../vault-template/Templates/Missão.md", import.meta.url), "utf8");
  const m = parseMissao("modelo.md", modelo, 1);
  assert.ok(m);
  assert.equal(m.nome, "modelo");
  assert.deepEqual(m.tarefas, { feitas: 0, total: 0 });
});

test("lerFrontmatter: 'chave : valor', aspas, comentário, tags ignoradas", () => {
  const fm = lerFrontmatter('---\nstatus : "a fazer" # nota\ntags: [a, b]\nprojeto: [[portal]]\n---\n# x');
  assert.deepEqual(fm, { status: "a fazer", projeto: "[[portal]]" });
});

test("ehAtaNova: só o frontmatter conta", () => {
  assert.equal(ehAtaNova("---\nstatus: nova\n---\ncorpo"), true);
  assert.equal(ehAtaNova("﻿---\r\nstatus: nova\r\n---\r\n"), true);
  assert.equal(ehAtaNova("---\nstatus: processada\n---\n"), false);
  assert.equal(ehAtaNova("---\nstatus: nova\ncorpo sem fechar"), false);
  assert.equal(ehAtaNova("texto\nstatus: nova"), false);
});

test("missaoDoPrompt", () => {
  assert.equal(missaoDoPrompt("/time Missão [[2026-10-10-login]]: migrar. Projeto: portal"), "2026-10-10-login");
  assert.equal(missaoDoPrompt("  /time Missao [[abc]]"), "abc");
  assert.equal(missaoDoPrompt("<command-name>/time</command-name> Missão [[abc-1]]"), "abc-1");
  assert.equal(missaoDoPrompt("faça a Missão [[abc]]"), null, "sem /time não vale");
  assert.equal(missaoDoPrompt("/time Missão [[../../etc/passwd]]"), null);
  assert.equal(missaoDoPrompt("/time Missão [[2026-10-10 Migrar_o login v1.2]]"), "2026-10-10 Migrar_o login v1.2", "espaço, _, ponto");
  assert.equal(missaoDoPrompt("/time Missão [[2026-10-10-ação-é-ü.md]]"), "2026-10-10-ação-é-ü", "acento e .md");
  assert.equal(missaoDoPrompt("/time Missão [[a\\b]]"), null);
  assert.equal(missaoDoPrompt("/time Missão [[a|b]]"), null);
  assert.equal(missaoDoPrompt("/time Missão [[<script>]]"), null);
  assert.equal(missaoDoPrompt("/time Missão [[]]"), null);
  assert.equal(missaoDoPrompt("/time outra coisa"), null);
});

test("ehComandoReuniao", () => {
  assert.equal(ehComandoReuniao("/reuniao"), true);
  assert.equal(ehComandoReuniao("  /reuniao ata colada aqui"), true);
  assert.equal(ehComandoReuniao("/reuniao\nlinha 2"), true);
  assert.equal(ehComandoReuniao("<command-name>/reuniao</command-name><command-args>x</command-args>"), true);
  assert.equal(ehComandoReuniao("<command-name>reuniao</command-name>"), true);
  assert.equal(ehComandoReuniao("/reuniaozinha"), false);
  assert.equal(ehComandoReuniao("fale da /reuniao de ontem"), false);
  assert.equal(ehComandoReuniao(""), false);
});

test("escolherAtual: pedida vence, depois a em andamento mais nova; só origem reuniao", () => {
  const a = missao({ id: "a", status: "em andamento", atualizadoEm: 10 });
  const b = missao({ id: "b", status: "em andamento", atualizadoEm: 20 });
  const c = missao({ id: "c", status: "a fazer" });
  const d = missao({ id: "d", status: "concluída" });
  const man = missao({ id: "man", status: "em andamento", origem: "manual", atualizadoEm: 99 });
  assert.equal(escolherAtual([a, b, c], [])?.id, "b");
  assert.equal(escolherAtual([a, b, c], ["c"])?.id, "c");
  assert.equal(escolherAtual([a, b, c], ["zzz", "a"])?.id, "a", "id desconhecido é pulado");
  assert.equal(escolherAtual([a, b, d], ["d"])?.id, "b", "pedida concluída cai pra regra (b)");
  assert.equal(escolherAtual([c, d], []), null);
  assert.equal(escolherAtual([man], []), null);
  assert.equal(escolherAtual([man, c], ["man"]), null, "manual nunca é a atual");
});

test("ordenarMissoes: andamento, a fazer, concluída; data recente primeiro; máx. 50 abertas", () => {
  const lista = [
    missao({ id: "1", status: "concluída", data: "2026-10-09" }),
    missao({ id: "2", status: "a fazer", data: "2026-10-01" }),
    missao({ id: "3", status: "em andamento", data: "2026-09-01" }),
    missao({ id: "4", status: "a fazer", data: "2026-10-05" }),
  ];
  assert.deepEqual(ordenarMissoes(lista).map((m) => m.id), ["3", "4", "2", "1"]);
  const muitas = Array.from({ length: 70 }, (_, i) => missao({ id: String(i) }));
  assert.equal(ordenarMissoes(muitas).length, MAX_ABERTAS);
});

test("ordenarMissoes: limite separado para abertas e concluídas; as mais recentes ficam", () => {
  const dia = (i: number) => `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, "0")}`;
  const abertas = Array.from({ length: 60 }, (_, i) =>
    missao({ id: `a${i}`, status: i % 2 ? "a fazer" : "em andamento", data: dia(i) }),
  );
  const concluidas = Array.from({ length: 60 }, (_, i) => missao({ id: `c${i}`, status: "concluída", data: dia(i) }));
  const r = ordenarMissoes([...concluidas, ...abertas]);
  assert.equal(r.length, MAX_ABERTAS + MAX_CONCLUIDAS);
  const rAbertas = r.slice(0, MAX_ABERTAS);
  const rConcluidas = r.slice(MAX_ABERTAS);
  assert.ok(rAbertas.every((m) => m.status !== "concluída"));
  assert.ok(rConcluidas.every((m) => m.status === "concluída"));
  // as 10 concluídas mais antigas (c0..c9) saem; as recentes ficam, da mais nova para a mais velha
  assert.deepEqual(
    rConcluidas.map((m) => m.id),
    Array.from({ length: 50 }, (_, i) => `c${59 - i}`),
  );
  // abertas na mesma ordem de antes: as 30 em andamento (pares) e depois as 20 a fazer mais novas (ímpares)
  const andamento = Array.from({ length: 30 }, (_, i) => `a${58 - 2 * i}`);
  const aFazer = Array.from({ length: 20 }, (_, i) => `a${59 - 2 * i}`);
  assert.deepEqual(
    rAbertas.map((m) => m.id),
    [...andamento, ...aFazer],
  );
  // os totais contam antes do corte
  assert.deepEqual(contarTotais([...concluidas, ...abertas]), { abertas: 60, concluidas: 60 });
  assert.deepEqual(contarTotais([]), { abertas: 0, concluidas: 0 });
});

test("ordenarMissoes: sem data usa o dia local de atualizadoEm; desempate por atualizadoEm", () => {
  const hoje = new Date(2026, 9, 14, 12, 0).getTime();
  const semData = missao({ id: "sem", status: "concluída", data: "", atualizadoEm: hoje });
  const antiga = missao({ id: "antiga", status: "concluída", data: "2025-01-01", atualizadoEm: hoje + 1000 });
  assert.equal(dataEfetiva(semData), "2026-10-14");
  assert.equal(dataEfetiva(missao({ data: "", atualizadoEm: 0 })), "");
  assert.deepEqual(ordenarMissoes([antiga, semData]).map((m) => m.id), ["sem", "antiga"]);
  // mesma data efetiva: a atualizada por último primeiro
  const mesmoDia = missao({ id: "mesmo", status: "concluída", data: "2026-10-14", atualizadoEm: hoje + 5000 });
  assert.deepEqual(ordenarMissoes([semData, mesmoDia]).map((m) => m.id), ["mesmo", "sem"]);
  // e a sem data não é a primeira cortada
  const velhas = Array.from({ length: MAX_CONCLUIDAS }, (_, i) =>
    missao({ id: `v${i}`, status: "concluída", data: "2025-02-01", atualizadoEm: i + 1 }),
  );
  assert.ok(ordenarMissoes([...velhas, semData]).some((m) => m.id === "sem"));
});

test("ordenarMissoes: data inválida conta como o dia de atualizadoEm (igual ao painel)", () => {
  const dez2025 = new Date(2025, 11, 1, 10, 0).getTime();
  const invalida = missao({ id: "inv", status: "concluída", data: "2026-13-45", atualizadoEm: dez2025 });
  const recente = missao({ id: "recente", status: "concluída", data: "2026-06-01", atualizadoEm: 1 });
  const antiga = missao({ id: "antiga", status: "concluída", data: "2025-01-10", atualizadoEm: 1 });
  assert.deepEqual(ordenarMissoes([invalida, antiga, recente]).map((m) => m.id), ["recente", "inv", "antiga"]);
  for (const data of ["2026-02-31", "2026-00-10"]) {
    assert.equal(dataEfetiva({ data, atualizadoEm: dez2025 }), "2025-12-01", data);
  }
  assert.equal(dataEfetiva({ data: "2024-02-29", atualizadoEm: dez2025 }), "2024-02-29");
});

test("resolverVault: env, settings.json, ~, relativo e erro", () => {
  const home = path.resolve(os.tmpdir(), "casa-fake");
  const abs = path.resolve(os.tmpdir(), "meu-vault");
  const semArquivo = () => {
    throw new Error("ENOENT");
  };
  assert.equal(resolverVault({ AGPOCKET_VAULT: abs }, home, semArquivo), abs);
  assert.equal(resolverVault({ AGPOCKET_VAULT: "~/cerebro" }, home, semArquivo), path.resolve(home, "cerebro"));
  assert.equal(resolverVault({ AGPOCKET_VAULT: "relativo/x" }, home, semArquivo), null);
  assert.equal(resolverVault({}, home, semArquivo), null);
  const settings = (j: string) => (p: string) => {
    assert.equal(p, path.join(home, ".claude", "settings.json"));
    return j;
  };
  assert.equal(resolverVault({ AGPOCKET_VAULT: " " }, home, settings(JSON.stringify({ env: { AGPOCKET_VAULT: abs } }))), abs);
  assert.equal(resolverVault({}, home, settings("﻿" + JSON.stringify({ env: { AGPOCKET_VAULT: "~/v" } }))), path.resolve(home, "v"));
  assert.equal(resolverVault({}, home, settings("{ quebrado")), null);
  assert.equal(resolverVault({}, home, settings(JSON.stringify({ env: null }))), null);
});

// ---------------------------------------------------------------- pasta de verdade

function montarVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agpocket-vault-"));
  fs.mkdirSync(path.join(dir, "20-Missoes"));
  fs.mkdirSync(path.join(dir, "00-Inbox", "processadas"), { recursive: true });
  fs.mkdirSync(path.join(dir, "10-Reunioes"));
  return dir;
}

test("observador: missões, atas novas, processadas/, LEIA-ME e 10-Reunioes nunca lida", async () => {
  const dir = montarVault();
  try {
    fs.writeFileSync(path.join(dir, "20-Missoes", "2026-10-10-a.md"), "﻿" + MISSAO.replace(/\n/g, "\r\n"));
    fs.writeFileSync(path.join(dir, "20-Missoes", "2026-10-11-secreta.md"), MISSAO.replace("confidencial: false", "confidencial: true"));
    fs.writeFileSync(path.join(dir, "20-Missoes", "notas.txt"), "ignorar");
    fs.writeFileSync(path.join(dir, "00-Inbox", "ata1.md"), "---\nstatus: nova\n---\nTEXTO-CONFIDENCIAL");
    fs.writeFileSync(path.join(dir, "00-Inbox", "ata2.md"), "---\nstatus: processada\n---\n");
    fs.writeFileSync(path.join(dir, "00-Inbox", "LEIA-ME.md"), "---\nstatus: nova\n---\n");
    fs.writeFileSync(path.join(dir, "00-Inbox", "processadas", "velha.md"), "---\nstatus: nova\n---\n");
    // nota-isca: se alguém abrir 10-Reunioes, o conteúdo apareceria no painel
    fs.writeFileSync(path.join(dir, "10-Reunioes", "isca.md"), MISSAO.replace("Migrar o login", "ISCA-DE-REUNIAO"));

    const abertos: string[] = [];
    const orig = fs.promises.readFile;
    const origOpen = fs.promises.open;
    fs.promises.readFile = ((p: fs.PathLike, ...rest: unknown[]) => {
      abertos.push(String(p));
      return (orig as (...a: unknown[]) => Promise<unknown>)(p, ...rest);
    }) as typeof fs.promises.readFile;
    fs.promises.open = ((p: fs.PathLike, ...rest: unknown[]) => {
      abertos.push(String(p));
      return (origOpen as (...a: unknown[]) => Promise<unknown>)(p, ...rest);
    }) as typeof fs.promises.open;

    const avisos: number[] = [];
    const obs = new ObservadorVault(() => dir, { intervaloMs: 0, semWatch: true });
    obs.subscribe((i) => avisos.push(i.missoes.length));
    try {
      await obs.iniciar();
    } finally {
      fs.promises.readFile = orig;
      fs.promises.open = origOpen;
    }
    const info = obs.getInfo();
    assert.equal(info.vault, "ok");
    assert.equal(info.missoes.length, 1);
    assert.equal(info.missoes[0].id, "2026-10-10-a");
    assert.deepEqual(info.totais, { abertas: 1, concluidas: 0 });
    assert.equal(info.inbox.novas, 1, "só ata1 (sem processada, LEIA-ME e subpasta)");
    assert.equal(info.atual?.id, "2026-10-10-a");
    assert.equal(info.atual?.reuniaoTitulo, "Alinhamento do portal");
    assert.equal(abertos.some((p) => p.includes("10-Reunioes")), false, "10-Reunioes nunca é aberta");
    assert.equal(abertos.some((p) => p.includes("processadas") || p.includes("LEIA-ME")), false);
    const json = JSON.stringify(info);
    assert.equal(json.includes("TEXTO-CONFIDENCIAL"), false);
    assert.equal(json.includes("ISCA"), false);
    assert.equal(json.includes("ata1"), false, "nome de arquivo do Inbox não vai pro painel");
    assert.equal(avisos.length, 1);

    // sem mudança, sem aviso
    await obs.recarregar();
    assert.equal(avisos.length, 1);

    // mudança: ata virou processada
    fs.writeFileSync(path.join(dir, "00-Inbox", "ata1.md"), "---\nstatus: processada\n---\n");
    await obs.recarregar();
    assert.equal(obs.getInfo().inbox.novas, 0);
    assert.equal(avisos.length, 2);

    // pedida por /time
    fs.writeFileSync(path.join(dir, "20-Missoes", "2026-10-12-b.md"), MISSAO.replace("em andamento", "a fazer"));
    await obs.recarregar();
    assert.deepEqual(obs.getInfo().totais, { abertas: 2, concluidas: 0 });
    obs.notarPrompt("s1", "/time Missão [[2026-10-12-b]]: x");
    assert.equal(obs.getInfo().atual?.id, "2026-10-12-b");
    obs.esquecerSessao("s1");
    assert.equal(obs.getInfo().atual?.id, "2026-10-10-a");
    obs.parar();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("observador: arquivo igual (mtime e tamanho) não é aberto de novo", async () => {
  const dir = montarVault();
  const orig = fs.promises.readFile;
  const origOpen = fs.promises.open;
  let aberturas = 0;
  try {
    fs.writeFileSync(path.join(dir, "20-Missoes", "a.md"), MISSAO);
    fs.writeFileSync(path.join(dir, "00-Inbox", "ata.md"), "---\nstatus: nova\n---\n");
    fs.promises.readFile = ((...a: unknown[]) => {
      aberturas++;
      return (orig as (...x: unknown[]) => Promise<unknown>)(...a);
    }) as typeof fs.promises.readFile;
    fs.promises.open = ((...a: unknown[]) => {
      aberturas++;
      return (origOpen as (...x: unknown[]) => Promise<unknown>)(...a);
    }) as typeof fs.promises.open;
    const obs = new ObservadorVault(() => dir, { intervaloMs: 0, semWatch: true });
    await obs.iniciar();
    assert.equal(aberturas, 2, "1ª leitura abre os dois");
    await obs.recarregar();
    await obs.recarregar();
    assert.equal(aberturas, 2, "nada mudou: só stat");
    assert.equal(obs.getInfo().missoes.length, 1);
    assert.equal(obs.getInfo().inbox.novas, 1);
    // muda o tamanho: lê de novo
    fs.writeFileSync(path.join(dir, "20-Missoes", "a.md"), MISSAO + "\n- [ ] mais uma\n".replace("- [ ]", "## Extra\n- [ ]"));
    await obs.recarregar();
    assert.equal(aberturas, 3);
    obs.parar();
  } finally {
    fs.promises.readFile = orig;
    fs.promises.open = origOpen;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("observador: missão pedida expira em 15 min e some no esquecerTodas", async () => {
  const dir = montarVault();
  try {
    fs.writeFileSync(path.join(dir, "20-Missoes", "a.md"), MISSAO.replace("em andamento", "a fazer"));
    let agora = 1_000_000;
    const obs = new ObservadorVault(() => dir, { intervaloMs: 0, semWatch: true, now: () => agora });
    await obs.iniciar();
    assert.equal(obs.getInfo().atual, null);
    obs.notarPrompt("s1", "/time Missão [[a]]: x");
    assert.equal(obs.getInfo().atual?.id, "a");
    agora += PEDIDA_TTL_MS - 1000;
    await obs.recarregar();
    assert.equal(obs.getInfo().atual?.id, "a", "ainda vale");
    agora += 2000;
    await obs.recarregar();
    assert.equal(obs.getInfo().atual, null, "expirou");
    obs.notarPrompt("s1", "/time Missão [[a]]: x");
    assert.equal(obs.getInfo().atual?.id, "a");
    obs.esquecerTodas();
    assert.equal(obs.getInfo().atual, null);
    obs.parar();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("observador: sem vault e sem pasta", async () => {
  const sem = new ObservadorVault(() => null, { intervaloMs: 0, semWatch: true });
  await sem.iniciar();
  assert.equal(sem.getInfo().vault, "sem-vault");
  assert.deepEqual(sem.getInfo().totais, { abertas: 0, concluidas: 0 });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agpocket-vazio-"));
  try {
    const obs = new ObservadorVault(() => dir, { intervaloMs: 0, semWatch: true });
    await obs.iniciar();
    assert.equal(obs.getInfo().vault, "sem-pasta");
    assert.deepEqual(obs.getInfo().missoes, []);
    assert.deepEqual(obs.getInfo().totais, { abertas: 0, concluidas: 0 });
    obs.parar();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseMissao: o sufixo | prazo e | concluída não aparece no texto da tarefa, mas a tarefa conta", () => {
  const texto = [
    "---",
    "tipo: missao",
    "status: a fazer",
    "confidencial: false",
    "---",
    "# Tarefas da reunião",
    "## Tarefas",
    "- [ ] Montar a página | prazo: 2026-10-31",
    "- [x] Revisar o texto | concluída: 2026-10-20",
    "- [ ] Ligar o cadastro | responsável: Responsável A | prazo: | classe: time",
    "- [ ] Ajustar a regra A | B sem chave",
    "- [ ] Só com prazo | PRAZO : 2026-11-01",
  ].join("\n");
  const m = parseMissao("2026-10-17-x.md", texto, 0);
  assert.deepEqual(m?.itens, [
    { texto: "Montar a página", feita: false },
    { texto: "Revisar o texto", feita: true },
    { texto: "Ligar o cadastro", feita: false },
    { texto: "Ajustar a regra A | B sem chave", feita: false },
    { texto: "Só com prazo", feita: false },
  ]);
  assert.deepEqual(m?.tarefas, { feitas: 1, total: 5 });
  assert.equal(textoSemSufixo("Sem sufixo"), "Sem sufixo");
});

test("missaoReaberta / parseMissao: concluída com '- [ ]' que ainda leva a marca vira 'em andamento'", () => {
  const base = MISSAO.replace("status: em andamento", "status: concluída");
  // concluída à mão com '- [ ]' sem marca: continua concluída
  assert.equal(parseMissao("m.md", base, 0)?.status, "concluída");
  // com a marca do painel: reaberta
  const reaberta = base.replace("- [ ] Trocar a API", "- [ ] Trocar a API | concluída: 2026-10-12");
  assert.equal(parseMissao("m.md", reaberta, 0)?.status, "em andamento");
  assert.equal(parseMissao("m.md", reaberta.replace(/\n/g, "\r\n"), 0)?.status, "em andamento", "CRLF");
  assert.equal(parseMissao("m.md", "﻿" + reaberta, 0)?.status, "em andamento", "BOM");
  // cancelada e pausada nunca mudam; em andamento fica
  assert.equal(missaoReaberta({ status: "cancelada" }, "## Tarefas\n- [ ] x | concluída: 2026-10-12"), false);
  assert.equal(missaoReaberta({ status: "pausada" }, "## Tarefas\n- [ ] x | concluída: 2026-10-12"), false);
  assert.equal(missaoReaberta({ status: "concluída" }, "## Tarefas\n- [x] x | concluída: 2026-10-12"), false);
  assert.equal(missaoReaberta({ status: "concluida" }, "## Tarefas\n  * [ ] x | concluida : 2026-10-12"), true);
  assert.equal(missaoReaberta({ status: "concluida" }, "## Tarefas\n- [ ] x | concluída: 2026-02-31"), false, "data que não existe");
});
