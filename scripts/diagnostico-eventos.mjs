#!/usr/bin/env node
// Diagnóstico dos eventos gravados (data/eventos/AAAA-MM-DD.jsonl, gerado com AGPOCKET_GRAVAR=1).
// Uso: npm run diagnostico [-- arquivo.jsonl]   (sem argumento, usa o .jsonl mais recente)
//
// Imprime só metadados (ids, nomes de evento, cwd, horas). Nunca imprime prompt, comando nem
// resposta de ferramenta.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PASTA = path.join(ROOT, "data", "eventos");

/** campos de baixa cardinalidade que ajudam a distinguir `claude -p` / outros clientes */
const CAMPOS_META = ["permission_mode", "source", "reason", "entrypoint"];
const FIM_TOOL = new Set(["PostToolUse", "PostToolUseFailure"]);

/** Lê um .jsonl; linhas inválidas são contadas e ignoradas. */
export function lerLinhas(texto) {
  const linhas = [];
  let invalidas = 0;
  for (const bruta of texto.split(/\r?\n/)) {
    if (!bruta.trim()) continue;
    try {
      linhas.push(JSON.parse(bruta));
    } catch {
      invalidas++;
    }
  }
  return { linhas, invalidas };
}

const ehObjeto = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Analisa as linhas gravadas e devolve o resultado estruturado (sem texto de prompts). */
export function analisar(linhas) {
  const sessoes = new Map();
  const toolsAbertas = new Map(); // tool_use_id -> info
  const chaves = new Map(); // chave -> nº de eventos
  const marcadores = []; // { chegada, antes, depois }
  let totalEventos = 0;
  let semCorpo = 0;
  let indiceEvento = 0;

  for (const l of linhas) {
    if (!ehObjeto(l)) continue;
    if (l.marcador === "servidor_iniciou") {
      marcadores.push({ chegada: l.chegada, antes: totalEventos, depois: 0, sessoesAntes: new Set() });
      continue;
    }
    const ev = l.evento;
    if (!ehObjeto(ev)) {
      semCorpo++;
      continue;
    }
    totalEventos++;
    const idx = indiceEvento++;
    const t = typeof l.chegada === "number" ? l.chegada : 0;
    for (const k of Object.keys(ev)) chaves.set(k, (chaves.get(k) ?? 0) + 1);
    for (const m of marcadores) m.depois++;

    const nome = String(ev.hook_event_name ?? "?");
    const sid = String(ev.session_id ?? "?");
    let s = sessoes.get(sid);
    if (!s) {
      s = {
        id: sid,
        cwd: null,
        primeiro: { t, nome },
        ultimo: { t, nome },
        total: 0,
        temSessionEnd: false,
        temPrompt: false,
        meta: {},
        agentes: new Map(),
        marcadoresVistos: new Set(),
      };
      sessoes.set(sid, s);
    }
    s.total++;
    s.ultimo = { t, nome };
    if (typeof ev.cwd === "string" && !s.cwd) s.cwd = ev.cwd;
    if (nome === "SessionEnd") s.temSessionEnd = true;
    if (nome === "UserPromptSubmit") s.temPrompt = true;
    for (const c of CAMPOS_META) {
      if (typeof ev[c] === "string") (s.meta[c] ??= new Set()).add(ev[c]);
    }
    marcadores.forEach((m, i) => s.marcadoresVistos.add(i));

    const aid = typeof ev.agent_id === "string" ? ev.agent_id : null;
    if (aid) {
      let a = s.agentes.get(aid);
      if (!a) {
        a = {
          id: aid,
          tipo: null,
          primeiro: { t, nome },
          ultimo: { t, nome },
          total: 0,
          temStart: false,
          temStop: false,
          nasceuSemStart: nome !== "SubagentStart",
          depoisDoStop: 0,
        };
        s.agentes.set(aid, a);
      }
      a.total++;
      a.ultimo = { t, nome };
      if (typeof ev.agent_type === "string") a.tipo = ev.agent_type;
      if (nome === "SubagentStart") a.temStart = true;
      if (nome === "SubagentStop") {
        a.temStop = true;
      } else if (a.temStop) {
        a.depoisDoStop++;
      }
    }

    const tuid = typeof ev.tool_use_id === "string" ? ev.tool_use_id : null;
    if (tuid) {
      if (nome === "PreToolUse") {
        toolsAbertas.set(tuid, { tuid, tool: String(ev.tool_name ?? "?"), sessao: sid, agente: aid, t, idx });
      } else if (FIM_TOOL.has(nome)) {
        toolsAbertas.delete(tuid);
      }
    }
  }

  const lista = [...sessoes.values()].map((s) => ({
    ...s,
    meta: Object.fromEntries(Object.entries(s.meta).map(([k, v]) => [k, [...v].sort()])),
    agentes: [...s.agentes.values()],
    duracaoMs: s.ultimo.t - s.primeiro.t,
    // sem UserPromptSubmit = ninguém digitou nesta sessão (claude -p, tarefa agendada, sessão antiga)
    suspeitaNaoInterativa: !s.temPrompt,
  }));

  return {
    totalEventos,
    semCorpo,
    sessoes: lista,
    toolsSemPost: [...toolsAbertas.values()],
    chaves: [...chaves.entries()].sort((a, b) => b[1] - a[1]),
    marcadores: marcadores.map(({ chegada, antes, depois }) => ({ chegada, antes, depois })),
  };
}

const hora = (t) => (t ? new Date(t).toLocaleString("pt-BR", { hour12: false }) : "?");
const curto = (id) => (id.length > 12 ? id.slice(0, 8) + "…" : id);

/** Texto do relatório (só metadados). */
export function formatar(r, invalidas = 0) {
  const o = [];
  o.push(`Eventos: ${r.totalEventos} | sessões: ${r.sessoes.length} | linhas inválidas: ${invalidas} | sem corpo: ${r.semCorpo}`);

  o.push("", "== Marcadores servidor_iniciou ==");
  if (!r.marcadores.length) o.push("(nenhum)");
  for (const m of r.marcadores) o.push(`${hora(m.chegada)}: ${m.antes} eventos antes, ${m.depois} depois`);

  o.push("", "== Sessões ==");
  for (const s of r.sessoes) {
    const meta = Object.entries(s.meta).map(([k, v]) => `${k}=${v.join("/")}`).join(" ");
    o.push(
      `[${curto(s.id)}] cwd=${s.cwd ?? "?"} | ${hora(s.primeiro.t)} ${s.primeiro.nome} -> ${hora(s.ultimo.t)} ${s.ultimo.nome}` +
        ` | ${s.total} eventos | SessionEnd=${s.temSessionEnd ? "sim" : "NAO"} | UserPromptSubmit=${s.temPrompt ? "sim" : "NAO"}` +
        (s.suspeitaNaoInterativa ? " | SUSPEITA nao interativa (sem prompt)" : "") +
        (meta ? ` | ${meta}` : ""),
    );
    for (const a of s.agentes) {
      o.push(
        `    agente ${curto(a.id)} tipo=${a.tipo ?? "?"} | ${hora(a.primeiro.t)} ${a.primeiro.nome} -> ${hora(a.ultimo.t)} ${a.ultimo.nome}` +
          ` | ${a.total} ev | Start=${a.temStart ? "sim" : "NAO"} Stop=${a.temStop ? "sim" : "NAO"}` +
          ` | apos Stop: ${a.depoisDoStop}` +
          (a.nasceuSemStart ? " | NASCEU SEM SubagentStart" : ""),
      );
    }
  }

  o.push("", "== PreToolUse sem PostToolUse/PostToolUseFailure ==");
  if (!r.toolsSemPost.length) o.push("(nenhum)");
  for (const x of r.toolsSemPost) {
    o.push(`${curto(x.tuid)} tool=${x.tool} sessao=${curto(x.sessao)} agente=${x.agente ? curto(x.agente) : "lider"} ${hora(x.t)}`);
  }

  o.push("", "== Chaves vistas nos eventos (nº de eventos) ==");
  o.push(r.chaves.map(([k, n]) => `${k}(${n})`).join(", ") || "(nenhuma)");
  return o.join("\n");
}

function arquivoMaisRecente() {
  if (!fs.existsSync(PASTA)) return null;
  const nomes = fs.readdirSync(PASTA).filter((n) => n.endsWith(".jsonl")).sort();
  return nomes.length ? path.join(PASTA, nomes[nomes.length - 1]) : null;
}

function main() {
  const arg = process.argv[2];
  const arquivo = arg ? path.resolve(arg) : arquivoMaisRecente();
  if (!arquivo || !fs.existsSync(arquivo)) {
    console.error(
      "Nenhum arquivo de eventos. Suba o servidor com AGPOCKET_GRAVAR=1 (veja o README) e rode de novo, ou passe o caminho do .jsonl.",
    );
    process.exit(1);
  }
  const { linhas, invalidas } = lerLinhas(fs.readFileSync(arquivo, "utf8"));
  console.log(`Arquivo: ${arquivo}`);
  console.log(formatar(analisar(linhas), invalidas));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
