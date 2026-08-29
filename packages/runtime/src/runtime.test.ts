import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  activatePrivateProfile,
  assertAbsoluteExecutable,
  detectKeychainOverride,
  dshWebArgs,
  doctor,
  doctorExitCode,
  EmbeddedDshSupervisor,
  ensurePrivateHome,
  evaluateInventory,
  extractedPackageRoot,
  assertPluginJsClosure,
  isOfficialDshHtml,
  isPenglaiProductTitle,
  mergeLegacyContextIntoMemory,
  probeOfficialDsh,
  recoverProfile,
  resolveRuntimeLayout,
  resolveUserLayout,
  seedFreshSettings,
  writeJournal,
  FIRST_PARTY_PLUGIN_METADATA,
  profilePluginEnabled,
  runtimePluginTarget,
  windowsOwnedProcessEnvironment,
} from "./index.js";
import { writeTestTarGz } from "../../../scripts/lib/test-tar-fixture.mjs";

test("embedded DSH Web never opens the operating-system browser", () => {
  assert.deepEqual(dshWebArgs(3080), [
    "--profile",
    "web",
    "--no-open",
    "--host",
    "127.0.0.1",
    "--port",
    "3080",
  ]);
});

test("Windows owned DSH receives only the required OS environment", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-win-env-"));
  const env = windowsOwnedProcessEnvironment(root, {
    SystemRoot: "C:\\Windows",
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
    SECRET_TOKEN: "must-not-cross",
  });
  assert.equal(env.SystemRoot, "C:\\Windows");
  assert.equal(env.USERPROFILE, root);
  assert.match(String(env.PATH), /System32/);
  assert.equal("SECRET_TOKEN" in env, false);
  assert.ok(existsSync(String(env.TEMP)));
});

function writeTrustedPluginSet(
  app: string,
  markers: Record<string, string> = {},
): void {
  const pluginsDir = join(app, "plugins");
  mkdirSync(pluginsDir, { recursive: true });
  const target = runtimePluginTarget();
  const entries = FIRST_PARTY_PLUGIN_METADATA.map((metadata) => {
    const stage = mkdtempSync(join(tmpdir(), "penglai-plugin-fixture-"));
    mkdirSync(join(stage, "dist"), { recursive: true });
    const hasClient = [
      "@penglai/plugin-center",
      "@penglai/im",
      "@penglai/asr",
      "@penglai/moss-tts",
      "@penglai/memory",
      "@penglai/office",
      "@penglai/budget",
      "@penglai/companion",
    ].includes(metadata.id);
    writeFileSync(
      join(stage, "dist", "index.js"),
      `export function apply() {}\nexport const marker = ${JSON.stringify(markers[metadata.id] ?? metadata.id)};\nexport default { apply };\n`,
    );
    if (hasClient) writeFileSync(join(stage, "dist", "client.js"), "export const apply = () => {};\n");
    if (metadata.id === "@penglai/memory") {
      const binary = join(stage, "resources", "mnemon", "mnemon");
      mkdirSync(join(stage, "resources", "mnemon"), { recursive: true });
      writeFileSync(binary, "fixture-mnemon\n", { mode: 0o755 });
      if (process.platform !== "win32") chmodSync(binary, 0o755);
    }
    writeFileSync(
      join(stage, "package.json"),
      JSON.stringify({
        name: metadata.id,
        version: metadata.version,
        type: "module",
        main: "dist/index.js",
        exports: {
          ".": "./dist/index.js",
          ...(hasClient ? { "./client": "./dist/client.js" } : {}),
        },
        penglaiPlugin: {
          schema: 1,
          id: metadata.id,
          dshExact: metadata.dsh.exact,
          target,
          platforms: metadata.platforms,
          capabilities: metadata.capabilities,
          permissions: metadata.permissions,
          source: metadata.source,
          provenanceClass: metadata.provenanceClass,
          license: metadata.license,
          migration: metadata.migration,
          rollback: metadata.rollback,
        },
      }),
    );
    const archive = join(pluginsDir, metadata.packageFile);
    writeTestTarGz(stage, archive);
    return {
      ...metadata,
      sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
      target,
      hasClient,
    };
  });
  writeFileSync(
    join(pluginsDir, "catalog.json"),
    JSON.stringify({ schema: 3, target, entries }),
  );
}

test("IM host that inlines Lark/axios CJS is rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-im-cjs-"));
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "@penglai/im", main: "dist/index.js", exports: { ".": "./dist/index.js" } }),
  );
  writeFileSync(
    join(dir, "dist", "index.js"),
    'var util = __require("util");\nthrow new Error(\'Dynamic require of "axios" is not supported\');\n',
  );
  assert.throws(() => assertPluginJsClosure(dir, "@penglai/im"), /inlines Lark\/axios CJS/);
});

test("IM host esbuild createRequire helper is not treated as an inlined CJS require", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-im-helper-"));
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "@penglai/im", main: "dist/index.js", exports: { ".": "./dist/index.js" } }),
  );
  writeFileSync(
    join(dir, "dist", "index.js"),
    [
      'import { createRequire as __penglaiCreateRequire } from "node:module";',
      "const require = __penglaiCreateRequire(import.meta.url);",
      "var __require = /* @__PURE__ */ ((x) => typeof require !== \"undefined\" ? require : x)(function(x) {",
      "  if (typeof require !== \"undefined\") return require.apply(this, arguments);",
      "  throw Error('Dynamic require of \"' + x + '\" is not supported');",
      "});",
    ].join("\n"),
  );
  assert.doesNotThrow(() => assertPluginJsClosure(dir, "@penglai/im"));
});

test("IM host that inlines form-data CJS is rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-im-formdata-"));
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "@penglai/im", main: "dist/index.js", exports: { ".": "./dist/index.js" } }),
  );
  writeFileSync(join(dir, "dist", "index.js"), 'import "./form-data/lib/form_data";\n');
  assert.throws(() => assertPluginJsClosure(dir, "@penglai/im"), /inlines Lark\/axios CJS/);
});

test("R2-DIST-003 refuses relative executables", () => {
  assert.throws(() => assertAbsoluteExecutable("dsh", "dsh"));
  assert.throws(() => assertAbsoluteExecutable("node", "node"));
});

test("R2-DIST-018 doctor is machine readable and fails closed", () => {
  const app = mkdtempSync(join(tmpdir(), "penglai-app-"));
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-user-")));
  const layout = resolveRuntimeLayout(app);
  const report = doctor(layout, user);
  assert.equal(report.pathFallback, false);
  assert.equal(report.node.present, false);
  assert.equal(doctorExitCode(report), 2);
});

test("doctor fails closed on a missing runtime manifest even when binaries exist", () => {
  const app = mkdtempSync(join(tmpdir(), "penglai-app-manifest-"));
  const layout = resolveRuntimeLayout(app);
  mkdirSync(join(app, "runtime", "node", "bin"), { recursive: true });
  mkdirSync(join(app, "runtime", "dsh", "lib"), { recursive: true });
  writeFileSync(layout.nodeBin, "#!/bin/sh\n");
  writeFileSync(layout.dshEntry, "#!/bin/sh\n");
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-user-manifest-")));
  const report = doctor(layout, user);
  assert.equal(report.node.present, true);
  assert.equal(report.runtimeManifest, "missing");
  assert.equal(doctorExitCode(report), 2);
});

test("existing profile is refreshed from newer first-party plugin tarballs", () => {
  const app = mkdtempSync(join(tmpdir(), "penglai-app-"));
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-user-")));
  mkdirSync(join(app, "profile-seed", "web"), { recursive: true });
  writeFileSync(join(app, "profile-seed", "web", "package.json"), "{\"name\":\"web\"}\n");
  mkdirSync(join(app, "runtime", "dsh", "node_modules", "@deepseek-ai"), { recursive: true });
  writeFileSync(join(app, "runtime", "dsh", "node_modules", "@deepseek-ai", ".keep"), "official\n");
  writeTrustedPluginSet(app, { "@penglai/plugin-reference": "v1" });
  mkdirSync(user.profileWeb, { recursive: true });
  mkdirSync(user.transactions, { recursive: true });
  writeFileSync(join(user.profileWeb, "package.json"), '{"name":"web"}\n');
  mkdirSync(join(user.profileWeb, "node_modules", "@penglai", "plugin-reference", "dist"), { recursive: true });
  writeFileSync(
    join(user.profileWeb, "node_modules", "@penglai", "plugin-reference", "dist", "index.js"),
    "export const marker = 'installed-by-user';\n",
  );
  const layout = resolveRuntimeLayout(app);
  activatePrivateProfile(layout, user);
  assert.match(readFileSync(join(user.profileWeb, "node_modules", "@penglai", "plugin-reference", "dist", "index.js"), "utf8"), /v1/);
  writeTrustedPluginSet(app, { "@penglai/plugin-reference": "v2" });
  activatePrivateProfile(layout, user);
  assert.match(readFileSync(join(user.profileWeb, "node_modules", "@penglai", "plugin-reference", "dist", "index.js"), "utf8"), /v2/);
});

test("R2-DIST-011 seed activates private profile once", () => {
  const app = mkdtempSync(join(tmpdir(), "penglai-app-"));
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-user-")));
  mkdirSync(join(app, "profile-seed", "web"), { recursive: true });
  writeFileSync(join(app, "profile-seed", "web", "package.json"), "{\"name\":\"web\"}\n");
  writeTrustedPluginSet(app);
  mkdirSync(join(app, "runtime", "dsh", "node_modules", "@deepseek-ai"), { recursive: true });
  writeFileSync(join(app, "runtime", "dsh", "node_modules", "@deepseek-ai", ".keep"), "official\n");
  const layout = resolveRuntimeLayout(app);
  mkdirSync(user.profileWeb, { recursive: true });
  mkdirSync(user.transactions, { recursive: true });
  activatePrivateProfile(layout, user);
  assert.equal(existsSync(join(user.profileWeb, "package.json")), true);
  assert.match(readFileSync(join(user.profileWeb, "package.json"), "utf8"), /web/);
});

test("plugin tarball root without package/ prefix is accepted", () => {
  const tmp = mkdtempSync(join(tmpdir(), "penglai-tgz-"));
  writeFileSync(join(tmp, "package.json"), "{\"name\":\"@penglai/im\"}\n");
  assert.equal(extractedPackageRoot(tmp), tmp);
});

test("process identity rejects pid reuse without matching start time", async () => {
  const { killIdentity, processStillMatches } = await import("./process.js");
  const stale = {
    pid: 1,
    pgid: 1,
    startMs: 1,
    executable: "/no/such/node",
    dshEntry: "/no/such/dsh",
    port: 1,
    startedAt: new Date(1).toISOString(),
  };
  assert.equal(processStillMatches(stale), false);
  assert.equal(killIdentity(stale, "SIGTERM"), false);
});

test("official DSH HTML identity does not depend on DeepSeek Harness title", () => {
  assert.equal(
    isOfficialDshHtml('<!doctype html><html><head><title>蓬莱 Penglai</title></head><body><div id="root"></div><script src="/assets/index.js"></script></body></html>'),
    true,
  );
  assert.equal(
    isOfficialDshHtml('<!doctype html><html><head><title>DeepSeek Harness</title></head><body><div id="root"></div><script src="/assets/index.js"></script></body></html>'),
    true,
  );
  assert.equal(
    isOfficialDshHtml('<html><body data-penglai-recovery="1"><title>蓬莱 Penglai</title><div id="root"></div></body></html>'),
    false,
  );
  assert.equal(isPenglaiProductTitle("蓬莱 Penglai"), true);
  assert.equal(isPenglaiProductTitle("Penglai · DeepSeek Harness failed to start"), false);
});

test("official DSH HTTP probe validates identity and aborts a hanging response", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/hang") return;
    res.writeHead(200, { "content-type": "text/html" });
    res.end(req.url === "/official"
      ? '<!doctype html><div id="root"></div><script src="/assets/index.js"></script>'
      : "not-dsh");
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    assert.equal((await probeOfficialDsh(`${origin}/official`, 500)).official, true);
    assert.equal((await probeOfficialDsh(`${origin}/other`, 500)).official, false);
    const started = Date.now();
    await assert.rejects(() => probeOfficialDsh(`${origin}/hang`, 40));
    assert.ok(Date.now() - started < 1_000, "hanging probe must be bounded");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});

test("embedded supervisor restarts a live process whose official HTTP route hangs", async () => {
  const app = mkdtempSync(join(tmpdir(), "penglai-health-app-"));
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-health-user-")));
  const dshEntry = join(app, "runtime", "dsh", "lib", "bin.js");
  const manifestPath = join(app, "runtime-manifest.json");
  const modePath = join(user.root, "health-mode.txt");
  mkdirSync(join(app, "runtime", "dsh", "lib"), { recursive: true });
  mkdirSync(join(app, "runtime", "dsh", "node_modules", "@deepseek-ai"), { recursive: true });
  const fakeDsh = [
    'const { createServer } = require("node:http");',
    'const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");',
    'const { join } = require("node:path");',
    'const at = process.argv.indexOf("--port");',
    'const port = Number(process.argv[at + 1]);',
    'const root = process.env.PENGLAI_USER_DATA;',
    'const plugins = join(root, "plugins");',
    'mkdirSync(plugins, { recursive: true });',
    'writeFileSync(join(plugins, "inventory-snapshot.json"), JSON.stringify({ entries: [',
    '  { moduleName: "@deepseek-ai/dsh-credentials-local", enabled: true, fiberPhase: "active", version: "0.1.1-rc.2" },',
    '  { moduleName: "@penglai/plugin-center", enabled: true, fiberPhase: "active", version: "0.5.7" },',
    '  { moduleName: "@penglai/office", enabled: true, fiberPhase: "active", version: "0.5.7" },',
    '  { moduleName: "@penglai/memory", enabled: true, fiberPhase: "active", version: "0.5.7" }',
    '] }));',
    'const modePath = join(root, "health-mode.txt");',
    'const server = createServer((_req, res) => {',
    '  const mode = existsSync(modePath) ? readFileSync(modePath, "utf8").trim() : "healthy";',
    '  if (mode === "hang") return;',
    '  res.writeHead(200, { "content-type": "text/html" });',
    '  res.end("<!doctype html><div id=\\"root\\"></div><script src=\\"/assets/index.js\\"></script>");',
    '});',
    'server.listen(port, "127.0.0.1");',
    'process.on("SIGTERM", () => {',
    '  server.closeAllConnections?.();',
    '  server.close(() => process.exit(0));',
    '  setTimeout(() => process.exit(0), 50).unref();',
    '});',
  ].join("\n");
  writeFileSync(dshEntry, fakeDsh, { mode: 0o700 });
  const digest = createHash("sha256").update(fakeDsh).digest("hex");
  writeFileSync(manifestPath, JSON.stringify({
    files: [{ path: "runtime/dsh/lib/bin.js", sha256: digest, size: Buffer.byteLength(fakeDsh) }],
  }));
  writeFileSync(modePath, "healthy\n");
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
    healthIntervalMs: 50,
    healthTimeoutMs: 100,
    unhealthyKillGraceMs: 30,
  });
  const waitUntil = async (predicate: () => boolean, timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate() && Date.now() < deadline) await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    assert.equal(predicate(), true, "supervisor transition timed out");
  };
  try {
    const first = await supervisor.start(user);
    const firstPid = supervisor.child?.pid;
    assert.equal(supervisor.state, "healthy");
    assert.ok(firstPid);
    writeFileSync(modePath, "hang\n");
    await waitUntil(() => supervisor.state === "degraded", 1_000);
    const degraded = await supervisor.start(user);
    assert.equal(degraded.port, first.port);
    assert.equal(supervisor.child?.pid, firstPid, "a degraded probe must not create a second owner");
    writeFileSync(modePath, "healthy\n");
    await waitUntil(() => supervisor.state === "healthy", 1_000);
    assert.equal(supervisor.restarts, 0);
    writeFileSync(modePath, "hang\n");
    await waitUntil(() => supervisor.restarts === 1, 3_000);
    writeFileSync(modePath, "healthy\n");
    await waitUntil(
      () => supervisor.state === "healthy" && supervisor.child?.pid !== firstPid,
      5_000,
    );
    assert.equal(supervisor.port, first.port);
    assert.equal(supervisor.health?.http, 200);
    writeFileSync(modePath, "hang\n");
    await waitUntil(() => supervisor.state === "degraded", 1_000);
    const restartsBeforeStop = supervisor.restarts;
    await supervisor.stop();
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    assert.equal(supervisor.state, "stopped");
    assert.equal(supervisor.restarts, restartsBeforeStop, "Stop must cancel health-triggered restart");
  } finally {
    writeFileSync(modePath, "healthy\n");
    await supervisor.stop();
  }
  assert.equal(supervisor.state, "stopped");
});

test("R2I-BRAND-005 fresh settings seed locale zh without overwriting", () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-user-")));
  mkdirSync(user.dshHome, { recursive: true });
  seedFreshSettings(user);
  const first = readFileSync(join(user.dshHome, "settings.yaml"), "utf8");
  assert.match(first, /preference: zh/);
  writeFileSync(join(user.dshHome, "settings.yaml"), "locale:\n  preference: en\n");
  seedFreshSettings(user);
  assert.match(readFileSync(join(user.dshHome, "settings.yaml"), "utf8"), /preference: en/);
});

test("R2I-CRED-008 keychain override is detected without reading secrets", () => {
  assert.equal(detectKeychainOverride('name: "@penglai/credentials-keychain"').required, true);
  assert.equal(detectKeychainOverride('name: "@penglai/im"').required, false);
});

test("distribution inventory requires core services but keeps optional IM absent", () => {
  const proof = evaluateInventory({
    entries: [
      { moduleName: "@deepseek-ai/dsh-credentials-local", enabled: true, fiberPhase: "active" },
      { moduleName: "@penglai/plugin-center", enabled: true, fiberPhase: "active" },
      { moduleName: "@penglai/office", enabled: true, fiberPhase: "active" },
      { moduleName: "@penglai/memory", enabled: true, fiberPhase: "active" },
      { moduleName: "@penglai/plugin-smoke", enabled: false, fiberPhase: null },
    ],
  });
  assert.equal(proof.ok, true);
  assert.equal(proof.office, true);
  assert.equal(proof.memory, true);
  assert.equal(proof.im, false);
  assert.equal(proof.smokeDisabled, true);
  const empty = evaluateInventory({});
  assert.equal(empty.ok, false);
  assert.equal(empty.office, false);
  assert.equal(empty.memory, false);
});

test("R2I-DIST-007 refuses to install historical keychain tarball into profile", () => {
  const app = mkdtempSync(join(tmpdir(), "penglai-app-"));
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-user-")));
  mkdirSync(join(app, "profile-seed", "web"), { recursive: true });
  writeFileSync(join(app, "profile-seed", "web", "package.json"), "{\"name\":\"web\"}\n");
  mkdirSync(join(app, "runtime", "dsh", "node_modules", "@deepseek-ai"), { recursive: true });
  writeFileSync(join(app, "runtime", "dsh", "node_modules", "@deepseek-ai", ".keep"), "official\n");
  const dir = mkdtempSync(join(tmpdir(), "penglai-kc-"));
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), "{\"name\":\"@penglai/credentials-keychain\",\"main\":\"dist/index.js\"}\n");
  writeFileSync(join(dir, "dist", "index.js"), "export const name = 'kc';\n");
  mkdirSync(join(app, "plugins"), { recursive: true });
  writeTestTarGz(dir, join(app, "plugins", "penglai-credentials-keychain-0.2.0.tgz"));
  writeTrustedPluginSet(app);
  mkdirSync(user.profileWeb, { recursive: true });
  mkdirSync(user.transactions, { recursive: true });
  const layout = resolveRuntimeLayout(app);
  assert.throws(() => activatePrivateProfile(layout, user), /unlisted bundled plugin archive|catalog set mismatch/);
});

test("fresh profile installs Center plus required builtins and links official @deepseek-ai", () => {
  const app = mkdtempSync(join(tmpdir(), "penglai-app-"));
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-user-")));
  mkdirSync(join(app, "profile-seed", "web"), { recursive: true });
  writeFileSync(join(app, "profile-seed", "web", "package.json"), "{\"name\":\"web\"}\n");
  const official = join(app, "runtime", "dsh", "node_modules", "@deepseek-ai", "dsh-credentials");
  mkdirSync(official, { recursive: true });
  writeFileSync(join(official, "package.json"), "{\"name\":\"@deepseek-ai/dsh-credentials\"}\n");
  writeTrustedPluginSet(app);
  const layout = resolveRuntimeLayout(app);
  mkdirSync(user.profileWeb, { recursive: true });
  mkdirSync(user.transactions, { recursive: true });
  activatePrivateProfile(layout, user);
  assert.equal(
    existsSync(join(user.profileWeb, "node_modules", "@penglai", "plugin-center", "dist", "index.js")),
    true,
  );
  assert.equal(existsSync(join(user.profileWeb, "node_modules", "@penglai", "office", "dist", "index.js")), true);
  assert.equal(existsSync(join(user.profileWeb, "node_modules", "@penglai", "memory", "dist", "index.js")), true);
  const memoryBinary = join(
    user.profileWeb,
    "node_modules",
    "@penglai",
    "memory",
    "resources",
    "mnemon",
    "mnemon",
  );
  assert.equal(existsSync(memoryBinary), true);
  if (process.platform !== "win32") {
    assert.notEqual(lstatSync(memoryBinary).mode & 0o111, 0);
  }
  assert.equal(existsSync(join(user.profileWeb, "node_modules", "@penglai", "context")), false);
  assert.equal(existsSync(join(user.profileWeb, "node_modules", "@penglai", "im", "dist", "index.js")), false);
  const linked = join(user.profileWeb, "node_modules", "@deepseek-ai");
  assert.equal(lstatSync(linked).isSymbolicLink(), true);
  assert.equal(resolve(readlinkSync(linked)), resolve(layout.officialDeepseek));
});

test("fresh catalog and profile keep every optional Penglai plugin disabled", () => {
  const required = new Set(["@penglai/plugin-center", "@penglai/office", "@penglai/memory"]);
  const optional = FIRST_PARTY_PLUGIN_METADATA.filter((entry) => !required.has(entry.id));
  assert.ok(optional.length > 0);
  assert.equal(optional.every((entry) => entry.defaultEnabled === false), true);
  assert.equal(
    FIRST_PARTY_PLUGIN_METADATA.filter((entry) => required.has(entry.id)).every(
      (entry) => entry.defaultEnabled === true,
    ),
    true,
  );
  const patch = readFileSync(new URL("../../../profile-seed/web/cordis.patch.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  for (const entry of optional) {
    const short = entry.id.replace("@penglai/", "penglai-");
    assert.match(
      patch,
      new RegExp(
        `id: ${short}\\n\\s+name: ["']${entry.id.replace("/", "\\/")}["']\\n\\s+disabled: true`,
      ),
      entry.id,
    );
  }
  for (const id of ["@penglai/office", "@penglai/memory"]) {
    const short = id.replace("@penglai/", "penglai-");
    assert.match(patch, new RegExp(`id: ${short}\\n\\s+name: ["']${id.replace("/", "\\/")}["']`));
    assert.doesNotMatch(
      patch,
      new RegExp(`id: ${short}\\n\\s+name: ["']${id.replace("/", "\\/")}["']\\n\\s+disabled: true`),
    );
  }
});

test("0.5.5 merges the legacy Context profile plugin into Memory without deleting source indexes", () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-context-merge-")));
  mkdirSync(join(user.profileWeb, "node_modules", "@penglai", "context"), { recursive: true });
  mkdirSync(join(user.root, "context"), { recursive: true });
  writeFileSync(join(user.profileWeb, "node_modules", "@penglai", "context", "package.json"), "{}\n");
  writeFileSync(join(user.root, "context", "context.sqlite3"), "preserved-index\n");
  writeFileSync(
    join(user.profileWeb, "cordis.patch.yml"),
    [
      "- insert:",
      "    - id: penglai-context",
      "      name: \"@penglai/context\"",
      "    - id: penglai-memory",
      "      name: \"@penglai/memory\"",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(user.profileWeb, "package.json"),
    JSON.stringify({
      name: "web",
      dependencies: { "@penglai/context": "0.5.3", "@penglai/memory": "0.5.5" },
    }),
  );

  const result = mergeLegacyContextIntoMemory(user);
  assert.deepEqual(result, {
    changed: true,
    profileEntryRemoved: true,
    manifestEntryRemoved: true,
    packageRemoved: true,
    dataPreserved: true,
  });
  assert.equal(existsSync(join(user.profileWeb, "node_modules", "@penglai", "context")), false);
  assert.equal(readFileSync(join(user.root, "context", "context.sqlite3"), "utf8"), "preserved-index\n");
  assert.doesNotMatch(readFileSync(join(user.profileWeb, "cordis.patch.yml"), "utf8"), /@penglai\/context/);
  assert.match(readFileSync(join(user.profileWeb, "cordis.patch.yml"), "utf8"), /@penglai\/memory/);
  const manifest = JSON.parse(readFileSync(join(user.profileWeb, "package.json"), "utf8"));
  assert.equal("@penglai/context" in manifest.dependencies, false);
  assert.equal(existsSync(join(user.root, "migrations", "context-merged-0.5.5.json")), true);
});

test(
  "legacy Context migration refuses a swapped symlink manifest",
  { skip: process.platform === "win32" ? "ordinary Windows users cannot create file symlinks" : false },
  () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-context-symlink-")));
  mkdirSync(user.profileWeb, { recursive: true });
  const outside = join(user.root, "outside.json");
  writeFileSync(outside, JSON.stringify({ dependencies: { "@penglai/context": "0.5.3" } }));
  symlinkSync(outside, join(user.profileWeb, "package.json"));
  assert.throws(() => mergeLegacyContextIntoMemory(user), /symlink source/i);
  assert.match(readFileSync(outside, "utf8"), /@penglai\/context/);
  },
);

test("R2-DIST-012 interrupted staging rolls back", () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-user-")));
  mkdirSync(user.transactions, { recursive: true });
  mkdirSync(user.profileWeb, { recursive: true });
  writeJournal(user, { id: "t1", phase: "staging", lastGood: user.profileWeb });
  mkdirSync(join(user.transactions, "staging"), { recursive: true });
  const j = recoverProfile(user);
  assert.equal(j.phase, "rolled_back");
});

test("fresh profile activation uses an atomic directory switch and leaves no staging tree", () => {
  const app = mkdtempSync(join(tmpdir(), "penglai-app-atomic-seed-"));
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-user-atomic-seed-")));
  mkdirSync(join(app, "profile-seed", "web"), { recursive: true });
  writeFileSync(join(app, "profile-seed", "web", "package.json"), '{"name":"web"}\n');
  writeTrustedPluginSet(app);
  mkdirSync(join(app, "runtime", "dsh", "node_modules", "@deepseek-ai"), { recursive: true });
  writeFileSync(join(app, "runtime", "dsh", "node_modules", "@deepseek-ai", ".keep"), "official\n");
  mkdirSync(user.profileWeb, { recursive: true });
  mkdirSync(user.transactions, { recursive: true });
  activatePrivateProfile(resolveRuntimeLayout(app), user);
  const journal = JSON.parse(readFileSync(join(user.transactions, "journal.json"), "utf8")) as {
    phase: string;
    staging?: string;
    backup?: string;
  };
  assert.equal(journal.phase, "committed");
  assert.equal(journal.staging, undefined);
  assert.equal(journal.backup, undefined);
  assert.equal(existsSync(join(user.profileWeb, "package.json")), true);
});

test("interrupted atomic activation restores the pre-activation directory", () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-user-atomic-rollback-")));
  const staging = join(user.transactions, "seed.staging-web");
  const backup = join(user.transactions, "seed.pre-activation");
  mkdirSync(user.profileWeb, { recursive: true });
  mkdirSync(staging, { recursive: true });
  mkdirSync(backup, { recursive: true });
  writeFileSync(join(user.profileWeb, "package.json"), '{"name":"new"}\n');
  writeFileSync(join(backup, "old.txt"), "preserved\n");
  writeJournal(user, { id: "seed", phase: "activating", staging, backup });
  const journal = recoverProfile(user);
  assert.equal(journal.phase, "rolled_back");
  assert.equal(readFileSync(join(user.profileWeb, "old.txt"), "utf8"), "preserved\n");
  assert.equal(existsSync(staging), false);
});

test("Center transaction is restored before DSH profile activation", () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-center-preboot-")));
  const txDir = join(user.root, "profiles", "center-tx");
  mkdirSync(user.profileWeb, { recursive: true });
  mkdirSync(join(txDir, "last-good"), { recursive: true });
  mkdirSync(join(user.root, "plugins"), { recursive: true });
  mkdirSync(user.transactions, { recursive: true });
  writeFileSync(join(user.profileWeb, "cordis.patch.yml"), "failed: true\n");
  writeFileSync(join(txDir, "last-good", "cordis.patch.yml"), "good: true\n");
  writeFileSync(join(user.root, "plugins", "desired.json"), JSON.stringify({ "@penglai/im": false }));
  writeFileSync(join(txDir, "active.lock"), "fixture");
  writeFileSync(
    join(txDir, "journal.json"),
    JSON.stringify({
      schema: 2,
      operationId: "24e69732-d08b-4f05-a628-ddf0bcf99a50",
      phase: "verifying",
      id: "@penglai/im",
      action: "disable",
      previousEnabled: true,
      version: "0.5.0",
    }),
  );
  recoverProfile(user);
  assert.match(readFileSync(join(user.profileWeb, "cordis.patch.yml"), "utf8"), /good: true/);
  const desired = JSON.parse(readFileSync(join(user.root, "plugins", "desired.json"), "utf8")) as Record<string, boolean>;
  assert.equal(desired["@penglai/im"], true);
  assert.equal(existsSync(join(txDir, "active.lock")), false);
  const journal = JSON.parse(readFileSync(join(txDir, "journal.json"), "utf8")) as { phase: string };
  assert.equal(journal.phase, "rolled_back");
});

test("Center preboot heals the last-good promotion crash window", () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-center-preboot-next-")));
  const txDir = join(user.root, "profiles", "center-tx");
  mkdirSync(user.profileWeb, { recursive: true });
  mkdirSync(join(txDir, "last-good-next-op"), { recursive: true });
  mkdirSync(join(user.root, "plugins"), { recursive: true });
  mkdirSync(user.transactions, { recursive: true });
  writeFileSync(join(user.profileWeb, "cordis.patch.yml"), "failed: true\n");
  writeFileSync(join(txDir, "last-good-next-op", "cordis.patch.yml"), "healed: true\n");
  writeFileSync(join(user.root, "plugins", "desired.json"), JSON.stringify({ "@penglai/im": false }));
  writeFileSync(
    join(txDir, "journal.json"),
    JSON.stringify({
      schema: 2,
      operationId: "24e69732-d08b-4f05-a628-ddf0bcf99a51",
      phase: "verifying",
      id: "@penglai/im",
      previousEnabled: true,
    }),
  );
  recoverProfile(user);
  assert.match(readFileSync(join(user.profileWeb, "cordis.patch.yml"), "utf8"), /healed: true/);
  assert.equal(existsSync(join(txDir, "last-good")), true);
});

test("owned DSH spawn pins cwd to DSH_HOME so repo .env cannot be a secret layer", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /cwd:\s*user\.dshHome/);
  assert.match(src, /DSH_HOME:\s*user\.dshHome/);
  assert.match(src, /PENGLAI_APP_ROOT:\s*env\.PENGLAI_APP_ROOT/);
  assert.match(src, /PENGLAI_MNEMON_BINARY:\s*env\.PENGLAI_MNEMON_BINARY/);
  assert.match(src, /DSH_TELEMETRY_DISABLED:\s*"1"/);
  assert.doesNotMatch(src, /DSH_TELEMETRY_MODE/);
  assert.doesNotMatch(src, /DSH_TELEMETRY_OTLP_URL/);
  assert.doesNotMatch(src, /cwd:\s*process\.cwd\(\)/);
  const yamlHook = src.includes("join(user.dshHome, \".credentials.yaml\")") || src.includes('join(user.dshHome, ".credentials.yaml")');
  assert.equal(yamlHook, true);
});

test("P51-CORE-001 optional plugins stay disabled despite indent, comments, and reordering", () => {
  const patch = `
# seed
- id: penglai-plugin-center
  name: "@penglai/plugin-center"
- name: "@penglai/im"
  id: penglai-im
  disabled: true
- id: penglai-asr
  disabled: true # comment
`;
  assert.equal(profilePluginEnabled(patch, "@penglai/plugin-center"), true);
  assert.equal(profilePluginEnabled(patch, "@penglai/im"), false);
  assert.equal(profilePluginEnabled(patch, "@penglai/asr"), false);
  assert.equal(profilePluginEnabled(patch, "@penglai/companion"), false);
  assert.equal(profilePluginEnabled("- id: penglai-im\n  disabled: true\n", "@penglai/im"), false);
});
