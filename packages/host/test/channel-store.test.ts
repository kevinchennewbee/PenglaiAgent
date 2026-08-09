/**
 * 渠道持久化（schema v5）单测：白名单 upsert/移除、会话路由 upsert 保留旧值、
 * 任务路由、事件幂等去重（并发重投安全）、剪枝。全部打真实 ProductStore
 * （内存库），与生产同一份 SQL。
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProductStore } from "../src/storage/product-store.js";

describe("channel store: identities (白名单)", () => {
  it("allow upserts, deny removes, unknown users are absent by default", () => {
    const store = new ProductStore(":memory:");
    expect(store.getChannelIdentity("feishu", "ou_x")).toBeNull();

    const row = store.allowChannelIdentity({
      channel: "feishu",
      channelUserId: "ou_owner",
      identity: "owner",
      note: "主力机",
    });
    expect(row.identity).toBe("owner");
    expect(store.getChannelIdentity("feishu", "ou_owner")?.note).toBe("主力机");

    // upsert：同 channel+user 覆盖 identity/note。
    store.allowChannelIdentity({
      channel: "feishu",
      channelUserId: "ou_owner",
      identity: "boss",
    });
    expect(store.getChannelIdentity("feishu", "ou_owner")?.identity).toBe("boss");
    expect(store.getChannelIdentity("feishu", "ou_owner")?.note).toBeNull();
    expect(store.listChannelIdentities("feishu")).toHaveLength(1);

    // 渠道隔离：wechat 的同名 id 是另一行。
    expect(store.getChannelIdentity("wechat", "ou_owner")).toBeNull();

    expect(store.denyChannelIdentity("feishu", "ou_owner")).toBe(true);
    expect(store.denyChannelIdentity("feishu", "ou_owner")).toBe(false);
    expect(store.getChannelIdentity("feishu", "ou_owner")).toBeNull();
    store.close();
  });
});

describe("channel store: routes (会话/任务路由持久化)", () => {
  it("upserts the conversation route while preserving unset fields", () => {
    const store = new ProductStore(":memory:");
    store.upsertChannelRoute("feishu", "oc_1", { conversationId: "conv_a" });
    // 只改默认项目：conversationId 保留。
    store.upsertChannelRoute("feishu", "oc_1", { defaultProjectId: "proj_1" });
    const route = store.getChannelRoute("feishu", "oc_1");
    expect(route?.conversationId).toBe("conv_a");
    expect(route?.defaultProjectId).toBe("proj_1");
    // 只改会话：默认项目保留。
    store.upsertChannelRoute("feishu", "oc_1", { conversationId: "conv_b" });
    expect(store.getChannelRoute("feishu", "oc_1")?.defaultProjectId).toBe("proj_1");
    expect(store.listChannelRoutes("feishu")).toHaveLength(1);
    // 首次写入必须带 conversationId。
    expect(() => store.upsertChannelRoute("feishu", "oc_2", {})).toThrow(/conversationId/);
    store.close();
  });

  it("task routes resolve the progress-broadcast chat", () => {
    const store = new ProductStore(":memory:");
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-chan-ws-"));
    const project = store.createProject({ name: "p", rootPath: ws, trusted: true });
    const task = store.createTask({ projectId: project.id, title: "t", objective: "o" });
    expect(store.getChannelTaskChat("feishu", task.id)).toBeNull();
    store.putChannelTaskRoute("feishu", task.id, "oc_1");
    expect(store.getChannelTaskChat("feishu", task.id)).toBe("oc_1");
    // 改绑（同任务换了会话）。
    store.putChannelTaskRoute("feishu", task.id, "oc_2");
    expect(store.getChannelTaskChat("feishu", task.id)).toBe("oc_2");
    store.close();
    fs.rmSync(ws, { recursive: true, force: true });
  });
});

describe("channel store: event dedup (event_id 幂等)", () => {
  it("first delivery returns true, redelivery returns false, channels isolated", () => {
    const store = new ProductStore(":memory:");
    expect(store.recordChannelEvent("feishu", "evt_1")).toBe(true);
    expect(store.recordChannelEvent("feishu", "evt_1")).toBe(false);
    expect(store.recordChannelEvent("feishu", "evt_1")).toBe(false);
    expect(store.recordChannelEvent("wechat", "evt_1")).toBe(true);
    expect(store.recordChannelEvent("feishu", "evt_2")).toBe(true);
    store.close();
  });

  it("dedup rows survive a restart (same file) and prune drops old rows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-chan-db-"));
    const file = path.join(dir, "product.db");
    const first = new ProductStore(file);
    expect(first.recordChannelEvent("feishu", "evt_old")).toBe(true);
    // 把该行时间戳改老，验证剪枝。
    first.database
      .prepare("UPDATE channel_events SET created_at = ? WHERE event_id = ?")
      .run(Date.now() - 8 * 24 * 3600_000, "evt_old");
    first.recordChannelEvent("feishu", "evt_fresh");
    first.close();

    const second = new ProductStore(file);
    // 重启后重复事件仍然被判重（幂等持久化）。
    expect(second.recordChannelEvent("feishu", "evt_fresh")).toBe(false);
    const pruned = second.pruneChannelEvents(7 * 24 * 3600_000);
    expect(pruned).toBe(1);
    // 剪枝后旧 event_id 可重新记录（飞书早已不再重投）。
    expect(second.recordChannelEvent("feishu", "evt_old")).toBe(true);
    second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
