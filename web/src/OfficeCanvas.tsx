import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Agent, Progress, ReuniaoAtiva, Roster } from "../../shared/types";
import { OfficeEngine } from "./office/engine";
import { H, W } from "./office/map";
import { type Camera, type Fit, Z_MAX, Z_MIN, clampCamera, fitCamera, rubberBand, snapZoom, zoomAt } from "./office/camera";

export interface OfficeHandle {
  chat: (fromId: string, toId: string, text: string) => void;
  /** o que o AGzinho está fazendo no descanso ("Tomando café"...), ou null se não está descansando */
  restLabel: (id: string) => string | null;
  /** algum AGzinho está sentado digitando (alimenta o som do teclado) */
  alguemDigitando: () => boolean;
}

interface Props {
  agents: Agent[];
  roster: Roster | null;
  /** quadro de etapas na parede */
  progress: Progress | null;
  /** reunião (/reuniao) em curso: o líder apresenta e os ociosos sentam em volta da mesa */
  reuniao: ReuniaoAtiva | null;
  /** nome da missão que nasceu da reunião (vai pro quadro da parede) */
  missao: string | null;
  /** quantas pendências estão atrasadas: com 1 ou mais, um AGzinho de boa segura a plaquinha de aviso */
  atrasadas: number;
  /** modo apresentação: o escritório ocupa todo o palco em escala fracionada (sem os degraus de escala inteira) */
  ampliar?: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** false: o loop de desenho para (sem requestAnimationFrame) até voltar a true. Padrão: sempre ativo. */
  ativo?: boolean;
}

const Z_STEP = 1.25; // botões e teclado
const FIT_PAD = 8; // respiro pra moldura do canvas não ser cortada
const DRAG_THRESHOLD = 5; // px: abaixo disso é clique, acima é arraste
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 24;
const KEY_PAN = 80;
const LERP_RATE = 14; // 1/s do zoom animado
const FRICTION = 5; // 1/s da inércia
const RUBBER = 0.35; // resistência do arraste além do limite
const SPRING_K = 180; // mola que devolve a câmera ao limite
const SPRING_D = 2 * Math.sqrt(SPRING_K); // amortecimento crítico
const VELOCITY_WINDOW = 100; // ms usados pra medir a velocidade de soltura
const K_MAX = 8; // teto da resolução interna do canvas (W*k px de largura) pra não estourar memória
const MAX_PIXELS = 16e6; // Safari/iOS deixa o canvas em branco acima de ~16,7 Mpx

export const OfficeCanvas = forwardRef<OfficeHandle, Props>(function OfficeCanvas({ agents, roster, progress, reuniao, missao, atrasadas, ampliar = false, selectedId, onSelect, ativo = true }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<OfficeEngine>();
  if (!engineRef.current) engineRef.current = new OfficeEngine();
  const engine = engineRef.current;

  // câmera atual e alvo (animado por lerp no loop); sem setState por quadro
  const fitRef = useRef<Fit>({ cw: W, ch: H, ww: W, wh: H });
  const camRef = useRef<Camera>({ x: 0, y: 0, z: 1 });
  const targetRef = useRef<Camera | null>(null);
  const velRef = useRef({ x: 0, y: 0 });
  const dirtyRef = useRef(true);
  const reducedRef = useRef(false);
  const ampliarRef = useRef(ampliar);
  ampliarRef.current = ampliar;
  const labelRef = useRef<HTMLSpanElement>(null);
  const baseKRef = useRef(1); // resolução mínima do canvas (zoom 1)
  const rawRef = useRef({ x: 0, y: 0 }); // posição "solta" do arraste, antes da resistência elástica
  const tapTimer = useRef<number | undefined>();
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // só os botões re-renderizam (e só quando habilitam/desabilitam); o "ZOOM n%" é escrito direto no DOM
  const [ui, setUi] = useState({ canIn: true, canOut: true });

  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({
    moved: false,
    startX: 0,
    startY: 0,
    samples: [] as { t: number; x: number; y: number }[],
    lastTap: { t: 0, x: 0, y: 0 },
    dragging: false,
  });

  useImperativeHandle(
    ref,
    () => ({ chat: (a, b, t) => engine.chat(a, b, t), restLabel: (id) => engine.restLabel(id), alguemDigitando: () => engine.alguemDigitando() }),
    [engine],
  );

  useEffect(() => engine.sync(agents), [agents, engine]);
  useEffect(() => {
    engine.roster = roster;
  }, [roster, engine]);
  useEffect(() => {
    engine.progress = progress;
  }, [progress, engine]);
  useEffect(() => {
    engine.reuniao = reuniao;
  }, [reuniao, engine]);
  useEffect(() => {
    engine.missao = missao;
  }, [missao, engine]);
  useEffect(() => {
    engine.atrasadas = atrasadas;
  }, [atrasadas, engine]);
  useEffect(() => {
    engine.selectedId = selectedId;
  }, [selectedId, engine]);

  /** aplica uma câmera (limitada). Animado: vira alvo do lerp; senão aplica direto */
  const setCamera = (c: Camera, animate: boolean) => {
    const clamped = clampCamera(c, fitRef.current);
    velRef.current = { x: 0, y: 0 };
    if (animate && !reducedRef.current) {
      targetRef.current = clamped;
    } else {
      targetRef.current = null;
      camRef.current = clamped;
      dirtyRef.current = true;
    }
  };
  const baseCam = () => targetRef.current ?? camRef.current;
  const wrapPoint = (clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return [clientX - r.left, clientY - r.top] as const;
  };
  const zoomBy = (factor: number, px?: number, py?: number, snap = true) => {
    const f = fitRef.current;
    const c = baseCam();
    const next = c.z * factor;
    // em repouso, tenta um degrau que deixe os pixels uniformes (só se ele de fato anda na direção pedida)
    const snapped = snap ? snapZoom(next, f, window.devicePixelRatio || 1, W) : next;
    const z = (snapped - c.z) * (next - c.z) > 1e-6 ? snapped : next;
    setCamera(zoomAt(c, z, px ?? f.ww / 2, py ?? f.wh / 2, f), true);
  };
  const reset = () => setCamera(fitCamera(fitRef.current), true);

  // Tamanho em escala inteira: o canvas tem tamanho fixo de "ajuste à tela" (zoom 1); se a planta base
  // (W x H) cabe no palco, k = maior inteiro com W*k pixels de tela cabendo e o canvas aparece 1:1.
  // Em tela estreita (celular) é reduzido pelo CSS, com k arredondado pra cima. O zoom é só CSS transform.
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    reducedRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let first = true;
    const resize = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const fitCss = Math.max(1, Math.min(width - 2 * FIT_PAD, ((height - 2 * FIT_PAD) * W) / H));
      const fits = !ampliarRef.current && fitCss >= W - 1e-6;
      const k = fits ? Math.floor((fitCss * dpr) / W + 1e-6) : Math.max(1, Math.ceil((fitCss * dpr) / W - 1e-6));
      const cssW = fits ? (W * k) / dpr : Math.max(200, fitCss);
      const old = fitRef.current;
      const nf: Fit = { cw: cssW, ch: (cssW * H) / W, ww: width, wh: height };
      baseKRef.current = k; // o loop de animação é quem redimensiona o canvas (e redesenha no mesmo quadro)
      canvas.style.width = `${nf.cw}px`;
      canvas.style.height = `${nf.ch}px`;
      fitRef.current = nf;
      const c = camRef.current;
      if (first) {
        camRef.current = fitCamera(nf);
        first = false;
      } else {
        // reenquadra mantendo o ponto do escritório que estava no centro do palco
        const u = (old.ww / 2 - c.x) / (old.cw * c.z);
        const v = (old.wh / 2 - c.y) / (old.ch * c.z);
        camRef.current = clampCamera({ z: c.z, x: nf.ww / 2 - u * nf.cw * c.z, y: nf.wh / 2 - v * nf.ch * c.z }, nf);
        targetRef.current = null;
      }
      dirtyRef.current = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    return () => ro.disconnect();
  }, []);

  // zoom pela roda (e pinça do trackpad, que chega como wheel + ctrlKey): precisa de listener nativo não passivo
  useEffect(() => {
    const wrap = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? fitRef.current.wh : 1;
      // roda de mouse chega em passos grandes (±100 ou em linhas); pinça de trackpad, em deltas pequenos
      const mouse = e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && e.deltaY % 100 === 0);
      const pinch = e.ctrlKey && !mouse;
      const lim = pinch ? 30 : 100;
      const dy = Math.max(-lim, Math.min(lim, e.deltaY * unit));
      const [px, py] = wrapPoint(e.clientX, e.clientY);
      zoomBy(Math.exp(-dy * (pinch ? 0.01 : 0.0015)), px, py, false); // roda: sem snap, passos pequenos fluem
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
    // handlers só mexem em refs: não precisam entrar nas dependências
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // loop de animação (também move a câmera: zoom animado e inércia)
  useEffect(() => {
    if (!ativo) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let shown = { pct: 100, canIn: true, canOut: true };
    const label = labelRef.current;
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const cam = camRef.current;
      const tgt = targetRef.current;
      if (tgt) {
        const a = 1 - Math.exp(-LERP_RATE * dt);
        // zoom em escala logarítmica: acelera igual aproximando e afastando
        const z = cam.z * Math.pow(tgt.z / cam.z, a);
        const next = { z, x: cam.x + (tgt.x - cam.x) * a, y: cam.y + (tgt.y - cam.y) * a };
        const done = Math.abs(Math.log(tgt.z / z)) < 0.002 && Math.abs(tgt.x - next.x) < 0.3 && Math.abs(tgt.y - next.y) < 0.3;
        camRef.current = done ? tgt : next;
        if (done) targetRef.current = null;
        dirtyRef.current = true;
      } else if (!gesture.current.dragging && ptrs.current.size === 0) {
        const v = velRef.current;
        const lim = clampCamera(cam, fitRef.current);
        const out = cam.x !== lim.x || cam.y !== lim.y;
        if (out && reducedRef.current) {
          camRef.current = lim; // sem animação: aplica o limite direto
          velRef.current = { x: 0, y: 0 };
          dirtyRef.current = true;
        } else if (out || Math.hypot(v.x, v.y) > 10) {
          // inércia com atrito dentro dos limites; fora deles, uma mola devolve a câmera (sem parada seca)
          const axis = (pos: number, vel: number, to: number) => {
            const over = pos - to;
            if (Math.abs(over) < 1e-3) return [pos + vel * dt, vel * Math.exp(-FRICTION * dt)] as const;
            const nv = vel + (-over * SPRING_K - vel * SPRING_D) * dt;
            const np = pos + nv * dt;
            return Math.abs(np - to) < 0.3 && Math.abs(nv) < 10 ? ([to, 0] as const) : ([np, nv] as const);
          };
          const [nx, nvx] = axis(cam.x, v.x, lim.x);
          const [ny, nvy] = axis(cam.y, v.y, lim.y);
          camRef.current = { ...cam, x: nx, y: ny };
          velRef.current = { x: nvx, y: nvy };
          dirtyRef.current = true;
        } else if (v.x || v.y) {
          velRef.current = { x: 0, y: 0 };
        }
      }
      if (dirtyRef.current) {
        dirtyRef.current = false;
        const c = camRef.current;
        canvas.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.z})`;
        const t = (targetRef.current ?? c).z;
        const s = { pct: Math.round(c.z * 100), canIn: t < Z_MAX - 1e-3, canOut: t > Z_MIN + 1e-3 };
        if (s.pct !== shown.pct && label) label.textContent = `ZOOM ${s.pct}%`;
        if (s.canIn !== shown.canIn || s.canOut !== shown.canOut) setUi({ canIn: s.canIn, canOut: s.canOut });
        shown = s;
      }
      // resolução acompanha o zoom: sem isso o canvas pequeno é só esticado pelo CSS e fica borrado
      const dpr = window.devicePixelRatio || 1;
      const kCap = Math.max(baseKRef.current, Math.min(K_MAX, Math.floor(Math.sqrt(MAX_PIXELS / (W * H)))));
      // usa o zoom de destino: k sobe uma vez só no começo da animação, não a cada degrau inteiro do lerp
      const zNeed = Math.max(camRef.current.z, targetRef.current?.z ?? 0);
      const want = Math.max(baseKRef.current, Math.min(kCap, Math.ceil((fitRef.current.cw * zNeed * dpr) / W - 1e-6)));
      let k = Number(canvas.dataset.scale || 0);
      // sobe na hora (nitidez); desce só com a câmera assentada (sem animação, arraste ou pinça em curso)
      const settled = !targetRef.current && !gesture.current.dragging && ptrs.current.size === 0;
      if (!k || want > k || (want < k && settled)) {
        k = want;
        canvas.width = W * k;
        canvas.height = H * k;
        canvas.dataset.scale = String(k);
      }
      ctx.setTransform(k, 0, 0, k, 0, 0);
      engine.update(dt, now);
      engine.render(ctx, now);
      raf = requestAnimationFrame(frame);
    };
    // espera as fontes pixel carregarem pra não piscar texto errado
    document.fonts.ready.then(() => (raf = requestAnimationFrame(frame)));
    return () => cancelAnimationFrame(raf);
  }, [engine, ativo]);

  const toBase = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [((clientX - r.left) / r.width) * W, ((clientY - r.top) / r.height) * H] as const;
  };

  const pinchInfo = () => {
    const [a, b] = [...ptrs.current.values()];
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button > 1) return;
    if (e.button === 1) e.preventDefault(); // sem o autoscroll do botão do meio
    e.currentTarget.setPointerCapture(e.pointerId);
    const g = gesture.current;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    targetRef.current = null; // tocar interrompe a animação
    velRef.current = { x: 0, y: 0 };
    rawRef.current = { x: camRef.current.x, y: camRef.current.y };
    if (ptrs.current.size === 1) {
      g.moved = e.button === 1; // botão do meio nunca seleciona
      g.startX = e.clientX;
      g.startY = e.clientY;
      g.samples = [{ t: performance.now(), x: e.clientX, y: e.clientY }];
    } else {
      g.moved = true; // dois dedos nunca é clique
      g.samples = [];
    }
    g.dragging = false;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const p = ptrs.current.get(e.pointerId);
    if (!p) {
      // hover (mouse sem botão apertado)
      const id = engine.hitTest(...toBase(e.clientX, e.clientY));
      engine.hoverId = id;
      e.currentTarget.style.cursor = id ? "pointer" : "";
      return;
    }
    const f = fitRef.current;
    if (ptrs.current.size >= 2) {
      const before = pinchInfo();
      p.x = e.clientX;
      p.y = e.clientY;
      const now = pinchInfo();
      const [mx, my] = wrapPoint(now.mx, now.my);
      const [bx, by] = wrapPoint(before.mx, before.my);
      const c = camRef.current;
      // zoom ancorado no ponto médio anterior + pan pelo deslocamento do ponto médio
      const zc = zoomAt(c, c.z * (now.d / before.d), bx, by, f);
      camRef.current = clampCamera({ ...zc, x: zc.x + (mx - bx), y: zc.y + (my - by) }, f);
      rawRef.current = { x: camRef.current.x, y: camRef.current.y };
      dirtyRef.current = true;
      if (!g.dragging) e.currentTarget.style.cursor = ""; // o grabbing do CSS deve valer
      g.dragging = true;
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > DRAG_THRESHOLD) g.moved = true;
    if (!g.moved) return;
    if (!g.dragging) e.currentTarget.style.cursor = ""; // limpa o "pointer" inline do hover
    g.dragging = true;
    engine.hoverId = null;
    // arraste elástico: a posição "solta" segue o dedo; a exibida sofre resistência além do limite
    const raw = rawRef.current;
    raw.x += dx;
    raw.y += dy;
    camRef.current = rubberBand({ z: camRef.current.z, x: raw.x, y: raw.y }, f, RUBBER);
    dirtyRef.current = true;
    const now = performance.now();
    g.samples.push({ t: now, x: e.clientX, y: e.clientY });
    while (g.samples.length > 2 && now - g.samples[0].t > VELOCITY_WINDOW) g.samples.shift();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!ptrs.current.delete(e.pointerId)) return;
    const isUp = e.type === "pointerup";
    const wasClick = !g.moved && ptrs.current.size === 0 && isUp;
    if (ptrs.current.size === 1) {
      // sobrou um dedo: continua como arraste, sem inércia e sem salto
      g.samples = [];
      rawRef.current = { x: camRef.current.x, y: camRef.current.y };
    }
    if (ptrs.current.size === 0) {
      g.dragging = false;
      const s = g.samples;
      if (g.moved && isUp && !reducedRef.current && s.length >= 2) {
        const span = (s[s.length - 1].t - s[0].t) / 1000;
        const idle = (performance.now() - s[s.length - 1].t) / 1000;
        if (span > 0.01 && idle < 0.08) velRef.current = { x: (s[s.length - 1].x - s[0].x) / span, y: (s[s.length - 1].y - s[0].y) / span };
      }
      g.samples = [];
      if (reducedRef.current) {
        camRef.current = clampCamera(camRef.current, fitRef.current); // sem animação: limite direto
        dirtyRef.current = true;
      } // senão, o loop devolve a câmera ao limite com a mola
    }
    if (!wasClick) return;
    const now = performance.now();
    const lt = g.lastTap;
    if (now - lt.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < DOUBLE_TAP_DIST) {
      // 2º toque: cancela a seleção adiada; duplo toque só dá zoom
      window.clearTimeout(tapTimer.current);
      tapTimer.current = undefined;
      g.lastTap = { t: 0, x: 0, y: 0 };
      const [px, py] = wrapPoint(e.clientX, e.clientY);
      const c = baseCam();
      if (c.z > 1.05) reset();
      else setCamera(zoomAt(c, 2, px, py, fitRef.current), true);
      return;
    }
    g.lastTap = { t: now, x: e.clientX, y: e.clientY };
    const id = engine.hitTest(...toBase(e.clientX, e.clientY));
    // adia a seleção até saber se vem um 2º toque (duplo toque = zoom, não seleciona)
    window.clearTimeout(tapTimer.current);
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = undefined;
      onSelectRef.current(id === selectedRef.current ? null : id);
    }, DOUBLE_TAP_MS);
  };

  useEffect(() => () => window.clearTimeout(tapTimer.current), []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const c = baseCam();
    const pan: Record<string, [number, number]> = {
      ArrowLeft: [KEY_PAN, 0],
      ArrowRight: [-KEY_PAN, 0],
      ArrowUp: [0, KEY_PAN],
      ArrowDown: [0, -KEY_PAN],
    };
    if (pan[e.key]) setCamera({ ...c, x: c.x + pan[e.key][0], y: c.y + pan[e.key][1] }, true);
    else if (e.key === "+" || e.key === "=") zoomBy(Z_STEP);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / Z_STEP);
    else if (e.key === "0") reset();
    else return;
    e.preventDefault();
  };

  return (
    <div className="office-zoom-host">
      <div
        className="office-wrap office-wrap-zoom"
        ref={wrapRef}
        tabIndex={0}
        role="group"
        aria-label="Escritório. Arraste para mover, use a roda ou dois dedos para o zoom. Teclado: setas movem, mais e menos dão zoom, zero ajusta à tela."
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={(e) => {
          ptrs.current.delete(e.pointerId);
          if (ptrs.current.size === 0) gesture.current.dragging = false;
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse" && !ptrs.current.has(e.pointerId)) engine.hoverId = null;
        }}
        onAuxClick={(e) => e.preventDefault()}
      >
        <canvas ref={canvasRef} className="office-canvas" />
      </div>
      <div className="zoom-controls" role="group" aria-label="Zoom do escritório">
        <span className="zoom-rotulo" aria-hidden="true" ref={labelRef}>ZOOM 100%</span>
        <div className="zoom-botoes">
          <button type="button" title="Diminuir" aria-label="Diminuir zoom" disabled={!ui.canOut} onClick={() => zoomBy(1 / Z_STEP)}>−</button>
          <button type="button" title="Ajustar à tela" aria-label="Ajustar à tela" onClick={reset}>Ajustar</button>
          <button type="button" title="Aumentar" aria-label="Aumentar zoom" disabled={!ui.canIn} onClick={() => zoomBy(Z_STEP)}>+</button>
        </div>
      </div>
    </div>
  );
});
