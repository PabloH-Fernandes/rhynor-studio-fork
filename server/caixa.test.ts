// Caixa de entrada: leitura das reuniões em rascunho. Sempre em pastas temporárias (mkdtemp).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ObservadorCaixa, idValido, lerCaixaItem, lerTarefasDaNota, ordenarCaixa } from "./caixa.ts";
import { criarReuniao, novoVaultDeTeste } from "./testeVault.ts";

const NOTA = [
  "---",
  "tipo: reuniao",
  "data: 2026-10-17",
  "status: rascunho",
  "origem: leitura-automatica",
  "confidencial: true",
  "---",
  "",
  "# Planejamento da sprint",
  "",
  "## Pauta e notas",
  "- segredo da pauta",
  "",
  "## Decisões",
  "- segredo da decisão",
  "",
  "## Tarefas",
  "- [ ] Montar a página | responsável: Responsável A | prazo: 2026-10-31 | classe: ?",
  "- [x] Já feita | responsável: Responsável B | prazo: | classe: ?",
  "- [-] Ignorada antes | responsável: Responsável B | prazo: | classe: ?",
  "- [ ] Revisar o texto | responsável: | prazo: 2026-02-31 | classe: ?",
  "",
  "## Dúvidas",
  "- segredo da dúvida",
  "",
].join("\n");

test("lerTarefasDaNota numera todas as linhas e separa os campos", () => {
  const t = lerTarefasDaNota(NOTA.split("\n"));
  assert.deepEqual(
    t.map((x) => [x.n, x.marca, x.texto, x.responsavel, x.prazo, x.classe]),
    [
      [1, " ", "Montar a página", "Responsável A", "2026-10-31", "?"],
      [2, "x", "Já feita", "Responsável B", "", "?"],
      [3, "-", "Ignorada antes", "Responsável B", "", "?"],
      [4, " ", "Revisar o texto", "", "2026-02-31", "?"],
    ],
  );
  assert.deepEqual(lerTarefasDaNota(["# sem seção"]), []);
});

test("lerCaixaItem entrega só título, data e tarefas em aberto (prazo inválido some)", () => {
  const item = lerCaixaItem("2026-10-17-planejamento.md", NOTA);
  assert.deepEqual(item, {
    id: "2026-10-17-planejamento",
    titulo: "Planejamento da sprint",
    data: "2026-10-17",
    tarefas: [
      { n: 1, texto: "Montar a página", responsavel: "Responsável A", prazo: "2026-10-31" },
      { n: 4, texto: "Revisar o texto", responsavel: "", prazo: "" },
    ],
  });
  assert.ok(!JSON.stringify(item).includes("segredo"), "pauta, decisões e dúvidas não saem");
});

test("lerCaixaItem só aceita rascunho da leitura automática, com nome seguro", () => {
  assert.equal(lerCaixaItem("a.md", NOTA.replace("status: rascunho", "status: processada")), null);
  assert.equal(lerCaixaItem("a.md", NOTA.replace("origem: leitura-automatica", "origem: facilitator")), null);
  assert.equal(lerCaixaItem("a.md", NOTA.replace("tipo: reuniao", "tipo: missao")), null);
  assert.equal(lerCaixaItem("a b.md", NOTA), null);
  assert.equal(lerCaixaItem("reunião.md", NOTA), null);
  assert.equal(lerCaixaItem("a.md", "sem frontmatter"), null);
  // CRLF e BOM
  const crlf = "﻿" + NOTA.replace(/\n/g, "\r\n");
  assert.equal(lerCaixaItem("a.md", crlf)?.tarefas.length, 2);
});

test("reunião sem tarefas entra com a lista vazia", () => {
  const sem = NOTA.split("## Tarefas")[0] + "## Tarefas\n- nenhuma\n";
  assert.deepEqual(lerCaixaItem("a.md", sem)?.tarefas, []);
});

test("idValido e ordenarCaixa", () => {
  for (const ruim of ["", "a/b", "a\\b", "..", "a.b", "a b", "ã", 7, null]) assert.equal(idValido(ruim), false, String(ruim));
  assert.equal(idValido("2026-10-17-ok"), true);
  const ordem = ordenarCaixa([
    { id: "b", titulo: "", data: "2026-10-01", tarefas: [] },
    { id: "a", titulo: "", data: "2026-10-17", tarefas: [] },
    { id: "c", titulo: "", data: "2026-10-17", tarefas: [] },
  ]).map((i) => i.id);
  assert.deepEqual(ordem, ["a", "c", "b"]);
});

test("ObservadorCaixa lista os rascunhos, avisa a mudança e reiniciar mantém a lista", async () => {
  const v = novoVaultDeTeste();
  try {
    const obs = new ObservadorCaixa(() => v.vault, { semWatch: true, intervaloMs: 0 });
    await obs.iniciar();
    assert.deepEqual(obs.getItens(), []);

    const avisos: number[] = [];
    obs.subscribe((i) => avisos.push(i.length));
    const id = await criarReuniao(v);
    fs.writeFileSync(path.join(v.reunioes, "sem-formato.md"), "# solta, sem frontmatter\n");
    fs.writeFileSync(path.join(v.reunioes, "2026-10-17-do-facilitator.md"), NOTA.replace("origem: leitura-automatica", "origem: facilitator"));
    await obs.recarregar();
    assert.deepEqual(avisos, [1]);
    assert.equal(obs.getItens().length, 1);
    assert.equal(obs.getItens()[0].id, id);
    assert.ok(obs.getItens()[0].tarefas.length >= 3);
    for (const t of obs.getItens()[0].tarefas) assert.match(t.responsavel, /^Responsável [A-Z]$/);

    await obs.recarregar();
    assert.deepEqual(avisos, [1], "sem mudança não avisa de novo");

    // reiniciar (novo observador) lê a mesma lista do vault
    obs.parar();
    const novo = new ObservadorCaixa(() => v.vault, { semWatch: true, intervaloMs: 0 });
    await novo.iniciar();
    assert.deepEqual(novo.getItens(), obs.getItens());
    novo.parar();

    // nota que vira processada sai da lista
    const arq = path.join(v.reunioes, `${id}.md`);
    fs.writeFileSync(arq, fs.readFileSync(arq, "utf8").replace("status: rascunho", "status: processada"));
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(arq, t, t);
    await obs.recarregar();
    assert.deepEqual(obs.getItens(), []);
  } finally {
    v.limpar();
  }
});

test("ObservadorCaixa sem vault ou sem a pasta fica vazio", async () => {
  const sem = new ObservadorCaixa(() => null, { semWatch: true, intervaloMs: 0 });
  await sem.iniciar();
  assert.deepEqual(sem.getItens(), []);
  const v = novoVaultDeTeste();
  try {
    fs.rmSync(v.reunioes, { recursive: true });
    const obs = new ObservadorCaixa(() => v.vault, { semWatch: true, intervaloMs: 0 });
    await obs.iniciar();
    assert.deepEqual(obs.getItens(), []);
  } finally {
    v.limpar();
  }
});
