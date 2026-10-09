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

/**
 * Texto lembrado neste navegador (projeto escolhido no painel...). Mesmo cuidado do
 * `usePreferencia`: sem storage, vale o padrao. Quem le decide se o valor ainda serve; gravar
 * outra coisa e a unica forma de mudar o que ficou salvo.
 */
export function usePreferenciaTexto(chave: string, padrao: string): [string, (v: string) => void] {
  const [valor, setValor] = useState(() => {
    try {
      return window.localStorage.getItem(chave) ?? padrao;
    } catch {
      return padrao;
    }
  });
  const gravar = useCallback(
    (v: string) => {
      setValor(v);
      try {
        window.localStorage.setItem(chave, v);
      } catch {
        // sem storage: so nao lembra
      }
    },
    [chave],
  );
  return [valor, gravar];
}
