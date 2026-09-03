import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function lastJson(text: string): { verdict?: string } {
  const line = text.trim().split("\n").filter(Boolean).at(-1) ?? "{}";
  return JSON.parse(line) as { verdict?: string };
}

function currentReports(command: string): Array<Buffer | undefined> {
  return ["", "-darwin-aarch64", "-darwin-x86_64", "-win32-x86_64"].map((suffix) => {
    const path = join(root, "evidence/generated", `${command}${suffix}.json`);
    return existsSync(path) ? readFileSync(path) : undefined;
  });
}

test("closure verifier exits INCOMPLETE without changing native release evidence", (t) => {
  const fixture = mkdtempSync(join(tmpdir(), "penglai-missing-closure-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const before = currentReports("verify-closure");
  const staging = join(fixture, "empty-staging");
  mkdirSync(staging);
  const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), join(root, "scripts/verify-closure.mjs"), "--staging", staging], {
    cwd: fixture,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.equal(lastJson(result.stderr || result.stdout).verdict, "INCOMPLETE");
  assert.deepEqual(currentReports("verify-closure"), before);
  const report = JSON.parse(readFileSync(join(fixture, "evidence/generated/verify-closure.json"), "utf8")) as { verdict?: string };
  assert.equal(report.verdict, "INCOMPLETE");
});

test("profile verifier overwrites only its isolated stale fixture report", (t) => {
  const fixture = mkdtempSync(join(tmpdir(), "penglai-missing-profile-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const before = currentReports("verify-profile");
  const staging = join(fixture, "empty-staging");
  mkdirSync(staging);
  const report = join(fixture, "evidence/generated/verify-profile.json");
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, `${JSON.stringify({ command: "verify:profile", verdict: "PASS", staleFixture: true })}\n`);
  const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), join(root, "scripts/verify-profile.mjs"), "--staging", staging], {
    cwd: fixture,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.equal(lastJson(result.stderr || result.stdout).verdict, "INCOMPLETE");
  const current = JSON.parse(readFileSync(report, "utf8")) as { verdict?: string; staleFixture?: boolean };
  assert.equal(current.verdict, "INCOMPLETE");
  assert.equal(current.staleFixture, undefined);
  assert.deepEqual(currentReports("verify-profile"), before);
});
