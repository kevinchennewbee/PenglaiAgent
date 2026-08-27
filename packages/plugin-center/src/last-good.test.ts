import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { healLastGoodArtifacts } from "./profile-tx.js";

test("last-good recovery promotes next then prev after a crash window", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-last-good-"));
  try {
    const missing = join(root, "empty");
    mkdirSync(missing);
    assert.equal(healLastGoodArtifacts(missing), undefined);

    const nextDir = join(root, "next-only");
    mkdirSync(join(nextDir, "last-good-next-op1"), { recursive: true });
    writeFileSync(join(nextDir, "last-good-next-op1", "marker"), "next");
    assert.equal(healLastGoodArtifacts(nextDir), join(nextDir, "last-good"));

    const prevDir = join(root, "prev-only");
    mkdirSync(join(prevDir, "last-good-prev-op2"), { recursive: true });
    writeFileSync(join(prevDir, "last-good-prev-op2", "marker"), "prev");
    assert.equal(healLastGoodArtifacts(prevDir), join(prevDir, "last-good"));

    const both = join(root, "both");
    mkdirSync(join(both, "last-good-next-op3"), { recursive: true });
    mkdirSync(join(both, "last-good-prev-op3"), { recursive: true });
    writeFileSync(join(both, "last-good-next-op3", "marker"), "next");
    writeFileSync(join(both, "last-good-prev-op3", "marker"), "prev");
    const healed = healLastGoodArtifacts(both);
    assert.equal(healed, join(both, "last-good"));
    assert.equal(readFileSync(join(both, "last-good", "marker"), "utf8"), "next");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
