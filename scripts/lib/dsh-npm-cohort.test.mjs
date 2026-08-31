import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverAlpha2SourcePackages, DSH_ALPHA2 } from "./dsh-npm-cohort.mjs";

test("discovers public alpha.2, vendor, and Landlock source packages", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-npm-cohort-"));
  const fixtures = [
    ["apps/cli", { name: "@deepseek-ai/dsh", version: DSH_ALPHA2.version, license: "MIT" }],
    ["packages/util/deque", { name: "@deepseek-ai/dsh-deque", version: DSH_ALPHA2.version, license: "MIT" }],
    ["vendor/cordis", { name: "@deepseek-ai/cordis", version: "4.0.2", license: "MIT" }],
    ["native/landlock-run/packages/entry", { name: "@deepseek-ai/node-addon-landlock-run", version: "0.1.1", license: "BSD-3-Clause" }],
    ["packages/private/fixture", { name: "@deepseek-ai/dsh-private", version: DSH_ALPHA2.version, private: true }],
  ];
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "root", private: true }));
  for (const [directory, manifest] of fixtures) {
    const target = join(root, directory);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "package.json"), JSON.stringify(manifest));
  }
  const found = discoverAlpha2SourcePackages(root);
  assert.deepEqual(found.map(({ name, category }) => ({ name, category })), [
    { name: "@deepseek-ai/cordis", category: "vendor" },
    { name: "@deepseek-ai/dsh", category: "dsh" },
    { name: "@deepseek-ai/dsh-deque", category: "dsh" },
    { name: "@deepseek-ai/node-addon-landlock-run", category: "landlock" },
  ]);
});

