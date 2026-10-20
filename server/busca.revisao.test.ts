// Correções da revisão da busca (Etapa 8). Só pastas temporárias (mkdtemp) com notas fictícias.
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";
import type { BuscaItem } from "../shared/types.ts";
import { ObservadorBusca, confidencialPeloTexto, montarEntrada, registrarBusca, type ObservadorBuscaOpcoes } from "./busca.ts";
import { lerFrontmatter, temConfidencialTrue } from "./vault.ts";

interface Amb {
  vault: string;
  busca: ObservadorBusca;
  escrever: (rel: string, texto: string) => void;
  /** consulta SEM reler o vault antes */
  consultar: (q: string) => Promise<{ itens: BuscaItem[]; total: number; corpo: string; ms: number }>;
  recarregar: () => Promise<void>;
  fechar: () => Promise<void>;
}

async function ambiente(opts: ObservadorBuscaOpcoes = {}): Promise<Amb> {
  const pai = fs.mkdtempSync(path.join(os.tmpdir(), "busca-rev-"));
  const vault = path.join(pai, "cerebro-teste");
  fs.mkdirSync(vault);
  const busca = new ObservadorBusca(() => vault, { semWatch: true, intervaloMs: 0, ...opts });
  const app = express();
  let porta = 0;
  registrarBusca(app, { resolverVault: () => vault, busca, porta: () => porta });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  porta = (server.address() as AddressInfo).port;
  return {
    vault,
    busca,
    escrever: (rel, texto) => {
      const arq = path.join(vault, ...rel.split("/"));
      fs.mkdirSync(path.dirname(arq), { recursive: true });
      fs.writeFileSync(arq, texto);
    },
    consultar: async (q) => {
      const t0 = performance.now();
      const r = await fetch(`http://127.0.0.1:${porta}/api/busca?q=${encodeURIComponent(q)}`);
      const corpo = await r.text();
      const ms = performance.now() - t0;
      const j = JSON.parse(corpo) as { itens: BuscaItem[]; total: number };
      return { itens: j.itens, total: j.total, corpo, ms };
    },
    recarregar: () => busca.recarregar(),
    fechar: async () => {
      busca.parar();
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(pai, { recursive: true, force: true });
    },
  };
}

test("regressão: cabeçalho e corpo só de '[[' não travam (linear)", async () => {
  const a = await ambiente();
  try {
    const t0 = performance.now();
    const e = montarEntrada("Cab.md", "# " + "[[".repeat(50000) + "\n\ntexto\n");
    const e2 = montarEntrada("Corpo.md", "[[".repeat(100000));
    assert.ok(performance.now() - t0 < 200, `montarEntrada demorou ${performance.now() - t0} ms`);
    assert.ok(e.cabsN.length <= 250);
    assert.ok(e2.corpoN.length > 0);

    a.escrever("Cab.md", "# " + "[[".repeat(50000) + "\n\nfoguete\n");
    a.escrever("Corpo.md", "[[".repeat(100000) + " foguete");
    const t1 = performance.now();
    await a.recarregar();
    const r = await a.consultar("foguete");
    assert.ok(performance.now() - t1 < 400, `indexar+buscar demorou ${performance.now() - t1} ms`);
    assert.ok(r.ms < 200, `busca ${r.ms} ms`);
    assert.equal(r.itens.length, 2);
  } finally {
    await a.fechar();
  }
});

test("falha ao reler nota alterada: fecha por segurança (só título), sem corpo nem trecho", async () => {
  let falhar = false;
  const a = await ambiente({
    lerArquivo: async (arq) => {
      if (falhar) throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
      return fsp.readFile(arq, "utf8");
    },
  });
  try {
    a.escrever("Notas/Segredo novo.md", "---\ntipo: nota\n---\n\nabacaxi azul\n");
    await a.recarregar();
    assert.equal((await a.consultar("abacaxi")).itens.length, 1);

    // a nota vira confidencial, mas a releitura falha
    falhar = true;
    await new Promise((r) => setTimeout(r, 20));
    a.escrever("Notas/Segredo novo.md", "---\nconfidencial: true\n---\n\nabacaxi azul, mais texto\n");
    await a.recarregar();
    const r = await a.consultar("abacaxi");
    assert.equal(r.itens.length, 0, "o corpo antigo não pode ser servido");
    assert.ok(!r.corpo.includes("abacaxi"));
    const e = a.busca.getEntradas().find((x) => x.rel === "Notas/Segredo novo.md")!;
    assert.equal(e.confidencial, true);
    assert.equal(e.corpoN, "");
    assert.equal((await a.consultar("segredo")).itens[0]?.confidencial, true, "o título continua achável");

    // volta a ler: o índice se corrige
    falhar = false;
    await a.recarregar();
    assert.equal((await a.consultar("abacaxi")).itens.length, 0, "continua confidencial");
  } finally {
    await a.fechar();
  }
});

test("índice velho: nota que virou confidencial não vaza corpo nem trecho (releitura confere)", async () => {
  const a = await ambiente();
  try {
    a.escrever("Velha.md", "# Velha\n\nmaracujá roxo\n");
    a.escrever("Velha com maracujá.md", "# Outra\n\nmaracujá no corpo\n");
    await a.recarregar();
    assert.equal((await a.consultar("maracuja")).itens.length, 2);
    // muda no disco; o índice NÃO é recarregado
    a.escrever("Velha.md", "---\nconfidencial: true\n---\n\nmaracujá roxo\n");
    a.escrever("Velha com maracujá.md", "---\nconfidencial: true\n---\n\nmaracujá no corpo\n");
    const r = await a.consultar("maracuja");
    assert.ok(!r.corpo.includes("roxo") && !r.corpo.includes("no corpo"), "sem trecho");
    assert.equal(r.itens.length, 1, "o que casava só pelo corpo some");
    assert.equal(r.itens[0].titulo, "Velha com maracujá");
    assert.equal(r.itens[0].confidencial, true);
    assert.equal(r.total, 1);
  } finally {
    await a.fechar();
  }
});

test("confidencial: variantes de escrita do frontmatter", () => {
  const variantes = [
    `---\nconfidencial: true\n---\ncorpo`,
    `---\n"confidencial": true\n---\ncorpo`,
    `---\n'confidencial': true\n---\ncorpo`,
    `---\n"confidencial": "true"\n---\ncorpo`,
    `---\n{confidencial: true}\n---\ncorpo`,
    `---\n{ "confidencial": true, tipo: nota }\n---\ncorpo`,
    `---\ntipo: nota\n{a: 1, 'confidencial': sim}\n---\ncorpo`,
    `---\nConfidencial: TRUE\n---\ncorpo`,
    `﻿---\r\nconfidencial: true\r\n---\r\ncorpo`,
    `---\r\n"Confidencial" : 'Yes'\r\n---\r\ncorpo`,
  ];
  for (const v of variantes) {
    assert.equal(temConfidencialTrue(v), true, `temConfidencialTrue: ${JSON.stringify(v)}`);
    assert.equal(confidencialPeloTexto(v), true, `confidencialPeloTexto: ${JSON.stringify(v)}`);
  }
  // fluxo com false não é "true", mas a busca fecha na dúvida
  assert.equal(temConfidencialTrue(`---\n{confidencial: false}\n---\n`), false);
  assert.equal(confidencialPeloTexto(`---\n{confidencial: false}\n---\n`), true);
  // usos existentes: false e textos comuns continuam abertos
  for (const ok of [`---\nconfidencial: false\n---\n`, `---\n"confidencial": false\n---\n`, `---\ntitulo: nota confidencial do projeto\n---\n`, `---\ntipo: nota\n---\n`]) {
    assert.equal(temConfidencialTrue(ok), false, ok);
    assert.equal(confidencialPeloTexto(ok), false, ok);
  }
  assert.equal(lerFrontmatter(`---\n"confidencial": true\n---\n`)?.confidencial, "true");
});

test("teto do índice: o que passa entra só pelo título e avisa", async () => {
  const avisos: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => void avisos.push(args.join(" "));
  const a = await ambiente({ maxBytesIndice: 600 });
  try {
    for (const n of ["a", "b", "c"]) a.escrever(`Nota ${n}.md`, `# Nota ${n}\n\n${"mamão ".repeat(60)}\n`);
    await a.recarregar();
    const r = await a.consultar("mamao");
    assert.ok(r.itens.length >= 1 && r.itens.length < 3, `só as que cabem: ${r.itens.length}`);
    const porTitulo = await a.consultar("nota");
    assert.equal(porTitulo.itens.length, 3, "todas aparecem pelo título");
    assert.ok(avisos.some((m) => m.includes("[busca]") && m.includes("título")));
    assert.ok(a.busca.getEntradas().some((e) => e.soTitulo && e.corpoN === ""));
  } finally {
    console.warn = orig;
    await a.fechar();
  }
});

test("desempenho: 2000 notas de ~3,5 KB, busca de palavra de corpo", async () => {
  const a = await ambiente();
  try {
    const bloco = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ";
    for (let i = 0; i < 2000; i++) {
      const extra = i === 1234 ? " palavrararíssima" : "";
      a.escrever(`Pasta ${i % 20}/Nota ${i}.md`, `---\ntipo: nota\n---\n\n# Nota ${i}\n\n${bloco.repeat(45)}${extra}\n`);
    }
    await a.recarregar();
    await a.consultar("lorem"); // aquece
    const melhor = Math.min(...(await Promise.all([1, 2, 3].map(() => a.consultar("palavrararissima")))).map((r) => r.ms));
    const r = await a.consultar("palavrararissima");
    assert.equal(r.itens.length, 1);
    assert.ok(r.itens[0].trecho?.includes("palavrararíssima"));
    assert.ok(melhor < 250, `busca ${melhor} ms (meta < 100 ms; folga para CI)`);

    // não bloqueia o loop: um timer de 10 ms atrasa pouco durante uma busca ampla
    let maiorAtraso = 0;
    let ultimo = performance.now();
    const timer = setInterval(() => {
      const agora = performance.now();
      maiorAtraso = Math.max(maiorAtraso, agora - ultimo - 5);
      ultimo = agora;
    }, 5);
    for (let k = 0; k < 5; k++) await a.consultar("ipsum dolor");
    clearInterval(timer);
    assert.ok(maiorAtraso < 150, `loop bloqueado por ${maiorAtraso} ms`);
  } finally {
    await a.fechar();
  }
});

test("trecho: some comentário HTML e bloco de código", async () => {
  const a = await ambiente();
  try {
    a.escrever(
      "Nota.md",
      "# Nota\n\n<!-- rascunho: goiaba escondida -->\n\n```js\nconst goiaba = 'codigo';\n```\n\nA goiaba madura vem do texto normal.\n",
    );
    await a.recarregar();
    const r = await a.consultar("goiaba");
    assert.equal(r.itens.length, 1);
    const t = r.itens[0].trecho ?? "";
    assert.ok(t.includes("goiaba madura"), t);
    assert.ok(!t.includes("rascunho") && !t.includes("codigo") && !t.includes("const"), t);
  } finally {
    await a.fechar();
  }
});
