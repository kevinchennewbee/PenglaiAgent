import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Duplex } from "node:stream";
import { timingSafeEqual } from "node:crypto";
import { assertSafeListenHost, exactHostAllowed, exactOriginAllowed } from "@penglai/contracts";

const WIZARD_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const PENGLAI_BRAND_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function proxiedResponseHeaders(url: string | undefined, headers: IncomingMessage["headers"]): IncomingMessage["headers"] {
  const pathname = new URL(url ?? "/", "http://127.0.0.1").pathname;
  if (!pathname.startsWith("/penglai-brand/")) return headers;
  const type = PENGLAI_BRAND_TYPES[extname(pathname).toLowerCase()];
  return type ? { ...headers, "content-type": type } : headers;
}

export const WIZARD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function serveWizard(req: IncomingMessage, res: ServerResponse, wizardRoot: string): boolean {
  const pathOnly = String(req.url ?? "").split("?")[0] ?? "";
  if (pathOnly !== "/wizard" && !pathOnly.startsWith("/wizard/")) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end("method");
    return true;
  }
  if (!existsSync(wizardRoot)) {
    res.writeHead(404).end("wizard");
    return true;
  }
  const root = realpathSync(wizardRoot);
  let rel = pathOnly === "/wizard" || pathOnly === "/wizard/" ? "index.html" : pathOnly.slice("/wizard/".length);
  try {
    rel = decodeURIComponent(rel);
  } catch {
    res.writeHead(400).end("path");
    return true;
  }
  if (!rel || rel.includes("\0") || rel.includes("\\") || rel.split("/").includes("..")) {
    res.writeHead(403).end("path");
    return true;
  }
  const requested = resolve(root, rel);
  if (!isInsideRoot(root, requested)) {
    res.writeHead(403).end("path");
    return true;
  }
  let file = requested;
  if (!existsSync(file) || !statSync(file).isFile()) {
    const ext = extname(rel).toLowerCase();
    if (ext && ext !== ".html") {
      res.writeHead(404).end("missing");
      return true;
    }
    file = join(root, "index.html");
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("wizard");
    return true;
  }
  const real = realpathSync(file);
  if (!isInsideRoot(root, real)) {
    res.writeHead(403).end("path");
    return true;
  }
  const ext = extname(real).toLowerCase();
  const type = WIZARD_TYPES[ext];
  if (!type) {
    res.writeHead(403).end("type");
    return true;
  }
  const body = readFileSync(real);
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Security-Policy": WIZARD_CSP,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  if (req.method === "HEAD") res.end();
  else res.end(body);
  return true;
}

function innerHeaders(req: IncomingMessage, innerPort: number): IncomingMessage["headers"] {
  const headers = { ...req.headers, host: `127.0.0.1:${innerPort}` };
  if (req.headers.origin) headers.origin = `http://127.0.0.1:${innerPort}`;
  if (req.headers.referer) headers.referer = `http://127.0.0.1:${innerPort}/`;
  return headers;
}

function tokenFrom(req: IncomingMessage, expect: string): boolean {
  const cookie = String(req.headers.cookie ?? "");
  const match = /(?:^|;\s*)penglai_proxy=([^;]+)/.exec(cookie);
  const hdr = String(req.headers["x-penglai-token"] ?? "");
  const got = match?.[1] ?? hdr;
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expect);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface WizardProxyOptions {
  root: string;
  /** When true the static wizard is no longer served (ledger COMPLETE). */
  disabled?: boolean;
}

export interface LocalProxy {
  port: number;
  close(): Promise<void>;
  setWizardDisabled(disabled: boolean): void;
}

export async function startDshProxy(opts: {
  token: string;
  innerPort: number;
  host?: string;
  wizard?: { root: string; disabled?: boolean };
}): Promise<LocalProxy> {
  const host = opts.host ?? "127.0.0.1";
  assertSafeListenHost(host);
  let wizardDisabled = Boolean(opts.wizard?.disabled);
  const isWizardPath = (url: string | undefined): boolean => {
    const pathOnly = String(url ?? "").split("?")[0] ?? "";
    return pathOnly === "/wizard" || pathOnly.startsWith("/wizard/");
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const addr = server.address();
    const port = addr && typeof addr !== "string" ? addr.port : 0;
    const listenOrigin = `http://127.0.0.1:${port}`;
    if (req.headers.origin && !exactOriginAllowed(req.headers.origin, listenOrigin)) {
      res.writeHead(403).end("origin");
      return;
    }
    if (!exactHostAllowed(req.headers.host, "127.0.0.1", port)) {
      res.writeHead(403).end("host");
      return;
    }
    if (!tokenFrom(req, opts.token)) {
      res.writeHead(401).end("unauthorized");
      return;
    }
    if (opts.wizard && isWizardPath(req.url)) {
      if (wizardDisabled) {
        res.writeHead(410, { "Cache-Control": "no-store" }).end("wizard-complete");
        return;
      }
      if (serveWizard(req, res, opts.wizard.root)) return;
    }
    const upgrade = req.headers.upgrade;
    if (upgrade) {
      res.writeHead(401).end("upgrade-via-server-upgrade");
      return;
    }
    const target = httpRequest(
      {
        host: "127.0.0.1",
        port: opts.innerPort,
        path: req.url,
        method: req.method,
        headers: innerHeaders(req, opts.innerPort),
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, proxiedResponseHeaders(req.url, up.headers));
        up.on("error", () => {
          try {
            res.destroy();
          } catch {
            /* already closed */
          }
        });
        res.on("error", () => {
          try {
            up.destroy();
          } catch {
            /* already closed */
          }
        });
        up.pipe(res);
      },
    );
    target.on("error", () => {
      if (!res.headersSent) res.writeHead(502).end("upstream");
      else {
        try {
          res.destroy();
        } catch {
          /* already closed */
        }
      }
    });
    req.on("error", () => {
      try {
        target.destroy();
      } catch {
        /* already closed */
      }
    });
    req.pipe(target);
  });
  const liveSockets = new Set<Duplex>();
  const track = (sock: Duplex) => {
    liveSockets.add(sock);
    sock.on("close", () => liveSockets.delete(sock));
  };
  server.on("connection", (sock) => track(sock));
  server.on("upgrade", (req, socket) => {
    track(socket);
    socket.on("error", () => {
      try {
        socket.destroy();
      } catch {
        /* already closed */
      }
    });
    if (!tokenFrom(req, opts.token)) {
      try {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      } catch {
        /* peer gone */
      }
      socket.destroy();
      return;
    }
    const addr = server.address();
    const port = addr && typeof addr !== "string" ? addr.port : 0;
    if (req.headers.origin && !exactOriginAllowed(req.headers.origin, `http://127.0.0.1:${port}`)) {
      try {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      } catch {
        /* peer gone */
      }
      socket.destroy();
      return;
    }
    if (!exactHostAllowed(req.headers.host, "127.0.0.1", port)) {
      try {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      } catch {
        /* peer gone */
      }
      socket.destroy();
      return;
    }
    const inner = httpRequest({
      host: "127.0.0.1",
      port: opts.innerPort,
      path: req.url,
      method: "GET",
      headers: innerHeaders(req, opts.innerPort),
    });
    inner.on("upgrade", (upRes, upSocket, head) => {
      track(upSocket);
      upSocket.on("error", () => {
        try {
          socket.destroy();
        } catch {
          /* already closed */
        }
      });
      try {
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(upRes.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
        if (head.length) socket.write(head);
      } catch {
        socket.destroy();
        upSocket.destroy();
        return;
      }
      const fail = () => {
        try {
          socket.destroy();
        } catch {
          /* already closed */
        }
        try {
          upSocket.destroy();
        } catch {
          /* already closed */
        }
      };
      socket.on("error", fail);
      upSocket.on("error", fail);
      socket.on("close", fail);
      upSocket.on("close", fail);
      upSocket.pipe(socket);
      socket.pipe(upSocket);
    });
    inner.on("error", () => socket.destroy());
    inner.end();
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return {
    port: addr.port,
    close: () =>
      new Promise((resolve) => {
        for (const sock of liveSockets) {
          try {
            sock.destroy();
          } catch {
            /* already closed */
          }
        }
        liveSockets.clear();
        server.close(() => resolve());
      }),
    setWizardDisabled(disabled: boolean) {
      wizardDisabled = disabled;
    },
  };
}
