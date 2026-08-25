import assert from "node:assert/strict";
import test from "node:test";
import { apply, BudgetGate } from "./index.js";
import { createBudgetSettingsApi } from "./remote.js";

test("Budget blocks new Turns at the hard limit and ignores clock rollback", () => {
  let now = Date.parse("2026-08-16T12:00:00.000Z");
  const gate = new BudgetGate({ hardTokens: 100 }, () => now);
  assert.deepEqual(gate.inspect({ tokens: 10, priceTrusted: false }), { tokens: 10 });
  assert.deepEqual(gate.reserve({ tokens: 80, priceTrusted: false }), { warn: true });
  assert.throws(() => gate.reserve({ tokens: 30, priceTrusted: false }), /hard block/);
  gate.reserve({ tokens: 20, priceTrusted: false });
  assert.throws(() => gate.reserve({ tokens: 1, priceTrusted: false }), /hard block/);
  now = Date.parse("2026-08-15T12:00:00.000Z");
  assert.throws(() => gate.reserve({ tokens: 1, priceTrusted: false }), /hard block/);
  now = Date.parse("2026-08-17T12:00:00.000Z");
  assert.doesNotThrow(() => gate.reserve({ tokens: 10, priceTrusted: false }));
});

test("R50-BUDGET: durable ledger survives restart and still blocks", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { BudgetLedger } = await import("./ledger.js");
  const { BudgetGate } = await import("./service.js");
  const dir = mkdtempSync(join(tmpdir(), "penglai-budget-"));
  const path = join(dir, "ledger.sqlite3");
  let now = Date.parse("2026-08-16T12:00:00.000Z");
  {
    const ledger = new BudgetLedger(path);
    const gate = new BudgetGate({ hardTokens: 50 }, () => now, ledger);
    gate.reserve({ tokens: 40, priceTrusted: false }, "token-meter");
    ledger.close();
  }
  {
    const ledger = new BudgetLedger(path);
    const gate = new BudgetGate({ hardTokens: 50 }, () => now, ledger);
    assert.throws(() => gate.reserve({ tokens: 20, priceTrusted: false }), /hard block/);
    ledger.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

test("R50-BUDGET-001..005 production plugin gates the resolved official route and records actual usage", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "penglai-budget-apply-"));
  const previous = process.env.PENGLAI_USER_DATA;
  process.env.PENGLAI_USER_DATA = dir;
  const listeners = new Map<string, (...args: unknown[]) => unknown>();
  let measured = 80;
  let provided: unknown;
  const ctx = {
    tokenMeter: { measure: () => ({ totalTokens: measured }) },
    agents: { list: () => [] },
    workspaceRegistry: { list: () => [{ id: "w1", sessionIds: ["s1", "s2"] }] },
    on: (event: string, listener: (...args: unknown[]) => unknown) => listeners.set(event, listener),
    provide: (serviceName: string, value: unknown) => {
      assert.equal(serviceName, "penglaiBudget");
      provided = value;
    },
    effect: (_setup: () => () => void) => undefined,
  };
  try {
    const service = apply(ctx);
    assert.equal(provided, service);
    assert.equal(service.source, "official-token-meter");
    assert.equal(service.status().policies.length, 0, "fresh budget must be active but unlimited");
    service.setPolicy({ scope: "global", key: "*", hardTokens: 100, ownerConfirmed: true });
    let entered = 0;
    const first = await listeners.get("agent/request")?.(
      { agent: { id: "s1", session: {} }, turn: 1, step: 1 },
      async () => {
        entered += 1;
        return { provider: "deepseek", model: "chat" };
      },
    );
    assert.deepEqual(first, { provider: "deepseek", model: "chat" });
    assert.equal(entered, 1);
    listeners.get("session/event")?.(
      { id: "s1" },
      {
        type: "assistant/chunk",
        data: { turn: 1, step: 1, chunk: { type: "usage", usage: { inputTokens: 30, outputTokens: 10 } } },
      },
    );
    listeners.get("session/event")?.(
      { id: "s1" },
      {
        type: "assistant/message",
        data: {
          turn: 1,
          step: 1,
          usage: { inputTokens: 35, outputTokens: 15 },
          message: { source: { provider: "deepseek", model: "chat-v2" } },
        },
      },
    );
    assert.equal(service.status().tokens, 50, "final provider usage replaces the earlier chunk sample");
    const continued = await listeners.get("agent/request")?.(
      { agent: { id: "s1", session: {} }, turn: 1, step: 2 },
      async () => ({ provider: "deepseek", model: "chat-v2" }),
    );
    assert.deepEqual(continued, { provider: "deepseek", model: "chat-v2" }, "an admitted Turn may finish its tool loop");
    measured = 60;
    await assert.rejects(
      () =>
        listeners.get("agent/request")?.(
          { agent: { id: "s2", session: {} }, turn: 2, step: 1 },
          async () => {
            entered += 1;
            return { provider: "deepseek", model: "chat-v2" };
          },
        ) as Promise<unknown>,
      /budget hard block before model/,
    );
    assert.equal(entered, 2, "route resolution runs, but the blocked model invocation does not");
    assert.deepEqual(service.inspect({ tokens: 3, priceTrusted: false }), {
      tokens: 3,
      priceTrusted: false,
      money: null,
    });
    service.close();

    const resumed = apply(ctx);
    assert.equal(resumed.status().tokens, 50, "actual usage and policy survive restart");
    assert.equal(resumed.status().policies[0]?.hardTokens, 100);
    resumed.close();
  } finally {
    if (previous === undefined) delete process.env.PENGLAI_USER_DATA;
    else process.env.PENGLAI_USER_DATA = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("production Budget apply refuses missing app-private state or official services", () => {
  const previous = process.env.PENGLAI_USER_DATA;
  delete process.env.PENGLAI_USER_DATA;
  try {
    assert.throws(() => apply({}), /PENGLAI_USER_DATA/);
  } finally {
    if (previous !== undefined) process.env.PENGLAI_USER_DATA = previous;
  }
});

test("Budget settings uses only live Workspace and model route keys and never invents money", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { BudgetLedger } = await import("./ledger.js");
  const dir = mkdtempSync(join(tmpdir(), "penglai-budget-ui-"));
  const ledger = new BudgetLedger(join(dir, "budget.sqlite3"));
  try {
    const service = { status: () => ledger.status(Date.now()), setPolicy: (input: any) => ledger.setPolicy(input) };
    const api = createBudgetSettingsApi(service, { agents: { list: () => [{ options: { provider: "deepseek", model: "chat" } }] }, workspaceRegistry: { list: () => [{ id: "w1", title: "Workspace" }] } });
    assert.equal(api.status().money, null);
    assert.deepEqual(api.status().options.models, [{ provider: "deepseek", model: "chat", key: "deepseek/chat" }]);
    assert.throws(() => api.setPolicy({ scope: "workspace", key: "missing", hardTokens: 1, ownerConfirmed: true }), /not live/);
    assert.throws(
      () => api.setPolicy({ scope: "global", key: "renderer-choice", hardTokens: 100, ownerConfirmed: true }),
      /Owner confirmation/,
    );
  } finally { ledger.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("Budget client registers a real official settings tab and labels untrusted pricing", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(source, /settings\.section/);
  assert.match(source, /data-penglai-budget/);
  assert.match(source, /penglaiBudgetSettings/);
  assert.match(source, /无可信价格|trusted pricing/);
  assert.doesNotMatch(source, /localStorage|indexedDB/);
});

test("budget blocks a new Turn before next() when the agent declares its model route", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "penglai-budget-pre-"));
  const previous = process.env.PENGLAI_USER_DATA;
  process.env.PENGLAI_USER_DATA = dir;
  const listeners = new Map<string, (...args: unknown[]) => unknown>();
  let measured = 100;
  const ctx = {
    tokenMeter: { measure: () => ({ totalTokens: measured }) },
    agents: { list: () => [] },
    workspaceRegistry: { list: () => [{ id: "w1", sessionIds: ["s1"] }] },
    on: (event: string, listener: (...args: unknown[]) => unknown) => listeners.set(event, listener),
    provide: () => undefined,
    effect: () => undefined,
  };
  try {
    const service = apply(ctx);
    service.setPolicy({ scope: "global", key: "*", hardTokens: 50, ownerConfirmed: true });
    let entered = 0;
    await assert.rejects(
      () =>
        listeners.get("agent/request")?.(
          {
            agent: { id: "s1", session: {}, options: { provider: "deepseek", model: "chat" } },
            turn: 1,
            step: 1,
          },
          async () => {
            entered += 1;
            return { provider: "deepseek", model: "chat" };
          },
        ) as Promise<unknown>,
      /budget hard block before model/,
    );
    assert.equal(entered, 0, "a declared model route must be blocked before next() runs");
    service.close();
  } finally {
    if (previous === undefined) delete process.env.PENGLAI_USER_DATA;
    else process.env.PENGLAI_USER_DATA = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
