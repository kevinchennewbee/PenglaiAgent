import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { inspectStorageInventory, previewDeletionPlan, buildDeletionPlan } from "./uninstall.js";
import {
  applyWindowsCredentialAcl,
  assertWindowsJobHonest,
  deletionInspectionOptionsForPlatform,
  parseWindowsHostReport,
  quoteWindowsCommandArg,
  readOwnedWindowsJobReport,
  refusePosixModeAsWindowsAcl,
  requireWindowsNativeHost,
  resolveWindowsHostExecutable,
  spawnOwnedDshProcess,
  windowsJobObjectPlan,
  windowsNativeHostContract,
  windowsNativeHostSourceFacts,
  windowsNativeHostStatus,
} from "./windows-host.js";
import { assertWindowsNsisScript, WINDOWS_NSIS_CONTRACT } from "./packaging.js";

test("Windows Job Object contract requires suspended-create, kill-on-close, and no breakaway", () => {
  const plan = windowsJobObjectPlan();
  assert.deepEqual(plan, {
    killOnJobClose: true,
    breakawayOk: false,
    assignSpawnedChildren: true,
    createSuspendedThenAssign: true,
  });
  assertWindowsJobHonest(plan);
  assert.throws(
    () => assertWindowsJobHonest({ killOnJobClose: true, breakawayOk: false, assignSpawnedChildren: true }),
    /suspended/,
  );
  assert.throws(
    () => assertWindowsJobHonest({ ...plan, breakawayOk: true }),
    /breakaway/,
  );
});

test("Windows ACL apply is never applied=true without a native host path", () => {
  assert.throws(() => refusePosixModeAsWindowsAcl("posix-mode"), /POSIX mode cannot impersonate/);
  assert.throws(() => applyWindowsCredentialAcl([{ id: "Everyone", allow: true }]), /must not allow Everyone/);
  const planned = applyWindowsCredentialAcl([{ id: "current-user", allow: true }]);
  assert.equal(planned.applied, false);
  assert.equal(planned.reason, "plan-only");
  assert.throws(
    () => applyWindowsCredentialAcl("/tmp/penglai-credentials", { platform: "darwin" }),
    /POSIX mode cannot impersonate/,
  );
  assert.throws(
    () => applyWindowsCredentialAcl("C:\\Users\\owner\\Penglai\\0.5\\.credentials.yaml", { platform: "win32" }),
    /native Windows host/,
  );
});

test("native Windows host source encodes Job Object, ACL, and reparse facts", () => {
  const facts = windowsNativeHostSourceFacts();
  assert.equal(facts.present, true);
  assert.equal(facts.createJobObject, true);
  assert.equal(facts.killOnJobClose, true);
  assert.equal(facts.createSuspended, true);
  assert.equal(facts.assignProcess, true);
  assert.equal(facts.resumeThread, true);
  assert.equal(facts.forbidsBreakaway, true);
  assert.equal(facts.namedSecurityInfo, true);
  assert.equal(facts.reparseAttribute, true);
  assert.equal(facts.jobSupervise, true);
  assert.equal(facts.deletePlan, true);
  assert.equal(facts.processSuspendResume, true);
  assert.equal(facts.processReapSupervisors, true);
  assert.equal(facts.pathBatchProbe, true);
  assert.equal(facts.childExitMonitoring, true);
  assert.equal(facts.ownerStopMonitoring, true);
  assert.match(facts.source, /penglai_windows_host\.c$/);
  const src = readFileSync(facts.source, "utf8");
  assert.doesNotMatch(src, /applied:\s*true/);
  assert.match(src, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(src, /CREATE_SUSPENDED/);
  assert.match(src, /FILE_ATTRIBUTE_REPARSE_POINT/);
  assert.match(src, /WaitForMultipleObjects\(wait_count, waits, FALSE, INFINITE\)/);
  assert.match(src, /waits\[0\] = pi\.hProcess/);
  assert.match(src, /CreateThread\(NULL, 0, wait_for_owner_stop/);
  assert.match(src, /SetEntriesInAclW\(3,/);
  assert.match(src, /GetTokenInformation\(token, TokenOwner/);
  assert.match(src, /EqualSid\(existing_owner, user->User\.Sid\)/);
  assert.match(src, /EqualSid\(existing_owner, token_owner->Owner\)/);
  assert.match(src, /cmd_path_batch_probe\(const char \*root_utf8\)[\s\S]*FILE \*file = stdin/);
  assert.doesNotMatch(src, /path-batch-probe[\s\S]{0,300}opt\(argc, argv, "--file"\)/);
  assert.match(
    src,
    /SetNamedSecurityInfoW\(\(LPWSTR\)path, SE_FILE_OBJECT,\s*DACL_SECURITY_INFORMATION \| PROTECTED_DACL_SECURITY_INFORMATION,\s*NULL, NULL, dacl, NULL\)/,
  );
  assert.doesNotMatch(src, /grfAccessMode\s*=\s*DENY_ACCESS/);
});

test("Windows native host is unavailable on this runner and fail-closed", () => {
  const status = windowsNativeHostStatus("darwin");
  assert.equal(status.required, false);
  assert.equal(status.available, false);
  const win = windowsNativeHostStatus("win32");
  assert.equal(win.required, true);
  assert.equal(win.available, Boolean(resolveWindowsHostExecutable()));
  assert.throws(() => requireWindowsNativeHost("darwin"), /not a Windows host/);
  if (process.platform !== "win32") {
    assert.throws(() => requireWindowsNativeHost("win32"), /native Windows host/);
  }
});

test("installed Windows helper resolves only through the exact packaged app root", () => {
  const appRoot = mkdtempSync(join(tmpdir(), "penglai-win-app-root-"));
  const helper = join(appRoot, "runtime", "helpers", "penglai-windows-host.exe");
  mkdirSync(join(appRoot, "runtime", "helpers"), { recursive: true });
  writeFileSync(helper, "fixture");
  assert.equal(resolveWindowsHostExecutable(appRoot), helper);
  assert.equal(requireWindowsNativeHost("win32", appRoot), helper);
  const inspection = deletionInspectionOptionsForPlatform("win32", { appRoot });
  assert.equal(inspection.platform, "win32");
  assert.equal(typeof inspection.ownerProbe, "function");
  assert.equal(typeof inspection.reparseProbe, "function");
  assert.equal(typeof inspection.batchTreeProbe, "function");
});

test("Windows deletion inspection refuses missing owner and reparse probes", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-win-del-"));
  const plan = buildDeletionPlan({
    operationId: "win-probes",
    categories: ["cache"],
    userData: root,
    confirmCredentials: false,
  });
  assert.throws(
    () => previewDeletionPlan(plan, root, [], [], { platform: "win32" }),
    /native owner and reparse-point probes/,
  );
  assert.throws(() => deletionInspectionOptionsForPlatform("win32"), /native owner and reparse-point probes/);
  mkdirSync(join(root, "cache"), { recursive: true });
  writeFileSync(join(root, "cache", "one.txt"), "one");
  const injected = deletionInspectionOptionsForPlatform("win32", {
    available: true,
    ownerProbe: () => "sid:S-1-5-21-fixture",
    reparseProbe: () => false,
  });
  const preview = previewDeletionPlan(plan, root, [], [], injected);
  assert.equal(preview.targets[0]?.owner, "sid:S-1-5-21-fixture");
  assert.throws(
    () =>
      previewDeletionPlan(plan, root, [], [], {
        platform: "win32",
        ownerProbe: () => "sid:S-1-5-21-fixture",
        reparseProbe: () => true,
      }),
    /reparse/,
  );
});

test("batch tree inspection verifies a complete target with one probe", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-win-batch-"));
  const cache = join(root, "cache");
  mkdirSync(join(cache, "nested"), { recursive: true });
  writeFileSync(join(cache, "nested", "one.txt"), "one");
  const plan = buildDeletionPlan({
    operationId: "win-batch",
    categories: ["cache"],
    userData: root,
    confirmCredentials: false,
  });
  const calls: string[][] = [];
  const preview = previewDeletionPlan(plan, root, [], [], {
    platform: "win32",
    ownerProbe: () => "sid:unused",
    reparseProbe: () => {
      throw new Error("per-path reparse probe must not run");
    },
    batchTreeProbe: (target, paths) => {
      assert.equal(target, cache);
      calls.push([...paths]);
      return "sid:S-1-5-21-batch";
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.length, 3);
  assert.equal(calls[0]?.[0], cache);
  assert.equal(preview.targets[0]?.owner, "sid:S-1-5-21-batch");
});

test("owned DSH spawn on Windows requires the native job supervisor", () => {
  assert.throws(
    () =>
      spawnOwnedDshProcess({
        platform: "win32",
        executable: "C:\\Penglai\\runtime\\node\\node.exe",
        entry: "C:\\Penglai\\runtime\\dsh\\lib\\bin.js",
        args: ["--profile", "web"],
        env: {},
        port: 9,
      }),
    /native Windows host/,
  );
  const report = parseWindowsHostReport(
    JSON.stringify({
      ok: true,
      command: "job-supervise",
      pid: 4242,
      startMs: 1_700_000_000_000,
      owner: "sid:S-1-5-21-owner",
      jobAssigned: true,
      killOnJobClose: true,
      breakawayOk: false,
      childExitMonitored: true,
      ownerStopMonitored: true,
    }),
  );
  assert.equal(report.pid, 4242);
  assert.equal(report.jobAssigned, true);
  assert.equal(report.killOnJobClose, true);
  assert.equal(report.childExitMonitored, true);
  assert.equal(report.ownerStopMonitored, true);
  assert.throws(() => parseWindowsHostReport(JSON.stringify({ ok: true, pid: 1, breakawayOk: true })), /breakaway/);
  assert.throws(() => parseWindowsHostReport(JSON.stringify({ ok: false, error: "reparse" })), /reparse/);
});

test("Windows supervisor handshake refuses helpers that cannot observe both lifetimes", async () => {
  const report = (extra: Record<string, boolean>) => JSON.stringify({
    ok: true,
    command: "job-supervise",
    pid: 4242,
    startMs: 1_700_000_000_000,
    owner: "sid:S-1-5-21-owner",
    jobAssigned: true,
    killOnJobClose: true,
    breakawayOk: false,
    ...extra,
  });
  const launch = (line: string) => spawn(
    process.execPath,
    ["-e", `process.stdout.write(${JSON.stringify(`${line}\n`)}); setTimeout(() => {}, 1000)`],
    { stdio: ["ignore", "pipe", "ignore"] },
  );

  const legacy = launch(report({}));
  await assert.rejects(readOwnedWindowsJobReport(legacy, 1000), /report incomplete/);
  legacy.kill();

  const current = launch(report({ childExitMonitored: true, ownerStopMonitored: true }));
  try {
    const accepted = await readOwnedWindowsJobReport(current, 1000);
    assert.equal(accepted.childExitMonitored, true);
    assert.equal(accepted.ownerStopMonitored, true);
  } finally {
    current.kill();
  }
});

test("Windows CreateProcess arguments preserve quotes and trailing backslashes", () => {
  assert.equal(quoteWindowsCommandArg("C:\\Program Files\\Penglai\\"), '"C:\\Program Files\\Penglai\\\\"');
  assert.equal(quoteWindowsCommandArg('a"b'), '"a\\"b"');
  assert.equal(quoteWindowsCommandArg(""), '""');
});

test("NSIS script default-preserves user data and only deletes via capability handoff", () => {
  const script = readFileSync(new URL("../../../scripts/nsis/Penglai.nsi", import.meta.url), "utf8");
  assertWindowsNsisScript(script);
  assert.match(script, /RequestExecutionLevel\s+user/);
  assert.match(script, /SimpChinese/);
  assert.match(script, /English/);
  assert.match(script, new RegExp(WINDOWS_NSIS_CONTRACT.upgradeCode));
  assert.match(script, /penglai-windows-host\.exe/);
  assert.match(script, /deletion-capability\.json/);
  assert.doesNotMatch(script, /RMDir\s+\/r\s+"\$LOCALAPPDATA\\Penglai\\0\.5"/);
  assert.match(script, /SectionUninstall/);
  // Numeric downgrade comparison (not lexicographic) and an explicitly
  // optional desktop shortcut with matching uninstall cleanup.
  assert.match(script, /\$\{VersionCompare\}/);
  assert.doesNotMatch(script, /\$\{If\}\s+\$0\s+S>\s*"\$\{PENGLAI_VERSION\}"/);
  assert.match(script, /Section\s+\/o\s+"\$\(NAME_Desktop\)"/);
  assert.match(script, /LangString\s+NAME_Desktop\s+\$\{LANG_SIMPCHINESE\}\s+"桌面快捷方式"/);
  assert.match(script, /\$\{GetOptions\}\s+"\$R9"\s+"\/LANG="/);
  assert.match(script, /CreateShortCut\s+"\$DESKTOP\\Penglai\.lnk"/);
  assert.match(script, /Delete\s+"\$DESKTOP\\Penglai\.lnk"/);
  // The recursive app-tree delete must be guarded to the default install dir.
  assert.match(script, /RMDir\s+\/r\s+"\$INSTDIR"\s*\n\s*\$\{Else\}/);
  const contract = windowsNativeHostContract();
  assert.equal(contract.posixModeImpersonation, false);
  const payload = readFileSync(new URL("../../../scripts/package-windows-payload.mjs", import.meta.url), "utf8");
  const packager = readFileSync(new URL("../../../scripts/package-windows-nsis.mjs", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../../../.github/workflows/native-release-candidate.yml", import.meta.url), "utf8");
  const windowsWorkflow = workflow.slice(workflow.indexOf("\n  windows:"));
  const uiProof = readFileSync(new URL("../../../scripts/windows-installer-ui-proof.ps1", import.meta.url), "utf8");
  assert.match(packager, /"\/INPUTCHARSET",\s*\n\s*"UTF8"/);
  assert.match(uiProof, /'\/LANG=2052'/);
  assert.match(uiProof, /桌面快捷方式/);
  assert.match(uiProof, /\[System\.Text\.UTF8Encoding\]::new\(\$false, \$true\)/);
  assert.match(uiProof, /strict-utf8-nsis-source-plus-native-screenshot/);
  assert.match(uiProof, /windows-installer-components-zh\.png/);
  assert.match(uiProof, /UIAutomationClient/);
  assert.match(payload, /public-export\.json/);
  assert.match(payload, /release-info\.json/);
  assert.match(payload, /stamp-windows-exe\.mjs/);
  assert.match(payload, /writeRequiredFuses\(penglaiExe\)/);
  assert.match(payload, /cpSync\(join\(staging, "mnemon"\), join\(resources, "mnemon"\)/);
  assert.match(payload, /payload is missing the pinned Mnemon binary or license/);
  assert.match(windowsWorkflow, /- name: Source and onboarding regression gates\s+shell: bash\s+run: \|/);
  assert.match(payload, /Penglai\.ico/);
  assert.match(payload, /stagingForTarget\(ROOT, "win32-x86_64"\)/);
  assert.match(packager, /stagingForTarget\(ROOT, "win32-x86_64"\)/);
  assert.doesNotMatch(payload, /const staging = join\(ROOT, "dist", "runtime-staging-win32-x86_64"\)/);
  assert.doesNotMatch(packager, /const staging = join\(ROOT, "dist", "runtime-staging-win32-x86_64"\)/);
  assert.match(packager, /local-installer-win32-x86_64\.json/);
  assert.match(packager, /\/DPENGLAI_ICON=/);
  assert.match(script, /!define MUI_ICON "\$\{PENGLAI_ICON\}"/);
  assert.match(packager, /exact Setup did not reinstall/);
});

test("Windows inventory helper is not implied by a darwin inspect", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-win-inv-"));
  mkdirSync(join(root, "cache"), { recursive: true });
  writeFileSync(join(root, "cache", "a"), "1");
  const inventory = inspectStorageInventory({ userData: root, cacheRoot: join(root, "cache") }, [], [], { platform: "darwin" });
  assert.equal(inventory.categories.length, 13);
  assert.equal(resolve(inventory.categories.find((row) => row.category === "cache")?.targets[0]?.path ?? ""), resolve(join(root, "cache")));
});
