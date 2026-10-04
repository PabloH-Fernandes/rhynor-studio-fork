import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Agent, Roster } from "../../shared/types";
import { OfficeEngine } from "./office/engine";
import { H, W } from "./office/map";

export interface OfficeHandle {
  chat: (fromId: string, toId: string, text: string) => void;
  /** o que o AGzinho está fazendo no descanso ("Tomando café"...), ou null se não está descansando */
  restLabel: (id: string) => string | null;
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

  useImperativeHandle(
    ref,
    () => ({ chat: (a, b, t) => engine.chat(a, b, t), restLabel: (id) => engine.restLabel(id) }),
    [engine],
  );

  useEffect(() => engine.sync(agents), [agents, engine]);
  useEffect(() => {
    engine.roster = roster;
  }, [roster, engine]);
  useEffect(() => {
    engine.selectedId = selectedId;
  }, [selectedId, engine]);

  // Tamanho em escala inteira: se a planta base (W x H) cabe no palco, k = maior inteiro com W*k pixels
  // de tela cabendo, e o canvas aparece com exatamente W*k pixels de tela (1:1, todo pixel da arte do
  // mesmo tamanho). Em tela estreita, onde nem W pixels CSS cabem (celular), ele é reduzido pelo CSS
  // pra ocupar a largura, com k arredondado pra cima pra não perder nitidez.
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const resize = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const fitCss = Math.min(width, (height * W) / H);
      const fits = fitCss >= W - 1e-6;
      const k = fits ? Math.floor((fitCss * dpr) / W + 1e-6) : Math.max(1, Math.ceil((fitCss * dpr) / W - 1e-6));
      const cssW = fits ? (W * k) / dpr : Math.max(200, fitCss);
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
