// Cores do canvas a partir dos tokens da marca (web/src/marca/tokens.css). Nenhum hex mora no código:
// no navegador o valor vem de getComputedStyle(:root); no Node (testes do motor) vem do próprio
// tokens.css, lido do disco. `definirCores` troca a fonte (testes) e `recarregarCores` limpa o cache
// quando os tokens mudam (tema), avisando quem guarda desenho pronto (cache de sprites, bakes).

/** nome do token sem os dois traços: "rh-laranja", "rh-pixel-folha"... */
export type NomeCor = `rh-${string}`;

const cache = new Map<string, string>();
let manual: Readonly<Record<string, string>> | null = null;
let doArquivo: Record<string, string> | null = null;
let versao = 0;
const ouvintes = new Set<() => void>();

const HEX = /^#[0-9a-fA-F]{6}$/;

/** lê os `--rh-*: valor;` do primeiro :root do texto de um tokens.css (o tema claro fica de fora) */
export function lerTokens(css: string): Record<string, string> {
  const inicio = css.indexOf(":root {");
  const fim = inicio >= 0 ? css.indexOf("\n}", inicio) : -1;
  const bloco = inicio >= 0 && fim > inicio ? css.slice(inicio, fim) : css;
  const out: Record<string, string> = {};
  for (const m of bloco.matchAll(/--(rh-[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** no Node: lê o tokens.css ao lado deste arquivo (síncrono, sem import de "node:fs" pro Vite não empacotar) */
function tokensDoDisco(): Record<string, string> {
  if (doArquivo) return doArquivo;
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const fs = proc?.getBuiltinModule?.("node:fs") as { readFileSync(p: URL, enc: "utf8"): string } | undefined;
  if (!fs) throw new Error("cores: sem DOM e sem node:fs para ler os tokens (use definirCores nos testes)");
  doArquivo = lerTokens(fs.readFileSync(new URL("./tokens.css", import.meta.url), "utf8"));
  return doArquivo;
}

function valorDoToken(nome: string): string {
  if (manual) return manual[nome] ?? "";
  if (typeof document !== "undefined" && typeof getComputedStyle === "function") {
    return getComputedStyle(document.documentElement).getPropertyValue(`--${nome}`).trim();
  }
  return tokensDoDisco()[nome] ?? "";
}

/** "--rh-x", "rh-x" → "rh-x" */
const normalizar = (nome: string) => nome.replace(/^--/, "");

/** Cor de um token (#RRGGBB). Token inexistente ou que não é cor dá erro claro. */
export function cor(nome: NomeCor | `--${NomeCor}`): string {
  const n = normalizar(nome);
  const hit = cache.get(n);
  if (hit) return hit;
  const v = valorDoToken(n);
  if (!v) throw new Error(`cores: o token --${n} não existe (ou o tokens.css ainda não foi carregado)`);
  if (!HEX.test(v)) throw new Error(`cores: o token --${n} não é uma cor #RRGGBB (vale "${v}")`);
  cache.set(n, v);
  return v;
}

/** aceita um token ("rh-x") ou uma cor já resolvida ("#rrggbb") */
function resolver(c: string): string {
  return c.startsWith("#") ? c : cor(c as NomeCor);
}

function rgbDe(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

/** mistura duas cores (token ou #rrggbb): t = 0 é `a`, t = 1 é `b` */
export function misturar(a: string, b: string, t: number): string {
  const x = rgbDe(resolver(a));
  const y = rgbDe(resolver(b));
  return `#${hex2(x[0] + (y[0] - x[0]) * t)}${hex2(x[1] + (y[1] - x[1]) * t)}${hex2(x[2] + (y[2] - x[2]) * t)}`;
}

/** a cor (token ou #rrggbb) com transparência, no formato #rrggbbaa que o canvas aceita */
export function comAlfa(c: string, alfa: number): string {
  return `${resolver(c).slice(0, 7)}${hex2(alfa * 255)}`;
}

/** Troca a fonte dos tokens (testes em Node); null volta para o normal. */
export function definirCores(mapa: Readonly<Record<string, string>> | null) {
  manual = mapa ? Object.fromEntries(Object.entries(mapa).map(([k, v]) => [normalizar(k), v])) : null;
  recarregarCores();
}

/** Os tokens mudaram (tema): esquece as cores lidas e avisa quem guarda desenho pronto. */
export function recarregarCores() {
  cache.clear();
  versao++;
  for (const f of ouvintes) f();
}

/** sobe a cada recarga: memorize cores derivadas junto com a versão */
export function versaoCores(): number {
  return versao;
}

/** chamado a cada recarga dos tokens; devolve a função que desliga */
export function aoMudarCores(f: () => void): () => void {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}

/** valor derivado de cores, refeito só quando os tokens mudam */
export function derivada<T>(fazer: () => T): () => T {
  let v: T | undefined;
  let em = -1;
  return () => {
    if (em !== versao) {
      v = fazer();
      em = versao;
    }
    return v as T;
  };
}

// no navegador, trocar o tema (data-theme no <html>) troca os tokens
if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  new MutationObserver(() => recarregarCores()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
