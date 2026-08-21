import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  consumePluginOwnerGrant,
  issuePluginOwnerGrant,
  pluginPermissionDigest,
} from "./plugin-owner.js";
import { migrateRc8UserData, readMigrationMarker } from "./generation-migrate.js";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

test("plugin owner grant is one-shot and bound to identity", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-owncap-"));
  const digest = pluginPermissionDigest({ permissions: ["profile-write"], nativeCode: false });
  const grant = issuePluginOwnerGrant({
    userDataRoot: root,
    action: "plugin-enable",
    pluginId: "@penglai/plugin-pilot",
    version: "1.0.0",
    sha256: "a".repeat(64),
    permissionDigest: digest,
  });
  consumePluginOwnerGrant({
    userDataRoot: root,
    capabilityId: grant.capabilityId,
    action: "plugin-enable",
    pluginId: "@penglai/plugin-pilot",
    version: "1.0.0",
    sha256: "a".repeat(64),
    permissionDigest: digest,
  });
  assert.throws(
    () =>
      consumePluginOwnerGrant({
        userDataRoot: root,
        capabilityId: grant.capabilityId,
        action: "plugin-enable",
        pluginId: "@penglai/plugin-pilot",
        version: "1.0.0",
        sha256: "a".repeat(64),
        permissionDigest: digest,
      }),
    /required|already used|invalid/,
  );
});

test("rc.8 user-data migrate is idempotent and writes a marker", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-mig-"));
  mkdirSync(join(root, "dsh-home"), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, "dsh-home", ".credentials.yaml"), "DEEPSEEK_API_KEY: x\n", { mode: 0o600 });
  const first = migrateRc8UserData(root);
  assert.equal(first.migrated, true);
  assert.equal(existsSync(first.backup ?? ""), true);
  const second = migrateRc8UserData(root);
  assert.equal(second.already, true);
  assert.equal(readMigrationMarker(root)?.id, "penglai-0.5.1-rc8-to-rc1");
});
