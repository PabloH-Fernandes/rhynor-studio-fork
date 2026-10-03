// prefers-reduced-motion: lido uma vez e atualizado por listener (barato de consultar a cada frame).

const query: MediaQueryList | null =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

let reduced = query?.matches ?? false;

if (query) {
  const onChange = (e: MediaQueryListEvent) => {
    reduced = e.matches;
  };
  // Safari < 14 só tem o addListener (deprecado)
  if (typeof query.addEventListener === "function") query.addEventListener("change", onChange);
  else query.addListener(onChange);
}

export function isReducedMotion(): boolean {
  return reduced;
}
