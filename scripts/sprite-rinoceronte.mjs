#!/usr/bin/env node
// Gera os PNGs do rinoceronte pixel da Rhynor (32x32 e 64x64, aprovado em 2026-10-25).
// Uso: npm run sprite   (roda com tsx: as matrizes vêm de web/src/marca/rinoceronte.ts, a mesma fonte do canvas)
//
// É adaptação de estilo da logo (referencias/rhynor-marca/logo/), não logo nova: mesmas formas e
// mesmas cores. As cores vêm de referencias/rhynor-marca/tokens.css (lidas por regex), nunca hex solto.
// Sem dependências: o PNG é escrito e lido com `zlib` e `fs` nativos.
//
// Saída:
//   assets/marca/rinoceronte-32.png, rinoceronte-64.png              versão de fundo escuro (principal)
//   assets/marca/rinoceronte-32-claro.png, rinoceronte-64-claro.png  versão de fundo claro
//   prints/comparacao-rinoceronte.png (fora do git)                  logo original x sprites ampliados

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { RINO_32, RINO_64, RINO_TOKENS, RINO_TOKENS_CLARO } from "../web/src/marca/rinoceronte.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARCA = path.join(ROOT, "referencias", "rhynor-marca");
const SAIDA = path.join(ROOT, "assets", "marca");
const PRINTS = path.join(ROOT, "prints");

// ---------------------------------------------------------------------------------------------
// Paleta (lida do tokens.css)
// ---------------------------------------------------------------------------------------------

/** Lê `--nome: #RRGGBB` de um bloco do tokens.css. `bloco` = seletor (":root" ou o do tema claro). */
function lerTokens(css, bloco) {
  const ini = css.indexOf(`${bloco} {`);
  if (ini < 0) throw new Error(`bloco ${bloco} não encontrado no tokens.css`);
  const corpo = css.slice(ini, css.indexOf("}", ini));
  const tokens = {};
  for (const m of corpo.matchAll(/--(rh-[\w-]+):\s*#([0-9a-fA-F]{6})\b/g)) {
    const hex = m[2];
    tokens[m[1]] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  return tokens;
}

const css = fs.readFileSync(path.join(MARCA, "tokens.css"), "utf8");
const TOKENS = lerTokens(css, ":root");
const TOKENS_CLARO = { ...TOKENS, ...lerTokens(css, ':root[data-theme="claro"]') };

function token(tokens, nome) {
  const cor = tokens[nome];
  if (!cor) throw new Error(`token --${nome} não encontrado no tokens.css`);
  return cor;
}

// Letra da matriz -> cor do token (o mapa letra -> token mora junto das matrizes).
const paletaDe = (mapa) => Object.fromEntries(Object.entries(mapa).map(([letra, nome]) => [letra, token(TOKENS, nome)]));
const PALETA_ESCURO = paletaDe(RINO_TOKENS);
const PALETA_CLARO = paletaDe(RINO_TOKENS_CLARO);

// ---------------------------------------------------------------------------------------------
// Imagem RGBA simples + PNG (escrita e leitura)
// ---------------------------------------------------------------------------------------------

function novaImagem(largura, altura, cor = [0, 0, 0, 0]) {
  const dados = Buffer.alloc(largura * altura * 4);
  for (let i = 0; i < dados.length; i += 4) dados.set(cor, i);
  return { largura, altura, dados };
}

function validarMatriz(nome, matriz, lado, paleta) {
  if (matriz.length !== lado) throw new Error(`${nome}: ${matriz.length} linhas, esperado ${lado}`);
  matriz.forEach((linha, y) => {
    if (linha.length !== lado) throw new Error(`${nome}: linha ${y} tem ${linha.length} colunas, esperado ${lado}`);
    for (const ch of linha) if (ch !== "." && !paleta[ch]) throw new Error(`${nome}: letra "${ch}" fora da paleta (linha ${y})`);
  });
}

function matrizParaImagem(matriz, paleta) {
  const lado = matriz.length;
  const img = novaImagem(lado, lado);
  matriz.forEach((linha, y) => {
    [...linha].forEach((ch, x) => {
      if (ch === ".") return;
      img.dados.set([...paleta[ch], 255], (y * lado + x) * 4);
    });
  });
  return img;
}

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloco(tipo, dados) {
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tam, corpo, crc]);
}

/** PNG RGBA 8-bit, sem filtro (filtro 0 em toda linha). */
function codificarPng({ largura, altura, dados }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, deflate, filtro adaptativo, sem entrelaçamento
  const bruto = Buffer.alloc(altura * (largura * 4 + 1));
  for (let y = 0; y < altura; y++) {
    dados.copy(bruto, y * (largura * 4 + 1) + 1, y * largura * 4, (y + 1) * largura * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", ihdr),
    bloco("IDAT", zlib.deflateSync(bruto, { level: 9 })),
    bloco("IEND", Buffer.alloc(0)),
  ]);
}

/** Lê PNG RGBA 8-bit sem entrelaçamento (o formato das logos da marca). */
function decodificarPng(buf) {
  let p = 8;
  let largura = 0;
  let altura = 0;
  const idat = [];
  while (p < buf.length) {
    const tam = buf.readUInt32BE(p);
    const tipo = buf.toString("ascii", p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + tam);
    if (tipo === "IHDR") {
      largura = d.readUInt32BE(0);
      altura = d.readUInt32BE(4);
      if (d[8] !== 8 || d[9] !== 6 || d[12] !== 0) throw new Error("só PNG RGBA 8-bit sem entrelaçamento");
    }
    if (tipo === "IDAT") idat.push(d);
    p += 12 + tam;
  }
  const bruto = zlib.inflateSync(Buffer.concat(idat));
  const passo = largura * 4;
  const dados = Buffer.alloc(altura * passo);
  for (let y = 0; y < altura; y++) {
    const filtro = bruto[y * (passo + 1)];
    for (let x = 0; x < passo; x++) {
      const r = bruto[y * (passo + 1) + 1 + x];
      const a = x >= 4 ? dados[y * passo + x - 4] : 0;
      const b = y > 0 ? dados[(y - 1) * passo + x] : 0;
      const c = x >= 4 && y > 0 ? dados[(y - 1) * passo + x - 4] : 0;
      let v = r;
      if (filtro === 1) v = r + a;
      else if (filtro === 2) v = r + b;
      else if (filtro === 3) v = r + ((a + b) >> 1);
      else if (filtro === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v = r + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      dados[y * passo + x] = v & 255;
    }
  }
  return { largura, altura, dados };
}

// ---------------------------------------------------------------------------------------------
// Composição da imagem de comparação
// ---------------------------------------------------------------------------------------------

/** Desenha `src` em `dst` na posição (x0, y0), escala inteira por vizinho mais próximo, com alpha. */
function colarAmpliado(dst, src, x0, y0, escala) {
  for (let y = 0; y < src.altura * escala; y++) {
    for (let x = 0; x < src.largura * escala; x++) {
      const i = (Math.floor(y / escala) * src.largura + Math.floor(x / escala)) * 4;
      misturar(dst, x0 + x, y0 + y, src.dados.subarray(i, i + 4));
    }
  }
}

/** Reduz `src` para caber em `lado` x `lado` (média por área, preserva a proporção) e cola centralizado. */
function colarReduzido(dst, src, x0, y0, lado) {
  const fator = Math.max(src.largura, src.altura) / lado;
  const w = Math.round(src.largura / fator);
  const h = Math.round(src.altura / fator);
  const ox = x0 + Math.floor((lado - w) / 2);
  const oy = y0 + Math.floor((lado - h) / 2);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const soma = [0, 0, 0, 0];
      let n = 0;
      for (let y = Math.floor(ty * fator); y < Math.min(src.altura, Math.floor((ty + 1) * fator)); y++) {
        for (let x = Math.floor(tx * fator); x < Math.min(src.largura, Math.floor((tx + 1) * fator)); x++) {
          const i = (y * src.largura + x) * 4;
          const a = src.dados[i + 3];
          soma[0] += src.dados[i] * a;
          soma[1] += src.dados[i + 1] * a;
          soma[2] += src.dados[i + 2] * a;
          soma[3] += a;
          n++;
        }
      }
      if (!n || !soma[3]) continue;
      misturar(dst, ox + tx, oy + ty, [soma[0] / soma[3], soma[1] / soma[3], soma[2] / soma[3], soma[3] / n]);
    }
  }
}

function misturar(img, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= img.largura || y >= img.altura || !a) return;
  const i = (y * img.largura + x) * 4;
  const t = a / 255;
  img.dados[i] = Math.round(r * t + img.dados[i] * (1 - t));
  img.dados[i + 1] = Math.round(g * t + img.dados[i + 1] * (1 - t));
  img.dados[i + 2] = Math.round(b * t + img.dados[i + 2] * (1 - t));
  img.dados[i + 3] = 255;
}

function retangulo(img, x0, y0, w, h, cor) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) misturar(img, x, y, [...cor, 255]);
}

/**
 * Duas faixas (fundo Noite com a logo de fundo escuro; fundo claro com a logo original).
 * Em cada faixa: logo original | sprite 64 ampliado 7x | sprite 32 ampliado 14x,
 * e embaixo dos sprites o tamanho real (1x) e 2x.
 */
function montarComparacao(faixas) {
  const PAINEL = 448;
  const M = 32;
  const MINI = 2 * 64 + M; // espaço das miniaturas
  const largura = M + 3 * PAINEL + 2 * M + M;
  const alturaFaixa = M + PAINEL + M + MINI;
  const img = novaImagem(largura, alturaFaixa * faixas.length, [0, 0, 0, 255]);
  faixas.forEach(({ fundo, painel, logo, s64, s32 }, i) => {
    const y0 = i * alturaFaixa;
    retangulo(img, 0, y0, largura, alturaFaixa, fundo);
    const xs = [M, M + PAINEL + M, M + 2 * (PAINEL + M)];
    xs.forEach((x) => retangulo(img, x, y0 + M, PAINEL, PAINEL, painel));
    colarReduzido(img, logo, xs[0] + 16, y0 + M + 16, PAINEL - 32);
    colarAmpliado(img, s64, xs[1], y0 + M, 7);
    colarAmpliado(img, s32, xs[2], y0 + M, 14);
    const yMini = y0 + M + PAINEL + M;
    for (const [x, s] of [[xs[1], s64], [xs[2], s32]]) {
      colarAmpliado(img, s, x, yMini, 1);
      colarAmpliado(img, s, x + s.largura + M, yMini, 2);
    }
    // a logo original em tamanho de sprite (64 px), para comparar com o 1x
    colarReduzido(img, logo, xs[0], yMini, 64);
    colarReduzido(img, logo, xs[0] + 64 + M, yMini, 32);
  });
  return img;
}

// ---------------------------------------------------------------------------------------------

function main() {
  validarMatriz("RINO_32", RINO_32, 32, PALETA_ESCURO);
  validarMatriz("RINO_64", RINO_64, 64, PALETA_ESCURO);
  fs.mkdirSync(SAIDA, { recursive: true });

  const sprites = {
    "rinoceronte-32.png": matrizParaImagem(RINO_32, PALETA_ESCURO),
    "rinoceronte-64.png": matrizParaImagem(RINO_64, PALETA_ESCURO),
    "rinoceronte-32-claro.png": matrizParaImagem(RINO_32, PALETA_CLARO),
    "rinoceronte-64-claro.png": matrizParaImagem(RINO_64, PALETA_CLARO),
  };
  for (const [nome, img] of Object.entries(sprites)) {
    fs.writeFileSync(path.join(SAIDA, nome), codificarPng(img));
  }

  const logoEscuro = decodificarPng(fs.readFileSync(path.join(MARCA, "logo", "rhynor-logo-fundo-escuro.png")));
  const logoClaro = decodificarPng(fs.readFileSync(path.join(MARCA, "logo", "rhynor-logo.png")));
  const comparacao = montarComparacao([
    {
      fundo: token(TOKENS, "rh-noite"),
      painel: token(TOKENS, "rh-superficie"),
      logo: logoEscuro,
      s64: sprites["rinoceronte-64.png"],
      s32: sprites["rinoceronte-32.png"],
    },
    {
      fundo: token(TOKENS_CLARO, "rh-noite"),
      painel: token(TOKENS_CLARO, "rh-superficie"),
      logo: logoClaro,
      s64: sprites["rinoceronte-64-claro.png"],
      s32: sprites["rinoceronte-32-claro.png"],
    },
  ]);
  fs.mkdirSync(PRINTS, { recursive: true });
  fs.writeFileSync(path.join(PRINTS, "comparacao-rinoceronte.png"), codificarPng(comparacao));

  for (const nome of Object.keys(sprites)) console.log(`ok  assets/marca/${nome}`);
  console.log("ok  prints/comparacao-rinoceronte.png");
}

main();
