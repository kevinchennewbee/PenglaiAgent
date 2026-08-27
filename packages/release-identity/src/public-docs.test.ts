import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, statSync } from "node:fs";
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

test("website keeps the full bilingual visual site and exact 0.5.7 downloads", () => {
  const zh = readFileSync(join(root, "website/index.html"), "utf8");
  const en = readFileSync(join(root, "website/en/index.html"), "utf8");
  const css = readFileSync(join(root, "website/styles/main.css"), "utf8");
  const requiredAssets = [
    "website/favicon.svg",
    "website/shots/banner-v1.png",
    "website/shots/0.5.5/plugin-center.png",
    "website/shots/0.5.5/office.png",
    "website/shots/0.5.5/memory.png",
    "website/shots/0.5.5/mobile-messaging.png",
    "website/shots/0.5.5/welcome.png",
  ];

  for (const rel of requiredAssets) {
    const path = join(root, rel);
    assert.equal(existsSync(path), true, `${rel} missing`);
    assert.ok(statSync(path).size > 100, `${rel} is unexpectedly small`);
  }
  for (const html of [zh, en]) {
    assert.match(html, /shots\/banner-v1\.png/);
    assert.match(html, /shots\/0\.5\.5\/plugin-center\.png/);
    assert.match(html, /Penglai_0\.5\.7_macos_aarch64\.dmg/);
    assert.match(html, /Penglai_0\.5\.7_macos_x64\.dmg/);
    assert.match(html, /Penglai_0\.5\.7_windows_x64_setup\.exe/);
    assert.match(html, /bfbaec4b9f4b627abd41e793abae6b68246d0f00d8e9c5ca003d079e1e3667c8/);
    assert.match(html, /ab696fc92a2b1af538eed6008c8389ddc945d9dce39d85b16053cf60d8e2655e/);
    assert.match(html, /cb4687e621d951d6d8ba4cf8428f4723f35c9827fa70ac542d4d3d928d5d882a/);
    assert.doesNotMatch(html, /releases\/download\/v0\.5\.6/);
  }
  assert.match(css, /\.hero-art/);
  assert.match(css, /\.gallery/);
  assert.ok(css.length > 5000, "website stylesheet is unexpectedly reduced");
});
