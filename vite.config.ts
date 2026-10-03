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
      "/api": API,
      "/ws": { target: API.replace("http", "ws"), ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
