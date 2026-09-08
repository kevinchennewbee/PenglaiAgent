import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import { FIRST_PARTY_PLUGIN_METADATA, PINNED_PLUGIN_DSH, type PluginCatalogEntry } from "./plugin-catalog.js";
import {
  assertActivationDigest,
  comparePluginVersion,
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
  assert.equal(
    shouldPreserveInstalledPlugin({
      installedVersion: "0.5.12",
      installedSha256: "b".repeat(64),
      bundledVersion: "0.5.10",
      bundledSha256: "a".repeat(64),
    }),
    true,
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

test("first-party install path records overlay identity and skips a newer overlay", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /shouldPreserveInstalledPlugin\(/);
  assert.match(src, /writeInstalledOverlay\(dest, \{ version: entry\.version, sha256: entry\.sha256 \}\)/);
  const remotes = readFileSync(new URL("../../plugin-center/src/remotes.ts", import.meta.url), "utf8");
  assert.match(remotes, /resolvePluginCatalogEntry\(/);
  assert.match(remotes, /assertActivationDigest\(/);
});
