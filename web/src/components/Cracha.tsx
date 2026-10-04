// Crachá AG do agente selecionado (no lugar do antigo "Detalhes"): cordão na cor do papel,
// faixa marinho com o símbolo AG Pocket, retrato pixel art e o que ele está fazendo agora.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Agent, Roster } from "../../../shared/types";
import { agzinhoOf, lookFor } from "../office/engine";
import { PORTRAIT_H, PORTRAIT_W, drawPortrait } from "../office/sprites";

/** cada pixel da arte vira ~5x5 pixels CSS na foto 3x4 */
const FOTO_ESCALA = 5;
/** "Agora" do descanso vem do engine (não do servidor): confere a cada ~1 s */
const REST_POLL_MS = 1000;
/** "No escritório há" muda de minuto em minuto: 30 s basta */
const CLOCK_MS = 30_000;
/** abaixo disso o painel fica embaixo do escritório (mesmo corte do styles.css) */
const STACKED_QUERY = "(max-width: 900px)";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Props {
  agent: Agent;
  roster: Roster | null;
  /** texto do status, o mesmo da lista do time ("trabalhando", "te esperando"...) */
  statusLabel: string;
  /** o que ele faz no descanso ("Jogando ping-pong"), ou null fora do descanso */
  restLabel: (id: string) => string | null;
  onClose: () => void;
  /** abre o vestiário pra esse AGzinho (key do elenco); sem handler o botão fica desabilitado */
  onPersonalizar?: (key: string) => void;
  /** muda a cada seleção feita no canvas: no layout empilhado a página rola até o crachá */
  revelar?: number;
}

export function Cracha({ agent, roster, statusLabel, restLabel, onClose, onPersonalizar, revelar = 0 }: Props) {
  const titleId = useId();
  const ag = agzinhoOf(agent, roster);
  const visitante = !ag;
  const nome = ag?.nome ?? agent.name;
  const cargo = ag ? `${ag.cargo} · AGzinho` : `Visitante · ${agent.name}`;
  const sectionRef = useRef<HTMLElement>(null);

  // descanso: pergunta ao engine a cada ~1 s (setState com o mesmo texto não re-renderiza)
  const [rest, setRest] = useState<string | null>(() => restLabel(agent.id));
  useEffect(() => {
    const tick = () => setRest(restLabel(agent.id));
    tick();
    const t = setInterval(tick, REST_POLL_MS);
    return () => clearInterval(t);
  }, [agent.id, restLabel]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(t);
  }, [agent.id]);

  // fecha e, se o foco estava no crachá (ou solto no body), devolve pra linha do agente na lista
  const close = useCallback(() => {
    const active = document.activeElement;
    const back = !active || active === document.body || !!sectionRef.current?.contains(active);
    onClose();
    if (back) document.querySelector<HTMLElement>(`.team [data-agent-id="${CSS.escape(agent.id)}"]`)?.focus();
  }, [onClose, agent.id]);

  // Esc fecha (menos com um <dialog> aberto, como o vestiário, que trata o próprio Esc)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  // Layout empilhado: clicou no boneco no canvas, a página rola até o crachá (lá embaixo do escritório).
  useEffect(() => {
    if (!revelar || !window.matchMedia(STACKED_QUERY).matches) return;
    sectionRef.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [revelar]);

  // No desktop o painel rola sozinho e o crachá nasce abaixo da lista do time: traz pra vista dentro
  // do painel, rolando só o necessário (a linha selecionada fica visível sempre que cabe junto).
  useLayoutEffect(() => {
    const el = sectionRef.current;
    const panel = el?.closest<HTMLElement>(".panel");
    if (!el || !panel || panel.scrollHeight <= panel.clientHeight) return;
    const p = panel.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const below = r.bottom - p.bottom;
    if (below <= 0) return;
    // desce o necessário pro crachá inteiro, sem passar do topo dele
    const top = panel.scrollTop + Math.min(below + 8, r.top - p.top - 8);
    panel.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [agent.id]);

  // ocioso fora do descanso: a activity do servidor ("Terminou, esperando você"), menos o "De boa"
  // que já está no status
  const activity = agent.activity && agent.activity !== statusLabel && agent.activity !== "De boa" ? agent.activity : "";
  const agora = (agent.status === "ocioso" ? rest || activity : activity || rest) || "Na mesa, aguardando tarefa";

  const style = { "--cordao": ag?.cordao ?? "var(--cordao-visitante)" } as CSSProperties;

  return (
    <section ref={sectionRef} className={`cracha${visitante ? " cracha-visitante" : ""}`} aria-labelledby={titleId} style={style}>
      {/* a key reinicia o balanço de entrada a cada agente */}
      <div className="cracha-pendulo" key={agent.id}>
        <div className="cracha-cordao" aria-hidden="true">
          <span className="cordao-faixa cordao-esq" />
          <span className="cordao-faixa cordao-dir" />
          <span className="cordao-presilha" />
        </div>

        <div className="cracha-cartao">
          <div className="cracha-furo" aria-hidden="true" />
          <div className="cracha-faixa">
            <img className="cracha-simbolo" src="/favicon-agpocket.svg" alt="" width={24} height={24} />
            <span className="cracha-marca" translate="no">
              AG Pocket
            </span>
            <button type="button" className="cracha-fechar" aria-label="Fechar crachá" title="Fechar (Esc)" onClick={close}>
              ×
            </button>
          </div>

          <div className="cracha-corpo">
            <Retrato agent={agent} roster={roster} nome={nome} />

            <h2 id={titleId} className="cracha-nome">
              {nome}
            </h2>
            <p className="cracha-cargo">{cargo}</p>
            {ag ? (
              <p className="cracha-matricula" translate="no">
                <span className="sr-only">Matrícula </span>
                {ag.matricula}
              </p>
            ) : (
              <p className="cracha-selo">Visitante</p>
            )}

            <dl className="cracha-dados">
              <div className="cracha-status">
                <dt className="sr-only">Status</dt>
                <dd aria-live="polite">
                  <i className={`cracha-dot dot-${agent.status}`} aria-hidden="true" />
                  {statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)}
                </dd>
              </div>
              <div className="cracha-agora">
                <dt>Agora:</dt>
                <dd>{agora}</dd>
              </div>
              <div className="cracha-stat">
                <dt>Entregas hoje:</dt>
                <dd>{agent.tasksDone}</dd>
              </div>
              <div className="cracha-stat">
                <dt>No escritório há:</dt>
                <dd>{tempoDesde(agent.startedAt, now)}</dd>
              </div>
              {!agent.parentId && agent.project && (
                <div className="cracha-projeto">
                  <dt>Projeto:</dt>
                  <dd translate="no">{agent.project}</dd>
                </div>
              )}
            </dl>

            {ag && (
              <button
                type="button"
                className="btn cracha-personalizar"
                aria-haspopup="dialog"
                disabled={!onPersonalizar}
                title={onPersonalizar ? `Trocar o visual de ${ag.apelido}` : "Em breve"}
                onClick={() => onPersonalizar?.(ag.key)}
              >
                Personalizar
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** foto 3x4: o busto do sprites.ts em escala inteira de pixels de tela, sem borrão */
function Retrato({ agent, roster, nome }: { agent: Agent; roster: Roster | null; nome: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // a aparência só muda com o elenco ou com quem é o agente (mesma função do escritório)
  const look = useMemo(() => lookFor(agent, roster), [agent.id, agent.agzinho, agent.role, roster]);
  const dpr = useDevicePixelRatio();

  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // pixels de tela por pixel da arte sempre inteiros (como o canvas do escritório)
    const k = Math.max(1, Math.round(FOTO_ESCALA * dpr));
    canvas.width = PORTRAIT_W * k;
    canvas.height = PORTRAIT_H * k;
    canvas.style.width = `${(PORTRAIT_W * k) / dpr}px`;
    canvas.style.height = `${(PORTRAIT_H * k) / dpr}px`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPortrait(ctx, look, k);
  }, [look, dpr]);

  return (
    <div className="cracha-foto">
      <canvas
        ref={ref}
        role="img"
        aria-label={`Retrato pixel art de ${nome}`}
        width={PORTRAIT_W * FOTO_ESCALA}
        height={PORTRAIT_H * FOTO_ESCALA}
      />
    </div>
  );
}

/** devicePixelRatio que acompanha zoom do navegador e troca de monitor */
function useDevicePixelRatio() {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => setDpr(window.devicePixelRatio || 1);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [dpr]);
  return dpr;
}

/** "menos de 1 min", "12 min", "1h 12min" */
function tempoDesde(ts: number, now: number) {
  const m = Math.floor(Math.max(0, now - ts) / 60_000);
  if (m < 1) return "menos de 1 min";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}
