import { useEffect, useRef, useState } from "react";
import type { Agent, CaixaItem, FeedItem, MissoesInfo, Progress, ReuniaoAtiva, Roster, ServerMessage } from "../../shared/types";

export type Conn = "conectando" | "online" | "offline";

/** aviso de ata nova (mensagem `ata-nova` do servidor): só texto fixo e hora, nunca o título */
export interface AtaNova {
  seq: number;
  texto: string;
  hora: string;
}

type ChatHandler = (fromId: string, toId: string, text: string) => void;

/**
 * Reconectou (o servidor reiniciou) e o snapshot veio vazio: os bonecos ficam esse tempo antes de
 * sair, esperando o estado voltar (um snapshot com gente ou eventos deles cancelam a saída)
 */
const HOLD_EMPTY_MS = 5000;

/** Conecta no servidor via WebSocket e mantém a lista de agentes, o feed, o elenco e o quadro de etapas. Reconecta sozinho. */
export function useOffice(onChat: ChatHandler) {
  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [missoes, setMissoes] = useState<MissoesInfo | null>(null);
  const [reuniao, setReuniao] = useState<ReuniaoAtiva | null>(null);
  const [caixa, setCaixa] = useState<CaixaItem[] | null>(null);
  /** a última ata lida sem IA: `seq` muda a cada ata (mesmo texto e hora repetidos disparam de novo) */
  const [ataNova, setAtaNova] = useState<AtaNova | null>(null);
  const [conn, setConn] = useState<Conn>("conectando");
  const chatRef = useRef(onChat);
  chatRef.current = onChat;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  // garantia na primeira carga: o servidor também manda as missões ao conectar, mas isto cobre a corrida
  useEffect(() => {
    let vivo = true;
    fetch("/api/missoes")
      .then((r) => (r.ok ? (r.json() as Promise<MissoesInfo>) : null))
      .then((info) => {
        // o que veio pelo WebSocket (mais novo) não é sobrescrito
        if (vivo && info) setMissoes((atual) => atual ?? info);
      })
      .catch(() => undefined);
    fetch("/api/caixa")
      .then((r) => (r.ok ? (r.json() as Promise<{ itens: CaixaItem[] }>) : null))
      .then((corpo) => {
        if (vivo && corpo && Array.isArray(corpo.itens)) setCaixa((atual) => atual ?? corpo.itens);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;
    /** já recebeu um snapshot nesta página: o próximo primeiro snapshot de uma conexão é reconexão */
    let hadSnapshot = false;
    /** ids segurados depois de um snapshot vazio na reconexão, e o timer que os tira */
    let held = new Set<string>();
    let holdTimer: ReturnType<typeof setTimeout> | undefined;

    const dropHeld = () => {
      clearTimeout(holdTimer);
      const ids = held;
      held = new Set();
      if (!ids.size) return;
      setAgents((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
    };

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      let firstMessage = true;
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => setConn("online");
      ws.onclose = () => {
        setConn("offline");
        if (!closed) retry = setTimeout(connect, 1500);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        const wasFirst = firstMessage;
        firstMessage = false;
        switch (msg.type) {
          case "snapshot": {
            const reconnect = hadSnapshot && wasFirst;
            hadSnapshot = true;
            clearTimeout(holdTimer);
            const current = Object.keys(agentsRef.current);
            if (reconnect && msg.agents.length === 0 && current.length > 0) {
              // servidor acabou de subir sem estado (ainda): não manda todo mundo embora de cara
              held = new Set(current);
              holdTimer = setTimeout(dropHeld, HOLD_EMPTY_MS);
            } else {
              held = new Set();
              setAgents(Object.fromEntries(msg.agents.map((a) => [a.id, a])));
            }
            setFeed(msg.feed);
            if (msg.roster) setRoster(msg.roster);
            setProgress(msg.progress ?? null);
            setReuniao(msg.reuniao ?? null);
            break;
          }
          case "missoes":
            setMissoes(msg.info);
            break;
          case "caixa":
            setCaixa(msg.itens);
            break;
          case "ata-nova":
            setAtaNova((prev) => ({ seq: (prev?.seq ?? 0) + 1, texto: msg.texto, hora: msg.hora }));
            break;
          case "reuniao":
            setReuniao(msg.reuniao);
            break;
          case "progress":
            setProgress(msg.progress);
            break;
          case "roster":
            setRoster(msg.roster);
            break;
          case "agent":
            held.delete(msg.agent.id);
            setAgents((prev) => ({ ...prev, [msg.agent.id]: msg.agent }));
            break;
          case "remove":
            held.delete(msg.id);
            setAgents((prev) => {
              const next = { ...prev };
              delete next[msg.id];
              return next;
            });
            break;
          case "feed":
            setFeed((prev) => [...prev.slice(-150), msg.item]);
            break;
          case "chat":
            chatRef.current(msg.fromId, msg.toId, msg.text);
            break;
        }
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearTimeout(holdTimer);
      ws?.close();
    };
  }, []);

  return { agents, feed, roster, progress, missoes, reuniao, caixa, ataNova, conn };
}
