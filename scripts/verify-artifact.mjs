import { execFileSync } from "node:child_process";

import { finish } from "./lib/exit-contract.mjs";
import { inspectPackagedCandidate, packagedAppForTarget } from "./lib/packaged-candidate.mjs";
import { ROOT } from "./lib/repo.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { nativeBlocked, parseTargetArg } from "./lib/release-targets.mjs";
import { verifyAppliedOverlay } from "./apply-overlay.mjs";

const expectedTarget = parseTargetArg();
const source = requireCleanCandidateSource();
if (!source.ok) {
  finish("STALE", {
    command: "verify:artifact",
    reason: source.reason,
    ...source.git,
  });
}
const git = source.git;

const blocked = nativeBlocked("verify:artifact", expectedTarget);
const app = packagedAppForTarget(ROOT, expectedTarget);
const packaged = inspectPackagedCandidate({
  app,
  candidateSha: git.head,
  expectedTarget,
});
if (packaged.verdict !== "PASS") {
  if (blocked) {
    finish("BLOCKED", {
      command: "verify:artifact",
      ...blocked,
      inspect: packaged.verdict,
      reason: packaged.reason,
    });
  }
  finish(packaged.verdict, {
    command: "verify:artifact",
    reason: packaged.reason,
    app,
    sourceSha: git.head,
    expectedTarget,
  });
}
if (blocked) {
  finish("BLOCKED", {
    command: "verify:artifact",
    ...blocked,
    reason: "cross-built or foreign-host inspect is not native artifact PASS",
  });
}

try {
  verifyAppliedOverlay(`${packaged.resources}/runtime/dsh`);
} catch (error) {
  finish("FAIL", {
    command: "verify:artifact",
    reason: error instanceof Error ? error.message : String(error),
  });
}

const nodeVersion = execFileSync(packaged.nodeBin, ["-p", "process.version"], {
  encoding: "utf8",
  env: { PATH: "/usr/bin:/bin" },
  cwd: "/tmp",
}).trim();
if (nodeVersion !== `v${packaged.release.embeddedNode}`) {
  finish("FAIL", {
    command: "verify:artifact",
    reason: `embedded Node ${nodeVersion} != release identity v${packaged.release.embeddedNode}`,
  });
}

const dshVersion = execFileSync(packaged.nodeBin, [packaged.dshBin, "--version"], {
  encoding: "utf8",
  env: { PATH: "/usr/bin:/bin", NODE_PATH: "" },
  cwd: "/tmp",
}).trim();
if (!dshVersion.includes(packaged.release.dsh)) {
  finish("FAIL", {
    command: "verify:artifact",
    reason: "embedded DSH version probe mismatch",
    dshVersion,
  });
}

finish("PASS", {
  command: "verify:artifact",
  app,
  sourceSha: packaged.release.sourceSha,
  target: expectedTarget,
  manifestSha256: packaged.manifestSha256,
  node: nodeVersion,
  dsh: dshVersion,
});
