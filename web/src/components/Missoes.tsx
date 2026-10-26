// Seção "Missões" do painel: as missões do vault (20-Missoes), com andamento e resumo ao clicar.
// Duas abas: abertas (a fazer + em andamento) e concluídas; a aba escolhida fica lembrada.

import { useRef, useState, type KeyboardEvent } from "react";
import type { Missao, MissoesInfo } from "../../../shared/types";
import { SEGMENTOS, segmentosCheios } from "../progresso";
import {
  ABAS_MISSOES,
  STATUS_MISSAO,
  abaPelaTecla,
  abaValida,
  ehAtual,
  mostraAbas,
  separarMissoes,
  textoDataMissao,
  textoLimiteConcluidas,
  textoReuniao,
  textoTarefas,
  totaisDe,
  vazioDaAba,
  vazioDe,
  type AbaMissoes,
} from "../missoesLogic";
import { usePreferencia, usePreferenciaTexto } from "../usePreferencia";

const ROTULO_ABA: Record<AbaMissoes, string> = { abertas: "Abertas", concluidas: "Concluídas" };

export function Missoes({ info }: { info: MissoesInfo | null }) {
  const [aberto, alternar] = usePreferencia("studio.painel.missoes", true);
  const [abaSalva, gravarAba] = usePreferenciaTexto("studio.painel.missoes.aba", "abertas");
  const aba = abaValida(abaSalva);
  const [aberta, setAberta] = useState<string | null>(null);
  const abasRef = useRef<Partial<Record<AbaMissoes, HTMLButtonElement | null>>>({});
  const separadas = separarMissoes(info?.missoes ?? []);
  const totais = totaisDe(info, separadas);
  const vazio = vazioDe(info);
  const lista = aba === "abertas" ? separadas.abertas : separadas.concluidas;
  const vazioAba = vazioDaAba(aba, separadas);
  const limite = textoLimiteConcluidas(lista.length, totais[aba]);

  const teclaNasAbas = (e: KeyboardEvent<HTMLDivElement>) => {
    const nova = abaPelaTecla(aba, e.key);
    if (!nova) return;
    e.preventDefault();
    gravarAba(nova);
    abasRef.current[nova]?.focus();
  };

  return (
    <section className="secao">
      <h2>
        <button className="secao-toggle" aria-expanded={aberto} aria-controls="secao-missoes" onClick={alternar}>
          <span className="secao-seta" aria-hidden="true" />
          Missões <span className="count"><span aria-hidden="true">· </span>{totais.abertas}</span>
        </button>
      </h2>
      <div id="secao-missoes" hidden={!aberto}>
        {info === null && <p className="muted">Carregando...</p>}
        {vazio === "sem-vault" && (
          <p className="muted">
            O vault não está configurado: rode <code>npm run setup</code>
          </p>
        )}
        {vazio === "sem-missao" && (
          <p className="muted">
            Nenhuma missão ainda. Elas nascem pelo <code>/reuniao</code>.
          </p>
        )}
        {mostraAbas(info) && (
          <>
            <div className="missoes-abas" role="tablist" aria-label="Missões" onKeyDown={teclaNasAbas}>
              {ABAS_MISSOES.map((a) => (
                <button
                  key={a}
                  ref={(el) => {
                    abasRef.current[a] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`missoes-aba-${a}`}
                  className="missoes-aba"
                  aria-selected={aba === a}
                  aria-controls={aba === a ? "missoes-painel" : undefined}
                  tabIndex={aba === a ? 0 : -1}
                  onClick={() => gravarAba(a)}
                >
                  <span className="missoes-aba-rotulo">{ROTULO_ABA[a]}</span>{" "}
                  <span className="missoes-aba-num">
                    <span aria-hidden="true"> · </span>
                    {totais[a]}
                  </span>
                </button>
              ))}
            </div>
            <div role="tabpanel" id="missoes-painel" aria-labelledby={`missoes-aba-${aba}`} tabIndex={0}>
              {vazioAba && <p className="muted">{vazioAba}</p>}
              {lista.length > 0 && (
                <ul className="missoes">
                  {lista.map((m, i) => (
                    <MissaoItem
                      key={m.id}
                      aba={aba}
                      indice={i}
                      missao={m}
                      atual={aba === "abertas" && ehAtual(info, m)}
                      aberta={aberta === m.id}
                      onClick={() => setAberta(aberta === m.id ? null : m.id)}
                    />
                  ))}
                </ul>
              )}
              {limite && <p className="muted missoes-limite">{limite}</p>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function MissaoItem({
  missao: m,
  aba,
  indice,
  atual,
  aberta,
  onClick,
}: {
  missao: Missao;
  aba: AbaMissoes;
  indice: number;
  atual: boolean;
  aberta: boolean;
  onClick: () => void;
}) {
  const st = STATUS_MISSAO[m.status];
  const reuniao = textoReuniao(m);
  const data = aba === "concluidas" ? textoDataMissao(m) : null;
  const cheios = segmentosCheios(m.tarefas.feitas, m.tarefas.total);
  // o nome do arquivo pode ter espaço e acento: o id usa a aba e o índice
  const resumoId = `missao-resumo-${aba}-${indice}`;
  return (
    <li>
      <button
        className={`missao-row ${aberta ? "selected" : ""} ${atual ? "atual" : ""}`}
        aria-expanded={aberta}
        aria-controls={resumoId}
        onClick={onClick}
      >
        <span className="missao-topo">
          <span className="missao-nome">{m.nome}</span>
          {atual && <span className="missao-agora">agora</span>}
        </span>
        <span className={`missao-pill missao-${st.classe}`}>
          <span aria-hidden="true">{st.icone}</span> {st.rotulo}
        </span>
        {m.tarefas.total > 0 && (
          <span
            className="progresso-barra missao-barra"
            role="progressbar"
            aria-label="Tarefas da missão"
            aria-valuemin={0}
            aria-valuemax={m.tarefas.total}
            aria-valuenow={m.tarefas.feitas}
            aria-valuetext={textoTarefas(m.tarefas.feitas, m.tarefas.total)}
          >
            {Array.from({ length: SEGMENTOS }, (_, i) => (
              <i key={i} className={i < cheios ? "cheio" : undefined} />
            ))}
          </span>
        )}
        {data && <span className="missao-data">Nota de {data}</span>}
        {reuniao && <span className="missao-reuniao">{reuniao}</span>}
      </button>
      <div id={resumoId} className="missao-resumo" hidden={!aberta}>
        {m.objetivo && (
          <>
            <h3>Objetivo</h3>
            <p>{m.objetivo}</p>
          </>
        )}
        {m.itens.length > 0 ? (
          <>
            <h3>Tarefas</h3>
            <ul>
              {m.itens.map((it, i) => (
                <li key={i} className={it.feita ? "feita" : undefined}>
                  <span aria-hidden="true">{it.feita ? "✓" : "○"}</span>
                  <span className="sr-only">{it.feita ? "feita: " : "a fazer: "}</span> {it.texto}
                </li>
              ))}
            </ul>
            {m.tarefas.total > m.itens.length && <p className="muted">+{m.tarefas.total - m.itens.length} tarefas</p>}
          </>
        ) : (
          !m.objetivo && <p className="muted">Sem detalhes na nota.</p>
        )}
      </div>
    </li>
  );
}
