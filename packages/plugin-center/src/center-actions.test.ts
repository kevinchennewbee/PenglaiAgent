import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PenglaiImHost } from "../../im/src/host.js";
import { createRuntime } from "../../im/src/index.js";
import { CredentialsServiceVault } from "../../im/src/credentials-vault.js";

test("beginWeixinQr returns qrImageRef and production pack scripts require --target", async () => {
  const rt = createRuntime({
    dbPath: ":memory:",
    host: { version: "0.1.1-rc.2", getAgent: () => undefined, listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }] },
  });
  const weixin = {
    startQr: async () => ({ qrRef: "qr-1", qrImageRef: "data:image/png;base64,abc" }),
    poll: async () => "wait",
    health: () => ({ authState: "waiting" as const, hasCredential: false }),
    stopReceive: () => undefined,
    logout: async () => undefined,
  };
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    weixin as never,
    { status: "idle", stop() {}, appId: "" } as never,
    new CredentialsServiceVault(undefined),
    { running: false, start: async () => undefined, stop: () => undefined } as never,
    { version: "0.1.1-rc.2", getAgent: () => undefined, listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }] },
  );
  const begun = await host.beginWeixinQr();
  assert.ok(begun.qrImageRef);
  rt.store.close();

  const pack = readFileSync(new URL("../../../scripts/package-mac.mjs", import.meta.url), "utf8");
  const dmg = readFileSync(new URL("../../../scripts/build-local-dmg.mjs", import.meta.url), "utf8");
  assert.match(pack, /--target/);
  assert.match(dmg, /--target/);
  assert.match(pack, /darwin-x64/);
  assert.match(pack, /community release/);
  assert.doesNotMatch(pack, /This is not a public release/);
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(client, /run\("checkForUpdate"\)/);
  assert.match(client, /desktopCall\("prepareDataDeletion"/);
  assert.match(client, /desktopCall\("executeDataDeletion"/);
  assert.doesNotMatch(client, /openVerifiedInstaller/);
  assert.doesNotMatch(client, /planUninstall/);
  assert.doesNotMatch(client, /__PENGLAI_VERIFIED_INSTALLER\b/);
  assert.doesNotMatch(client, /__PENGLAI_USER_DATA\b/);
  assert.doesNotMatch(client, /__PENGLAI_VERIFIED_INSTALL_OPERATION/);
  assert.match(client, /data-penglai-update-confirm[\s\S]*onClick/);
  assert.doesNotMatch(client, /document\.body\.appendChild\(node\)/);
  assert.doesNotMatch(client, /appRoot\.inert\s*=\s*true/);
  assert.doesNotMatch(client, /data-penglai-onboarding/);
  assert.match(client, /data-penglai-center": "1"/);
  assert.match(client, /installEnable/);
});
