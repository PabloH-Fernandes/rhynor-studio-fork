// Guarda do pedido de simulação (POST /api/demo): vale para a página inteira, não para um componente.
// O ref do hook sobrevive ao StrictMode, mas não a uma remontagem do componente nem ao HMR do Vite.
// Aqui o estado fica no módulo: um pedido só por carregamento da página (recarregar a página reinicia o roteiro,
// e aí o servidor decide se é pedido repetido).

let disparada = false;

/** true na primeira chamada (pode pedir a simulação); false nas seguintes */
export function reservarDisparoDemo(): boolean {
  if (disparada) return false;
  disparada = true;
  return true;
}

/** o pedido falhou (servidor fora do ar): libera para uma nova tentativa */
export function liberarDisparoDemo(): void {
  disparada = false;
}
