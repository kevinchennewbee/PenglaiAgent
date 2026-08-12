import { describe, expect, it, vi } from "vitest";
import { ConversationApprovalService } from "../src/conversation-approvals.js";

describe("ConversationApprovalService", () => {
  it("holds until approve and resumes", async () => {
    const publish = vi.fn();
    const service = new ConversationApprovalService(publish);
    const pending = service.request("conv_1", "ep_1", {
      toolName: "bash",
      args: { command: "git push" },
      decision: {
        allowed: false,
        code: "needs_approval",
        level: "L3",
        reason: "outbound",
        approval: { capability: "l3:outbound", action: "bash: git push" },
      },
    });
    expect(service.list({ conversationId: "conv_1" })).toHaveLength(1);
    const row = service.list({ conversationId: "conv_1" })[0]!;
    const decided = service.approve({
      approvalId: row.id,
      decidedBy: "desktop:owner",
    });
    expect(decided.status).toBe("approved");
    await expect(pending).resolves.toEqual({ approved: true, note: "approved" });
    expect(service.list({ conversationId: "conv_1", status: "pending" })).toHaveLength(0);
    expect(publish).toHaveBeenCalled();
  });

  it("cancelForConversation denies open gates", async () => {
    const service = new ConversationApprovalService();
    const pending = service.request("conv_2", null, {
      toolName: "bash",
      args: { command: "rm -rf x" },
      decision: {
        allowed: false,
        code: "needs_approval",
        level: "L3",
        reason: "delete",
        approval: { capability: "l3:delete", action: "bash: rm" },
      },
    });
    expect(service.cancelForConversation("conv_2", "aborted")).toBe(1);
    await expect(pending).resolves.toMatchObject({ approved: false });
  });

  it("C7: L2 rememberSession grants same capability for this conversation only", async () => {
    const service = new ConversationApprovalService();
    const first = service.request("conv_a", "ep1", {
      toolName: "write",
      args: { path: "a.ts" },
      decision: {
        allowed: false,
        code: "needs_approval",
        level: "L2",
        reason: "edit",
        approval: { capability: "l2:modify-existing", action: "write a.ts" },
      },
    });
    const row = service.list({ conversationId: "conv_a" })[0]!;
    service.approve({
      approvalId: row.id,
      decidedBy: "desktop:owner",
      rememberSession: true,
    });
    await expect(first).resolves.toMatchObject({ approved: true });

    // Same conversation + capability: auto-allowed via session grant.
    const second = await service.request("conv_a", "ep2", {
      toolName: "write",
      args: { path: "b.ts" },
      decision: {
        allowed: false,
        code: "needs_approval",
        level: "L2",
        reason: "edit",
        approval: { capability: "l2:modify-existing", action: "write b.ts" },
      },
    });
    expect(second).toMatchObject({
      approved: true,
      note: expect.stringContaining("session grant"),
    });
    expect(service.list({ conversationId: "conv_a", status: "pending" })).toHaveLength(0);

    // New conversation does not inherit the grant.
    const otherPending = service.request("conv_b", "ep3", {
      toolName: "write",
      args: { path: "c.ts" },
      decision: {
        allowed: false,
        code: "needs_approval",
        level: "L2",
        reason: "edit",
        approval: { capability: "l2:modify-existing", action: "write c.ts" },
      },
    });
    expect(service.list({ conversationId: "conv_b", status: "pending" })).toHaveLength(1);
    service.reject({
      approvalId: service.list({ conversationId: "conv_b" })[0]!.id,
      decidedBy: "desktop:owner",
    });
    await expect(otherPending).resolves.toMatchObject({ approved: false });
  });

  it("C7: L3 rememberSession never grants; every call still asks", async () => {
    const service = new ConversationApprovalService();
    const first = service.request("conv_l3", "ep1", {
      toolName: "bash",
      args: { command: "curl x" },
      decision: {
        allowed: false,
        code: "needs_approval",
        level: "L3",
        reason: "network",
        approval: { capability: "l3:network", action: "bash curl" },
      },
    });
    const row = service.list({ conversationId: "conv_l3" })[0]!;
    service.approve({
      approvalId: row.id,
      decidedBy: "desktop:owner",
      rememberSession: true,
    });
    await expect(first).resolves.toMatchObject({ approved: true });

    const second = service.request("conv_l3", "ep2", {
      toolName: "bash",
      args: { command: "curl y" },
      decision: {
        allowed: false,
        code: "needs_approval",
        level: "L3",
        reason: "network",
        approval: { capability: "l3:network", action: "bash curl" },
      },
    });
    // Still pending — L3 remember is a no-op.
    expect(service.list({ conversationId: "conv_l3", status: "pending" })).toHaveLength(1);
    service.reject({
      approvalId: service.list({ conversationId: "conv_l3" })[0]!.id,
      decidedBy: "desktop:owner",
    });
    await expect(second).resolves.toMatchObject({ approved: false });
  });
});
