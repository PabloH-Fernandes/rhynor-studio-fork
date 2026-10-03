import { useEffect, useRef, useState } from "react";
import type { Agent, FeedItem, Roster, ServerMessage } from "../../shared/types";

export type Conn = "conectando" | "online" | "offline";

type ChatHandler = (fromId: string, toId: string, text: string) => void;

/** Conecta no servidor via WebSocket e mantém a lista de agentes, o feed e o elenco. Reconecta sozinho. */
export function useOffice(onChat: ChatHandler) {
  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [conn, setConn] = useState<Conn>("conectando");
  const chatRef = useRef(onChat);
  chatRef.current = onChat;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => setConn("online");
      ws.onclose = () => {
        setConn("offline");
        if (!closed) retry = setTimeout(connect, 1500);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        switch (msg.type) {
          case "snapshot":
            setAgents(Object.fromEntries(msg.agents.map((a) => [a.id, a])));
            setFeed(msg.feed);
            if (msg.roster) setRoster(msg.roster);
            break;
          case "roster":
            setRoster(msg.roster);
            break;
          case "agent":
            setAgents((prev) => ({ ...prev, [msg.agent.id]: msg.agent }));
            break;
          case "remove":
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
      ws?.close();
    };
  }, []);

  return { agents, feed, roster, conn };
}
