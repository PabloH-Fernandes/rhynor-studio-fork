// Gasto de tokens: leitura do registro (fixtures fictícias), duplicados por message.id, incremental, dois dias,
// subagente, caminhos recusados e a nota da missão. Só pastas temporárias (mkdtemp): nunca ~/.claude nem o vault de verdade.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { diaLocal } from "../shared/datas.ts";
import { GastoTokens, caminhoPermitido, lerLinhaDeUso, papelSeguro } from "./gastoTokens.ts";
import { somarTokensNaMissao } from "./gastoMissao.ts";
import { novoVaultDeTeste } from "./testeVault.ts";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "transcritos");
const D14 = diaLocal(Date.parse("2026-10-14T15:00:00Z"));
const D15 = diaLocal(Date.parse("2026-10-15T15:00:00Z"));
const AGORA14 = Date.parse("2026-10-14T16:00:00Z");

interface Cenario {
  base: string;
  projetos: string;
  dir: string;
  lider: string;
  sub: string;
  limpar: () => void;
  gastos: GastoTokens[];
  fim: () => Promise<void>;
}

function cenario(): Cenario {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "gasto-"));
  const projetos = path.join(base, "projetos");
  const pasta = path.join(projetos, "proj-x");
  fs.mkdirSync(path.join(pasta, "sessao-exemplo", "subagents"), { recursive: true });
  fs.copyFileSync(path.join(FIX, "sessao-exemplo.jsonl"), path.join(pasta, "sessao-exemplo.jsonl"));
  for (const f of fs.readdirSync(path.join(FIX, "sessao-exemplo", "subagents"))) {
    fs.copyFileSync(path.join(FIX, "sessao-exemplo", "subagents", f), path.join(pasta, "sessao-exemplo", "subagents", f));
  }
  const gastos: GastoTokens[] = [];
  return {
    gastos,
    fim: async () => {
      for (const g of gastos) g.parar();
      for (const g of gastos) await g.esperar();
      fs.rmSync(base, { recursive: true, force: true });
    },
    base,
    projetos,
    dir: path.join(base, "gasto"),
    lider: path.join(pasta, "sessao-exemplo.jsonl"),
    sub: path.join(pasta, "sessao-exemplo", "subagents", "agent-sub-dev.jsonl"),
    limpar: () => {
      for (const g of gastos) g.parar();
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

function novo(c: Cenario, extra: Partial<ConstructorParameters<typeof GastoTokens>[0]> = {}) {
  const g = new GastoTokens({ dir: c.dir, projetosDir: () => c.projetos, agora: () => AGORA14, esperaMs: 5, emitirMs: 0, ...extra });
  c.gastos.push(g);
  return g;
}

const stop = (c: Cenario) => ({ hook_event_name: "Stop", session_id: "S1", transcript_path: c.lider });

test("lerLinhaDeUso: só assistant com id e usage; texto nunca sai", () => {
  const ok = lerLinhaDeUso(
    '{"type":"assistant","timestamp":"2026-10-14T15:00:00.000Z","message":{"id":"m1","content":[{"text":"SEGREDO"}],"usage":{"input_tokens":1,"output_tokens":2,"cache_creation_input_tokens":3,"cache_read_input_tokens":4}}}',
  );
  assert.deepEqual(ok?.v, [1, 2, 3, 4]);
  assert.equal(ok?.id, "m1");
  assert.ok(!JSON.stringify(ok).includes("SEGREDO"));
  assert.equal(lerLinhaDeUso('{"type":"user","message":{"usage":{}}}'), null);
  assert.equal(lerLinhaDeUso('{"type":"assistant","message":{"id":"x","usage":{"input_tokens":'), null);
  assert.equal(lerLinhaDeUso('{"type":"assistant","message":{"usage":{"input_tokens":1}}}'), null);
  const estranho = lerLinhaDeUso('{"type":"assistant","message":{"id":"m","usage":{"input_tokens":-5,"output_tokens":"9"}}}');
  assert.deepEqual(estranho?.v, [0, 0, 0, 0]);
});

test("papelSeguro aceita só nome simples", () => {
  assert.equal(papelSeguro(" Dev "), "dev");
  assert.equal(papelSeguro("../x"), "outro");
  assert.equal(papelSeguro(42), "outro");
});

test("Stop: conta uma vez por message.id, ignora sem usage, linha quebrada e usuário; dois dias", async () => {
  const c = cenario();
  try {
    const g = novo(c);
    await g.iniciar();
    assert.equal(g.getHoje(), null);
    g.registrar(stop(c));
    await g.esperar();
    const h = g.getHoje();
    // msg_A (maior valor de cada campo: 10+40+100) + msg_D (1+2+3); cache: 1000 + 4
    assert.deepEqual(h?.porPapel.lider, { tokens: 156, cacheLeitura: 1004 });
    assert.deepEqual(h?.total, { tokens: 156, cacheLeitura: 1004 });
    // msg_C é do outro dia: vai para o arquivo do outro dia
    if (D14 !== D15) {
      const outro = JSON.parse(fs.readFileSync(path.join(c.dir, `${D15}.json`), "utf8"));
      assert.equal(outro.porPapel.lider.entrada + outro.porPapel.lider.saida + outro.porPapel.lider.cacheCriacao, 24);
    }
    // o 2º aviso (~1,5 s depois) não conta de novo
    await new Promise((r) => setTimeout(r, 40));
    await g.esperar();
    assert.deepEqual(g.getHoje()?.total, { tokens: 156, cacheLeitura: 1004 });
    // nada de texto de conversa no disco
    for (const f of fs.readdirSync(c.dir)) {
      const t = fs.readFileSync(path.join(c.dir, f), "utf8");
      assert.ok(!t.includes("ficticio") && !t.includes("pedido"), f);
    }
  } finally {
    await c.fim();
  }
});

test("SubagentStop: lê agent_transcript_path com o papel do agent_type", async () => {
  const c = cenario();
  try {
    const g = novo(c);
    await g.iniciar();
    g.registrar({ hook_event_name: "SubagentStop", session_id: "S1", transcript_path: c.lider, agent_transcript_path: c.sub, agent_id: "sub-dev", agent_type: "dev" });
    await g.esperar();
    const h = g.getHoje();
    assert.deepEqual(h?.porPapel.dev, { tokens: 400, cacheLeitura: 500 });
    assert.deepEqual(h?.porPapel.lider, { tokens: 156, cacheLeitura: 1004 });
    assert.deepEqual(h?.total, { tokens: 556, cacheLeitura: 1504 });
  } finally {
    await c.fim();
  }
});

test("incremental: linha cortada espera o resto; reinício não recontar nem zerar", async () => {
  const c = cenario();
  try {
    const inteiro = fs.readFileSync(c.lider);
    const corte = inteiro.indexOf("msg_D") + 10; // no meio da linha da msg_D
    fs.writeFileSync(c.lider, inteiro.subarray(0, corte));
    let g = novo(c);
    await g.iniciar();
    g.registrar(stop(c));
    await g.esperar();
    assert.deepEqual(g.getHoje()?.total, { tokens: 150, cacheLeitura: 1000 }); // só msg_A
    g.parar();
    await g.esperar();

    // reinício: lê o resto, sem recontar a msg_A
    fs.writeFileSync(c.lider, inteiro);
    g = novo(c);
    await g.iniciar();
    assert.deepEqual(g.getHoje()?.total, { tokens: 150, cacheLeitura: 1000 }); // não zerou
    g.registrar(stop(c));
    await g.esperar();
    assert.deepEqual(g.getHoje()?.total, { tokens: 156, cacheLeitura: 1004 });
    g.registrar(stop(c));
    await g.esperar();
    assert.deepEqual(g.getHoje()?.total, { tokens: 156, cacheLeitura: 1004 });
    g.parar();
    await g.esperar();

    // mensagem em andamento que cresce entre leituras: só a diferença entra
    const extra =
      '{"type":"assistant","timestamp":"2026-10-14T15:06:00.000Z","message":{"id":"msg_D","usage":{"input_tokens":1,"output_tokens":12,"cache_creation_input_tokens":3,"cache_read_input_tokens":4}}}\n';
    fs.appendFileSync(c.lider, extra);
    g = novo(c);
    await g.iniciar();
    g.registrar(stop(c));
    await g.esperar();
    assert.deepEqual(g.getHoje()?.total, { tokens: 166, cacheLeitura: 1004 });
    g.parar();
    await g.esperar();
  } finally {
    await c.fim();
  }
});

test("caminho fora da pasta permitida, link simbólico, extensão errada e NUL são ignorados sem erro", async () => {
  const c = cenario();
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), "gasto-fora-"));
  try {
    const foraJsonl = path.join(fora, "x.jsonl");
    fs.copyFileSync(c.lider, foraJsonl);
    assert.equal(await caminhoPermitido(foraJsonl, c.projetos), null);
    assert.equal(await caminhoPermitido(path.join(c.projetos, "proj-x", "..", "..", "..", path.basename(fora), "x.jsonl"), c.projetos), null);
    assert.equal(await caminhoPermitido(c.lider.replace(/\.jsonl$/, ".txt"), c.projetos), null);
    assert.equal(await caminhoPermitido("relativo.jsonl", c.projetos), null);
    assert.equal(await caminhoPermitido({ a: 1 }, c.projetos), null);
    assert.equal(await caminhoPermitido(c.lider + "\u0000.jsonl", c.projetos), null);
    assert.ok(await caminhoPermitido(c.lider, c.projetos));
    try {
      const elo = path.join(c.projetos, "proj-x", "elo.jsonl");
      fs.symlinkSync(foraJsonl, elo);
      assert.equal(await caminhoPermitido(elo, c.projetos), null);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EPERM") throw err; // sem permissão para criar link no Windows
    }
    const g = novo(c);
    await g.iniciar();
    g.registrar({ hook_event_name: "Stop", session_id: "S1", transcript_path: foraJsonl });
    g.registrar({ hook_event_name: "Stop", session_id: "S1" });
    g.registrar(null);
    g.registrar("lixo");
    await g.esperar();
    assert.equal(g.getHoje(), null);
  } finally {
    await c.fim();
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test("ouvinte recebe o gasto novo; sem dado fica null", async () => {
  const c = cenario();
  try {
    const g = novo(c);
    await g.iniciar();
    const vistos: unknown[] = [];
    g.subscribe((h) => vistos.push(h));
    g.registrar(stop(c));
    await g.esperar();
    assert.equal(vistos.length >= 1, true);
    assert.deepEqual((vistos[0] as { total: unknown }).total, { tokens: 156, cacheLeitura: 1004 });
  } finally {
    await c.fim();
  }
});

// ---------------------------------------------------------------- nota da missão

function notaMissao(confidencial = "false"): string {
  return ["---", "tipo: missao", "status: em andamento", "origem: reuniao", `confidencial: ${confidencial}`, "---", "", "# Tarefas", "", "- [ ] algo", ""].join("\n");
}

test("nota da missão: grava só tokens_total e tokens_atualizado_em, soma ao que já existe", async () => {
  const v = novoVaultDeTeste();
  try {
    const f = path.join(v.missoes, "m1.md");
    fs.writeFileSync(f, notaMissao());
    const agora = new Date(2026, 9, 14, 12, 0);
    assert.equal(await somarTokensNaMissao(v.vault, "m1", 100, { agora: () => agora }), "gravou");
    let t = fs.readFileSync(f, "utf8");
    assert.match(t, /^tokens_total: 100$/m);
    assert.match(t, /^tokens_atualizado_em: 2026-10-14T/m);
    assert.ok(t.includes("# Tarefas\n\n- [ ] algo"));
    assert.equal(await somarTokensNaMissao(v.vault, "m1", 50), "gravou");
    t = fs.readFileSync(f, "utf8");
    assert.match(t, /^tokens_total: 150$/m);
    assert.equal(t.match(/tokens_total/g)?.length, 1);
    assert.equal(await somarTokensNaMissao(v.vault, "nao-existe", 5), "inexistente");
    assert.equal(await somarTokensNaMissao(v.vault, "../x", 5), "pulou");
  } finally {
    v.limpar();
  }
});

test("nota da missão: confidencial e frontmatter sem fechamento não são tocados; edição no meio dá conflito", async () => {
  const v = novoVaultDeTeste();
  try {
    const conf = path.join(v.missoes, "conf.md");
    fs.writeFileSync(conf, notaMissao("true"));
    const aberto = path.join(v.missoes, "aberto.md");
    fs.writeFileSync(aberto, "---\ntipo: missao\nstatus: a fazer\n\n# sem fechar\n");
    const antesConf = fs.readFileSync(conf, "utf8");
    const antesAberto = fs.readFileSync(aberto, "utf8");
    assert.equal(await somarTokensNaMissao(v.vault, "conf", 10), "pulou");
    assert.equal(await somarTokensNaMissao(v.vault, "aberto", 10), "pulou");
    assert.equal(fs.readFileSync(conf, "utf8"), antesConf);
    assert.equal(fs.readFileSync(aberto, "utf8"), antesAberto);

    const f = path.join(v.missoes, "edit.md");
    fs.writeFileSync(f, notaMissao());
    const r = await somarTokensNaMissao(v.vault, "edit", 10, {
      antesDeGravar: () => {
        fs.appendFileSync(f, "- [ ] editada por outra pessoa\n");
      },
    });
    assert.equal(r, "conflito");
    assert.ok(!fs.readFileSync(f, "utf8").includes("tokens_total"));
  } finally {
    v.limpar();
  }
});

test("GastoTokens grava na nota da missão da sessão (no máximo 1 vez por minuto; a saída da sessão força)", async () => {
  const c = cenario();
  const v = novoVaultDeTeste();
  try {
    const f = path.join(v.missoes, "m1.md");
    fs.writeFileSync(f, notaMissao());
    let t = AGORA14;
    const g = novo(c, { agora: () => t, vault: () => v.vault, missaoDaSessao: (sid) => (sid === "S1" ? "m1" : null), missaoDesde: () => 0 });
    await g.iniciar();
    g.registrar(stop(c));
    await g.esperar();
    assert.match(fs.readFileSync(f, "utf8"), /^tokens_total: 180$/m);
    // 10 s depois, mais uso: ainda dentro do minuto, não grava
    fs.appendFileSync(
      c.lider,
      '{"type":"assistant","timestamp":"2026-10-14T15:07:00.000Z","message":{"id":"msg_E","usage":{"input_tokens":4,"output_tokens":4,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}\n',
    );
    t += 10_000;
    g.registrar(stop(c));
    await g.esperar();
    assert.match(fs.readFileSync(f, "utf8"), /^tokens_total: 180$/m);
    // fim da sessão: grava na hora
    g.registrar({ hook_event_name: "SessionEnd", session_id: "S1", transcript_path: c.lider });
    await g.esperar();
    assert.match(fs.readFileSync(f, "utf8"), /^tokens_total: 188$/m);
    g.parar();
    await g.esperar();
  } finally {
    await c.fim();
    v.limpar();
  }
});

// ---------------------------------------------------------------- correções da revisão da Etapa 7

const linhaUso = (id: string, ts: string, tokens: number) =>
  `{"type":"assistant","timestamp":"${ts}","message":{"id":"${id}","usage":{"input_tokens":${tokens},"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}\n`;

test("caminhoPermitido: UNC, prefixo de dispositivo e de rede são recusados sem tocar no disco; ..x.jsonl dentro da pasta vale", async () => {
  const c = cenario();
  try {
    for (const ruim of [
      String.raw`\\servidor\share\x.jsonl`,
      "//servidor/share/x.jsonl",
      String.raw`\\?\C:\x\y.jsonl`,
      String.raw`\\.\C:\x\y.jsonl`,
      String.raw`\\?\UNC\h\s\y.jsonl`,
    ]) {
      assert.equal(await caminhoPermitido(ruim, c.projetos), null, ruim);
    }
    // fora da pasta por texto (o arquivo nem precisa existir)
    assert.equal(await caminhoPermitido(path.join(c.base, "outro", "x.jsonl"), c.projetos), null);
    const estranho = path.join(c.projetos, "proj-x", "..x.jsonl");
    fs.writeFileSync(estranho, "");
    assert.ok(await caminhoPermitido(estranho, c.projetos));
  } finally {
    await c.fim();
  }
});

test("registro com 50 MB ou mais: lê só o final (uma linha cortada ao meio é jogada fora) e avisa uma vez", async () => {
  const c = cenario();
  const avisos: string[] = [];
  const original = console.warn;
  console.warn = (...a: unknown[]) => void avisos.push(a.join(" "));
  try {
    const grande = path.join(c.projetos, "proj-x", "grande.jsonl");
    const enchimento = Buffer.from("x".repeat(1023) + "\n");
    const fd = fs.openSync(grande, "w");
    fs.writeSync(fd, linhaUso("antigo", "2026-10-14T15:00:00.000Z", 1000));
    for (let i = 0; i < 51 * 1024; i++) fs.writeSync(fd, enchimento);
    fs.writeSync(fd, linhaUso("novo", "2026-10-14T15:30:00.000Z", 7));
    fs.closeSync(fd);
    const g = novo(c);
    await g.iniciar();
    g.registrar({ hook_event_name: "Stop", session_id: "S1", transcript_path: grande });
    await g.esperar();
    assert.deepEqual(g.getHoje()?.total, { tokens: 7, cacheLeitura: 0 }); // o "antigo" fica de fora
    fs.appendFileSync(grande, linhaUso("novo2", "2026-10-14T15:31:00.000Z", 3));
    g.registrar({ hook_event_name: "SessionEnd", session_id: "S1", transcript_path: grande });
    await g.esperar();
    assert.deepEqual(g.getHoje()?.total, { tokens: 10, cacheLeitura: 0 });
    assert.equal(avisos.filter((a) => a.includes("50 MB")).length, 1);
    g.parar();
    await g.esperar();
  } finally {
    console.warn = original;
    await c.fim();
  }
});

test("descarte por último uso: arquivo ativo e antigo não é recontado; mapa reler tem teto", async () => {
  const c = cenario();
  try {
    const pasta = path.join(c.projetos, "proj-x");
    const ativo = path.join(pasta, "ativo.jsonl");
    fs.writeFileSync(ativo, linhaUso("a1", "2026-10-14T15:00:00.000Z", 5));
    const g = novo(c);
    await g.iniciar();
    const ler = async (f: string, sid: string) => {
      g.registrar({ hook_event_name: "SessionEnd", session_id: sid, transcript_path: f });
      await g.esperar();
    };
    await ler(ativo, "A");
    for (let i = 0; i < 350; i++) {
      const f = path.join(pasta, `f${i}.jsonl`);
      fs.writeFileSync(f, linhaUso(`m${i}`, "2026-10-14T15:00:00.000Z", 1));
      await ler(f, `S${i}`);
      if (i % 100 === 99) await ler(ativo, "A"); // continua em uso
    }
    assert.deepEqual(g.getHoje()?.total, { tokens: 5 + 350, cacheLeitura: 0 });
    // o antigo foi descartado? não: foi usado há pouco, então a releitura não recomeça do zero
    await ler(ativo, "A");
    assert.deepEqual(g.getHoje()?.total, { tokens: 5 + 350, cacheLeitura: 0 });
    // mapa reler: Stops de muitas sessões não crescem sem limite
    for (let i = 0; i < 400; i++) g.registrar({ hook_event_name: "Stop", session_id: `R${i}`, transcript_path: ativo });
    assert.ok((g as unknown as { reler: Map<string, unknown> }).reler.size <= 200);
    g.parar();
    await g.esperar();
  } finally {
    await c.fim();
  }
});

test("missão: só a pedida pela própria sessão recebe tokens, e só o que veio depois do pedido", async () => {
  const c = cenario();
  const v = novoVaultDeTeste();
  try {
    const f = path.join(v.missoes, "m1.md");
    fs.writeFileSync(f, notaMissao());
    const pasta = path.join(c.projetos, "proj-x");
    const reg = path.join(pasta, "pedido.jsonl");
    fs.writeFileSync(reg, linhaUso("antes", "2026-10-14T15:00:00.000Z", 1000) + linhaUso("depois", "2026-10-14T15:20:00.000Z", 20));
    const desde = Date.parse("2026-10-14T15:10:00.000Z");
    // sem pedido da sessão: nada vai para a nota
    let pedida: string | null = null;
    const g = novo(c, { vault: () => v.vault, missaoDaSessao: () => pedida, missaoDesde: () => desde, notaIntervaloMs: 0 });
    await g.iniciar();
    g.registrar({ hook_event_name: "SessionEnd", session_id: "S1", transcript_path: reg });
    await g.esperar();
    assert.doesNotMatch(fs.readFileSync(f, "utf8"), /tokens_total/);
    // com pedido, em arquivo novo: o histórico anterior ao pedido não entra
    const reg2 = path.join(pasta, "pedido2.jsonl");
    fs.writeFileSync(reg2, linhaUso("antes2", "2026-10-14T15:00:00.000Z", 1000) + linhaUso("depois2", "2026-10-14T15:20:00.000Z", 20));
    pedida = "m1";
    g.registrar({ hook_event_name: "SessionEnd", session_id: "S1", transcript_path: reg2 });
    await g.esperar();
    assert.match(fs.readFileSync(f, "utf8"), /^tokens_total: 20$/m);
    g.parar();
    await g.esperar();
  } finally {
    await c.fim();
    v.limpar();
  }
});

test("missão sem horário do pedido: a primeira leitura do arquivo não conta, só o incremento depois dela", async () => {
  const c = cenario();
  const v = novoVaultDeTeste();
  try {
    const f = path.join(v.missoes, "m1.md");
    fs.writeFileSync(f, notaMissao());
    const reg = path.join(c.projetos, "proj-x", "antigo.jsonl");
    fs.writeFileSync(reg, linhaUso("h1", "2026-10-14T15:00:00.000Z", 500));
    const g = novo(c, { vault: () => v.vault, missaoDaSessao: () => "m1", notaIntervaloMs: 0 });
    await g.iniciar();
    g.registrar({ hook_event_name: "SessionEnd", session_id: "S1", transcript_path: reg });
    await g.esperar();
    assert.doesNotMatch(fs.readFileSync(f, "utf8"), /tokens_total/);
    assert.deepEqual(g.getHoje()?.total, { tokens: 500, cacheLeitura: 0 }); // o painel do dia continua certo
    fs.appendFileSync(reg, linhaUso("h2", "2026-10-14T15:40:00.000Z", 9));
    g.registrar({ hook_event_name: "SessionEnd", session_id: "S1", transcript_path: reg });
    await g.esperar();
    assert.match(fs.readFileSync(f, "utf8"), /^tokens_total: 9$/m);
    g.parar();
    await g.esperar();
  } finally {
    await c.fim();
    v.limpar();
  }
});
