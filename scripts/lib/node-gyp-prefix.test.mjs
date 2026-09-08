import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { nodeGypPrefix } from "./node-gyp-prefix.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("node-gyp uses a local Node prefix instead of downloading headers", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-nodedir-"));
  try {
    mkdirSync(join(root, "include", "node"), { recursive: true });
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(join(root, "include", "node", "node.h"), "/* local */\n");
    const fakeNode = join(root, "bin", "node");
    writeFileSync(fakeNode, "");
    assert.equal(nodeGypPrefix(fakeNode), root);
    const winRoot = join(root, "win");
    mkdirSync(join(winRoot, "include", "node"), { recursive: true });
    writeFileSync(join(winRoot, "include", "node", "node.h"), "/* win */\n");
    writeFileSync(join(winRoot, "node.exe"), "");
    assert.equal(nodeGypPrefix(join(winRoot, "node.exe")), winRoot);
    assert.equal(nodeGypPrefix(join(root, "nope", "bin", "node")), "");
    const rebuild = readFileSync(join(repo, "scripts/rebuild-fs-ext.mjs"), "utf8");
    assert.match(rebuild, /nodeGypPrefix/);
    assert.match(rebuild, /npm_config_nodedir/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
