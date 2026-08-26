import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { resolvePackageMetadata } from "./package-metadata.mjs";

test("resolvePackageMetadata reads exports-only packages from workspace node_modules", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-pkg-meta-"));
  const pkgDir = join(root, "node_modules", "exports-only-pkg");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: "exports-only-pkg",
      version: "1.2.3",
      license: "MIT",
      exports: { ".": { import: "./dist/index.js" } },
    }),
  );
  const resolver = createRequire(join(root, "package.json"));
  const found = resolvePackageMetadata("exports-only-pkg", resolver, join(root, "packages", "unused"), root);
  assert.equal(found.metadata.name, "exports-only-pkg");
  assert.equal(found.metadata.version, "1.2.3");
  assert.equal(found.root, pkgDir);
});

test("resolvePackageMetadata finds workspace packages that are not hoisted", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-pkg-ws-"));
  const pkgDir = join(root, "packages", "image-size-disabled");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: "image-size", version: "0.5.7", license: "MIT", main: "index.cjs" }),
  );
  const found = resolvePackageMetadata("image-size", { resolve() { throw new Error("no resolve"); } }, join(root, "missing"), root);
  assert.equal(found.metadata.name, "image-size");
  assert.equal(found.metadata.version, "0.5.7");
  assert.equal(found.root, pkgDir);
});
