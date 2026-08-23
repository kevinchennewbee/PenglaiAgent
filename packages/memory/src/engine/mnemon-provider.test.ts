import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hostMnemonTarget, resolveMnemonBinary } from "./mnemon-provider.js";

test("packed Memory resolves its package-local Mnemon binary without desktop env", () => {
  const asset = hostMnemonTarget();
  assert.ok(asset, "current test host must have a pinned Mnemon target");
  const root = mkdtempSync(join(tmpdir(), "penglai-packed-mnemon-"));
  const bin = join(root, "resources", "mnemon", asset.binaryFilename);
  mkdirSync(join(root, "resources", "mnemon"), { recursive: true });
  writeFileSync(bin, "package-local-mnemon-fixture");
  if (process.platform !== "win32") chmodSync(bin, 0o755);
  try {
    const resolved = resolveMnemonBinary({
      packageRoot: root,
      verifyHash: false,
    });
    assert.equal(resolved?.path, realpathSync(bin));
    assert.equal(resolved?.target, asset.target);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
