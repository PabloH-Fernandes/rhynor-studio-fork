import { useEffect, useRef } from "react";
import { DEFAULT_ROSTER } from "../../shared/roster";
import type { Roster } from "../../shared/types";
import { GALLERY_H, GALLERY_W, drawGallery } from "./office/gallery";

interface Props {
  roster: Roster | null;
}

/** Galeria de conferência dos bonecos (`?galeria=1`): estática, redesenhada quando o elenco muda. */
export function SpriteGallery({ roster }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const personagens = (roster ?? DEFAULT_ROSTER).personagens;

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const w = GALLERY_W;
    const h = GALLERY_H(personagens.length);
    const draw = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      // escala inteira: pixel duro
      const k = Math.max(1, Math.floor(Math.min((width * dpr) / w, (height * dpr) / h)));
      canvas.width = w * k;
      canvas.height = h * k;
      canvas.style.width = `${(w * k) / dpr}px`;
      canvas.style.height = `${(h * k) / dpr}px`;
      canvas.dataset.scale = String(k);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      drawGallery(ctx, personagens);
    };
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    document.fonts.ready.then(draw);
    return () => ro.disconnect();
  }, [personagens]);

  return (
    <div className="office-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="office-canvas sprite-gallery" aria-label="Galeria dos Personagens" />
    </div>
  );
}
