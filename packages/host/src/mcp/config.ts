/**
 * MCP server registry (Phase B skeleton).
 *
 * Persists owner-declared MCP servers under <data-dir>/mcp.json (0600).
 * Listing is always available. Connecting stdio/SSE servers and merging
 * their tools into the Pi surface is the next slice — this file is the
 * durable config contract so the desktop Settings UI has a real backend.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { penglaiDataDir } from "../data-dir.js";
import {
  atomicWritePrivateJson,
  ensurePrivateDirectory,
  hardenPrivateFile,
} from "../security/private-file.js";

const MCP_CONFIG_MAX_BYTES = 1024 * 1024;
const MCP_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export type McpTransport = "stdio" | "sse" | "http";

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransport;
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** sse/http */
  url?: string;
  headers?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface McpConfigFile {
  schemaVersion: 1;
  servers: McpServerConfig[];
}

function configPath(dataDir?: string): string {
  return path.join(dataDir ?? penglaiDataDir(), "mcp.json");
}

export function loadMcpConfig(dataDir?: string): McpConfigFile {
  const file = configPath(dataDir);
  if (!fs.existsSync(file)) {
    return { schemaVersion: 1, servers: [] };
  }
  hardenPrivateFile(file, MCP_CONFIG_MAX_BYTES);
  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as McpConfigFile;
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.servers)) {
    throw new Error("MCP config has an unsupported or malformed schema");
  }
  return raw;
}

export function saveMcpConfig(doc: McpConfigFile, dataDir?: string): void {
  const file = configPath(dataDir);
  ensurePrivateDirectory(path.dirname(file));
  atomicWritePrivateJson(file, doc, MCP_CONFIG_MAX_BYTES);
}

export function listMcpServers(dataDir?: string): McpServerConfig[] {
  return loadMcpConfig(dataDir).servers.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export function upsertMcpServer(
  input: {
    id?: string;
    name: string;
    enabled?: boolean;
    transport: McpTransport;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  },
  dataDir?: string,
): McpServerConfig {
  if (!input.name.trim() || input.name.trim().length > 80) throw new Error("MCP name must be 1-80 characters");
  if (!(["stdio", "sse", "http"] as const).includes(input.transport)) throw new Error("unsupported MCP transport");
  if (input.transport === "stdio" && !input.command?.trim()) throw new Error("stdio MCP requires a command");
  if ((input.transport === "sse" || input.transport === "http") && !input.url?.trim()) throw new Error(`${input.transport} MCP requires a URL`);
  if ((input.args?.length ?? 0) > 64) throw new Error("MCP args exceed 64 entries");
  if (Object.keys(input.env ?? {}).length > 64 || Object.keys(input.headers ?? {}).length > 64) throw new Error("MCP env/headers exceed 64 entries");
  for (const [key, value] of [...Object.entries(input.env ?? {}), ...Object.entries(input.headers ?? {})]) {
    if (!key || key.length > 128 || /[\r\n]/.test(key) || typeof value !== "string" || value.length > 16_384 || /[\r\n]/.test(value)) {
      throw new Error("MCP env/header keys and values must be bounded single-line strings");
    }
  }
  const doc = loadMcpConfig(dataDir);
  const now = Date.now();
  const id =
    input.id?.trim() ||
    `mcp_${randomUUID()}`;
  if (!MCP_ID_PATTERN.test(id)) throw new Error("MCP id must contain only letters, digits, dot, underscore, or dash");
  const existingIndex = doc.servers.findIndex((s) => s.id === id);
  const existing = existingIndex >= 0 ? doc.servers[existingIndex] : undefined;
  const row: McpServerConfig = {
    id,
    name: input.name.trim() || id,
    enabled: input.enabled ?? existing?.enabled ?? true,
    transport: input.transport,
    command: input.command,
    args: input.args,
    env: input.env,
    url: input.url,
    headers: input.headers,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (existingIndex >= 0) {
    doc.servers[existingIndex] = row;
  } else {
    doc.servers.push(row);
  }
  saveMcpConfig(doc, dataDir);
  return row;
}

export function removeMcpServer(id: string, dataDir?: string): boolean {
  const doc = loadMcpConfig(dataDir);
  const next = doc.servers.filter((s) => s.id !== id);
  if (next.length === doc.servers.length) return false;
  doc.servers = next;
  saveMcpConfig(doc, dataDir);
  return true;
}

/** Product-facing tool surface summary for Settings (honest, not aspirational). */
export function describeBuiltinToolSurface(): {
  local: string[];
  network: string[];
  optional: string[];
  notes: string[];
} {
  return {
    local: [
      "read",
      "write / edit（按路径和覆盖规则审批）",
      "bash（当前无跨平台 OS 沙箱，因此每次执行均需 Owner L3；越界路径直接 L4）",
      "document_read（PDF / DOCX / XLSX / PPTX / 常用文本）",
      "document_create_pdf（新建 PDF；不覆盖已有文件）",
      "document_create（新建 PDF / DOCX / XLSX / PPTX；不覆盖已有文件）",
    ],
    network: [
      "web_search / web_fetch（公网限定、SSRF 防护、Owner L3）",
    ],
    optional: [
      "Skills：Owner 安装并校验的 Agent Skill + distillation SOP tree；skill_list / skill_show",
      "MCP：Owner 手动配置/连接；不随 Host 自动启动；每次工具调用 L3",
      "browser 自动化不内置，可由 Owner 自选浏览器 MCP 扩展",
    ],
    notes: [
      "Plan 只装配 read、document_read、skill_list、skill_show。",
      "confirm / auto_edit / full 装配完整原子工具面；Bash、Web、MCP 每次均需 Owner L3。",
      "模型不能选择或信任项目目录；项目切换只能由 Owner 发起。",
      "MCP 子进程使用私有临时 HOME 与净化环境；远程传输逐跳拒绝私网/元数据地址。",
    ],
  };
}
