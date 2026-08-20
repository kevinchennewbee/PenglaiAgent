import assert from "node:assert/strict";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";

test("R50-ONB-006 loopback llm refuses production host without isolated probe env", async () => {
  const prevProbe = process.env.PENGLAI_INSTALLED_PROBE;
  const prevLoop = process.env.PENGLAI_LOOPBACK_LLM;
  delete process.env.PENGLAI_INSTALLED_PROBE;
  delete process.env.PENGLAI_LOOPBACK_LLM;
  const { assertLoopbackAllowed, installLoopbackAdapter } = await import("./loopback-llm.js");
  assert.throws(() => assertLoopbackAllowed(), PenglaiError);
  assert.throws(() => installLoopbackAdapter({ registerAdapter() {} }), /isolated probe|SECURITY_POLICY/);
  if (prevProbe !== undefined) process.env.PENGLAI_INSTALLED_PROBE = prevProbe;
  if (prevLoop !== undefined) process.env.PENGLAI_LOOPBACK_LLM = prevLoop;
});

test("R50-ONB-006/009 isolated loopback stream echoes official nonce through adapter.stream", async () => {
  process.env.PENGLAI_LOOPBACK_LLM = "1";
  const { installLoopbackAdapter, LOOPBACK_PROVIDER, LOOPBACK_MODEL, createLoopbackAdapter } = await import(
    "./loopback-llm.js"
  );
  const registered: string[] = [];
  const directory: unknown[] = [];
  const installed = installLoopbackAdapter({
    registerAdapter(providers: string[]) {
      registered.push(...providers);
      return () => undefined;
    },
    registerConfigurableProviders(entries: unknown[]) {
      directory.push(...entries);
      return () => undefined;
    },
  });
  assert.equal(installed.provider, LOOPBACK_PROVIDER);
  assert.equal(installed.model, LOOPBACK_MODEL);
  assert.deepEqual(registered, [LOOPBACK_PROVIDER]);
  assert.equal(directory.length, 1);
  const adapter = createLoopbackAdapter();
  const nonce = "n-loop-1";
  const chunks: Array<{ type: string; text?: string }> = [];
  for await (const chunk of adapter.stream({
    provider: LOOPBACK_PROVIDER,
    model: LOOPBACK_MODEL,
    messages: [{ role: "user", content: [{ type: "text", text: `PENGLAI_OK_${nonce}` }] }],
  })) {
    chunks.push(chunk as { type: string; text?: string });
  }
  const text = chunks
    .filter((c) => c.type === "text-delta")
    .map((c) => c.text ?? "")
    .join("");
  assert.ok(text.includes(nonce), "loopback must echo the official nonce, not a health shortcut");
  assert.ok(chunks.some((c) => c.type === "finish"));
  delete process.env.PENGLAI_LOOPBACK_LLM;
});

test("R50-ONB-003 ensureLoopbackFromLlm is a no-op without probe env", async () => {
  const prevProbe = process.env.PENGLAI_INSTALLED_PROBE;
  const prevLoop = process.env.PENGLAI_LOOPBACK_LLM;
  delete process.env.PENGLAI_INSTALLED_PROBE;
  delete process.env.PENGLAI_LOOPBACK_LLM;
  const { ensureLoopbackFromLlm } = await import("./loopback-llm.js");
  const notes: Array<Record<string, unknown>> = [];
  assert.equal(ensureLoopbackFromLlm({ registerAdapter() {} }, (info) => notes.push(info)), undefined);
  assert.equal(notes[0]?.allowed, false);
  if (prevProbe !== undefined) process.env.PENGLAI_INSTALLED_PROBE = prevProbe;
  if (prevLoop !== undefined) process.env.PENGLAI_LOOPBACK_LLM = prevLoop;
});

test("production plugin-center host does not install loopback", async () => {
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8"));
  assert.equal(src.includes("ensureLoopbackFromLlm"), false);
  assert.equal(src.includes("penglai-loopback"), false);
  assert.equal(src.includes("/penglai/usable-fixture"), false);
});
