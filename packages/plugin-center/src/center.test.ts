import assert from "node:assert/strict";
import test from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import vm from "node:vm";
import {
  PluginCenterHost,
  R2_CATALOG,
  createPluginLifecycle,
  pluginHealthFrom,
  validateCatalog,
  verifyPackage,
  workspaceProtectionSnapshot,
} from "./index.js";
import { contribute } from "./client.js";
import { type PluginCatalogEntry } from "@penglai/runtime";

const TEST_CATALOG: PluginCatalogEntry[] = R2_CATALOG.map((entry) => ({
  ...entry,
  sha256: "a".repeat(64),
  target: "darwin-arm64",
  hasClient: [
    "@penglai/plugin-center",
    "@penglai/im",
    "@penglai/asr",
    "@penglai/moss-tts",
  ].includes(entry.id),
}));

function hostWith(inventory: { list(): unknown }) {
  return new PluginCenterHost(
    mkdtempSync(join(tmpdir(), "pc-")),
    inventory,
    TEST_CATALOG,
  );
}

test("R2I-CENTER-001 client owns the official Penglai overview settings section", () => {
  assert.equal(contribute().slot, "settings.section");
});

test("official Workspace protection snapshot binds requested and canonical roots", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-workspace-protection-"));
  const snapshot = workspaceProtectionSnapshot(
    [{ id: "ws-1", path: root }],
    "2026-08-17T00:00:00.000Z",
  );
  assert.equal(snapshot.complete, true);
  assert.deepEqual(
    snapshot.roots,
    [...new Set([resolve(root), realpathSync(root)])].sort(),
  );
  const invalid = workspaceProtectionSnapshot([
    { id: "ws-2", path: "relative/path" },
  ]);
  assert.equal(invalid.complete, false);
  assert.deepEqual(invalid.roots, []);
});

test("R50-E2E-003 Center client marks loading and ready with data-penglai-center", () => {
  const client = readFileSync(
    new URL("./dsh-client.js", import.meta.url),
    "utf8",
  );
  assert.match(client, /data-penglai-center": "1"/);
  assert.match(client, /data-penglai-center-status": "loading"/);
  assert.match(client, /data-penglai-update/);
  assert.match(client, /data-penglai-uninstall/);
  assert.match(client, /unwrapRemote/);
  assert.match(client, /const inventoryRemote = ctx\.remote\.pluginInventory/);
  assert.match(client, /inventoryRemote\?\.list/);
  assert.match(client, /"ok" in result/);
  assert.match(client, /data-penglai-plugin-card/);
  assert.match(client, /data-penglai-plugin-installed/);
  assert.match(client, /data-penglai-plugin-loaded/);
  assert.match(client, /data-penglai-plugin-action/);
  assert.match(client, /@penglai\/asr/);
  assert.match(client, /@penglai\/moss-tts/);
  assert.equal(client.includes("@penglai/context"), false);
  assert.match(client, /FIRST_PARTY_CARDS/);
  assert.match(client, /snapshot\?\.remote/);
  assert.match(client, /data-penglai-plugin-source/);
  assert.match(client, /refreshRegistry/);
  assert.match(client, /installDisabled/);
  assert.equal(client.includes('"settings.penglai.page"'), false);
  assert.match(client, /ctx\.slots\.inject\("settings\.section"/);
  assert.match(client, /id: "penglai-center"/);
  assert.match(client, /id: "penglai-update"/);
  assert.match(client, /id: "penglai-uninstall"/);
  assert.match(client, /data-penglai-settings/);
  assert.equal(client.includes("penglai-settings-layout"), false);
  assert.match(client, /penglai-capability-grid/);
  assert.match(client, /data-penglai-plugin-action-status/);
  assert.match(client, /data-penglai-plugin-action-busy/);
  assert.match(client, /window\.location\.reload\(\)/);
  assert.match(client, /unwrapRemote\(await centerRemote\.enable/);
  assert.match(client, /centerRemote\.refreshRegistry/);
  assert.match(client, /restartRequired === true/);
  assert.match(client, /api\.restartPluginRuntime\(\{ id \}\)/);
  const block = client.match(/const FIRST_PARTY_CARDS = \[([\s\S]*?)\];/);
  assert.ok(block);
  const cardIds = [...block[1].matchAll(/id: "(@penglai\/[^"]+)"/g)].map(
    (row) => row[1],
  );
  assert.deepEqual(cardIds, [
    "@penglai/im",
    "@penglai/office",
    "@penglai/asr",
    "@penglai/moss-tts",
    "@penglai/memory",
    "@penglai/companion",
  ]);
  assert.match(client, /const remoteCardIds = state\.remote/);
  assert.match(client, /\.\.\.remoteCardIds/);
  assert.match(client, /all\.indexOf\(id\) === index/);
  assert.match(client, /entry\.incompatible \|\| entry\.dshCompatible === false/);
  assert.match(client, /centerStatusIncompatible/);
  assert.doesNotMatch(client, /\[\.\.\.state\.remote, \.\.\.state\.catalog, \.\.\.FIRST_PARTY_CARDS\]/);
  assert.match(client, /data-penglai-plugin-diagnostics/);
  const diagnostics = client.slice(client.indexOf("data-penglai-plugin-diagnostics"));
  assert.match(diagnostics, /centerDesired/);
  assert.match(diagnostics, /centerActual/);
  assert.ok(
    client.indexOf("data-penglai-plugin-diagnostics") > client.indexOf("data-penglai-plugin-advanced"),
    "desired/actual diagnostics belong inside the advanced details",
  );
});

test("Penglai branding shadows rc.8 official single slots at a distinct priority", () => {
  const client = readFileSync(
    new URL("./dsh-client.js", import.meta.url),
    "utf8",
  );
  for (const slot of [
    "sidebar.brand.mark",
    "sidebar.brand.name",
    "conversation.hero.brand.mark",
  ]) {
    assert.match(
      client,
      new RegExp(`ctx\\.slots\\.inject\\(\"${slot.replaceAll(".", "\\.")}\"`),
    );
    assert.match(
      client,
      new RegExp(
        `ctx\\.slots\\.register\\(\\s*\\{ name: \"${slot.replaceAll(".", "\\.")}\", priority: -100 \\}`,
      ),
    );
  }
  assert.match(client, /data-penglai-brand-mark/);
  assert.match(client, /data-penglai-brand-name/);
  assert.match(client, /penglai-brand\/logo-64\.png/);
  assert.match(client, /penglai-brand\/logo-256\.png/);
  assert.match(client, /penglai-brand-fallback/);
  assert.match(client, /onError: \(\) => setFailed\(true\)/);
});

test("R50-IM-002 onboarding remotes are not blocked by a prior penglaiCenter provide", () => {
  const host = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(host, /new PenglaiOnboardingRemote/);
  assert.match(host, /new PenglaiCenterRemote/);
  const provideThenRemote =
    /provide\?\.\("penglaiCenter"[\s\S]{0,120}new PenglaiCenterRemote/;
  assert.equal(provideThenRemote.test(host), false);
});

test("production Center has Typert remote and no ad-hoc HTTP", async () => {
  const { readFileSync } = await import("node:fs");
  const host = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const client = readFileSync(
    new URL("./dsh-client.js", import.meta.url),
    "utf8",
  );
  const remotes = readFileSync(
    new URL("./remotes.ts", import.meta.url),
    "utf8",
  );
  assert.equal(host.includes("/penglai/center"), false);
  assert.equal(client.includes('fetch("/penglai/center"'), false);
  assert.match(remotes, /TypertRemoteService/);
  assert.match(remotes, /penglaiCenter/);
});

test("Center lifecycle creates a newly installed plugin by loader entry id and removes it on rollback", async () => {
  const rows: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  const loader = {
    resolve(id: string) {
      calls.push(`resolve:${id}`);
      return {
        async update(options: { disabled?: boolean }) {
          calls.push(`update:${id}:${String(options.disabled)}`);
        },
      };
    },
    async create(options: { id: string; name: string; disabled?: boolean }) {
      calls.push(
        `create:${options.id}:${options.name}:${String(options.disabled)}`,
      );
      rows.push({
        entryId: options.id,
        moduleName: options.name,
        fiberPhase: options.disabled ? "disabled" : "active",
      });
      return options.id;
    },
    async remove(id: string) {
      calls.push(`remove:${id}`);
      const index = rows.findIndex((row) => row.entryId === id);
      if (index >= 0) rows.splice(index, 1);
    },
    async await() {
      calls.push("await");
    },
  };
  const lifecycle = createPluginLifecycle(loader, { list: () => rows });
  await lifecycle.apply({
    id: "@penglai/office-reader",
    enabled: false,
    forceReload: false,
    present: true,
  });
  assert.deepEqual(calls, [
    "create:penglai-office-reader:@penglai/office-reader:true",
    "await",
  ]);
  assert.equal(rows.length, 1);

  calls.length = 0;
  await lifecycle.apply({
    id: "@penglai/office-reader",
    enabled: false,
    forceReload: false,
    present: false,
  });
  assert.deepEqual(calls, ["remove:penglai-office-reader", "await"]);
  assert.equal(rows.length, 0);
});

test("Penglai settings mounts strict generated-client descriptors before using remotes", async () => {
  let application: Promise<unknown> | undefined;
  let contribution:
    | { package: string; descriptors: Array<Record<string, unknown>> }
    | undefined;
  let viewDependencies: string[] = [];
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(mod: {
          factory: (req: (name: string) => unknown) => {
            apply: (ctx: unknown) => Promise<unknown>;
          };
        }) {
          const exported = mod.factory((name) =>
            name === "react"
              ? {
                  useState() {},
                  useEffect() {},
                  useCallback(value: unknown) {
                    return value;
                  },
                }
              : { jsx() {}, jsxs() {} },
          );
          application = exported.apply({
            remote: {
              async $mount(value: typeof contribution) {
                contribution = value;
                return () => undefined;
              },
            },
            inject(dependencies: string[], callback: (ctx: unknown) => void) {
              viewDependencies = Array.from(dependencies);
              callback({
                remote: {
                  penglaiCenter: {},
                  pluginInventory: {},
                },
                slots: { inject() {} },
                connection: {},
                locale: {},
                effect() {
                  return () => undefined;
                },
              });
              return Object.assign(Promise.resolve(), {
                dispose: async () => undefined,
              });
            },
          });
        },
      },
    },
    document: {
      documentElement: { lang: "zh" },
      createElement() {
        return { setAttribute() {}, remove() {}, textContent: "" };
      },
      head: { appendChild() {} },
    },
    console,
    setInterval,
    clearInterval,
  };
  vm.runInNewContext(
    readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8"),
    sandbox,
  );
  await application;
  assert.equal(contribution?.package, "@penglai/plugin-center");
  assert.deepEqual(viewDependencies, [
    "slots",
    "connection",
    "locale",
    "remote.penglaiCenter",
    "remote.pluginInventory",
  ]);
  const endpoints = new Set(
    contribution?.descriptors.map((row) => `${row.namespace}/${row.method}`),
  );
  for (const endpoint of ["penglaiCenter/list", "penglaiCenter/enable"])
    assert.ok(endpoints.has(endpoint), endpoint);
  const enable = contribution?.descriptors.find(
    (row) => row.namespace === "penglaiCenter" && row.method === "enable",
  ) as {
    parameters: Array<{
      codec: { mode: string; schema: { parse(value: unknown): unknown } };
    }>;
    result: { mode: string; schema: { parse(value: unknown): unknown } };
  };
  assert.equal(enable.parameters[0]?.codec.mode, "strict");
  assert.deepEqual(
    enable.parameters[0]?.codec.schema.parse({ id: "@penglai/im" }),
    { id: "@penglai/im" },
  );
  assert.throws(
    () => enable.parameters[0]?.codec.schema.parse(new Date()),
    /plain object/,
  );
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => enable.result.schema.parse(cyclic), /cyclic/);
});

test("each independent Penglai client owns only its typed Remote lifecycle", () => {
  const clients = [
    ["../../im/src/dsh-client.js", "@penglai/im", "penglaiIm"],
    ["../../asr/src/dsh-client.js", "@penglai/asr", "penglaiAsrSettings"],
    [
      "../../moss-tts/src/dsh-client.js",
      "@penglai/moss-tts",
      "penglaiMossTtsSettings",
    ],
    [
      "../../memory/src/dsh-client.js",
      "@penglai/memory",
      "penglaiMemorySettings",
    ],
    [
      "../../budget/src/dsh-client.js",
      "@penglai/budget",
      "penglaiBudgetSettings",
    ],
    [
      "../../companion/src/dsh-client.js",
      "@penglai/companion",
      "penglaiCompanionSettings",
    ],
    ["../../office/src/dsh-client.js", "@penglai/office", "penglaiOfficeSettings"],
  ];
  for (const [path, packageName, namespace] of clients) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, new RegExp(`package: ${JSON.stringify(packageName)}`));
    assert.match(source, new RegExp(`namespace: ${JSON.stringify(namespace)}`));
    assert.match(source, /await ctx\.remote\.\$mount\(REMOTE\)/);
    assert.match(source, new RegExp(`"remote\\.${namespace}"`));
    assert.match(
      source,
      new RegExp(`${namespace}: viewCtx\\.remote\\.${namespace}`),
    );
    assert.match(source, /const pageRemote = \{/);
    assert.doesNotMatch(source, /inject: \(\) => \(\{ remote: ctx\.remote/);
    assert.match(source, /await viewFiber\.dispose\(\)/);
    assert.ok(
      source.indexOf("await viewFiber.dispose()") <
        source.indexOf("await disposeRemote()", source.indexOf("return async")),
    );
    assert.match(source, /mode: "strict"/);
    assert.match(source, /rejects unsafe fields/);
  }
  const context = readFileSync(
    new URL("../../context/src/dsh-client.js", import.meta.url),
    "utf8",
  );
  assert.match(context, /package: "@penglai\/memory"/);
  assert.match(context, /namespace: "penglaiMemorySourcesSettings"/);
  assert.match(context, /await ctx\.remote\.\$mount\(REMOTE\)/);
  assert.match(context, /module\.exports = \{ apply, inject, ContextTab \}/);
  assert.doesNotMatch(context, /slots\.register/);
  assert.doesNotMatch(context, /viewFiber/);
  assert.match(context, /mode: "strict"/);
  assert.match(context, /rejects unsafe fields/);
});

test("R2I-CENTER-013 catalog has real first-party plugins and no historical cards", () => {
  validateCatalog(R2_CATALOG);
  assert.equal(
    R2_CATALOG.some((e) => /keychain|plugin-smoke/i.test(e.id)),
    false,
  );
  for (const id of [
    "@penglai/asr",
    "@penglai/moss-tts",
    "@penglai/memory",
    "@penglai/budget",
    "@penglai/companion",
  ]) {
    assert.ok(
      R2_CATALOG.some((e) => e.id === id),
      id,
    );
  }
  assert.ok(
    R2_CATALOG.every(
      (e) =>
        e.provenanceClass === "penglai-builtin" ||
        e.provenanceClass === "penglai-first-party",
    ),
  );
});

test("R2-PC-017 rejects unlisted packages", () => {
  const host = hostWith({ list: () => [] });
  assert.throws(() => host.setDesired("@evil/pkg", true));
});

test("setDesired accepts signed catalog ids via allowId", () => {
  const host = new PluginCenterHost(
    mkdtempSync(join(tmpdir(), "pc-allow-")),
    { list: () => [] },
    TEST_CATALOG,
    undefined,
    undefined,
    (id) => id === "@penglai/plugin-pilot",
  );
  host.setDesired("@penglai/plugin-pilot", false);
  assert.equal(host.desired()["@penglai/plugin-pilot"], false);
  assert.equal(
    host.reconcile().find((row) => row.id === "@penglai/plugin-pilot")?.desired,
    "disabled",
  );
  assert.throws(() => host.setDesired("@evil/pkg", true));
});

test("Center desired state is explicit and never changes loader actual", () => {
  const host = hostWith({ list: () => [] });
  host.setDesired("@penglai/plugin-reference", true);
  host.setDesired("@penglai/plugin-reference", false);
  assert.equal(host.desired()["@penglai/plugin-reference"], false);
  assert.equal(
    host.reconcile().find((entry) => entry.id === "@penglai/plugin-reference")
      ?.actual,
    "disabled",
  );
});

test("upsertPatchDisabled appends a remote loader row when missing", async () => {
  const { upsertPatchDisabled } = await import("./profile-tx.js");
  const src = `- insert:\n    - id: penglai-plugin-center\n      name: "@penglai/plugin-center"\n`;
  const next = upsertPatchDisabled(src, "@penglai/plugin-pilot", true);
  assert.match(next, /name: "@penglai\/plugin-pilot"/);
  assert.match(next, /disabled: true/);
});

test("center profile patch enable/disable is textual and reversible", async () => {
  const { setPatchDisabled } = await import("./profile-tx.js");
  const src = `- insert:\n    - id: penglai-plugin-reference\n      name: "@penglai/plugin-reference"\n`;
  const off = setPatchDisabled(src, "@penglai/plugin-reference", true);
  assert.match(off, /^\s+disabled: true$/m);
  assert.doesNotMatch(off, /^disabled:/m);
  const on = setPatchDisabled(off, "@penglai/plugin-reference", false);
  assert.match(on, /^\s+disabled: false$/m);
});

test("center disable keeps official seed patch YAML indented", async () => {
  const { readFileSync } = await import("node:fs");
  const { setPatchDisabled } = await import("./profile-tx.js");
  const src = readFileSync(
    new URL("../../../profile-seed/web/cordis.patch.yml", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const off = setPatchDisabled(src, "@penglai/plugin-reference", true);
  assert.match(
    off,
    /id: penglai-plugin-reference\n\s+name: "@penglai\/plugin-reference"\n\s+disabled: true/,
  );
  assert.doesNotMatch(off, /^disabled:/m);
  const on = setPatchDisabled(off, "@penglai/plugin-reference", false);
  assert.match(
    on,
    /id: penglai-plugin-reference\n\s+name: "@penglai\/plugin-reference"\n\s+disabled: false/,
  );
});

test("R50-UPD-006/R50-UN-001 settings client registers update and uninstall categories", () => {
  const client = readFileSync(
    new URL("./dsh-client.js", import.meta.url),
    "utf8",
  );
  assert.match(client, /data-penglai-update/);
  assert.match(client, /data-penglai-uninstall/);
  assert.match(client, /desktop-v0\.5/);
  assert.match(client, /data-penglai-data-category/);
  assert.match(client, /workspace/);
  assert.match(client, /legacy/);
  assert.match(client, /silent auto-update|静默自动更新/);
  assert.match(client, /id: "penglai-update",\s*order: 18\.8/);
  assert.match(client, /id: "penglai-uninstall",\s*order: 18\.9/);
});

test("R50-CENTER-004/007 first enable installs verified package and rejects a bad update", async () => {
  const { execFileSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const { runProfileTransaction } = await import("./profile-tx.js");
  const root = mkdtempSync(join(tmpdir(), "penglai-center-tx-"));
  const profile = join(root, "dsh-home", "profiles", "web");
  const plugins = join(root, "bundled-plugins");
  mkdirSync(profile, { recursive: true });
  mkdirSync(plugins, { recursive: true });
  writeFileSync(
    join(profile, "cordis.patch.yml"),
    '- insert:\n    - id: penglai-plugin-reference\n      name: "@penglai/plugin-reference"\n',
  );
  const pkgDir = join(root, "pkg");
  mkdirSync(join(pkgDir, "dist"), { recursive: true });
  const metadata = R2_CATALOG.find(
    (entry) => entry.id === "@penglai/plugin-reference",
  )!;
  writeFileSync(
    join(pkgDir, "dist", "index.js"),
    "export function apply() {}\nexport default { apply };\n",
  );
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: metadata.id,
      version: metadata.version,
      type: "module",
      main: "dist/index.js",
      exports: { ".": "./dist/index.js" },
      penglaiPlugin: {
        schema: 1,
        id: metadata.id,
        dshExact: metadata.dsh.exact,
        target: "darwin-arm64",
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
  const tgz = join(plugins, metadata.packageFile);
  execFileSync("tar", ["-czf", tgz, "-C", pkgDir, "."]);
  const sha = createHash("sha256").update(readFileSync(tgz)).digest("hex");
  const entry: PluginCatalogEntry = {
    ...metadata,
    sha256: sha,
    target: "darwin-arm64",
    hasClient: false,
  };
  let loaded = false;
  let desired = false;
  const ok = await runProfileTransaction({
    userDataRoot: root,
    profileDir: profile,
    txDir: join(root, "tx"),
    pluginsDir: plugins,
    entry,
    action: "enable",
    previousEnabled: false,
    applyLive: async ({ enabled }) => {
      loaded = enabled;
    },
    verifyActual: async ({ enabled }) => assert.equal(loaded, enabled),
    commitDesired: (enabled) => {
      desired = enabled;
    },
    rollbackDesired: (enabled) => {
      desired = enabled;
    },
  });
  assert.equal(ok.phase, "committed");
  assert.equal(desired, true);
  assert.equal(
    existsSync(
      join(
        profile,
        "node_modules",
        "@penglai",
        "plugin-reference",
        "dist",
        "index.js",
      ),
    ),
    true,
  );
  writeFileSync(tgz, "tampered");
  await assert.rejects(
    () =>
      runProfileTransaction({
        userDataRoot: root,
        profileDir: profile,
        txDir: join(root, "tx2"),
        pluginsDir: plugins,
        entry,
        action: "update",
        previousEnabled: true,
        applyLive: async ({ enabled }) => {
          loaded = enabled;
        },
        verifyActual: async ({ enabled }) => assert.equal(loaded, enabled),
        commitDesired: (enabled) => {
          desired = enabled;
        },
        rollbackDesired: (enabled) => {
          desired = enabled;
        },
      }),
    /checksum mismatch/,
  );
});

test("R50-CENTER-007 tampered package checksum is rejected before activate", () => {
  const file = "penglai-center-tamper-fixture.tgz";
  writeFileSync(file, "not-a-signed-package");
  try {
    assert.throws(
      () => verifyPackage(file, "a".repeat(64)),
      /checksum mismatch|SECURITY_POLICY/,
    );
    assert.throws(
      () => verifyPackage(file, "not-a-hash"),
      /checksum required|SECURITY_POLICY/,
    );
  } finally {
    rmSync(file, { force: true });
  }
});

test("signed plugin bytes are hashed and consumed from one bound file descriptor", () => {
  const source = readFileSync(
    new URL("./profile-tx.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /openSync\(packageFile, "r"\)/);
  assert.match(source, /opened\.ino !== named\.ino/);
  assert.match(source, /named\.isSymbolicLink\(\)/);
  assert.match(source, /bytes = readFileSync\(fd\)/);
  assert.match(source, /createHash\("sha256"\)\.update\(bytes\)/);
  assert.doesNotMatch(
    source,
    /assertPackageIntegrity\(packageFile,[\s\S]{0,240}readFileSync\(packageFile\)/,
  );
});

test("Center disable rolls back when a measured plugin resource remains open", async () => {
  const { runProfileTransaction } = await import("./profile-tx.js");
  const root = mkdtempSync(join(tmpdir(), "penglai-center-resource-"));
  const profile = join(root, "dsh-home", "profiles", "web");
  const plugins = join(root, "bundled-plugins");
  mkdirSync(profile, { recursive: true });
  mkdirSync(plugins, { recursive: true });
  writeFileSync(
    join(profile, "cordis.patch.yml"),
    '- insert:\n    - id: penglai-plugin-reference\n      name: "@penglai/plugin-reference"\n',
  );
  const entry = TEST_CATALOG.find(
    (candidate) => candidate.id === "@penglai/plugin-reference",
  )!;
  let loaded = true;
  let desired = true;
  await assert.rejects(
    () =>
      runProfileTransaction({
        userDataRoot: root,
        profileDir: profile,
        txDir: join(root, "tx"),
        pluginsDir: plugins,
        entry,
        action: "disable",
        previousEnabled: true,
        applyLive: async ({ enabled }) => {
          loaded = enabled;
        },
        verifyActual: async ({ enabled }) => assert.equal(loaded, enabled),
        readResources: () => ({
          workers: 0,
          sockets: 0,
          timers: 1,
          remotes: 0,
          db: 0,
          modelSessions: 0,
          audioHandles: 0,
        }),
        commitDesired: (enabled) => {
          desired = enabled;
        },
        rollbackDesired: (enabled) => {
          desired = enabled;
        },
      }),
    /resource timers not zero/,
  );
  assert.equal(loaded, true);
  assert.equal(desired, true);
  assert.doesNotMatch(
    readFileSync(join(profile, "cordis.patch.yml"), "utf8"),
    /disabled:\s+true/,
  );
  const journal = JSON.parse(
    readFileSync(join(root, "tx", "journal.json"), "utf8"),
  ) as { phase: string };
  assert.equal(journal.phase, "rolled_back");
});

test("R50-CENTER-006 desired enabled cannot impersonate loaded/active", () => {
  const host = hostWith({ list: () => [] });
  host.setDesired("@penglai/im", true);
  const im = host.reconcile().find((r) => r.id === "@penglai/im");
  assert.equal(im?.desired, "0.5.5");
  assert.equal(im?.loaded, false);
  assert.equal(im?.actual, "failed");
  assert.equal(im?.healthy, false);
});

test("R2-PC-010 reconcile uses inventory not catalog self-report", () => {
  const host = hostWith({
    list: () => [
      {
        name: "@penglai/plugin-reference",
        enabled: true,
        fiberPhase: "active",
      },
    ],
  });
  const rows = host.reconcile();
  const reference = rows.find((r) => r.id === "@penglai/plugin-reference");
  assert.equal(reference?.loaded, true);
  const im = rows.find((r) => r.id === "@penglai/im");
  assert.equal(im?.loaded, false);
  assert.equal(im?.healthy, false);
  assert.equal(im?.actual, "disabled");
});

test("Center isolates a failing plugin health probe without dropping the catalog", () => {
  const host = new PluginCenterHost(
    mkdtempSync(join(tmpdir(), "pc-health-isolation-")),
    {
      list: () => [
        { name: "@penglai/im", enabled: true, fiberPhase: "active" },
        { name: "@penglai/asr", enabled: true, fiberPhase: "active" },
      ],
    },
    TEST_CATALOG,
    undefined,
    (id) => {
      if (id === "@penglai/im") throw new Error("IM diagnostics unavailable");
      return { healthy: true };
    },
  );
  const rows = host.reconcile();
  assert.equal(rows.length, TEST_CATALOG.length);
  assert.equal(rows.find((row) => row.id === "@penglai/im")?.loaded, true);
  assert.equal(rows.find((row) => row.id === "@penglai/im")?.healthy, false);
  assert.equal(
    rows.find((row) => row.id === "@penglai/im")?.error,
    "IM diagnostics unavailable",
  );
  assert.equal(rows.find((row) => row.id === "@penglai/asr")?.loaded, true);
  assert.equal(rows.find((row) => row.id === "@penglai/asr")?.error, undefined);
});

test("Center probes optional sibling services through Cordis get without inject-gated property access", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const healthBody = source.slice(
    source.indexOf("function pluginHealthFrom"),
    source.indexOf("const ZERO_RESOURCES"),
  );
  const resourceBody = source.slice(
    source.indexOf("function resourceProbeFrom"),
    source.indexOf("export function apply"),
  );
  assert.match(healthBody, /ctx\.get\?\.\(name\)/);
  assert.match(resourceBody, /ctx\.get\?\.\(serviceName\)/);
  for (const serviceName of [
    "penglaiImCore",
    "penglaiAsr",
    "penglaiMossTts",
    "penglaiMemory",
    "penglaiOffice",
    "penglaiBudget",
    "penglaiCompanion",
  ]) {
    assert.doesNotMatch(
      healthBody,
      new RegExp(`ctx\\[.*${serviceName}|ctx\\.${serviceName}`),
    );
    assert.doesNotMatch(
      resourceBody,
      new RegExp(`ctx\\[.*${serviceName}|ctx\\.${serviceName}`),
    );
  }
});

test("fresh office+memory reconcile to actual=active/healthy and optionals do not", () => {
  const root = mkdtempSync(join(tmpdir(), "pc-fresh-health-"));
  const profileDir = join(root, "profile");
  const ctx = {
    get(name: string) {
      if (name === "penglaiOffice" || name === "penglaiMemory") {
        return { status: () => ({ state: "active" }) };
      }
      return undefined;
    },
  };
  for (const id of ["@penglai/plugin-center", "@penglai/office", "@penglai/memory"]) {
    const dir = join(profileDir, "node_modules", ...id.split("/"));
    mkdirSync(dir, { recursive: true });
    const version = TEST_CATALOG.find((entry) => entry.id === id)?.version;
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: id, version }));
  }
  const host = new PluginCenterHost(
    join(root, "state"),
    {
      list: () => [
        { moduleName: "@penglai/plugin-center", enabled: true, fiberPhase: "active" },
        { moduleName: "@penglai/office", enabled: true, fiberPhase: "active" },
        { moduleName: "@penglai/memory", enabled: true, fiberPhase: "active" },
      ],
    },
    TEST_CATALOG,
    profileDir,
    (id) => pluginHealthFrom(ctx, id),
  );
  const rows = host.reconcile();
  const office = rows.find((row) => row.id === "@penglai/office");
  const memory = rows.find((row) => row.id === "@penglai/memory");
  assert.equal(office?.actual, "active");
  assert.equal(office?.healthy, true);
  assert.equal(office?.loaded, true);
  assert.equal(memory?.actual, "active");
  assert.equal(memory?.healthy, true);
  assert.equal(memory?.loaded, true);
  for (const id of ["@penglai/im", "@penglai/asr", "@penglai/moss-tts", "@penglai/companion"]) {
    const row = rows.find((entry) => entry.id === id);
    assert.equal(row?.actual, "disabled", id);
    assert.equal(row?.loaded, false, id);
    assert.equal(row?.healthy, false, id);
    assert.equal(pluginHealthFrom(ctx, id).healthy, false, id);
  }
  assert.equal(pluginHealthFrom({ get: () => undefined }, "@penglai/office").healthy, false);
  assert.equal(pluginHealthFrom(ctx, "@penglai/office").healthy, true);
});
