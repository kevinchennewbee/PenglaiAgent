import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { assertSafeListenHost, exactHostAllowed, exactOriginAllowed, isRecord, PenglaiError } from "@penglai/contracts";
import type { RoutingControlPlane } from "@penglai/routing-core";

export interface ControlServer {
  port: number;
  token: string;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on("data", (c: Buffer) => {
      n += c.length;
      if (n > 64_000) {
        reject(new PenglaiError("INVALID_INPUT", "body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new PenglaiError("INVALID_INPUT", "invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function tokenOk(got: string | undefined, expect: string): boolean {
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expect);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function startControlServer(
  plane: RoutingControlPlane,
  opts: { token: string; host?: string },
): Promise<ControlServer> {
  const host = opts.host ?? "127.0.0.1";
  assertSafeListenHost(host);
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const addr = server.address();
      const port = addr && typeof addr !== "string" ? addr.port : 0;
      if (req.headers.origin && !exactOriginAllowed(req.headers.origin, `http://127.0.0.1:${port}`)) {
        res.writeHead(403).end("origin");
        return;
      }
      if (!exactHostAllowed(req.headers.host, "127.0.0.1", port)) {
        res.writeHead(403).end("host");
        return;
      }
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, release: "0.5.1" }));
        return;
      }
      const hdr = String(req.headers["x-penglai-token"] ?? "");
      if (!tokenOk(hdr, opts.token)) {
        res.writeHead(401).end("unauthorized");
        return;
      }
      if (req.method === "POST" && req.url === "/v1/pair") {
        const body = await readBody(req);
        if (!isRecord(body)) throw new PenglaiError("INVALID_INPUT", "body");
        const rec = body;
        const out = plane.createPairing({
          workspaceIdentity: String(rec.workspaceIdentity),
          sessionId: String(rec.sessionId),
          adapter: rec.adapter === "weixin" ? "weixin" : "mock",
        });
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/health-detail") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/diagnostics") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(plane.diagnostics()));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/workspaces") {
        const list = await plane.directory.listWorkspaces();
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(list));
        return;
      }
      if (req.method === "POST" && req.url === "/v1/rebind") {
        const body = await readBody(req);
        if (!isRecord(body)) throw new PenglaiError("INVALID_INPUT", "body");
        const out = plane.rebind(String(body.routeId), String(body.workspaceIdentity), String(body.sessionId));
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/export-preview") {
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            files: ["diagnostics.json", "schema-version.txt"],
            redacted: true,
            excludes: ["credentials", "qr", "chat-bodies", "database"],
          }),
        );
        return;
      }
      res.writeHead(404).end("not found");
    } catch (err: unknown) {
      const msg = err instanceof PenglaiError ? err.errorClass : "error";
      res.writeHead(400).end(msg);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return {
    port: addr.port,
    token: opts.token,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export { startDshProxy, type LocalProxy } from "./proxy.js";
