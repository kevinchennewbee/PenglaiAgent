import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, git, gitState } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { PRODUCT_VERSION } from "./lib/product.mjs";

const state = gitState();
if (state.dirty) {
  finish("FAIL", {
    command: "verify:clean-clone",
    reason: "clean-clone gate requires a clean Git tree so git archive matches HEAD",
  });
}

const dest = mkdtempSync(join(tmpdir(), "penglai-clean-clone-"));
const archive = spawnSync("git", ["archive", "--format=tar", "HEAD"], {
  cwd: ROOT,
  encoding: "buffer",
  maxBuffer: 512 * 1024 * 1024,
});
if (archive.status !== 0) {
  rmSync(dest, { recursive: true, force: true });
  finish("FAIL", {
    command: "verify:clean-clone",
    reason: "git archive HEAD failed",
    detail: String(archive.stderr || "").slice(-800),
  });
}
const extract = spawnSync("tar", ["-xf", "-", "-C", dest], {
  input: archive.stdout,
  encoding: "buffer",
  maxBuffer: 512 * 1024 * 1024,
});
if (extract.status !== 0) {
  rmSync(dest, { recursive: true, force: true });
  finish("FAIL", {
    command: "verify:clean-clone",
    reason: "git archive extract failed",
    detail: String(extract.stderr || "").slice(-800),
  });
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: dest,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    timeout: 30 * 60 * 1000,
  });
  return {
    label,
    status: result.status,
    signal: result.signal,
    tail: `${result.stdout || ""}\n${result.stderr || ""}`.slice(-2000),
  };
}

const steps = [];
steps.push(run("pnpm", ["install", "--frozen-lockfile"], "frozen-install"));
if (steps.at(-1).status === 0) steps.push(run("pnpm", ["typecheck"], "typecheck"));
if (steps.at(-1).status === 0) steps.push(run("pnpm", ["build"], "build"));
if (steps.at(-1).status === 0) {
  steps.push(run("pnpm", ["test:unit"], "test:unit"));
}

const failed = steps.find((step) => step.status !== 0);
const head = git(["rev-parse", "HEAD"]);
rmSync(dest, { recursive: true, force: true });
if (failed) {
  finish("FAIL", {
    command: "verify:clean-clone",
    reason: `${failed.label} failed in git-archive tree`,
    productVersion: PRODUCT_VERSION,
    head,
    steps: steps.map((step) => ({ label: step.label, status: step.status })),
    tail: failed.tail,
  });
}
finish("PASS", {
  command: "verify:clean-clone",
  productVersion: PRODUCT_VERSION,
  head,
  steps: steps.map((step) => ({ label: step.label, status: step.status })),
});
