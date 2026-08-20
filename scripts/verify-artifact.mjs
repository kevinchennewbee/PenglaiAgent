import { execFileSync } from "node:child_process";

import { finish } from "./lib/exit-contract.mjs";
import { inspectPackagedCandidate, packagedAppForTarget } from "./lib/packaged-candidate.mjs";
import { ROOT, gitState } from "./lib/repo.mjs";

const expectedTarget = process.env.PENGLAI_TARGET ?? "darwin-aarch64";
const git = gitState();
if (git.branch !== "main" || git.head !== git.originMain || git.dirty) {
  finish("STALE", {
    command: "verify:artifact",
    reason: "candidate source must be clean main at origin/main",
    branch: git.branch,
    head: git.head,
    originMain: git.originMain,
    dirty: git.dirty,
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
    command: "verify:artifact",
    reason: packaged.reason,
    app,
    sourceSha: git.head,
    expectedTarget,
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
