import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { finish } from "./lib/exit-contract.mjs";
import { inspectPackagedCandidate, packagedAppForTarget } from "./lib/packaged-candidate.mjs";
import { ROOT } from "./lib/repo.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { nativeBlocked, parseTargetArg } from "./lib/release-targets.mjs";

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

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const packagedBytes = JSON.parse(
  readFileSync(join(ROOT, "docs/0.5.9/DSH_ALPHA_PACKAGED_BYTES.json"), "utf8"),
);
if (packagedBytes.dsh !== packaged.release.dsh || packagedBytes.mode !== "official-npm-cohort-no-source-patch") {
  finish("FAIL", { command: "verify:artifact", reason: "DSH alpha packaged-byte policy identity drift" });
}
for (const row of packagedBytes.officialBytes ?? []) {
  const target = join(packaged.resources, "runtime", "dsh", row.relative);
  if (!existsSync(target) || sha256(target) !== row.sha256) {
    finish("FAIL", { command: "verify:artifact", reason: `official DSH byte mismatch ${row.id}` });
  }
}
const legacyBrandRoot = join(
  packaged.resources,
  "runtime/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/penglai-brand",
);
if (existsSync(legacyBrandRoot)) {
  finish("FAIL", { command: "verify:artifact", reason: "historical DSH overlay brand directory remains active" });
}
const brandRoot = join(packaged.resources, "app", "static", "penglai-brand");
const expectedBrand = (packagedBytes.brandAssets ?? []).map((row) => row.name).sort();
const actualBrand = existsSync(brandRoot) ? readdirSync(brandRoot).sort() : [];
if (JSON.stringify(actualBrand) !== JSON.stringify(expectedBrand)) {
  finish("FAIL", { command: "verify:artifact", reason: "Penglai brand asset inventory mismatch" });
}
for (const row of packagedBytes.brandAssets ?? []) {
  const target = join(brandRoot, row.name);
  if (!existsSync(target) || sha256(target) !== row.sha256) {
    finish("FAIL", { command: "verify:artifact", reason: `Penglai brand asset mismatch ${row.name}` });
  }
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
  overlay: packagedBytes.mode,
});
