import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 127.0.0.1 e não localhost: no Windows o localhost pode resolver para ::1 e o servidor só ouve IPv4
const API = `http://127.0.0.1:${process.env.PORT ?? 4747}`;

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // o POST de aprovação só aceita Origin do próprio servidor: no dev o navegador manda o da porta 5173,
      // então o proxy troca pelo do servidor (sem isso a Caixa de entrada daria 403 no dev)
      "/api": {
        target: API,
        configure: (proxy) => {
          proxy.on("proxyReq", (req) => {
            if (req.getHeader("origin")) req.setHeader("origin", API);
          });
        },
      },
      "/ws": { target: API.replace("http", "ws"), ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
