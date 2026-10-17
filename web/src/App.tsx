import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, AgentStatus, FeedItem, Roster } from "../../shared/types";
import { OfficeCanvas, type OfficeHandle } from "./OfficeCanvas";
import { Cracha } from "./components/Cracha";
import { IconeStatus } from "./components/IconePixel";
import { MiniRetrato } from "./components/MiniRetrato";
import { Missoes } from "./components/Missoes";
import { Progresso } from "./components/Progresso";
import { Vestiario } from "./components/Vestiario";
import { agzinhoOf } from "./office/engine";
import { SpriteGallery } from "./SpriteGallery";
import { GALLERY_ENABLED } from "./office/gallery";
import { roleColor, theme } from "./theme";
import { useOffice } from "./useOffice";
import { destravarSom, eventoDoLote, instalarGestos, observarSom, setAtivo as setSomAtivo, somDaTransicao, somFuncionando, tocar, tocarTecladoLimitado, INTERVALO_TECLADO_MS, type EstadoSom } from "./sound";
import { usePreferencia, usePreferenciaTexto } from "./usePreferencia";
import { TODAS, esperandoDe, filtrarPorProjeto, progressoDoFiltro, projetoEfetivo, projetosDe, textoEspera } from "./projetoLogic";
import { nomeCurto } from "../../shared/frases";
import { ehVisitante } from "../../shared/visitante";
import { textoAtaNova } from "./missoesLogic";
import { agruparFeed, destaqueDe, fraseDaLinha, iconeDe, type LinhaFeed } from "./feedLogic";

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
  const { agents, feed, roster, progress, missoes, reuniao, conn } = useOffice((a, b, t) => officeRef.current?.chat(a, b, t));
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

  // sons: o valor da preferência vai pro módulo sound.ts; o botão reflete o estado real do AudioContext
  const [somLigado, alternarSom] = usePreferencia("agpocket.painel.som", true);
  const [somRodando, setSomRodando] = useState(false);
  useEffect(() => setSomAtivo(somLigado), [somLigado]);
  useEffect(() => instalarGestos(), []);
  useEffect(() => {
    const atualizar = () => setSomRodando(somFuncionando());
    atualizar();
    return observarSom(atualizar);
  }, []);
  const aoClicarSom = async () => {
    // ligado mas bloqueado: o clique é o gesto que libera o áudio; só desliga se continuar bloqueado
    if (somLigado && !somRodando && (await destravarSom())) return;
    alternarSom();
  };
  // "!" e "ding": compara com o estado anterior de TODOS os agentes (sem filtro de projeto). Quem não
  // estava lá (snapshot inicial, reconexão) não toca; o mapa é refeito a cada mudança.
  const somAnterior = useRef(new Map<string, EstadoSom>());
  // caiu a conexão: o que mudou durante a queda não toca ao voltar
  useEffect(() => {
    if (conn !== "online") somAnterior.current = new Map();
  }, [conn]);
  useEffect(() => {
    const atual = new Map<string, EstadoSom>();
    const eventos: ReturnType<typeof somDaTransicao>[] = [];
    for (const a of Object.values(agents)) {
      const novo = { status: a.status, tasksDone: a.tasksDone };
      atual.set(a.id, novo);
      eventos.push(somDaTransicao(somAnterior.current.get(a.id), novo));
    }
    somAnterior.current = atual;
    const evento = eventoDoLote(eventos);
    if (evento) tocar(evento);
  }, [agents]);
  // teclado: um clique agregado por vez enquanto alguém digita; aba oculta fica quieta
  useEffect(() => {
    if (!somLigado) return;
    const id = window.setInterval(() => {
      if (!document.hidden && officeRef.current?.alguemDigitando()) tocarTecladoLimitado();
    }, INTERVALO_TECLADO_MS);
    return () => window.clearInterval(id);
  }, [somLigado]);

  const [tecnico, alternarTecnico] = usePreferencia("agpocket.painel.tecnico", false);
  // balão, crachá e lista do time falam a atividade sem jargão; a técnica só com "Ver detalhes técnicos"
  const list = useMemo(
    () => Object.values(agents).map((a) => (tecnico || !a.activitySimples ? a : { ...a, activity: a.activitySimples })),
    [agents, tecnico],
  );
  // filtro por projeto (vale para o painel, o mapa e o quadro); o salvo que sumiu vira "todas" sem apagar a preferência
  const [projetoSalvo, setProjetoSalvo] = usePreferenciaTexto("agpocket.painel.projeto", TODAS);
  const projetos = useMemo(() => projetosDe(list), [list]);
  const projeto = projetoEfetivo(projetoSalvo, projetos);
  const visiveis = useMemo(() => filtrarPorProjeto(list, projeto), [list, projeto]);
  const progressoVisivel = useMemo(() => progressoDoFiltro(progress, visiveis, projeto), [progress, visiveis, projeto]);
  const sorted = useMemo(
    () =>
      [...visiveis].sort((a, b) => {
        const lead = Number(!!a.parentId) - Number(!!b.parentId);
        return lead !== 0 ? lead : a.startedAt - b.startedAt;
      }),
    [visiveis],
  );
  // visitante (agente de fora do time) tem grupo próprio e não conta no "Time · N"; os que passam de
  // 3 (excedente) não aparecem no mapa nem na lista: só o contador "+N visitantes"
  const time = useMemo(() => sorted.filter((a) => !ehVisitante(a)), [sorted]);
  const visitantes = useMemo(() => sorted.filter((a) => ehVisitante(a)), [sorted]);
  const visitantesNaTela = useMemo(() => visitantes.filter((a) => !a.excedente), [visitantes]);
  const excedentes = visitantes.length - visitantesNaTela.length;
  const selected = selectedId ? visiveis.find((a) => a.id === selectedId) : undefined;
  // quem saiu do escritório deixa de estar selecionado (o feed não fica preso nele e, se o mesmo id
  // voltar, o crachá não reabre sozinho)
  useEffect(() => {
    if (selectedId && (!agents[selectedId] || (projeto !== TODAS && agents[selectedId].project !== projeto))) setSelectedId(null);
  }, [agents, selectedId, projeto]);
  const [timeAberto, alternarTime] = usePreferencia("agpocket.painel.time", true);
  const [visitantesAberto, alternarVisitantes] = usePreferencia("agpocket.painel.visitantes", false);
  const [feedAberto, alternarFeed] = usePreferencia("agpocket.painel.feed", true);
  const feedVisivel = useMemo(() => feed.filter((f) => !selectedId || f.agentId === selectedId), [feed, selectedId]);
  // modo simples: repetições seguidas do mesmo AGzinho viram uma linha só, a mais nova em cima
  const linhasSimples = useMemo(() => agruparFeed(feedVisivel).reverse().slice(0, 80), [feedVisivel]);
  // o aviso "te esperando" olha TODOS os agentes: o filtro de projeto não esconde um pedido seu
  const espera = useMemo(() => esperandoDe(list, projeto), [list, projeto]);

  const avisoAta = textoAtaNova(missoes?.inbox.novas ?? 0);

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
          <OfficeCanvas ref={officeRef} agents={visiveis} roster={roster} progress={progressoVisivel} reuniao={reuniao} missao={missoes?.atual?.nome ?? null} selectedId={selectedId} onSelect={selectFromCanvas} />
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
          <div className="head-status">
            <button
              type="button"
              className={`btn-tecnico btn-som${somLigado ? " ligado" : ""}`}
              aria-pressed={somLigado}
              aria-label="Sons do escritório"
              aria-describedby="som-estado"
              onClick={aoClicarSom}
            >
              {somLigado ? (somRodando ? "Som ligado" : "Som...") : "Som mudo"}
            </button>
            <span id="som-estado" className="sr-only">
              {somLigado && !somRodando ? "Ligado, mas o navegador só libera o áudio depois de um clique na página." : somLigado ? "Ligado." : "Desligado."}
            </span>
            <span className={`conn conn-${conn}`} title={`Servidor ${conn}`}>
              <i /> {conn}
            </span>
          </div>
        </header>

        <Progresso progress={progressoVisivel} />

        {projetos.length > 0 && (
          <label className="filtro-projeto">
            <span>Mostrar:</span>
            <select value={projeto} onChange={(e) => setProjetoSalvo(e.target.value)} translate="no">
              <option value={TODAS}>todas as sessões</option>
              {projetos.map((p) => (
                <option key={p} value={p}>
                  só o projeto {p}
                  {espera.projetos.includes(p) ? " · te esperando" : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        {espera.total > 0 && (
          <div className="alert">
            <strong>{textoEspera(espera)}</strong>
            <span>Volta no terminal do Claude Code pra responder.</span>
          </div>
        )}

        {avisoAta && (
          <div className="aviso-ata" role="status">
            {avisoAta}
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

        <section className="secao">
          <h2>
            <button className="secao-toggle" aria-expanded={timeAberto} aria-controls="secao-time" onClick={alternarTime}>
              <span className="secao-seta" aria-hidden="true" />
              Time <span className="count">· {time.length}</span>
            </button>
          </h2>
          <div id="secao-time" hidden={!timeAberto}>
            {time.length === 0 && <p className="muted">Ninguém no escritório agora.</p>}
            <ul className="team">
              {time.map((a) => (
                <AgentRow
                  key={a.id}
                  agent={a}
                  roster={roster}
                  selected={a.id === selectedId}
                  onClick={() => setSelectedId(a.id === selectedId ? null : a.id)}
                />
              ))}
            </ul>
          </div>
        </section>

        {visitantes.length > 0 && (
          <section className="secao">
            <h2>
              <button className="secao-toggle" aria-expanded={visitantesAberto} aria-controls="secao-visitantes" onClick={alternarVisitantes}>
                <span className="secao-seta" aria-hidden="true" />
                Visitantes <span className="count">({visitantes.length})</span>
              </button>
            </h2>
            <div id="secao-visitantes" hidden={!visitantesAberto}>
              <ul className="team">
                {visitantesNaTela.map((a) => (
                  <AgentRow
                    key={a.id}
                    agent={a}
                    roster={roster}
                    selected={a.id === selectedId}
                    onClick={() => setSelectedId(a.id === selectedId ? null : a.id)}
                  />
                ))}
              </ul>
              {excedentes > 0 && <p className="muted">+{excedentes} {excedentes === 1 ? "visitante" : "visitantes"}</p>}
            </div>
          </section>
        )}

        <Missoes info={missoes} />

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

        <section className={`secao feed-section ${feedAberto ? "" : "fechada"}`}>
          <div className="secao-topo">
            <h2>
              <button className="secao-toggle" aria-expanded={feedAberto} aria-controls="secao-feed" onClick={alternarFeed}>
                <span className="secao-seta" aria-hidden="true" />O que tá rolando
              </button>
            </h2>
            {/* o texto já diz o que o clique faz: sem aria-pressed (leria "Ver frases simples, pressionado") */}
            {feedAberto && (
              <button className={`btn-tecnico ${tecnico ? "ligado" : ""}`} aria-controls="secao-feed" onClick={alternarTecnico}>
                {tecnico ? "Ver frases simples" : "Ver detalhes técnicos"}
              </button>
            )}
          </div>
          <ol id="secao-feed" className={`feed ${tecnico ? "feed-tecnico" : ""}`} hidden={!feedAberto}>
            {tecnico
              ? feedVisivel
                  .slice()
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
                  ))
              : linhasSimples.map((l) => <LinhaSimples key={l.item.id} linha={l} />)}
          </ol>
        </section>
      </aside>

      {vestiarioPara && roster && <Vestiario roster={roster} inicial={vestiarioPara} onClose={closeVestiario} />}
    </div>
  );
}

function AgentRow({ agent, roster, selected, onClick }: { agent: Agent; roster: Roster | null; selected: boolean; onClick: () => void }) {
  const ag = agzinhoOf(agent, roster);
  const cargo = ag?.cargo ?? "Visitante";
  // o mesmo nome curto do feed ("Bia"); o nome completo fica no crachá e no leitor de tela
  const curto = nomeCurto(agent.name, ag?.apelido);
  return (
    <li>
      <button
        className={`agent-row ${selected ? "selected" : ""} st-${agent.status}`}
        data-agent-id={agent.id}
        aria-pressed={selected}
        onClick={onClick}
      >
        <span className="agent-foto" style={{ borderColor: roleColor(agent.role) }}>
          <MiniRetrato agent={agent} roster={roster} />
        </span>
        <span className="agent-main">
          <span className="agent-name">{curto}</span>
          <span className="agent-cargo">{cargo}</span>
          <span className="sr-only">
            {curto === agent.name ? "" : `, ${agent.name}`}, agora: {agent.activity}
            {!agent.parentId && `, projeto ${agent.project}`}
          </span>
        </span>
        <span className={`pill pill-${agent.status}`}>
          {/* ícone junto do texto: o status não depende só da cor */}
          <IconeStatus status={agent.status} /> {STATUS_LABEL[agent.status]}
        </span>
      </button>
    </li>
  );
}

function LinhaSimples({ linha }: { linha: LinhaFeed }) {
  const { item } = linha;
  const frase = fraseDaLinha(linha);
  const destaque = destaqueDe(item.categoria);
  return (
    <li className={`feed-item feed-simples ${destaque ? `dest dest-${destaque}` : ""}`}>
      <time>{clock(item.at)}</time>
      <span className="icon" aria-hidden="true">
        {frase ? iconeDe(item.categoria) : KIND_ICON[item.kind]}
      </span>
      <span>
        <b style={destaque ? undefined : { color: roleColor(item.role) }}>{frase ? (item.quem ?? item.agentName) : item.agentName}</b>{" "}
        {frase ?? item.text}
      </span>
    </li>
  );
}

function clock(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
