/**
 * Minimal MCP stdio client for Penglai Host.
 *
 * Owns spawn + JSON-RPC over newline-delimited stdin/stdout, lists tools, and
 * exposes call handlers that the Pi kernel can mount as first-class tools.
 * Transports: stdio (spawn), sse (GET event stream + POST messages), http (JSON-RPC POST).
 *
 * No dependency on @modelcontextprotocol/sdk — keeps the Host runtime lean and
 * avoids shipping a second protocol stack next to Pi.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listMcpServers, type McpServerConfig } from "./config.js";
import { assertPublicHttpUrl } from "../capabilities/network-safety.js";
import { scrubbedShellEnv } from "../sandbox/shell-env.js";
import { wrapUntrustedContent } from "../security/untrusted-content.js";

const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TIMEOUT_MS = 20_000;
const INIT_TIMEOUT_MS = 12_000;

export interface McpToolDescriptor {
  serverId: string;
  serverName: string;
  /** Mounted name on the Pi surface: mcp_<server>_<tool> */
  name: string;
  originalName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerRuntime {
  id: string;
  name: string;
  enabled: boolean;
  transport: string;
  status: "connected" | "failed" | "skipped" | "disabled";
  detail: string;
  tools: string[];
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface LiveSession {
  config: McpServerConfig;
  kind: "stdio" | "sse" | "http";
  child: ChildProcessWithoutNullStreams | null;
  /** Write one JSON-RPC frame (stdio newline / SSE+HTTP POST body). */
  write: (payload: string) => void | Promise<void>;
  pending: Map<number, Pending>;
  nextId: number;
  buffer: string;
  tools: McpToolDescriptor[];
  closed: boolean;
  /** SSE: abort the long-lived event stream. */
  abortRemote?: () => void;
  /** HTTP/SSE: endpoint for JSON-RPC POSTs after initialize. */
  messageUrl?: string;
  headers?: Record<string, string>;
  sandboxHome?: string;
}

async function fetchPublicMcp(url: string, init: RequestInit): Promise<Response> {
  let current = (await assertPublicHttpUrl(url)).toString();
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("MCP redirect has no location");
      current = (await assertPublicHttpUrl(new URL(location, current).toString())).toString();
      continue;
    }
    return response;
  }
  throw new Error("MCP redirect limit exceeded");
}

async function readBoundedText(response: Response, maxBytes = 2 * 1024 * 1024): Promise<string> {
  if (!response.body) return "";
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new Error("MCP response exceeds 2 MB");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new Error("MCP response exceeds 2 MB");
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}

function sanitize(part: string): string {
  return part
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "server";
}

export function mountToolName(serverName: string, toolName: string, serverId?: string): string {
  const base = `mcp_${sanitize(serverName)}_${sanitize(toolName)}`;
  if (!serverId) return base;
  // Append a short stable id fragment to avoid cross-server name collisions.
  const idPart = sanitize(serverId).slice(-6);
  return idPart ? `${base}_${idPart}` : base;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * MCP schemas are server-controlled system metadata. Keep the structural
 * contract needed to call a tool, but discard prose/default/example channels
 * that can carry prompt injection before the tool is even invoked.
 */
function sanitizeInputSchema(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, 64).map((item) => sanitizeInputSchema(item, depth + 1));
  }
  if (!isObject(value)) {
    if (typeof value === "string") return value.slice(0, 128);
    if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
    return undefined;
  }
  const allowed = new Set([
    "type", "properties", "required", "items", "enum", "const", "anyOf", "oneOf", "allOf",
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength",
    "minItems", "maxItems", "uniqueItems", "additionalProperties",
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key)) continue;
    if (key === "type") {
      const validTypes = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
      if (typeof item === "string" && validTypes.has(item)) out.type = item;
      else if (Array.isArray(item)) {
        out.type = item.filter((entry): entry is string => typeof entry === "string" && validTypes.has(entry));
      }
      continue;
    }
    if (key === "enum" && Array.isArray(item)) {
      out.enum = item.filter((entry) =>
        typeof entry === "number" || typeof entry === "boolean" || entry === null ||
        (typeof entry === "string" && /^[A-Za-z0-9_.:/-]{1,64}$/.test(entry)),
      ).slice(0, 64);
      continue;
    }
    if (key === "const") {
      if (
        typeof item === "number" || typeof item === "boolean" || item === null ||
        (typeof item === "string" && /^[A-Za-z0-9_.:/-]{1,64}$/.test(item))
      ) out.const = item;
      continue;
    }
    if (key === "properties" && isObject(item)) {
      const properties: Record<string, unknown> = {};
      for (const [property, schema] of Object.entries(item).slice(0, 64)) {
        if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(property)) continue;
        properties[property] = sanitizeInputSchema(schema, depth + 1);
      }
      out.properties = properties;
      continue;
    }
    if (key === "required" && Array.isArray(item)) {
      out.required = item.filter(
        (entry): entry is string =>
          typeof entry === "string" && /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(entry),
      ).slice(0, 64);
      continue;
    }
    const sanitized = sanitizeInputSchema(item, depth + 1);
    if (sanitized !== undefined) out[key] = sanitized;
  }
  return out;
}

/**
 * One Host-wide registry of connected MCP servers for a data directory.
 * Chat / task kernels share the same sessions so tools stay warm.
 */
export class McpSessionManager {
  private sessions = new Map<string, LiveSession>();
  private runtimes: McpServerRuntime[] = [];
  private dataDir: string | undefined;
  private refreshSeq = 0;

  constructor(dataDir?: string) {
    this.dataDir = dataDir;
  }

  listRuntimes(): McpServerRuntime[] {
    return this.runtimes.slice();
  }

  listToolDescriptors(): McpToolDescriptor[] {
    const out: McpToolDescriptor[] = [];
    for (const session of this.sessions.values()) {
      out.push(...session.tools);
    }
    return out;
  }

  /** Connect enabled stdio servers; disconnect removed/disabled ones. */
  async refresh(dataDir?: string): Promise<McpServerRuntime[]> {
    if (dataDir) this.dataDir = dataDir;
    const seq = ++this.refreshSeq;
    const servers = listMcpServers(this.dataDir);
    const wanted = new Set(servers.filter((s) => s.enabled).map((s) => s.id));

    for (const [id, session] of this.sessions) {
      if (!wanted.has(id)) {
        this.teardown(session);
        this.sessions.delete(id);
      }
    }

    const runtimes: McpServerRuntime[] = [];
    for (const server of servers) {
      if (seq !== this.refreshSeq) break;
      if (!server.enabled) {
        runtimes.push({
          id: server.id,
          name: server.name,
          enabled: false,
          transport: server.transport,
          status: "disabled",
          detail: "disabled in mcp.json",
          tools: [],
        });
        continue;
      }
      if (server.transport === "stdio" && !server.command?.trim()) {
        runtimes.push({
          id: server.id,
          name: server.name,
          enabled: true,
          transport: server.transport,
          status: "failed",
          detail: "stdio server missing command",
          tools: [],
        });
        continue;
      }
      if (
        (server.transport === "sse" || server.transport === "http") &&
        !server.url?.trim()
      ) {
        runtimes.push({
          id: server.id,
          name: server.name,
          enabled: true,
          transport: server.transport,
          status: "failed",
          detail: `${server.transport} server missing url`,
          tools: [],
        });
        continue;
      }

      const existing = this.sessions.get(server.id);
      if (
        existing &&
        !existing.closed &&
        existing.config.transport === server.transport &&
        existing.config.command === server.command &&
        existing.config.url === server.url &&
        JSON.stringify(existing.config.args ?? []) === JSON.stringify(server.args ?? [])
      ) {
        runtimes.push({
          id: server.id,
          name: server.name,
          enabled: true,
          transport: server.transport,
          status: "connected",
          detail: `alive · ${existing.tools.length} tools`,
          tools: existing.tools.map((t) => t.name),
        });
        continue;
      }

      if (existing) {
        this.teardown(existing);
        this.sessions.delete(server.id);
      }

      try {
        const session =
          server.transport === "stdio"
            ? await this.connectStdio(server)
            : server.transport === "sse"
              ? await this.connectSse(server)
              : await this.connectHttp(server);
        if (seq !== this.refreshSeq) {
          this.teardown(session);
          continue;
        }
        this.sessions.set(server.id, session);
        runtimes.push({
          id: server.id,
          name: server.name,
          enabled: true,
          transport: server.transport,
          status: "connected",
          detail: `connected · ${session.tools.length} tools`,
          tools: session.tools.map((t) => t.name),
        });
      } catch (error) {
        runtimes.push({
          id: server.id,
          name: server.name,
          enabled: true,
          transport: server.transport,
          status: "failed",
          detail: error instanceof Error ? error.message : String(error),
          tools: [],
        });
      }
    }

    this.runtimes = runtimes;
    return runtimes;
  }

  async callTool(mountedName: string, args: Record<string, unknown>): Promise<string> {
    for (const session of this.sessions.values()) {
      const tool = session.tools.find((t) => t.name === mountedName);
      if (!tool) continue;
      if (session.closed) {
        return `MCP server '${session.config.name}' is not connected`;
      }
      try {
        const result = await this.request(
          session,
          "tools/call",
          {
            name: tool.originalName,
            arguments: args ?? {},
          },
          DEFAULT_TIMEOUT_MS,
        );
        return wrapUntrustedContent("mcp", formatToolResult(result));
      } catch (error) {
        return `MCP call failed (${tool.name}): ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    }
    return `MCP tool not found: ${mountedName}`;
  }

  dispose(): void {
    this.refreshSeq += 1;
    for (const session of this.sessions.values()) {
      this.teardown(session);
    }
    this.sessions.clear();
    this.runtimes = [];
  }

  private async connectStdio(config: McpServerConfig): Promise<LiveSession> {
    const command = config.command!.trim();
    const args = config.args ?? [];
    const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-mcp-home-"));
    fs.chmodSync(sandboxHome, 0o700);
    // Minimal env: do not dump every host secret or the owner's home into MCP children.
    const scrubbedEnv: NodeJS.ProcessEnv = {
      ...scrubbedShellEnv(),
      ...(config.env ?? {}),
      HOME: sandboxHome,
      XDG_CACHE_HOME: path.join(sandboxHome, ".cache"),
      XDG_CONFIG_HOME: path.join(sandboxHome, ".config"),
      XDG_DATA_HOME: path.join(sandboxHome, ".local", "share"),
      PENGLAI_MCP: "1",
    };
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: scrubbedEnv,
      windowsHide: true,
    });

    const session: LiveSession = {
      config,
      kind: "stdio",
      child,
      write: (payload: string) => {
        child.stdin.write(`${payload}\n`);
      },
      pending: new Map(),
      nextId: 1,
      buffer: "",
      tools: [],
      closed: false,
      sandboxHome,
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdout(session, chunk));
    child.stderr.on("data", () => {
      /* keep stderr for process health; do not parse as RPC */
    });
    child.on("error", (error) => {
      this.failAll(session, error);
    });
    child.on("exit", () => {
      session.closed = true;
      this.failAll(session, new Error(`MCP process exited (${config.name})`));
      // Drop zombie so the next refresh reconnects instead of reporting connected.
      if (this.sessions.get(config.id) === session) {
        this.sessions.delete(config.id);
      }
      this.runtimes = this.runtimes.map((row) =>
        row.id === config.id
          ? {
              ...row,
              status: "failed",
              detail: "process exited",
              tools: [],
            }
          : row,
      );
    });

    try {
      await this.handshake(session);
      return session;
    } catch (error) {
      this.teardown(session);
      throw error;
    }
  }

  private async connectHttp(config: McpServerConfig): Promise<LiveSession> {
    const url = config.url!.trim();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(config.headers ?? {}),
    };
    const session: LiveSession = {
      config,
      kind: "http",
      child: null,
      write: async (payload: string) => {
        const response = await fetchPublicMcp(session.messageUrl ?? url, {
          method: "POST",
          headers: session.headers ?? headers,
          body: payload,
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new Error(`MCP HTTP ${response.status} on ${config.name}`);
        }
        const text = await readBoundedText(response);
        if (text.trim()) this.handleRpcMessage(session, text);
      },
      pending: new Map(),
      nextId: 1,
      buffer: "",
      tools: [],
      closed: false,
      messageUrl: url,
      headers,
    };
    try {
      await this.handshake(session);
      return session;
    } catch (error) {
      this.teardown(session);
      throw error;
    }
  }

  private async connectSse(config: McpServerConfig): Promise<LiveSession> {
    const url = config.url!.trim();
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      ...(config.headers ?? {}),
    };
    const controller = new AbortController();
    let messageUrl = url;
    const session: LiveSession = {
      config,
      kind: "sse",
      child: null,
      write: async (payload: string) => {
        const response = await fetchPublicMcp(session.messageUrl ?? messageUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            ...(session.headers ?? {}),
          },
          body: payload,
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new Error(`MCP SSE POST ${response.status} on ${config.name}`);
        }
        // Some servers reply inline; still consume body for JSON responses.
        const ct = response.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const text = await readBoundedText(response);
          if (text.trim()) this.handleRpcMessage(session, text);
        } else {
          // drain
          await readBoundedText(response);
        }
      },
      pending: new Map(),
      nextId: 1,
      buffer: "",
      tools: [],
      closed: false,
      abortRemote: () => controller.abort(),
      messageUrl,
      headers: config.headers ?? {},
    };

    // Open SSE stream in background; collect endpoint + JSON-RPC events.
    void (async () => {
      try {
        const response = await fetchPublicMcp(url, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`MCP SSE open failed HTTP ${response.status}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (!session.closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          if (buf.length > 2 * 1024 * 1024) throw new Error("MCP SSE frame exceeds 2 MB");
          while (true) {
            const split = buf.indexOf("\n\n");
            if (split === -1) break;
            const block = buf.slice(0, split);
            buf = buf.slice(split + 2);
            let event = "message";
            const dataLines: string[] = [];
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
            }
            const data = dataLines.join("\n");
            if (!data) continue;
            if (event === "endpoint") {
              try {
                const candidate = new URL(data, url);
                // SSE endpoint discovery may not pivot to another host. The
                // original origin has already passed DNS/IP SSRF validation.
                if (candidate.origin !== new URL(url).origin) {
                  throw new Error("cross-origin MCP SSE endpoint refused");
                }
                messageUrl = candidate.toString();
                session.messageUrl = messageUrl;
              } catch {
                this.failAll(session, new Error("unsafe MCP SSE endpoint"));
                session.closed = true;
              }
              continue;
            }
            this.handleRpcMessage(session, data);
          }
        }
      } catch (error) {
        if (!session.closed) {
          this.failAll(
            session,
            error instanceof Error ? error : new Error(String(error)),
          );
          session.closed = true;
        }
      }
    })();

    // Brief wait for endpoint event (optional).
    await new Promise((r) => setTimeout(r, 150));
    try {
      await this.handshake(session);
      return session;
    } catch (error) {
      this.teardown(session);
      throw error;
    }
  }

  private async handshake(session: LiveSession): Promise<void> {
    await this.request(
      session,
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "penglai-host", version: "0.4.0" },
      },
      INIT_TIMEOUT_MS,
    );
    this.notify(session, "notifications/initialized", {});
    const listed = await this.request(session, "tools/list", {}, INIT_TIMEOUT_MS);
    session.tools = parseToolList(session.config, listed);
  }

  private handleRpcMessage(session: LiveSession, raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      // SSE may stream newline-delimited multi-payloads
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          this.handleRpcMessage(session, trimmed);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (!isObject(msg) || typeof msg.id !== "number") return;
    const pending = session.pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    session.pending.delete(msg.id);
    if (msg.error) {
      const err = isObject(msg.error) ? msg.error : { message: String(msg.error) };
      pending.reject(
        new Error(
          typeof err.message === "string"
            ? err.message
            : `MCP error ${JSON.stringify(err)}`,
        ),
      );
    } else {
      pending.resolve(msg.result);
    }
  }

  private onStdout(session: LiveSession, chunk: string): void {
    session.buffer += chunk;
    if (session.buffer.length > 2 * 1024 * 1024) {
      session.closed = true;
      this.failAll(session, new Error(`MCP stdout frame exceeds 2 MB (${session.config.name})`));
      return;
    }
    while (true) {
      const nl = session.buffer.indexOf("\n");
      if (nl === -1) break;
      const line = session.buffer.slice(0, nl).trim();
      session.buffer = session.buffer.slice(nl + 1);
      if (!line) continue;
      this.handleRpcMessage(session, line);
    }
  }

  private request(
    session: LiveSession,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    if (session.closed) {
      return Promise.reject(new Error(`MCP session closed (${session.config.name})`));
    }
    const id = session.nextId++;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(id);
        reject(new Error(`MCP timeout on ${method} (${session.config.name})`));
      }, timeoutMs);
      session.pending.set(id, { resolve, reject, timer });
      try {
        const written = session.write(payload);
        if (written && typeof (written as Promise<void>).then === "function") {
          void (written as Promise<void>).catch((error) => {
            clearTimeout(timer);
            session.pending.delete(id);
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        }
      } catch (error) {
        clearTimeout(timer);
        session.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(
    session: LiveSession,
    method: string,
    params: Record<string, unknown>,
  ): void {
    if (session.closed) return;
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    try {
      void session.write(payload);
    } catch {
      /* best-effort */
    }
  }

  private failAll(session: LiveSession, error: Error): void {
    for (const [id, pending] of session.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      session.pending.delete(id);
    }
  }

  private teardown(session: LiveSession): void {
    session.closed = true;
    this.failAll(session, new Error(`MCP session disposed (${session.config.name})`));
    try {
      session.abortRemote?.();
    } catch {
      /* ignore */
    }
    if (session.sandboxHome) {
      try {
        fs.rmSync(session.sandboxHome, { recursive: true });
      } catch {
        /* best-effort private temp cleanup */
      }
    }
    if (session.child) {
      try {
        session.child.stdin.end();
      } catch {
        /* ignore */
      }
      try {
        session.child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          if (session.child && !session.child.killed) session.child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 1500).unref?.();
    }
  }
}

function parseToolList(
  config: McpServerConfig,
  listed: unknown,
): McpToolDescriptor[] {
  if (!isObject(listed) || !Array.isArray(listed.tools)) return [];
  const out: McpToolDescriptor[] = [];
  for (const raw of listed.tools) {
    if (out.length >= 128) break;
    if (!isObject(raw) || typeof raw.name !== "string") continue;
    const originalName = raw.name;
    const inputSchema = isObject(raw.inputSchema)
      ? (sanitizeInputSchema(raw.inputSchema) as Record<string, unknown>)
      : { type: "object", properties: {} };
    if (JSON.stringify(inputSchema).length > 128 * 1024) continue;
    out.push({
      serverId: config.id,
      serverName: config.name,
      name: mountToolName(config.name, originalName, config.id),
      originalName,
      description: `Owner-connected MCP tool ${sanitize(originalName)} from server ${sanitize(config.name)}. Server-provided prose is intentionally omitted; every call requires Owner L3 approval.`,
      inputSchema,
    });
  }
  return out;
}

function formatToolResult(result: unknown): string {
  if (result == null) return "(empty MCP result)";
  if (typeof result === "string") return result;
  if (!isObject(result)) return JSON.stringify(result, null, 2);
  const content = result.content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (!isObject(item)) {
        parts.push(String(item));
        continue;
      }
      if (item.type === "text" && typeof item.text === "string") {
        parts.push(item.text);
      } else {
        parts.push(JSON.stringify(item));
      }
    }
    if (result.isError === true) {
      return `ERROR: ${parts.join("\n") || "MCP tool reported isError"}`;
    }
    return parts.join("\n") || JSON.stringify(result, null, 2);
  }
  return JSON.stringify(result, null, 2);
}
