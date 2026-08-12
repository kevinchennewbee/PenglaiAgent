/**
 * W2: context.suggestions — offline questions from real indexed titles.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextService } from "../src/context/index.js";
import { startServer, type StartedServer } from "../src/server.js";

const cleanup: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

afterEach(() => {
  while (cleanup.length > 0) {
    fs.rmSync(cleanup.pop()!, { recursive: true, force: true });
  }
});

describe("W2 context.suggestions", () => {
  it("returns empty array when no sources are indexed", () => {
    const dataDir = tempDir("penglai-sug-empty-");
    const service = new ContextService({ dataDir });
    expect(service.suggestions({ globalOnly: true })).toEqual([]);
    service.close();
  });

  it("builds ≤3 offline questions from real document titles (no abs paths)", async () => {
    const dataDir = tempDir("penglai-sug-data-");
    const docs = tempDir("penglai-sug-docs-");
    fs.writeFileSync(path.join(docs, "报价审批规范.md"), "# 报价审批规范\n\n条款\n", "utf8");
    fs.writeFileSync(path.join(docs, "客户合同-HT.md"), "# 客户合同\n\n编号 HT\n", "utf8");
    fs.writeFileSync(path.join(docs, "交付清单.md"), "# 交付清单\n\n条目\n", "utf8");
    fs.writeFileSync(path.join(docs, "a.md"), "# A\n", "utf8");
    const service = new ContextService({ dataDir });
    await service.addSource({
      rootPath: docs,
      scopeType: "global",
      displayName: "工作资料",
    });
    const suggestions = service.suggestions({ globalOnly: true, limit: 3 });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(3);
    for (const row of suggestions) {
      expect(row.question).toContain(row.documentTitle);
      expect(row.relativePath).not.toMatch(/^\//);
      expect(row.relativePath).not.toContain(docs);
      expect(JSON.stringify(row)).not.toContain(docs);
    }
    service.close();
  });

  it("Host RPC context.suggestions matches service shape", async () => {
    const dataDir = tempDir("penglai-sug-rpc-");
    const docs = tempDir("penglai-sug-rpc-docs-");
    fs.writeFileSync(path.join(docs, "会议纪要.md"), "# 会议纪要\n\n决议\n", "utf8");
    let server: StartedServer | null = null;
    try {
      server = await startServer({
        port: 0,
        token: "sug-token",
        dataDir,
        databasePath: path.join(dataDir, "product.db"),
      });
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const post = async (method: string, params: Record<string, unknown>) => {
        const res = await fetch(`${baseUrl}/api`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-penglai-token": "sug-token",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        return res.json();
      };
      await post("context.source.add", {
        rootPath: docs,
        scope: "global",
        trustedChannel: "cli",
      });
      const emptyBefore = await post("context.suggestions", { globalOnly: true });
      // After add there should be suggestions (or empty only if parse failed).
      expect(emptyBefore.error).toBeUndefined();
      expect(Array.isArray(emptyBefore.result.suggestions)).toBe(true);
      expect(emptyBefore.result.suggestions.length).toBeGreaterThanOrEqual(1);
      expect(emptyBefore.result.suggestions[0].question).toContain("会议纪要");
    } finally {
      await server?.close();
    }
  });
});
