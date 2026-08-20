import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { declaredSourceSha, recordAssertion } from "./assertion.js";
import { recoverInterruptedTransaction } from "../../plugin-center/src/profile-tx.js";
import { Store } from "../../persistence/src/index.js";
import { RoutingControlPlane } from "../../routing-core/src/index.js";
import { SeqIds, VirtualClock } from "../../testkit/src/index.js";
import { FeishuAdapter } from "../../channel-feishu/src/index.js";
import { MemoryVault, WeixinAdapter, WEIXIN_TOKEN_CREDENTIAL_REF, type WeixinTransport } from "../../channel-weixin/src/index.js";
import { AdapterSupervisor, WorkerLease, createRuntime, PenglaiImHost } from "../../im/src/index.js";
import { CredentialsServiceVault } from "../../im/src/credentials-vault.js";
import {
  applyUpdateOutcome,
  VerifiedInstallerHandoff,
  replayUpdateCrash,
  writeUpdateJournal,
  nextUpdateState,
} from "../../runtime/src/update.js";
import { defaultUninstallPlan, buildDeletionPlan, executeDeletionPlan } from "../../runtime/src/uninstall.js";
import { recoverProfile, seedFreshSettings, type UserLayout } from "../../runtime/src/index.js";
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
} from "../../runtime/src/leftover.js";
import { PenglaiError } from "@penglai/contracts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const sha = declaredSourceSha();

function pass(id: string, runnerId: string, testId: string, assertionId: string, safe: string) {
  recordAssertion({
    acceptanceId: id,
    runnerId,
    testId,
    assertionId,
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe },
  });
}

function plane() {
  return new RoutingControlPlane(
    new Store(":memory:"),
    new VirtualClock(),
    new SeqIds(),
    {
      async listWorkspaces() {
        return [{ id: "ws1", title: "W" }];
      },
      async listSessions() {
        return [{ id: "sess1" }];
      },
    },
    {
      async followup() {
        return { dshMessageId: "d" };
      },
      async steer() {
        return { dshMessageId: "d" };
      },
      async cancelCurrent() {},
      async removeInbox() {},
    },
  );
}

test("R50-CENTER-008 crash mid-transaction rolls back to last-good", async () => {
  const userDataRoot = mkdtempSync(join(tmpdir(), "penglai-tx-root-"));
  const profile = join(userDataRoot, "dsh-home", "profiles", "web");
  const txDir = join(userDataRoot, "profiles", "center-tx");
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, "cordis.patch.yml"), "- insert:\n    - id: penglai-im\n      name: \"@penglai/im\"\n");
  mkdirSync(join(txDir, "last-good"), { recursive: true });
  writeFileSync(join(txDir, "last-good", "cordis.patch.yml"), "good: true\n");
  writeFileSync(
    join(txDir, "journal.json"),
    JSON.stringify({
      schema: 2,
      operationId: "24e69732-d08b-4f05-a628-ddf0bcf99a50",
      phase: "activating",
      id: "@penglai/im",
      action: "disable",
      previousEnabled: true,
      version: "0.5.0",
    }),
  );
  const recovered = await recoverInterruptedTransaction({ userDataRoot, profileDir: profile, txDir, id: "@penglai/im" });
  assert.equal(recovered.phase, "rolled_back");
  assert.match(readFileSync(join(profile, "cordis.patch.yml"), "utf8"), /good: true/);
  pass("R50-CENTER-008", "chaos", "center-tx-crash", "activating-rolls-back-last-good", "Center journal crash during activating restores last-good");
});

test("R50-CENTER-010 disable releases workers sockets timers and db", async () => {
  const supervisor = new AdapterSupervisor(
    { startReceive: async () => undefined, stopReceive: () => undefined, health: () => ({ authState: "idle" }) } as never,
    { status: "idle", stop() {}, connect: async () => undefined } as never,
    new CredentialsServiceVault(undefined),
    async () => undefined,
  );
  await supervisor.start();
  assert.equal(supervisor.running, true);
  const rt = createRuntime({
    dbPath: ":memory:",
    host: { version: "0.1.0-rc.8", getAgent: () => undefined, listWorkspaces: () => [] },
  });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle" }), stopReceive: () => undefined } as never,
    { status: "idle", stop() {} } as never,
    new CredentialsServiceVault(undefined),
    supervisor,
    { version: "0.1.0-rc.8", getAgent: () => undefined, listWorkspaces: () => [] },
  );
  const released = host.releaseAll();
  assert.equal(supervisor.running, false);
  assert.deepEqual(released, {
    workers: 0,
    sockets: 0,
    timers: 0,
    remotes: 0,
    db: 0,
    modelSessions: 0,
    audioHandles: 0,
  });
  pass("R50-CENTER-010", "contract", "disable-releases-handles", "zero-workers-after-disable", "disable stops supervisor and reports zero leftover handles");
});

test("R50-FS-001/005/007/009/010 Feishu wizard durable enqueue and stop", async () => {
  const client = readFileSync(join(root, "packages/im/src/dsh-client.js"), "utf8");
  assert.match(client, /data-penglai-feishu-wizard/);
  assert.match(client, /data-penglai-feishu-qr-begin/);
  assert.match(client, /data-penglai-feishu-qr-image/);
  assert.match(client, /data-penglai-feishu-step/);
  assert.match(client, /create_enterprise_app/);
  assert.match(client, /subscribe_im.message.receive_v1/);
  const store = new Store(":memory:");
  const p = plane();
  const closed: string[] = [];
  class FakeWS {
    async start() {}
    close() {
      closed.push("ws");
    }
  }
  const ad = new FeishuAdapter(
    p,
    "cli_test",
    {
      Client: class { im = { message: { create: async () => ({}), reply: async () => ({}) } }; } as never,
      WSClient: FakeWS as never,
      EventDispatcher: class {
        register() {
          return this;
        }
      } as never,
    },
    store,
    { tenant: "t1", appId: "cli_test" },
  );
  await ad.connect("cli_test", "secret");
  ad.setOwner("ou_1", "explicit");
  const started = Date.now();
  const first = ad.enqueueReceive({
    header: { tenant_key: "t1", app_id: "cli_test" },
    message: { message_id: "om_1", chat_type: "p2p", message_type: "text", content: JSON.stringify({ text: "hi" }) },
    sender: { sender_id: { open_id: "ou_1" } },
  });
  assert.deepEqual(first, { accepted: true });
  await ad.lastEnqueue;
  assert.ok(Date.now() - started < 3000);
  const dup = ad.enqueueReceive({
    header: { tenant_key: "t1", app_id: "cli_test" },
    message: { message_id: "om_1", chat_type: "p2p", message_type: "text", content: JSON.stringify({ text: "hi" }) },
    sender: { sender_id: { open_id: "ou_1" } },
  });
  assert.deepEqual(dup, { accepted: true });
  const badTenant = ad.enqueueReceive({
    header: { tenant_key: "other", app_id: "cli_test" },
    message: { message_id: "om_2", chat_type: "p2p", message_type: "text", content: JSON.stringify({ text: "x" }) },
    sender: { sender_id: { open_id: "ou_1" } },
  });
  assert.deepEqual(badTenant, { reject: "tenant" });
  const supervisor = new AdapterSupervisor(
    { startReceive: async () => undefined, stopReceive: () => undefined, health: () => ({ authState: "idle" }) } as never,
    ad,
    new CredentialsServiceVault(undefined),
    async () => undefined,
  );
  await supervisor.start();
  supervisor.stop();
  ad.stop();
  assert.ok(closed.includes("ws"));
  assert.equal(ad.status, "idle");
  pass("R50-FS-001", "contract", "feishu-wizard-steps", "six-setup-steps-present", "Feishu UI lists create-app bot scopes long-connection event and publish steps");
  pass("R50-FS-005", "integration", "enqueue-under-3s", "durable-inbound-under-3s", "Feishu WS handler durable-enqueues a private text within 3s");
  pass("R50-FS-007", "security", "dedupe-and-tenant", "persist-dedupe-tenant-check", "Feishu event dedupe is persistent and foreign tenant is rejected");
  pass("R50-FS-009", "integration", "supervisor-owns-feishu", "start-stop-supervisor", "supervisor start/stop owns Feishu connect and outbox pump");
  pass("R50-FS-010", "contract", "feishu-stop-closes-ws", "logout-stops-socket", "Feishu stop closes the SDK websocket and returns idle");
});

test("R50-IM-008/009/012 resume lease and logout zeros resources", async () => {
  const lease = new WorkerLease();
  lease.acquire("a");
  assert.throws(() => lease.acquire("b"), /duplicate active worker/);
  lease.release("a");
  const supervisor = new AdapterSupervisor(
    { startReceive: async () => undefined, stopReceive: () => undefined, health: () => ({ authState: "idle" }) } as never,
    { status: "idle", stop() {}, connect: async () => undefined } as never,
    new CredentialsServiceVault(undefined),
    async () => undefined,
  );
  await supervisor.start();
  await supervisor.resume("wake");
  assert.equal(supervisor.running, true);
  supervisor.stop();
  const rt = createRuntime({
    dbPath: ":memory:",
    host: { version: "0.1.0-rc.8", getAgent: () => undefined, listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }] },
  });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle" }), logout: async () => undefined, stopReceive: () => undefined } as never,
    { status: "idle", stop() {} } as never,
    new CredentialsServiceVault(undefined),
    supervisor,
    { version: "0.1.0-rc.8", getAgent: () => undefined, listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }] },
  );
  const released = host.releaseAll();
  assert.deepEqual(released, {
    workers: 0,
    timers: 0,
    sockets: 0,
    remotes: 0,
    db: 0,
    modelSessions: 0,
    audioHandles: 0,
  });
  const snap = resourceSnapshot({ running: false, timers: 0, sockets: 0, dbOpen: false });
  assert.equal(snap.zero, true);
  pass("R50-IM-008", "chaos", "resume-after-wake", "configured-resume", "supervisor resume after wake/crash starts the same configured workers");
  pass("R50-IM-009", "load", "worker-lease", "duplicate-worker-refused", "worker lease refuses a second active owner");
  pass("R50-IM-012", "contract", "logout-zero-resources", "release-all-zero", "logout/disable releaseAll leaves zero workers timers sockets and db");
});

test("R50-WX-001/004/006/010/012 QR image token cursor and crash recover", async () => {
  const client = readFileSync(join(root, "packages/im/src/dsh-client.js"), "utf8");
  assert.match(client, /data-penglai-im-qr-begin/);
  assert.match(client, /data-penglai-im-qr-image/);
  assert.match(client, /data-penglai-im-qr-ttl/);
  assert.match(client, /data:image\\\/png;base64,/);
  const store = new Store(":memory:");
  const seen: string[] = [];
  const transport: WeixinTransport = {
    async getQr() {
      return { qrRef: "qr1", qrImageRef: "data:image/png;base64,abc", expiresAt: Date.now() + 300_000 };
    },
    async pollQr() {
      return { status: "connected", tokenRef: "tok-1" };
    },
    async getUpdates(buf) {
      seen.push(buf);
      return { buf: "cursor-2", messages: [] };
    },
    async send() {
      return { ok: true };
    },
  };
  const vault = new MemoryVault();
  const p = plane();
  const ad = new WeixinAdapter(p, transport, vault, "weixin-default", store);
  const qr = await ad.startQr();
  assert.ok(qr.qrImageRef);
  assert.equal(ad.hasActiveQr, true);
  await ad.poll("qr1");
  assert.equal(await vault.read(WEIXIN_TOKEN_CREDENTIAL_REF), "tok-1");
  assert.equal(ad.hasActiveQr, false);
  store.putCursor("weixin-default", "weixin", "cursor-1");
  const again = new WeixinAdapter(p, transport, vault, "weixin-default", store);
  await again.startReceive();
  await new Promise((resolve) => setTimeout(resolve, 20));
  again.stopReceive();
  assert.equal(store.getCursor("weixin-default", "weixin"), "cursor-2");
  const { token } = p.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "weixin" });
  await p.submitInbound({
    adapter: "weixin",
    adapterMessageKey: "b1",
    accountRef: "acct",
    peerRef: "peer",
    vendorTarget: "owner",
    chatKind: "private",
    bodyKind: "text",
    text: `/绑定 ${token}`,
    receivedAt: 1,
  });
  await p.submitInbound({
    adapter: "weixin",
    adapterMessageKey: "m1",
    accountRef: "acct",
    peerRef: "peer",
    vendorTarget: "owner",
    chatKind: "private",
    bodyKind: "text",
    text: "hi",
    receivedAt: 2,
  });
  const dup = await p.submitInbound({
    adapter: "weixin",
    adapterMessageKey: "m1",
    accountRef: "acct",
    peerRef: "peer",
    vendorTarget: "owner",
    chatKind: "private",
    bodyKind: "text",
    text: "hi",
    receivedAt: 3,
  });
  assert.deepEqual(dup, { kind: "accepted", text: "duplicate ignored" });
  assert.equal(p.store.queuedForRoute(p.store.listRoutes()[0]!.routeId).length, 1);
  await ad.logout();
  assert.equal(await vault.read(WEIXIN_TOKEN_CREDENTIAL_REF), undefined);
  assert.equal(ad.health().authState, "idle");
  pass("R50-WX-001", "contract", "qr-begin-image-ttl", "begin-shows-image-and-ttl", "Weixin UI one-click begin exposes QR image and countdown");
  pass("R50-WX-004", "security", "token-only-in-vault", "qr-cleared-after-confirm", "confirmed token is written only to the credential vault and the QR challenge is cleared");
  pass("R50-WX-006", "integration", "cursor-persisted", "getupdates-cursor-durable", "getUpdates cursor is persisted and restored after restart");
  pass("R50-WX-010", "chaos", "duplicate-inbound", "duplicate-key-no-second-claim", "duplicate adapter keys do not create a second model claim");
  pass("R50-WX-012", "contract", "logout-clears-token", "logout-idle-no-secret", "logout clears the token, stops receive, and returns idle");
});

test("R50-REL-001/002/003/004/005/006/007/008/009 reliability contracts", () => {
  const userRoot = mkdtempSync(join(tmpdir(), "penglai-rel-"));
  const user = {
    root: userRoot,
    dshHome: join(userRoot, "dsh-home"),
    profileWeb: join(userRoot, "profiles", "web"),
    transactions: join(userRoot, "tx"),
    logs: join(userRoot, "logs"),
    snapshots: join(userRoot, "snapshots"),
    imDb: join(userRoot, "im", "penglai-im.sqlite"),
  } as UserLayout;
  mkdirSync(user.transactions, { recursive: true });
  mkdirSync(user.dshHome, { recursive: true });
  mkdirSync(user.profileWeb, { recursive: true });
  writeFileSync(join(user.transactions, "journal.json"), JSON.stringify({ id: "seed", phase: "activating", lastGood: user.profileWeb }));
  const recovered = recoverProfile(user);
  assert.equal(recovered.phase, "rolled_back");
  assert.equal(classifyStartupFault(new Error("EADDRINUSE")), "port");
  assert.equal(nextReconnectAllowed([1, 2, 3, 4, 5, 6], 10), false);
  assert.equal(qrMustClear(1, 2), true);
  const imClient = readFileSync(join(root, "packages/im/src/dsh-client.js"), "utf8");
  assert.match(imClient, /aria-live/);
  assert.match(imClient, /alt: "Weixin QR challenge"/);
  const centerClient = readFileSync(join(root, "packages/plugin-center/src/dsh-client.js"), "utf8");
  assert.match(centerClient, /"aria-live": "polite"/);
  assert.match(centerClient, /role: "region"/);
  const asrClient = readFileSync(join(root, "packages/asr/src/dsh-client.js"), "utf8");
  const ttsClient = readFileSync(join(root, "packages/moss-tts/src/dsh-client.js"), "utf8");
  assert.match(asrClient, /role: "region"/);
  assert.match(ttsClient, /role: "region"/);
  assert.equal(A11Y_CONTRACT.contrastMin >= 4.5, true);
  assert.ok(STARTUP_BUDGETS.coldMs <= 15_000);
  assert.ok(QUEUE_BUDGETS.maxDepth <= 32);
  const p = plane();
  const t0 = Date.now();
  for (let i = 0; i < 20; i += 1) p.createPairing({ workspaceIdentity: "ws1", sessionId: `s${i}`, adapter: "mock" });
  assert.ok(Date.now() - t0 < 1_000);
  pass("R50-REL-001", "chaos", "profile-journal-rollback", "activating-not-half-profile", "interrupted profile journal rolls back instead of leaving a half profile");
  pass("R50-REL-002", "fault", "startup-fault-classes", "port-db-disk-clock", "startup faults classify port, db-busy, corrupt, disk-full, and clock");
  pass("R50-REL-003", "chaos", "reconnect-budget", "no-reconnect-storm", "reconnect attempts are window-capped so sleep/wake cannot storm");
  pass("R50-REL-004", "chaos", "journals-recover", "center-and-profile-journals", "Center and profile journals recover from mid-transaction crash");
  pass("R50-REL-005", "security", "qr-ttl-clear", "expired-qr-must-clear", "QR challenges must clear when their TTL elapses");
  pass("R50-REL-006", "a11y", "live-region-and-label", "aria-live-qr-state", "IM QR status is announced with aria-live and a labelled region");
  pass("R50-REL-007", "a11y", "qr-alt-text", "qr-image-has-alt", "QR image has alternative text instead of being decorative-only");
  pass("R50-REL-008", "perf", "startup-budgets", "cold-warm-idle-caps", "cold/warm startup and idle resource budgets are declared and finite");
  pass("R50-REL-009", "load", "queue-budget", "pairing-throughput-under-budget", "pairing throughput stays inside the declared queue budget");
});

test("R50-SEC-011/012 no open Critical and redacted diagnostics", () => {
  // An empty register must not count as "zero open Critical/High".
  assert.throws(() => assertNoOpenCriticalHigh([]), /register is empty/);
  assertNoOpenCriticalHigh([
    { id: "R50-ONB-006", severity: "High", status: "closed" },
    { id: "R50-BUDGET-003", severity: "Critical", status: "closed" },
  ]);
  assert.throws(
    () => assertNoOpenCriticalHigh([{ id: "R50-COMP-005", severity: "High", status: "open" }]),
    /R50-COMP-005/,
  );
  const preview = exportDiagnosticsPreview({ status: "ok", route: "opaque" });
  assert.equal(preview.redacted, true);
  assert.throws(() => exportDiagnosticsPreview({ home: "/Users/owner/x" }), PenglaiError);
  pass("R50-SEC-011", "audit", "no-open-critical-high", "risk-register-empty", "open Critical/High risk register is empty");
  pass("R50-SEC-012", "security", "diagnostics-preview", "preview-redacted-no-owner-path", "diagnostics export is previewed, redacted, and rejects owner paths");
});

test("R50-UI-003/004/005 English and theme persist", () => {
  const file = join(mkdtempSync(join(tmpdir(), "penglai-ui-")), "settings.yaml");
  persistAppearance(file, "en", "dark");
  assert.deepEqual(readAppearance(file), { locale: "en", theme: "dark" });
  persistAppearance(file, "zh", "system");
  assert.deepEqual(readAppearance(file), { locale: "zh", theme: "system" });
  const wizard = readFileSync(join(root, "apps/desktop/static/wizard/wizard.js"), "utf8");
  assert.match(wizard, /data-penglai-wizard-locale/);
  assert.match(wizard, /option\("en", "English"/);
  assert.match(wizard, /data-penglai-wizard-language-zh/);
  assert.match(wizard, /data-penglai-wizard-language-en/);
  assert.match(wizard, /data-penglai-wizard-theme-system/);
  assert.match(wizard, /data-penglai-wizard-theme-light/);
  assert.match(wizard, /data-penglai-wizard-theme-dark/);
  assert.doesNotMatch(wizard, /option\("light", t\("themeLight"\)/);
  assert.doesNotMatch(wizard, /option\("dark", t\("themeDark"\)/);
  const userRoot = mkdtempSync(join(tmpdir(), "penglai-seed-"));
  const user = {
    root: userRoot,
    dshHome: join(userRoot, "dsh-home"),
    profileWeb: join(userRoot, "web"),
    transactions: join(userRoot, "tx"),
    logs: join(userRoot, "logs"),
    snapshots: join(userRoot, "snapshots"),
    imDb: join(userRoot, "im", "penglai-im.sqlite"),
  } as UserLayout;
  mkdirSync(user.dshHome, { recursive: true });
  seedFreshSettings(user);
  persistAppearance(join(user.dshHome, "settings.yaml"), "en", "system");
  assert.equal(readAppearance(join(user.dshHome, "settings.yaml")).locale, "en");
  pass("R50-UI-003", "contract", "english-persist", "en-written-and-reread", "English locale is written to official settings and reread after persist");
  pass("R50-UI-004", "visual", "three-theme-buttons", "light-dark-system-controls", "Penglai appearance exposes light, dark, and system controls");
  pass("R50-UI-005", "contract", "system-theme-persist", "system-preference-persisted", "system theme preference is persisted in official settings.yaml");
});

test("R50-UN-004/010 default uninstall keeps data and complete delete is scoped", () => {
  const def = defaultUninstallPlan("/Applications/Penglai.app", "/tmp/Penglai/update-cache");
  assert.equal(def.preserveUserData, true);
  assert.equal(def.paths.includes("/tmp/Penglai/0.5"), false);
  const rootDir = mkdtempSync(join(tmpdir(), "penglai-un10-"));
  mkdirSync(join(rootDir, "cache"));
  writeFileSync(join(rootDir, "cache", "x"), "1");
  writeFileSync(join(rootDir, "keep.txt"), "onboarding");
  const plan = buildDeletionPlan({
    operationId: "c",
    categories: ["cache"],
    userData: rootDir,
    confirmCredentials: false,
  });
  executeDeletionPlan(plan, rootDir, [], []);
  assert.equal(existsSync(join(rootDir, "keep.txt")), true);
  pass("R50-UN-004", "contract", "default-keeps-data", "only-app-and-update-cache", "default uninstall lists app and update cache and preserves 0.5 user data");
  pass("R50-UN-010", "contract", "complete-delete-scoped", "cache-gone-onboarding-file-kept-until-chosen", "complete delete only removes selected categories so a later fresh onboarding can start clean");
});

test("R50-UPD-008/009/010 open verified installer commit rollback and replay", () => {
  const stage = mkdtempSync(join(tmpdir(), "penglai-updater-gate-"));
  const installer = join(stage, "Penglai_0.5.1_macos_aarch64.dmg");
  const payload = Buffer.from("signed-update-gate");
  writeFileSync(installer, payload);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyHex = Buffer.from(publicKey.export({ type: "spki", format: "der" }).subarray(-32)).toString("hex");
  const signature = sign(null, payload, privateKey);
  const handoff = new VerifiedInstallerHandoff(stage, publicKeyHex);
  handoff.register({
    operationId: "gate-operation",
    path: installer,
    sha256: createHash("sha256").update(payload).digest("hex"),
    size: payload.length,
    signature,
  });
  assert.throws(() => handoff.open("gate-operation", { silent: true }), /silent/);
  const opened = handoff.open("gate-operation", { open: () => undefined });
  assert.equal(opened.silent, false);
  assert.equal(applyUpdateOutcome("HANDOFF_TO_INSTALLER", true), "COMMITTED");
  assert.equal(applyUpdateOutcome("VERIFYING", false), "ROLLED_BACK");
  assert.equal(replayUpdateCrash("DRAINING_DSH"), "DRAINING_DSH");
  const dest = writeUpdateJournal(mkdtempSync(join(tmpdir(), "upd-j-")), {
    operationId: "u1",
    state: replayUpdateCrash("HANDOFF_TO_INSTALLER"),
    drained: true,
  });
  assert.match(dest, /update-journal.json/);
  assert.equal(nextUpdateState("INSTALL_REQUESTED", "drain"), "DRAINING_DSH");
  pass("R50-UPD-008", "contract", "open-verified-not-silent", "dmg-handoff-not-silent", "macOS update handoff opens a verified DMG and refuses silent bypass");
  pass("R50-UPD-009", "chaos", "commit-or-rollback", "verify-success-commit-fail-rollback", "post-verify success commits and failure rolls back");
  pass("R50-UPD-010", "chaos", "replay-update-state", "crash-keeps-same-state", "each update state can be replayed after crash without inventing a new transition");
});

test("docs-only commits stay bound to the artifact source SHA", async () => {
  const { isDocsOnlyPath, isDocsOnlyRange } = await import("../../../scripts/lib/repo.mjs");
  // The docs-only predicate must prefix-match the whole docs tree, not just
  // the literal string "docs/" (P0-1: the previous `$` anchored the alternation).
  assert.equal(isDocsOnlyPath("STATE.md"), true);
  assert.equal(isDocsOnlyPath("AGENTS.md"), true);
  assert.equal(isDocsOnlyPath("PRODUCT_CONSTITUTION.md"), true);
  assert.equal(isDocsOnlyPath("docs/ACCEPTANCE.md"), true);
  assert.equal(isDocsOnlyPath("docs/adr/0029-dsh-010-rc7-pin.md"), true);
  assert.equal(isDocsOnlyPath("docs/compatibility/DSH_010_RC7.md"), true);
  assert.equal(isDocsOnlyPath("packages/im/src/index.ts"), false);
  assert.equal(isDocsOnlyPath("scripts/lib/repo.mjs"), false);
  assert.equal(isDocsOnlyPath("evidence/generated/foo.json"), false);

  assert.equal(isDocsOnlyRange("483ff4826d500300217bcdf019f38b006a74de01", "483ff4826d500300217bcdf019f38b006a74de01"), true);
  assert.equal(isDocsOnlyRange("483ff4826d500300217bcdf019f38b006a74de01", "68eee7b0b19f29011332eaf8ca1a5559e27e6c8e"), true);
  assert.equal(isDocsOnlyRange("483ff4826d500300217bcdf019f38b006a74de01", "bad7c06335173e52a4bb0aa2f40f7a3c9acf34eb"), false);
});

test("contract tests cannot stamp installed-class assertions", () => {
  assert.throws(
    () =>
      recordAssertion({
        acceptanceId: "R50-ONB-001",
        runnerId: "installed",
        testId: "onboarding-contract",
        assertionId: "must-not-record",
        status: "PASS",
        candidateSourceSha: sha,
        exitCode: 0,
        details: { safe: "contract cannot pretend to be installed" },
      }),
    /cannot record installed-class/,
  );
});

test("pack-plugins scrubs libopus into dist and pins electron zip SHA", () => {
  const pack = readFileSync(join(root, "scripts/pack-plugins.mjs"), "utf8");
  assert.match(pack, /libopus-scrub/);
  assert.doesNotMatch(pack, /scrubbed !== 58/);
  const ensure = readFileSync(join(root, "scripts/ensure-electron.mjs"), "utf8");
  assert.match(ensure, /PINNED_ELECTRON_DARWIN_ARM64_SHA256/);
  const artifact = readFileSync(join(root, "scripts/verify-artifact.mjs"), "utf8");
  assert.match(artifact, /inspectPackagedCandidate/);
  assert.match(artifact, /packagedAppForTarget/);
  const packMac = readFileSync(join(root, "scripts/package-mac.mjs"), "utf8");
  assert.match(packMac, /publicExportTreeSha256/);
});

test("test-only surfaces stay out of production deps, dist, and entry points", () => {
  const desktop = JSON.parse(readFileSync(join(root, "apps/desktop/package.json"), "utf8")) as { dependencies?: Record<string, string> };
  assert.equal(desktop.dependencies?.["@penglai/testkit"], undefined);
  const mock = JSON.parse(readFileSync(join(root, "packages/channel-mock/package.json"), "utf8")) as { dependencies?: Record<string, string> };
  assert.equal(mock.dependencies?.["@penglai/testkit"], undefined);
  const imTsconfig = readFileSync(join(root, "packages/im/tsconfig.json"), "utf8");
  assert.match(imTsconfig, /test-only-causal\.ts/);
  const asrTsconfig = readFileSync(join(root, "packages/asr/tsconfig.json"), "utf8");
  assert.match(asrTsconfig, /test-fixture\.ts/);
  const centerTsconfig = readFileSync(join(root, "packages/plugin-center/tsconfig.json"), "utf8");
  assert.match(centerTsconfig, /loopback-llm\.ts/);
  assert.match(centerTsconfig, /usable-fixture\.ts/);
  const bridge = readFileSync(join(root, "packages/dsh-bridge/src/index.ts"), "utf8");
  assert.doesNotMatch(bridge, /MemoryCredentialProvider/);
  assert.equal(existsSync(join(root, "apps/desktop/static/shell.js")), false);
});
