import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { CredentialProvider } from "@deepseek-ai/dsh-credentials";
import { PenglaiError } from "@penglai/contracts";
import { finalAssistantText, isAgentHandle, unwrapAgent } from "./contracts.js";
import { MemoryCredentialProvider, credentialRef } from "./memory-credentials.js";

test("R2-UP-009 resume-shaped handle unwraps to Agent", () => {
  const agent = {
    id: "s",
    followup() {},
    steer() {},
    cancel() {},
    inbox: { remove() { return true; } },
  };
  const handle = { agent, async dispose() {} };
  assert.equal(isAgentHandle(handle), true);
  assert.equal(unwrapAgent(handle), agent);
  assert.equal(unwrapAgent(agent), agent);
  assert.throws(() => unwrapAgent({}), PenglaiError);
});

test("R2-UP-011 durable session/event is the final source", () => {
  const events = [
    { type: "assistant/message", turn: 2, message: { content: [{ type: "text", text: "hello" }] } },
    { type: "assistant/chunk", turn: 2 },
    { type: "turn/end", turn: 2 },
  ];
  assert.equal(finalAssistantText(events, 2), "hello");
  assert.equal(finalAssistantText(events.filter((e) => e.type !== "turn/end"), 2), undefined);
  assert.equal(finalAssistantText(events, 1), undefined);
});

test("R2-UP-006 memory provider is official CredentialProvider", async () => {
  const ctx = new Context();
  const mem = new MemoryCredentialProvider(ctx);
  assert.equal(mem instanceof CredentialProvider, true);
  const ref = credentialRef("DEEPSEEK_API_KEY");
  let updates = 0;
  ctx.on("credentials/reference-updated", () => {
    updates += 1;
  });
  await mem.set(ref, "canary-not-a-secret-for-git");
  const info = await mem.describe(ref);
  assert.equal(info.configured, true);
  assert.equal(info.writable, true);
  assert.equal("value" in info, false);
  const resolved = await mem.resolve(ref);
  assert.equal(resolved?.source, "memory");
  await mem.unset(ref);
  assert.equal((await mem.describe(ref)).configured, false);
  assert.ok(updates >= 2);
});
