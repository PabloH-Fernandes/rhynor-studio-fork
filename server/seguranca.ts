// Proteção dos POSTs do painel que GRAVAM no vault (aprovar, concluir tarefa...). O servidor só ouve em
// 127.0.0.1, mas qualquer página aberta no navegador poderia mandar um POST para ele (CSRF). Duas regras:
//
// 1. Content-Type tem que ser application/json (um formulário de outra página não consegue mandar isso
//    sem passar por uma checagem prévia do navegador, que o servidor não libera);
// 2. se o POST trouxer `Origin` (todo navegador manda), ele tem que ser o próprio painel:
//    http://127.0.0.1:PORT ou http://localhost:PORT. Sem `Origin` (curl, scripts locais) passa.
//
// Use assim: app.post(rota, exigirPostSeguro(() => PORT), express.json({ limit: "16kb" }), handler)

import type { RequestHandler } from "express";

/** O `Origin` é o do painel desta máquina? (a porta tem que ser a do servidor) */
export function origemPermitida(origem: string, porta: number): boolean {
  return origem === `http://127.0.0.1:${porta}` || origem === `http://localhost:${porta}`;
}

/** O `Host` é o desta máquina? (contra DNS rebinding: um site de fora apontando o nome dele para 127.0.0.1) */
export function hostPermitido(host: string | undefined, porta: number): boolean {
  return host === `127.0.0.1:${porta}` || host === `localhost:${porta}`;
}

/** Para GETs que entregam dados do vault: recusa `Host` de fora. */
export function exigirHostLocal(porta: () => number): RequestHandler {
  return (req, res, next) => {
    if (!hostPermitido(req.header("host"), porta())) {
      res.status(403).json({ ok: false, erros: ["Host não aceito"] });
      return;
    }
    next();
  };
}

/**
 * `verifyClient` do WebSocket: com `Origin` (navegador) ele tem que ser o do painel; sem `Origin`
 * (clientes que não são navegador) passa. Evita que uma página qualquer leia a Caixa pelo WebSocket.
 */
export function clienteWsPermitido(porta: () => number): (info: { origin?: string }) => boolean {
  return ({ origin }) => origin === undefined ||origemPermitida(origin, porta());
}

/** "application/json" e "application/json; charset=utf-8" valem; o resto não */
export function ehJson(contentType: string | undefined): boolean {
  return (contentType ?? "").split(";")[0].trim().toLowerCase() === "application/json";
}

export function exigirPostSeguro(porta: () => number): RequestHandler {
  return (req, res, next) => {
    if (!ehJson(req.header("content-type"))) {
      res.status(415).json({ ok: false, erros: ["Envie o pedido como application/json"] });
      return;
    }
    const origem = req.header("origin");
    if (origem !== undefined && !origemPermitida(origem, porta())) {
      res.status(403).json({ ok: false, erros: ["Pedido de outra origem não é aceito"] });
      return;
    }
    next();
  };
}
