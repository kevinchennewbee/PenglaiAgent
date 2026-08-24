import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assertSafeListenHost, PenglaiError } from "@penglai/contracts";
import { assertIpcName, navigationDecision, officialVendorConsoleDecision } from "./preload.js";
import { productionDebuggerForbidden } from "./production-flags.js";

test("R1-DESK-010 renderer has no node integration API surface", () => {
  assert.equal(assertIpcName("require"), false);
  assert.equal(assertIpcName("openDevTools"), false);
});

test("R1-DESK-006 inner bind is loopback only", () => {
  assert.throws(() => assertSafeListenHost("0.0.0.0"), PenglaiError);
});

test("official Feishu consoles may leave the app; everything else stays denied", () => {
  assert.equal(officialVendorConsoleDecision("https://open.feishu.cn/app"), "allow");
  assert.equal(officialVendorConsoleDecision("https://open.feishu.cn/document/develop-an-echo-bot/faq?lang=zh-CN"), "allow");
  assert.equal(officialVendorConsoleDecision("https://open.larksuite.com/app"), "allow");
  assert.equal(officialVendorConsoleDecision("https://open.feishu.cn.evil.example/app"), "deny");
  assert.equal(officialVendorConsoleDecision("http://open.feishu.cn/app"), "deny");
  assert.equal(officialVendorConsoleDecision("https://example.com/"), "deny");
  assert.equal(officialVendorConsoleDecision("https://user:pass@open.feishu.cn/app"), "deny");
});

test("navigation and window-open stay on the authenticated origin", () => {
  assert.equal(navigationDecision("http://127.0.0.1:9/", "http://127.0.0.1:9/"), "allow");
  assert.equal(navigationDecision("http://127.0.0.1.evil.example/", "http://127.0.0.1:9/"), "deny");
  assert.equal(navigationDecision("https://example.com/", "http://127.0.0.1:9/"), "deny");
  assert.equal(navigationDecision("file:///tmp/x", "http://127.0.0.1:9/"), "deny");
  assert.equal(
    navigationDecision("file:///app/static/index.html", "http://127.0.0.1:9/", "file:///app/static/index.html"),
    "allow",
  );
  assert.equal(
    navigationDecision("file:///tmp/evil.html", "http://127.0.0.1:9/", "file:///app/static/index.html"),
    "deny",
  );
});

test("renderer lifecycle surface has no arbitrary installer URL path or delete path primitive", () => {
  const preload = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");
  const main = readFileSync(new URL("./electron-main.ts", import.meta.url), "utf8");
  const center = readFileSync(new URL("../../../packages/plugin-center/src/dsh-client.js", import.meta.url), "utf8");
  for (const forbidden of ["openPath", "openUrl", "deletePath", "setUpdateFeed", "runCommand"]) {
    assert.doesNotMatch(preload, new RegExp(`\\"${forbidden}\\"`));
  }
  assert.match(main, /parseDeletionPrepareRequest/);
  assert.match(main, /dialog\.showMessageBox/);
  assert.match(main, /native owner confirmation is required for deletion/);
  assert.match(main, /confirmPluginAction/);
  assert.match(main, /requestOwnerApprovalArgs/);
  assert.match(main, /beginMicrophoneRequest/);
  assert.match(main, /allowMicrophoneMedia/);
  assert.match(main, /issuePluginOwnerGrant/);
  assert.match(main, /buildDeletionPlan\(\{/);
  assert.match(main, /operationId: `del_/);
  assert.match(main, /writeWindowsDeletionCapability/);
  assert.match(main, /deletionInspectionOptionsForPlatform/);
  assert.match(main, /ensurePrivateHome\(user, layout\.appRoot\)/);
  assert.match(main, /deletionInspectionOptionsForPlatform\(platform, \{ appRoot: layout\.appRoot \}\)/);
  assert.ok(main.indexOf("const layout = layoutFromResources(resources)") < main.indexOf("ensurePrivateHome(user, layout.appRoot)"));
  assert.doesNotMatch(center, /openVerifiedInstaller|planUninstall|__PENGLAI_VERIFIED_INSTALL_OPERATION/);
  assert.match(center, /DELETE PENGLAI DATA/);
  assert.match(center, /confirmPluginAction/);
});

test("Context folder selection returns an opaque capability instead of a renderer path primitive", () => {
  const preload = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");
  const main = readFileSync(new URL("./electron-main.ts", import.meta.url), "utf8");
  const capability = readFileSync(new URL("./context-grant.ts", import.meta.url), "utf8");
  assert.match(preload, /"pickContextFolder"/);
  assert.match(main, /createContextGrantReceipt\(user\.root, picked\.filePaths\[0\]\)/);
  assert.match(capability, /ctxpick_/);
  assert.match(capability, /mode: 0o600/);
  assert.doesNotMatch(preload, /readContextPath|indexDirectory/);
});

test("P51-DESKTOP-002 packaged production refuses remote debugging switches", () => {
  const previous = process.env.PENGLAI_ALLOW_TEST_HARNESS;
  process.env.PENGLAI_ALLOW_TEST_HARNESS = "1";
  try {
    assert.equal(productionDebuggerForbidden(["--remote-debugging-port=9222"], true), true);
    assert.equal(productionDebuggerForbidden(["--inspect"], true), true);
    assert.equal(productionDebuggerForbidden(["--remote-debugging-port=9222"], false), false);
  } finally {
    if (previous === undefined) delete process.env.PENGLAI_ALLOW_TEST_HARNESS;
    else process.env.PENGLAI_ALLOW_TEST_HARNESS = previous;
  }
  const main = readFileSync(new URL("./electron-main.ts", import.meta.url), "utf8");
  assert.doesNotMatch(main, /PENGLAI_ALLOW_TEST_HARNESS/);
  assert.match(main, /const packaged = app\.isPackaged;/);
});
