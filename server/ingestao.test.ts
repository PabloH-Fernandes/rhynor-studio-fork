// Ingestão sem IA: Inbox → 10-Reunioes + processadas/. Sempre em pastas temporárias (mkdtemp).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PESSOAS_FICTICIAS, gerarAta } from "./ataFicticia.ts";
import { IngestaoInbox, idCurto, type AtaIngerida } from "./ingestao.ts";
import { lerFrontmatter } from "./vault.ts";
import { marcarProcessada, nomeLivre, slugDe } from "./reunioesVault.ts";

const AGORA = new Date(2026, 9, 17, 14, 30);

function semente(n: number): () => number {
  let s = n;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function novoVault(): { vault: string; inbox: string; reunioes: string; limpar: () => void } {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ingestao-"));
  for (const d of ["00-Inbox", "10-Reunioes", "20-Missoes"]) fs.mkdirSync(path.join(vault, d));
  return {
    vault,
    inbox: path.join(vault, "00-Inbox"),
    reunioes: path.join(vault, "10-Reunioes"),
    limpar: () => fs.rmSync(vault, { recursive: true, force: true }),
  };
}

const opcoes = { estabilidadeMs: 0, semWatch: true, intervaloMs: 0, now: () => AGORA };

function ataFicticia(cenario: Parameters<typeof gerarAta>[0], n = 1) {
  return gerarAta(cenario, { agora: AGORA, rng: semente(n) });
}

const md = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith(".md"));

test("ata boa vira nota em 10-Reunioes e sai do Inbox para processadas/", async () => {
  const v = novoVault();
  try {
    const a = ataFicticia("projeto-software");
    fs.writeFileSync(path.join(v.inbox, a.nomeArquivo), a.texto);
    const ing = new IngestaoInbox(() => v.vault, opcoes);
    const r = await ing.varrer();
    assert.deepEqual(r, { ingeridas: 1, foraDoFormato: 0, erros: 0 });

    assert.deepEqual(md(v.inbox), [], "a ata saiu da raiz do Inbox");
    const arquivadas = md(path.join(v.inbox, "processadas"));
    assert.deepEqual(arquivadas, [a.nomeArquivo]);
    const bruta = fs.readFileSync(path.join(v.inbox, "processadas", a.nomeArquivo), "utf8");
    const fmBruta = lerFrontmatter(bruta);
    assert.equal(fmBruta?.status, "processada");
    assert.equal(fmBruta?.confidencial, "true");
    assert.match(bruta, /responsável: [A-ZÀ-Ý]/, "o arquivo bruto guarda os nomes originais");

    const notas = md(v.reunioes);
    assert.equal(notas.length, 1);
    assert.match(notas[0], /^2026-10-17-planejamento-da-sprint-do-projeto-[a-z-]+\.md$/);
    assert.equal(fmBruta?.reuniao, notas[0].replace(/\.md$/, ""));

    const nota = fs.readFileSync(path.join(v.reunioes, notas[0]), "utf8");
    const fmNota = lerFrontmatter(nota);
    assert.equal(fmNota?.tipo, "reuniao");
    assert.equal(fmNota?.confidencial, "true");
    assert.equal(fmNota?.origem, "leitura-automatica");
    assert.equal(fmNota?.processamento, "sem-ia");
    assert.equal(fmNota?.status, "rascunho");
    assert.equal(fmNota?.ficticia, "true");
    assert.equal(fmNota?.data, "2026-10-17");
    assert.equal(fmNota?.fonte, a.nomeArquivo);
    assert.match(fmNota?.fonte_hash ?? "", /^[0-9a-f]{64}$/);
    assert.match(fmNota?.reuniao_id ?? "", /^ficticia-/);
    assert.match(fmNota?.processada_em ?? "", /^2026-10-1\dT/);
    for (const secao of ["## Pauta e notas", "## Decisões", "## Tarefas", "## Dúvidas", "## Missões geradas"]) assert.ok(nota.includes(secao), secao);
    assert.match(nota, /nomes que não eram responsáveis podem ter ficado no texto: revise/);
    assert.match(nota, /- \[ \] .+ \| responsável: Responsável [A-C] \| prazo: 2026-10-\d\d \| classe: \?/);
    for (const pessoa of PESSOAS_FICTICIAS) {
      for (const parte of pessoa.split(" ")) assert.ok(!nota.toLowerCase().includes(parte.toLowerCase()), `"${parte}" na nota`);
    }
  } finally {
    v.limpar();
  }
});

test("ata fora do formato fica intacta no Inbox e entra na contagem", async () => {
  const v = novoVault();
  try {
    const ruim = ataFicticia("bagunçado");
    const caminho = path.join(v.inbox, ruim.nomeArquivo);
    fs.writeFileSync(caminho, ruim.texto);
    const antes = fs.statSync(caminho);
    const avisos: number[] = [];
    const ing = new IngestaoInbox(() => v.vault, { ...opcoes, aoMudarForaDoFormato: (n) => avisos.push(n) });

    const r = await ing.varrer();
    assert.deepEqual(r, { ingeridas: 0, foraDoFormato: 1, erros: 0 });
    assert.deepEqual(avisos, [1]);
    assert.equal(fs.readFileSync(caminho, "utf8"), ruim.texto);
    assert.equal(fs.statSync(caminho).mtimeMs, antes.mtimeMs, "nem o arquivo foi regravado");
    assert.deepEqual(md(v.reunioes), []);
    assert.equal(fs.existsSync(path.join(v.inbox, "processadas")), false);

    await ing.varrer();
    assert.deepEqual(avisos, [1], "só avisa quando o número muda");

    // quando o /reuniao arquiva a ata, a contagem volta a zero
    fs.rmSync(caminho);
    await ing.varrer();
    assert.deepEqual(avisos, [1, 0]);
  } finally {
    v.limpar();
  }
});

test("rodar de novo não duplica a nota (mesma ata de novo no Inbox)", async () => {
  const v = novoVault();
  try {
    const a = ataFicticia("alinhamento-bi");
    const ing = new IngestaoInbox(() => v.vault, opcoes);
    fs.writeFileSync(path.join(v.inbox, a.nomeArquivo), a.texto);
    await ing.varrer();
    await ing.varrer(); // nada novo
    assert.equal(md(v.reunioes).length, 1);

    // o fluxo entrega o mesmo arquivo outra vez (mesmo reuniao_id)
    fs.writeFileSync(path.join(v.inbox, a.nomeArquivo), a.texto);
    const r = await ing.varrer();
    assert.equal(r.ingeridas, 1);
    assert.equal(md(v.reunioes).length, 1, "continua uma nota só");
    assert.deepEqual(md(path.join(v.inbox, "processadas")).sort(), [a.nomeArquivo, a.nomeArquivo.replace(/\.md$/, "-2.md")].sort());
    assert.deepEqual(md(v.inbox), []);
  } finally {
    v.limpar();
  }
});

test("duas atas do mesmo título e dia: nota -2, nada sobrescrito", async () => {
  const v = novoVault();
  try {
    const a1 = ataFicticia("so-decisoes", 1);
    const a2 = ataFicticia("so-decisoes", 2); // outro reuniao_id, mesmo título
    fs.writeFileSync(path.join(v.inbox, a1.nomeArquivo), a1.texto);
    fs.writeFileSync(path.join(v.inbox, "ata-2026-10-17-1431-outra.md"), a2.texto);
    const r = await new IngestaoInbox(() => v.vault, opcoes).varrer();
    assert.equal(r.ingeridas, 2);
    assert.deepEqual(md(v.reunioes), ["2026-10-17-definicao-das-regras-do-comite-de-arquitetura-2.md", "2026-10-17-definicao-das-regras-do-comite-de-arquitetura.md"]);
  } finally {
    v.limpar();
  }
});

test("ignora .tmp, LEIA-ME.md, subpastas e outras extensões", async () => {
  const v = novoVault();
  try {
    const a = ataFicticia("tarefas-sem-prazo");
    fs.writeFileSync(path.join(v.inbox, `${a.nomeArquivo}.tmp`), a.texto);
    fs.writeFileSync(path.join(v.inbox, "LEIA-ME.md"), a.texto);
    fs.writeFileSync(path.join(v.inbox, "anotacoes.txt"), a.texto);
    fs.mkdirSync(path.join(v.inbox, "sub"));
    fs.writeFileSync(path.join(v.inbox, "sub", a.nomeArquivo), a.texto);
    const r = await new IngestaoInbox(() => v.vault, opcoes).varrer();
    assert.deepEqual(r, { ingeridas: 0, foraDoFormato: 0, erros: 0 });
    assert.deepEqual(md(v.reunioes), []);
    assert.deepEqual(fs.readdirSync(v.inbox).sort(), ["LEIA-ME.md", `${a.nomeArquivo}.tmp`, "anotacoes.txt", "sub"].sort());

    // quando o fluxo termina e renomeia para .md, aí sim é lida
    fs.renameSync(path.join(v.inbox, `${a.nomeArquivo}.tmp`), path.join(v.inbox, a.nomeArquivo));
    assert.equal((await new IngestaoInbox(() => v.vault, opcoes).varrer()).ingeridas, 1);
  } finally {
    v.limpar();
  }
});

test("espera o arquivo ficar quieto antes de ler", async () => {
  const v = novoVault();
  const ing = new IngestaoInbox(() => v.vault, { ...opcoes, estabilidadeMs: 150 });
  try {
    const a = ataFicticia("projeto-software");
    const caminho = path.join(v.inbox, a.nomeArquivo);
    fs.writeFileSync(caminho, a.texto.slice(0, 120)); // pela metade
    assert.equal((await ing.varrer()).ingeridas, 0);
    fs.writeFileSync(caminho, a.texto); // terminou de gravar (tamanho mudou)
    assert.equal((await ing.varrer()).ingeridas, 0, "mudou: recomeça a contar");
    await new Promise((r) => setTimeout(r, 250)); // (o próprio relógio de conferência também pode ter lido)
    await ing.varrer();
    assert.deepEqual(md(v.inbox), []);
    assert.equal(md(v.reunioes).length, 1);
  } finally {
    ing.parar();
    v.limpar();
  }
});

test("aoIngerir só para atas que chegaram depois da primeira varredura, e só com título e hora", async () => {
  const v = novoVault();
  try {
    const velha = ataFicticia("alinhamento-bi");
    fs.writeFileSync(path.join(v.inbox, velha.nomeArquivo), velha.texto);
    const eventos: AtaIngerida[] = [];
    const ing = new IngestaoInbox(() => v.vault, { ...opcoes, aoIngerir: (e) => eventos.push(e) });
    await ing.iniciar();
    ing.parar();
    assert.equal(eventos.length, 0, "ata que já estava lá ao ligar não avisa");
    assert.equal(md(v.reunioes).length, 1, "mas é lida");

    const nova = ataFicticia("tarefas-sem-prazo");
    fs.writeFileSync(path.join(v.inbox, nova.nomeArquivo), nova.texto);
    await ing.varrer();
    assert.equal(eventos.length, 1);
    assert.match(eventos[0].titulo, /^Retrospectiva do Projeto /);
    assert.equal(eventos[0].hora, "14:30");
    assert.ok(!JSON.stringify(eventos[0]).match(/Heitor|Isadora|Otávio|Luana|Tomás|Yasmin|Egídio|Valentina/));
  } finally {
    v.limpar();
  }
});

test("sem 10-Reunioes a ata fica quieta; sem vault não faz nada; ata já processada na raiz é deixada", async () => {
  const v = novoVault();
  try {
    const a = ataFicticia("projeto-software");
    fs.writeFileSync(path.join(v.inbox, a.nomeArquivo), a.texto);
    fs.rmSync(v.reunioes, { recursive: true });
    const ing = new IngestaoInbox(() => v.vault, opcoes);
    assert.equal((await ing.varrer()).ingeridas, 0);
    assert.equal(md(v.inbox).length, 1);

    assert.deepEqual(await new IngestaoInbox(() => null, opcoes).varrer(), { ingeridas: 0, foraDoFormato: 0, erros: 0 });

    fs.mkdirSync(v.reunioes);
    fs.writeFileSync(path.join(v.inbox, a.nomeArquivo), marcarProcessada(a.texto, "alguma-nota") ?? "");
    const r = await new IngestaoInbox(() => v.vault, opcoes).varrer();
    assert.deepEqual(r, { ingeridas: 0, foraDoFormato: 0, erros: 0 });
    assert.deepEqual(md(v.reunioes), []);
  } finally {
    v.limpar();
  }
});

test("ata com CRLF, BOM e data inválida: lida, data do dia da leitura e dúvida registrada", async () => {
  const v = novoVault();
  try {
    const a = ataFicticia("tarefas-sem-prazo");
    const texto = "﻿" + a.texto.replace("data: 2026-10-17", "data: 2026-02-31").replace(/\n/g, "\r\n");
    fs.writeFileSync(path.join(v.inbox, a.nomeArquivo), texto);
    await new IngestaoInbox(() => v.vault, opcoes).varrer();
    const [nota] = md(v.reunioes);
    assert.match(nota, /^2026-10-17-/);
    const conteudo = fs.readFileSync(path.join(v.reunioes, nota), "utf8");
    assert.match(conteudo, /A ata não trazia uma data válida/);
    assert.match(conteudo, /Tarefa 4: sem prazo/);
    assert.match(conteudo, /Tarefa 4: sem responsável/);
    const bruta = fs.readFileSync(path.join(v.inbox, "processadas", a.nomeArquivo), "utf8");
    assert.ok(bruta.includes("\r\n") && !bruta.includes("﻿"), "mantém CRLF e tira o BOM");
    assert.equal(lerFrontmatter(bruta)?.status, "processada");
  } finally {
    v.limpar();
  }
});

test("helpers: slug, nome livre e marcarProcessada", () => {
  assert.equal(slugDe("Reunião de Planejamento: Ação!"), "reuniao-de-planejamento-acao");
  assert.equal(slugDe("???"), "reuniao");
  assert.ok(slugDe("palavra ".repeat(20)).length <= 50);
  assert.equal(slugDe("a".repeat(80)), "a".repeat(50));
  assert.equal(nomeLivre("2026-10-17", "x", new Set()), "2026-10-17-x");
  assert.equal(nomeLivre("2026-10-17", "x", new Set(["2026-10-17-x", "2026-10-17-x-2"])), "2026-10-17-x-3");

  const antes = "---\ntipo: ata-bruta\nstatus: nova\nconfidencial : false\n---\n# T\n";
  assert.equal(marcarProcessada(antes, "n1"), "---\ntipo: ata-bruta\nstatus: processada\nconfidencial: true\nreuniao: n1\n---\n# T\n");
  assert.equal(marcarProcessada("sem frontmatter", "n1"), null);
  assert.equal(marcarProcessada("---\nsem fechar", "n1"), null);
});

test("ata que muda entre a leitura e o arquivamento não é sobrescrita: fica no Inbox e a próxima varredura lê de novo", async () => {
  const v = novoVault();
  try {
    const a = ataFicticia("projeto-software");
    const arq = path.join(v.inbox, a.nomeArquivo);
    fs.writeFileSync(arq, a.texto);
    const nova = a.texto + "\n## Resumo\nacrescentado depois da leitura\n";
    let mexeu = false;
    const ing = new IngestaoInbox(() => v.vault, {
      ...opcoes,
      now: () => {
        if (!mexeu) {
          mexeu = true;
          fs.writeFileSync(arq, nova); // o OneDrive entrega a versão nova no meio da passada
        }
        return AGORA;
      },
    });
    const r = await ing.varrer();
    assert.equal(r.ingeridas, 0);
    assert.equal(fs.readFileSync(arq, "utf8"), nova, "a ata bruta nova está intacta, sem status processada");
    assert.equal(fs.existsSync(path.join(v.inbox, "processadas")), false);

    const r2 = await ing.varrer();
    assert.equal(r2.ingeridas, 1);
    assert.deepEqual(md(v.inbox), []);
    const arquivada = fs.readFileSync(path.join(v.inbox, "processadas", a.nomeArquivo), "utf8");
    assert.ok(arquivada.includes("acrescentado depois da leitura"));
  } finally {
    v.limpar();
  }
});

test("mesma fonte com conteúdo e reuniao_id diferentes é outra reunião; mesma fonte e mesmo conteúdo é duplicata", async () => {
  const v = novoVault();
  try {
    const a = ataFicticia("projeto-software");
    const ing = new IngestaoInbox(() => v.vault, opcoes);
    fs.writeFileSync(path.join(v.inbox, a.nomeArquivo), a.texto);
    await ing.varrer();
    assert.equal(md(v.reunioes).length, 1);

    // mesmo nome de arquivo, outra reunião (outro reuniao_id e outro texto)
    const outra = a.texto.replace(/reuniao_id: .*/, "reuniao_id: ficticia-outra-reuniao").replace("## Decisões", "- um tópico a mais\n\n## Decisões");
    fs.writeFileSync(path.join(v.inbox, a.nomeArquivo), outra);
    await ing.varrer();
    assert.equal(md(v.reunioes).length, 2, "não engoliu a reunião diferente");

    // o mesmo conteúdo de novo, sem reuniao_id: a fonte + hash reconhece
    const semId = a.texto.replace(/reuniao_id: .*\n/, "");
    const ing2 = new IngestaoInbox(() => v.vault, opcoes);
    fs.writeFileSync(path.join(v.inbox, a.nomeArquivo), semId);
    await ing2.varrer();
    assert.equal(md(v.reunioes).length, 3);
    fs.writeFileSync(path.join(v.inbox, a.nomeArquivo), semId);
    await ing2.varrer();
    assert.equal(md(v.reunioes).length, 3, "mesma fonte e mesmo hash: duplicata");
  } finally {
    v.limpar();
  }
});

test("ata processada na raiz com nota existente vai para processadas/; sem nota fica; se o rename falha, avisa uma vez sem o nome", async () => {
  const v = novoVault();
  const avisos: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void avisos.push(args.join(" "));
  try {
    const a = ataFicticia("projeto-software");
    fs.writeFileSync(path.join(v.reunioes, "nota-x.md"), "---\ntipo: reuniao\n---\n");
    fs.writeFileSync(path.join(v.inbox, a.nomeArquivo), marcarProcessada(a.texto, "nota-x") ?? "");
    const b = ataFicticia("alinhamento-bi");
    fs.writeFileSync(path.join(v.inbox, b.nomeArquivo), marcarProcessada(b.texto, "nota-que-nao-existe") ?? "");
    const ing = new IngestaoInbox(() => v.vault, opcoes);
    await ing.varrer();
    assert.deepEqual(md(path.join(v.inbox, "processadas")), [a.nomeArquivo]);
    assert.deepEqual(md(v.inbox), [b.nomeArquivo], "sem nota conhecida, a ata não é mexida");

    // rename impossível: processadas é um arquivo
    fs.rmSync(path.join(v.inbox, "processadas"), { recursive: true });
    fs.writeFileSync(path.join(v.inbox, "processadas"), "não é pasta");
    fs.writeFileSync(path.join(v.inbox, a.nomeArquivo), marcarProcessada(a.texto, "nota-x") ?? "");
    await ing.varrer();
    await ing.varrer();
    const meus = avisos.filter((x) => x.includes("não consegui movê-la"));
    assert.equal(meus.length, 1, "um aviso só por arquivo");
    assert.ok(!meus[0].includes(a.nomeArquivo) && !/planejamento|sprint/i.test(meus[0]), "sem o nome do arquivo");
    assert.ok(fs.existsSync(path.join(v.inbox, a.nomeArquivo)), "a ata continua lá");
  } finally {
    console.warn = original;
    v.limpar();
  }
});

test("logs da ingestão usam id curto, não o nome do arquivo", async () => {
  const v = novoVault();
  const avisos: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void avisos.push(args.join(" "));
  try {
    const nome = "ata-2026-10-17-reuniao-secreta.md";
    fs.writeFileSync(path.join(v.inbox, nome), "x".repeat(600 * 1024));
    await new IngestaoInbox(() => v.vault, opcoes).varrer();
    assert.equal(avisos.length, 1);
    assert.ok(avisos[0].includes(idCurto(nome)));
    assert.ok(!/secreta|ata-2026/.test(avisos[0]));
  } finally {
    console.warn = original;
    v.limpar();
  }
});
