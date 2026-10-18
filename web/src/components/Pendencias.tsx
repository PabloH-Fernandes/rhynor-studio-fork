// Seção "Pendências" do painel: as tarefas em aberto das reuniões (as suas) e das missões, com prazo.
// Só mostra e marca como concluída (grava `- [x]` na nota do vault). O painel NUNCA roda o Claude.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Pendencia } from "../../../shared/types";
import { dataBr, ehDataValida } from "../../../shared/datas";
import { textoResponsavel } from "../caixaLogic";
import {
  FILTROS_PENDENCIAS,
  URGENCIAS,
  comUrgencia,
  contarPendencias,
  filtrarPendencias,
  filtroValido,
  ordenarPendencias,
  proximoFoco,
  resumoPendencias,
  rotuloConcluir,
  textoDono,
  textoErroConclusao,
  textoEstado,
} from "../pendenciasLogic";
import { useHoje } from "../useHoje";
import { usePreferencia, usePreferenciaTexto } from "../usePreferencia";

export function Pendencias({ itens }: { itens: Pendencia[] | null }) {
  const [aberto, alternar] = usePreferencia("agpocket.painel.pendencias", true);
  const [filtroSalvo, setFiltro] = usePreferenciaTexto("agpocket.painel.pendencias.filtro", "minhas");
  const filtro = filtroValido(filtroSalvo);
  const hoje = useHoje();
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  /** concluídas aqui que o servidor ainda não tirou da lista (some na hora, sem esperar o WebSocket) */
  const [concluidas, setConcluidas] = useState<ReadonlySet<string>>(new Set());
  const [aviso, setAviso] = useState("");
  const botoes = useRef(new Map<string, HTMLButtonElement | null>());
  const tituloRef = useRef<HTMLButtonElement | null>(null);
  /** quem recebe o foco depois que o item concluído sai da lista: um id, "titulo" ou nada */
  const focar = useRef<string | null>(null);
  const jaTeve = useRef(false);

  // o servidor já tirou da lista: não precisa mais lembrar que foi concluída
  useEffect(() => {
    if (!itens) return;
    setConcluidas((prev) => {
      const vivos = new Set(itens.map((p) => p.id));
      const resto = [...prev].filter((id) => vivos.has(id));
      return resto.length === prev.size ? prev : new Set(resto);
    });
  }, [itens]);

  const todas = useMemo(() => ordenarPendencias(comUrgencia((itens ?? []).filter((p) => !concluidas.has(p.id)), hoje)), [itens, concluidas, hoje]);
  const contagem = contarPendencias(todas);
  const visiveis = filtrarPendencias(todas, filtro);
  if (todas.length > 0) jaTeve.current = true;

  // depois de concluir o item some: o foco vai para o próximo botão Concluir ou, sem ninguém, para o título
  useEffect(() => {
    const alvo = focar.current;
    if (alvo === null) return;
    focar.current = null;
    if (alvo !== "titulo" && botoes.current.get(alvo)) botoes.current.get(alvo)?.focus();
    else tituloRef.current?.focus();
  }, [visiveis.length]);

  if (itens === null || (todas.length === 0 && !jaTeve.current)) return null;

  const concluir = async (p: Pendencia) => {
    if (enviando) return;
    setEnviando(p.id);
    setErros((prev) => ({ ...prev, [p.id]: "" }));
    try {
      const r = await fetch("/api/pendencias/concluir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, h: p.h }),
      });
      if (!r.ok) {
        setErros((prev) => ({ ...prev, [p.id]: textoErroConclusao(r.status) }));
        return;
      }
      focar.current = proximoFoco(
        visiveis.map((x) => x.id),
        p.id,
      ) ?? "titulo";
      setAviso(`Concluída: ${p.texto}`);
      setConcluidas((prev) => new Set(prev).add(p.id));
    } catch {
      setErros((prev) => ({ ...prev, [p.id]: "Sem conexão com o servidor. Tente de novo." }));
    } finally {
      setEnviando(null);
    }
  };

  const filtroAtual = FILTROS_PENDENCIAS.find((f) => f.filtro === filtro) ?? FILTROS_PENDENCIAS[0];

  return (
    <section className="secao pendencias" aria-label="Pendências">
      <h2>
        <button ref={tituloRef} className="secao-toggle" aria-expanded={aberto} aria-controls="secao-pendencias" onClick={alternar}>
          <span className="secao-seta" aria-hidden="true" />
          Pendências{" "}
          <span className="count">
            <span aria-hidden="true">· </span>
            {contagem.total}
            {contagem.atrasadas > 0 && (
              <>
                <span aria-hidden="true"> · 🔴 </span>
                <span className="sr-only">, </span>
                {contagem.atrasadas}
                <span className="sr-only"> atrasada{contagem.atrasadas === 1 ? "" : "s"}</span>
              </>
            )}
          </span>
        </button>
      </h2>
      <div id="secao-pendencias" hidden={!aberto}>
        <p className="caixa-meta">{resumoPendencias(contagem)}</p>
        <div className="caixa-opcoes" role="group" aria-label="Filtrar pendências">
          {FILTROS_PENDENCIAS.map((f) => {
            const marcada = f.filtro === filtro;
            return (
              <button
                key={f.filtro}
                type="button"
                className={`btn-tecnico caixa-opcao${marcada ? " ligado" : ""}`}
                aria-pressed={marcada}
                onClick={() => setFiltro(f.filtro)}
              >
                <span aria-hidden="true">{marcada ? "✓ " : ""}</span>
                {f.rotulo} ({contagem[f.filtro]})
              </button>
            );
          })}
        </div>

        {visiveis.length === 0 ? (
          <p className="caixa-meta pend-vazio">{filtroAtual.vazio}</p>
        ) : (
          <ul className="caixa-lista">
            {visiveis.map((p) => {
              const u = URGENCIAS[p.urgencia];
              const dono = textoDono(p.dono);
              const erro = erros[p.id];
              return (
                <li key={p.id} className={`caixa-item pend-item pend-${p.urgencia}`}>
                  <p className="pend-selo-linha">
                    <span className={`pend-selo pend-selo-${p.urgencia}`}>
                      <span aria-hidden="true">{u.icone}</span> {u.texto}
                    </span>
                  </p>
                  <p className="caixa-texto">{p.texto}</p>
                  <p className="caixa-meta">
                    {textoResponsavel(p)} · {ehDataValida(p.prazo) ? `prazo ${dataBr(p.prazo)}` : "sem prazo"}
                  </p>
                  <p className="caixa-meta">
                    Origem: {p.origem} · <span aria-hidden="true">{dono.icone} </span>
                    {dono.texto} · {textoEstado(p.status)}
                  </p>
                  <div className="caixa-acoes">
                    <button
                      type="button"
                      className="btn"
                      ref={(el) => {
                        botoes.current.set(p.id, el);
                      }}
                      disabled={enviando !== null}
                      aria-label={rotuloConcluir(p)}
                      onClick={() => void concluir(p)}
                    >
                      {enviando === p.id ? "Salvando..." : "Concluir"}
                    </button>
                  </div>
                  <p className="caixa-erro" role="alert">
                    {erro ?? ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <p className="sr-only" role="status">
          {aviso}
        </p>
      </div>
    </section>
  );
}
