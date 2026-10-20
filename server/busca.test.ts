// Busca no cérebro. Só pastas temporárias (mkdtemp) com notas fictícias.
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";
import type { BuscaItem } from "../shared/types.ts";
import { MAX_BYTES_BUSCA, ObservadorBusca, confidencialPeloTexto, montarEntrada, registrarBusca, uriObsidian, validarConsulta } from "./busca.ts";

interface Ambiente {
  vault: string;
  base: string;
  busca: ObservadorBusca;
  buscar: (q: string) => Promise<{ status: number; corpo: string; json: { itens?: BuscaItem[]; total?: number; ok?: boolean; erros?: string[] } }>;
  escrever: (rel: string, texto: string) => void;
  fechar: () => Promise<void>;
}

async function ambiente(nomePasta = "cerebro-teste"): Promise<Ambiente> {
  const pai = fs.mkdtempSync(path.join(os.tmpdir(), "busca-"));
  const vault = path.join(pai, nomePasta);
  fs.mkdirSync(vault);
  const escrever = (rel: string, texto: string) => {
    const arq = path.join(vault, ...rel.split("/"));
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.writeFileSync(arq, texto);
  };
  const busca = new ObservadorBusca(() => vault, { semWatch: true, intervaloMs: 0 });
  const app = express();
  let porta = 0;
  registrarBusca(app, { resolverVault: () => vault, busca, porta: () => porta });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  porta = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${porta}`;
  return {
    vault,
    base,
    busca,
    escrever,
    buscar: async (q) => {
      await busca.recarregar();
      const r = await fetch(`${base}/api/busca?q=${encodeURIComponent(q)}`);
      const corpo = await r.text();
      return { status: r.status, corpo, json: JSON.parse(corpo) };
    },
    fechar: async () => {
      busca.parar();
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(pai, { recursive: true, force: true });
    },
  };
}

test("nota normal: acha por título, cabeçalho e corpo, com trecho e link", async () => {
  const a = await ambiente();
  try {
    a.escrever("Projetos/Plano de lançamento.md", "---\ntipo: nota\n---\n\n# Plano\n\nO foguete sai na quinta-feira, com [[Equipe A|a equipe]] e https://exemplo.test/x.\n");
    const r = await a.buscar("foguete");
    assert.equal(r.status, 200);
    assert.equal(r.json.itens?.length, 1);
    const item = r.json.itens![0];
    assert.equal(item.titulo, "Plano de lançamento");
    assert.equal(item.rel, "Projetos/Plano de lançamento.md");
    assert.equal(item.confidencial, false);
    assert.ok(item.trecho?.includes("foguete"));
    assert.ok(!item.trecho?.includes("[["), "links saem do trecho");
    assert.ok(!item.trecho?.includes("https://"));
    assert.ok(item.trecho?.includes("a equipe"));
    assert.equal(item.uri, "obsidian://open?vault=cerebro-teste&file=Projetos%2FPlano%20de%20lan%C3%A7amento");
    assert.equal(r.json.total, 1);
  } finally {
    await a.fechar();
  }
});

test("ranking: título, depois cabeçalho, depois corpo; várias palavras = E", async () => {
  const a = await ambiente();
  try {
    a.escrever("so corpo.md", "# Outra coisa\n\nfalamos de orçamento aqui\n");
    a.escrever("cabecalho.md", "# Orçamento anual\n\ntexto\n");
    a.escrever("Orçamento.md", "nada\n");
    const r = await a.buscar("orcamento");
    assert.deepEqual(
      r.json.itens!.map((i) => i.rel),
      ["Orçamento.md", "cabecalho.md", "so corpo.md"],
    );
    const e = await a.buscar("orçamento aqui");
    assert.deepEqual(e.json.itens!.map((i) => i.rel), ["so corpo.md"]);
    const nenhum = await a.buscar("orçamento zzzz");
    assert.equal(nenhum.json.itens!.length, 0);
  } finally {
    await a.fechar();
  }
});

test("sem diferença de maiúscula e acento", async () => {
  const a = await ambiente();
  try {
    a.escrever("Reflexão.md", "# Título\n\nA CONCLUSÃO é simples.\n");
    for (const q of ["conclusao", "CONCLUSÃO", "reflexao", "ConClusÃo simples"]) {
      const r = await a.buscar(q);
      assert.equal(r.json.itens!.length, 1, q);
    }
  } finally {
    await a.fechar();
  }
});

test("nota confidencial: título sim, corpo nunca, e palavra só do corpo não acha a nota", async () => {
  const a = await ambiente();
  try {
    a.escrever("Segredos/Plano secreto.md", "---\nconfidencial: true\n---\n\n# Cabeçalho secreto\n\nSenha: abacaxi-roxo\n");
    const porTitulo = await a.buscar("plano secreto");
    assert.equal(porTitulo.json.itens!.length, 1);
    const item = porTitulo.json.itens![0];
    assert.equal(item.confidencial, true);
    assert.equal(item.trecho, undefined);
    assert.ok(!porTitulo.corpo.includes("abacaxi"));
    for (const q of ["abacaxi", "abacaxi-roxo", "cabeçalho secreto"]) {
      const r = await a.buscar(q);
      assert.equal(r.json.itens!.length, 0, `não pode casar o corpo: ${q}`);
      assert.ok(!r.corpo.includes("abacaxi"));
    }
    // o corpo nem fica na memória
    const e = a.busca.getEntradas().find((x) => x.rel === "Segredos/Plano secreto.md")!;
    assert.equal(e.corpo, "");
    assert.equal(e.corpoN, "");
  } finally {
    await a.fechar();
  }
});

test("frontmatter quebrado ou duvidoso vira confidencial", async () => {
  const a = await ambiente();
  try {
    a.escrever("aberto.md", "---\ntipo: nota\nsem fechar\n\nPalavra-oculta-1 no corpo\n");
    a.escrever("duvida.md", "---\nconfidencial: talvez\n---\nPalavra-oculta-2\n");
    a.escrever("vazio.md", "---\nconfidencial:\n---\nPalavra-oculta-3\n");
    a.escrever("depois.md", "\n---\nconfidencial: true\n---\nPalavra-oculta-4\n");
    a.escrever("livre.md", "---\nconfidencial: false\n---\nPalavra-oculta-5\n");
    const r = await a.buscar("palavra-oculta");
    assert.deepEqual(r.json.itens!.map((i) => i.rel), ["livre.md"]);
    assert.ok(r.json.itens![0].trecho);
    for (const rel of ["aberto.md", "duvida.md", "vazio.md", "depois.md"]) {
      const i = (await a.buscar(rel.replace(".md", ""))).json.itens!;
      assert.equal(i.length, 1, rel);
      assert.equal(i[0].confidencial, true, rel);
      assert.equal(i[0].trecho, undefined, rel);
    }
  } finally {
    await a.fechar();
  }
});

test("00-Inbox e 10-Reunioes são confidenciais por regra, mesmo sem a flag (e nem são abertas)", async () => {
  const a = await ambiente();
  try {
    a.escrever("00-Inbox/Ata de terça.md", "---\nconfidencial: false\n---\nconteudo-da-ata-inbox\n");
    a.escrever("10-Reunioes/Reunião de planejamento.md", "# Reunião\n\nconteudo-da-reuniao\n");
    a.escrever("10-reunioes/Outra.md", "conteudo-da-reuniao-minuscula\n");
    a.escrever("20-Missoes/Missão normal.md", "conteudo-da-missao\n");
    for (const q of ["conteudo-da-ata", "conteudo-da-reuniao", "conteudo-da-reuniao-minuscula"]) {
      const r = await a.buscar(q);
      assert.equal(r.json.itens!.length, 0, q);
    }
    const t1 = (await a.buscar("ata de terça")).json.itens!;
    assert.equal(t1.length, 1);
    assert.equal(t1[0].confidencial, true);
    assert.equal(t1[0].trecho, undefined);
    const t2 = (await a.buscar("reunião de planejamento")).json.itens!;
    assert.equal(t2[0]?.confidencial, true);
    const t3 = (await a.buscar("outra")).json.itens!;
    assert.equal(t3[0]?.confidencial, true);
    const m = (await a.buscar("conteudo-da-missao")).json.itens!;
    assert.equal(m.length, 1);
    assert.equal(m[0].confidencial, false);
  } finally {
    await a.fechar();
  }
});

test("ignora .obsidian, .trash, .git, Templates, não-.md, symlink, arquivo gigante e pasta funda", async () => {
  const a = await ambiente();
  try {
    a.escrever(".obsidian/config.md", "palavra-ignorada\n");
    a.escrever(".trash/velha.md", "palavra-ignorada\n");
    a.escrever(".git/nota.md", "palavra-ignorada\n");
    a.escrever("Templates/Modelo.md", "palavra-ignorada\n");
    a.escrever("texto.txt", "palavra-ignorada\n");
    a.escrever("gigante.md", `palavra-ignorada ${"x".repeat(MAX_BYTES_BUSCA + 10)}\n`);
    a.escrever("a/b/c/d/e/f/g/funda.md", "palavra-ignorada\n");
    a.escrever("a/b/c/d/e/f/ok.md", "palavra-ignorada-ok\n"); // profundidade 6: entra
    a.escrever("real.md", "palavra-ignorada-real\n");
    const r = await a.buscar("palavra-ignorada");
    assert.deepEqual(r.json.itens!.map((i) => i.rel).sort(), ["a/b/c/d/e/f/ok.md", "real.md"]);
  } finally {
    await a.fechar();
  }
});

test("link simbólico é ignorado", async (t) => {
  const a = await ambiente();
  try {
    const alvo = path.join(path.dirname(a.vault), "fora.md");
    fs.writeFileSync(alvo, "palavra-de-fora\n");
    const pastaFora = path.join(path.dirname(a.vault), "pasta-fora");
    fs.mkdirSync(pastaFora);
    fs.writeFileSync(path.join(pastaFora, "dentro.md"), "palavra-de-fora\n");
    try {
      fs.symlinkSync(alvo, path.join(a.vault, "link.md"), "file");
      fs.symlinkSync(pastaFora, path.join(a.vault, "linkpasta"), "junction");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EPERM") {
        t.skip("sem permissão para criar link simbólico neste Windows");
        return;
      }
      throw err;
    }
    const r = await a.buscar("palavra-de-fora");
    assert.equal(r.json.itens!.length, 0);
  } finally {
    await a.fechar();
  }
});

test("consulta: curta, longa e inválida dão 400 em JSON", async () => {
  const a = await ambiente();
  try {
    for (const q of ["a", " ", "  b ", "x".repeat(81)]) {
      const r = await a.buscar(q);
      assert.equal(r.status, 400, JSON.stringify(q));
      assert.equal(r.json.ok, false);
      assert.ok(r.json.erros?.[0]);
    }
    const sem = await fetch(`${a.base}/api/busca`);
    assert.equal(sem.status, 400);
    const dupla = await fetch(`${a.base}/api/busca?q=ab&q=cd`);
    assert.equal(dupla.status, 400);
    const limite = await a.buscar("x".repeat(80));
    assert.equal(limite.status, 200);
    const dois = await a.buscar("ab");
    assert.equal(dois.status, 200);
  } finally {
    await a.fechar();
  }
});

test("no máximo 20 resultados, com o total", async () => {
  const a = await ambiente();
  try {
    for (let i = 0; i < 25; i++) a.escrever(`n${String(i).padStart(2, "0")}.md`, "assunto comum\n");
    const r = await a.buscar("comum");
    assert.equal(r.json.itens!.length, 20);
    assert.equal(r.json.total, 25);
  } finally {
    await a.fechar();
  }
});

test("nome com espaço e ç na URI; pasta do vault com espaço", async () => {
  const a = await ambiente("Meu Cérebro ç");
  try {
    a.escrever("Ações/Decisão final.md", "texto\n");
    const r = await a.buscar("decisão final");
    const uri = r.json.itens![0].uri;
    assert.equal(uri, "obsidian://open?vault=Meu%20C%C3%A9rebro%20%C3%A7&file=A%C3%A7%C3%B5es%2FDecis%C3%A3o%20final");
    assert.ok(uri.startsWith("obsidian://open?"));
    const url = new URL(uri);
    assert.equal(url.searchParams.get("vault"), "Meu Cérebro ç");
    assert.equal(url.searchParams.get("file"), "Ações/Decisão final");
  } finally {
    await a.fechar();
  }
});

test("nenhuma resposta contém caminho absoluto", async () => {
  const a = await ambiente();
  try {
    a.escrever("Pasta/nota.md", "assunto absoluto\n");
    a.escrever("10-Reunioes/ata absoluto.md", "x\n");
    a.escrever("Pasta/segredo absoluto.md", "---\nconfidencial: true\n---\nx\n");
    const respostas = [await a.buscar("absoluto"), await a.buscar("a"), await a.buscar("nada-disso")];
    const pai = path.dirname(a.vault);
    for (const r of respostas) {
      assert.ok(!r.corpo.includes(a.vault), "caminho do vault");
      assert.ok(!r.corpo.includes(pai));
      assert.ok(!r.corpo.includes(a.vault.replace(/\\/g, "\\\\")), "caminho com barra invertida escapada");
      assert.ok(!/\b[A-Za-z]:[\\/]/.test(decodeURIComponent(r.corpo)), "letra de unidade");
      assert.ok(!r.corpo.includes("\\\\"));
    }
    for (const i of respostas[0].json.itens!) {
      assert.ok(!i.rel.includes("\\"));
      assert.ok(!i.rel.startsWith("/"));
      assert.ok(!i.rel.includes(".."));
    }
  } finally {
    await a.fechar();
  }
});

test("host de fora é recusado (403) e a rota só aceita GET", async () => {
  const a = await ambiente();
  try {
    const porta = new URL(a.base).port;
    const r = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: Number(porta), path: "/api/busca?q=teste", headers: { Host: "evil.example.com" } }, (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0 });
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(r.status, 403);
    const post = await fetch(`${a.base}/api/busca?q=teste`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.ok(post.status === 404 || post.status === 405);
    const arquivo = await fetch(`${a.base}/api/busca?q=teste&file=${encodeURIComponent("../../etc/passwd")}`);
    assert.equal(arquivo.status, 200); // `file` é ignorado
  } finally {
    await a.fechar();
  }
});

test("sem vault configurado: lista vazia e aviso", async () => {
  const busca = new ObservadorBusca(() => null, { semWatch: true, intervaloMs: 0 });
  const app = express();
  let porta = 0;
  registrarBusca(app, { resolverVault: () => null, busca, porta: () => porta });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  porta = (server.address() as AddressInfo).port;
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/api/busca?q=teste`);
    const json = (await r.json()) as { itens: unknown[]; semVault?: boolean };
    assert.equal(r.status, 200);
    assert.deepEqual(json.itens, []);
    assert.equal(json.semVault, true);
  } finally {
    busca.parar();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("nota que muda é relida (cache por data e tamanho)", async () => {
  const a = await ambiente();
  try {
    a.escrever("viva.md", "primeira versão\n");
    assert.equal((await a.buscar("primeira")).json.itens!.length, 1);
    a.escrever("viva.md", "segunda versão bem maior\n");
    const futuro = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(a.vault, "viva.md"), futuro, futuro);
    assert.equal((await a.buscar("primeira")).json.itens!.length, 0);
    assert.equal((await a.buscar("segunda")).json.itens!.length, 1);
    fs.rmSync(path.join(a.vault, "viva.md"));
    assert.equal((await a.buscar("segunda")).json.itens!.length, 0);
  } finally {
    await a.fechar();
  }
});

test("funções puras", () => {
  assert.equal(validarConsulta("ab").ok, true);
  assert.equal(validarConsulta(undefined).ok, false);
  assert.equal(confidencialPeloTexto("# só texto\n"), false);
  assert.equal(confidencialPeloTexto("---\nconfidencial: sim\n---\n"), true);
  assert.equal(montarEntrada("x.md", null).confidencial, true);
  assert.equal(uriObsidian("v", "a b/ç.md"), "obsidian://open?vault=v&file=a%20b%2F%C3%A7");
});
