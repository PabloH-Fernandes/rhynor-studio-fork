// Seção "Transparência": o que os agentes abriram no vault (caminho e ação; nunca o conteúdo), as atas lidas sem IA
// e com IA, e o aviso quando um agente leu uma nota confidencial. O painel só mostra e exporta: NUNCA roda o Claude.

import { useRef, useState } from "react";
import type { Resultados } from "../../../shared/resultados";
import type { ResumoTransparencia } from "../../../shared/transparencia";
import { copiarTexto } from "../caixaLogic";
import {
  NOTA_LIMITE,
  contadoresAtas,
  montarAlertas,
  montarLinhas,
  nomeArquivoMd,
  plural,
  resumoVazio,
  textoErroExportar,
} from "../transparenciaLogic";
import { usePreferencia } from "../usePreferencia";

interface Exportado {
  texto: string;
  arquivo: string;
}

export function Transparencia({ resumo, resultados }: { resumo: ResumoTransparencia | null; resultados: Resultados | null }) {
  const [aberto, alternar] = usePreferencia("agpocket.painel.transparencia", true);
  const [enviando, setEnviando] = useState(false);
  const [exportado, setExportado] = useState<Exportado | null>(null);
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const textoRef = useRef<HTMLTextAreaElement | null>(null);
  const vezes = useRef(0);

  if (!resumo) return null;

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
      const r = await fetch("/api/transparencia/exportar", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!r.ok) {
        setErro(textoErroExportar(r.status));
        return;
      }
      const corpo = (await r.json()) as { texto?: unknown; arquivo?: unknown };
      if (typeof corpo.texto !== "string") {
        setErro(textoErroExportar(500));
        return;
      }
      setExportado({ texto: corpo.texto, arquivo: typeof corpo.arquivo === "string" ? corpo.arquivo : nomeArquivoMd(resumo.mes) });
      falar("Registro pronto");
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
    if (ok) falar("Registro copiado");
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

  const alertas = montarAlertas(resumo);
  const linhas = montarLinhas(resumo);
  const atas = contadoresAtas(resultados);

  return (
    <section className="secao transparencia" aria-label="Transparência">
      <h2>
        <button className="secao-toggle" aria-expanded={aberto} aria-controls="secao-transparencia" onClick={alternar}>
          <span className="secao-seta" aria-hidden="true" />
          Transparência
          {resumo.violacoes > 0 && <span className="count transp-count-alerta">{resumo.violacoes}</span>}
        </button>
      </h2>
      {/* sempre visível, mesmo com a seção fechada: é o que NÃO dá para ver */}
      <p className="res-estimativa-aviso">
        <strong>Limite:</strong> {NOTA_LIMITE}
      </p>
      <div id="secao-transparencia" hidden={!aberto}>
        <p className="caixa-meta transp-titulo">O que foi aberto do seu vault pelos agentes (só o nome do arquivo, nunca o conteúdo).</p>

        {alertas.map((a) => (
          <div key={a.tipo} className={`transp-faixa transp-${a.tipo}`} role={a.tipo === "violacao" ? "alert" : "status"}>
            <span className="transp-icone" aria-hidden="true">
              {a.tipo === "violacao" ? "⚠" : "ℹ"}
            </span>
            <p>
              <strong>{a.titulo}</strong>
              <span className="transp-detalhe">{a.detalhe}</span>
            </p>
          </div>
        ))}

        {atas && (
          <ul className="transp-atas" aria-label="Atas processadas">
            <li>
              <strong>{atas.semIa}</strong> atas sem IA
            </li>
            <li>
              <strong>{atas.comIa}</strong> atas com IA (/reuniao)
            </li>
          </ul>
        )}

        {resumoVazio(resumo) ? (
          <p className="caixa-meta">Nenhum arquivo do vault foi aberto por um agente neste mês.</p>
        ) : (
          <>
            <p className="caixa-meta">
              {plural(resumo.total, "abertura", "aberturas")} neste mês ({resumo.mes}). Abaixo, as mais recentes primeiro.
            </p>
            <ul className="transp-lista" aria-label="Aberturas recentes do vault" tabIndex={0}>
              {linhas.map((l) => (
                <li key={l.id} className={`transp-item transp-nivel-${l.nivel}`}>
                  <span className="sr-only">{l.frase}</span>
                  <span aria-hidden="true" className="transp-linha">
                    <span className="transp-hora">{l.hora}</span>
                    {l.marca && (
                      <span className="transp-marca">
                        {l.nivel === "violacao" ? "⚠ " : "ℹ "}
                        {l.marca}
                      </span>
                    )}
                    <span className="transp-agente">{l.agente}</span> <span className="transp-acao">{l.acao}</span>{" "}
                    <span className="transp-arquivo">{l.arquivo}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="caixa-acoes">
          <button type="button" className="btn" aria-disabled={enviando} aria-label="Exportar o registro de transparência do mês" onClick={() => void exportar()}>
            {enviando ? "Gerando..." : "Exportar"}
          </button>
        </div>
        <p className="caixa-erro" role="alert">
          {erro}
        </p>

        {exportado && (
          <div className="res-exportado">
            <label className="caixa-meta" htmlFor="transp-texto">
              Registro do mês, para colar num e-mail ou relatório:
            </label>
            <textarea id="transp-texto" ref={textoRef} className="res-texto" readOnly rows={12} value={exportado.texto} />
            <div className="caixa-acoes">
              <button type="button" className="btn" aria-label="Copiar o registro" onClick={() => void copiar()}>
                Copiar
              </button>
              <button type="button" className="btn ghost" aria-label={`Baixar o registro como ${exportado.arquivo}`} onClick={baixar}>
                Baixar (.md)
              </button>
            </div>
            <p className="caixa-meta">Uma cópia ficou salva no computador, em data/transparencia/{exportado.arquivo}.</p>
          </div>
        )}
        <p className="sr-only" role="status">
          {aviso}
        </p>
      </div>
    </section>
  );
}
