// Seção "Replay do dia": toca de novo o que o escritório fez num dia (a partir do resumo leve que o servidor guarda
// em data/replay). Tem o PRÓPRIO estado e um SEGUNDO escritório: o ao vivo continua por trás e o replay nunca
// escreve no estado real (não usa o useOffice). Escondido na apresentação (o resumo vem do seu uso de verdade).

import { useEffect, useMemo, useRef, useState } from "react";
import type { Roster } from "../../../shared/types";
import type { DiaDisponivel, DiaReplay } from "../../../shared/replay";
import { APRESENTACAO } from "../apresentacao";
import { OfficeCanvas } from "../OfficeCanvas";
import {
  AVISO_VELOCIDADE,
  Reprodutor,
  TEXTO_VAZIO,
  VELOCIDADES,
  avancar,
  duracaoMs,
  ehDiaReplay,
  ehListaDias,
  estadoVazio,
  indiceEm,
  rotuloData,
  rotuloHora,
  rotuloHoraSegundos,
  type Velocidade,
} from "../replayLogic";
import { usePreferencia } from "../usePreferencia";

type Dias = { tipo: "carregando" } | { tipo: "ok"; lista: DiaDisponivel[] } | { tipo: "erro" };
type DiaCarregado = { tipo: "nada" } | { tipo: "carregando" } | { tipo: "ok"; dia: DiaReplay } | { tipo: "erro"; texto: string };

/** o relógio do replay atualiza o slider e o escritório nesse ritmo (mais devagar com "reduzir movimento") */
const ATUALIZA_MS = 100;
const ATUALIZA_REDUZIDO_MS = 500;

const semSelecao = () => undefined;

export function ReplayDia({ roster }: { roster: Roster | null }) {
  if (APRESENTACAO) return null;
  return <ReplayPainel roster={roster} />;
}

function ReplayPainel({ roster }: { roster: Roster | null }) {
  const [aberto, alternar] = usePreferencia("studio.painel.replay", false);
  const [dias, setDias] = useState<Dias>({ tipo: "carregando" });
  const [data, setData] = useState<string>("");
  const [carregado, setCarregado] = useState<DiaCarregado>({ tipo: "nada" });
  const [tocando, setTocando] = useState(false);
  const [velocidade, setVelocidade] = useState<Velocidade>(30);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  /** o escritório do replay só desenha enquanto toca ou logo depois de mexer (parado, não gasta quadro nenhum) */
  const [desenhando, setDesenhando] = useState(false);

  // lista de dias: só pede depois que a seção abre (fechada, o painel não faz pedido nenhum)
  useEffect(() => {
    if (!aberto) return;
    const controle = new AbortController();
    setDias({ tipo: "carregando" });
    fetch("/api/replay/dias", { signal: controle.signal })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((corpo) => {
        if (controle.signal.aborted) return;
        if (!ehListaDias(corpo)) return setDias({ tipo: "erro" });
        setDias({ tipo: "ok", lista: corpo.dias });
        setData((atual) => (atual && corpo.dias.some((d) => d.data === atual) ? atual : (corpo.dias.find((d) => !d.semMovimento) ?? corpo.dias[0])?.data ?? ""));
      })
      .catch(() => {
        if (!controle.signal.aborted) setDias({ tipo: "erro" });
      });
    return () => controle.abort();
  }, [aberto]);

  // o dia escolhido
  useEffect(() => {
    setTocando(false);
    if (!aberto || !data) {
      setCarregado({ tipo: "nada" });
      return;
    }
    const controle = new AbortController();
    setCarregado({ tipo: "carregando" });
    fetch(`/api/replay/dia?data=${encodeURIComponent(data)}`, { signal: controle.signal })
      .then(async (r) => {
        const corpo: unknown = await r.json().catch(() => null);
        if (controle.signal.aborted) return;
        if (r.ok && ehDiaReplay(corpo)) {
          tRef.current = corpo.inicio;
          setT(corpo.inicio);
          setCarregado({ tipo: "ok", dia: corpo });
        } else {
          setCarregado({ tipo: "erro", texto: r.status === 404 ? "Não há replay para esse dia." : "Não consegui carregar esse dia." });
        }
      })
      .catch(() => {
        if (!controle.signal.aborted) setCarregado({ tipo: "erro", texto: "Sem conexão com o servidor. Tente de novo." });
      });
    return () => controle.abort();
  }, [aberto, data]);

  const dia = carregado.tipo === "ok" ? carregado.dia : null;
  const reprodutor = useMemo(() => (dia ? new Reprodutor(dia) : null), [dia]);

  // relógio do replay: t += dt * velocidade (dt em ms reais, limitado para não saltar quando a aba fica parada)
  useEffect(() => {
    if (!tocando || !dia) return;
    const reduzido = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const intervalo = reduzido ? ATUALIZA_REDUZIDO_MS : ATUALIZA_MS;
    let raf = 0;
    let ultimo = performance.now();
    let ultimaAtualizacao = ultimo;
    const passo = (agora: number) => {
      const r = avancar(tRef.current, agora - ultimo, velocidade, dia.fim);
      ultimo = agora;
      tRef.current = r.t;
      if (r.terminou || agora - ultimaAtualizacao >= intervalo) {
        ultimaAtualizacao = agora;
        setT(r.t);
      }
      if (r.terminou) {
        setTocando(false);
        return;
      }
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [tocando, velocidade, dia]);

  // o estado só muda quando passa uma mensagem (não a cada quadro)
  const indice = dia ? indiceEm(dia.mensagens, t) : 0;

  // desenha enquanto toca; ao pausar/arrastar, mais um instante para o último quadro aparecer, e para
  useEffect(() => {
    if (!aberto || !dia) {
      setDesenhando(false);
      return;
    }
    setDesenhando(true);
    if (tocando) return;
    const espera = window.setTimeout(() => setDesenhando(false), 2500);
    return () => window.clearTimeout(espera);
  }, [aberto, dia, tocando, indice]);

  // irPara é idempotente (o mesmo t dá o mesmo estado; o Reprodutor só guarda cursor e retratos como cache),
  // então refazer no render é seguro, inclusive no StrictMode
  const estado = useMemo(() => (reprodutor ? reprodutor.irPara(t) : estadoVazio()), [reprodutor, indice]);
  const agentes = useMemo(() => Object.values(estado.agents), [estado]);
  const palco = useMemo(
    () => (
      <OfficeCanvas agents={agentes} roster={roster} progress={estado.progress} reuniao={null} missao={null} atrasadas={0} selectedId={null} onSelect={semSelecao} ativo={desenhando} />
    ),
    [agentes, roster, estado.progress, desenhando],
  );

  const alternarPlay = () => {
    if (!dia) return;
    if (!tocando && tRef.current >= dia.fim) {
      tRef.current = dia.inicio;
      setT(dia.inicio);
    }
    setTocando((v) => !v);
  };

  const mover = (valor: number) => {
    if (!dia) return;
    const novo = Math.min(dia.fim, Math.max(dia.inicio, dia.inicio + valor));
    tRef.current = novo;
    setT(novo);
  };

  const semDias = dias.tipo === "ok" && dias.lista.length === 0;
  const duracao = dia ? duracaoMs(dia) : 0;
  // o max do slider é múltiplo do passo (1 s), arredondado para cima: o fim do dia é alcançável
  const maxSlider = Math.max(1000, Math.ceil(duracao / 1000) * 1000);
  const fimDoDia = dia ? t >= dia.fim : false;

  return (
    <section className="secao replay" aria-label="Replay do dia">
      <h2>
        <button className="secao-toggle" aria-expanded={aberto} aria-controls="secao-replay" onClick={alternar}>
          <span className="secao-seta" aria-hidden="true" />
          Replay do dia
        </button>
      </h2>
      <div id="secao-replay" hidden={!aberto}>
        {aberto && dias.tipo === "carregando" && <p className="caixa-meta">Procurando os dias gravados...</p>}
        {aberto && dias.tipo === "erro" && <p className="caixa-meta replay-erro">Não consegui ver os dias gravados. O servidor está ligado?</p>}
        {aberto && semDias && <p className="caixa-meta">{TEXTO_VAZIO}</p>}

        {aberto && dias.tipo === "ok" && dias.lista.length > 0 && (
          <>
            <p className="caixa-meta">Rever o que o time fez num dia. É só um resumo: sem pedidos, comandos nem nomes de arquivo.</p>
            <div className="replay-linha">
              <label htmlFor="replay-data" className="replay-rotulo">
                Dia
              </label>
              <select id="replay-data" className="replay-select" value={data} onChange={(e) => setData(e.target.value)}>
                {dias.lista.map((d) => (
                  <option key={d.data} value={d.data}>
                    {rotuloData(d.data)}
                    {d.semMovimento ? " (sem movimento)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <p className="caixa-meta replay-aviso" role="status" aria-live="polite">
              {carregado.tipo === "carregando" ? "Carregando o dia..." : carregado.tipo === "erro" ? carregado.texto : ""}
            </p>

            {dia && (
              <>
                {dia.mensagens.length === 0 ? (
                  <p className="caixa-meta">Esse dia não tem movimento para tocar.</p>
                ) : (
                  <>
                    <div className="replay-palco">{palco}</div>

                    <div className="replay-controles">
                      <button type="button" className="btn-tecnico replay-play" aria-label={tocando ? "Pausar o replay" : fimDoDia ? "Tocar de novo desde o início" : "Tocar o replay"} onClick={alternarPlay}>
                        {tocando ? "Pausar" : fimDoDia ? "De novo" : "Tocar"}
                      </button>
                      <div className="replay-velocidades" role="group" aria-label="Velocidade do replay">
                        {VELOCIDADES.map((v) => (
                          <button key={v} type="button" className="btn-tecnico replay-vel" aria-pressed={velocidade === v} aria-label={`Velocidade ${v} vezes`} onClick={() => setVelocidade(v)}>
                            {v}x
                          </button>
                        ))}
                      </div>
                      <span className="replay-hora" aria-hidden="true">
                        {rotuloHoraSegundos(t)}
                      </span>
                    </div>

                    <input
                      type="range"
                      className="replay-slider"
                      aria-label="Hora do replay"
                      aria-valuetext={`${rotuloHoraSegundos(t)}, de ${rotuloHora(dia.inicio)} a ${rotuloHora(dia.fim)}`}
                      min={0}
                      max={maxSlider}
                      step={1000}
                      value={Math.min(Math.max(0, t - dia.inicio), maxSlider)}
                      onChange={(e) => mover(Number(e.target.value))}
                    />
                    <div className="replay-extremos" aria-hidden="true">
                      <span>{rotuloHora(dia.inicio)}</span>
                      <span>{rotuloHora(dia.fim)}</span>
                    </div>

                    <p className="caixa-meta replay-aviso">{AVISO_VELOCIDADE}</p>
                    {dia.reduzido && (
                      <p className="caixa-meta replay-aviso">Dia muito cheio: o replay mostra só as mudanças de status e o fim do dia foi cortado.</p>
                    )}
                    {dia.limiteAtingido && <p className="caixa-meta replay-aviso">O dia atingiu o limite de registro: o que veio depois não está no replay.</p>}
                    {dia.linhasIgnoradas ? <p className="caixa-meta replay-aviso">{dia.linhasIgnoradas} linha(s) do resumo estavam estragadas e foram ignoradas.</p> : null}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
