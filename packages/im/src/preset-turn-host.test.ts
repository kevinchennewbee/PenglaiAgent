import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { presetUnavailableUserText } from "@penglai/contracts";
import { OwnerApprovalBroker } from "@penglai/runtime";
import { createRuntime } from "./index.js";
import { PenglaiImHost } from "./host.js";
import { CredentialsServiceVault } from "./credentials-vault.js";
import { guidedAdapter, type InboundChannelEvent } from "./channel-adapter.js";

test("sidecar inbound followup RemoteError records PRESET_UNAVAILABLE and durable outbox copy", async () => {
  const dsh = {
    version: "0.1.5-rc.1",
    getAgent: () => ({
      id: "agent",
      followup() {
        const error = new Error("preset missing") as Error & { isDSHRemoteError: true; code: string };
        error.isDSHRemoteError = true;
        error.code = "agent-preset/not-found";
        throw error;
      },
      steer() {},
      cancel() {},
      inbox: { remove() { return true; } },
    }),
    listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
    async listSessions() {
      return [{ id: "s" }];
    },
    async describeSessionModels() {
      return {
        current: { provider: "deepseek", model: "deepseek-chat" },
        routable: true,
        sessionExists: true,
        groups: [],
      };
    },
  };
  const rt = createRuntime({ dbPath: ":memory:", host: dsh });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle", hasCredential: false }) } as never,
    { status: "idle", setupRequired: true } as never,
    new CredentialsServiceVault(undefined),
    {} as never,
    dsh,
  );
  const owner = new OwnerApprovalBroker(mkdtempSync(join(tmpdir(), "penglai-preset-owner-")), {
    dialog: async () => "approved",
  });
  host.attachOwner(owner);
  let receive!: (event: InboundChannelEvent) => void | Promise<void>;
  host.attachChannelAdapter({
    ...guidedAdapter("slack"),
    onInbound: (callback) => {
      receive = callback;
    },
  });
  const event: InboundChannelEvent = {
    channel: "slack",
    botId: "account-a",
    accountRef: "account-a",
    senderId: "owner-user",
    peerRef: "owner-hash",
    vendorTarget: "private-chat",
    vendorMessageId: "1",
    idempotencyKey: "slack:account-a:1",
    chatType: "private",
    provenPrivate: true,
    text: "hello",
  };
  await receive(event);
  const proposal = host.proposeBinding({
    action: "im.bind",
    objectId: "slack:account-a:owner-hash",
    workspaceId: "w",
    sessionId: "s",
  });
  const decision = await owner.requestOwnerApproval(proposal.actionId);
  if (decision.decision !== "approved") throw new Error("expected approval");
  host.createBinding({
    channel: "slack",
    accountId: "account-a",
    peerId: "owner-hash",
    workspaceId: "w",
    sessionId: "s",
    ownerActionId: proposal.actionId,
    receipt: decision.receipt,
  });
  await receive({ ...event, vendorMessageId: "2", idempotencyKey: "slack:account-a:2" });
  const route = rt.store.findRoute("slack", "account-a", "owner-hash");
  assert.ok(route);
  const presetItems = rt.store
    .pendingOutbox(route.routeId)
    .filter((row) => row.payloadText === presetUnavailableUserText());
  assert.equal(presetItems.length, 1);
  const card = (await host.getOverview()).channels.find((row) => row.channel === "slack");
  assert.equal(card?.error?.code, "PRESET_UNAVAILABLE");
  assert.match(card?.error?.message.en ?? "", /\/projects/);
  assert.equal(JSON.stringify(card?.error ?? {}).includes("preset missing"), false);
  assert.equal(rt.store.queuedWithoutDshId().length, 0);
  rt.store.close();
});
