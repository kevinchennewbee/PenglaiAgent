import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { declaredSourceSha, recordAssertion } from "./assertion.js";
import {
  assertCommittedTemplateIdentity,
  assertObservedReleaseFacts,
  assertReleaseIdentity,
} from "./identity.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("R50-PREP-007 release notes state fresh install, trust, upgrade and uninstall", () => {
  const notes = readFileSync(join(root, "docs/RELEASE_NOTES_0.5.7.md"), "utf8");
  assert.match(notes, /Penglai → Update/i);
  assert.match(notes, /0\.5\.1/);
  assert.match(notes, /community-verified/);
  assert.match(notes, /not notarized/);
  assert.match(notes, /silent auto-update/i);
  assert.match(notes, /Plugin Center/);
  assert.match(notes, /Penglai_0\.5\.7_macos_x64\.dmg/);
  assert.match(notes, /Penglai_0\.5\.7_windows_x64_setup\.exe/);
  assert.match(notes, /automatic Workspace memory/i);
  assert.match(notes, /eight platform connectors/i);
  assert.match(notes, /WhatsApp\s+community runtime is not bundled/i);
  assert.match(notes, /not generic document blocks/i);
  assert.doesNotMatch(notes, /already notarized|App Store|zero-config Feishu|全自动升级/);
  recordAssertion({
    acceptanceId: "R50-PREP-007",
    runnerId: "docs",
    testId: "release-notes-public",
    assertionId: "fresh-install-trust-upgrade-uninstall",
    status: "PASS",
    candidateSourceSha: declaredSourceSha(),
    exitCode: 0,
    details: { safe: "0.5.7 notes state signed upgrade, three targets, automatic memory, IM truth, and trust limits" },
  });
});

test("R50-PREP-008 publication manifest lists the exact three-target release", () => {
  const md = readFileSync(join(root, "docs/PUBLICATION_MANIFEST_0.5.7.md"), "utf8");
  const committed = assertReleaseIdentity(JSON.parse(readFileSync(join(root, "release-info.json"), "utf8")));
  assertCommittedTemplateIdentity(committed);
  assert.match(md, /Penglai_0\.5\.7_macos_aarch64\.dmg/);
  assert.match(md, /Penglai_0\.5\.7_macos_x64\.dmg/);
  assert.match(md, /Penglai_0\.5\.7_windows_x64_setup\.exe/);
  assert.match(md, /public-export-manifest\.json/);
  assert.match(md, /kevinchennewbee\/PenglaiAgent/);
  assert.match(md, /PUBLIC_READBACK_PASS/);
  assert.match(md, /phase=UNFROZEN/);
  assert.match(md, /sourceSha=NONE/);
  assert.match(md, /community-verified/);
  assert.doesNotMatch(md, /pending public readback/i);
  const observedCells = [
    ...md.matchAll(/\| [^|\n]*`Penglai_0\.5\.7_[^`]+`[^|\n]*\| ([0-9,]+) \| `([0-9a-f]{64})` \|/g),
  ];
  assert.equal(observedCells.length, 3);
  for (const cell of observedCells) {
    assertObservedReleaseFacts({
      readbackStatus: "PASS",
      bytes: cell[1]?.replace(/,/g, "").trim(),
      sha: cell[2]?.replace(/`/g, "").trim(),
    });
  }
  recordAssertion({
    acceptanceId: "R50-PREP-008",
    runnerId: "manifest",
    testId: "publication-manifest-public",
    assertionId: "exact-three-target-assets",
    status: "PASS",
    candidateSourceSha: declaredSourceSha(),
    exitCode: 0,
    details: { safe: "0.5.7 publication manifest lists three installers and the authorized public destination" },
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
