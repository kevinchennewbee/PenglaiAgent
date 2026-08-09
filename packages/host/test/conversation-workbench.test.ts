import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildWorkbenchInjection,
  loadWorkbench,
  upsertTodo,
} from "../src/conversation-workbench.js";
import { _setPenglaiHomeForTest } from "../src/conversation-store.js";

let testHome: string;

beforeEach(() => {
  testHome = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-workbench-"));
  _setPenglaiHomeForTest(testHome);
});

afterEach(() => {
  _setPenglaiHomeForTest(null);
  fs.rmSync(testHome, { recursive: true, force: true });
});

describe("conversation TODO workbench", () => {
  it("preserves legacy rows without injecting or mutating their capabilities", () => {
    const conversationId = "conv_legacy";
    const dir = path.join(testHome, "conversations", conversationId);
    fs.mkdirSync(dir, { recursive: true });
    const legacySubagent = {
      id: "sub_old",
      title: "Old side episode",
      prompt: "legacy parallel claim",
      status: "running",
      createdAt: 1,
      updatedAt: 1,
    };
    const legacyJob = {
      id: "job_old",
      command: "touch legacy-should-not-run",
      cwd: testHome,
      status: "running",
      createdAt: 1,
      updatedAt: 1,
    };
    fs.writeFileSync(
      path.join(dir, "workbench.json"),
      JSON.stringify({
        todos: [],
        subagents: [legacySubagent],
        jobs: [legacyJob],
        updatedAt: 1,
      }),
    );

    expect(loadWorkbench(conversationId)).toMatchObject({
      subagents: [legacySubagent],
      jobs: [legacyJob],
    });
    const updated = upsertTodo(conversationId, {
      content: "safe TODO remains available",
      status: "pending",
    });
    expect(updated.todos[0].content).toBe("safe TODO remains available");
    expect(updated.subagents).toEqual([legacySubagent]);
    expect(updated.jobs).toEqual([legacyJob]);

    const injection = buildWorkbenchInjection(conversationId);
    expect(injection).toContain("safe TODO remains available");
    expect(injection).not.toContain("legacy parallel claim");
    expect(injection).not.toContain("legacy-should-not-run");
    expect(fs.existsSync(path.join(testHome, "legacy-should-not-run"))).toBe(false);
  });
});
