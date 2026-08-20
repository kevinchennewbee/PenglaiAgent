import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { LlmRuntime } from "@deepseek-ai/dsh-llm";
import { cardsFromOfficialDirectory } from "./onboarding.js";
import { apply, R2_CATALOG } from "./index.js";
import { installLoopbackAdapter, LOOPBACK_PROVIDER } from "./loopback-llm.js";

test("R50-ONB-003/006 real LlmRuntime listProviders includes isolated loopback after install", async () => {
  process.env.PENGLAI_LOOPBACK_LLM = "1";
  const ctx = new Context();
  const llm = new LlmRuntime(ctx);
  try {
    assert.equal(typeof llm.registerAdapter, "function");
    installLoopbackAdapter({
      registerAdapter: (providers, adapter) =>
        llm.registerAdapter(providers, adapter),
      registerConfigurableProviders: (entries) =>
        llm.registerConfigurableProviders(entries),
    });
    const active = llm.listProviders();
    const directory = llm.listConfigurableProviders();
    assert.ok(
      active.some((p: { id?: string }) => p.id === LOOPBACK_PROVIDER),
      `listProviders missing loopback: ${JSON.stringify(active)}`,
    );
    assert.ok(
      directory.some(
        (p: { provider?: string }) => p.provider === LOOPBACK_PROVIDER,
      ),
      `listConfigurableProviders missing loopback: ${JSON.stringify(directory)}`,
    );
    const cards = cardsFromOfficialDirectory({
      providers: [
        ...directory,
        ...active,
        { id: "deepseek", protocol: "deepseek" },
      ],
    });
    assert.equal(
      cards.some((c) => c.id === LOOPBACK_PROVIDER),
      false,
    );
    assert.ok(cards.some((c) => c.id === "deepseek"));
  } finally {
    delete process.env.PENGLAI_LOOPBACK_LLM;
  }
});

test("R50-ONB-006 plugin-center host injects official agents for nonce Turn", async () => {
  const { inject } = await import("./index.js");
  assert.ok(
    inject.includes("llm"),
    "loopback registerAdapter needs official llm",
  );
  assert.ok(inject.includes("agents"), "nonce Turn needs official agents");
  assert.ok(
    inject.includes("credentials"),
    "BYOK descriptor needs official credentials",
  );
  assert.ok(
    inject.includes("settings"),
    "appearance persistence needs official settings",
  );
  assert.ok(
    inject.includes("workspaceRegistry"),
    "first conversation needs the official workspace registry",
  );
});

test("production plugin-center apply does not register loopback even when probe env is set", async () => {
  process.env.PENGLAI_INSTALLED_PROBE = "/tmp/penglai-probe.json";
  process.env.PENGLAI_USER_DATA = mkdtempSync(join(tmpdir(), "penglai-center-loop-"));
  process.env.PENGLAI_PLUGINS_DIR = join(process.env.PENGLAI_USER_DATA, "bundled-plugins");
  mkdirSync(process.env.PENGLAI_PLUGINS_DIR, { recursive: true });
  const entries = R2_CATALOG.map((entry) => {
    const bytes = Buffer.from(`fixture:${entry.id}`);
    writeFileSync(join(process.env.PENGLAI_PLUGINS_DIR!, entry.packageFile), bytes);
    return {
      ...entry,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      target: "darwin-arm64" as const,
      hasClient: ["@penglai/plugin-center", "@penglai/im", "@penglai/asr", "@penglai/moss-tts"].includes(entry.id),
    };
  });
  writeFileSync(
    join(process.env.PENGLAI_PLUGINS_DIR, "catalog.json"),
    JSON.stringify({ schema: 2, target: "darwin-arm64", entries }),
  );
  const ctx = new Context();
  const llm = new LlmRuntime(ctx);
  try {
    apply(
      Object.assign(ctx, {
        pluginInventory: { list: () => [] },
        llm,
      }),
    );
    const active = llm.listProviders();
    assert.equal(
      active.some((p: { id?: string }) => p.id === LOOPBACK_PROVIDER),
      false,
      `production apply() must not install loopback: ${JSON.stringify(active)}`,
    );
  } finally {
    await ctx.fiber.dispose();
    delete process.env.PENGLAI_INSTALLED_PROBE;
    delete process.env.PENGLAI_PLUGINS_DIR;
    delete process.env.PENGLAI_USER_DATA;
  }
});
