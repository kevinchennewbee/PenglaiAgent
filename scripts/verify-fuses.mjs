import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, gitState } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { inspectBinary } from "./lib/electron-fuses.mjs";
import { inspectPackagedCandidate, packagedAppForTarget } from "./lib/packaged-candidate.mjs";

const identity = await import(pathToFileURL(join(ROOT, "packages/release-identity/src/index.ts")).href);

const evidenceDir = join(ROOT, "evidence/generated");
const assertionFile = join(evidenceDir, "artifact-assertions.jsonl");
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(assertionFile, "");
process.env.PENGLAI_EVIDENCE_DIR = assertionFile;

const policyPath = join(ROOT, "packaging/electron-fuses.json");
if (!existsSync(policyPath)) {
  finish("INCOMPLETE", {
    command: "verify:fuses",
    reason: "fuse policy not installed",
  });
}
const raw = JSON.parse(readFileSync(policyPath, "utf8"));
if (raw.runAsNode !== false || raw.enableNodeOptionsEnvironmentVariable !== false || raw.enableNodeCliInspectArguments !== false) {
  finish("FAIL", {
    command: "verify:fuses",
    reason: "fuse policy must disable RunAsNode, NODE_OPTIONS, and CLI inspect",
  });
}

const expectedTarget = process.env.PENGLAI_TARGET ?? "darwin-aarch64";
const git = gitState();
if (git.branch !== "main" || git.head !== git.originMain || git.dirty) {
  finish("STALE", {
    command: "verify:fuses",
    reason: "candidate source must be clean main at origin/main",
    ...git,
  });
}
const app = packagedAppForTarget(ROOT, expectedTarget);
const packaged = inspectPackagedCandidate({
  app,
  candidateSha: git.head,
  expectedTarget,
});
if (packaged.verdict !== "PASS") {
  finish(packaged.verdict, {
    command: "verify:fuses",
    reason: packaged.reason,
    app,
    sourceSha: git.head,
    expectedTarget,
  });
}
const windows = expectedTarget === "win32-x86_64";
const binary = windows ? join(app, "Penglai.exe") : join(app, "Contents/Frameworks/Electron Framework.framework/Electron Framework");
if (!existsSync(binary)) {
  finish("INCOMPLETE", {
    command: "verify:fuses",
    reason: "0.5 packaged Electron Framework missing; cannot inspect binary fuses",
    staleAlphaIgnored: true,
  });
}

let info;
try {
  info = await inspectBinary(binary);
} catch (err) {
  finish("FAIL", { command: "verify:fuses", reason: String(err), binary });
}
if (info.values.runAsNode !== false || info.values.enableNodeOptionsEnvironmentVariable !== false || info.values.enableNodeCliInspectArguments !== false) {
  finish("FAIL", {
    command: "verify:fuses",
    reason: "packaged binary fuses do not match required disabled RunAsNode/NODE_OPTIONS/inspect",
    values: info.values,
    binary,
  });
}
identity.recordAssertion({
  acceptanceId: "R50-SEC-004",
  runnerId: "artifact",
  testId: "verify-fuses-binary",
  assertionId: "packaged-framework-run-as-node-disabled",
  status: "PASS",
  candidateSourceSha: packaged.release.sourceSha,
  target: expectedTarget,
  runnerNative: process.platform === "darwin" && ((expectedTarget === "darwin-aarch64" && process.arch === "arm64") || (expectedTarget === "darwin-x86_64" && process.arch === "x64")),
  exitCode: 0,
  details: {
    safe: "packaged Electron binary bytes have RunAsNode, NODE_OPTIONS, and CLI inspect disabled",
  },
});
if (!windows) identity.recordAssertion({
  acceptanceId: "R50-MAC-005",
  runnerId: "security",
  testId: "verify-fuses-binary",
  assertionId: "packaged-framework-hardening-bytes",
  status: "PASS",
  candidateSourceSha: packaged.release.sourceSha,
  target: expectedTarget,
  runnerNative: process.platform === "darwin" && ((expectedTarget === "darwin-aarch64" && process.arch === "arm64") || (expectedTarget === "darwin-x86_64" && process.arch === "x64")),
  exitCode: 0,
  details: {
    safe: "packaged macOS binary fuse wire inspected; onlyLoadAppFromAsar remains false for unpacked app",
  },
});
finish("PASS", {
  command: "verify:fuses",
  binary,
  values: info.values,
  sourceSha: packaged.release.sourceSha,
  target: expectedTarget,
  source: "packaged-electron-framework-bytes",
});
