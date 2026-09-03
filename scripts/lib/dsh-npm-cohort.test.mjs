import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  discoverSourcePackages,
  DSH_UPSTREAM,
  verifyRegistrySignatures,
  verifyCohortLock,
} from "./dsh-npm-cohort.mjs";

test("discovers public fixed DSH, vendor, and Landlock source packages", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-npm-cohort-"));
  const fixtures = [
    ["apps/cli", { name: "@deepseek-ai/dsh", version: DSH_UPSTREAM.version, license: "MIT" }],
    ["packages/util/deque", { name: "@deepseek-ai/dsh-deque", version: DSH_UPSTREAM.version, license: "MIT" }],
    ["vendor/cordis", { name: "@deepseek-ai/cordis", version: "4.0.2", license: "MIT" }],
    ["native/landlock-run/packages/entry", { name: "@deepseek-ai/node-addon-landlock-run", version: "0.1.1", license: "BSD-3-Clause" }],
    ["packages/private/fixture", { name: "@deepseek-ai/dsh-private", version: DSH_UPSTREAM.version, private: true }],
  ];
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "root", private: true }));
  for (const [directory, manifest] of fixtures) {
    const target = join(root, directory);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "package.json"), JSON.stringify(manifest));
  }
  const found = discoverSourcePackages(root);
  assert.deepEqual(found.map(({ name, category }) => ({ name, category })), [
    { name: "@deepseek-ai/cordis", category: "vendor" },
    { name: "@deepseek-ai/dsh", category: "dsh" },
    { name: "@deepseek-ai/dsh-deque", category: "dsh" },
    { name: "@deepseek-ai/node-addon-landlock-run", category: "landlock" },
  ]);
});

test("npm cohort lock verification binds version and integrity", () => {
  const required = ["@deepseek-ai/dsh-session-turn-outline", "@deepseek-ai/dsh", "@deepseek-ai/dsh-client-ui-schedule", "@deepseek-ai/dsh-deque", "@deepseek-ai/dsh-util-time", "@deepseek-ai/dsh-util-values"];
  const snapshot = {
    packages: required.map((name) => ({
        name,
        version: DSH_UPSTREAM.version,
        integrity: DSH_UPSTREAM.rootIntegrity,
      })),
  };
  const exact = `packages:\n\n${required.map((name) => `  '${name}@${DSH_UPSTREAM.version}':\n    resolution: {integrity: ${DSH_UPSTREAM.rootIntegrity}}`).join("\n")}\n`;
  assert.deepEqual(verifyCohortLock(snapshot, exact), { packages: 6 });
  assert.throws(
    () => verifyCohortLock(snapshot, exact.replace("sha512-", "sha512-wrong")),
    /integrity drift/,
  );
  assert.throws(
    () => verifyCohortLock(snapshot, `${exact}\n# 0.1.2-alpha.1\n`),
    /alpha\.1/,
  );
});

test("npm cohort verifies the registry ECDSA signature over exact name version and integrity", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const der = publicKey.export({ format: "der", type: "spki" });
  // npm treats keyid as the registry key selector. It is not the SHA-256 of
  // the DER/SPKI byte string returned in `key` (the public npm key endpoint
  // currently demonstrates that distinction).
  const keyid = `SHA256:${createHash("sha256").update("registry-key-selector").digest("base64").replace(/=+$/, "")}`;
  const entry = {
    name: "@deepseek-ai/dsh",
    version: DSH_UPSTREAM.version,
    integrity: DSH_UPSTREAM.rootIntegrity,
    signatures: [{
      keyid,
      sig: sign(
        "sha256",
        Buffer.from(`@deepseek-ai/dsh@${DSH_UPSTREAM.version}:${DSH_UPSTREAM.rootIntegrity}`),
        privateKey,
      ).toString("base64"),
    }],
  };
  const keys = [{
    keyid,
    keytype: "ecdsa-sha2-nistp256",
    scheme: "ecdsa-sha2-nistp256",
    key: der.toString("base64"),
  }];
  assert.equal(verifyRegistrySignatures(entry, keys), true);
  assert.throws(
    () => verifyRegistrySignatures(entry, [{ ...keys[0], keyid: `${keyid}-wrong` }]),
    /signature verification failed/,
  );
  assert.throws(
    () => verifyRegistrySignatures({ ...entry, integrity: `${entry.integrity}tampered` }, keys),
    /signature verification failed/,
  );
});
