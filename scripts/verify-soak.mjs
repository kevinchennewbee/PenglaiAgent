import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, gitState, isDocsOnlyRange } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { evidenceName, RELEASE_TARGETS } from "./lib/release-targets.mjs";

const identity = await import(pathToFileURL(join(ROOT, "packages/release-identity/src/index.ts")).href);
const git = gitState();
if (process.argv.includes("--aggregate")) {
  const records = [];
  for (const target of RELEASE_TARGETS) {
    const soakPath = join(ROOT, "evidence/generated", evidenceName("soak", target));
    const installerPath = join(ROOT, "evidence/generated", evidenceName("local-installer", target));
    if (!existsSync(soakPath) || !existsSync(installerPath)) {
      finish("INCOMPLETE", { command: "verify:soak", reason: `missing exact soak or installer evidence for ${target}`, target });
    }
    const soak = JSON.parse(readFileSync(soakPath, "utf8"));
    const installer = JSON.parse(readFileSync(installerPath, "utf8"));
    const samples = soak.samplesCovered ?? soak.sampleSet ?? [];
    const required = ["im", "offline", "sleep"];
    if (
      soak.productVersion !== "0.5.9" ||
      soak.target !== target ||
      soak.hours < 2 ||
      soak.sourceSha !== git.head ||
      installer.sourceSha !== git.head ||
      installer.target !== target ||
      soak.installerSha256 !== installer.sha256 ||
      !required.every((sample) => samples.includes(sample))
    ) {
      finish("STALE", { command: "verify:soak", reason: `soak is not an exact complete PASS for ${target}`, target });
    }
    records.push({ target, installerSha256: soak.installerSha256, hours: soak.hours });
  }
  finish("PASS", { command: "verify:soak", sourceSha: git.head, targets: records });
}
const path = join(ROOT, "evidence/generated/soak.json");
const dmgPath = join(ROOT, "evidence/generated/local-dmg.json");
if (!existsSync(path)) {
  finish("INCOMPLETE", { command: "verify:soak", reason: "no 0.5 installed soak evidence" });
}
const rec = JSON.parse(readFileSync(path, "utf8"));
if (/0\.2\.0-alpha|ba5ba3dd|c19e393e/.test(JSON.stringify(rec))) {
  finish("STALE", { command: "verify:soak", reason: "soak evidence bound to stale alpha source/artifact" });
}
if (rec.productVersion !== "0.5.9" || rec.hours < 2) {
  finish("INCOMPLETE", { command: "verify:soak", reason: "exact 0.5 two-hour soak not present" });
}
const current = existsSync(dmgPath) ? JSON.parse(readFileSync(dmgPath, "utf8")) : null;
const samples = rec.samplesCovered ?? rec.sampleSet ?? (rec.lastHealth ? ["http", "ws", "process"] : []);
const currentExact =
    current?.sha256 && (current.sourceSha === git.head || isDocsOnlyRange(current.sourceSha, git.head))
      ? current.sha256
      : undefined;
if (!currentExact) {
  finish("INCOMPLETE", {
    command: "verify:soak",
    reason: "no current exact 0.5 arm64 DMG bound to HEAD; leftover soak evidence is not release-stale",
    samples,
  });
}
const bound = identity.bindArtifactFreshness({
  candidateSha: git.head,
  evidenceSourceSha: rec.sourceSha ?? current?.sourceSha,
  currentArtifactSha256: currentExact,
  soakArtifactSha256: rec.installerSha256,
  soakSamples: samples,
});
if (!bound.ok) {
  finish(bound.verdict, { command: "verify:soak", reason: bound.reason, samples });
}
finish("PASS", { command: "verify:soak", installerSha256: rec.installerSha256, samples });
