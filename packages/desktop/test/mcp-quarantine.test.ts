import { describe, expect, it } from "vitest";
import * as fs from "node:fs";

const panelsSource = fs.readFileSync(
  new URL("../src/ui/panels.tsx", import.meta.url),
  "utf-8",
);
const chatPanelSource = fs.readFileSync(
  new URL("../src/ui/ChatPanel.tsx", import.meta.url),
  "utf-8",
);
const rustSource = fs.readFileSync(
  new URL("../src-tauri/src/lib.rs", import.meta.url),
  "utf-8",
);
const allowlist = rustSource.match(/ALLOWED_HOST_METHODS: &\[&str\] = &\[([\s\S]*?)\];/)?.[1] ?? "";

describe("desktop MCP manual broker", () => {
  it("exposes manual configuration/connect controls but no automatic launch path", () => {
    expect(panelsSource).toContain('>("mcp.list")');
    expect(panelsSource).toContain("手动连接");
    expect(chatPanelSource).not.toContain('>("mcp.list"');

    for (const method of ["mcp.upsert", "mcp.remove", "mcp.connect", "mcp.disconnect"]) {
      expect(panelsSource, method).toContain(method);
      expect(chatPanelSource, method).not.toContain(method);
      expect(allowlist, method).toContain(`"${method}"`);
    }
    expect(allowlist).toContain('"mcp.list"');
    expect(panelsSource).toContain("Host 启动时绝不自动连接");
  });

  it("describes only the capabilities actually mounted for 0.4.0", () => {
    expect(panelsSource).toContain("文档 / PDF");
    expect(panelsSource).toContain("网页搜索 / 抓取");
    expect(panelsSource).toContain("document_read");
    expect(panelsSource).toContain("web_search / web_fetch");
    expect(panelsSource).not.toContain("ssh_exec");
    expect(panelsSource).not.toContain("SSH 检查");
  });
});
