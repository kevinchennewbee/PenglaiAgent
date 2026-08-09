/**
 * Conversation crash-recovery tests.
 *
 * Validates that a conversation transcript (transcript.jsonl) survives a
 * process crash and can be resumed. Durable work recovery (Task/Run state) is
 * covered by the product-store tests, since that state lives in the product
 * database.
 *
 * Isolation: the Penglai home dir is overridden to a temp dir per test, so no
 * real ~/.penglai data is touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Message, TextContent } from "@penglai/protocol";
import {
  saveMessage,
  loadMessages,
  listConversations,
  _setPenglaiHomeForTest,
} from "../src/conversation-store.js";
import { resumeConversation } from "../src/resume.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-crash-"));
  _setPenglaiHomeForTest(tmp);
});

afterEach(() => {
  _setPenglaiHomeForTest(null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

let seq = 0;
function userMsg(cid: string, text: string): Message {
  seq += 1;
  return {
    id: `msg_${seq}_u`,
    conversationId: cid,
    role: "user",
    createdAt: Date.now(),
    content: [{ type: "text", text } as TextContent],
  };
}

function assistantMsg(cid: string, text: string): Message {
  seq += 1;
  return {
    id: `msg_${seq}_a`,
    conversationId: cid,
    role: "assistant",
    createdAt: Date.now(),
    content: [{ type: "text", text } as TextContent],
  };
}

describe("crash recovery: transcript round-trip", () => {
  it("messages saved to JSONL reload identically", () => {
    const cid = "conv_jsonl";
    const m1 = userMsg(cid, "first");
    const m2 = assistantMsg(cid, "second");
    saveMessage(cid, m1);
    saveMessage(cid, m2);

    const loaded = loadMessages(cid);
    expect(loaded).toHaveLength(2);
    // Deep-equal: JSONL round-trip preserves all fields.
    expect(loaded).toEqual([m1, m2]);
  });

  it("a corrupt line is skipped instead of aborting the whole conversation", () => {
    const cid = "conv_corrupt";
    saveMessage(cid, userMsg(cid, "good"));
    const file = path.join(tmp, "conversations", cid, "transcript.jsonl");
    fs.appendFileSync(file, "{not json\n", "utf-8");

    const loaded = loadMessages(cid);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].conversationId).toBe(cid);
  });
});

describe("crash recovery: resume returns the persisted transcript", () => {
  it("resumeConversation reloads every message after a restart", async () => {
    const cid = "conv_resume";
    saveMessage(cid, userMsg(cid, "build the feature"));
    saveMessage(cid, assistantMsg(cid, "on it"));

    // A fresh process sees only disk; resume must return the full transcript.
    const { messages } = await resumeConversation(cid);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });

  it("resumeConversation returns an empty transcript for an unknown conversation", async () => {
    const { messages } = await resumeConversation("conv_unknown");
    expect(messages).toEqual([]);
  });
});

describe("crash recovery: conversation enumeration", () => {
  it("listConversations lists exactly the persisted conversation ids", () => {
    saveMessage("conv_a", userMsg("conv_a", "hi"));
    saveMessage("conv_b", userMsg("conv_b", "hi"));

    expect(listConversations()).toEqual(["conv_a", "conv_b"]);
  });
});
