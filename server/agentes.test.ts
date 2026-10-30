// Todo agente (agents/*.md e .claude/agents/*.md) precisa de um `model` válido (alias, claude-... ou inherit)
// e de `name:` igual ao nome do arquivo. Os 6 do time de construção em .claude/agents/ são cópia de agents/.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PASTA = path.join(ROOT, "agents");
const PASTA_PROJETO = path.join(ROOT, ".claude", "agents");
const TIME_CONSTRUCAO = ["planejador", "pesquisador", "dev", "testador", "revisor", "documentador"];

const ler = (p: string): string => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const frontmatter = (texto: string): string => /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto)?.[1] ?? "";
const mds = (pasta: string): string[] => fs.readdirSync(pasta).filter((f) => f.endsWith(".md"));

for (const [rotulo, pasta] of [
  ["agents/", PASTA],
  [".claude/agents/", PASTA_PROJETO],
] as const) {
  test(`cada agente de ${rotulo} tem model válido e name igual ao arquivo`, () => {
    const arquivos = mds(pasta);
    assert.ok(arquivos.length >= 6);
    for (const f of arquivos) {
      const fm = frontmatter(ler(path.join(pasta, f)));
      const model = /^model:\s*(\S+)\s*$/m.exec(fm)?.[1];
      assert.ok(model, `${f} sem model`);
      assert.ok(["sonnet", "opus", "haiku", "inherit"].includes(model) || model.startsWith("claude-"), `${f}: model inválido (${model})`);
      const name = /^name:\s*(\S+)\s*$/m.exec(fm)?.[1];
      assert.equal(name, f.replace(/\.md$/, ""), `${rotulo}${f}: name diferente do arquivo`);
    }
  });
}

test(".claude/agents/ tem a cópia exata dos 6 agentes de construção de agents/", () => {
  for (const nome of TIME_CONSTRUCAO) {
    const origem = path.join(PASTA, `${nome}.md`);
    const copia = path.join(PASTA_PROJETO, `${nome}.md`);
    assert.ok(fs.existsSync(copia), `falta .claude/agents/${nome}.md (rode: node scripts/install-agents.mjs --project .)`);
    assert.equal(ler(copia), ler(origem), `.claude/agents/${nome}.md difere de agents/${nome}.md`);
  }
});

// Equipe de produção (Etapa 2): só o showrunner chama, e cada um tem ferramentas e modelo fixos.
const PRODUCAO: Record<string, { tools: string[]; model: string }> = {
  roteirista: { tools: ["Read", "Write"], model: "sonnet" },
  continuista: { tools: ["Read", "Grep", "Glob"], model: "haiku" },
  "diretor-arte": { tools: ["Read", "Write", "Edit", "Bash"], model: "sonnet" },
  "diretor-dublagem": { tools: ["Read", "Write", "Bash"], model: "haiku" },
  montador: { tools: ["Read", "Write", "Edit", "Bash"], model: "sonnet" },
  "revisor-conteudo": { tools: ["Read", "Bash"], model: "sonnet" },
  apurador: { tools: ["Read", "Write", "Bash"], model: "haiku" },
  "social-media": { tools: ["Read", "Write", "Bash"], model: "haiku" },
  arquivista: { tools: ["Read", "Write", "Edit"], model: "haiku" },
};
const campo = (fm: string, nome: string): string | undefined => new RegExp(`^${nome}:\\s*(.*?)\\s*$`, "m").exec(fm)?.[1];
const ESCREVE_NO_VAULT = /único (agente )?que escreve no vault/i;

for (const [nome, esperado] of Object.entries(PRODUCAO)) {
  test(`agente de produção ${nome}: frontmatter, seções e regra do vault`, () => {
    const arquivo = path.join(PASTA_PROJETO, `${nome}.md`);
    assert.ok(fs.existsSync(arquivo), `falta .claude/agents/${nome}.md`);
    const texto = ler(arquivo);
    const fm = frontmatter(texto);
    const corpo = texto.slice(texto.indexOf("\n---", 3) + 4);

    assert.equal(campo(fm, "name"), nome);
    const tools = (campo(fm, "tools") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    assert.deepEqual(new Set(tools), new Set(esperado.tools), `${nome}: tools`);
    assert.equal(tools.length, esperado.tools.length, `${nome}: tools repetida`);
    assert.equal(campo(fm, "model"), esperado.model, `${nome}: model`);

    const descricao = campo(fm, "description") ?? "";
    assert.ok(descricao.startsWith("Só chamado pelo showrunner"), `${nome}: description deve começar com "Só chamado pelo showrunner"`);
    assert.doesNotMatch(texto, /PROATIVAMENTE/i, `${nome}: não pode pedir uso proativo`);

    for (const titulo of ["Quando o showrunner me chama", "O que entrego", "O que NÃO faço"]) {
      assert.match(corpo, new RegExp(`^## ${titulo}\\s*$`, "m"), `${nome}: falta a seção "${titulo}"`);
    }

    if (nome === "arquivista") {
      assert.match(corpo, ESCREVE_NO_VAULT, "arquivista deve ter a regra de ser o único que escreve no vault");
      assert.doesNotMatch(corpo, /não escrevo no vault/i);
    } else {
      assert.doesNotMatch(texto, ESCREVE_NO_VAULT, `${nome}: só o arquivista escreve no vault`);
      assert.match(corpo, /não escrevo no vault/i, `${nome}: falta a regra "Não escrevo no vault"`);
    }
  });
}

test("diretor-arte e revisor de .claude/agents citam referencias/rhynor-marca.md", () => {
  for (const nome of ["diretor-arte", "revisor"]) {
    assert.match(ler(path.join(PASTA_PROJETO, `${nome}.md`)), /referencias\/rhynor-marca\.md/, `${nome} não cita a marca`);
  }
});

test("team/CLAUDE-studio.md tem as regras do showrunner e a ordem do episódio", () => {
  const texto = ler(path.join(ROOT, "team", "CLAUDE-studio.md"));
  for (const trecho of ["Topologia em estrela", "Agente decide, script executa", "APROVAÇÃO DO ROTEIRO", "APROVAÇÃO DO VÍDEO", "STUDIO_VAULT", "caminhos absolutos"]) {
    assert.ok(texto.includes(trecho), `CLAUDE-studio.md sem "${trecho}"`);
  }
  assert.match(texto, /arquivista\*\* é o único que escreve no vault das séries/);
  // os passos aparecem na ordem do fluxo; social-media e revisor-conteudo aparecem duas vezes cada:
  // o post é preparado (sem postar) ANTES da revisão final e da aprovação, e só postado depois
  const ordem = [
    "apurador",
    "roteirista",
    "continuista",
    "revisor-conteudo",
    "APROVAÇÃO DO ROTEIRO",
    "diretor-arte",
    "montador",
    "social-media",
    "revisor-conteudo",
    "APROVAÇÃO DO VÍDEO",
    "social-media",
    "arquivista",
  ];
  const fluxo = texto.slice(texto.indexOf("## Ordem de um episódio"));
  let pos = -1;
  for (const passo of ordem) {
    const achou = fluxo.indexOf(passo, pos + 1);
    assert.ok(achou > pos, `ordem do episódio: "${passo}" falta ou está fora do lugar`);
    pos = achou;
  }
  assert.ok(fluxo.includes("diretor-dublagem"));
  const linhas = fluxo.split("\n");
  const prepara = linhas.find((l) => l.includes("`social-media`") && l.includes("post.md"));
  assert.ok(prepara && /sem postar/.test(prepara), "1ª chamada do social-media prepara o post.md sem postar");
  const revisaFinal = linhas.find((l) => l.includes("`revisor-conteudo`") && l.includes("post.md"));
  assert.ok(revisaFinal && /vídeo/.test(revisaFinal), "revisão final cobre vídeo e post.md");
  for (const nome of Object.keys(PRODUCAO)) assert.ok(texto.includes(nome), `CLAUDE-studio.md não cita ${nome}`);
});

test("CLAUDE.md da raiz explica os dois modos, a marca, as portas e a regra de memória", () => {
  const texto = ler(path.join(ROOT, "CLAUDE.md"));
  for (const trecho of ["`/time`", "showrunner", "team/CLAUDE-studio.md", "referencias/rhynor-marca.md", "--rh-*", "npm test", "4848", "STUDIO_PORT", "20-Producao/Construcao/"]) {
    assert.ok(texto.includes(trecho), `CLAUDE.md sem "${trecho}"`);
  }
  // memória: o global fica de fora; nada do vault antigo; depois só a pasta de construção, nunca a raiz
  const memoria = texto.slice(texto.indexOf("## Memória"));
  assert.match(memoria, /ignore a seção "Memória do time"/);
  assert.match(memoria, /não leia nem escreva no vault apontado pela variável de vault do motor upstream/);
  assert.match(memoria, /não passe caminho de vault ao pesquisador nem ao documentador até a Etapa 3/);
  assert.match(memoria, /<STUDIO_VAULT>\/20-Producao\/Construcao\/` \(nunca a raiz do vault das séries\)/);
});

test("social-media em duas chamadas e revisor-conteudo revisando vídeo + post.md", () => {
  const social = ler(path.join(PASTA_PROJETO, "social-media.md"));
  assert.match(social, /1ª chamada \(preparar\)/);
  assert.match(social, /\*\*não posto\*\*/);
  assert.match(social, /2ª chamada \(postar\)/);
  const revisor = ler(path.join(PASTA_PROJETO, "revisor-conteudo.md"));
  assert.match(revisor, /vídeo renderizado \*\*e\*\* o `post\.md`/);
  assert.match(revisor, /Bash só para comandos de leitura \(ffprobe, scripts de leitura do projeto\)/);
  assert.ok(revisor.includes("<raiz do projeto>/referencias/rhynor-marca.md"));
});

test("quem lê o vault não lê nota confidencial", () => {
  for (const nome of ["roteirista", "continuista", "diretor-arte", "diretor-dublagem", "apurador", "arquivista"]) {
    const corpo = ler(path.join(PASTA_PROJETO, `${nome}.md`));
    const naoFaco = corpo.slice(corpo.indexOf("## O que NÃO faço"), corpo.indexOf("## Regras"));
    assert.ok(naoFaco.includes("Não leio nota com `confidencial: true`."), `${nome}: falta a regra de nota confidencial em "O que NÃO faço"`);
  }
});
