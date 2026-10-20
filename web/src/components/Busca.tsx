// Seção "Buscar no cérebro" do painel: busca texto no vault (sem IA, só leitura). Nota confidencial aparece
// só pelo título, com cadeado. "Abrir no Obsidian" é um link; "Perguntar ao time" só COPIA o comando /memoria
// para você colar no terminal: o painel nunca roda o Claude. Fora do modo apresentação não há nenhum pedido.

import { useEffect, useRef, useState } from "react";
import { copiarTexto } from "../caixaLogic";
import { APRESENTACAO } from "../apresentacao";
import {
  DEBOUNCE_BUSCA_MS,
  MAX_BUSCA,
  TEXTO_CADEADO,
  TEXTO_DICA,
  TEXTO_MONTANDO,
  RETENTAR_MONTANDO_MS,
  TEXTO_SEM_CEREBRO,
  comandoPergunta,
  consultaDe,
  ehUriObsidian,
  lerRespostaBusca,
  textoContagem,
  textoErroBusca,
  urlBusca,
  type RespostaBuscaLida,
} from "../buscaLogic";

type Estado = { tipo: "ocioso" } | { tipo: "buscando" } | { tipo: "ok"; r: RespostaBuscaLida } | { tipo: "erro"; status: number | null };

const AVISO_COPIA_MS = 3500;

/** na apresentação a busca fica escondida por inteiro (as notas do vault não aparecem na tela) */
export function Busca() {
  if (APRESENTACAO) return null;
  return <BuscaPainel />;
}

function BuscaPainel() {
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<Estado>({ tipo: "ocioso" });
  const [tentativa, setTentativa] = useState(0);
  const [copia, setCopia] = useState<boolean | null>(null);
  const timerCopia = useRef<ReturnType<typeof setTimeout>>();
  const q = consultaDe(texto);

  useEffect(() => () => clearTimeout(timerCopia.current), []);

  useEffect(() => {
    if (q === null) {
      setEstado({ tipo: "ocioso" });
      return;
    }
    const controle = new AbortController();
    let retentar: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      setEstado({ tipo: "buscando" });
      fetch(urlBusca(q), { signal: controle.signal })
        .then(async (r) => {
          const json: unknown = await r.json().catch(() => null);
          const lida = r.ok ? lerRespostaBusca(json) : null;
          if (controle.signal.aborted) return;
          setEstado(lida ? { tipo: "ok", r: lida } : { tipo: "erro", status: r.ok ? 500 : r.status });
          if (lida?.montando) retentar = setTimeout(() => setTentativa((n) => n + 1), RETENTAR_MONTANDO_MS);
        })
        .catch(() => {
          if (!controle.signal.aborted) setEstado({ tipo: "erro", status: null });
        });
    }, DEBOUNCE_BUSCA_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(retentar);
      controle.abort();
    };
  }, [q, tentativa]);

  const perguntar = async () => {
    if (q === null) return;
    const ok = await copiarTexto(comandoPergunta(q));
    setCopia(ok);
    clearTimeout(timerCopia.current);
    timerCopia.current = setTimeout(() => setCopia(null), AVISO_COPIA_MS);
  };

  let aviso = "";
  if (q === null) aviso = texto.trim() ? TEXTO_DICA : "";
  else if (estado.tipo === "buscando") aviso = "Buscando...";
  else if (estado.tipo === "erro") aviso = textoErroBusca(estado.status);
  else if (estado.tipo === "ok") aviso = estado.r.semVault ? TEXTO_SEM_CEREBRO : estado.r.montando ? TEXTO_MONTANDO : textoContagem(estado.r.itens.length, estado.r.total, estado.r.maisResultados);

  return (
    <section className="secao busca" aria-label="Buscar no cérebro">
      <h2>
        <label htmlFor="busca-campo">Buscar no cérebro</label>
      </h2>
      <input
        id="busca-campo"
        className="busca-campo"
        type="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={MAX_BUSCA}
        placeholder="Ex.: orçamento, decisão, prazo"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-describedby="busca-aviso"
      />
      <p id="busca-aviso" className={`caixa-meta busca-aviso${estado.tipo === "erro" && q !== null ? " busca-erro" : ""}`} role="status" aria-live="polite">
        {aviso}
      </p>

      {q !== null && (
        <div className="busca-perguntar">
          <button type="button" className="btn-tecnico" onClick={perguntar}>
            Perguntar ao time
          </button>
          <span className="caixa-meta">Copia o comando /memoria. Cole no terminal para o time responder.</span>
          <p className="caixa-copiado" role="status">
            {copia === null ? "" : copia ? "Copiado!" : "Não deu para copiar sozinho: escreva /memoria e a sua pergunta no terminal."}
          </p>
        </div>
      )}

      {estado.tipo === "ok" && !estado.r.semVault && estado.r.itens.length > 0 && (
        <ul className="caixa-lista busca-lista">
          {estado.r.itens.map((i) => (
            <li key={i.rel} className="caixa-item busca-item">
              <p className="caixa-texto busca-titulo">
                {i.confidencial && <span aria-hidden="true">🔒 </span>}
                {i.titulo}
              </p>
              <p className="caixa-meta busca-rel">{i.rel}</p>
              {i.confidencial ? (
                <p className="caixa-meta busca-conf">
                  <span aria-hidden="true">🔒 </span>
                  {TEXTO_CADEADO}
                </p>
              ) : (
                i.trecho && <p className="caixa-texto busca-trecho">{i.trecho}</p>
              )}
              {ehUriObsidian(i.uri) && (
                <p className="busca-acoes">
                  <a className="btn-tecnico busca-abrir" href={i.uri} aria-label={`Abrir ${i.titulo} no Obsidian`}>
                    Abrir no Obsidian
                  </a>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
