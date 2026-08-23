import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function lastJson(text: string): { verdict?: string } {
  const line = text.trim().split("\n").filter(Boolean).at(-1) ?? "{}";
  return JSON.parse(line) as { verdict?: string };
}

test("closure verifier exits INCOMPLETE when its closure credential is absent", () => {
  const staging = mkdtempSync(join(tmpdir(), "penglai-missing-closure-"));
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/verify-closure.mjs", "--staging", staging], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.equal(lastJson(result.stderr || result.stdout).verdict, "INCOMPLETE");
});

test("profile verifier overwrites stale PASS and exits INCOMPLETE without a closure", () => {
  const staging = mkdtempSync(join(tmpdir(), "penglai-missing-profile-"));
  const report = join(root, "evidence/generated/verify-profile.json");
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, `${JSON.stringify({ command: "verify:profile", verdict: "PASS", staleFixture: true })}\n`);
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/verify-profile.mjs", "--staging", staging], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.equal(lastJson(result.stderr || result.stdout).verdict, "INCOMPLETE");
  const current = JSON.parse(readFileSync(report, "utf8")) as { verdict?: string; staleFixture?: boolean };
  assert.equal(current.verdict, "INCOMPLETE");
  assert.equal(current.staleFixture, undefined);
});
