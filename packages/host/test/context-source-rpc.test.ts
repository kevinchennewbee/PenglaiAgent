/**
 * F4/F5: context.source.list strips paths; describe returns rootPath for CLI;
 * remove returns an honest boolean (not a path masquerading as boolean).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type StartedServer } from "../src/server.js";

const TOKEN = "ctx-rpc-f4-f5-token";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-ctx-rpc-data-"));
const docsDir = path.join(dataDir, "docs");
fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(path.join(docsDir, "notes.md"), "# 笔记\n\n内容 alpha\n", "utf8");

async function rpc(
  baseUrl: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch(`${baseUrl}/api`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-penglai-token": TOKEN,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as {
    result?: unknown;
    error?: { message: string; data?: unknown };
  };
  if (body.error) {
    throw new Error(body.error.message);
  }
  return body.result;
}

describe("F4/F5 context.source RPC contract", () => {
  let server: StartedServer;
  let baseUrl: string;
  let sourceId: string;

  beforeAll(async () => {
    server = await startServer({
      port: 0,
      token: TOKEN,
      dataDir,
      databasePath: path.join(dataDir, "product.db"),
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
    const added = (await rpc(baseUrl, "context.source.add", {
      rootPath: docsDir,
      scope: "global",
      trustedChannel: "cli",
      displayName: "测试资料",
    })) as { source: { id: string } };
    sourceId = added.source.id;
  });

  afterAll(async () => {
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("F4: list never returns rootPath; describe returns the authorized path", async () => {
    const listed = (await rpc(baseUrl, "context.source.list", {})) as {
      sources: Array<Record<string, unknown>>;
    };
    expect(listed.sources.length).toBeGreaterThanOrEqual(1);
    const row = listed.sources.find((s) => s.id === sourceId);
    expect(row).toBeTruthy();
    expect(row).not.toHaveProperty("rootPath");
    expect(Object.keys(row!).includes("rootPath")).toBe(false);

    const described = (await rpc(baseUrl, "context.source.describe", {
      sourceId,
    })) as { source: { id: string; rootPath: string; displayName: string } };
    expect(described.source.id).toBe(sourceId);
    expect(described.source.rootPath).toBe(fs.realpathSync(docsDir));
    expect(described.source.displayName).toBe("测试资料");
  });

  it("F4: describe of unknown source fails closed", async () => {
    await expect(
      rpc(baseUrl, "context.source.describe", { sourceId: "src_missing" }),
    ).rejects.toThrow(/not found/i);
  });

  it("F5: remove returns originalFilesPreserved boolean, never a path string", async () => {
    const docs2 = path.join(dataDir, "docs2");
    fs.mkdirSync(docs2, { recursive: true });
    fs.writeFileSync(path.join(docs2, "a.md"), "# A\n", "utf8");
    const added = (await rpc(baseUrl, "context.source.add", {
      rootPath: docs2,
      scope: "global",
      trustedChannel: "cli",
    })) as { source: { id: string } };

    const removed = (await rpc(baseUrl, "context.source.remove", {
      sourceId: added.source.id,
    })) as Record<string, unknown>;
    expect(removed.ok).toBe(true);
    expect(removed.originalFilesPreserved).toBe(true);
    expect(typeof removed.originalFilesPreserved).toBe("boolean");
    expect(removed).not.toHaveProperty("rootPathPreserved");
    expect(fs.existsSync(path.join(docs2, "a.md"))).toBe(true);
  });

  it("F4 boundary: context.source.describe is not on the Desktop renderer allowlist", () => {
    const libRs = fs.readFileSync(
      path.join(
        process.cwd(),
        "packages/desktop/src-tauri/src/lib.rs",
      ),
      "utf8",
    );
    const match = libRs.match(/ALLOWED_HOST_METHODS: &\[&str\] = &\[([\s\S]*?)\];/);
    expect(match).toBeTruthy();
    const allowlist = new Set(
      [...match![1].matchAll(/"([a-z]+\.[a-zA-Z.]+)"/g)].map((m) => m[1]),
    );
    expect(allowlist.has("context.source.list")).toBe(true);
    expect(allowlist.has("context.source.describe")).toBe(false);
    expect(allowlist.has("context.source.add")).toBe(false);
  });
});
