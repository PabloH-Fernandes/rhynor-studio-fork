// Modo apresentação: `?apresentacao=1` na URL (tela cheia, painel simplificado, privacidade ligada).
// `&demo=1` junto liga o roteiro automático de demonstração; sozinho (`?demo=1`) não faz nada.

export interface FlagsApresentacao {
  apresentacao: boolean;
  demo: boolean;
}

/** lê as flags de uma query string ("?apresentacao=1&demo=1"); só o valor exato "1" liga */
export function lerFlags(search: string): FlagsApresentacao {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { apresentacao: false, demo: false };
  }
  const apresentacao = params.get("apresentacao") === "1";
  return { apresentacao, demo: apresentacao && params.get("demo") === "1" };
}

const flags = lerFlags(typeof window !== "undefined" ? window.location.search : "");

export const APRESENTACAO = flags.apresentacao;
export const DEMO = flags.demo;
