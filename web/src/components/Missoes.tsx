// Seção "Missões" do painel: as missões do vault (20-Missoes), com andamento e resumo ao clicar.

import { useState } from "react";
import type { Missao, MissoesInfo } from "../../../shared/types";
import { SEGMENTOS, segmentosCheios } from "../progresso";
import { STATUS_MISSAO, ehAtual, textoReuniao, textoTarefas, vazioDe } from "../missoesLogic";
import { usePreferencia } from "../usePreferencia";

export function Missoes({ info }: { info: MissoesInfo | null }) {
  const [aberto, alternar] = usePreferencia("agpocket.painel.missoes", true);
  const [aberta, setAberta] = useState<string | null>(null);
  const missoes = info?.missoes ?? [];
  const vazio = vazioDe(info);

  return (
    <section className="secao">
      <h2>
        <button className="secao-toggle" aria-expanded={aberto} aria-controls="secao-missoes" onClick={alternar}>
          <span className="secao-seta" aria-hidden="true" />
          Missões <span className="count">· {missoes.length}</span>
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
        <ul className="missoes">
          {missoes.map((m) => (
            <MissaoItem
              key={m.id}
              missao={m}
              atual={ehAtual(info, m)}
              aberta={aberta === m.id}
              onClick={() => setAberta(aberta === m.id ? null : m.id)}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function MissaoItem({ missao: m, atual, aberta, onClick }: { missao: Missao; atual: boolean; aberta: boolean; onClick: () => void }) {
  const st = STATUS_MISSAO[m.status];
  const reuniao = textoReuniao(m);
  const cheios = segmentosCheios(m.tarefas.feitas, m.tarefas.total);
  const resumoId = `missao-resumo-${m.id}`;
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
