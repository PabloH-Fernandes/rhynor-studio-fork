import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Agent, Roster } from "../../shared/types";
import { OfficeEngine } from "./office/engine";
import { H, W } from "./office/map";

export interface OfficeHandle {
  chat: (fromId: string, toId: string, text: string) => void;
}

interface Props {
  agents: Agent[];
  roster: Roster | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export const OfficeCanvas = forwardRef<OfficeHandle, Props>(function OfficeCanvas({ agents, roster, selectedId, onSelect }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<OfficeEngine>();
  if (!engineRef.current) engineRef.current = new OfficeEngine();
  const engine = engineRef.current;

  useImperativeHandle(ref, () => ({ chat: (a, b, t) => engine.chat(a, b, t) }), [engine]);

  useEffect(() => engine.sync(agents), [agents, engine]);
  useEffect(() => {
    engine.roster = roster;
  }, [roster, engine]);
  useEffect(() => {
    engine.selectedId = selectedId;
  }, [selectedId, engine]);

  // tamanho: ocupa o espaço disponível mantendo a proporção e os pixels nítidos
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const resize = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const cssW = Math.max(200, Math.min(width, (height * W) / H));
      const dpr = window.devicePixelRatio || 1;
      const k = Math.max(1, Math.round((cssW * dpr) / W));
      canvas.width = W * k;
      canvas.height = H * k;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${(cssW * H) / W}px`;
      canvas.dataset.scale = String(k);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    return () => ro.disconnect();
  }, []);

  // loop de animação
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const k = Number(canvas.dataset.scale || 1);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      engine.update(dt, now);
      engine.render(ctx, now);
      raf = requestAnimationFrame(frame);
    };
    // espera as fontes pixel carregarem pra não piscar texto errado
    document.fonts.ready.then(() => (raf = requestAnimationFrame(frame)));
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  const toBase = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H] as const;
  };

  return (
    <div className="office-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="office-canvas"
        onMouseMove={(e) => {
          const id = engine.hitTest(...toBase(e));
          engine.hoverId = id;
          e.currentTarget.style.cursor = id ? "pointer" : "default";
        }}
        onMouseLeave={() => (engine.hoverId = null)}
        onClick={(e) => {
          const id = engine.hitTest(...toBase(e));
          onSelect(id === selectedId ? null : id);
        }}
      />
    </div>
  );
});
