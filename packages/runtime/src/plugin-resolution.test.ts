import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import { contentAddressedPath, pluginDistributionStatePaths } from "@penglai/plugin-registry";
import { writeTestTarGz } from "../../../scripts/lib/test-tar-fixture.mjs";
import {
  FIRST_PARTY_PLUGIN_METADATA,
  PINNED_PLUGIN_DSH,
  runtimePluginTarget,
  type PluginCatalogEntry,
} from "./plugin-catalog.js";
import {
  assertActivationDigest,
  comparePluginVersion,
  firstPartyRetentionDecision,
  installedPluginMatchesVerifiedArtifact,
  overlayIdentityPath,
  readInstalledOverlay,
  resolvePluginCatalogEntry,
  shouldPreserveInstalledPlugin,
  writeInstalledOverlay,
} from "./plugin-resolution.js";

const bundled: PluginCatalogEntry = {
  ...FIRST_PARTY_PLUGIN_METADATA.find((entry) => entry.id === "@penglai/office")!,
  sha256: "a".repeat(64),
  target: "darwin-arm64",
  hasClient: true,
};

test("newer signed remote wins; older, equal, or DSH-mismatched remote keeps bundled", () => {
  const newerVersion = `${bundled.version}.1`;
  const newer = resolvePluginCatalogEntry({
    bundled,
    remote: {
      id: bundled.id,
      version: newerVersion,
      sha256: "b".repeat(64),
      dshExact: PINNED_PLUGIN_DSH,
    },
  });
  assert.deepEqual(newer, {
    source: "remote",
    version: newerVersion,
    sha256: "b".repeat(64),
    id: bundled.id,
  });

  const older = resolvePluginCatalogEntry({
    bundled,
    remote: {
      id: bundled.id,
      version: "0.5.9",
      sha256: "c".repeat(64),
      dshExact: PINNED_PLUGIN_DSH,
    },
  });
  assert.equal(older.source, "bundled");
  assert.equal(older.version, bundled.version);
  assert.equal(older.sha256, bundled.sha256);

  const equal = resolvePluginCatalogEntry({
    bundled,
    remote: {
      id: bundled.id,
      version: bundled.version,
      sha256: "d".repeat(64),
      dshExact: PINNED_PLUGIN_DSH,
    },
  });
  assert.equal(equal.source, "bundled");

  const mismatchedDsh = resolvePluginCatalogEntry({
    bundled,
    remote: {
      id: bundled.id,
      version: newerVersion,
      sha256: "e".repeat(64),
      dshExact: "0.1.3-alpha.1",
    },
  });
  assert.equal(mismatchedDsh.source, "bundled");
  assert.equal(mismatchedDsh.version, bundled.version);

  assert.throws(
    () =>
      resolvePluginCatalogEntry({
        remote: {
          id: "@penglai/office",
          version: "0.5.12",
          sha256: "f".repeat(64),
          dshExact: "0.1.3-alpha.1",
        },
      }),
    (error: unknown) => error instanceof PenglaiError && /DSH pin/.test(error.message),
  );
  assert.throws(
    () =>
      resolvePluginCatalogEntry({
        bundled,
        remote: {
          id: bundled.id,
          version: "0.5.12",
          sha256: "not-a-digest",
          dshExact: PINNED_PLUGIN_DSH,
        },
      }),
    /digest required/,
  );
  assert.equal(comparePluginVersion("0.5.12", "0.5.11"), 1);
  assert.equal(comparePluginVersion("0.5.10", "0.5.10.1"), -1);
});

test("boot reseeding preserves a newer overlay and refreshes same-version first-party tarballs", () => {
  const digest = "b".repeat(64);
  assert.equal(
    shouldPreserveInstalledPlugin({
      installedVersion: "0.5.12",
      installedSha256: digest,
      bundledVersion: "0.5.10",
      bundledSha256: "a".repeat(64),
      catalogSha256: digest,
      catalogDshExact: "0.1.5-rc.1",
      pinnedDsh: "0.1.5-rc.1",
    }),
    true,
  );
  assert.equal(
    shouldPreserveInstalledPlugin({
      installedVersion: "0.5.12",
      installedSha256: digest,
      bundledVersion: "0.5.10",
      bundledSha256: "a".repeat(64),
    }),
    false,
  );
  assert.equal(
    shouldPreserveInstalledPlugin({
      installedVersion: "0.5.12",
      installedSha256: digest,
      bundledVersion: "0.5.10",
      bundledSha256: "a".repeat(64),
      catalogSha256: "c".repeat(64),
      catalogDshExact: "0.1.5-rc.1",
      pinnedDsh: "0.1.5-rc.1",
    }),
    false,
  );
  assert.equal(
    shouldPreserveInstalledPlugin({
      installedVersion: "0.5.12",
      installedSha256: digest,
      bundledVersion: "0.5.10",
      bundledSha256: "a".repeat(64),
      catalogSha256: digest,
      catalogDshExact: "0.1.5-alpha.1",
      pinnedDsh: "0.1.5-rc.1",
    }),
    false,
  );
  assert.equal(
    shouldPreserveInstalledPlugin({
      installedVersion: "0.5.10",
      installedSha256: "c".repeat(64),
      bundledVersion: "0.5.10",
      bundledSha256: "a".repeat(64),
    }),
    false,
  );
  assert.equal(
    shouldPreserveInstalledPlugin({
      installedVersion: "0.5.10",
      installedSha256: "a".repeat(64),
      bundledVersion: "0.5.10",
      bundledSha256: "a".repeat(64),
    }),
    false,
  );
  assert.equal(
    shouldPreserveInstalledPlugin({
      installedVersion: "0.5.9",
      installedSha256: "a".repeat(64),
      bundledVersion: "0.5.10",
      bundledSha256: "a".repeat(64),
    }),
    false,
  );
  assert.equal(shouldPreserveInstalledPlugin({ bundledVersion: "0.5.10" }), false);
});

test("retention requires a signed catalog record distinct from the overlay claim", () => {
  const digest = "b".repeat(64);
  const installed = {
    id: "@penglai/office",
    version: "0.6.1.1",
    overlaySha256: digest,
    dshExact: PINNED_PLUGIN_DSH,
  };
  assert.equal(
    firstPartyRetentionDecision({
      pluginId: "@penglai/office",
      bundledVersion: "0.6.1",
      bundledSha256: "a".repeat(64),
      installed,
      signed: { version: "0.6.1.1", sha256: digest, dshExact: PINNED_PLUGIN_DSH },
    }),
    true,
  );
  assert.equal(
    firstPartyRetentionDecision({
      pluginId: "@penglai/office",
      bundledVersion: "0.6.1",
      bundledSha256: "a".repeat(64),
      installed,
    }),
    false,
  );
  assert.equal(
    firstPartyRetentionDecision({
      pluginId: "@penglai/office",
      bundledVersion: "0.6.1",
      bundledSha256: "a".repeat(64),
      installed,
      signed: { version: "0.6.1.1", sha256: "c".repeat(64), dshExact: PINNED_PLUGIN_DSH },
    }),
    false,
  );
  assert.equal(
    firstPartyRetentionDecision({
      pluginId: "@penglai/office",
      bundledVersion: "0.6.1",
      bundledSha256: "a".repeat(64),
      installed: { ...installed, dshExact: "0.1.5-alpha.1" },
      signed: { version: "0.6.1.1", sha256: digest, dshExact: PINNED_PLUGIN_DSH },
    }),
    false,
  );
});

test("activation digest must match the staged bytes, not a declared identity", () => {
  const expected = "a".repeat(64);
  assertActivationDigest(expected, expected);
  assert.throws(() => assertActivationDigest("b".repeat(64), expected), /activation digest mismatch/);
  assert.throws(() => assertActivationDigest("short", expected), /activation digest mismatch/);
  const dest = mkdtempSync(join(tmpdir(), "penglai-overlay-"));
  writeInstalledOverlay(dest, { version: "0.5.12", sha256: expected });
  assert.deepEqual(readInstalledOverlay(dest), { version: "0.5.12", sha256: expected });
  assert.match(readFileSync(overlayIdentityPath(dest), "utf8"), /"schema":1/);
  assert.throws(() => writeInstalledOverlay(dest, { version: "0.5.12", sha256: "nope" }), /overlay digest required/);
});

test("first-party retention uses signed catalog identity, not the overlay as both sides", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /firstPartyRetentionDecision\(/);
  assert.match(src, /installedPluginMatchesVerifiedArtifact\(/);
  assert.match(src, /loadVerifiedSignedPluginCatalog\(/);
  assert.match(src, /isolateUntrustedPluginInstall\(/);
  assert.doesNotMatch(src, /catalogSha256: overlay\.sha256/);
  assert.doesNotMatch(src, /catalogDshExact: overlay\.dshExact/);
  assert.match(src, /writeInstalledOverlay\(dest, \{ version: entry\.version, sha256: entry\.sha256, dshExact: PINNED_PLUGIN_DSH \}\)/);
  const remotes = readFileSync(new URL("../../plugin-center/src/remotes.ts", import.meta.url), "utf8");
  assert.match(remotes, /resolvePluginCatalogEntry\(/);
  assert.match(remotes, /assertActivationDigest\(/);
  const profileTx = readFileSync(new URL("../../plugin-center/src/profile-tx.ts", import.meta.url), "utf8");
  assert.match(profileTx, /writeInstalledOverlay\(scoped,/);
  const resolution = readFileSync(new URL("./plugin-resolution.ts", import.meta.url), "utf8");
  assert.match(resolution, /readOpenedRegularFile\(/);
  assert.match(resolution, /O_RDONLY \| constants\.O_NOFOLLOW/);
  assert.doesNotMatch(resolution, /files\.set\([^;]+readFileSync\(full\)\)/);
});

function writeMinimalPluginTree(root: string, js: string): { id: string; version: string; target: ReturnType<typeof runtimePluginTarget> } {
  const id = "@penglai/office";
  const version = "0.6.1-test";
  const target = runtimePluginTarget();
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", "index.js"), js);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: id,
      version,
      type: "module",
      main: "dist/index.js",
      exports: { ".": "./dist/index.js" },
      penglaiPlugin: {
        schema: 1,
        id,
        dshExact: PINNED_PLUGIN_DSH,
        target,
      },
    }),
  );
  return { id, version, target };
}

function stageVerifiedPlugin(js = "export const marker = \"trusted-plugin-bytes\";\n") {
  const dest = mkdtempSync(join(tmpdir(), "penglai-plugin-tree-"));
  const userData = mkdtempSync(join(tmpdir(), "penglai-plugin-cas-"));
  const identity = writeMinimalPluginTree(dest, js);
  const archivePath = join(dest, "artifact.tgz");
  writeTestTarGz(dest, archivePath);
  const archive = readFileSync(archivePath);
  unlinkSync(archivePath);
  const digest = createHash("sha256").update(archive).digest("hex");
  const { cacheRoot } = pluginDistributionStatePaths(userData);
  mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
  writeFileSync(contentAddressedPath(cacheRoot, digest, ".tgz"), archive, { mode: 0o600 });
  writeInstalledOverlay(dest, { version: identity.version, sha256: digest, dshExact: PINNED_PLUGIN_DSH });
  return {
    dest,
    userData,
    input: {
      dest,
      pluginId: identity.id,
      signed: { version: identity.version, sha256: digest, dshExact: PINNED_PLUGIN_DSH },
      userDataRoot: userData,
      hostTarget: identity.target,
    },
  };
}

test("installed tree matches the verified CAS artifact and rejects a same-bytes symlink swap", (context) => {
  const staged = stageVerifiedPlugin();
  context.after(() => {
    rmSync(staged.dest, { recursive: true, force: true });
    rmSync(staged.userData, { recursive: true, force: true });
  });
  assert.equal(installedPluginMatchesVerifiedArtifact(staged.input), true);

  const jsPath = join(staged.dest, "dist", "index.js");
  const outside = join(staged.userData, "same-bytes.js");
  writeFileSync(outside, readFileSync(jsPath));
  unlinkSync(jsPath);
  try {
    symlinkSync(outside, jsPath);
  } catch (error) {
    if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") {
      context.skip("Windows account cannot create file symlinks without Developer Mode or elevation");
      return;
    }
    throw error;
  }
  assert.equal(installedPluginMatchesVerifiedArtifact(staged.input), false);
  unlinkSync(jsPath);
  writeFileSync(jsPath, readFileSync(outside));
  assert.equal(installedPluginMatchesVerifiedArtifact(staged.input), true);
});

test("installed tree check survives a live regular-file/symlink race without executing plugin bytes", async (context) => {
  const staged = stageVerifiedPlugin();
  const jsPath = join(staged.dest, "dist", "index.js");
  const outside = join(staged.userData, "alias.js");
  const original = readFileSync(jsPath);
  writeFileSync(outside, original);
  let swapper: ReturnType<typeof spawn> | undefined;
  context.after(() => {
    try {
      swapper?.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    rmSync(staged.dest, { recursive: true, force: true });
    rmSync(staged.userData, { recursive: true, force: true });
  });
  swapper = spawn(
    process.execPath,
    [
      "-e",
      `const fs = require("node:fs");
const target = process.env.PENGLAI_SWAP_TARGET;
const outside = process.env.PENGLAI_SWAP_OUTSIDE;
const orig = fs.readFileSync(target);
for (;;) {
  try { fs.unlinkSync(target); } catch {}
  try { fs.symlinkSync(outside, target); } catch {}
  try { fs.unlinkSync(target); } catch {}
  try { fs.writeFileSync(target, orig); } catch {}
}`,
    ],
    {
      env: { ...process.env, PENGLAI_SWAP_TARGET: jsPath, PENGLAI_SWAP_OUTSIDE: outside },
      stdio: "ignore",
    },
  );
  if (swapper.exitCode !== null) {
    if (process.platform === "win32") {
      context.skip("Windows account cannot create file symlinks without Developer Mode or elevation");
      return;
    }
    throw new Error("file swapper exited before the tree walk");
  }
  for (let i = 0; i < 120; i += 1) {
    assert.equal(typeof installedPluginMatchesVerifiedArtifact(staged.input), "boolean");
  }
  if (!swapper) throw new Error("file swapper missing");
  const child = swapper;
  child.kill("SIGKILL");
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) {
      resolve(undefined);
      return;
    }
    child.once("exit", () => resolve(undefined));
  });
  try {
    unlinkSync(jsPath);
  } catch {
    /* restored below */
  }
  writeFileSync(jsPath, original);
  assert.equal(existsSync(jsPath), true);
  assert.equal(installedPluginMatchesVerifiedArtifact(staged.input), true);
  assert.equal(original.toString("utf8").includes("trusted-plugin-bytes"), true);
});

