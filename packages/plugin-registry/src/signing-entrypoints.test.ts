import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("release signing entrypoints resolve from a source checkout", () => {
  const root = process.cwd();
  const home = mkdtempSync(join(tmpdir(), "penglai-signing-entrypoints-"));
  try {
    const keyDir = join(home, "Library", "Application Support", "PenglaiReleaseKeys");
    mkdirSync(keyDir, { recursive: true });
    const privatePem = generateKeyPairSync("ed25519").privateKey.export({
      type: "pkcs8",
      format: "pem",
    });
    writeFileSync(join(keyDir, "updater-ed25519-private.pem"), privatePem);
    writeFileSync(join(keyDir, "plugin-catalog-ed25519-private.pem"), privatePem);

    const cases = [
      { script: "scripts/sign-update-manifest.mjs", input: "update-manifest-v1.json", bytes: "{}\n" },
      { script: "scripts/sign-catalog.mjs", input: "catalog.json", bytes: "{}\n" },
      { script: "scripts/sign-plugin-artifact.mjs", input: "plugin.tgz", bytes: "archive" },
    ];
    for (const item of cases) {
      const input = join(home, item.input);
      writeFileSync(input, item.bytes);
      const result = spawnSync(process.execPath, ["--import", "tsx", item.script, input], {
        cwd: root,
        env: { ...process.env, HOME: home },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, `${item.script}: ${result.stderr}`);
      assert.equal(readFileSync(`${input}.sig`).length, 64, item.script);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
