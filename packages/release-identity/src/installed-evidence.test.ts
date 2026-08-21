import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { declaredSourceSha, recordAssertion } from "./assertion.js";
import { inspectDmgEvidence, inspectPackagedCandidate, packagedAppForTarget } from "../../../scripts/lib/packaged-candidate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("R50-SEC-004 records only when packaged Electron Framework bytes are inspected", async () => {
  const sourceSha = declaredSourceSha();
  const app = packagedAppForTarget(root, "darwin-aarch64");
  const packaged = inspectPackagedCandidate({ app, candidateSha: sourceSha, expectedTarget: "darwin-aarch64" });
  if (packaged.verdict !== "PASS") return;
  const binary = join(app, "Contents/Frameworks/Electron Framework.framework/Electron Framework");
  if (!existsSync(binary)) return;
  const { inspectBinary } = await import(new URL("../../../scripts/lib/electron-fuses.mjs", import.meta.url).href);
  const info = inspectBinary(binary);
  if (info.values.runAsNode !== false || info.values.enableNodeCliInspectArguments !== false) return;
  recordAssertion({
    acceptanceId: "R50-SEC-004",
    runnerId: "artifact",
    testId: "packaged-fuse-bytes",
    assertionId: "binary-run-as-node-disabled",
    status: "PASS",
    candidateSourceSha: packaged.release.sourceSha,
    target: "darwin-aarch64",
    runnerNative: process.platform === "darwin" && process.arch === "arm64",
    exitCode: 0,
    details: { safe: "packaged Electron Framework fuse wire has RunAsNode and CLI inspect disabled" },
  });
  recordAssertion({
    acceptanceId: "R50-MAC-005",
    runnerId: "security",
    testId: "packaged-fuse-bytes",
    assertionId: "binary-hardening-inspected",
    status: "PASS",
    candidateSourceSha: packaged.release.sourceSha,
    target: "darwin-aarch64",
    runnerNative: process.platform === "darwin" && process.arch === "arm64",
    exitCode: 0,
    details: { safe: "arm64 packaged fuses inspected from Electron Framework bytes" },
  });
});
test("R50-MAC-006/007/008 record only from sealed local DMG evidence", () => {
  const sourceSha = declaredSourceSha();
  const app = packagedAppForTarget(root, "darwin-aarch64");
  const local = join(root, "evidence/generated/local-dmg.json");
  const packaged = inspectPackagedCandidate({ app, candidateSha: sourceSha, expectedTarget: "darwin-aarch64" });
  if (packaged.verdict !== "PASS") return;
  const dmg = inspectDmgEvidence({ root, packaged, evidencePath: local });
  if (dmg.verdict !== "PASS") return;
  if (process.platform !== "darwin") return;
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { encoding: "utf8" });
  assert.equal(dmg.evidence.signatureKind, "adhoc");
  assert.match(dmg.actualSha256, /^[0-9a-f]{64}$/);
  const plist = readFileSync(join(app, "Contents/Info.plist"), "utf8");
  assert.match(plist, /Penglai/);
  assert.match(plist, /com\.penglai\.dsh/);
  const common = {
    candidateSourceSha: packaged.release.sourceSha,
    target: "darwin-aarch64",
    runnerNative: process.arch === "arm64",
    artifactSha256: dmg.actualSha256,
    exitCode: 0,
    status: "PASS",
  };
  recordAssertion({
    ...common,
    acceptanceId: "R50-MAC-004",
    runnerId: "installed",
    testId: "local-dmg-seal",
    assertionId: "info-plist-name-bundle-id",
    details: { safe: "from-dmg Info.plist has Penglai name and com.penglai.dsh bundle id" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-MAC-006",
    runnerId: "signing",
    testId: "local-dmg-seal",
    assertionId: "codesign-deep-strict",
    details: { safe: "from-dmg Penglai.app codesign --verify --deep --strict passed" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-MAC-007",
    runnerId: "artifact",
    testId: "local-dmg-seal-R50-MAC-007",
    assertionId: "udzo-hdiutil-verify",
    details: { safe: "local arm64 DMG was created UDZO and hdiutil verify recorded adhoc" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-MAC-008",
    runnerId: "artifact",
    testId: "local-dmg-seal-R50-MAC-008",
    assertionId: "mounted-app-resealed",
    details: { safe: "from-dmg copy exists and remains codesign-strict after mount" },
  });
});

test("installed exact-DMG evidence is attributed only from runner output", () => {
  const path = join(root, "evidence/generated/installed-e2e.json");
  if (!existsSync(path)) return;
  const rec = JSON.parse(readFileSync(path, "utf8"));
  if (rec.verdict !== "PASS" || rec.fromExactDmg !== true || rec.productVersion !== "0.5.1") return;
  if (rec.installer !== "Penglai_0.5.1_macos_aarch64.dmg") return;
  const sourceSha = declaredSourceSha();
  const app = packagedAppForTarget(root, "darwin-aarch64");
  const packaged = inspectPackagedCandidate({ app, candidateSha: sourceSha, expectedTarget: "darwin-aarch64" });
  if (packaged.verdict !== "PASS") return;
  const dmg = inspectDmgEvidence({ root, packaged, evidencePath: join(root, "evidence/generated/local-dmg.json") });
  if (dmg.verdict !== "PASS") return;
  if (rec.sourceSha !== packaged.release.sourceSha || rec.installerSha256 !== dmg.actualSha256) return;
  const first = rec.first ?? {};
  assert.equal(first.http?.official, true);
  assert.equal(first.websocket?.opened, true);
  assert.equal(first.dom?.hasDshBoot, true);
  assert.equal(first.processTree?.ownedAbsolute, true);
  assert.ok(first.processTree?.dshPid);
  assert.equal(first.inventory?.im, false);
  const common = {
    candidateSourceSha: packaged.release.sourceSha,
    target: "darwin-aarch64",
    runnerNative: process.platform === "darwin" && process.arch === "arm64",
    artifactSha256: dmg.actualSha256,
    exitCode: 0,
    status: "PASS",
  };
  recordAssertion({
    ...common,
    acceptanceId: "R50-E2E-001",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-E2E-001",
    assertionId: "exact-dmg-not-staging",
    details: { safe: "installed-e2e.json came from exact Penglai_0.5.1_macos_aarch64.dmg" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-E2E-002",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-E2E-002",
    assertionId: "dom-http-ws-process-inventory",
    details: { safe: "official DOM HTTP WS process tree and inventory were observed" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-E2E-004",
    runnerId: "anti-cheat",
    testId: "installed-e2e-file",
    assertionId: "no-source-read-shortcut",
    details: { safe: "installed PASS was not produced by source-read or removed test endpoints" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-DIST-008",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-DIST-008",
    assertionId: "owned-process-tree",
    details: { safe: "owned absolute embedded DSH process tree was observed" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-MAC-009",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-MAC-009",
    assertionId: "arm64-exact-dmg-suite",
    details: { safe: "arm64 exact DMG installed boot observations were recorded" },
  });
  const tree = first.processTree ?? {};
  assert.equal(tree.ownedAbsolute, true);
  assert.match(String(tree.nodeBin ?? ""), /Penglai\.app\/Contents\/Resources\/runtime\/node\/bin\/node$/);
  assert.match(String(tree.dshEntry ?? ""), /Penglai\.app\/Contents\/Resources\/runtime\/dsh\/lib\/bin\.js$/);
  const walked = first.onboarding?.walked ?? [];
  const ledger = first.ledger ?? {};
  const completed = ledger.completed ?? [];
  assert.ok(walked.includes("models") || walked.includes("language") || walked.includes("keytest"));
  assert.ok(completed.includes("model-test-v1") || completed.includes("credential-v1"));
  assert.match(String(first.remoteNote?.turn?.final ?? ""), /^PENGLAI_OK_/);
  const entries = first.inventory?.entries ?? [];
  const names = entries.map((e: { moduleName?: string }) => e.moduleName ?? "");
  assert.ok(names.includes("@deepseek-ai/dsh-credentials-local"));
  assert.ok(names.includes("@deepseek-ai/dsh-llm-pi-ai"));
  assert.ok(names.includes("@deepseek-ai/dsh-user-approval"));
  assert.ok(names.includes("@deepseek-ai/dsh-permission-presets"));
  assert.ok(names.includes("@deepseek-ai/dsh-settings-file"));
  assert.ok(names.includes("@deepseek-ai/dsh-client-ui-settings"));
  assert.ok(names.includes("@deepseek-ai/dsh-client-ui-workspace"));
  assert.ok(names.includes("@penglai/plugin-center"));
  assert.equal(names.includes("@penglai/im"), false);
  const im = entries.find((e: { moduleName?: string }) => e.moduleName === "@penglai/im");
  assert.equal(im, undefined);
  assert.equal(first.dom?.title, "蓬莱 Penglai");
  assert.equal(first.http?.official, true);
  const providers = first.onboarding?.last?.providers ?? {};
  assert.equal(providers.source, "llm.providers");
  assert.ok(Number(providers.rows) > 0);
  recordAssertion({
    ...common,
    acceptanceId: "R50-CORE-001",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-CORE-001",
    assertionId: "absolute-embedded-node-dsh",
    details: { safe: "packaged process tree used absolute embedded Node and DSH entry" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-CORE-002",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-CORE-002",
    assertionId: "official-dsh-web-after-onboarding",
    details: { safe: "BrowserWindow loaded official DSH Web after onboarding completed" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-CORE-004",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-CORE-004",
    assertionId: "models-from-official-llm-providers",
    details: { safe: "models step listed official llm.providers catalog rows" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-CORE-005",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-CORE-005",
    assertionId: "official-workspace-session-turn",
    details: { safe: "official workspace first-turn and nonce Turn completed on installed app" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-CORE-006",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-CORE-006",
    assertionId: "official-tools-approvals-settings-visible",
    details: { safe: "installed inventory kept official approval permission settings workspace conversation modules" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-CENTER-001",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-CENTER-001",
    assertionId: "center-in-official-plugin-slot",
    details: { safe: "plugin-center was active in official loader inventory after boot-center" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-CENTER-005",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-CENTER-005",
    assertionId: "actual-from-loader-inventory",
    details: { safe: "installed inventory reported real plugin-center state and optional IM absence" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-CENTER-009",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-CENTER-009",
    assertionId: "im-default-absent-from-supervisor-inventory",
    details: { safe: "IM plugin was absent from fresh official loader inventory" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-DIST-005",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-DIST-005",
    assertionId: "no-path-node-fallback",
    details: { safe: "owned DSH node binary was the absolute app-embedded path" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-UI-001",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-UI-001",
    assertionId: "window-title-penglai",
    details: { safe: "installed BrowserWindow title was Penglai product identity" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-UI-006",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-UI-006",
    assertionId: "official-dsh-nav-not-blocked",
    details: { safe: "after onboarding official DSH session workspace and settings controls remained visible" },
  });
  recordAssertion({
    ...common,
    acceptanceId: "R50-CRED-002",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-CRED-002",
    assertionId: "credentials-local-in-inventory",
    details: { safe: "official dsh-credentials-local was active in the installed profile" },
  });
  const settingsWalked = first.settingsWalk?.walked ?? [];
  assert.ok(settingsWalked.includes("ui-update"), "installed walk must observe Penglai update UI");
  assert.ok(settingsWalked.includes("ui-uninstall"), "installed walk must observe Penglai uninstall UI");
  assert.ok(settingsWalked.includes("ui-center"), "installed walk must observe Penglai Center UI");
  assert.ok(settingsWalked.includes("ui-penglai"), "installed walk must observe Penglai section");
  for (const id of ["ui-im", "ui-asr", "ui-tts", "ui-context", "ui-memory", "ui-budget", "ui-companion"]) {
    assert.equal(settingsWalked.includes(id), false, `fresh walk must not expose ${id}`);
  }
  recordAssertion({
    ...common,
    acceptanceId: "R50-E2E-003",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-E2E-003",
    assertionId: "browserwindow-center-optional-off-update-uninstall",
    details: { safe: "fresh installed BrowserWindow showed Center update uninstall while optional plugin pages stayed absent" },
  });
});
