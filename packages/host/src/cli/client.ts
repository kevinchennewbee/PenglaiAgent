/**
 * penglai CLI — the host client.
 *
 * The CLI is a stateless thin client: every fact lives in the Host. This
 * module owns the connection — token resolution (flag > env > token file),
 * the loopback JSON-RPC surface, the WS event channel, and auto-starting
 * the local host when it is not running (codex-style "it just works").
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import type { RuntimeHandshake } from "@penglai/protocol";
import { penglaiDataDir } from "../data-dir.js";
import { readAndHardenHostToken } from "../token-file.js";

export const DEFAULT_PORT = 14169;

export class CliError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export interface HostClientOptions {
  port: number;
  /** Explicit token (highest precedence). */
  token?: string;
  /** Auto-start the local host when unreachable. Default true. */
  autoStart?: boolean;
  /** Poll budget while waiting for an auto-started host. Default 15000ms. */
  startTimeoutMs?: number;
  /** Test seam: override the host CLI entry to spawn. */
  hostEntry?: string;
}

interface RpcEnvelope {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: { code?: string } };
}

function hostEntryPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "cli.ts");
}

function tsxLoaderPath(): string {
  const require = createRequire(import.meta.url);
  return require.resolve("tsx");
}

/** Resolve the auth token: explicit flag > env var > the host token file. */
export function resolveToken(explicit?: string, dataDir: string = penglaiDataDir()): string | null {
  if (explicit?.trim()) return explicit.trim();
  const fromEnv = process.env.PENGLAI_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    return readAndHardenHostToken(dataDir);
  } catch {
    return null;
  }
}

export class HostClient {
  private rpcSeq = 0;

  private constructor(
    readonly baseUrl: string,
    readonly wsUrl: string,
    readonly token: string,
    readonly port: number,
  ) {}

  /**
   * Connect to the local host, auto-starting it when requested and missing.
   */
  static async connect(options: HostClientOptions): Promise<HostClient> {
    const port = options.port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const healthy = await HostClient.probe(baseUrl, 800);
    if (!healthy) {
      if (options.autoStart === false) {
        throw new CliError(
          `no Penglai host on 127.0.0.1:${port} — start one with \`penglai serve\``,
        );
      }
      await HostClient.autoStart(port, options);
    }
    const token = resolveToken(options.token);
    if (!token) {
      throw new CliError(
        "no host token found (looked at PENGLAI_TOKEN and ~/.penglai/host.token); " +
          "start the host with `penglai serve` once",
      );
    }
    const client = new HostClient(baseUrl, `ws://127.0.0.1:${port}/ws`, token, port);
    // Fail fast on a stale/wrong token instead of failing every later call.
    await client.health();
    return client;
  }

  /** Unauthenticated liveness probe. */
  static async probe(baseUrl: string, timeoutMs: number): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
        return res.ok;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }

  /** Spawn the local host detached, logging to <data-dir>/logs/host.log. */
  private static async autoStart(
    port: number,
    options: HostClientOptions,
  ): Promise<void> {
    const dataDir = penglaiDataDir();
    const logDir = path.join(dataDir, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logFd = fs.openSync(path.join(logDir, "host.log"), "a");
    const child = spawn(
      process.execPath,
      [
        "--import",
        tsxLoaderPath(),
        options.hostEntry ?? hostEntryPath(),
        "serve",
        "--port",
        String(port),
      ],
      { detached: true, stdio: ["ignore", logFd, logFd] },
    );
    child.unref();
    const deadline = Date.now() + (options.startTimeoutMs ?? 15_000);
    const baseUrl = `http://127.0.0.1:${port}`;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (await HostClient.probe(baseUrl, 500)) return;
    }
    throw new CliError(
      `auto-started host did not come up on 127.0.0.1:${port} within ${options.startTimeoutMs ?? 15_000}ms ` +
        `(log: ${path.join(logDir, "host.log")})`,
    );
  }

  /** The runtime handshake (also validates the token). */
  async health(): Promise<RuntimeHandshake> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new CliError(`host health probe failed: HTTP ${res.status}`);
    // Validate the token once up front with a cheap authenticated call.
    await this.rpc("config.listProfiles", {});
    return (await res.json()) as RuntimeHandshake;
  }

  /** JSON-RPC over the token-gated loopback surface. */
  async rpc<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.rpcSeq += 1;
    const res = await fetch(`${this.baseUrl}/api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Penglai-Token": this.token,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.rpcSeq, method, params }),
    });
    if (res.status === 401) {
      throw new CliError(
        "host rejected the token (401) — check PENGLAI_TOKEN or ~/.penglai/host.token",
      );
    }
    const body = (await res.json().catch(() => null)) as RpcEnvelope | null;
    if (!body) throw new CliError(`host returned a non-JSON response (HTTP ${res.status})`);
    if (body.error) {
      throw new CliError(body.error.message, body.error.data?.code);
    }
    return body.result as T;
  }

  /**
   * Subscribe to a WS channel. Returns an unsubscribe function. Events are
   * delivered as parsed JSON objects.
   */
  subscribe(
    channelId: string,
    onEvent: (event: Record<string, unknown>) => void,
  ): Promise<() => void> {
    const url = `${this.wsUrl}?channel=${encodeURIComponent(channelId)}`;
    const ws = new WebSocket(url, { headers: { "X-Penglai-Token": this.token } });
    return new Promise((resolvePromise, rejectPromise) => {
      const unsubscribe = (): void => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
      ws.on("open", () => resolvePromise(unsubscribe));
      ws.on("message", (data) => {
        try {
          onEvent(JSON.parse(data.toString()) as Record<string, unknown>);
        } catch {
          /* ignore malformed frames */
        }
      });
      ws.on("error", (error) => {
        rejectPromise(new CliError(`host event channel failed: ${error.message}`));
      });
    });
  }
}
