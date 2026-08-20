import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import {
  assertNoOpenCriticalHigh,
  classifyStartupFault,
  exportDiagnosticsPreview,
  nextReconnectAllowed,
  persistAppearance,
  qrMustClear,
  QUEUE_BUDGETS,
  A11Y_CONTRACT,
  readAppearance,
  resourceSnapshot,
  STARTUP_BUDGETS,
} from "./leftover.js";
import { applyUpdateOutcome, replayUpdateCrash, VerifiedInstallerHandoff } from "./update.js";
import { defaultUninstallPlan, executeDeletionPlan, buildDeletionPlan } from "./uninstall.js";

test("R50-REL-002 startup faults classify", () => {
  assert.equal(classifyStartupFault(new Error("EADDRINUSE")), "port");
  assert.equal(classifyStartupFault(new Error("SQLITE_BUSY")), "db-busy");
  assert.equal(classifyStartupFault(new Error("database file is malformed")), "corrupt");
  assert.equal(classifyStartupFault(new Error("ENOSPC")), "disk-full");
  assert.equal(classifyStartupFault(new Error("clock skew")), "clock");
});

test("R50-REL-003 reconnect budget refuses storms", () => {
  const now = 10_000;
  const stamps = [9000, 9200, 9400, 9600, 9800, 9900];
  assert.equal(nextReconnectAllowed(stamps, now), false);
  assert.equal(nextReconnectAllowed([1000], now), true);
});

test("R50-REL-005 QR challenge expires", () => {
  assert.equal(qrMustClear(5, 5), true);
  assert.equal(qrMustClear(9, 5), false);
});

test("R50-UI-003/004/005 appearance persists locale and theme", () => {
  const file = join(mkdtempSync(join(tmpdir(), "penglai-app-")), "settings.yaml");
  persistAppearance(file, "en", "dark");
  assert.deepEqual(readAppearance(file), { locale: "en", theme: "dark" });
  persistAppearance(file, "zh", "system");
  assert.deepEqual(readAppearance(file), { locale: "zh", theme: "system" });
});

test("R50-SEC-011/012 diagnostics preview and no open Critical", () => {
  assert.throws(() => assertNoOpenCriticalHigh(), /register is empty/);
  assertNoOpenCriticalHigh([
    { id: "R50-ONB-006", severity: "High", status: "closed" },
    { id: "R50-BUDGET-003", severity: "Critical", status: "closed" },
  ]);
  const out = exportDiagnosticsPreview({ status: "ok", path: "Penglai/0.5" });
  assert.equal(out.redacted, true);
  assert.throws(() => exportDiagnosticsPreview({ home: "/Users/owner/secret" }), PenglaiError);
});

test("R50-REL-008/009 budgets are finite", () => {
  assert.ok(STARTUP_BUDGETS.coldMs <= 15_000);
  assert.ok(QUEUE_BUDGETS.maxDepth <= 32);
});

test("R50-REL-006/007 a11y contract covers live region, QR alt, contrast, and zoom", () => {
  assert.equal(A11Y_CONTRACT.liveRegion, true);
  assert.equal(A11Y_CONTRACT.qrHasAlt, true);
  assert.ok(A11Y_CONTRACT.contrastMin >= 4.5);
  assert.equal(A11Y_CONTRACT.zoomMaxPct, 200);
  assert.equal(A11Y_CONTRACT.reducedMotion, true);
});

test("R50-UPD-008/009/010 verified installer and crash replay", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-update-handoff-"));
  const path = join(root, "Penglai_0.5.1_macos_aarch64.dmg");
  const payload = Buffer.from("signed-installer");
  writeFileSync(path, payload);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyHex = Buffer.from(publicKey.export({ type: "spki", format: "der" }).subarray(-32)).toString("hex");
  const signature = sign(null, payload, privateKey);
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const handoff = new VerifiedInstallerHandoff(root, publicKeyHex);
  handoff.register({ operationId: "operation-1", path, sha256, size: payload.length, signature });
  assert.throws(() => handoff.open("operation-1", { silent: true }), /silent/);
  assert.deepEqual(handoff.open("operation-1", { open: () => undefined }), {
    opened: true,
    silent: false,
    kind: "dmg",
    operationId: "operation-1",
  });
  assert.throws(() => handoff.open("operation-1", { open: () => undefined }), /consumed/);
  assert.equal(applyUpdateOutcome("HANDOFF_TO_INSTALLER", true), "COMMITTED");
  assert.equal(applyUpdateOutcome("HANDOFF_TO_INSTALLER", false), "ROLLED_BACK");
  assert.equal(replayUpdateCrash("DOWNLOADING"), "DOWNLOADING");
  assert.equal(replayUpdateCrash("VERIFYING"), "VERIFYING");
});

test("R50-UN-004 default uninstall preserves user data", () => {
  const plan = defaultUninstallPlan("/Applications/Penglai.app", "/tmp/Penglai/update-cache");
  assert.equal(plan.preserveUserData, true);
  assert.deepEqual(plan.categories, ["app", "update-cache"]);
  assert.equal(plan.paths.some((p) => p.includes("0.5") && p.endsWith("0.5")), false);
});

test("R50-UN-010 complete delete then empty generation stays under userData", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-un-"));
  writeFileSync(join(root, "keep.txt"), "x");
  const cache = join(root, "cache");
  mkdirSync(cache);
  writeFileSync(join(cache, "a"), "1");
  const plan = buildDeletionPlan({
    operationId: "complete",
    categories: ["cache"],
    userData: root,
    confirmCredentials: false,
  });
  const out = executeDeletionPlan(plan, root, [], []);
  assert.equal(out.deleted.length, 1);
  assert.equal(existsSync(join(root, "keep.txt")), true);
});

test("R50-IM-012 resource snapshot is zero after stop", () => {
  const snap = resourceSnapshot({ running: false, timers: 0, sockets: 0, dbOpen: false });
  assert.equal(snap.zero, true);
});

test("R50-UPD: download verifies size/hash/signature and crash mid-download returns IDLE", async () => {
  const { createHash, generateKeyPairSync, sign } = await import("node:crypto");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { downloadVerifiedPayload, crashSafeUpdate, drainOwnedServices } = await import("./update-flow.js");
  const payload = Buffer.from("penglai-next-installer");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPub = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const sha = createHash("sha256").update(payload).digest("hex");
  const sig = sign(null, payload, privateKey);
  const dest = mkdtempSync(join(tmpdir(), "penglai-upd-dl-"));
  const out = await downloadVerifiedPayload({
    url: "https://example.invalid/Penglai_0.5.1_macos_aarch64.dmg",
    destDir: dest,
    expectedSha256: sha,
    expectedSize: payload.length,
    signature: sig,
    publicKeyHex: Buffer.from(rawPub).toString("hex"),
    fetchImpl: async () =>
      new Response(payload, { status: 200, headers: { "content-type": "application/octet-stream" } }),
  });
  assert.equal(readFileSync(out.path).equals(payload), true);
  assert.equal(crashSafeUpdate({ operationId: "u1", state: "DOWNLOADING", drained: false }), "IDLE");
  assert.throws(() => drainOwnedServices({ dshRunning: true, asrBusy: false, ttsBusy: false, indexerBusy: false, companionArmed: false }), /busy/);
});

test("R50-DIST: packaged identity is Penglai 0.5.0 and Windows NSIS stays current-user", async () => {
  const {
    assertPenglaiAppIdentity,
    assertWindowsNsisContract,
    parseInfoPlistIdentity,
    rewriteElectronPlist,
    WINDOWS_NSIS_CONTRACT,
    assertWindowsNsisScript,
  } = await import("./packaging.js");
  const rewritten = rewriteElectronPlist(`
    <key>CFBundleExecutable</key><string>Electron</string>
    <key>CFBundleShortVersionString</key><string>43.4.0</string>
    <key>CFBundleVersion</key><string>43.4.0</string>
    <key>CFBundleIdentifier</key><string>com.github.Electron</string>
    <key>CFBundleName</key><string>Electron</string>
    <key>CFBundleDisplayName</key><string>Electron</string>
    <key>CFBundleIconFile</key><string>electron.icns</string>
    <key>LSMinimumSystemVersion</key><string>14.0</string>
  `);
  const facts = parseInfoPlistIdentity(rewritten);
  assertPenglaiAppIdentity(facts);
  assert.equal(facts.executable, "Penglai");
  assert.equal(facts.shortVersion, "0.5.0");
  assert.match(rewritten, /penglai\.icns/);
  assert.match(rewritten, /<string>13\.0<\/string>/);
  assertWindowsNsisContract({
    currentUser: true,
    languages: [...WINDOWS_NSIS_CONTRACT.bilingual],
    refuseDowngrade: true,
    preserveUserDataDefault: true,
    upgradeCode: WINDOWS_NSIS_CONTRACT.upgradeCode,
  });
  assertWindowsNsisScript(readFileSync(new URL("../../../scripts/nsis/Penglai.nsi", import.meta.url), "utf8"));
});

test("R50-SEC: Windows Job/ACL contract refuses POSIX impersonation", async () => {
  const { applyWindowsCredentialAcl, assertWindowsJobHonest, refusePosixModeAsWindowsAcl, windowsJobObjectPlan } =
    await import("./windows-host.js");
  assert.deepEqual(windowsJobObjectPlan(), {
    killOnJobClose: true,
    breakawayOk: false,
    assignSpawnedChildren: true,
    createSuspendedThenAssign: true,
  });
  assertWindowsJobHonest(windowsJobObjectPlan());
  assert.throws(() => assertWindowsJobHonest({ killOnJobClose: false, breakawayOk: false, assignSpawnedChildren: true, createSuspendedThenAssign: true }), /kill on close/);
  assert.throws(() => refusePosixModeAsWindowsAcl("posix-mode"), /POSIX mode cannot impersonate/);
  assert.throws(
    () => applyWindowsCredentialAcl([{ id: "Everyone", allow: true }]),
    /must not allow Everyone/,
  );
  assert.deepEqual(applyWindowsCredentialAcl([{ id: "current-user", allow: true }]).applied, false);
});
