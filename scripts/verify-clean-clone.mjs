import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, git, gitState } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { PRODUCT_VERSION } from "./lib/product.mjs";
import { extractTapFailureDiagnostics } from "./lib/tap-diagnostics.mjs";

const state = gitState();
if (state.dirty) {
  finish("FAIL", {
    command: "verify:clean-clone",
    reason: "clean-clone gate requires a clean Git tree so the clone matches HEAD",
  });
}

const head = git(["rev-parse", "HEAD"]);
const dest = mkdtempSync(join(tmpdir(), "penglai-clean-clone-"));
const clone = spawnSync(
  "git",
  ["clone", "--local", "--no-hardlinks", "--no-checkout", ROOT, dest],
  { encoding: "utf8", timeout: 120_000 },
);
if (clone.status !== 0) {
  rmSync(dest, { recursive: true, force: true });
  finish("FAIL", {
    command: "verify:clean-clone",
    reason: "git clone --local failed",
    detail: String(clone.stderr || clone.stdout || "").slice(-800),
  });
}
const checkout = spawnSync("git", ["checkout", "--detach", head], {
  cwd: dest,
  encoding: "utf8",
});
if (checkout.status !== 0) {
  rmSync(dest, { recursive: true, force: true });
  finish("FAIL", {
    command: "verify:clean-clone",
    reason: "clone checkout of HEAD failed",
    detail: String(checkout.stderr || checkout.stdout || "").slice(-800),
  });
}
const clonedHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dest, encoding: "utf8" });
if (clonedHead.status !== 0 || clonedHead.stdout.trim() !== head) {
  rmSync(dest, { recursive: true, force: true });
  finish("FAIL", {
    command: "verify:clean-clone",
    reason: "cloned HEAD does not match source SHA",
    head,
    cloned: clonedHead.stdout.trim(),
  });
}
if (!existsSync(join(dest, ".git"))) {
  rmSync(dest, { recursive: true, force: true });
  finish("FAIL", { command: "verify:clean-clone", reason: "clone is missing .git" });
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: dest,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    timeout: 30 * 60 * 1000,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  return {
    label,
    status: result.status,
    signal: result.signal,
    diagnostics: result.status === 0 ? "" : extractTapFailureDiagnostics(output),
    tail: output.slice(-2000),
  };
}

const steps = [];
steps.push(run("pnpm", ["install", "--frozen-lockfile"], "frozen-install"));
if (steps.at(-1).status === 0) steps.push(run("pnpm", ["typecheck"], "typecheck"));
if (steps.at(-1).status === 0) steps.push(run("pnpm", ["build"], "build"));
if (steps.at(-1).status === 0) steps.push(run("git", ["status", "--porcelain"], "post-build-status"));
if (steps.at(-1).status === 0 && String(steps.at(-1).tail).trim()) {
  rmSync(dest, { recursive: true, force: true });
  finish("FAIL", {
    command: "verify:clean-clone",
    reason: "build polluted the cloned tree",
    head,
    dirty: steps.at(-1).tail,
  });
}
if (steps.at(-1).status === 0) steps.push(run("pnpm", ["test:unit"], "test:unit"));

const failed = steps.find((step) => step.status !== 0);
rmSync(dest, { recursive: true, force: true });
if (failed) {
  finish("FAIL", {
    command: "verify:clean-clone",
    reason: `${failed.label} failed in cloned tree`,
    productVersion: PRODUCT_VERSION,
    head,
    steps: steps.map((step) => ({ label: step.label, status: step.status })),
    diagnostics: failed.diagnostics,
    tail: failed.tail,
  });
}
finish("PASS", {
  command: "verify:clean-clone",
  productVersion: PRODUCT_VERSION,
  head,
  method: "git-clone-local-detach",
  steps: steps.map((step) => ({ label: step.label, status: step.status })),
});
