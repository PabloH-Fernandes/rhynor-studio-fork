// Quadro de etapas no topo do painel: o mesmo do quadro branco da parede do escritório
// ("Time na Etapa 4 de 7 · Construção de novas funções" e a barra de 10 segmentos).

import type { Progress } from "../../../shared/types";
import { IconeStatus } from "./IconePixel";
import { SEGMENTOS, segmentosCheios, separarContagem, textoDoProgresso } from "../progresso";

export function Progresso({ progress }: { progress: Progress | null }) {
  const t = textoDoProgresso(progress ?? { fonte: "nada", etapa: 0, total: 0, concluidas: 0, titulo: "" });
  const cheios = segmentosCheios(t.valor, t.max);
  // "N de N" (e o ✓) não quebra no meio: em painel estreito desce inteiro pra linha de baixo
  const { frase, contagem } = separarContagem(t.titulo);
  const valorTexto = t.estado === "concluido" ? `${t.max} de ${t.max} etapas concluídas` : `Etapa ${t.valor} de ${t.max}${t.detalhe ? `: ${t.detalhe}` : ""}`;

  return (
    <section className={`progresso progresso-${t.estado}`} aria-label="Andamento do time">
      {/* polite: avisa a troca de etapa sem interromper */}
      <p className="progresso-titulo" aria-live="polite">
        <span className="progresso-frase">
          {frase}
          {contagem && (
            <span className="progresso-contagem">
              {contagem}
              {t.estado === "concluido" && <span aria-hidden="true"> ✓</span>}
            </span>
          )}
          {t.estado === "nada" && (
            <>
              {" "}
              <IconeStatus status="ocioso" />
            </>
          )}
        </span>
        {/* o detalhe vai na linha de baixo; o " · " fica só pro leitor de tela, como uma frase */}
        {t.detalhe && (
          <>
            <span className="sr-only"> · </span>
            <span className="progresso-detalhe">{t.detalhe}</span>
          </>
        )}
      </p>
      {t.max > 0 ? (
        <div className="progresso-linha">
          <div
            className="progresso-barra"
            role="progressbar"
            aria-label="Etapas do trabalho"
            aria-valuemin={0}
            aria-valuemax={t.max}
            aria-valuenow={t.valor}
            aria-valuetext={valorTexto}
          >
            {Array.from({ length: SEGMENTOS }, (_, i) => (
              <i key={i} className={i < cheios ? "cheio" : undefined} />
            ))}
          </div>
          <span className="progresso-num" aria-hidden="true">
            {t.valor}/{t.max}
          </span>
        </div>
      ) : (
        <p className="progresso-nota">
          {t.estado === "papel" ? "Sem lista de tarefas: a fase vem de quem está trabalhando." : "Ninguém trabalhando agora."}
        </p>
      )}
    </section>
  );
}
