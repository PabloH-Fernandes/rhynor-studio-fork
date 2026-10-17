// Gerador de atas fictícias + leitura determinística (ataParser). Tudo inventado; nada de vault real.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Anonimizador, ehForaDoFormato, parseAta, normalizarPrazo, type AtaLida } from "./ataParser.ts";
import { CENARIOS, PESSOAS_FICTICIAS, acharCenario, gerarAta, gravarAta, lerArgs, type NomeCenario } from "./ataFicticia.ts";

const AGORA = new Date(2026, 9, 17, 14, 30); // 17/10/2026 14:30 (local)

/** sorteio repetível */
function semente(n: number): () => number {
  let s = n;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function ata(cenario: NomeCenario, n = 1) {
  return gerarAta(cenario, { agora: AGORA, rng: semente(n) });
}

function lida(texto: string, nome = "ata-2026-10-17-1430-x.md"): AtaLida {
  const r = parseAta(texto, nome);
  assert.ok(!ehForaDoFormato(r), `deveria ler, mas: ${ehForaDoFormato(r) ? r.motivo : ""}`);
  return r as AtaLida;
}

function fm(extra: string[] = [], titulo = "Reunião de teste"): string {
  return ["---", "tipo: ata-bruta", "data: 2026-10-17", `titulo: ${titulo}`, ...extra, "confidencial: true", "---"].join("\n");
}

// ---------------------------------------------------------------- gerador

test("gerador: formato da missão, nome do arquivo e repetível", () => {
  const a = ata("projeto-software");
  assert.equal(a.nomeArquivo, "ata-2026-10-17-1430-planejamento-sprint.md");
  assert.match(a.texto, /^---\ntipo: ata-bruta\norigem: copilot-insights\ndata: 2026-10-17\nhora: "14:30"\n/);
  assert.match(a.texto, /\nreuniao_id: ficticia-202610171430-planejamento-sprint-[0-9a-f]{4}\n/);
  assert.match(a.texto, /\nstatus: nova\nficticia: true\nconfidencial: true\n---\n/);
  assert.match(a.texto, /\n## Notas da reunião \(Copilot\)\n- /);
  assert.match(a.texto, /\n- \[ \] .+ \(responsável: .+\) \(prazo: 2026-10-\d\d\)/);
  assert.equal(ata("projeto-software").texto, a.texto);
  assert.notEqual(ata("projeto-software", 2).texto, a.texto);
});

test("gerador: todos os cenários existem e o nome do arquivo é válido", () => {
  assert.equal(CENARIOS.length, 5);
  for (const c of CENARIOS) {
    const a = ata(c);
    assert.match(a.nomeArquivo, /^ata-2026-10-17-1430-[a-z0-9-]+\.md$/, c);
  }
});

test("gerador: acharCenario aceita sem acento e maiúscula; opções da linha de comando", () => {
  assert.equal(acharCenario("bagunçado"), "bagunçado");
  assert.equal(acharCenario("BAGUNCADO"), "bagunçado");
  assert.equal(acharCenario("so-decisoes"), "so-decisoes");
  assert.equal(acharCenario("nao-existe"), null);
  assert.deepEqual(lerArgs(["--cenario=alinhamento-bi", "--vault=C:\\x", "--sem-gravar"]), {
    cenario: "alinhamento-bi",
    vault: "C:\\x",
    semGravar: true,
    erro: null,
  });
  assert.equal(lerArgs(["--foo"]).erro, "Opção desconhecida: --foo");
});

test("gerador: grava em .tmp, renomeia e não sobrescreve", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ata-ficticia-"));
  try {
    const inbox = path.join(dir, "00-Inbox");
    const a = ata("so-decisoes");
    const p1 = await gravarAta(inbox, a);
    const p2 = await gravarAta(inbox, a);
    assert.equal(path.basename(p1), a.nomeArquivo);
    assert.equal(path.basename(p2), a.nomeArquivo.replace(/\.md$/, "-2.md"));
    assert.deepEqual(fs.readdirSync(inbox).sort(), [path.basename(p1), path.basename(p2)].sort());
    assert.equal(fs.readFileSync(p1, "utf8"), a.texto);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- parser nos cenários

test("parser: projeto-software", () => {
  const r = lida(ata("projeto-software").texto);
  assert.match(r.titulo, /^Planejamento da sprint do Projeto /);
  assert.equal(r.data, "2026-10-17");
  assert.equal(r.hora, "14:30");
  assert.match(r.reuniaoId, /^ficticia-/);
  assert.equal(r.ficticia, true);
  assert.equal(r.tarefas.length, 5);
  assert.equal(r.decisoes.length, 2);
  assert.ok(r.notas.length >= 4);
  assert.ok(r.tarefas.every((t) => t.responsavel.startsWith("Responsável ")));
  assert.ok(r.tarefas.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.prazo) && !t.prazoInvalido));
  assert.ok(r.tarefas.some((t) => t.prazo === "2026-10-14"), "uma tarefa vencida (-3 dias)");
});

test("parser: alinhamento-bi", () => {
  const r = lida(ata("alinhamento-bi").texto);
  assert.match(r.titulo, /^Alinhamento do painel de BI/);
  assert.equal(r.tarefas.length, 4);
  assert.equal(r.decisoes.length, 2);
});

test("parser: so-decisoes não tem tarefas e é válida", () => {
  const r = lida(ata("so-decisoes").texto);
  assert.equal(r.tarefas.length, 0);
  assert.equal(r.decisoes.length, 4);
  assert.ok(r.notas.length > 0);
});

test("parser: tarefas-sem-prazo mantém prazo e responsável vazios, sem inventar", () => {
  const r = lida(ata("tarefas-sem-prazo").texto);
  assert.equal(r.tarefas.length, 5);
  assert.equal(r.tarefas.filter((t) => t.prazo === "").length, 4);
  assert.equal(r.tarefas.filter((t) => t.responsavel === "").length, 1);
  assert.equal(r.tarefas.filter((t) => t.prazoInvalido).length, 0);
});

test("parser: bagunçado (transcrição sem seções) cai fora do formato", () => {
  const r = parseAta(ata("bagunçado").texto, "ata-2026-10-17-1430-conversa-solta.md");
  assert.ok(ehForaDoFormato(r));
  assert.match((r as { motivo: string }).motivo, /transcrição/i);
});

test("anonimização: nenhum nome original sobra, em nenhum cenário legível", () => {
  for (const c of CENARIOS.filter((x) => x !== "bagunçado")) {
    for (const n of [1, 2, 3]) {
      const texto = ata(c, n).texto;
      const r = lida(texto);
      const saida = JSON.stringify(r);
      for (const pessoa of PESSOAS_FICTICIAS) {
        for (const parte of pessoa.split(" ")) {
          assert.ok(!saida.toLowerCase().includes(parte.toLowerCase()), `${c}/${n}: "${parte}" sobrou`);
        }
      }
    }
  }
});

test("anonimização: letras na ordem de aparição, falante e responsável são a mesma pessoa", () => {
  const texto = [
    fm(),
    "## Notas da reunião (Copilot)",
    "- Zuleica: abri a pauta.",
    "- Ormindo Calixto falou do orçamento e Zuleica concordou.",
    "## Tarefas",
    "- [ ] Rever o orçamento (responsável: Ormindo Calixto)",
    "- [ ] Mandar a ata (responsável: zuleica) (prazo: 2026-10-20)",
    "- [ ] Arquivar tudo (responsável: Beltrano Quinto)",
  ].join("\n");
  const r = lida(texto);
  assert.deepEqual(
    r.tarefas.map((t) => t.responsavel),
    ["Responsável B", "Responsável A", "Responsável C"],
  );
  assert.deepEqual(r.notas, ["Responsável A: abri a pauta.", "Responsável B falou do orçamento e Responsável A concordou."]);
  assert.ok(!JSON.stringify(r).match(/Zuleica|Ormindo|Calixto|Beltrano/i));
});

test("anonimização: papel entre parênteses não vira outra pessoa; sobrenome e acento também somem", () => {
  const texto = [
    fm(),
    "## Notas da reunião (Copilot)",
    "- Lúcia Ferreira Prado trouxe os números; depois a LUCIA revisou tudo.",
    "## Tarefas",
    "- [ ] Aprovar o gasto (responsável: Lúcia Ferreira Prado (tesouraria))",
    "- [ ] Conferir o caixa (responsável: Lúcia Ferreira Prado)",
  ].join("\n");
  const r = lida(texto);
  assert.deepEqual(
    r.tarefas.map((t) => t.responsavel),
    ["Responsável A", "Responsável A"],
  );
  assert.equal(r.notas[0], "Responsável A trouxe os números; depois a Responsável A revisou tudo.");
});

// ---------------------------------------------------------------- bordas do arquivo

test("parser: BOM e CRLF dão o mesmo resultado", () => {
  const base = ata("tarefas-sem-prazo").texto;
  const normal = lida(base);
  const bom = lida("﻿" + base);
  const crlf = lida(base.replace(/\n/g, "\r\n"));
  const ambos = lida("﻿" + base.replace(/\n/g, "\r\n"));
  assert.deepEqual(bom, normal);
  assert.deepEqual(crlf, normal);
  assert.deepEqual(ambos, normal);
});

test("parser: data inválida ou ausente fica vazia", () => {
  const corpo = "## Notas da reunião (Copilot)\n- algo\n";
  for (const data of ["2026-02-31", "13/10/2026", "ontem", ""]) {
    const texto = ["---", "tipo: ata-bruta", `data: ${data}`, "titulo: T", "---", corpo].join("\n");
    assert.equal(lida(texto).data, "", data);
  }
  assert.equal(lida(["---", "tipo: ata-bruta", "titulo: T", "---", corpo].join("\n")).data, "");
});

test("parser: formatos de prazo (parênteses, barra vertical, dd/mm/aaaa) e prazo inválido vira sem prazo", () => {
  const texto = [
    fm(),
    "## Tarefas",
    "- [ ] A (responsável: Ana Lima) (prazo: 2026-10-20)",
    "- B | responsável: Ana Lima | prazo: 21/10/2026",
    "- C | responsável: Ana Lima | prazo: 2026-10-22 | classe: ?",
    "- [ ] D (prazo: 31/02/2026)",
    "- [ ] E (prazo: semana que vem)",
    "- F | responsável: | prazo:",
    "- [ ] G (prazo: 2026-13-01)",
  ].join("\n");
  const r = lida(texto);
  assert.deepEqual(
    r.tarefas.map((t) => [t.texto, t.prazo, t.prazoInvalido]),
    [
      ["A", "2026-10-20", false],
      ["B", "2026-10-21", false],
      ["C", "2026-10-22", false],
      ["D", "", true],
      ["E", "", true],
      ["F", "", false],
      ["G", "", true],
    ],
  );
  assert.equal(r.tarefas[0].responsavel, "Responsável A");
  assert.equal(r.tarefas[3].responsavel, "");
  assert.equal(r.tarefas[5].responsavel, "", "responsável vazio fica vazio");
  assert.equal(normalizarPrazo("1/2/2027"), "2027-02-01");
  assert.equal(normalizarPrazo(" "), "");
  assert.equal(normalizarPrazo("amanhã"), null);
});

test("parser: formato antigo (Pauta, Decisões, Tarefas com |)", () => {
  const texto = [
    "---",
    "tipo: ata",
    "projeto:",
    "data: 2026-10-13",
    "status: nova",
    "origem: power-automate",
    "tags: [ata, inbox]",
    "confidencial: true",
    "titulo: Planejamento do encontro",
    'hora: "19:00"',
    "---",
    "",
    "# Planejamento do encontro",
    "",
    "## Pauta",
    "- Inscrições",
    "## Decisões",
    "- O encontro é no dia 22.",
    "## Tarefas",
    "- Criar a página | responsável: Tiago (voluntário de TI) | prazo: 2026-10-31",
    "- Escrever perguntas | responsável: Tiago | prazo:",
    "- Ver o logo | responsável: | prazo:",
    "## Resumo",
    "Tiago ficou de cuidar do site.",
  ].join("\n");
  const r = lida(texto);
  assert.equal(r.titulo, "Planejamento do encontro");
  assert.equal(r.hora, "19:00");
  assert.deepEqual(r.pauta, ["Inscrições"]);
  assert.deepEqual(r.decisoes, ["O encontro é no dia 22."]);
  assert.deepEqual(r.notas, ["Responsável A ficou de cuidar do site."]);
  assert.deepEqual(
    r.tarefas.map((t) => [t.responsavel, t.prazo]),
    [["Responsável A", "2026-10-31"], ["Responsável A", ""], ["", ""]],
  );
});

test("parser: fora do formato (sem frontmatter, sem seções, transcrição)", () => {
  const motivo = (t: string) => {
    const r = parseAta(t, "ata-x.md");
    assert.ok(ehForaDoFormato(r), t.slice(0, 40));
    return (r as { motivo: string }).motivo;
  };
  assert.match(motivo("# só um texto\n\n## Tarefas\n- [ ] a"), /cabeçalho/);
  assert.match(motivo("---\ntipo: ata-bruta\n# sem fechar\n## Tarefas\n- [ ] a"), /cabeçalho/);
  assert.match(motivo(fm() + "\nTexto solto sem seção nenhuma.\n"), /seções/);
  assert.match(motivo(fm() + "\n## Anexos\n- algo\n"), /seções/);
  assert.match(motivo(fm() + "\n## Pauta\n- a\n## Transcrição\ntexto"), /transcrição/i);
  assert.match(motivo(fm() + "\n## Notas\n- a\n00:41:10 Ana: oi\n00:41:15 Bia: oi"), /transcrição/i);
  assert.match(motivo(fm() + "\n## Notas\nAna: oi\nBia: tudo bem\nAna: vamos começar"), /transcrição/i);
});

test("parser: rótulos como 'Decisão:' não são falantes; fala isolada não é transcrição", () => {
  const texto = [
    fm(),
    "## Notas da reunião (Copilot)",
    "- Decisão: seguir com a proposta A",
    "- Prazo: fim do mês",
    "- Obs: revisar depois",
    "## Tarefas",
    "- [ ] Revisar (responsável: Caio)",
  ].join("\n");
  const r = lida(texto);
  assert.equal(r.notas[0], "Decisão: seguir com a proposta A");
  assert.equal(r.tarefas[0].responsavel, "Responsável A");
});

test("parser: seção de tarefas vazia ou com 'nenhuma' e tarefa sem texto", () => {
  const r = lida([fm(), "## Pauta", "- a", "## Tarefas", "- nenhuma", "- [ ]", ""].join("\n"));
  assert.equal(r.tarefas.length, 0);
});

test("parser: sem título usa o do cabeçalho de nível 1 e depois o do nome do arquivo", () => {
  const sem = (extra: string) => ["---", "tipo: ata-bruta", "data: 2026-10-17", "---", extra, "## Pauta", "- a"].join("\n");
  assert.equal(lida(sem("# Título no corpo")).titulo, "Título no corpo");
  assert.equal(lida(sem(""), "ata-2026-10-17-1430-revisao-geral.md").titulo, "revisao geral");
});

test("o exemplo docs/exemplos/ata-ficticia.md é lido e anonimizado", () => {
  const arq = path.join(import.meta.dirname, "..", "docs", "exemplos", "ata-ficticia.md");
  const r = lida(fs.readFileSync(arq, "utf8"), "ata-2026-10-13-1900-clube-de-leitura.md");
  assert.equal(r.data, "2026-10-13");
  assert.equal(r.decisoes.length, 3);
  assert.equal(r.tarefas.length, 5);
  assert.equal(r.tarefas.filter((t) => t.prazo === "").length, 1);
  assert.equal(r.tarefas.filter((t) => t.responsavel === "").length, 1);
  assert.ok(!JSON.stringify(r).match(/Tiago|Marina|Lúcia/));
});

test("Anonimizador não troca palavras comuns: o nome precisa aparecer com inicial maiúscula", () => {
  const anon = new Anonimizador();
  anon.registrar("Sistema");
  const rotuloFlor = anon.registrar("Dona Flor");
  assert.equal(anon.aplicar("O sistema de pagamento caiu; Sistema avisou."), "O sistema de pagamento caiu; Responsável A avisou.");
  assert.equal(anon.aplicar("A flor do jardim e a Flor falaram"), `A flor do jardim e a ${rotuloFlor} falaram`);
  assert.equal(anon.aplicar("dona flor chegou"), `${rotuloFlor} chegou`, "nome completo em minúsculas ainda é trocado");
});
