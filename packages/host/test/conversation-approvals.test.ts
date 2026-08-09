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
});
