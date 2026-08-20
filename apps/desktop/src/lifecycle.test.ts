import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  COMPLETE_DELETE_PHRASE,
  assertCompleteDeletePhrase,
  configureGenerationPaths,
  installedApplicationPath,
  loadUpdaterReleaseContract,
  parseConfirmedRequest,
  parseDeletionPrepareRequest,
  parseOperationRequest,
  readWorkspaceProtection,
  releaseTarget,
} from "./lifecycle.js";

test("desktop paths isolate Electron session/cache and keep one 0.5 generation", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-desktop-layout-"));
  const paths = new Map<string, string>();
  const layout = configureGenerationPaths({
    app: {
      setName: () => undefined,
      getPath: () => root,
      setPath: (name, path) => paths.set(name, path),
      setAppLogsPath: (path) => paths.set("logs", path ?? ""),
    },
    platform: "darwin",
    envUserData: join(root, "Penglai", "0.5"),
  });
  assert.equal(paths.get("userData"), layout.userData);
  assert.equal(paths.get("sessionData"), join(layout.cache, "chromium-session"));
  assert.equal(layout.updateBackups.startsWith(`${layout.userData}/`), true);
  assert.equal(layout.managedData.cacheRoot, layout.cache);
});

test("installed target mapping is exact", () => {
  assert.equal(releaseTarget("darwin", "arm64"), "darwin-aarch64");
  assert.equal(releaseTarget("darwin", "x64"), "darwin-x86_64");
  assert.equal(releaseTarget("win32", "x64"), "windows-x86_64");
  assert.throws(() => releaseTarget("linux", "x64"), /unsupported/);
});

test("embedded updater contract and fresh Workspace snapshot fail closed", () => {
  const contract = loadUpdaterReleaseContract(resolve("."));
  assert.equal(contract.updaterChannel, "desktop-v0.5");
  const root = mkdtempSync(join(tmpdir(), "penglai-workspace-snapshot-"));
  const path = join(root, "workspace-protection.json");
  const now = Date.parse("2026-08-17T00:00:05.000Z");
  writeFileSync(path, JSON.stringify({
    schema: 1,
    complete: true,
    at: "2026-08-17T00:00:00.000Z",
    roots: [root],
  }));
  assert.deepEqual(readWorkspaceProtection(path, now).roots, [root]);
  assert.throws(() => readWorkspaceProtection(path, now + 20_000), /stale/);
  writeFileSync(path, JSON.stringify({ schema: 1, complete: false, at: new Date(now).toISOString(), roots: [] }));
  assert.throws(() => readWorkspaceProtection(path, now), /incomplete/);
});

test("complete deletion requires the exact phrase", () => {
  assert.doesNotThrow(() => assertCompleteDeletePhrase(COMPLETE_DELETE_PHRASE));
  assert.throws(() => assertCompleteDeletePhrase("delete"), /phrase mismatch/);
});

test("renderer lifecycle payloads are narrow and complete delete is separately confirmed", () => {
  assert.deepEqual(parseConfirmedRequest({ confirmed: true }), { confirmed: true });
  assert.throws(() => parseConfirmedRequest({ confirmed: true, path: "/tmp/evil" }), /unknown field/);
  assert.deepEqual(parseOperationRequest({ operationId: "del_12345678" }), { operationId: "del_12345678" });
  assert.throws(() => parseOperationRequest({ operationId: "x" }), /operation id/);
  assert.deepEqual(
    parseDeletionPrepareRequest({
      categories: ["cache"],
      confirmCredentials: false,
      confirmSensitive: false,
    }).categories,
    ["cache"],
  );
  const all = ["cache", "settings", "dsh", "im", "credentials", "asr-models", "tts-models", "local-voices", "voice-temp", "context-indexes", "memory", "budget", "companion"];
  assert.throws(
    () => parseDeletionPrepareRequest({ categories: all, confirmCredentials: true, confirmSensitive: true }),
    /phrase mismatch/,
  );
  assert.equal(
    parseDeletionPrepareRequest({
      categories: all,
      confirmCredentials: true,
      confirmSensitive: true,
      completeDeletePhrase: COMPLETE_DELETE_PHRASE,
    }).categories.length,
    all.length,
  );
});

test("macOS uninstall guide resolves the containing app bundle", () => {
  assert.equal(
    installedApplicationPath("/Applications/Penglai.app/Contents/MacOS/Penglai", "darwin"),
    "/Applications/Penglai.app",
  );
  assert.equal(installedApplicationPath("/Program Files/Penglai/Penglai.exe", "win32"), "/Program Files/Penglai/Penglai.exe");
});
