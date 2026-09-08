import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnerApprovalBroker } from "@penglai/runtime";
import { createRuntime } from "./index.js";
import { PenglaiImHost } from "./host.js";
import { CredentialsServiceVault } from "./credentials-vault.js";
import { guidedAdapter, type InboundChannelEvent } from "./channel-adapter.js";

for (const channel of ["dingtalk", "wecom", "qq", "slack", "telegram", "discord"] as const) {
  test(`${channel}: private transport alone never authorizes a sender; exact Owner binding does`, async () => {
    const dsh = { version: "0.1.3-alpha.2", getAgent: () => undefined, listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }] };
    const rt = createRuntime({ dbPath: ":memory:", host: dsh });
    const host = new PenglaiImHost(rt.store, rt.plane,
      { health: () => ({ authState: "idle", hasCredential: false }) } as never,
      { status: "idle", setupRequired: true } as never,
      new CredentialsServiceVault(undefined), {} as never, dsh);
    const owner = new OwnerApprovalBroker(mkdtempSync(join(tmpdir(), "penglai-peer-owner-")), { dialog: async () => "approved" });
    host.attachOwner(owner);
    let receive!: (event: InboundChannelEvent) => void | Promise<void>;
    host.attachChannelAdapter({ ...guidedAdapter(channel), onInbound: (callback) => { receive = callback; } });
    let submissions = 0;
    rt.plane.submitInbound = async () => { submissions++; return { kind: "accepted", text: "queued" }; };
    const event: InboundChannelEvent = {
      channel, botId: "account-a", accountRef: "account-a", senderId: "owner-user", peerRef: "owner-hash",
      vendorTarget: "private-chat", vendorMessageId: "1", idempotencyKey: `${channel}:account-a:1`,
      chatType: "private", provenPrivate: true, text: "private message",
    };
    await receive(event);
    assert.equal(submissions, 0);
    assert.equal(rt.store.listRoutes().length, 0);
    assert.equal(host.listBindableRoutes().length, 1);
    const proposal = host.proposeBinding({ action: "im.bind", objectId: `${channel}:account-a:owner-hash`, workspaceId: "w", sessionId: "s" });
    const decision = await owner.requestOwnerApproval(proposal.actionId);
    if (decision.decision !== "approved") throw new Error("expected approval");
    host.createBinding({ channel, accountId: "account-a", peerId: "owner-hash", workspaceId: "w", sessionId: "s", ownerActionId: proposal.actionId, receipt: decision.receipt });
    await receive(event);
    assert.equal(submissions, 1);
    for (const changed of [{ accountRef: "account-b" }, { peerRef: "attacker-hash", senderId: "attacker" }, { vendorTarget: "other-chat" }]) {
      await receive({ ...event, ...changed, vendorMessageId: "2", idempotencyKey: `${channel}:different:2` });
      assert.equal(submissions, 1);
    }
    const binding = rt.store.listActiveBindings()[0]!;
    rt.store.revokeBinding(binding.routeId, new Date().toISOString());
    await receive({ ...event, vendorMessageId: "3", idempotencyKey: `${channel}:account-a:3` });
    assert.equal(submissions, 1);
    rt.store.close();
  });
}
