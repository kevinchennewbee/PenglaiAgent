import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { inspectPackagedCandidate, packagedAppForTarget } from "./lib/packaged-candidate.mjs";
import { ROOT } from "./lib/repo.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { finish } from "./lib/exit-contract.mjs";

function runCodesign(args) {
  const r = spawnSync("codesign", args, { encoding: "utf8" });
  return {
    status: r.status ?? 1,
    text: `${r.stdout ?? ""}\n${r.stderr ?? ""}`,
  };
}

const expectedTarget = process.env.PENGLAI_TARGET ?? "darwin-aarch64";
const source = requireCleanCandidateSource();
if (!source.ok) {
  finish("STALE", {
    command: "verify:signing",
    reason: source.reason,
    ...source.git,
  });
}
const git = source.git;
const app = packagedAppForTarget(ROOT, expectedTarget);
const packaged = inspectPackagedCandidate({
  app,
  candidateSha: git.head,
  expectedTarget,
});
if (packaged.verdict !== "PASS") {
  finish(packaged.verdict, {
    command: "verify:signing",
    reason: packaged.reason,
    app,
    sourceSha: git.head,
    expectedTarget,
  });
}

const verified = runCodesign(["--verify", "--deep", "--strict", "--verbose=2", app]);
if (verified.status !== 0) {
  console.error("codesign --verify --deep --strict failed");
  process.stderr.write(verified.text);
  process.exit(1);
}
const display = runCodesign(["-dv", "--verbose=2", app]);
const text = `${display.text}\n${verified.text}`;
const adhoc = /Signature=adhoc|flags=.*adhoc|\badhoc\b/i.test(text);
const developerId = /Developer ID Application/i.test(text);
if (developerId) {
  console.error("this local-acceptance contract expects ad-hoc, not Developer ID");
  process.exit(1);
}
if (!adhoc) {
  console.error("codesign display is not ad-hoc", display.text);
  process.exit(1);
}

const summary = ["Penglai 0.5.5 community-verified ad-hoc contract", `app=${app}`, `sourceSha=${packaged.release.sourceSha}`, `target=${expectedTarget}`, "codesign --verify --deep --strict --verbose=2: PASS", "signatureKind=adhoc", "developerIdSigned=false", "notarized=false", "authenticode=false", display.text.trim()].join("\n");
mkdirSync(join(ROOT, "dist"), { recursive: true });
writeFileSync(join(ROOT, "dist/codesign-verification.txt"), `${summary}\n`);
finish("PASS", {
  command: "verify:signing",
  signatureKind: "adhoc",
  developerIdSigned: false,
  notarized: false,
  authenticode: false,
  app,
  sourceSha: packaged.release.sourceSha,
  target: expectedTarget,
});
