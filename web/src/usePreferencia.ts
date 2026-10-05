import { useCallback, useState } from "react";

/**
 * Liga/desliga lembrado neste navegador (seção aberta, detalhes técnicos...).
 * O localStorage pode não existir ou recusar (aba anônima, site bloqueado): aí vale o padrão.
 */
export function usePreferencia(chave: string, padrao: boolean): [boolean, () => void] {
  const [valor, setValor] = useState(() => {
    try {
      const v = window.localStorage.getItem(chave);
      return v === null ? padrao : v === "1";
    } catch {
      return padrao;
    }
  });
  const alternar = useCallback(() => {
    setValor((v) => {
      try {
        window.localStorage.setItem(chave, v ? "0" : "1");
      } catch {
        // sem storage: só não lembra
      }
      return !v;
    });
  }, [chave]);
  return [valor, alternar];
}
