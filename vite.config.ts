import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 127.0.0.1 e não localhost: no Windows o localhost pode resolver para ::1 e o servidor só ouve IPv4
const API = `http://127.0.0.1:${process.env.PORT ?? 4747}`;

// o servidor só aceita Origin dele mesmo (POST de aprovação e WebSocket): no dev o navegador manda o da porta
// 5173, então o proxy troca só esse; qualquer outro Origin segue como veio e o servidor recusa
const ORIGENS_DO_DEV = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);

function trocarOrigem(req: { getHeader(n: string): unknown; setHeader(n: string, v: string): unknown }) {
  const origem = req.getHeader("origin");
  if (typeof origem === "string" && ORIGENS_DO_DEV.has(origem)) req.setHeader("origin", API);
}

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // changeOrigin: o Host chega como 127.0.0.1:PORT (o GET /api/caixa confere o Host)
      "/api": {
        target: API,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", trocarOrigem);
        },
      },
      "/ws": {
        target: API.replace("http", "ws"),
        ws: true,
        configure: (proxy) => {
          proxy.on("proxyReqWs", trocarOrigem);
        },
      },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
