/**
 * Durable model profiles (profiles-store) + one-shot smoke test
 * (model-smoke) — the setup wizard's host-side foundation.
 *
 * The smoke tests reuse the scripted MockModelServer test fixture
 * boundary): ok / 401 / 404 / timeout / unreachable are all real HTTP
 * exchanges against a loopback endpoint, never a stubbed fetch.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPersistedProfiles,
  profilesFilePath,
  savePersistedProfile,
} from "../src/profiles-store.js";
import { smokeTestModel } from "../src/model-smoke.js";
import { MockModelServer } from "./fixtures/mock-model-server.js";
import { startServer, type StartedServer } from "../src/server.js";
import { _setPenglaiHomeForTest } from "../src/conversation-store.js";

const cleanup: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

afterEach(() => {
  while (cleanup.length > 0) {
    fs.rmSync(cleanup.pop()!, { recursive: true, force: true });
  }
});

describe("profiles-store: durable BYOK profiles", () => {
  it("round-trips a profile with a literal key and 0600 permissions", () => {
    const dataDir = tempDir("penglai-profiles-");
    savePersistedProfile(dataDir, {
      id: "deepseek",
      label: "DeepSeek",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKeyEnv: "",
      apiKey: "sk-secret",
    });
    const loaded = loadPersistedProfiles(dataDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      id: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "sk-secret",
    });
    const mode = fs.statSync(profilesFilePath(dataDir)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("upserts by id and keeps an env-reference profile free of key material", () => {
    const dataDir = tempDir("penglai-profiles-");
    savePersistedProfile(dataDir, {
      id: "glm",
      label: "GLM",
      provider: "glm",
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
      model: "glm-4.6",
      apiKeyEnv: "ZAI_API_KEY",
    });
    savePersistedProfile(dataDir, {
      id: "glm",
      label: "GLM (new endpoint)",
      provider: "glm",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      model: "glm-4.6",
      apiKeyEnv: "ZAI_API_KEY",
    });
    const loaded = loadPersistedProfiles(dataDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(loaded[0].apiKeyEnv).toBe("ZAI_API_KEY");
    expect(loaded[0].apiKey).toBeUndefined();
    // No key material anywhere in the file.
    expect(fs.readFileSync(profilesFilePath(dataDir), "utf-8")).not.toContain("sk-");
  });

  it("tolerates a missing or corrupt profiles file", () => {
    const dataDir = tempDir("penglai-profiles-");
    expect(loadPersistedProfiles(dataDir)).toEqual([]);
    fs.writeFileSync(profilesFilePath(dataDir), "{not json", "utf-8");
    expect(loadPersistedProfiles(dataDir)).toEqual([]);
    fs.writeFileSync(
      profilesFilePath(dataDir),
      JSON.stringify({ schemaVersion: 1, profiles: [{ id: "" }, { id: "ok", baseUrl: "https://x", model: "m" }] }),
      "utf-8",
    );
    expect(loadPersistedProfiles(dataDir).map((p) => p.id)).toEqual(["ok"]);
  });

  it.runIf(process.platform !== "win32")("rejects a symlinked private profiles file", () => {
    const dataDir = tempDir("penglai-profiles-");
    const outside = path.join(tempDir("penglai-profiles-outside-"), "profiles.json");
    fs.writeFileSync(outside, JSON.stringify({ schemaVersion: 1, profiles: [] }), { mode: 0o600 });
    fs.symlinkSync(outside, profilesFilePath(dataDir));
    expect(() => loadPersistedProfiles(dataDir)).toThrow(/regular file, not a symlink/);
    expect(() => savePersistedProfile(dataDir, {
      id: "safe",
      label: "Safe",
      provider: "custom",
      baseUrl: "https://example.com/v1",
      model: "model",
      apiKeyEnv: "",
    })).toThrow(/regular file, not a symlink/);
  });
});

describe("model-smoke: classified one-shot verification", () => {
  let mock: MockModelServer;

  beforeEach(async () => {
    mock = new MockModelServer();
    await mock.start();
  });

  afterEach(async () => {
    await mock.close();
  });

  it("reports ok against a live OpenAI-compatible endpoint", async () => {
    const result = await smokeTestModel({
      baseUrl: mock.baseUrl,
      model: "mock-model",
      apiKey: "anything",
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("ok");
    expect(result.detail).toContain("HTTP 200");
    expect(mock.requests).toHaveLength(1);
    // The smoke call is a real chat-completions ping.
    expect(mock.requests[0].body.model).toBe("mock-model");
  });

  it("classifies a rejected key as auth", async () => {
    mock.requireApiKey("the-right-key");
    const result = await smokeTestModel({
      baseUrl: mock.baseUrl,
      model: "mock-model",
      apiKey: "the-wrong-key",
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("auth");
    expect(result.detail).toContain("401");
  });

  it("accepts the required key (auth passes through)", async () => {
    mock.requireApiKey("the-right-key");
    const result = await smokeTestModel({
      baseUrl: mock.baseUrl,
      model: "mock-model",
      apiKey: "the-right-key",
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(true);
  });

  it("classifies a wrong base-url path as endpoint", async () => {
    const result = await smokeTestModel({
      baseUrl: `${mock.baseUrl}/wrong`,
      model: "mock-model",
      apiKey: "anything",
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("endpoint");
    expect(result.detail).toContain("404");
  });

  it("classifies a slow endpoint as timeout", async () => {
    mock.setResponseDelay(2_000);
    const result = await smokeTestModel({
      baseUrl: mock.baseUrl,
      model: "mock-model",
      apiKey: "anything",
      timeoutMs: 300,
    });
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("timeout");
    mock.setResponseDelay(0);
  }, 10_000);

  it("classifies a closed port as network", async () => {
    const result = await smokeTestModel({
      baseUrl: "http://127.0.0.1:1/v1",
      model: "mock-model",
      apiKey: "anything",
      timeoutMs: 2_000,
    });
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("network");
  });
});

describe("config profile RPCs: persistence + smoke", () => {
  const TOKEN = "profiles-test-token";
  let dataDir: string;
  let home: string;
  let server: StartedServer | null = null;

  async function boot(): Promise<StartedServer> {
    return startServer({
      port: 0,
      token: TOKEN,
      dataDir,
      databasePath: path.join(dataDir, "product.db"),
      log: () => undefined,
    });
  }

  async function rpc<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`http://127.0.0.1:${server!.port}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Penglai-Token": TOKEN },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = await res.json();
    if (body.error) throw new Error(body.error.message);
    return body.result as T;
  }

  beforeEach(() => {
    dataDir = tempDir("penglai-prof-rpc-data-");
    home = tempDir("penglai-prof-rpc-home-");
    _setPenglaiHomeForTest(home);
  });

  afterEach(async () => {
    if (server) {
      server.server.closeIdleConnections();
      await server.close();
      server = null;
    }
    _setPenglaiHomeForTest(null);
  });

  it("a created profile survives a host restart with its key ready", async () => {
    server = await boot();
    await rpc("config.createProfile", {
      id: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "sk-persisted",
    });
    expect(fs.existsSync(profilesFilePath(dataDir))).toBe(true);
    server.server.closeIdleConnections();
    await server.close();

    // Fresh host over the same data dir: the profile and its key are back.
    server = await boot();
    const listed = (await rpc("config.listProfiles", {})) as Array<{ id: string }>;
    expect(listed.map((p) => p.id)).toContain("deepseek");
    const resolved = await rpc("config.resolveProfile", { profileId: "deepseek" });
    expect(resolved.hasKey).toBe(true);
    // Key material never leaks through the RPC surface.
    expect(JSON.stringify(listed)).not.toContain("sk-persisted");
  });

  it("an env-reference profile stores no key and resolves from the host env", async () => {
    process.env.PENGLAI_TEST_PROFILE_KEY = "sk-from-env";
    try {
      server = await boot();
      await rpc("config.createProfile", {
        id: "custom-env",
        baseUrl: "http://127.0.0.1:9/v1",
        model: "env-model",
        apiKeyEnv: "PENGLAI_TEST_PROFILE_KEY",
      });
      const file = fs.readFileSync(profilesFilePath(dataDir), "utf-8");
      expect(file).not.toContain("sk-from-env");
      const resolved = await rpc("config.resolveProfile", { profileId: "custom-env" });
      expect(resolved.hasKey).toBe(true);
    } finally {
      delete process.env.PENGLAI_TEST_PROFILE_KEY;
    }
  });

  it("config.smokeTest classifies failures without persisting anything", async () => {
    server = await boot();
    const unreachable = await rpc("config.smokeTest", {
      baseUrl: "http://127.0.0.1:1/v1",
      model: "m",
      apiKey: "k",
      timeoutMs: 2_000,
    });
    expect(unreachable.ok).toBe(false);
    expect(unreachable.kind).toBe("network");
    // Smoke is read-only: no profile row appeared.
    const listed = (await rpc("config.listProfiles", {})) as Array<{ id: string }>;
    expect(listed).toHaveLength(5); // built-in catalog only
  });

  it("S1: changing baseUrl origin clears stored secret; path change keeps it", async () => {
    server = await boot();
    await rpc("config.createProfile", {
      id: "bound",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKey: "sk-must-not-follow",
    });
    let resolved = await rpc("config.resolveProfile", { profileId: "bound" });
    expect(resolved.hasKey).toBe(true);

    // Path-only change keeps the credential binding.
    const pathOnly = await rpc("config.updateProfile", {
      id: "bound",
      baseUrl: "https://api.deepseek.com/v2",
    });
    expect(pathOnly.originChanged).toBe(false);
    expect(pathOnly.credentialCleared).toBe(false);
    resolved = await rpc("config.resolveProfile", { profileId: "bound" });
    expect(resolved.hasKey).toBe(true);

    // Origin change clears the old secret; must re-bind.
    const moved = await rpc("config.updateProfile", {
      id: "bound",
      baseUrl: "https://api.openai.com/v1",
    });
    expect(moved.originChanged).toBe(true);
    expect(moved.credentialCleared).toBe(true);
    expect(moved.credentialHint).toMatch(/旧密钥|重新绑定/);
    resolved = await rpc("config.resolveProfile", { profileId: "bound" });
    expect(resolved.hasKey).toBe(false);
    const disk = fs.readFileSync(profilesFilePath(dataDir), "utf-8");
    expect(disk).not.toContain("sk-must-not-follow");
  });

  it("R6: origin change + new literal key is bound immediately in-process", async () => {
    server = await boot();
    await rpc("config.createProfile", {
      id: "rebind-now",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKey: "sk-fixtureold00000000000000000000dead",
    });
    let resolved = await rpc("config.resolveProfile", { profileId: "rebind-now" });
    expect(resolved.hasKey).toBe(true);

    // Same update: new origin AND new literal key. Disk and memory must both
    // use the new key immediately; the old key must never remain bound.
    const updated = await rpc("config.updateProfile", {
      id: "rebind-now",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-fixturenew00000000000000000000beef",
    });
    expect(updated.originChanged).toBe(true);
    expect(updated.credentialCleared).toBe(false);
    resolved = await rpc("config.resolveProfile", { profileId: "rebind-now" });
    expect(resolved.hasKey).toBe(true);
    const disk = fs.readFileSync(profilesFilePath(dataDir), "utf-8");
    expect(disk).toContain("sk-fixturenew00000000000000000000beef");
    expect(disk).not.toContain("sk-fixtureold00000000000000000000dead");
  });

  it("R6: origin change without new credentials fail-closes (no old key)", async () => {
    server = await boot();
    await rpc("config.createProfile", {
      id: "fail-closed",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKey: "sk-fixtureold00000000000000000000dead",
    });
    const moved = await rpc("config.updateProfile", {
      id: "fail-closed",
      baseUrl: "https://api.openai.com/v1",
    });
    expect(moved.originChanged).toBe(true);
    expect(moved.credentialCleared).toBe(true);
    const resolved = await rpc("config.resolveProfile", { profileId: "fail-closed" });
    expect(resolved.hasKey).toBe(false);
    const disk = fs.readFileSync(profilesFilePath(dataDir), "utf-8");
    expect(disk).not.toContain("sk-fixtureold00000000000000000000dead");
  });
});
