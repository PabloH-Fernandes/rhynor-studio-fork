import { useCallback, useEffect, useState } from "react";

/** o campo de texto precisa das teclas dele: a tecla F não vira tela cheia ali */
function ehCampoDeTexto(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/**
 * Tela cheia do navegador para o modo apresentação. O navegador só aceita `requestFullscreen` dentro de um
 * gesto do usuário (clique ou tecla), por isso a tela cheia nunca começa sozinha: vale o botão ou a tecla F.
 */
export function useTelaCheia(teclaF: boolean): { cheia: boolean; alternar: () => void } {
  const [cheia, setCheia] = useState(() => typeof document !== "undefined" && !!document.fullscreenElement);

  useEffect(() => {
    const atualizar = () => setCheia(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", atualizar);
    return () => document.removeEventListener("fullscreenchange", atualizar);
  }, []);

  const alternar = useCallback(() => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      else void document.documentElement.requestFullscreen().catch(() => undefined);
    } catch {
      // navegador sem tela cheia: o botão simplesmente não faz nada
    }
  }, []);

  useEffect(() => {
    if (!teclaF) return;
    const aoApertar = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || ehCampoDeTexto(e.target)) return;
      if (e.key !== "f" && e.key !== "F") return;
      e.preventDefault();
      alternar();
    };
    window.addEventListener("keydown", aoApertar);
    return () => window.removeEventListener("keydown", aoApertar);
  }, [teclaF, alternar]);

  return { cheia, alternar };
}
