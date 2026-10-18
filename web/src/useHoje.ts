import { useEffect, useState } from "react";
import { hojeLocal } from "./pendenciasLogic";

/** o dia local de hoje (AAAA-MM-DD), conferido a cada minuto: a urgência de um prazo vira à meia-noite */
const CONFERE_DIA_MS = 60_000;

export function useHoje(): string {
  const [hoje, setHoje] = useState(() => hojeLocal());
  useEffect(() => {
    const t = setInterval(() => setHoje(hojeLocal()), CONFERE_DIA_MS);
    return () => clearInterval(t);
  }, []);
  return hoje;
}
