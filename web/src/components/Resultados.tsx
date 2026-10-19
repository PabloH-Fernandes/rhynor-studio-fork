// Seção "Resultados" do painel: atas processadas, tarefas aprovadas, missões concluídas e pendências fechadas
// (hoje / semana / total) e o tempo economizado, que é SEMPRE uma estimativa. Os números vêm das notas do vault,
// contados pelo servidor. O painel só mostra e exporta o resumo: NUNCA roda o Claude.

import { useRef, useState } from "react";
import type { Resultados as DadosResultados } from "../../../shared/resultados";
import { copiarTexto } from "../caixaLogic";
import {
  FRASE_ESTIMATIVA,
  avisosDosResultados,
  comoEstimamos,
  montarLinhas,
  nomeArquivoResumo,
  resumoTopo,
  semResultados,
  tempoTopo,
  textoErroExportar,
} from "../resultadosLogic";
import { usePreferencia } from "../usePreferencia";

interface Exportado {
  texto: string;
  arquivo: string;
}

/** o resumo pequeno do topo do painel (perto do quadro de etapas): só o dia de hoje */
export function ResumoResultados({ resultados }: { resultados: DadosResultados | null }) {
  if (!resultados || semResultados(resultados)) return null;
  return (
    <section className="res-topo" aria-label="Resumo de hoje">
      <p className="res-topo-linha">{resumoTopo(resultados)}</p>
      <p className="res-topo-linha res-topo-tempo">{tempoTopo(resultados)}</p>
    </section>
  );
}

export function Resultados({ resultados }: { resultados: DadosResultados | null }) {
  const [aberto, alternar] = usePreferencia("agpocket.painel.resultados", true);
  const [enviando, setEnviando] = useState(false);
  const [exportado, setExportado] = useState<Exportado | null>(null);
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const textoRef = useRef<HTMLTextAreaElement | null>(null);
  /** alterna o prefixo para o leitor de tela anunciar de novo duas ações iguais seguidas */
  const vezes = useRef(0);

  if (!resultados) return null;

  const falar = (frase: string) => {
    vezes.current += 1;
    setAviso(vezes.current % 2 === 0 ? `${frase}.` : frase);
  };

  const exportar = async () => {
    if (enviando) return;
    setEnviando(true);
    setErro("");
    setAviso("");
    try {
      const r = await fetch("/api/resultados/exportar", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!r.ok) {
        setErro(textoErroExportar(r.status));
        return;
      }
      const corpo = (await r.json()) as { ok?: boolean; texto?: unknown; arquivo?: unknown };
      if (typeof corpo.texto !== "string") {
        setErro(textoErroExportar(500));
        return;
      }
      setExportado({ texto: corpo.texto, arquivo: typeof corpo.arquivo === "string" ? corpo.arquivo : nomeArquivoResumo(resultados.hoje) });
      falar("Resumo pronto");
      // o foco vai para o texto: dá para ler e copiar com o teclado
      setTimeout(() => textoRef.current?.focus(), 0);
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  const copiar = async () => {
    if (!exportado) return;
    const ok = await copiarTexto(exportado.texto);
    if (ok) falar("Resumo copiado");
    else {
      textoRef.current?.select();
      falar("Não deu para copiar sozinho: o texto está selecionado, use Ctrl+C");
    }
  };

  const baixar = () => {
    if (!exportado) return;
    try {
      const url = URL.createObjectURL(new Blob([exportado.texto], { type: "text/markdown;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = exportado.arquivo;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      falar("Arquivo baixado");
    } catch {
      falar("Não deu para baixar: use o botão Copiar");
    }
  };

  const linhas = montarLinhas(resultados);
  const avisos = avisosDosResultados(resultados);
  const vazio = semResultados(resultados);

  return (
    <section className="secao resultados" aria-label="Resultados">
      <h2>
        <button className="secao-toggle" aria-expanded={aberto} aria-controls="secao-resultados" onClick={alternar}>
          <span className="secao-seta" aria-hidden="true" />
          Resultados
        </button>
      </h2>
      <div id="secao-resultados" hidden={!aberto}>
        {vazio ? (
          <p className="caixa-meta">Ainda não há resultados. Eles aparecem quando uma ata for lida ou uma tarefa for aprovada.</p>
        ) : (
          <table className="res-tabela">
            <caption className="sr-only">Resultados de hoje, da semana (últimos 7 dias) e no total</caption>
            <thead>
              <tr>
                <th scope="col">O que</th>
                <th scope="col">Hoje</th>
                <th scope="col">Semana</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} className={`${l.detalhe ? "res-detalhe" : ""}${l.estimativa ? " res-estimativa" : ""}`.trim() || undefined}>
                  <th scope="row">{l.detalhe ? <span aria-hidden="true">↳ </span> : null}{l.rotulo}</th>
                  <td>{l.hoje}</td>
                  <td>{l.semana}</td>
                  <td>{l.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* sempre visível (não é dica de mouse): o tempo é uma conta aproximada */}
        <p className="res-estimativa-aviso">
          <strong>Estimativa:</strong> {FRASE_ESTIMATIVA} {comoEstimamos(resultados)}
        </p>
        {avisos.map((a) => (
          <p key={a} className="caixa-meta">
            {a}
          </p>
        ))}
        <p className="caixa-meta">Semana = os últimos 7 dias, de {resultados.semanaDesde.split("-").reverse().join("/")} até hoje.</p>

        <div className="caixa-acoes">
          <button type="button" className="btn" aria-disabled={enviando} aria-label="Exportar resumo dos resultados" onClick={() => void exportar()}>
            {enviando ? "Gerando..." : "Exportar resumo"}
          </button>
        </div>
        <p className="caixa-erro" role="alert">
          {erro}
        </p>

        {exportado && (
          <div className="res-exportado">
            <label className="caixa-meta" htmlFor="res-texto">
              Resumo para colar num e-mail ou slide:
            </label>
            <textarea id="res-texto" ref={textoRef} className="res-texto" readOnly rows={12} value={exportado.texto} />
            <div className="caixa-acoes">
              <button type="button" className="btn" aria-label="Copiar o resumo" onClick={() => void copiar()}>
                Copiar
              </button>
              <button type="button" className="btn ghost" aria-label={`Baixar o resumo como ${exportado.arquivo}`} onClick={baixar}>
                Baixar (.md)
              </button>
            </div>
            <p className="caixa-meta">Uma cópia ficou salva no computador, em data/exportacoes/{exportado.arquivo}.</p>
          </div>
        )}
        <p className="sr-only" role="status">
          {aviso}
        </p>
      </div>
    </section>
  );
}
