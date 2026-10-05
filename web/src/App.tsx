import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, AgentStatus, FeedItem } from "../../shared/types";
import { OfficeCanvas, type OfficeHandle } from "./OfficeCanvas";
import { Cracha } from "./components/Cracha";
import { Progresso } from "./components/Progresso";
import { Vestiario } from "./components/Vestiario";
import { agzinhoOf } from "./office/engine";
import { SpriteGallery } from "./SpriteGallery";
import { GALLERY_ENABLED } from "./office/gallery";
import { roleColor, theme } from "./theme";
import { useOffice } from "./useOffice";

const STATUS_LABEL: Record<AgentStatus, string> = {
  chegando: "chegando",
  trabalhando: "trabalhando",
  pensando: "pensando",
  esperando: "te esperando",
  ocioso: "de boa",
  saindo: "saindo",
};

const KIND_ICON: Record<FeedItem["kind"], string> = {
  info: "•",
  tool: "›",
  spawn: "+",
  done: "✓",
  alert: "!",
  message: "»",
};

export default function App() {
  const officeRef = useRef<OfficeHandle>(null);
  const { agents, feed, roster, progress, conn } = useOffice((a, b, t) => officeRef.current?.chat(a, b, t));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** agente clicado no canvas cujo crachá deve rolar pra vista (layout empilhado); o crachá consome */
  const [revelarId, setRevelarId] = useState<string | null>(null);
  const revelado = useCallback(() => setRevelarId(null), []);
  const restLabel = useCallback((id: string) => officeRef.current?.restLabel(id) ?? null, []);
  const closeCracha = useCallback(() => setSelectedId(null), []);
  /** key do AGzinho aberto no vestiário (null = fechado) */
  const [vestiarioPara, setVestiarioPara] = useState<string | null>(null);
  const closeVestiario = useCallback(() => setVestiarioPara(null), []);
  const selectFromCanvas = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setRevelarId(id);
  }, []);

  const list = useMemo(() => Object.values(agents), [agents]);
  const sorted = useMemo(
    () =>
      [...list].sort((a, b) => {
        const lead = Number(!!a.parentId) - Number(!!b.parentId);
        return lead !== 0 ? lead : a.startedAt - b.startedAt;
      }),
    [list],
  );
  const selected = selectedId ? agents[selectedId] : undefined;
  // quem saiu do escritório deixa de estar selecionado (o feed não fica preso nele e, se o mesmo id
  // voltar, o crachá não reabre sozinho)
  useEffect(() => {
    if (selectedId && !agents[selectedId]) setSelectedId(null);
  }, [agents, selectedId]);
  const waiting = list.filter((a) => a.status === "esperando").length;

  const call = async (path: string) => {
    setBusy(true);
    try {
      await fetch(path, { method: "POST" });
    } finally {
      setTimeout(() => setBusy(false), 600);
    }
  };

  return (
    <div className="app">
      <main className="stage">
        {GALLERY_ENABLED ? (
          <SpriteGallery roster={roster} />
        ) : (
          <OfficeCanvas ref={officeRef} agents={list} roster={roster} progress={progress} selectedId={selectedId} onSelect={selectFromCanvas} />
        )}
        {!GALLERY_ENABLED && list.length === 0 && conn === "online" && (
          <div className="empty">
            <p className="empty-title">Escritório vazio</p>
            <p>Abra o Claude Code em qualquer projeto (com os hooks instalados) e o time aparece aqui.</p>
            <button className="btn primary" disabled={busy} onClick={() => call("/api/demo")}>
              Ver uma simulação
            </button>
          </div>
        )}
        {conn !== "online" && (
          <div className="empty">
            <p className="empty-title">{conn === "conectando" ? "Conectando..." : "Servidor fora do ar"}</p>
            <p>
              Rode <code>npm run dev</code> (ou <code>npm start</code>) na pasta do projeto.
            </p>
          </div>
        )}
      </main>

      <aside className="panel">
        <header className="panel-head">
          <div className="brand">
            <img className="brand-mark" src="/favicon-agpocket.svg" alt="" width={36} height={36} />
            <div>
              <h1>{theme.officeName}</h1>
              <p className="sub">{theme.subtitle}</p>
            </div>
          </div>
          <span className={`conn conn-${conn}`} title={`Servidor ${conn}`}>
            <i /> {conn}
          </span>
        </header>

        <Progresso progress={progress} />

        {waiting > 0 && (
          <div className="alert">
            <strong>{waiting === 1 ? "1 agente" : `${waiting} agentes`} te esperando</strong>
            <span>Volta no terminal do Claude Code pra responder.</span>
          </div>
        )}

        <div className="actions">
          <button className="btn" disabled={busy || conn !== "online"} onClick={() => call("/api/demo")}>
            ▶ Rodar simulação
          </button>
          <button className="btn ghost" disabled={busy || conn !== "online"} onClick={() => call("/api/reset")}>
            Limpar
          </button>
          <button
            className="btn ghost btn-vestiario"
            aria-haspopup="dialog"
            disabled={!roster}
            onClick={() => roster && setVestiarioPara((selected && agzinhoOf(selected, roster)?.key) || roster.agzinhos[0].key)}
          >
            Vestiário
          </button>
        </div>

        <section>
          <h2>
            Time <span className="count">{list.length}</span>
          </h2>
          {sorted.length === 0 && <p className="muted">Ninguém no escritório agora.</p>}
          <ul className="team">
            {sorted.map((a) => (
              <AgentRow key={a.id} agent={a} selected={a.id === selectedId} onClick={() => setSelectedId(a.id === selectedId ? null : a.id)} />
            ))}
          </ul>
        </section>

        {selected && (
          <Cracha
            agent={selected}
            roster={roster}
            statusLabel={STATUS_LABEL[selected.status]}
            restLabel={restLabel}
            onClose={closeCracha}
            onPersonalizar={setVestiarioPara}
            revelar={revelarId === selected.id}
            onRevelado={revelado}
          />
        )}

        <section className="feed-section">
          <h2>O que tá rolando</h2>
          <ol className="feed">
            {[...feed]
              .filter((f) => !selectedId || f.agentId === selectedId)
              .reverse()
              .slice(0, 80)
              .map((f) => (
                <li key={f.id} className={`feed-item kind-${f.kind}`}>
                  <time>{clock(f.at)}</time>
                  <span className="icon">{KIND_ICON[f.kind]}</span>
                  <span>
                    <b style={{ color: roleColor(f.role) }}>{f.agentName}</b> {f.text}
                  </span>
                </li>
              ))}
          </ol>
        </section>
      </aside>

      {vestiarioPara && roster && <Vestiario roster={roster} inicial={vestiarioPara} onClose={closeVestiario} />}
    </div>
  );
}

function AgentRow({ agent, selected, onClick }: { agent: Agent; selected: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        className={`agent-row ${selected ? "selected" : ""} st-${agent.status}`}
        data-agent-id={agent.id}
        aria-pressed={selected}
        onClick={onClick}
      >
        <span className="swatch" style={{ background: roleColor(agent.role) }} />
        <span className="agent-main">
          <span className="agent-name">
            {agent.name}
            {!agent.parentId && <span className="project"> · {agent.project}</span>}
          </span>
          <span className="agent-activity">{agent.activity}</span>
        </span>
        <span className={`pill pill-${agent.status}`}>{STATUS_LABEL[agent.status]}</span>
      </button>
    </li>
  );
}

function clock(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
