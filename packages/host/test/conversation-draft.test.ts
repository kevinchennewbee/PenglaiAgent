import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveConversationDraftRoot } from "../src/conversation-draft.js";

const cleanup: string[] = [];

afterEach(() => {
  for (const target of cleanup.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

function temporaryDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(directory);
  return directory;
}

describe("conversation draft isolation", () => {
  it("creates one direct, canonical child beneath the Host-owned drafts root", () => {
    const dataDir = temporaryDirectory("penglai-draft-data-");
    const root = resolveConversationDraftRoot(dataDir, "conv_owner");
    expect(root).toBe(fs.realpathSync(path.join(dataDir, "drafts", "conv_owner")));
    if (process.platform !== "win32") {
      expect(fs.statSync(dataDir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(dataDir, "drafts")).mode & 0o777).toBe(0o700);
      expect(fs.statSync(root!).mode & 0o777).toBe(0o700);
    }
  });

  it("rejects traversal and overlong conversation ids", () => {
    const dataDir = temporaryDirectory("penglai-draft-id-");
    expect(() => resolveConversationDraftRoot(dataDir, "../escape")).toThrow(
      /invalid conversationId/,
    );
    expect(() => resolveConversationDraftRoot(dataDir, "x".repeat(129))).toThrow(
      /invalid conversationId/,
    );
  });

  it("rejects a pre-existing symlink used as the shared drafts root", () => {
    const dataDir = temporaryDirectory("penglai-draft-link-data-");
    const outside = temporaryDirectory("penglai-draft-link-outside-");
    fs.symlinkSync(
      outside,
      path.join(dataDir, "drafts"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => resolveConversationDraftRoot(dataDir, "conv_owner")).toThrow(
      /drafts root must not be a symlink/,
    );
  });

  it("rejects a pre-existing symlink used as a conversation root", () => {
    const dataDir = temporaryDirectory("penglai-conv-link-data-");
    const outside = temporaryDirectory("penglai-conv-link-outside-");
    fs.mkdirSync(path.join(dataDir, "drafts"));
    fs.symlinkSync(
      outside,
      path.join(dataDir, "drafts", "conv_owner"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => resolveConversationDraftRoot(dataDir, "conv_owner")).toThrow(
      /draft root must not be a symlink/,
    );
  });

  it("never converges conversation ids that differ only by case", () => {
    const dataDir = temporaryDirectory("penglai-draft-case-");
    const first = resolveConversationDraftRoot(dataDir, "Conv_Owner");
    try {
      const second = resolveConversationDraftRoot(dataDir, "conv_owner");
      // A case-sensitive filesystem creates two distinct directories.
      expect(second).not.toBe(first);
    } catch (error) {
      // A case-insensitive filesystem must reject the alias instead.
      expect(String(error)).toMatch(/not an isolated directory/);
    }
  });
});
