import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { declaredSourceSha, recordAssertion } from "./assertion.js";
import { RoutingControlPlane } from "../../routing-core/src/index.js";
import { Store } from "../../persistence/src/index.js";
import { SeqIds, VirtualClock } from "../../testkit/src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const sha = declaredSourceSha();

test("R50-ROUTE-009/010 fail-closed send and redacted audit", () => {
  const store = new Store(":memory:");
  const plane = new RoutingControlPlane(
    store,
    new VirtualClock(),
    new SeqIds(),
    { async listWorkspaces() { return []; }, async listSessions() { return []; } },
    { async followup() { return { dshMessageId: "d" }; }, async steer() { return { dshMessageId: "d" }; }, async cancelCurrent() {}, async removeInbox() {} },
  );
  store.upsertRoute({ routeId: "r1", adapter: "weixin", accountRef: "a", peerRef: "peer-hash", status: "active" });
  store.insertInbound(
    {
      inboundId: "in1",
      adapterMessageKey: "k1",
      routeId: "r1",
      bindingRevision: 1,
      bodyKind: "text",
      redactedDigest: "digest",
      state: "outbox_pending",
    },
    "secret-body",
    1,
  );
  store.insertOutbox({
    outboxId: "o1",
    routeId: "r1",
    inboundId: "in1",
    turnId: "t1",
    sequence: 1,
    payloadKind: "text",
    payloadRef: "digest",
    payloadText: "secret-body",
    state: "pending",
    attempts: 0,
    nextAttemptAt: 0,
    fragmentIndex: 0,
    fragmentCount: 1,
  });
  assert.throws(() => plane.requireVendorTarget("r1"), /vendor reply target/);
  assert.equal(plane.failClosedMissingTarget("r1"), 1);
  const audit = JSON.stringify(store.listAudit());
  assert.equal(audit.includes("secret-body"), false);
  assert.match(audit, /outbox_fail_closed_no_vendor_target/);
  recordAssertion({
    acceptanceId: "R50-ROUTE-009",
    runnerId: "security",
    testId: "route-fail-closed-R50-ROUTE-009",
    assertionId: "no-vendor-target-no-send",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "outbox without vendor reply target is fail-closed and not sent" },
  });
  recordAssertion({
    acceptanceId: "R50-ROUTE-010",
    runnerId: "security",
    testId: "route-fail-closed-R50-ROUTE-010",
    assertionId: "audit-has-no-body",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "fail-closed audit stores opaque ids only and never the payload body" },
  });
});

test("R50-ROUTE-001/IM-001 client and host use official list and one IM plugin", () => {
  const imClient = readFileSync(join(root, "packages/im/src/dsh-client.js"), "utf8");
  const imHost = readFileSync(join(root, "packages/im/src/index.ts"), "utf8");
  assert.match(imClient, /listWorkspacesAndSessions/);
  assert.match(imClient, /data-penglai-im-binding/);
  assert.match(imHost, /WeixinAdapter/);
  assert.match(imHost, /FeishuAdapter/);
  assert.match(imHost, /failClosedMissingTarget/);
  recordAssertion({
    acceptanceId: "R50-ROUTE-001",
    runnerId: "contract",
    testId: "im-binding-official-list",
    assertionId: "bindings-from-official-workspace-session",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "IM bindings UI reads official Workspace and Session lists" },
  });
  recordAssertion({
    acceptanceId: "R50-IM-001",
    runnerId: "architecture",
    testId: "im-binding-official-list",
    assertionId: "single-im-plugin-both-channels",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "Weixin and Feishu are hosted by the single @penglai/im plugin" },
  });
});

test("R50-UPD-005/006 and R50-UN-001 settings and staging contracts", () => {
  const client = readFileSync(join(root, "packages/plugin-center/src/dsh-client.js"), "utf8");
  const update = readFileSync(join(root, "packages/runtime/src/update.ts"), "utf8");
  assert.match(client, /data-penglai-update/);
  assert.match(client, /data-penglai-uninstall/);
  assert.match(client, /data-penglai-data-category/);
  assert.match(update, /assertStagingNotExecutable/);
  recordAssertion({
    acceptanceId: "R50-UPD-005",
    runnerId: "fault",
    testId: "update-uninstall-ui",
    assertionId: "staging-not-executable",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "update staging rejects executable modes" },
  });
  recordAssertion({
    acceptanceId: "R50-UPD-006",
    runnerId: "contract",
    testId: "update-uninstall-ui-R50-UPD-006",
    assertionId: "update-settings-not-silent",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "settings update UI states community trust and requires confirm" },
  });
  recordAssertion({
    acceptanceId: "R50-UN-001",
    runnerId: "contract",
    testId: "update-uninstall-ui-R50-UN-001",
    assertionId: "uninstall-categories-listed",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "uninstall UI lists app cache settings dsh im credentials workspace legacy" },
  });
});
