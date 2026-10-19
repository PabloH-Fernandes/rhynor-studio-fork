// Seção "Caixa de entrada" do painel: as reuniões lidas sem IA que esperam a sua decisão.
// Para cada tarefa você escolhe quem faz; ao aprovar, o servidor cria a missão e o painel mostra o comando
// /time pronto para copiar. O painel NUNCA roda o Claude: quem executa é você, no terminal.

import { useEffect, useRef, useState } from "react";
import type { CaixaAcao, CaixaItem, CaixaResposta } from "../../../shared/types";
import {
  ACOES_CAIXA,
  AVISO_TRUNCADA,
  contarAcoes,
  copiarTexto,
  escolhidas,
  montarAprovacao,
  resumoDecisao,
  rotuloAprovar,
  semTarefas,
  textoDataReuniao,
  textoErroAprovacao,
  textoPrazo,
  textoProgresso,
  textoResponsavel,
  todasEscolhidas,
  type Escolhas,
} from "../caixaLogic";
import type { AprovadaDemo } from "../demo/dadosDemo";
import { usePreferencia } from "../usePreferencia";

/** o que fica na tela depois de aprovar (a reunião sai da caixa, mas o comando precisa continuar à mão) */
type Aprovada = AprovadaDemo;

const AVISO_COPIA_MS = 3500;

/** modo apresentação: só leitura (nada é aprovado nem escrito); a demo passa as escolhas e o cartão "Aprovada" prontos */
export interface CaixaSomenteLeitura {
  escolhas: Record<string, Record<number, CaixaAcao>>;
  aprovadas: AprovadaDemo[];
}

export function CaixaEntrada({ itens, somenteLeitura }: { itens: CaixaItem[] | null; somenteLeitura?: CaixaSomenteLeitura }) {
  const [aberto, alternar] = usePreferencia("agpocket.painel.caixa", true);
  const [escolhasLocais, setEscolhas] = useState<Record<string, Record<number, CaixaAcao>>>({});
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [aprovadasLocais, setAprovadas] = useState<Aprovada[]>([]);
  const escolhas = somenteLeitura ? somenteLeitura.escolhas : escolhasLocais;
  const aprovadas: Aprovada[] = somenteLeitura ? somenteLeitura.aprovadas : aprovadasLocais;
  const [copia, setCopia] = useState<{ id: string; ok: boolean } | null>(null);
  const timerCopia = useRef<ReturnType<typeof setTimeout>>();
  const cartoes = useRef(new Map<string, HTMLElement | null>());
  const focarAprovada = useRef<string | null>(null);
  const focarTitulo = useRef(false);
  const tituloRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => () => clearTimeout(timerCopia.current), []);
  // depois de aprovar o cartão da reunião some: o foco vai para o cartão com o comando
  useEffect(() => {
    if (focarAprovada.current) cartoes.current.get(focarAprovada.current)?.focus();
    else if (focarTitulo.current) tituloRef.current?.focus();
    focarAprovada.current = null;
    focarTitulo.current = false;
  }, [aprovadas]);

  const lista = itens ?? [];
  if (lista.length === 0 && aprovadas.length === 0) return null;

  const escolher = (item: CaixaItem, n: number, acao: CaixaAcao) => {
    setEscolhas((prev) => ({ ...prev, [item.id]: { ...prev[item.id], [n]: acao } }));
    setErros((prev) => (prev[item.id] ? { ...prev, [item.id]: "" } : prev));
  };

  const aprovar = async (item: CaixaItem) => {
    const decididas: Escolhas = escolhas[item.id] ?? {};
    const corpo = montarAprovacao(item, decididas);
    if (!corpo || enviando) return;
    setEnviando(item.id);
    setErros((prev) => ({ ...prev, [item.id]: "" }));
    try {
      const r = await fetch("/api/caixa/aprovar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const json = (await r.json().catch(() => null)) as CaixaResposta | { ok: false; erros?: string[] } | null;
      if (!r.ok || !json?.ok) {
        const msg = json && !json.ok ? json.erros?.[0] : undefined;
        setErros((prev) => ({ ...prev, [item.id]: textoErroAprovacao(r.status, msg) }));
        return;
      }
      focarAprovada.current = item.id;
      setAprovadas((prev) => [
        { id: item.id, titulo: item.titulo, resumo: resumoDecisao(contarAcoes(item, decididas)), comando: json.comando },
        ...prev.filter((a) => a.id !== item.id),
      ]);
      setEscolhas((prev) => {
        const { [item.id]: _feito, ...resto } = prev;
        return resto;
      });
    } catch {
      setErros((prev) => ({ ...prev, [item.id]: "Sem conexão com o servidor. Tente de novo." }));
    } finally {
      setEnviando(null);
    }
  };

  const copiar = async (a: Aprovada) => {
    if (!a.comando) return;
    const ok = await copiarTexto(a.comando);
    setCopia({ id: a.id, ok });
    clearTimeout(timerCopia.current);
    timerCopia.current = setTimeout(() => setCopia(null), AVISO_COPIA_MS);
  };

  // ao fechar o cartão ele some com o foco: vai para o próximo cartão aprovado ou, se não houver, para o título da seção
  const fechar = (id: string) => {
    const i = aprovadas.findIndex((a) => a.id === id);
    const vizinho = aprovadas[i + 1] ?? aprovadas[i - 1];
    if (vizinho) focarAprovada.current = vizinho.id;
    else focarTitulo.current = true;
    setAprovadas((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <section className="secao caixa" aria-label="Caixa de entrada">
      <h2>
        <button ref={tituloRef} className="secao-toggle" aria-expanded={aberto} aria-controls="secao-caixa" onClick={alternar}>
          <span className="secao-seta" aria-hidden="true" />
          Caixa de entrada <span className="count"><span aria-hidden="true">· </span>{lista.length}</span>
        </button>
      </h2>
      <div id="secao-caixa" hidden={!aberto}>
        {aprovadas.length > 0 && (
          <ul className="caixa-lista">
            {aprovadas.map((a) => (
              <li
                key={a.id}
                className="caixa-aprovada"
                tabIndex={-1}
                ref={(el) => {
                  cartoes.current.set(a.id, el);
                }}
              >
                <p className="caixa-titulo">
                  <span aria-hidden="true">✓</span> Aprovada: {a.titulo}
                </p>
                {a.resumo && <p className="caixa-meta">{a.resumo}</p>}
                {a.comando ? (
                  <>
                    <p className="caixa-meta">Cole este comando no terminal do Claude Code. O painel não roda nada sozinho.</p>
                    <code className="caixa-comando" id={`caixa-comando-${a.id}`}>
                      {a.comando}
                    </code>
                    <div className="caixa-acoes">
                      <button type="button" className="btn" aria-describedby={`caixa-comando-${a.id}`} onClick={() => void copiar(a)}>
                        Copiar comando
                      </button>
                      {!somenteLeitura && (
                        <button type="button" className="btn ghost" onClick={() => fechar(a.id)}>
                          Fechar
                        </button>
                      )}
                    </div>
                    <p className="caixa-copiado" role="status">
                      {copia?.id === a.id ? (copia.ok ? "Copiado!" : "Não deu para copiar sozinho: selecione o comando e use Ctrl+C.") : ""}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="caixa-meta">Nenhuma missão para o time: não há comando para rodar.</p>
                    {!somenteLeitura && (
                      <div className="caixa-acoes">
                        <button type="button" className="btn ghost" onClick={() => fechar(a.id)}>
                          Fechar
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {lista.length > 0 && (
          <ul className="caixa-lista">
            {lista.map((item) => {
              const decididas: Escolhas = escolhas[item.id] ?? {};
              const pronta = semTarefas(item) || todasEscolhidas(item, decididas);
              const data = textoDataReuniao(item.data);
              const erro = erros[item.id];
              return (
                <li key={item.id} className="caixa-item">
                  <p className="caixa-titulo">
                    <span aria-hidden="true">📥</span> {item.titulo}
                  </p>
                  <p className="caixa-meta">
                    {data ? `Reunião de ${data} · ` : ""}
                    {semTarefas(item) ? "sem tarefas" : textoProgresso(item, decididas)}
                  </p>
                  {semTarefas(item) ? (
                    <p className="caixa-meta">Nada para decidir aqui. Arquive para tirar da caixa.</p>
                  ) : (
                    <ol className="caixa-tarefas">
                      {item.tarefas.map((t) => (
                        <li key={t.n} className="caixa-tarefa">
                          <p className="caixa-texto">{t.texto}</p>
                          <p className="caixa-meta">
                            {textoResponsavel(t)} · {textoPrazo(t.prazo)}
                          </p>
                          <div className="caixa-opcoes" role="group" aria-label={`Quem faz a tarefa ${t.n}: ${t.texto}`}>
                            {ACOES_CAIXA.map((o) => {
                              const marcada = decididas[t.n] === o.acao;
                              return (
                                <button
                                  key={o.acao}
                                  type="button"
                                  className={`btn-tecnico caixa-opcao${marcada ? " ligado" : ""}`}
                                  aria-pressed={marcada}
                                  aria-label={`${o.rotulo}: tarefa ${t.n}`}
                                  disabled={!!somenteLeitura}
                                  onClick={() => escolher(item, t.n, o.acao)}
                                >
                                  <span aria-hidden="true">{marcada ? "✓ " : ""}{o.icone}</span> {o.rotulo}
                                </button>
                              );
                            })}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                  {item.truncada && <p className="caixa-meta">{AVISO_TRUNCADA}</p>}
                  {!somenteLeitura && (
                  <div className="caixa-acoes">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!pronta || enviando !== null}
                      aria-label={semTarefas(item) ? `Arquivar a reunião ${item.titulo}` : `Aprovar a reunião ${item.titulo}`}
                      onClick={() => void aprovar(item)}
                    >
                      {enviando === item.id ? "Salvando..." : rotuloAprovar(item, decididas)}
                    </button>
                    {!semTarefas(item) && escolhidas(item, decididas) === 0 && <span className="caixa-meta">Escolha uma opção em cada tarefa.</span>}
                  </div>
                  )}
                  <p className="caixa-erro" role="alert">
                    {erro ?? ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
