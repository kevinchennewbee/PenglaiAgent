#!/usr/bin/env node
/**
 * shots/dev_proxy.mjs — 官网截图用静态+代理服务器（替代 vite dev，避开端口冲突）。
 *
 * 用法：
 *   PENGLAI_DATA_DIR=/tmp/penglai-shot-workbench/data \
 *   PENGLAI_SHOT_PORT=14173 \
 *     node dev_proxy.mjs <distDir> [listenPort]
 *
 * 行为（与 packages/desktop/vite.config.ts 的 dev 代理同语义）：
 *   /penglai-api    → http://127.0.0.1:$PENGLAI_SHOT_PORT/api（注入 X-Penglai-Token）
 *   /penglai-ws     → ws://127.0.0.1:$PENGLAI_SHOT_PORT/ws（注入 X-Penglai-Token）
 *   /penglai-health → /health
 *   /penglai-home   → { home } JSON
 *   其余            → distDir 静态文件（SPA 回退 index.html）
 *
 * token 从 $PENGLAI_DATA_DIR/host.token 读取，与 vite dev 一致：
 * 凭据只在服务端注入，不进渲染层 JS。
 */

import * as http from "node:http";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";

const distDir = path.resolve(process.argv[2]);
const listenPort = Number(process.argv[3] ?? 1421);
const targetPort = Number(process.env.PENGLAI_SHOT_PORT ?? 14173);
const dataDir = process.env.PENGLAI_DATA_DIR;

function readToken() {
  try {
    return fs.readFileSync(path.join(dataDir, "host.token"), "utf-8").trim();
  } catch {
    return "";
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/penglai-health") {
    const proxy = http.request(
      { host: "127.0.0.1", port: targetPort, path: "/health", method: "GET" },
      (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      },
    );
    proxy.on("error", () => res.writeHead(502).end());
    proxy.end();
    return;
  }
  if (u.pathname === "/penglai-home") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ home: dataDir }));
    return;
  }
  if (u.pathname.startsWith("/penglai-api")) {
    const body = [];
    req.on("data", (c) => body.push(c));
    req.on("end", () => {
      const payload = Buffer.concat(body);
      const proxy = http.request(
        {
          host: "127.0.0.1",
          port: targetPort,
          path: u.pathname.replace(/^\/penglai-api/, "/api") + u.search,
          method: req.method,
          headers: {
            "Content-Type": req.headers["content-type"] ?? "application/json",
            "Content-Length": payload.length,
            "X-Penglai-Token": readToken(),
          },
        },
        (up) => {
          res.writeHead(up.statusCode, up.headers);
          up.pipe(res);
        },
      );
      proxy.on("error", () => res.writeHead(502).end());
      proxy.end(payload);
    });
    return;
  }
  // 静态 + SPA 回退
  let file = path.join(distDir, decodeURIComponent(u.pathname));
  if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(distDir, "index.html");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

// WebSocket 代理（裸 pipe，token 只进请求头，不进入 URL）
server.on("upgrade", (req, socket) => {
  if (!req.url.startsWith("/penglai-ws")) {
    socket.destroy();
    return;
  }
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "";
  const upstreamPath = `/ws${query ? `?${query}` : ""}`;
  const upstream = net.connect(targetPort, "127.0.0.1", () => {
    upstream.write(
      `GET ${upstreamPath} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${targetPort}\r\n` +
        `X-Penglai-Token: ${readToken()}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${req.headers["sec-websocket-key"]}\r\n` +
        `Sec-WebSocket-Version: ${req.headers["sec-websocket-version"] ?? 13}\r\n\r\n`,
    );
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
});

server.listen(listenPort, () => {
  console.log(`[shots] dev proxy on http://localhost:${listenPort} → host :${targetPort}`);
});
