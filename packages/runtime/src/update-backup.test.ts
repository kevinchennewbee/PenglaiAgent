import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSchemaBackup } from "./update-backup.js";

test("R50-UPD-007 schema backup is app-private bounded and excludes credentials/workspaces/voice audio", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-schema-backup-"));
  mkdirSync(join(root, "dsh-home", "storages"), { recursive: true });
  mkdirSync(join(root, "im"), { recursive: true });
  mkdirSync(join(root, "voice", "local-voices"), { recursive: true });
  writeFileSync(join(root, "dsh-home", "settings.yaml"), "locale: zh\n");
  writeFileSync(join(root, "dsh-home", "storages", "workspace.json"), "{}\n");
  writeFileSync(join(root, "dsh-home", ".credentials.yaml"), "API_KEY: secret\n");
  writeFileSync(join(root, "im", "penglai-im.sqlite"), "fixture-state");
  writeFileSync(join(root, "voice", "local-voices", "reference.wav"), "sensitive-audio");
  const result = createSchemaBackup({
    userData: root,
    backupRoot: join(root, "update-backups"),
    operationId: "update-backup-1",
    fromVersion: "0.5.0",
    toVersion: "0.5.1",
  });
  assert.equal(result.manifest.credentialsCopied, false);
  assert.equal(result.manifest.workspaceCopied, false);
  assert.equal(result.manifest.localVoiceAudioCopied, false);
  assert.equal(result.manifest.files.some((file) => file.path.includes("credentials")), false);
  assert.equal(result.manifest.files.some((file) => file.path.endsWith("reference.wav")), false);
  assert.equal(result.manifest.files.some((file) => file.path.includes("storages")), false, "workspace storage must not be backed up");
  assert.equal(existsSync(join(result.path, "dsh-home", ".credentials.yaml")), false);
  assert.equal(existsSync(join(result.path, "dsh-home", "storages", "workspace.json")), false);
  assert.equal(existsSync(join(result.path, "im", "penglai-im.sqlite")), true);
});

test("schema backup refuses a symlink anywhere in a selected state tree", (context) => {
  const root = mkdtempSync(join(tmpdir(), "penglai-schema-backup-link-"));
  const outside = mkdtempSync(join(tmpdir(), "penglai-schema-outside-"));
  mkdirSync(join(root, "im"), { recursive: true });
  try {
    symlinkSync(outside, join(root, "im", "escape"), process.platform === "win32" ? "junction" : undefined);
  } catch (error) {
    if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    context.skip("Windows account cannot create a directory link without Developer Mode or elevation");
    return;
  }
  assert.throws(
    () => createSchemaBackup({
      userData: root,
      backupRoot: join(root, "update-backups"),
      operationId: "update-backup-link",
      fromVersion: "0.5.0",
      toVersion: "0.5.1",
    }),
    /symlink/,
  );
});
