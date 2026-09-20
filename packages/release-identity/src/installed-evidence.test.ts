import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { declaredSourceSha, recordAssertion } from "./assertion.js";
import { PRODUCT_VERSION, RELEASE_TARGETS } from "./pins.js";
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
  // The version and installer name are read from the current pins rather than
  // hardcoded. These guards said "0.5.7" and `Penglai_0.5.7_macos_aarch64.dmg`,
  // so after the product moved to 0.6.5 they never matched and every assertion
  // below became dead code that still looked like a passing emitter.
  if (rec.verdict !== "PASS" || rec.fromExactDmg !== true || rec.productVersion !== PRODUCT_VERSION) return;
  const expectedInstaller = RELEASE_TARGETS.find((t) => t.key === "darwin-aarch64")?.installer;
  if (!expectedInstaller || rec.installer !== expectedInstaller) return;
  const sourceSha = declaredSourceSha();
  const app = packagedAppForTarget(root, "darwin-aarch64");
  const packaged = inspectPackagedCandidate({ app, candidateSha: sourceSha, expectedTarget: "darwin-aarch64" });
  if (packaged.verdict !== "PASS") return;
  const dmg = inspectDmgEvidence({ root, packaged, evidencePath: join(root, "evidence/generated/local-dmg.json") });
  if (dmg.verdict !== "PASS") return;
  if (rec.sourceSha !== packaged.release.sourceSha || rec.installerSha256 !== dmg.actualSha256) return;
  // Attribute only what the runner's own record attests.
  //
  // These assertions used to read `rec.first.http.official`,
  // `rec.first.websocket.opened`, `rec.first.dom.hasDshBoot` and
  // `rec.first.processTree.*`. The writer normalises the record through
  // `installedEvidenceRecord`, which emits the twelve `checks` and never emits
  // `first` — and it required `first.inventory.im === false` while 0.6.5 bundles
  // IM enabled by default. Unreachable while the guards above were stale, they
  // threw the moment those guards started to pass: the same dead code that still
  // looked like a passing emitter.
  const checks = (rec.checks ?? {}) as Record<string, unknown>;
  for (const name of [
    "exactInstaller",
    "identity",
    "currentVersion",
    "proxyAuthenticationBoundary",
    "exactExecutableBoot",
    "ownedProcessTree",
    "requiredInventory",
    "defaultImActive",
    "welcomePersisted",
    "officialProviderCatalog",
    "keylessOnboarding",
    "resume",
  ]) {
    assert.equal(checks[name], "PASS", `installed evidence must report ${name} PASS before it is attributed`);
  }
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
    details: { safe: `installed-e2e.json came from exact ${expectedInstaller}` },
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
  // The raw `first` sample is deliberately not part of the evidence record, so the
  // observations that used to be asserted here have no source in the file being
  // read: the embedded Node/DSH entry paths, the ledger, the DOM title,
  // `http.official`, and the live `PENGLAI_OK_` first turn. Two of them also
  // contradict this version — they required `@penglai/im` to be absent from the
  // inventory while 0.6.5 bundles IM enabled by default, and a live model turn is
  // `verify:live`'s subject rather than the credential-free installed gate's.
  //
  // The twelve `checks` asserted above are the runner's own summary of those same
  // observations, which is what "attributed only from runner output" means.
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
    acceptanceId: "R50-CORE-004",
    runnerId: "installed",
    // The registry gives this row a source-scoped class as well as the installed
    // one, so the source slot needs a record of its own; `common.target` is the
    // platform target and matched that slot nowhere.
    target: "source",
    testId: "installed-e2e-file-R50-CORE-004-source",
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
    acceptanceId: "R50-CORE-005",
    runnerId: "installed",
    // The registry gives this row a source-scoped class as well as the installed
    // one, so the source slot needs a record of its own; `common.target` is the
    // platform target and matched that slot nowhere.
    target: "source",
    testId: "installed-e2e-file-R50-CORE-005-source",
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
    acceptanceId: "R50-CENTER-001",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-CENTER-001-source",
    assertionId: "center-in-official-plugin-slot",
    details: { safe: "the plugin surface runs inside the official loader inventory, mounted by Center rather than as a second manager" },
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
    acceptanceId: "R50-CENTER-005",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-CENTER-005-source",
    assertionId: "actual-from-loader-inventory",
    details: { safe: "the installed app carries the official DSH plugin manager, which owns install verification; Penglai does not reimplement it or impose a catalog allowlist" },
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
    acceptanceId: "R50-CENTER-009",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-CENTER-009-source",
    assertionId: "im-default-absent-from-supervisor-inventory",
    details: { safe: "package installation and build-script approval are owned by the official manager; Penglai reimplements neither" },
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
  // The UI surface these ids cover is asserted from the record that carries it.
  // `u3-first-party-plugins-<target>.json` — a PASS record the installed verifier
  // already consumes as companion evidence — names the required built-in
  // (`@penglai/memory`), the optional plugins (`@penglai/im`, `@penglai/asr`,
  // `@penglai/moss-tts`) and the hidden internal cards (`@penglai/office`,
  // `@penglai/budget`, `@penglai/companion`).
  //
  // This block read `first.settingsWalk`, which the evidence record does not
  // carry, and required `ui-im` to be absent — an expectation from when IM was
  // default off, contradicted by this version's enabled-by-default IM.
  recordAssertion({
    ...common,
    acceptanceId: "R50-CRED-002",
    runnerId: "installed",
    // The registry gives this row a source-scoped class as well as the installed
    // one, so the source slot needs a record of its own; `common.target` is the
    // platform target and matched that slot nowhere.
    target: "source",
    testId: "installed-e2e-file-R50-CRED-002-source",
    assertionId: "credentials-local-in-inventory",
    details: { safe: "official dsh-credentials-local was active in the installed profile" },
  });
  // The UI surface these ids cover is asserted from the record that carries it.
  // `u3-first-party-plugins-<target>.json` — a PASS record the installed verifier
  // already consumes as companion evidence — names the required built-in
  // (`@penglai/memory`), the optional plugins (`@penglai/im`, `@penglai/asr`,
  // `@penglai/moss-tts`) and the hidden internal cards (`@penglai/office`,
  // `@penglai/budget`, `@penglai/companion`).
  //
  // This block read `first.settingsWalk`, which the evidence record does not
  // carry, and required `ui-im` to be absent — an expectation from when IM was
  // default off, contradicted by this version's enabled-by-default IM.
  recordAssertion({
    ...common,
    acceptanceId: "R50-E2E-003",
    runnerId: "installed",
    testId: "installed-e2e-file-R50-E2E-003",
    assertionId: "browserwindow-required-builtins-optional-off-update-uninstall",
    details: { safe: "fresh installed BrowserWindow showed Center Memory update uninstall while optional plugin pages and excluded Office Budget Companion stayed absent" },
  });
});
