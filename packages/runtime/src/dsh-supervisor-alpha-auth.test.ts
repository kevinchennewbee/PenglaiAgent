import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EmbeddedDshSupervisor,
  ensurePrivateHome,
  resolveUserLayout,
  runtimePluginTarget,
} from "./index.js";

test("embedded supervisor privately exchanges alpha browser auth and keeps steady-state probes authenticated", async () => {
  const app = mkdtempSync(join(tmpdir(), "penglai-alpha-auth-app-"));
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-alpha-auth-user-")));
  const dshEntry = join(app, "runtime", "dsh", "lib", "bin.js");
  const manifestPath = join(app, "runtime-manifest.json");
  const token = "h".repeat(43);
  const cookie = `dsh-auth-${"i".repeat(43)}=v1.${"j".repeat(43)}.${"k".repeat(43)}`;
  mkdirSync(join(app, "runtime", "dsh", "lib"), { recursive: true });
  mkdirSync(join(app, "runtime", "dsh", "node_modules", "@deepseek-ai"), { recursive: true });
  const fakeDsh = [
    'const { createServer } = require("node:http");',
    'const { mkdirSync, writeFileSync } = require("node:fs");',
    'const { join } = require("node:path");',
    'const at = process.argv.indexOf("--port");',
    'const port = Number(process.argv[at + 1]);',
    'const root = process.env.PENGLAI_USER_DATA;',
    'const plugins = join(root, "plugins");',
    'mkdirSync(plugins, { recursive: true });',
    `writeFileSync(join(plugins, "inventory-snapshot.json"), ${JSON.stringify(JSON.stringify({
      entries: [
        { moduleName: "@deepseek-ai/dsh-credentials-local", enabled: true, fiberPhase: "active", version: "0.1.2-alpha.1" },
        { moduleName: "@penglai/plugin-center", enabled: true, fiberPhase: "active", version: "0.5.7" },
        { moduleName: "@penglai/office", enabled: true, fiberPhase: "active", version: "0.5.7" },
        { moduleName: "@penglai/memory", enabled: true, fiberPhase: "active", version: "0.5.7" },
      ],
      target: runtimePluginTarget(),
    }))});`,
    `const token = ${JSON.stringify(token)};`,
    `const cookie = ${JSON.stringify(cookie)};`,
    'const html = "<!doctype html><div id=\\"root\\"></div><script src=\\"/assets/index.js\\"></script>";',
    'const server = createServer((req, res) => {',
    '  const url = new URL(req.url || "/", "http://dsh.invalid");',
    '  if (url.pathname === "/" && url.searchParams.get("token") === token) {',
    '    res.writeHead(303, { location: "/", "set-cookie": `${cookie}; Path=/; HttpOnly; SameSite=Strict` }).end();',
    '    return;',
    '  }',
    '  if (url.pathname === "/" && req.headers.cookie === cookie) {',
    '    res.writeHead(200, { "content-type": "text/html" }).end(html);',
    '    return;',
    '  }',
    '  res.writeHead(401).end("authentication required");',
    '});',
    'server.listen(port, "127.0.0.1", () => console.log(`dsh web: http://127.0.0.1:${port}/?token=${token}`));',
    'process.on("SIGTERM", () => {',
    '  server.closeAllConnections?.();',
    '  server.close(() => process.exit(0));',
    '  setTimeout(() => process.exit(0), 50).unref();',
    '});',
  ].join("\n");
  writeFileSync(dshEntry, fakeDsh, { mode: 0o700 });
  writeFileSync(manifestPath, JSON.stringify({
    files: [{
      path: "runtime/dsh/lib/bin.js",
      sha256: createHash("sha256").update(fakeDsh).digest("hex"),
      size: Buffer.byteLength(fakeDsh),
    }],
  }));
  ensurePrivateHome(user, app);
  const supervisor = new EmbeddedDshSupervisor({
    appRoot: app,
    nodeBin: process.execPath,
    dshEntry,
    profileSeed: join(app, "profile-seed", "web"),
    pluginsDir: join(app, "plugins"),
    manifestPath,
    officialDeepseek: join(app, "runtime", "dsh", "node_modules", "@deepseek-ai"),
  }, {
    healthIntervalMs: 30,
    healthTimeoutMs: 200,
    startupHttpTimeoutMs: 1_000,
    inventoryTimeoutMs: 1_000,
  });
  try {
    await supervisor.start(user);
    assert.equal(supervisor.state, "healthy");
    assert.equal(supervisor.webAuthMode, "browser-cookie");
    assert.equal(supervisor.upstreamCookie, cookie);
    assert.equal(supervisor.logs.includes(token), false);
    assert.match(supervisor.logs, /token=\[redacted\]/);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    assert.equal(supervisor.state, "healthy");
    assert.equal(supervisor.health?.http, 200);
  } finally {
    await supervisor.stop();
  }
  assert.equal(supervisor.state, "stopped");
});
