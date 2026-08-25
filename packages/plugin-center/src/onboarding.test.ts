import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  ONBOARDING_STEPS,
  OFFICIAL_ONBOARDING_SLOT,
  cardsFromOfficialDirectory,
  canMarkTestPassed,
  classifyApiTestError,
  viewOfficialSessionEvent,
  completeStep,
  completeStepWithEvidence,
  credentialDescriptor,
  emptyOnboarding,
  loadOnboarding,
  persistOnboarding,
  supportsOfficialOpenAiCompatible,
  onboardingApiTestCwd,
  releaseOnboardingTestWorkspaces,
  runOfficialNonceTurn,
} from "./onboarding.js";
import { contribute } from "./client.js";
import { assertOnboardingRemoteHasNoSecretSurface } from "./onboarding-remote.js";

function officialServices(opts: {
  workspaceDir: string;
  reply: (prompt: string) => string;
  prompts?: string[];
  attached?: string[];
}) {
  let listener: ((...args: unknown[]) => void) | undefined;
  return {
    settings: {
      mutate: async () => undefined,
      describe: () => [],
    },
    llm: {
      listProviders: () => [{ id: "deepseek", name: "DeepSeek" }],
      listModels: async (provider: string) => [{ provider, id: "deepseek-chat", name: "DeepSeek Chat" }],
      resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model }),
    },
    credentials: {
      describe: async () => ({ configured: true, source: "local", writable: true }),
      set: async () => undefined,
    },
    workspaceRegistry: {
      list: () => [
        {
          id: "ws-real",
          title: "Real",
          path: opts.workspaceDir,
          attachSession: async (sessionId: string) => {
            opts.attached?.push(sessionId);
          },
        },
      ],
      create: async () => ({ id: "ws-real", title: "Real" }),
    },
    agents: {
      async create(input: { sessionId: string }) {
        return {
          agent: {
            followup(message: { content?: Array<{ text?: string }> }) {
              const prompt = message.content?.map((part) => part.text ?? "").join("") ?? "";
              opts.prompts?.push(prompt);
              const final = opts.reply(prompt);
              queueMicrotask(() => {
                if (final) {
                  listener?.("session/event", {
                    type: "assistant/message",
                    data: { sessionId: input.sessionId, message: { content: [{ type: "text", text: final }] } },
                  });
                }
                listener?.("session/event", { type: "turn/end", data: { sessionId: input.sessionId } });
              });
            },
          },
          async dispose() {},
        };
      },
    },
    on(event: string, fn: (...args: unknown[]) => void) {
      if (event === "session/event") listener = fn;
      return () => {
        if (event === "session/event" && listener === fn) listener = undefined;
      };
    },
  };
}

test("R2I-ONB-001/002 onboarding steps are ordered and durable", () => {
  let state = emptyOnboarding();
  assert.equal(state.current, "welcome-v1");
  state = completeStep(state, "welcome-v1");
  state = completeStep(state, "appearance-locale-v1");
  assert.equal(state.current, "privacy-v1");
  state = completeStep(state, "privacy-v1");
  assert.equal(state.current, "model-provider-v1");
  const dir = mkdtempSync(join(tmpdir(), "penglai-onb-"));
  persistOnboarding(dir, state);
  const loaded = loadOnboarding(dir);
  assert.deepEqual(loaded.completed, ["welcome-v1", "appearance-locale-v1", "privacy-v1"]);
  assert.equal(loaded.current, "model-provider-v1");
  assert.throws(() => completeStep(loaded, "model-provider-v1", "forged-token"));
  assert.equal(ONBOARDING_STEPS.length, 8);
  assert.ok(ONBOARDING_STEPS.includes("credential-v1"));
  assert.equal(ONBOARDING_STEPS.includes("workspace-v1"), true);
  assert.equal(ONBOARDING_STEPS.includes("first-turn-v1"), true);
});

test("R50-ONB-002/003/004 official catalog and onboarding slot are required", () => {
  assert.equal(contribute().slot, "settings.section");
  const clientSrc = readFileSync(new URL("./client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(clientSrc, /contributeOnboarding|OFFICIAL_ONBOARDING_SLOT/);
  void OFFICIAL_ONBOARDING_SLOT;
  const cards = cardsFromOfficialDirectory({
    providers: [
      { id: "deepseek", displayName: "DeepSeek", protocol: "deepseek", configured: false },
      { id: "openai", protocol: "openai" },
      { id: "custom-lab", protocol: "openai-compatible" },
    ],
  });
  assert.equal(cards.length, 3);
  assert.equal(supportsOfficialOpenAiCompatible(cards), true);
  const fromLlm = cardsFromOfficialDirectory({
    providers: [{ provider: "pi-openai", displayName: "OpenAI", settingsNs: "llm-pi-ai" }],
  });
  assert.equal(fromLlm[0]?.id, "pi-openai");
  assert.throws(() => cardsFromOfficialDirectory({ providers: [] }), /empty/);
});

test("R50-ONB-005/006/007/008/009 evidence gates and no secret descriptor", () => {
  let state = emptyOnboarding();
  state = completeStep(state, "welcome-v1");
  assert.throws(() => credentialDescriptor({ configured: true, value: "sk-hidden" }), /value/);
  assert.deepEqual(credentialDescriptor({ configured: true, source: "local", writable: true }), {
    configured: true,
    source: "local",
    writable: true,
  });
  assert.equal(classifyApiTestError(new Error("401 unauthorized")).class, "auth");
  assert.equal(
    classifyApiTestError(new Error("AUTH Authentication Fails, Your api key: ****0f08 is invalid")).class,
    "auth",
  );
  assert.equal(classifyApiTestError(new Error("AUTH 401 Authentication Fails, Your api key is invalid")).class, "auth");
  assert.equal(classifyApiTestError(new Error("MISSING_CREDENTIAL no API key for provider route")).class, "auth");
  assert.equal(classifyApiTestError(new Error("429 rate limit")).class, "rate");
  assert.equal(classifyApiTestError(new Error("ENOTFOUND")).class, "network");
  assert.equal(classifyApiTestError(new Error("ETIMEDOUT timed out")).class, "timeout");
  assert.equal(classifyApiTestError(new Error("official nonce Turn produced no durable final")).class, "empty");
  assert.equal(classifyApiTestError(new Error("official nonce Turn did not complete")).class, "empty");
  assert.throws(
    () => completeStepWithEvidence(state, "appearance-locale-v1", state.advanceToken, {}),
    /locale and theme/,
  );
  state = completeStepWithEvidence(state, "appearance-locale-v1", state.advanceToken, { locale: "zh", theme: "system" });
  assert.throws(
    () => completeStepWithEvidence(state, "model-test-v1", state.advanceToken, { nonce: "abc", httpOk: true }),
    /expected privacy-v1/,
  );
});

test("R50-ONB-009/010 core ready and IM offer cannot skip official Turn", () => {
  let state = emptyOnboarding();
  state = completeStep(state, "welcome-v1");
  state = completeStepWithEvidence(state, "appearance-locale-v1", state.advanceToken, { locale: "en", theme: "dark" });
  state = completeStep(state, "privacy-v1");
  assert.throws(
    () =>
      completeStepWithEvidence(state, "model-provider-v1", state.advanceToken, {
        officialCatalog: { providers: [{ id: "openai", protocol: "openai" }] },
      }),
    /provider and model selection required/,
  );
  assert.throws(
    () =>
      completeStepWithEvidence(state, "model-provider-v1", state.advanceToken, {
        officialCatalog: { providers: [{ id: "openai", protocol: "openai" }] },
        providerSelection: { provider: "openai", model: "openai" },
      }),
    /real model id/,
  );
  assert.throws(
    () =>
      completeStepWithEvidence(state, "model-provider-v1", state.advanceToken, {
        officialCatalog: { providers: [{ id: "openai", protocol: "openai" }] },
        providerSelection: { provider: "not-in-catalog", model: "gpt-4o" },
      }),
    /missing from official catalog/,
  );
  state = completeStepWithEvidence(state, "model-provider-v1", state.advanceToken, {
    officialCatalog: { providers: [{ id: "openai", protocol: "openai" }] },
    providerSelection: { provider: "openai", model: "gpt-4o-mini" },
  });
  assert.throws(
    () =>
      completeStepWithEvidence(state, "credential-v1", state.advanceToken, {
        descriptor: { configured: true, source: "local", writable: true },
      }),
    /verified server-side/,
  );
  state = completeStepWithEvidence(state, "credential-v1", state.advanceToken, {
    descriptor: { configured: true, source: "local", writable: true, serverVerified: true },
  });
  assert.throws(
    () => completeStepWithEvidence(state, "model-test-v1", state.advanceToken, { nonce: "n1", configured: true }),
    /nonce Turn/,
  );
  state = completeStepWithEvidence(state, "model-test-v1", state.advanceToken, {
    nonce: "n1",
    durableFinal: "PENGLAI_OK_n1",
  });
  assert.equal(state.current, "workspace-v1");
  assert.throws(
    () => completeStepWithEvidence(state, "first-turn-v1", state.advanceToken, { officialSessionId: "x" }),
    /expected workspace-v1/,
  );
  state = completeStepWithEvidence(state, "workspace-v1", state.advanceToken, {
    workspaceId: "ws-real",
    workspaceWritable: true,
  });
  assert.throws(
    () => completeStepWithEvidence(state, "first-turn-v1", state.advanceToken, {}),
    /official first Turn/,
  );
  state = completeStepWithEvidence(state, "first-turn-v1", state.advanceToken, {
    officialSessionId: "11111111-1111-4111-8111-111111111111",
    durableFinalDigest: "a".repeat(64),
    turnCompleted: true,
  });
  assert.equal(state.current, "COMPLETE");
});

test("packed first-party client is resolvable via package.json exports", () => {
  const pack = readFileSync(new URL("../../../scripts/pack-plugins.mjs", import.meta.url), "utf8");
  assert.match(pack, /"\.\/package\.json": "\.\/package\.json"/);
  assert.match(pack, /immediately: true/);
  assert.match(pack, /dsh-client-ui-settings-general/);
});

test("R50-ONB-003/006 server validates model and API test exact Session final", async () => {
  const { createPenglaiOnboardingRemoteImpl } = await import("./onboarding-remote.js");
  const workspaceDir = mkdtempSync(join(tmpdir(), "penglai-onb-api-ws-"));
  const create = (reply: (prompt: string) => string) => {
    const impl = createPenglaiOnboardingRemoteImpl({
      dir: mkdtempSync(join(tmpdir(), "penglai-onb-api-")),
      officialCatalog: () => ({ providers: [{ id: "deepseek", protocol: "deepseek" }] }),
      officialWelcomeAck: () => true,
      agents: officialServices({ workspaceDir, reply }),
    });
    return impl;
  };

  const failed = create(() => "");
  await failed.completeAppearance({ locale: "zh", theme: "system" });
  failed.advance("privacy-v1");
  await assert.rejects(() => failed.selectModel({ provider: "evil", model: "deepseek-chat" }), /server-side official catalog/);
  await assert.rejects(() => failed.selectModel({ provider: "deepseek", model: "invented" }), /server-side official model/);
  await failed.selectModel({ provider: "deepseek", model: "deepseek-chat" });
  await failed.verifyCredential({ ref: "DEEPSEEK_API_KEY" });
  await assert.rejects(() => failed.testSelectedModel({ nonce: "nx" }), /no durable final|did not complete|did not include the nonce/);
  assert.equal(failed.status().current, "model-test-v1");

  const passed = create((prompt) => prompt);
  await passed.completeAppearance({ locale: "zh", theme: "system" });
  passed.advance("privacy-v1");
  await passed.selectModel({ provider: "deepseek", model: "deepseek-chat" });
  await passed.verifyCredential({ ref: "DEEPSEEK_API_KEY" });
  const result = await passed.testSelectedModel({ nonce: "ny" });
  assert.equal((result as { passed?: boolean }).passed, true);
  assert.equal("final" in (result as object), false);
  assert.equal(passed.status().current, "workspace-v1");
});

test("R50-ONB-003 wizard lists official providers and models through penglaiOnboarding", () => {
  const wizard = readFileSync(new URL("../../../apps/desktop/static/wizard/wizard.js", import.meta.url), "utf8");
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(wizard, /rpc\("listModels"/);
  assert.match(wizard, /rpc\("listProviders"\)/);
  assert.match(wizard, /rpc\("status"\)/);
  assert.match(wizard, /penglaiOnboarding\//);
  assert.match(wizard, /payload: input === undefined \? \{ args: \{\} \} : \{ args: \{ input \} \}/);
  assert.match(wizard, /rpcId: crypto\.randomUUID\(\)/);
  assert.match(wizard, /screen.id === "keytest"/);
  assert.match(wizard, /no API key/);
  assert.doesNotMatch(client, /llm\.providers|penglaiOnboarding\//);
});

test("R50-ONB-012 pre-DSH wizard owns onboarding UI and remote has no secret surface", () => {
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  const wizard = readFileSync(new URL("../../../apps/desktop/static/wizard/wizard.js", import.meta.url), "utf8");
  const remote = readFileSync(new URL("./onboarding-remote.ts", import.meta.url), "utf8");
  assert.doesNotMatch(client, /settings\.onboarding|data-penglai-onboarding|penglai-models/);
  assert.match(wizard, /data-penglai-wizard-provider/);
  assert.match(wizard, /data-penglai-wizard-key/);
  assert.match(wizard, /data-penglai-wizard-key/);
  assertOnboardingRemoteHasNoSecretSurface(remote);
  assert.equal(client.includes("usable-fixture"), false);
  assert.doesNotMatch(remote, /@Remote\s+advance\b/);
  assert.doesNotMatch(remote, /recordOfficialProviders|runApiTest\(/);
  assert.doesNotMatch(client, /recordOfficialProviders|cwd:\s*["']\/["']/);
  assert.doesNotMatch(wizard, /rows\[0\]/);
});

test("production plugin-center host does not register usable-fixture", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.equal(src.includes("/penglai/usable-fixture"), false);
  assert.equal(src.includes("runOfficialUsableFixture"), false);
});

test("R2I-ONB-012 http/model-list/configured cannot mark test passed", () => {
  assert.equal(canMarkTestPassed({ nonce: "abc", httpOk: true, modelListOk: true, configured: true }), false);
  assert.equal(canMarkTestPassed({ nonce: "abc", durableFinal: "nope", httpOk: true }), false);
  assert.equal(canMarkTestPassed({ nonce: "abc", durableFinal: "PENGLAI_OK_abc" }), true);
});

test("R50-ONB-005 verifyCredential derives the descriptor server-side and fails closed", async () => {
  const { createPenglaiOnboardingRemoteImpl } = await import("./onboarding-remote.js");
  const base = {
    dir: mkdtempSync(join(tmpdir(), "penglai-onb-cred-")),
    officialCatalog: () => ({ providers: [{ id: "deepseek", protocol: "deepseek" }] }),
    officialWelcomeAck: () => true,
  };
  const noService = createPenglaiOnboardingRemoteImpl({ ...base, agents: {} });
  await assert.rejects(() => noService.verifyCredential({ ref: "DEEPSEEK_API_KEY" }), /credentials service missing/);

  const notConfigured = createPenglaiOnboardingRemoteImpl({
    ...base,
    agents: { credentials: { describe: async () => ({ configured: false }), set: async () => {} } },
  });
  await assert.rejects(() => notConfigured.verifyCredential({ ref: "DEEPSEEK_API_KEY" }), /not configured/);

  const leaksValue = createPenglaiOnboardingRemoteImpl({
    ...base,
    agents: {
      credentials: {
        describe: async () => ({ configured: true, value: "sk-leak" }),
        set: async () => {},
      },
    },
  });
  await assert.rejects(() => leaksValue.verifyCredential({ ref: "DEEPSEEK_API_KEY" }), /must not return value/);

  const ok = createPenglaiOnboardingRemoteImpl({
    ...base,
    agents: {
      credentials: {
        describe: async () => ({ configured: true, source: "local", writable: true }),
        set: async () => {},
      },
    },
  });
  ok.advance("appearance-locale-v1", { locale: "zh", theme: "system" });
  ok.advance("privacy-v1");
  ok.advance("model-provider-v1", {
    officialCatalog: { providers: [{ id: "deepseek", protocol: "deepseek" }] },
    providerSelection: { provider: "deepseek", model: "deepseek-chat" },
  });
  const state = await ok.verifyCredential({ ref: "DEEPSEEK_API_KEY" });
  assert.equal(state.current, "model-test-v1");
});

test("R50-ONB-008 recordWorkspace verifies the official registry server-side", async () => {
  const { createPenglaiOnboardingRemoteImpl } = await import("./onboarding-remote.js");
  const realDir = mkdtempSync(join(tmpdir(), "penglai-ws-"));
  const base = {
    dir: mkdtempSync(join(tmpdir(), "penglai-onb-ws-")),
    officialCatalog: () => ({ providers: [{ id: "deepseek", protocol: "deepseek" }] }),
    officialWelcomeAck: () => true,
    agents: {
      workspaceRegistry: {
        list: () => [{ id: "ws-real", title: "Real", path: realDir }],
        create: async () => ({ id: "ws-real" }),
      },
    },
  };
  const impl = createPenglaiOnboardingRemoteImpl(base);
  const listed = impl.listWorkspaces();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, "ws-real");
  assert.throws(() => impl.recordWorkspace({ workspaceId: "ws-fake" }), /not allowed/);
  assert.throws(() => impl.recordWorkspace({ workspaceId: "ws-real" }), /not allowed/);
});

test("R50-ONB-009 first conversation is a visible official Session and survives restart", async () => {
  const { createPenglaiOnboardingRemoteImpl } = await import("./onboarding-remote.js");
  const { mkdirSync } = await import("node:fs");
  const wsDir = mkdtempSync(join(tmpdir(), "penglai-ws-first-"));
  const prompts: string[] = [];
  const attached: string[] = [];
  const userDataRoot = mkdtempSync(join(tmpdir(), "penglai-ud-first-"));
  const dir = join(userDataRoot, "onboarding");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const services = officialServices({
    workspaceDir: wsDir,
    prompts,
    attached,
    reply: (prompt) => (prompt.startsWith("PENGLAI_OK_") ? prompt : "你好，我已经在这个官方会话中回复。"),
  });
  const impl = createPenglaiOnboardingRemoteImpl({
    dir,
    userDataRoot,
    officialCatalog: () => ({ providers: [{ id: "deepseek", protocol: "deepseek", configured: true }] }),
    officialWelcomeAck: () => true,
    agents: services,
  });
  await impl.completeAppearance({ locale: "zh", theme: "system" });
  impl.advance("privacy-v1");
  await impl.selectModel({ provider: "deepseek", model: "deepseek-chat" });
  await impl.verifyCredential({ ref: "DEEPSEEK_API_KEY" });
  const api = await impl.testSelectedModel({ nonce: "api1" });
  assert.equal((api as { passed?: boolean }).passed, true);
  assert.equal(impl.status().current, "workspace-v1");
  await impl.createWorkspace({ path: wsDir, title: "Docs" });
  const first = await impl.runFirstConversation({ message: "你好" });
  assert.equal((first as { passed?: boolean }).passed, true);
  assert.equal(impl.status().current, "COMPLETE");
  assert.deepEqual(prompts, ["PENGLAI_OK_api1", "你好"]);
  assert.equal(attached.length, 1);
  assert.equal(attached[0], (first as { sessionId?: string }).sessionId);
  const factsDisk = readFileSync(join(dir, "onboarding-facts.json"), "utf8");
  assert.equal(factsDisk.includes("PENGLAI_OK_"), false);
  assert.equal(factsDisk.includes("你好"), false);

  const resumed = createPenglaiOnboardingRemoteImpl({
    dir,
    userDataRoot,
    officialCatalog: () => ({ providers: [{ id: "deepseek", protocol: "deepseek", configured: true }] }),
    officialWelcomeAck: () => true,
    agents: services,
  });
  assert.equal(resumed.status().current, "COMPLETE");
  assert.deepEqual(resumed.facts(), impl.facts());

  const rewound = resumed.rewindOnboarding({ step: "credential-v1" });
  assert.equal(rewound.current, "credential-v1");
  assert.deepEqual(resumed.facts().selection, { provider: "deepseek", model: "deepseek-chat" });
  assert.equal(resumed.facts().credentialRef, undefined);
  assert.equal(resumed.facts().apiTest, undefined);
  assert.equal(resumed.facts().workspaceId, undefined);
  assert.equal(resumed.facts().firstConversation, undefined);
  assert.equal(existsSync(join(dir, "current-nonce.digest")), false);
  await resumed.enterCredential({ provider: "deepseek", value: "sk-replacement" });
  assert.equal(resumed.status().current, "model-test-v1");
  await resumed.testSelectedModel({ nonce: "api2" });
  await resumed.createWorkspace({ path: wsDir, title: "Docs" });
  const retried = await resumed.runFirstConversation({ message: "重试成功" });
  assert.equal((retried as { passed?: boolean }).passed, true);
  assert.equal(resumed.status().current, "COMPLETE");
});

test("R50-ONB-002 completeAppearance persists locale/theme through official settings", async () => {
  const { createPenglaiOnboardingRemoteImpl } = await import("./onboarding-remote.js");
  const ops: Array<{ ns: string; op: unknown; path: unknown; value?: unknown }> = [];
  const impl = createPenglaiOnboardingRemoteImpl({
    dir: mkdtempSync(join(tmpdir(), "penglai-onb-app-")),
    officialCatalog: () => ({ providers: [{ id: "deepseek", protocol: "deepseek" }] }),
    officialWelcomeAck: () => true,
    agents: {
      settings: {
        mutate: async (ns: string, list: Array<{ op: string; path: string[]; value?: unknown }>) => {
          for (const item of list) ops.push({ ns, op: item.op, path: item.path, value: item.value });
        },
        describe: () => [],
      },
    },
  });
  await impl.completeAppearance({ locale: "zh", theme: "dark" });
  impl.advance("privacy-v1");
  assert.deepEqual(
    ops.map((o) => `${o.ns}:${String(o.path[0])}=${String(o.value)}`),
    ["locale:preference=zh", "ui-theme:preference=dark"],
  );
  assert.equal(impl.status().current, "model-provider-v1");
});

function officialFirehoseServices(opts: {
  workspaceDir: string;
  reply: (prompt: string) => string;
  failMissing?: boolean;
  created?: number[];
}) {
  let listener: ((...args: unknown[]) => void) | undefined;
  return {
    credentials: {
      describe: async () => ({ configured: true, source: "local", writable: true }),
      set: async () => undefined,
    },
    llm: {
      listProviders: () => [{ id: "deepseek-official", name: "DeepSeek" }],
      listModels: async (provider: string) => [{ provider, id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" }],
      resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model }),
    },
    workspaceRegistry: {
      list: () => [{ id: "ws-real", title: "Real", path: opts.workspaceDir }],
      create: async () => ({ id: "ws-real", title: "Real" }),
    },
    agents: {
      async create(input: { sessionId: string }) {
        opts.created?.push(1);
        return {
          agent: {
            followup(message: { content?: Array<{ text?: string }> }) {
              const prompt = message.content?.map((part) => part.text ?? "").join("") ?? "";
              const session = { id: input.sessionId };
              queueMicrotask(() => {
                if (opts.failMissing) {
                  listener?.(session, {
                    type: "turn/end",
                    data: {
                      turn: 1,
                      reason: {
                        kind: "error",
                        error: {
                          message:
                            'llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service',
                          code: "MISSING_CREDENTIAL",
                        },
                      },
                    },
                  });
                  return;
                }
                const final = opts.reply(prompt);
                if (final) {
                  listener?.(session, {
                    type: "assistant/message",
                    data: { turn: 1, step: 1, message: { content: [{ type: "text", text: final }] } },
                  });
                }
                listener?.(session, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
              });
            },
          },
          async dispose() {},
        };
      },
    },
    on(event: string, fn: (...args: unknown[]) => void) {
      if (event === "session/event") listener = fn;
      return () => {
        if (event === "session/event" && listener === fn) listener = undefined;
      };
    },
  };
}

function advanceToModelTest(
  impl: ReturnType<typeof import("./onboarding-remote.js").createPenglaiOnboardingRemoteImpl>,
  extraFacts: { credentialRef: string },
) {
  impl.advance("appearance-locale-v1", { locale: "zh", theme: "system" });
  impl.advance("privacy-v1");
  impl.advance("model-provider-v1", {
    officialCatalog: { providers: [{ id: "deepseek-official", protocol: "deepseek" }] },
    providerSelection: { provider: "deepseek-official", model: "deepseek-v4-flash" },
  });
  impl.saveFacts({
    selection: { provider: "deepseek-official", model: "deepseek-v4-flash" },
    credentialRef: extraFacts.credentialRef,
  });
  impl.advance("credential-v1", {
    descriptor: { configured: true, source: "file", writable: true, serverVerified: true },
  });
}

test("viewOfficialSessionEvent reads session.id from the official subject", () => {
  const official = viewOfficialSessionEvent([
    { id: "sess-official" },
    {
      type: "assistant/message",
      data: { turn: 1, message: { content: [{ type: "text", text: "PENGLAI_OK_ab" }] } },
    },
  ]);
  assert.equal(official.sessionId, "sess-official");
  assert.equal(official.type, "assistant/message");
  assert.equal(official.content?.[0]?.text, "PENGLAI_OK_ab");

  const ended = viewOfficialSessionEvent([
    { id: "sess-official" },
    {
      type: "turn/end",
      data: { turn: 1, reason: { kind: "error", error: { code: "MISSING_CREDENTIAL", message: "no API key" } } },
    },
  ]);
  assert.equal(ended.sessionId, "sess-official");
  assert.equal(ended.type, "turn/end");
  assert.deepEqual(ended.reason, { kind: "error", error: { code: "MISSING_CREDENTIAL", message: "no API key" } });

  const legacy = viewOfficialSessionEvent([
    "session/event",
    { type: "turn/end", data: { sessionId: "sess-legacy" } },
  ]);
  assert.equal(legacy.sessionId, "sess-legacy");
  assert.equal(legacy.type, "turn/end");
});

test("official nonce Turn observes (session, event) firehose without sessionId in data", async () => {
  const { createPenglaiOnboardingRemoteImpl } = await import("./onboarding-remote.js");
  const impl = createPenglaiOnboardingRemoteImpl({
    dir: mkdtempSync(join(tmpdir(), "penglai-onb-firehose-")),
    officialCatalog: () => ({ providers: [{ id: "deepseek-official", protocol: "deepseek" }] }),
    officialWelcomeAck: () => true,
    agents: officialFirehoseServices({
      workspaceDir: mkdtempSync(join(tmpdir(), "penglai-onb-firehose-ws-")),
      reply: (prompt) => prompt,
    }),
  });
  advanceToModelTest(impl, { credentialRef: "DEEPSEEK_API_KEY" });
  const result = await impl.testSelectedModel({ nonce: "fire1" });
  assert.equal((result as { passed?: boolean }).passed, true);
  assert.equal(impl.status().current, "workspace-v1");
});

test("MISSING_CREDENTIAL on official turn/end fails as auth without waiting out the nonce timeout", async () => {
  const { createPenglaiOnboardingRemoteImpl } = await import("./onboarding-remote.js");
  const impl = createPenglaiOnboardingRemoteImpl({
    dir: mkdtempSync(join(tmpdir(), "penglai-onb-miss-")),
    officialCatalog: () => ({ providers: [{ id: "deepseek-official", protocol: "deepseek" }] }),
    officialWelcomeAck: () => true,
    agents: officialFirehoseServices({
      workspaceDir: mkdtempSync(join(tmpdir(), "penglai-onb-miss-ws-")),
      reply: () => "",
      failMissing: true,
    }),
  });
  advanceToModelTest(impl, { credentialRef: "DEEPSEEK_API_KEY" });
  const started = Date.now();
  await assert.rejects(() => impl.testSelectedModel({ nonce: "miss1" }), /MISSING_CREDENTIAL|no API key/);
  assert.equal(Date.now() - started < 2000, true);
  assert.equal(impl.status().current, "model-test-v1");
});

test("stale derived DeepSeek ref remaps to DEEPSEEK_API_KEY before the nonce Turn", async () => {
  const { createPenglaiOnboardingRemoteImpl } = await import("./onboarding-remote.js");
  const SECRET = "sk-remap-test-value-never-persist";
  const store = new Map<string, string>([["DEEPSEEK_OFFICIAL_API_KEY", SECRET]]);
  const sets: string[] = [];
  const created: number[] = [];
  const impl = createPenglaiOnboardingRemoteImpl({
    dir: mkdtempSync(join(tmpdir(), "penglai-onb-remap-")),
    officialCatalog: () => ({ providers: [{ id: "deepseek-official", protocol: "deepseek" }] }),
    officialWelcomeAck: () => true,
    agents: {
      ...officialFirehoseServices({
        workspaceDir: mkdtempSync(join(tmpdir(), "penglai-onb-remap-ws-")),
        reply: (prompt) => prompt,
        created,
      }),
      credentials: {
        set: async (ref, value) => {
          sets.push(ref);
          store.set(ref, value);
        },
        describe: async () => ({ configured: true, source: "file", writable: true }),
        resolve: async (ref) => {
          const value = store.get(ref);
          return value ? { value } : undefined;
        },
        unset: async (ref) => {
          store.delete(ref);
        },
      },
    },
  });
  advanceToModelTest(impl, { credentialRef: "DEEPSEEK_OFFICIAL_API_KEY" });
  const result = await impl.testSelectedModel({ nonce: "remap1" });
  assert.equal((result as { passed?: boolean }).passed, true);
  assert.equal(impl.facts().credentialRef, "DEEPSEEK_API_KEY");
  assert.deepEqual(sets, ["DEEPSEEK_API_KEY"]);
  assert.equal(store.has("DEEPSEEK_OFFICIAL_API_KEY"), false);
  assert.equal(store.has("DEEPSEEK_API_KEY"), true);
  assert.equal(created.length, 1);
  const json = JSON.stringify(result);
  assert.equal(json.includes(SECRET), false);
  assert.equal(impl.status().current, "workspace-v1");
});

test("official nonce Turn reads whenIdle + durable session log without a firehose", async () => {
  const { createPenglaiOnboardingRemoteImpl } = await import("./onboarding-remote.js");
  const { durableFinalFromOfficialSession } = await import("./onboarding.js");
  const nonce = "idle1";
  const events = [
    { type: "turn/start", data: { turn: 1 } },
    { type: "step/start", data: { turn: 1, step: 1 } },
    {
      type: "assistant/chunk",
      data: { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text: `PENGLAI_OK_${nonce}` } },
    },
    {
      type: "assistant/message",
      data: { turn: 1, step: 1, message: { role: "assistant", content: [] }, usage: { outputTokens: 64 } },
    },
    { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } },
  ];
  assert.equal(durableFinalFromOfficialSession({ events }).final, `PENGLAI_OK_${nonce}`);
  assert.equal(durableFinalFromOfficialSession({ events }).turnCompleted, true);

  const impl = createPenglaiOnboardingRemoteImpl({
    dir: mkdtempSync(join(tmpdir(), "penglai-onb-idle-")),
    officialCatalog: () => ({ providers: [{ id: "deepseek-official", protocol: "deepseek" }] }),
    officialWelcomeAck: () => true,
    agents: {
      credentials: {
        describe: async () => ({ configured: true, source: "local", writable: true }),
        set: async () => undefined,
      },
      llm: {
        listProviders: () => [{ id: "deepseek-official", name: "DeepSeek" }],
        listModels: async (provider: string) => [{ provider, id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" }],
        resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model }),
      },
      workspaceRegistry: {
        list: () => [{ id: "ws-real", title: "Real", path: mkdtempSync(join(tmpdir(), "penglai-onb-idle-ws-")) }],
        create: async () => ({ id: "ws-real", title: "Real" }),
      },
      agents: {
        async create() {
          const session = { events };
          return {
            agent: {
              session,
              followup() {},
              async whenIdle() {},
            },
            async dispose() {},
          };
        },
      },
    },
  });
  advanceToModelTest(impl, { credentialRef: "DEEPSEEK_API_KEY" });
  const started = Date.now();
  const result = await impl.testSelectedModel({ nonce });
  assert.equal((result as { passed?: boolean }).passed, true);
  assert.equal(impl.status().current, "workspace-v1");
  assert.equal(Date.now() - started < 2000, true);
});

test("official nonce Turn survives whenIdle resolving before turn/end", async () => {
  const nonce = "idle-race";
  const session: { events: unknown[] } = { events: [] };
  let listener: ((...args: unknown[]) => void) | undefined;
  const restrictions: unknown[] = [];
  const result = await runOfficialNonceTurn(
    {
      agents: {
        async create(input: {
          sessionId: string;
          setup?: (ctx: { tools: { restrict: (filter: unknown) => void } }) => void | Promise<void>;
        }) {
          await input.setup?.({ tools: { restrict: (filter) => restrictions.push(filter) } });
          return {
            agent: {
              session,
              followup() {
                setTimeout(() => {
                  const message = {
                    type: "assistant/message",
                    data: {
                      turn: 1,
                      message: { role: "assistant", content: [{ type: "text", text: `PENGLAI_OK_${nonce}` }] },
                    },
                  };
                  const end = { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } };
                  session.events.push(message, end);
                  listener?.({ id: input.sessionId }, message);
                  listener?.({ id: input.sessionId }, end);
                }, 10);
              },
              async whenIdle() {},
            },
            async dispose() {},
          };
        },
      },
      on(event: string, fn: (...args: unknown[]) => void) {
        if (event === "session/event") listener = fn;
        return () => {
          if (listener === fn) listener = undefined;
        };
      },
    } as never,
    { nonce, provider: "deepseek-official", model: "deepseek-v4-flash", cwd: process.cwd() },
  );
  assert.equal(result.passed, true);
  assert.deepEqual(restrictions, [{ allow: [] }]);
});

test("official Turn timeout stays below the wizard wait and above the old 45 second cutoff", () => {
  const source = readFileSync(new URL("./onboarding.ts", import.meta.url), "utf8");
  assert.match(source, /setTimeout\(\(\) => resolve\(\), 120_000\)/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => resolve\(\), 45_000\)/);
});

test("onboarding first Turn uses the bounded probe output budget", () => {
  const source = readFileSync(new URL("./onboarding.ts", import.meta.url), "utf8");
  assert.match(source, /sourceKind:\s*"penglai-onboarding-first-conversation"[\s\S]*maxTokens:\s*256/);
});

test("stale derived ref without resolve fails closed as auth and does not start a Turn", async () => {
  const { createPenglaiOnboardingRemoteImpl } = await import("./onboarding-remote.js");
  const created: number[] = [];
  const impl = createPenglaiOnboardingRemoteImpl({
    dir: mkdtempSync(join(tmpdir(), "penglai-onb-noremap-")),
    officialCatalog: () => ({ providers: [{ id: "deepseek-official", protocol: "deepseek" }] }),
    officialWelcomeAck: () => true,
    agents: officialFirehoseServices({
      workspaceDir: mkdtempSync(join(tmpdir(), "penglai-onb-noremap-ws-")),
      reply: () => "",
      created,
    }),
  });
  advanceToModelTest(impl, { credentialRef: "DEEPSEEK_OFFICIAL_API_KEY" });
  const started = Date.now();
  await assert.rejects(() => impl.testSelectedModel({ nonce: "noremap" }), /MISSING_CREDENTIAL|reenter/);
  assert.equal(Date.now() - started < 2000, true);
  assert.deepEqual(created, []);
  assert.equal(impl.status().current, "model-test-v1");
});

test("credential re-entry from model-test-v1 drops the stale derived ref and remap failure is surfaced", async () => {
  const { createPenglaiOnboardingRemoteImpl } = await import("./onboarding-remote.js");
  const SECRET = "sk-reenter-test-value-never-persist";
  const store = new Map<string, string>([["DEEPSEEK_OFFICIAL_API_KEY", "stale-secret"]]);
  const unsets: string[] = [];
  const impl = createPenglaiOnboardingRemoteImpl({
    dir: mkdtempSync(join(tmpdir(), "penglai-onb-reenter-")),
    officialCatalog: () => ({ providers: [{ id: "deepseek-official", protocol: "deepseek" }] }),
    officialWelcomeAck: () => true,
    agents: {
      credentials: {
        set: async (ref, value) => { store.set(ref, value); },
        describe: async (ref) => ({ configured: store.has(ref), source: "file", writable: true }),
        resolve: async (ref) => (store.has(ref) ? { value: store.get(ref) as string } : undefined),
        unset: async (ref) => { unsets.push(ref); store.delete(ref); },
      },
    },
  });
  advanceToModelTest(impl, { credentialRef: "DEEPSEEK_OFFICIAL_API_KEY" });
  const rewritten = await impl.enterCredential({ provider: "deepseek-official", value: SECRET });
  assert.equal(rewritten.configured, true);
  assert.equal(store.get("DEEPSEEK_API_KEY"), SECRET);
  assert.equal(store.has("DEEPSEEK_OFFICIAL_API_KEY"), false);
  assert.deepEqual(unsets, ["DEEPSEEK_OFFICIAL_API_KEY"]);
  assert.equal(impl.facts().credentialRef, "DEEPSEEK_API_KEY");

  const { rematerializeOfficialCredentialRef } = await import("./onboarding.js");
  const shadowing = new Map<string, string>([["DEEPSEEK_OFFICIAL_API_KEY", "legacy"]]);
  const surfaced = await rematerializeOfficialCredentialRef(
    {
      credentials: {
        set: async (ref, value) => { shadowing.set(ref, value); },
        describe: async (ref) => ({ configured: shadowing.has(ref), source: "file", writable: true }),
        resolve: async (ref) => (shadowing.has(ref) ? { value: shadowing.get(ref) as string } : undefined),
        unset: async () => { throw new Error("read-only layer"); },
      },
    },
    { provider: "deepseek-official", credentialRef: "DEEPSEEK_OFFICIAL_API_KEY" },
  );
  assert.equal(surfaced.remapped, true);
  assert.equal(surfaced.legacyRefRemaining, "DEEPSEEK_OFFICIAL_API_KEY");
});

test("enterCredential is refused after the onboarding ledger is COMPLETE", async () => {
  const { createPenglaiOnboardingRemoteImpl } = await import("./onboarding-remote.js");
  const { persistOnboarding, ONBOARDING_STEPS } = await import("./onboarding.js");
  const dir = mkdtempSync(join(tmpdir(), "penglai-onb-complete-"));
  persistOnboarding(dir, {
    schema: 2,
    completed: [...ONBOARDING_STEPS],
    current: "COMPLETE",
    advanceToken: "tok",
  });
  const impl = createPenglaiOnboardingRemoteImpl({
    dir,
    officialCatalog: () => ({ providers: [{ id: "deepseek-official", protocol: "deepseek" }] }),
    officialWelcomeAck: () => true,
    agents: {
      credentials: {
        set: async () => { throw new Error("must not set after COMPLETE"); },
        describe: async () => ({ configured: true, source: "file", writable: true }),
      },
    },
  });
  assert.equal(impl.status().current, "COMPLETE");
  await assert.rejects(
    () => impl.enterCredential({ provider: "deepseek-official", value: "sk-must-not-store" }),
    /not allowed after onboarding is complete/,
  );
});

test("nonce API test workspace is unregistered and does not keep Downloads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-onb-"));
  const testCwd = onboardingApiTestCwd(dir);
  const rows = [
    { id: "ws-test", title: "api-test", path: testCwd, sessionIds: ["nonce-1"] },
    { id: "ws-downloads", title: "Downloads", path: "/tmp/Downloads-keep" },
  ];
  const deleted: string[] = [];
  const detached: string[] = [];
  const removed = await releaseOnboardingTestWorkspaces(
    {
      create: async () => ({ id: "x" }),
      list: () => rows,
      delete: async (id) => {
        deleted.push(id);
        return true;
      },
    },
    dir,
  );
  assert.equal(removed, 1);
  assert.deepEqual(deleted, ["ws-test"]);
  void detached;

  const titled = [
    {
      id: "ws-titled",
      title: "api-test",
      path: join(dir, "api-test"),
      sessionIds: ["s1"],
      detachSession: async (sessionId: string) => {
        detached.push(sessionId);
      },
    },
    { id: "ws-keep", title: "Downloads", path: join(dir, "keep-downloads") },
  ];
  const deletedTitle: string[] = [];
  const removedTitle = await releaseOnboardingTestWorkspaces(
    {
      create: async () => ({ id: "x" }),
      list: () => titled,
      delete: async (id) => {
        deletedTitle.push(id);
        return true;
      },
    },
    dir,
  );
  assert.equal(removedTitle, 1);
  assert.deepEqual(deletedTitle, ["ws-titled"]);
  assert.deepEqual(detached, ["s1"]);

  const titledElsewhere = [
    { id: "ws-user", title: "api-test", path: "/tmp/user-projects/api-test", sessionIds: ["user-s1"] },
    { id: "ws-stray", title: "api-test", path: "/tmp/Downloads/api-test-stray" },
    { id: "ws-downloads-keep", title: "Downloads", path: "/tmp/Downloads-keep" },
  ];
  const deletedStray: string[] = [];
  const removedStray = await releaseOnboardingTestWorkspaces(
    {
      create: async () => ({ id: "x" }),
      list: () => titledElsewhere,
      delete: async (id) => {
        deletedStray.push(id);
        return true;
      },
    },
    dir,
  );
  assert.equal(removedStray, 0);
  assert.deepEqual(deletedStray, []);
});
