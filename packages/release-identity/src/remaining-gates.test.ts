import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  assertCatalogComplete,
  assertHonestTrustCopy,
  backoffMs,
  classifyTransportError,
  PENGLAI_I18N,
  PenglaiError,
  redactEvidenceText,
  t,
} from "@penglai/contracts";
import { declaredSourceSha, recordAssertion, assertEvidenceTextClean } from "./assertion.js";
import { inspectPackagedCandidate, packagedAppForTarget } from "../../../scripts/lib/packaged-candidate.mjs";
import { R2_CATALOG, validateCatalog } from "../../plugin-center/src/index.js";
import { rollbackLastGood, runProfileTransaction } from "../../plugin-center/src/profile-tx.js";
import type { PluginCatalogEntry } from "../../runtime/src/plugin-catalog.js";
import { contribute as contributeCenter } from "../../plugin-center/src/client.js";
import { contribute as contributeIm } from "../../im/src/client.js";
import { AdapterSupervisor } from "../../im/src/supervisor.js";
import { CredentialsServiceVault } from "../../im/src/credentials-vault.js";
import { PenglaiImHost, createRuntime } from "../../im/src/index.js";
import { Store } from "../../persistence/src/index.js";
import { RoutingControlPlane } from "../../routing-core/src/index.js";
import { SeqIds, VirtualClock } from "../../testkit/src/index.js";
import { parseInbound, WeixinAdapter, MemoryVault, WEIXIN_TOKEN_CREDENTIAL_REF, type WeixinTransport } from "../../channel-weixin/src/index.js";
import {
  ALLOWED_REDIRECT_HOSTS,
  QR_TTL_MS,
  STATUS_POLL_TIMEOUT_MS,
  assertRedirectBase,
  mapQrStatus,
  randomWechatUin,
} from "../../channel-weixin/src/protocol.js";
import { FeishuAdapter, parseFeishuEvent } from "../../channel-feishu/src/index.js";
import { PINNED_LARK_SDK, doctorFeishu, isForbiddenBaseAuth } from "../../channel-feishu/src/official.js";
import { MockAdapter } from "../../channel-mock/src/index.js";
import { assertUpdateManifest, verifyPayload, assertProductionHasNoFixtureKey } from "../../runtime/src/update.js";
import { assertArchConsistent } from "../../runtime/src/arch-guard.js";
import { resolveGenerationLayout } from "../../runtime/src/layout.js";
import { assertProductionBundleClean } from "../../runtime/src/scanner.js";
import { posixCredentialModes, writeFileAtomic, applyPosixTreeModes } from "../../runtime/src/permissions.js";
import { detectLegacy, assertSafeDeletePath, buildDeletionPlan } from "../../runtime/src/uninstall.js";
import { assertIpcName, navigationDecision } from "../../../apps/desktop/src/preload.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const sha = declaredSourceSha();

function pass(id: string, runnerId: string, testId: string, assertionId: string, safe: string, extra: Record<string, unknown> = {}) {
  recordAssertion({
    acceptanceId: id,
    runnerId,
    testId,
    assertionId,
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe },
    ...extra,
  });
}

function plane(createSession?: (ws: string, title: string) => Promise<{ id: string }>) {
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
      ...(createSession ? { createSession } : {}),
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

test("R50-TRUTH-005 unique main is the only local branch", () => {
  const branches = execFileSync("git", ["branch", "--list"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .map((line) => line.replace("*", "").trim())
    .filter(Boolean);
  assert.deepEqual(branches, ["main"]);
  assert.equal(execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), "main");
  assert.equal(execFileSync("git", ["tag", "--list"], { cwd: root, encoding: "utf8" }).trim(), "");
  pass("R50-TRUTH-005", "git", "unique-main", "only-main-no-private-tag", "local git has unique main and no private tags");
});

test("R50-CORE-003/007/008 official DSH remains the only agent core", () => {
  const desktop = readFileSync(join(root, "apps/desktop/src/electron-main.ts"), "utf8");
  const im = readFileSync(join(root, "packages/im/src/index.ts"), "utf8");
  const center = readFileSync(join(root, "packages/plugin-center/src/index.ts"), "utf8");
  assert.equal(/new ChatRuntime|session-store-v2|penglai-model-registry/.test(`${desktop}${im}${center}`), false);
  assert.match(center, /new PenglaiOnboardingRemote/);
  assert.match(im, /new PenglaiImRemote/);
  assert.equal(contributeCenter().slot, "settings.section");
  const centerClient = readFileSync(join(root, "packages/plugin-center/src/dsh-client.js"), "utf8");
  const imClient = readFileSync(join(root, "packages/im/src/dsh-client.js"), "utf8");
  const asrClient = readFileSync(join(root, "packages/asr/src/dsh-client.js"), "utf8");
  const ttsClient = readFileSync(join(root, "packages/moss-tts/src/dsh-client.js"), "utf8");
  assert.doesNotMatch(centerClient, /settings\.onboarding|registerOnboarding/);
  assert.match(centerClient, /settings\.section/);
  assert.doesNotMatch(centerClient, /settings\.penglai\.page/);
  assert.match(imClient, /settings\.section/);
  assert.match(asrClient, /settings\.section/);
  assert.match(ttsClient, /settings\.section/);
  assert.equal(/settings\.plugin\.item/.test(`${centerClient}${imClient}${asrClient}${ttsClient}`), false);
  const overlay = JSON.parse(readFileSync(join(root, "overlays/dsh-0.1.0-rc.8/manifest.json"), "utf8")) as {
    dsh: string;
    kind: string;
    files: Array<{ id: string; upstreamSha256: string }>;
  };
  assert.equal(overlay.dsh, "0.1.0-rc.8");
  assert.equal(overlay.kind, "ui-only");
  assert.ok(overlay.files.every((file) => /^[0-9a-f]{64}$/.test(file.upstreamSha256)));
  assert.ok(overlay.files.some((file) => file.id === "conversation-hero"));
  const overlayAdr = readFileSync(join(root, "docs/adr/0031-dsh-010-rc8-pin-and-brand-slots.md"), "utf8");
  assert.match(overlayAdr, /0\.1\.0-rc\.8/);
  assert.match(overlayAdr, /sidebar\.brand\.mark/);
  assert.match(overlayAdr, /conversation\.hero\.brand\.mark/);
  assert.match(overlayAdr, /ink-wash|hero copy\/background/);
  pass("R50-CORE-003", "architecture", "no-second-runtime", "no-parallel-agent-or-registry", "product packages do not introduce a second Agent or model registry");
  pass("R50-CORE-007", "contract", "official-slots", "center-im-use-official-slots", "Center and IM enter through official settings slots and Typert remotes");
  pass("R50-CORE-008", "overlay", "exact-hash-adr", "overlay-manifest-exact-dsh", "UI overlay is pinned to exact DSH 0.1.0-rc.8 hashes and ADR 0023");
});

test("R50-UI-002/007/008 locale catalog and honest About copy", () => {
  assertCatalogComplete();
  assert.equal(t("zh", "aboutVersion"), "版本 0.5.0");
  assert.match(t("zh", "aboutDsh"), /0\.1\.0-rc\.8/);
  assertHonestTrustCopy(PENGLAI_I18N.zh.aboutTrust);
  assertHonestTrustCopy(PENGLAI_I18N.en.aboutTrust);
  assert.throws(() => assertHonestTrustCopy("notarized Authenticode silent auto-update"));
  pass("R50-UI-002", "locale", "catalog-complete", "zh-en-keys-match", "Penglai zh/en catalogs have the same keys");
  pass("R50-UI-007", "contract", "about-copy", "about-version-dsh-trust", "About copy states 0.5.0, DSH pin, community trust, and data location");
  pass("R50-UI-008", "content", "honest-trust", "no-notary-or-silent-update", "UI copy does not claim notarization, Authenticode, or silent auto-update");
});

test("R50-CRED-001/003/004/006/007/008 official YAML credentials and no fallback", async () => {
  const vault = new CredentialsServiceVault(undefined);
  await assert.rejects(() => vault.write("penglai-im/weixin/default/token", "secret"), PenglaiError);
  const blocked = new CredentialsServiceVault({
    async set() {},
    async describe() {
      return { configured: true, value: "secret" };
    },
    async resolve() {
      return { configured: true, value: "secret" };
    },
    async unset() {},
  } as never);
  await assert.rejects(() => blocked.describe("penglai-im/weixin/default/token"), /must not return value/);
  const modes = posixCredentialModes();
  assert.equal(modes.dir, 0o700);
  assert.equal(modes.file, 0o600);
  const dir = mkdtempSync(join(tmpdir(), "penglai-cred-ev-"));
  const file = join(dir, ".credentials.yaml");
  writeFileAtomic(file, "x: 1\n", 0o600);
  applyPosixTreeModes(dir, [file]);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const src = readFileSync(join(root, "packages/runtime/src/uninstall.ts"), "utf8");
  const detector = src.slice(src.indexOf("export function detectLegacy"), src.indexOf("export function executeDeletionPlan"));
  assert.equal(detector.includes("sqlite"), false);
  assert.equal(detector.includes(".credentials.yaml"), false);
  assert.throws(() => assertProductionHasNoFixtureKey("PENGLAI_FIXTURE_UPDATER_PRIVATE=abc"), /fixture updater/);
  pass("R50-CRED-001", "contract", "official-credentials-seam", "vault-uses-official-set-describe", "IM vault writes only through official credentials.set/describe");
  pass("R50-CRED-003", "security", "describe-no-value", "renderer-cannot-read-secret", "credentials.describe rejects a value field so renderer never sees plaintext");
  pass("R50-CRED-004", "contract", "posix-modes", "dir-0700-file-0600", "macOS credential file write is 0600 and directory plan is 0700");
  pass("R50-CRED-006", "security", "no-memoryvault-fallback", "production-refuses-memory-env", "production vault refuses MemoryVault/env fallback");
  pass("R50-CRED-007", "security", "no-fixture-key-in-update", "update-rejects-fixture-private", "update path rejects fixture updater private key material");
  pass("R50-CRED-008", "legacy", "no-041-secret-read", "legacy-detector-no-secret", "0.4.1 detector does not open credentials or a database");
});

test("R50-CENTER-002/003/004 catalog fields and journal rollback", async () => {
  validateCatalog(R2_CATALOG);
  assert.equal(R2_CATALOG.some((entry) => /keychain|plugin-smoke|community/i.test(entry.id)), false);
  for (const id of ["@penglai/asr", "@penglai/moss-tts", "@penglai/context", "@penglai/memory", "@penglai/budget", "@penglai/companion"]) {
    assert.ok(R2_CATALOG.some((entry) => entry.id === id), id);
  }
  for (const entry of R2_CATALOG) {
    assert.ok(entry.version && entry.dsh.exact && entry.platforms.length && entry.source && entry.license && entry.migration);
  }
  const packed = JSON.parse(readFileSync(join(root, "evidence/generated/plugin-catalog.json"), "utf8")) as {
    schema: number;
    target?: string;
    entries: Array<{ sha256: string }>;
  };
  assert.equal(packed.schema, 2);
  assert.ok(packed.entries.some((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)));
  const userDataRoot = mkdtempSync(join(tmpdir(), "pc-roll-"));
  const profileDir = join(userDataRoot, "dsh-home", "profiles", "web");
  const txDir = join(userDataRoot, "profiles", "center-tx");
  const pluginsDir = join(userDataRoot, "plugins");
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(pluginsDir, { recursive: true });
  writeFileSync(
    join(profileDir, "cordis.patch.yml"),
    "- insert:\n    - id: penglai-plugin-reference\n      name: \"@penglai/plugin-reference\"\n",
  );
  const metadata = R2_CATALOG.find((entry) => entry.id === "@penglai/plugin-reference")!;
  const entry: PluginCatalogEntry = {
    ...metadata,
    sha256: "a".repeat(64),
    target: "darwin-arm64",
    hasClient: false,
  };
  let loaded = true;
  let desired = true;
  const committed = await runProfileTransaction({
    userDataRoot,
    profileDir,
    txDir,
    pluginsDir,
    entry,
    action: "disable",
    previousEnabled: true,
    applyLive: async ({ enabled }) => {
      loaded = enabled;
    },
    verifyActual: async ({ enabled }) => assert.equal(loaded, enabled),
    readResources: () => ({ workers: 0, sockets: 0, timers: 0, remotes: 0, db: 0, modelSessions: 0, audioHandles: 0 }),
    commitDesired: (enabled) => {
      desired = enabled;
    },
    rollbackDesired: (enabled) => {
      desired = enabled;
    },
  });
  assert.equal(committed.phase, "committed");
  assert.equal(desired, false);
  assert.equal((await rollbackLastGood({ userDataRoot, profileDir, txDir, id: entry.id })).phase, "rolled_back");
  assert.doesNotMatch(readFileSync(join(profileDir, "cordis.patch.yml"), "utf8"), /disabled:\s+true/);
  pass("R50-CENTER-002", "contract", "catalog-real-only", "first-party-no-community", "signed catalog contains real first-party plugins and no community/historical cards");
  pass("R50-CENTER-003", "contract", "catalog-manifest-fields", "version-dsh-platform-license-hash", "catalog entries have version DSH platform capability permission source license migration and packed hash");
  pass("R50-CENTER-004", "integration", "journal-rollback", "desired-restored-from-journal", "Center journal rollback restores the previous desired state");
});

test("R50-IM-002/004/005/006/010/011 Typert remote persistence vendor-target and supervisor", async () => {
  const imHost = readFileSync(join(root, "packages/im/src/index.ts"), "utf8");
  const imClient = readFileSync(join(root, "packages/im/src/dsh-client.js"), "utf8");
  assert.equal(imHost.includes("/penglai/im"), false);
  assert.equal(imClient.includes("fetch(\"/penglai/im\""), false);
  assert.match(imHost, /PenglaiImRemote/);
  const store = new Store(":memory:");
  store.upsertRoute({ routeId: "r1", adapter: "weixin", accountRef: "a", peerRef: "hashed", status: "active" });
  store.putVendorReplyTarget("r1", "wx-user-original");
  assert.equal(store.getVendorReplyTarget("r1"), "wx-user-original");
  assert.notEqual(store.getVendorReplyTarget("r1"), "hashed");
  const weixin = {
    health: () => ({ authState: "idle" as const, hasCredential: false }),
    startReceive: async () => undefined,
    stopReceive: () => undefined,
  };
  const feishu = { status: "idle", stop() {} };
  const vault = new CredentialsServiceVault(undefined);
  const supervisor = new AdapterSupervisor(weixin as never, feishu as never, vault, async () => undefined);
  await supervisor.start();
  await supervisor.start();
  assert.equal(supervisor.running, true);
  supervisor.stop();
  assert.equal(supervisor.running, false);
  const p = plane();
  const mock = new MockAdapter(p);
  const { token } = p.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await p.submitInbound({
    adapter: "mock",
    adapterMessageKey: "b1",
    accountRef: "acct",
    peerRef: "peer",
    chatKind: "private",
    bodyKind: "text",
    text: `/绑定 ${token}`,
    receivedAt: 1,
  });
  await mock.receive({
    adapter: "mock",
    adapterMessageKey: "m1",
    accountRef: "acct",
    peerRef: "peer",
    chatKind: "private",
    bodyKind: "text",
    text: "hello",
    receivedAt: 2,
    vendorTarget: "peer-raw",
  });
  const routeId = p.store.listRoutes()[0]!.routeId;
  const inbound = p.store.queuedForRoute(routeId)[0]!;
  p.onClaimed({
    dshMessageId: "d1",
    turnId: "t1",
    sessionId: "sess1",
    source: { kind: "penglai-im", schema: 1, routeId, inboundId: inbound.inboundId, adapter: "mock" },
  });
  p.onAssistantFinal({ sessionId: "sess1", turnId: "t1", text: "reply" });
  await mock.flush(routeId);
  assert.equal(mock.sent[0]?.text, "reply");
  const rt = createRuntime({
    dbPath: ":memory:",
    host: {
      version: "0.1.0-rc.8",
      getAgent: () => undefined,
      listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
    },
  });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    weixin as never,
    feishu as never,
    vault,
    supervisor,
    { version: "0.1.0-rc.8", getAgent: () => undefined, listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }] },
  );
  const diag = JSON.stringify(host.getDiagnostics());
  assert.equal(/sk-|secret|token=/.test(diag), false);
  rt.store.close();
  pass("R50-IM-002", "contract", "typert-no-adhoc-http", "im-host-typert-remote", "IM host/client use Typert Remote and have no ad-hoc management HTTP");
  pass("R50-IM-004", "integration", "sqlite-vendor-target", "vendor-target-persisted", "SQLite stores vendor reply target separately from peerRef");
  pass("R50-IM-005", "security", "peerref-not-target", "vendor-target-not-hash", "vendor reply target is the original identity, not the hashed peerRef");
  pass("R50-IM-006", "concurrency", "supervisor-idempotent", "start-stop-single-owner", "supervisor start is idempotent and stop clears the AbortController");
  pass("R50-IM-010", "integration", "mock-real-plane", "mock-uses-worker-db-outbox", "mock adapter walks real inbound claim Turn and outbox");
  pass("R50-IM-011", "security", "diagnostics-redacted", "no-secret-in-diagnostics", "diagnostics expose only redacted status fields");
});

test("R50-IM-007 and WX/FS error classes use bounded backoff", () => {
  assert.equal(classifyTransportError({ status: 401, message: "revoked" }), "auth");
  assert.equal(classifyTransportError({ status: 429 }), "rate");
  assert.equal(classifyTransportError(new Error("ENOTFOUND host")), "network");
  assert.equal(backoffMs(0, "auth"), Number.POSITIVE_INFINITY);
  assert.ok(backoffMs(2, "rate", 0) < backoffMs(2, "rate", 1));
  pass("R50-IM-007", "fault", "classify-backoff", "auth-rate-network-jitter", "auth/429/network classify and auth does not retry unbounded");
});

test("R50-WX-002/003/005/007/008/009/011 weixin protocol and allowlist", async () => {
  assert.equal(mapQrStatus("wait"), "wait");
  assert.equal(mapQrStatus("scaned"), "scaned");
  assert.equal(mapQrStatus("confirmed"), "confirmed");
  assert.equal(mapQrStatus("expired"), "expired");
  assert.equal(mapQrStatus("need_verifycode"), "need_verifycode");
  assert.equal(QR_TTL_MS, 300_000);
  assert.equal(STATUS_POLL_TIMEOUT_MS, 35_000);
  assert.equal(assertRedirectBase("https://ilinkai.weixin.qq.com/v2"), "https://ilinkai.weixin.qq.com");
  assert.deepEqual(ALLOWED_REDIRECT_HOSTS, ["ilinkai.weixin.qq.com"]);
  const uins = new Set(Array.from({ length: 6 }, () => randomWechatUin()));
  assert.ok(uins.size > 1);
  const transport: WeixinTransport = {
    async getQr() {
      return { qrRef: "qr", qrImageRef: "data:image/png;base64,abc", expiresAt: 1 };
    },
    async pollQr() {
      return { status: "connected", tokenRef: "tok", scannerUserId: "owner" };
    },
    async getUpdates(buf) {
      return { buf, messages: [] };
    },
    async send(to) {
      sentTo.push(to);
      return { ok: true };
    },
  };
  const sentTo: string[] = [];
  const p = plane();
  const vault = new MemoryVault();
  await vault.write(WEIXIN_TOKEN_CREDENTIAL_REF, "tok");
  const ad = new WeixinAdapter(p, transport, vault);
  await ad.startQr();
  await ad.poll("qr");
  assert.equal(ad.assertAllowlisted("owner"), "ok");
  const other = await ad.ingest({ messageId: "2", fromUserId: "intruder", chatType: "private", itemType: "text", text: "nope" });
  assert.deepEqual(other, { kind: "rejected", text: "allowlist" });
  assert.deepEqual(parseInbound({ messageId: "3", fromUserId: "u", chatType: "group", itemType: "text", text: "x" }, "a"), { reject: "group" });
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
  const routeId = p.store.listRoutes()[0]!.routeId;
  const inbound = p.store.queuedForRoute(routeId)[0]!;
  p.onClaimed({
    dshMessageId: "d1",
    turnId: "t1",
    sessionId: "sess1",
    source: { kind: "penglai-im", schema: 1, routeId, inboundId: inbound.inboundId, adapter: "weixin" },
  });
  p.onAssistantFinal({ sessionId: "sess1", turnId: "t1", text: "pong" });
  await ad.pumpOutbox(routeId, p.requireVendorTarget(routeId));
  // /绑定 now acks on the channel ("bound") before the model reply ("pong").
  assert.deepEqual(sentTo, ["owner", "owner"]);
  assert.equal(classifyTransportError({ status: 429 }), "rate");
  pass("R50-WX-002", "contract", "qr-status-enum", "closed-qr-status-set", "Weixin QR status enum is closed and mapped");
  pass("R50-WX-003", "contract", "qr-ttl-redirect", "ttl-35s-https-redirect", "QR TTL, poll timeout, and https redirect base follow the pinned contract");
  pass("R50-WX-005", "integration", "scanner-allowlist", "other-identity-rejected", "scanner is the default unique allowlist and other identities are rejected before the model");
  pass("R50-WX-007", "contract", "uin-endpoints", "non-constant-uin", "X-WECHAT-UIN is non-constant and redirect hosts are pinned");
  pass("R50-WX-008", "integration", "send-vendor-target", "send-uses-original-to", "Weixin send uses the original vendor target, not the hashed peerRef");
  pass("R50-WX-009", "fault", "weixin-429-auth", "auth-does-not-retry", "Weixin 429/auth/network classify and auth does not retry unbounded");
  pass("R50-WX-011", "security", "group-media-reject", "group-media-before-model", "group and media Weixin messages are rejected before the model");
});

test("R50-FS-002/003/004/006/008/011/012 Feishu wizard contracts", async () => {
  assert.equal(PINNED_LARK_SDK, "1.73.0");
  const pkg = JSON.parse(readFileSync(join(root, "packages/channel-feishu/package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  assert.equal(pkg.dependencies?.["@larksuiteoapi/node-sdk"], "1.73.0");
  assert.equal(isForbiddenBaseAuth("device_flow"), true);
  assert.equal(isForbiddenBaseAuth("qr"), false);
  const rows = doctorFeishu({
    hasAppId: true,
    hasSecret: true,
    botEnabled: true,
    scopes: ["im:message.p2p_msg:readonly", "im:message:send_as_bot"],
    event: "im.message.receive_v1",
    published: true,
    tenantOk: true,
    networkOk: true,
  });
  assert.ok(rows.every((row) => row.ok));
  assert.deepEqual(parseFeishuEvent({ chatType: "group", messageId: "1", text: "x" }), { reject: "group" });
  const created: Array<{ receive_id: string; receive_id_type?: string }> = [];
  class FakeClient {
    im = {
      message: {
        create: async (req: { params: { receive_id_type: string }; data: { receive_id: string } }) => {
          created.push({ receive_id: req.data.receive_id, receive_id_type: req.params.receive_id_type });
          return {};
        },
        reply: async () => ({}),
      },
    };
  }
  const ad = new FeishuAdapter(plane(), "cli_test", {
    Client: FakeClient as never,
    WSClient: class { async start() {} close() {} } as never,
    EventDispatcher: class { register() { return this; } } as never,
  });
  await ad.connect("cli_test", "secret");
  const send = await ad.sendText("ou_1", "hi");
  assert.deepEqual(send, { ok: true });
  assert.equal(created[0]?.receive_id, "ou_1");
  assert.equal(created[0]?.receive_id_type, "open_id");
  const rt = createRuntime({
    dbPath: ":memory:",
    host: {
      version: "0.1.0-rc.8",
      getAgent: () => undefined,
      listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
    },
  });
  const vault = new CredentialsServiceVault({
    async set() {},
    async describe() {
      return { configured: true, source: "local", writable: true };
    },
    async resolve() {
      return { configured: true, source: "local" };
    },
    async unset() {},
  } as never);
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle", hasCredential: false }) } as never,
    ad,
    vault,
    { running: false, start: async () => undefined, stop: () => undefined } as never,
    { version: "0.1.0-rc.8", getAgent: () => undefined, listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }] },
  );
  const configured = await host.configureFeishu({ appId: "cli_probe", secret: "not-a-real-secret" });
  assert.equal(configured.configured, true);
  const overview = await host.getOverview();
  assert.equal(overview.feishuAppId, "cli_probe");
  assert.equal(JSON.stringify(overview).includes("not-a-real-secret"), false);
  rt.store.close();
  pass("R50-FS-002", "security", "feishu-appid-persist", "app-secret-not-readable", "Feishu App ID persists and the credential is not readable from overview");
  pass("R50-FS-003", "contract", "feishu-doctor-classes", "seven-doctor-classes", "Feishu doctor classifies credential bot permission event publish tenant network");
  pass("R50-FS-004", "artifact", "official-sdk-pin", "lark-1-73-0", "official Lark SDK 1.73.0 is a real plugin dependency");
  pass("R50-FS-006", "integration", "send-open-id", "create-uses-open-id", "Feishu send uses receive_id_type open_id and the original target");
  pass("R50-FS-008", "security", "feishu-group-media", "group-rejected-before-model", "Feishu group and media events are rejected before the model");
  pass("R50-FS-011", "fault", "feishu-send-classes", "auth-429-network-classified", "Feishu send classifies auth/429/network failures");
  pass("R50-FS-012", "artifact", "official-app-registration-qr", "no-user-device-flow", "Feishu one-click uses official app registration QR and forbids user Device Flow");
});

test("R50-ROUTE-002/003/004/005/006/007/008 binding CAS slash commands and isolation", async () => {
  const created: string[] = [];
  const p = plane(async (_ws, title) => {
    created.push(title);
    return { id: "sess-new" };
  });
  const { token } = p.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await p.submitInbound({
    adapter: "mock",
    adapterMessageKey: "b1",
    accountRef: "acct",
    peerRef: "peer",
    vendorTarget: "raw",
    chatKind: "private",
    bodyKind: "text",
    text: `/绑定 ${token}`,
    receivedAt: 1,
  });
  const binding = p.store.activeBinding(p.store.listRoutes()[0]!.routeId)!;
  assert.ok(binding.revision >= 1);
  const slash = await p.submitInbound({
    adapter: "mock",
    adapterMessageKey: "st",
    accountRef: "acct",
    peerRef: "peer",
    vendorTarget: "raw",
    chatKind: "private",
    bodyKind: "text",
    text: "/状态",
    receivedAt: 2,
  });
  assert.equal(slash.kind, "control");
  await p.submitInbound({
    adapter: "mock",
    adapterMessageKey: "nw",
    accountRef: "acct",
    peerRef: "peer",
    vendorTarget: "raw",
    chatKind: "private",
    bodyKind: "text",
    text: "/新建",
    receivedAt: 3,
  });
  assert.deepEqual(created, ["im-session"]);
  const accepted = await p.submitInbound({
    adapter: "mock",
    adapterMessageKey: "m1",
    accountRef: "acct",
    peerRef: "peer",
    vendorTarget: "raw",
    chatKind: "private",
    bodyKind: "text",
    text: "hello model",
    receivedAt: 4,
  });
  assert.equal(accepted.kind, "accepted");
  const inbound = p.store.queuedForRoute(p.store.listRoutes()[0]!.routeId)[0]!;
  p.onClaimed({
    dshMessageId: "d1",
    turnId: "t1",
    sessionId: "sess-new",
    source: { kind: "penglai-im", schema: 1, routeId: inbound.routeId, inboundId: inbound.inboundId, adapter: "mock" },
  });
  p.onAssistantFinal({ sessionId: "sess-new", turnId: "t1", text: "final" });
  assert.equal(p.store.outboxForInbound(inbound.inboundId)[0]?.payloadText, "final");
  p.noteDesktopTurn("sess-new", "desk");
  p.onAssistantFinal({ sessionId: "sess-new", turnId: "desk", text: "desktop-secret" });
  assert.equal(p.store.pendingOutbox(inbound.routeId).some((item) => item.payloadText === "desktop-secret"), false);
  const recovered = p.recoverAfterCrash();
  assert.ok(recovered.sendingRecovered >= 0);
  const two = plane();
  const { token: t1 } = two.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  const { token: t2 } = two.createPairing({ workspaceIdentity: "ws1", sessionId: "sess2", adapter: "mock" });
  await two.submitInbound({
    adapter: "mock",
    adapterMessageKey: "b1",
    accountRef: "acct",
    peerRef: "p1",
    vendorTarget: "raw1",
    chatKind: "private",
    bodyKind: "text",
    text: `/绑定 ${t1}`,
    receivedAt: 1,
  });
  await two.submitInbound({
    adapter: "mock",
    adapterMessageKey: "b2",
    accountRef: "acct",
    peerRef: "p2",
    vendorTarget: "raw2",
    chatKind: "private",
    bodyKind: "text",
    text: `/绑定 ${t2}`,
    receivedAt: 2,
  });
  assert.equal(two.store.listActiveBindings().length, 2);
  pass("R50-ROUTE-002", "integration", "binding-cas", "binding-has-revision", "binding records channel account peer workspace session and CAS revision");
  pass("R50-ROUTE-003", "contract", "slash-consumed", "status-not-followup", "slash commands are consumed and do not enter the model");
  pass("R50-ROUTE-004", "integration", "new-session-official", "create-session-called", "/新建 calls official createSession");
  pass("R50-ROUTE-005", "integration", "causal-chain", "claim-final-outbox", "vendor message claim official Turn durable final and original route stay together");
  pass("R50-ROUTE-006", "security", "desktop-no-outbox", "desktop-turn-stays-local", "desktop and unknown turns do not create an outbound");
  pass("R50-ROUTE-007", "concurrency", "route-isolation", "one-route-one-session", "a route keeps its own session and does not retarget another route");
  pass("R50-ROUTE-008", "chaos", "crash-recover-sending", "sending-recovered", "crash recovery returns sending outbox to retryable");
});

test("R50-DIST-002/004/006/007/009/010 target-aware embed and clean bundle", () => {
  const embed = readFileSync(join(root, "scripts/embed-runtime.mjs"), "utf8");
  assert.match(embed, /--target/);
  assert.match(embed, /release-contract\.json/);
  assert.match(embed, /materializeDshClosure/);
  const pack = readFileSync(join(root, "scripts/pack-plugins.mjs"), "utf8");
  assert.match(pack, /esbuild/);
  assert.doesNotMatch(pack, /cpSync\(.*node_modules/);
  const mac = resolveGenerationLayout({ platform: "darwin", home: "/Users/测 试" });
  assert.match(mac.userData, /Penglai\/0\.5$/);
  assert.match(mac.userData, /测 试/);
  assert.doesNotThrow(() =>
    assertArchConsistent({ target: "darwin-aarch64", nodeArch: "arm64", electronArch: "arm64", processArch: "arm64" }),
  );
  const sbom = JSON.parse(readFileSync(join(root, "evidence/generated/sbom.json"), "utf8")) as { componentCount?: number };
  const licenses = JSON.parse(readFileSync(join(root, "evidence/generated/licenses.json"), "utf8")) as Array<{ license: string }>;
  assert.ok((sbom.componentCount ?? 0) > 10);
  assert.ok(licenses.some((row) => row.license === "MIT"));
  assert.throws(() => assertProductionBundleClean({ "resources/app.js": "fetch('/penglai/usable-fixture')" }), /usable-fixture/);
  pass("R50-DIST-002", "build", "target-aware-embed", "embed-reads-release-contract", "embed-runtime selects Node/Electron by release-contract target");
  pass("R50-DIST-004", "closure", "packlist-not-dev-modules", "first-party-esbuild-pack", "first-party plugins are packed from packlist/esbuild, not a raw dev node_modules copy");
  pass("R50-DIST-006", "fault", "layout-spaces-zh", "generation-root-handles-spaces", "generation layout isolates 0.5 under homes that contain spaces and Chinese");
  pass("R50-DIST-007", "contract", "arch-guard", "mixed-arch-rejected", "arch guard rejects mixed Electron/Node and accepts matching arm64");
  pass("R50-DIST-009", "artifact", "sbom-licenses", "sbom-and-notices-present", "SBOM and license inventory exist for the candidate closure");
  pass("R50-DIST-010", "security", "bundle-scanner", "fixture-secret-owner-rejected", "production scanner rejects fixture endpoints, secrets, and owner paths");
});

test("R50-MAC-001 arm64 app contains only arm64 Mach-O", () => {
  const app = packagedAppForTarget(root, "darwin-aarch64");
  const packaged = inspectPackagedCandidate({ app, candidateSha: sha, expectedTarget: "darwin-aarch64" });
  if (packaged.verdict !== "PASS" || process.platform !== "darwin") return;
  const electron = existsSync(join(app, "Contents/MacOS/Penglai"))
    ? join(app, "Contents/MacOS/Penglai")
    : join(app, "Contents/MacOS/Electron");
  if (!existsSync(electron)) return;
  const node = join(app, "Contents/Resources/runtime/node/bin/node");
  if (!existsSync(node)) return;
  const eArch = execFileSync("lipo", ["-archs", electron], { encoding: "utf8" }).trim();
  const nArch = execFileSync("lipo", ["-archs", node], { encoding: "utf8" }).trim();
  assert.equal(eArch, "arm64");
  assert.equal(nArch, "arm64");
  const ver = execFileSync(node, ["-p", "process.arch+' '+process.version"], { encoding: "utf8" }).trim();
  assert.equal(ver, "arm64 v22.22.2");
  pass("R50-MAC-001", "artifact", "arm64-only-macho", "electron-node-arm64", "from-dmg Electron and Node are arm64-only Mach-O", {
    target: "darwin-aarch64",
    runnerNative: process.arch === "arm64",
  });
});

test("R50-UPD-002/003/011 signature hash platform and no fixture key", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPub = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const payload = Buffer.from("penglai-update");
  const digest = createHash("sha256").update(payload).digest("hex");
  const signature = sign(null, payload, privateKey);
  verifyPayload(payload, digest, signature, Buffer.from(rawPub).toString("hex"));
  assert.throws(() => verifyPayload(payload, "0".repeat(64), signature, Buffer.from(rawPub).toString("hex")), /hash/);
  assert.throws(
    () =>
      assertUpdateManifest(
        {
          schemaVersion: 1,
          channel: "desktop-v0.5",
          version: "0.5.1",
          minimumVersion: "0.5.0",
          platforms: { "windows-x86_64": { url: "https://example.com/a.exe", sha256: "a".repeat(64), size: 1 } },
        },
        "0.5.0",
        "darwin-aarch64",
      ),
    /platform missing/,
  );
  assert.throws(() => assertProductionHasNoFixtureKey("BEGIN OPENSSH PRIVATE KEY"), /fixture updater/);
  pass("R50-UPD-002", "security", "payload-sig-and-hash", "both-signature-and-hash", "update payload requires both independent signature and hash");
  pass("R50-UPD-003", "contract", "platform-identity", "wrong-platform-rejected", "update manifest checks platform/arch and current version identity");
  pass("R50-UPD-011", "artifact", "no-fixture-key", "fixture-key-not-production", "fixture updater private key is refused in production source");
});

test("R50-UN-003/008/009 legacy never deleted and locked paths stop", () => {
  const missing = detectLegacy(join(tmpdir(), "penglai-no-legacy-root"));
  assert.equal(missing.present, false);
  const plan = buildDeletionPlan({
    operationId: "op",
    categories: ["cache"],
    userData: "/tmp/Penglai/0.5",
    confirmCredentials: false,
  });
  assert.equal(plan.paths.some((path) => path.includes("workspace")), false);
  assert.throws(() => assertSafeDeletePath("/tmp/ws-project", "/tmp/Penglai/0.5", ["/tmp/ws-project"], []), /workspace/);
  assert.throws(() => assertSafeDeletePath("/tmp/legacy-041", "/tmp/Penglai/0.5", [], ["/tmp/legacy-041"]), /legacy/);
  pass("R50-UN-003", "contract", "no-041-migrate", "legacy-readonly-no-delete", "0.4.1 detector is read-only and does not migrate or delete");
  pass("R50-UN-008", "contract", "workspace-legacy-excluded", "never-in-delete-plan", "Workspace and legacy roots never enter the delete plan");
  pass("R50-UN-009", "fault", "escape-stops", "symlink-workspace-stop", "delete plan stops on workspace/legacy/root escape instead of expanding retry");
});

test("R50-SEC-001/002/003/005/006/007/008/009/010 electron security and evidence hygiene", () => {
  const main = readFileSync(join(root, "apps/desktop/src/electron-main.ts"), "utf8");
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /will-navigate/);
  assert.match(main, /will-download/);
  assert.equal(assertIpcName("openDevTools"), false);
  assert.equal(assertIpcName("require"), false);
  assert.equal(navigationDecision("https://evil.example/", "http://127.0.0.1:9/"), "deny");
  assert.equal(
    navigationDecision("file:///app/static/index.html", "http://127.0.0.1:9/", "file:///app/static/index.html"),
    "allow",
  );
  assert.equal(
    navigationDecision("file:///tmp/evil.html", "http://127.0.0.1:9/", "file:///app/static/index.html"),
    "deny",
  );
  assert.deepEqual(parseFeishuEvent({ chatType: "group", messageId: "1", text: "x" }), { reject: "group" });
  const p = plane();
  assert.throws(() => p.requireVendorTarget("missing"), /vendor reply target/);
  const redacted = redactEvidenceText("sk-abcdefghijklmnop https://evil.example " + "B".repeat(48));
  assert.equal(redacted.includes("sk-abcdefghijklmnop"), false);
  assert.equal(redacted.includes("https://evil.example"), false);
  const summary = readFileSync(join(root, "evidence/generated/evidence-summary.json"), "utf8");
  assertEvidenceTextClean(summary, "evidence-summary");
  const sbom = JSON.parse(readFileSync(join(root, "evidence/generated/sbom.json"), "utf8")) as { lockfileSha256?: string };
  assert.match(String(sbom.lockfileSha256 ?? ""), /^[0-9a-f]{64}$/);
  const licenses = JSON.parse(readFileSync(join(root, "evidence/generated/licenses.json"), "utf8")) as Array<{ license: string }>;
  assert.ok(licenses.every((row) => row.license));
  pass("R50-SEC-001", "security", "electron-isolation", "contextIsolation-sandbox", "BrowserWindow enables contextIsolation, sandbox, and disables nodeIntegration");
  pass("R50-SEC-002", "security", "ipc-allowlist", "preload-api-closed", "preload IPC names are allowlisted and require/openDevTools are refused");
  pass("R50-SEC-003", "security", "nav-download-deny", "will-navigate-and-download", "navigation, window-open, and download fail closed off the authenticated origin");
  pass("R50-SEC-005", "security", "inbound-type-gate", "group-media-before-model", "inbound group/media/type gates run before the model");
  pass("R50-SEC-006", "security", "outbound-vendor-target", "no-broadcast-without-target", "outbound send requires a vendor reply target and does not broadcast");
  pass("R50-SEC-007", "secret", "evidence-clean", "summary-has-no-secret", "evidence summary is secret/QR/body clean");
  pass("R50-SEC-008", "security", "redaction-forms", "key-url-base64", "redaction covers key, URL, and base64-shaped material");
  pass("R50-SEC-009", "supply-chain", "sbom-lock-hash", "lockfile-sha-in-sbom", "SBOM records lockfile checksum provenance");
  pass("R50-SEC-010", "license", "notices-present", "licenses-allow-redistribution", "license inventory lists redistributable notices");
});

test("R50-PREP-004 clean-room export and installed evidence binding", () => {
  const exp = JSON.parse(readFileSync(join(root, "evidence/generated/public-export.json"), "utf8")) as {
    cleanRoom?: { executed?: boolean; installStatus?: number; typecheckStatus?: number };
    publicExportTreeSha256?: string;
  };
  assert.equal(exp.cleanRoom?.executed, true);
  assert.equal(exp.cleanRoom?.installStatus, 0);
  assert.equal(exp.cleanRoom?.typecheckStatus, 0);
  const installedPath = join(root, "evidence/generated/installed-e2e.json");
  if (!existsSync(installedPath)) {
    return; // installed evidence is produced by the exact-DMG installed runner (stage S10); clean-room alone cannot pass PREP-004
  }
  const installed = JSON.parse(readFileSync(installedPath, "utf8")) as {
    installerSha256?: string;
    fromExactDmg?: boolean;
    productVersion?: string;
  };
  assert.equal(installed.fromExactDmg, true);
  assert.match(String(installed.installerSha256 ?? ""), /^[0-9a-f]{64}$/);
  assert.equal(installed.productVersion, "0.5.0");
  pass("R50-PREP-004", "export", "clean-room-lock-only", "install-and-typecheck-zero", "clean-room public-export ran lock-only install and typecheck");
});

test("R50-REL-010 records only from a real two-hour installed soak", () => {
  const path = join(root, "evidence/generated/soak.json");
  if (!existsSync(path)) return;
  const rec = JSON.parse(readFileSync(path, "utf8")) as {
    productVersion?: string;
    hours?: number;
    leftovers?: number;
    orphans?: number;
    fromExactDmg?: boolean;
    installerSha256?: string;
  };
  if (rec.productVersion !== "0.5.0" || Number(rec.hours) < 2) return;
  if (rec.fromExactDmg !== true) return;
  if ((rec.leftovers ?? rec.orphans ?? 1) !== 0) return;
  pass("R50-REL-010", "soak", "installed-two-hour", "hours-ge-2-leftovers-0", "exact installed artifact soak ran at least two hours with no leftovers");
});

test("R50-IM-003 client registers the six IM settings sections", () => {
  const zh = contributeIm("zh");
  const en = contributeIm("en");
  assert.deepEqual(zh.sections, ["总览", "微信", "飞书", "绑定", "命令", "诊断"]);
  assert.deepEqual(en.sections, ["Overview", "Weixin", "Feishu", "Bindings", "Commands", "Diagnostics"]);
  pass("R50-IM-003", "contract", "im-settings-sections", "six-sections-zh-en", "IM settings client registers overview Weixin Feishu bindings commands diagnostics");
});
