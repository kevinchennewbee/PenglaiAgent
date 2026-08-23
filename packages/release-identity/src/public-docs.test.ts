import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { declaredSourceSha, recordAssertion } from "./assertion.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("R50-PREP-007 release notes state fresh install, trust, upgrade and uninstall", () => {
  const notes = readFileSync(join(root, "docs/RELEASE_NOTES_0.5.5.md"), "utf8");
  assert.match(notes, /Penglai → Update/i);
  assert.match(notes, /0\.5\.1/);
  assert.match(notes, /community-verified/);
  assert.match(notes, /not notarized/);
  assert.match(notes, /silent auto-update/i);
  assert.match(notes, /Plugin Center/);
  assert.match(notes, /darwin-x86_64/);
  assert.match(notes, /win32-x86_64/);
  assert.doesNotMatch(notes, /already notarized|App Store|zero-config Feishu|全自动升级/);
  recordAssertion({
    acceptanceId: "R50-PREP-007",
    runnerId: "docs",
    testId: "release-notes-draft",
    assertionId: "fresh-install-trust-upgrade-uninstall",
    status: "PASS",
    candidateSourceSha: declaredSourceSha(),
    exitCode: 0,
    details: { safe: "0.5.5 notes state signed upgrade, three targets, community trust, and update confirmation" },
  });
});

test("R50-PREP-008 publication manifest lists the exact three-target release", () => {
  const md = readFileSync(join(root, "docs/PUBLICATION_MANIFEST_0.5.5.md"), "utf8");
  assert.match(md, /Penglai_0\.5\.5_macos_aarch64\.dmg/);
  assert.match(md, /Penglai_0\.5\.5_macos_x64\.dmg/);
  assert.match(md, /Penglai_0\.5\.5_windows_x64_setup\.exe/);
  assert.match(md, /public-export-manifest\.json/);
  assert.match(md, /kevinchennewbee\/PenglaiAgent/);
  assert.match(md, /UNFROZEN/);
  assert.match(md, /community-verified/);
  recordAssertion({
    acceptanceId: "R50-PREP-008",
    runnerId: "manifest",
    testId: "publication-manifest-draft",
    assertionId: "exact-three-target-assets",
    status: "PASS",
    candidateSourceSha: declaredSourceSha(),
    exitCode: 0,
    details: { safe: "publication manifest draft lists three installers and the authorized public destination" },
  });
});

test("fuse policy disables RunAsNode and inspect and forbids dryRun green", () => {
  const policy = JSON.parse(readFileSync(join(root, "packaging/electron-fuses.json"), "utf8"));
  assert.equal(policy.runAsNode, false);
  assert.equal(policy.enableNodeCliInspectArguments, false);
  assert.equal(policy.enableNodeOptionsEnvironmentVariable, false);
  assert.equal(policy.dryRun, false);
  const verify = readFileSync(join(root, "scripts/verify-fuses.mjs"), "utf8");
  assert.match(verify, /inspectBinary/);
  assert.match(verify, /packaged-electron-framework-bytes/);
});
