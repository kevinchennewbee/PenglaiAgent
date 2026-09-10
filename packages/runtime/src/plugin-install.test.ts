import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  contentAddressedPath,
  parseSignedPluginCatalog,
  PluginDistributionClient,
  pluginDistributionStatePaths,
} from "@penglai/plugin-registry";
import {
  FIRST_PARTY_PLUGIN_METADATA,
  installFirstPartyPlugins,
  resolveRuntimeLayout,
  runtimePluginTarget,
} from "./index.js";
import { writeInstalledOverlay } from "./plugin-resolution.js";
import { writeTestTarGz } from "../../../scripts/lib/test-tar-fixture.mjs";

function writeTrustedPluginSet(app: string, markers: Record<string, string> = {}): void {
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
  writeFileSync(join(pluginsDir, "catalog.json"), JSON.stringify({ schema: 3, target, entries }));
}

test("installFirstPartyPlugins isolates a forged overlay instead of trusting or deleting it", () => {
  const app = mkdtempSync(join(tmpdir(), "penglai-plugin-trust-app-"));
  const profile = mkdtempSync(join(tmpdir(), "penglai-plugin-trust-profile-"));
  const tx = mkdtempSync(join(tmpdir(), "penglai-plugin-trust-tx-"));
  const userData = mkdtempSync(join(tmpdir(), "penglai-plugin-trust-user-"));
  mkdirSync(join(app, "profile-seed", "web"), { recursive: true });
  writeTrustedPluginSet(app, { "@penglai/office": "bundled-office" });
  const layout = resolveRuntimeLayout(app);
  installFirstPartyPlugins(layout, profile, tx, ["@penglai/office"], userData);
  const dest = join(profile, "node_modules", "@penglai", "office");
  const ownerMarker = join(dest, "owner-bytes.txt");
  writeFileSync(ownerMarker, "owner-installed-bytes\n");
  const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf8")) as {
    version: string;
    penglaiPlugin: { dshExact: string };
  };
  pkg.version = `${pkg.version}.9`;
  writeFileSync(join(dest, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  writeInstalledOverlay(dest, {
    version: pkg.version,
    sha256: "ab".repeat(32),
    dshExact: pkg.penglaiPlugin.dshExact,
  });
  installFirstPartyPlugins(layout, profile, tx, ["@penglai/office"], userData);
  assert.match(readFileSync(join(dest, "dist", "index.js"), "utf8"), /bundled-office/);
  assert.equal(existsSync(ownerMarker), false);
  const quarantined = readdirSync(tx).filter((name) => name.startsWith("uncertain-plugin-"));
  assert.equal(quarantined.length >= 1, true);
  const preserved = quarantined.some((name) =>
    existsSync(join(tx, name, "owner-bytes.txt")) &&
    readFileSync(join(tx, name, "owner-bytes.txt"), "utf8").includes("owner-installed-bytes"),
  );
  assert.equal(preserved, true);
});

function quarantineHas(tx: string, needle: string): boolean {
  return readdirSync(tx).some((name) => {
    if (!name.startsWith("uncertain-plugin-")) return false;
    const file = join(tx, name, "dist", "index.js");
    return existsSync(file) && readFileSync(file, "utf8").includes(needle);
  });
}

function newerOfficePackage(dest: string): {
  version: string;
  digest: string;
  archive: Buffer;
  catalog: ReturnType<typeof parseSignedPluginCatalog>;
} {
  const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf8")) as {
    version: string;
    penglaiPlugin: { dshExact: string };
  };
  const parts = pkg.version.split(".").map(Number);
  parts[2] = (parts[2] ?? 0) + 1;
  pkg.version = parts.join(".");
  writeFileSync(join(dest, "package.json"), JSON.stringify(pkg));
  const stage = mkdtempSync(join(tmpdir(), "penglai-plugin-newer-"));
  cpSync(dest, stage, { recursive: true, filter: (src) => basename(src) !== ".penglai-overlay.json" });
  const archivePath = join(stage, "artifact.tgz");
  writeTestTarGz(stage, archivePath);
  const archive = readFileSync(archivePath);
  const digest = createHash("sha256").update(archive).digest("hex");
  const target = runtimePluginTarget();
  const artifactName = `penglai-office-${pkg.version}-${target}.tgz`;
  const tag = `office-v${pkg.version}`;
  const now = Date.now();
  const catalog = parseSignedPluginCatalog(
    {
      schema: "penglai.plugin-catalog.v1",
      catalogId: "stable",
      sequence: 1000,
      issuedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 86_400_000).toISOString(),
      centerProtocol: 1,
      signingKeyId: "pm-source-fixture",
      entries: [
        {
          id: "@penglai/office",
          version: pkg.version,
          title: { en: "Office", "zh-CN": "办公" },
          summary: { en: "Source test fixture", "zh-CN": "源码测试" },
          publisher: "Penglai",
          provenanceClass: "penglai-first-party",
          license: "MIT",
          dsh: { exact: pkg.penglaiPlugin.dshExact },
          minPenglai: "0.6.1",
          capabilities: [],
          permissions: [],
          defaultEnabled: false,
          entry: "dist/index.js",
          targets: [target],
          nativeCode: false,
          networkOrigins: [],
          dataPaths: [],
          artifacts: [
            {
              target,
              releaseTag: tag,
              assetId: 1,
              url: `https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/download/${tag}/${artifactName}`,
              size: archive.byteLength,
              sha256: digest,
              signatureAsset: `${artifactName}.sig`,
            },
          ],
          migration: "none",
          rollback: "last-good-profile",
        },
      ],
      revocations: [],
    },
    now,
  );
  writeInstalledOverlay(dest, {
    version: pkg.version,
    sha256: digest,
    dshExact: pkg.penglaiPlugin.dshExact,
  });
  return { version: pkg.version, digest, archive, catalog };
}

function writeCasArtifact(userData: string, digest: string, archive: Buffer): void {
  const { cacheRoot } = pluginDistributionStatePaths(userData);
  mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
  writeFileSync(contentAddressedPath(cacheRoot, digest, ".tgz"), archive, { mode: 0o600 });
}

function withVerifiedSnapshot<T>(catalog: ReturnType<typeof parseSignedPluginCatalog>, fn: () => T): T {
  const original = PluginDistributionClient.prototype.snapshot;
  PluginDistributionClient.prototype.snapshot = function snapshot() {
    return { catalog } as ReturnType<PluginDistributionClient["snapshot"]>;
  };
  try {
    return fn();
  } finally {
    PluginDistributionClient.prototype.snapshot = original;
  }
}

test("installFirstPartyPlugins retains a newer install only when CAS bytes match the installed tree", () => {
  const app = mkdtempSync(join(tmpdir(), "penglai-plugin-cas-app-"));
  const profile = mkdtempSync(join(tmpdir(), "penglai-plugin-cas-profile-"));
  const tx = mkdtempSync(join(tmpdir(), "penglai-plugin-cas-tx-"));
  const userData = mkdtempSync(join(tmpdir(), "penglai-plugin-cas-user-"));
  mkdirSync(join(app, "profile-seed", "web"), { recursive: true });
  writeTrustedPluginSet(app, { "@penglai/office": "newer-verified-office" });
  const layout = resolveRuntimeLayout(app);
  installFirstPartyPlugins(layout, profile, tx, ["@penglai/office"], userData);
  const dest = join(profile, "node_modules", "@penglai", "office");
  const newer = newerOfficePackage(dest);
  writeCasArtifact(userData, newer.digest, newer.archive);
  withVerifiedSnapshot(newer.catalog, () => {
    installFirstPartyPlugins(layout, profile, tx, ["@penglai/office"], userData);
  });
  const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf8")) as { version: string };
  assert.equal(pkg.version, newer.version);
  assert.match(readFileSync(join(dest, "dist", "index.js"), "utf8"), /newer-verified-office/);
  assert.equal(readdirSync(tx).some((name) => name.startsWith("uncertain-plugin-")), false);
});

test("installFirstPartyPlugins isolates a CAS-authenticated overlay whose executable was altered", () => {
  const app = mkdtempSync(join(tmpdir(), "penglai-plugin-tamper-app-"));
  const profile = mkdtempSync(join(tmpdir(), "penglai-plugin-tamper-profile-"));
  const tx = mkdtempSync(join(tmpdir(), "penglai-plugin-tamper-tx-"));
  const userData = mkdtempSync(join(tmpdir(), "penglai-plugin-tamper-user-"));
  mkdirSync(join(app, "profile-seed", "web"), { recursive: true });
  writeTrustedPluginSet(app, { "@penglai/office": "bundled-office" });
  const layout = resolveRuntimeLayout(app);
  installFirstPartyPlugins(layout, profile, tx, ["@penglai/office"], userData);
  const dest = join(profile, "node_modules", "@penglai", "office");
  const newer = newerOfficePackage(dest);
  writeCasArtifact(userData, newer.digest, newer.archive);
  const originalJs = readFileSync(join(dest, "dist", "index.js"), "utf8");
  writeFileSync(join(dest, "dist", "index.js"), `${originalJs}\nexport const pmModifiedAfterVerification = true;\n`);
  withVerifiedSnapshot(newer.catalog, () => {
    installFirstPartyPlugins(layout, profile, tx, ["@penglai/office"], userData);
  });
  assert.match(readFileSync(join(dest, "dist", "index.js"), "utf8"), /bundled-office/);
  assert.equal(readFileSync(join(dest, "dist", "index.js"), "utf8").includes("pmModifiedAfterVerification"), false);
  const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf8")) as { version: string };
  assert.equal(pkg.version, FIRST_PARTY_PLUGIN_METADATA.find((entry) => entry.id === "@penglai/office")?.version);
  assert.equal(quarantineHas(tx, "pmModifiedAfterVerification"), true);
});

test("installFirstPartyPlugins isolates when the expected CAS artifact is missing", () => {
  const app = mkdtempSync(join(tmpdir(), "penglai-plugin-missing-cas-app-"));
  const profile = mkdtempSync(join(tmpdir(), "penglai-plugin-missing-cas-profile-"));
  const tx = mkdtempSync(join(tmpdir(), "penglai-plugin-missing-cas-tx-"));
  const userData = mkdtempSync(join(tmpdir(), "penglai-plugin-missing-cas-user-"));
  mkdirSync(join(app, "profile-seed", "web"), { recursive: true });
  writeTrustedPluginSet(app, { "@penglai/office": "bundled-office" });
  const layout = resolveRuntimeLayout(app);
  installFirstPartyPlugins(layout, profile, tx, ["@penglai/office"], userData);
  const dest = join(profile, "node_modules", "@penglai", "office");
  const newer = newerOfficePackage(dest);
  writeFileSync(join(dest, "owner-kept.txt"), "keep-owner\n");
  withVerifiedSnapshot(newer.catalog, () => {
    installFirstPartyPlugins(layout, profile, tx, ["@penglai/office"], userData);
  });
  assert.match(readFileSync(join(dest, "dist", "index.js"), "utf8"), /bundled-office/);
  assert.equal(
    readdirSync(tx).some(
      (name) => name.startsWith("uncertain-plugin-") && existsSync(join(tx, name, "owner-kept.txt")),
    ),
    true,
  );
});

test("installFirstPartyPlugins isolates a corrupt CAS object even when overlay metadata matches", () => {
  const app = mkdtempSync(join(tmpdir(), "penglai-plugin-corrupt-cas-app-"));
  const profile = mkdtempSync(join(tmpdir(), "penglai-plugin-corrupt-cas-profile-"));
  const tx = mkdtempSync(join(tmpdir(), "penglai-plugin-corrupt-cas-tx-"));
  const userData = mkdtempSync(join(tmpdir(), "penglai-plugin-corrupt-cas-user-"));
  mkdirSync(join(app, "profile-seed", "web"), { recursive: true });
  writeTrustedPluginSet(app, { "@penglai/office": "bundled-office" });
  const layout = resolveRuntimeLayout(app);
  installFirstPartyPlugins(layout, profile, tx, ["@penglai/office"], userData);
  const dest = join(profile, "node_modules", "@penglai", "office");
  const newer = newerOfficePackage(dest);
  writeCasArtifact(userData, newer.digest, Buffer.from("not-the-signed-tarball"));
  withVerifiedSnapshot(newer.catalog, () => {
    installFirstPartyPlugins(layout, profile, tx, ["@penglai/office"], userData);
  });
  assert.match(readFileSync(join(dest, "dist", "index.js"), "utf8"), /bundled-office/);
  const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf8")) as { version: string };
  assert.notEqual(pkg.version, newer.version);
});

test("installFirstPartyPlugins isolates a newer overlay whose embedded DSH pin drifted", () => {
  const app = mkdtempSync(join(tmpdir(), "penglai-plugin-dsh-app-"));
  const profile = mkdtempSync(join(tmpdir(), "penglai-plugin-dsh-profile-"));
  const tx = mkdtempSync(join(tmpdir(), "penglai-plugin-dsh-tx-"));
  const userData = mkdtempSync(join(tmpdir(), "penglai-plugin-dsh-user-"));
  mkdirSync(join(app, "profile-seed", "web"), { recursive: true });
  writeTrustedPluginSet(app, { "@penglai/office": "bundled-office" });
  const layout = resolveRuntimeLayout(app);
  installFirstPartyPlugins(layout, profile, tx, ["@penglai/office"], userData);
  const dest = join(profile, "node_modules", "@penglai", "office");
  const newer = newerOfficePackage(dest);
  const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf8")) as {
    version: string;
    penglaiPlugin: { dshExact: string };
  };
  pkg.penglaiPlugin.dshExact = "0.1.5-alpha.1";
  writeFileSync(join(dest, "package.json"), JSON.stringify(pkg));
  writeCasArtifact(userData, newer.digest, newer.archive);
  withVerifiedSnapshot(newer.catalog, () => {
    installFirstPartyPlugins(layout, profile, tx, ["@penglai/office"], userData);
  });
  const restored = JSON.parse(readFileSync(join(dest, "package.json"), "utf8")) as {
    penglaiPlugin: { dshExact: string };
  };
  assert.equal(restored.penglaiPlugin.dshExact, "0.1.5-rc.1");
});

