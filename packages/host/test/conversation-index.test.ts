import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _setPenglaiHomeForTest,
  listConversationIndex,
  saveConversationMeta,
  saveMessage,
} from "../src/conversation-store.js";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-conv-index-"));
  _setPenglaiHomeForTest(home);
});

afterEach(() => {
  _setPenglaiHomeForTest(null);
  fs.rmSync(home, { recursive: true, force: true });
});

describe("listConversationIndex", () => {
  it("lists from meta.json without needing full transcripts", () => {
    saveConversationMeta({
      id: "conv_a",
      title: "Alpha",
      modelProfileId: "grok",
      mode: "chat",
      updatedAt: 200,
      createdAt: 100,
    });
    saveConversationMeta({
      id: "conv_b",
      title: "Beta",
      modelProfileId: "grok",
      mode: "work",
      activeTaskId: "task_1",
      updatedAt: 300,
      createdAt: 150,
    });
    // Transcript only — still appears via directory fallback.
    saveMessage("conv_c", {
      id: "msg_1",
      conversationId: "conv_c",
      role: "user",
      createdAt: 50,
      content: [{ type: "text", text: "hello" }],
    });

    const rows = listConversationIndex();
    expect(rows.map((r) => r.id)).toEqual(
      expect.arrayContaining(["conv_a", "conv_b", "conv_c"]),
    );
    const a = rows.find((r) => r.id === "conv_a");
    const b = rows.find((r) => r.id === "conv_b");
    expect(a?.title).toBe("Alpha");
    expect(a?.modelProfileId).toBe("grok");
    expect(b?.title).toBe("Beta");
    expect(b?.activeTaskId).toBe("task_1");
    // meta-backed rows sort by updatedAt (b=300 > a=200)
    const metaOnly = rows.filter((r) => r.id === "conv_a" || r.id === "conv_b");
    expect(metaOnly[0]?.id).toBe("conv_b");
  });
});
