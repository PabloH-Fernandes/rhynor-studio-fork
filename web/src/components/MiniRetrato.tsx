// Retratinho pixel art do Personagem na lista do time (o mesmo busto do crachá, menor).

import { useLayoutEffect, useMemo, useRef } from "react";
import type { Agent, Roster } from "../../../shared/types";
import { lookFor } from "../office/engine";
import { PORTRAIT_H, PORTRAIT_W, drawPortrait } from "../office/sprites";
import { useDevicePixelRatio } from "./Cracha";

const ESCALA = 2;

export function MiniRetrato({ agent, roster }: { agent: Agent; roster: Roster | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const look = useMemo(() => lookFor(agent, roster), [agent.id, agent.personagem, agent.role, roster]);
  const dpr = useDevicePixelRatio();

  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // pixels de tela por pixel da arte sempre inteiros
    const k = Math.max(1, Math.round(ESCALA * dpr));
    canvas.width = PORTRAIT_W * k;
    canvas.height = PORTRAIT_H * k;
    canvas.style.width = `${(PORTRAIT_W * k) / dpr}px`;
    canvas.style.height = `${(PORTRAIT_H * k) / dpr}px`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPortrait(ctx, look, k);
  }, [look, dpr]);

  // decorativo: o nome vem logo ao lado
  return <canvas ref={ref} className="mini-retrato" aria-hidden="true" width={PORTRAIT_W * ESCALA} height={PORTRAIT_H * ESCALA} />;
}
