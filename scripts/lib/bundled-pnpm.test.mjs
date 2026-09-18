import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { copyBundledPnpm } from "./bundled-pnpm.mjs";

function input(root) {
  const files = {
    "package.json": JSON.stringify({ name: "pnpm", version: "11.11.0", bin: { pnpm: "bin/pnpm.mjs" } }),
    "bin/pnpm.mjs": "// fixture entry\n",
    "dist/pnpm.mjs": "// fixture bundle\n",
    "LICENSE": "license fixture",
    "dist/node_modules/@reflink/reflink-darwin-arm64/reflink.darwin-arm64.node": "native fixture",
    "dist/node_modules/@reflink/reflink-darwin-arm64/package.json": "{\"name\":\"@reflink/reflink-darwin-arm64\"}",
    "dist/node_modules/@reflink/reflink-win32-x64-msvc/reflink.win32-x64-msvc.node": "native fixture",
    "dist/node_modules/@reflink/reflink-win32-x64-msvc/package.json": "{\"name\":\"@reflink/reflink-win32-x64-msvc\"}",
    "dist/vendor/fastlist-0.3.0-x64.exe": "native fixture",
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
}

test("pnpm target projection retains exact JS/notices and excludes foreign helpers", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-pnpm-target-"));
  const source = join(root, "source");
  input(source);
  try {
    for (const target of ["linux-loong64", "darwin-aarch64", "win32-x86_64"]) {
      const dest = join(root, target);
      const result = copyBundledPnpm(source, dest, target);
      assert.equal(result.version, "11.11.0");
      assert.equal(readFileSync(join(dest, "dist/pnpm.mjs"), "utf8"), "// fixture bundle\n");
      assert.equal(readFileSync(join(dest, "LICENSE"), "utf8"), "license fixture");
      assert.equal(existsSync(join(dest, "dist/vendor/fastlist-0.3.0-x64.exe")), target === "win32-x86_64");
      assert.equal(existsSync(join(dest, "dist/node_modules/@reflink/reflink-darwin-arm64/reflink.darwin-arm64.node")), target === "darwin-aarch64");
      assert.equal(existsSync(join(dest, "dist/node_modules/@reflink/reflink-darwin-arm64/package.json")), target === "darwin-aarch64");
      assert.equal(existsSync(join(dest, "dist/node_modules/@reflink/reflink-win32-x64-msvc/package.json")), target === "win32-x86_64");
      if (target === "linux-loong64") {
        assert.equal(
          result.omitted.some((path) => path.includes("reflink-darwin-arm64")),
          true,
        );
        assert.equal(
          result.omitted.some((path) => path.includes("reflink-win32-x64-msvc")),
          true,
        );
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("pnpm projection fails on an unexpected native artifact or version", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-pnpm-refuse-"));
  const source = join(root, "source");
  input(source);
  try {
    writeFileSync(join(source, "extra.node"), "unreviewed fixture");
    assert.throws(() => copyBundledPnpm(source, join(root, "out"), "linux-loong64"), /unreviewed/);
    rmSync(join(source, "extra.node"));
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "pnpm", version: "0.0.0" }));
    assert.throws(() => copyBundledPnpm(source, join(root, "out"), "linux-loong64"), /identity/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
