// Liga o roteiro da demonstração à tela. Só funciona com `?apresentacao=1&demo=1`.
// Tudo que a demo mostra nas seções Caixa, Pendências e Resultados é fictício e vive só aqui no navegador.
// O único pedido ao servidor é a simulação de AGzinhos que já existia (POST /api/demo), no passo 4.
// Teclas: espaço pausa/continua o roteiro, seta para a direita avança o passo. A pausa vale só para o roteiro:
// a simulação do servidor, depois que começa, não para.

import { useEffect, useRef, useState } from "react";
import { visaoDoPasso, type VisaoDemo } from "./dadosDemo";
import { criarRoteiro, TOTAL_PASSOS, type EstadoRoteiro, type Roteiro } from "./roteiro";

export interface DemoEstado {
  /** 1 a TOTAL_PASSOS */
  passo: number;
  total: number;
  titulo: string;
  pausado: boolean;
  fim: boolean;
  visao: VisaoDemo;
  /** sobe a cada ata que "chega": o App usa junto do aviso de ata nova de verdade */
  ataSeq: number;
  /** a simulação não começou (servidor fora do ar) */
  erro: boolean;
}

/** a tecla é de um campo de texto ou lista: o roteiro não toma */
function ehCampoDeTexto(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

const TICK_MS = 150;
/** espera um instante para o escritório carregar antes de a ata "chegar" */
const ATRASO_ATA_MS = 800;

export function useDemo(ativo: boolean, hoje: string): DemoEstado | null {
  const roteiroRef = useRef<Roteiro | null>(null);
  if (ativo && !roteiroRef.current) roteiroRef.current = criarRoteiro(() => Date.now());
  const [estado, setEstado] = useState<EstadoRoteiro | null>(() => roteiroRef.current?.estado() ?? null);
  const [ataSeq, setAtaSeq] = useState(0);
  const [erro, setErro] = useState(false);
  const simulacaoIniciada = useRef(false);
  // lido já no primeiro render: a primeira visão da demo (antes de qualquer efeito) também respeita a preferência
  const semAnimacao = useRef(ativo && typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // relógio da tela
  useEffect(() => {
    if (!ativo) return;
    const id = window.setInterval(() => setEstado(roteiroRef.current?.estado() ?? null), TICK_MS);
    return () => window.clearInterval(id);
  }, [ativo]);

  // teclas: capturadas antes de qualquer botão em foco; o espaço não clica no botão
  useEffect(() => {
    if (!ativo) return;
    const agir = (e: KeyboardEvent): boolean => {
      if (e.ctrlKey || e.metaKey || e.altKey || ehCampoDeTexto(e.target)) return false;
      return e.key === " " || e.code === "Space" || e.key === "ArrowRight";
    };
    const aoApertar = (e: KeyboardEvent) => {
      if (!agir(e)) return;
      e.preventDefault();
      if (e.repeat) return;
      const r = roteiroRef.current;
      if (!r) return;
      if (e.key === "ArrowRight") r.avancar();
      else r.alternar();
      setEstado(r.estado());
    };
    // alguns navegadores clicam o botão no keyup do espaço: também segura aqui
    const aoSoltar = (e: KeyboardEvent) => {
      if (agir(e) && e.key !== "ArrowRight") e.preventDefault();
    };
    window.addEventListener("keydown", aoApertar, true);
    window.addEventListener("keyup", aoSoltar, true);
    return () => {
      window.removeEventListener("keydown", aoApertar, true);
      window.removeEventListener("keyup", aoSoltar, true);
    };
  }, [ativo]);

  // passo 1: a ata "chega" (a mesma animação da ata nova de verdade)
  useEffect(() => {
    if (!ativo) return;
    const t = window.setTimeout(() => setAtaSeq((n) => n + 1), ATRASO_ATA_MS);
    return () => window.clearTimeout(t);
  }, [ativo]);

  // passo 4: a simulação do servidor, uma vez só (se o passo 4 for pulado com a seta, começa no 5)
  const indice = estado?.indice ?? -1;
  useEffect(() => {
    if (!ativo || indice < 3 || simulacaoIniciada.current) return;
    simulacaoIniciada.current = true;
    fetch("/api/demo", { method: "POST" })
      .then((r) => {
        if (!r.ok) setErro(true);
      })
      .catch(() => setErro(true));
  }, [ativo, indice]);

  if (!ativo || !estado) return null;
  return {
    passo: estado.passo.n,
    total: TOTAL_PASSOS,
    titulo: estado.passo.titulo,
    pausado: estado.pausado,
    fim: estado.fim,
    visao: visaoDoPasso(estado.passo.n, estado.decorridoMs, hoje, semAnimacao.current),
    ataSeq,
    erro,
  };
}
