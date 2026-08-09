import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(DESKTOP, "../..");
const SRC_TAURI = path.join(DESKTOP, "src-tauri");

describe("desktop renderer security surface", () => {
  it("keeps updater installation behind the audited native wrapper", () => {
    const capabilities = JSON.parse(
      fs.readFileSync(path.join(SRC_TAURI, "capabilities", "default.json"), "utf-8"),
    ) as { permissions: string[] };
    const desktopPackage = JSON.parse(
      fs.readFileSync(path.join(DESKTOP, "package.json"), "utf-8"),
    ) as { dependencies?: Record<string, string> };

    expect(capabilities.permissions.some((permission) => permission.startsWith("updater:"))).toBe(
      false,
    );
    expect(desktopPackage.dependencies).not.toHaveProperty("@tauri-apps/plugin-updater");
    const updater = fs.readFileSync(path.join(DESKTOP, "updater", "update.rs"), "utf-8");
    expect(updater).not.toContain("pub fn verify_signature");
    expect(updater).toContain("ensure_owned_host_for_update()?;");
    expect(updater).toContain("stop_owned_host_for_update()");
  });

  it("does not expose the global Tauri API or production loopback/network origins", () => {
    const conf = JSON.parse(
      fs.readFileSync(path.join(SRC_TAURI, "tauri.conf.json"), "utf-8"),
    ) as {
      app?: {
        withGlobalTauri?: boolean;
        security?: { csp?: string; devCsp?: string };
      };
    };
    const csp = conf.app?.security?.csp ?? "";

    expect(conf.app?.withGlobalTauri).toBe(false);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/127\.0\.0\.1|localhost|github\.com|gh-proxy\.com/);
    expect(conf.app?.security?.devCsp).toContain("ws://localhost:1420");
  });

  it("keeps the Host token out of the native websocket URL", () => {
    const rust = fs.readFileSync(path.join(SRC_TAURI, "src", "lib.rs"), "utf-8");
    expect(rust).toContain('"GET /ws?channel={} HTTP/1.1\\r\\n\\');
    expect(rust).toContain("X-Penglai-Token: {token}\\r\\n\\");
    expect(rust).not.toContain("GET /ws?token=");
  });

  it("keeps the Host token out of every renderer and proxy websocket URL", () => {
    const renderer = fs.readFileSync(path.join(DESKTOP, "src", "bridge", "http-bridge.ts"), "utf-8");
    const proxy = fs.readFileSync(path.join(DESKTOP, "vite.config.ts"), "utf-8");
    const staticApp = fs.readFileSync(path.join(ROOT, "packages", "host", "static", "app.js"), "utf-8");

    expect(renderer).not.toContain("token=${");
    expect(proxy).toContain("proxyReq.setHeader(\"X-Penglai-Token\"");
    expect(staticApp).not.toContain("?token=");
    expect(staticApp).toContain("penglai.auth.");
  });

  it("runs the AST allowlist gate against conditional and multiline renderer calls", () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts", "check-desktop-allowlist.mjs"), "utf-8");
    const rust = fs.readFileSync(path.join(SRC_TAURI, "src", "lib.rs"), "utf-8");

    expect(script).toContain("ts.createSourceFile");
    expect(script).toContain("ts.isConditionalExpression");
    expect(script).toContain("unresolvedRendererCalls");
    expect(rust).toContain('"conversation.approval.approve"');
    expect(rust).toContain('"conversation.approval.reject"');
  });
});
