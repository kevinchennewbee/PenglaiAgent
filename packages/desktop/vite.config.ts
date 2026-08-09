import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Vite config for the Penglai 0.4 desktop React shell.
// The build emits to dist/ which tauri.conf.json uses as frontendDist.
// In dev, Vite serves on :1420 (tauri.conf.json devUrl) and Tauri opens it;
// the Rust side separately spawns the TS Host on :14169.
//
// Plain-browser dev (`npm run dev` without Tauri) uses the HTTP bridge:
// the dev server proxies /penglai-api and /penglai-ws to the Host and
// injects the loopback token server-side, so the credential still never
// reaches renderer JS. /penglai-home mirrors the native penglai_home
// command for the chat workspace anchor.

const hostPort = Number(process.env.PENGLAI_HOST_PORT ?? "14169");
const HOST = `http://127.0.0.1:${hostPort}`;
const HOST_WS = `ws://127.0.0.1:${hostPort}`;

function penglaiDataDir(): string {
  const configured = process.env.PENGLAI_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), ".penglai");
}

function readHostToken(): string {
  try {
    return fs.readFileSync(path.join(penglaiDataDir(), "host.token"), "utf-8").trim();
  } catch {
    return "";
  }
}

function penglaiDevBridge(): Plugin {
  return {
    name: "penglai-dev-bridge",
    configureServer(server) {
      server.middlewares.use("/penglai-home", (_req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ home: penglaiDataDir() }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), penglaiDevBridge()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      "/penglai-health": {
        target: HOST,
        changeOrigin: true,
        rewrite: () => "/health",
      },
      "/penglai-api": {
        target: HOST,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/penglai-api/, "/api"),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            const token = readHostToken();
            if (token) proxyReq.setHeader("X-Penglai-Token", token);
          });
        },
      },
      "/penglai-ws": {
        target: HOST_WS,
        ws: true,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/penglai-ws/, "/ws"),
        configure: (proxy) => {
          proxy.on("proxyReqWs", (proxyReq) => {
            const token = readHostToken();
            if (token) proxyReq.setHeader("X-Penglai-Token", token);
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
