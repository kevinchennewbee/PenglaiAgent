import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { LlmRuntime } from "@deepseek-ai/dsh-llm";
import { PenglaiError } from "@penglai/contracts";
import {
  PENGLAI_WELCOME_NOTICE_VERSION,
  deriveOfficialCredentialRef,
  resolveOfficialCredentialRef,
  namedApiKeyEnvFromOfficialSettings,
  wizardProviderCatalog,
  ensureOfficialProviderRoute,
  cardsFromOfficialDirectory,
} from "./onboarding.js";
import { createPenglaiOnboardingRemoteImpl } from "./onboarding-remote.js";
import { readFileSync as readSource } from "node:fs";

const SECRET = "sk-live-test-value-never-persist";

function userTree() {
  const userDataRoot = mkdtempSync(join(tmpdir(), "penglai-ud-"));
  const dir = join(userDataRoot, "onboarding");
  mkdirSync(dir, { mode: 0o700 });
  return { userDataRoot, dir };
}

function catalog() {
  return { providers: [{ id: "deepseek", protocol: "deepseek" }] };
}

test("deriveOfficialCredentialRef matches official deriveKeyRef", () => {
  assert.equal(deriveOfficialCredentialRef("deepseek"), "DEEPSEEK_API_KEY");
  assert.equal(deriveOfficialCredentialRef("pi-openai"), "PI_OPENAI_API_KEY");
  assert.equal(deriveOfficialCredentialRef("openai-compatible"), "OPENAI_COMPATIBLE_API_KEY");
  assert.throws(() => deriveOfficialCredentialRef("  "), PenglaiError);
});

test("resolveOfficialCredentialRef uses official adapter apiKeyEnv for deepseek-official", () => {
  assert.equal(resolveOfficialCredentialRef("deepseek-official"), "DEEPSEEK_API_KEY");
  assert.notEqual(deriveOfficialCredentialRef("deepseek-official"), "DEEPSEEK_API_KEY");
  assert.equal(resolveOfficialCredentialRef("anthropic"), "ANTHROPIC_API_KEY");
  assert.equal(
    resolveOfficialCredentialRef("deepseek-official", "CUSTOM_DEEPSEEK_KEY"),
    "CUSTOM_DEEPSEEK_KEY",
  );
  assert.equal(
    namedApiKeyEnvFromOfficialSettings("deepseek-official", [
      { ns: "llm-deepseek", value: { apiKeyEnv: "OWNER_OVERRIDE_API_KEY" } },
    ]),
    "OWNER_OVERRIDE_API_KEY",
  );
});

test("wizard catalog lists registered adapters and official configurable providers", () => {
  const catalog = wizardProviderCatalog({
    listProviders: () => [{ id: "deepseek-official", name: "DeepSeek" }],
    listConfigurableProviders: () => [
      { provider: "openai", displayName: "OpenAI", settingsNs: "llm-pi-ai" },
      { provider: "anthropic", displayName: "Anthropic", settingsNs: "llm-pi-ai" },
    ],
  });
  assert.deepEqual(
    (catalog.providers as Array<{ id: string }>).map((p) => p.id),
    ["deepseek-official", "anthropic", "openai"],
  );
  assert.equal(
    (catalog.providers as Array<{ id: string }>).some((p) => p.id === "opencode-go"),
    false,
  );
});

test("wizard catalog matches official Models merge on a real LlmRuntime", () => {
  const ctx = new Context();
  const llm = new LlmRuntime(ctx);
  llm.registerConfigurableProviders([
    {
      provider: "anthropic",
      displayName: "anthropic",
      settingsNs: "llm-pi-ai",
      settingsPath: ["providers", "anthropic"],
    },
    {
      provider: "openai",
      displayName: "openai",
      settingsNs: "llm-pi-ai",
      settingsPath: ["providers", "openai"],
    },
    {
      provider: "deepseek",
      displayName: "deepseek",
      settingsNs: "llm-pi-ai",
      settingsPath: ["providers", "deepseek"],
    },
  ]);
  const catalog = wizardProviderCatalog(llm);
  const cards = cardsFromOfficialDirectory(catalog);
  assert.deepEqual(
    cards.map((c) => c.id),
    ["anthropic", "deepseek", "openai"],
  );
});

test("official DSH ships Pi adapter and DeepSeek adapter at the pinned version", async () => {
  const { createRequire } = await import("node:module");
  const { join } = await import("node:path");
  const resolveFrom = (from: string, id: string): string | undefined => {
    try {
      return createRequire(from).resolve(id);
    } catch {
      return undefined;
    }
  };
  const dshPkg = resolveFrom(join(process.cwd(), "packages/dsh-bridge/package.json"), "@deepseek-ai/dsh/package.json");
  assert.ok(dshPkg, "official @deepseek-ai/dsh must resolve from the desktop closure");
  const piPkg =
    resolveFrom(dshPkg, "@deepseek-ai/dsh-llm-pi-ai/package.json") ??
    resolveFrom(join(process.cwd(), "apps/desktop/package.json"), "@deepseek-ai/dsh-llm-pi-ai/package.json");
  const deepseekPkg =
    resolveFrom(dshPkg, "@deepseek-ai/dsh-llm-deepseek/package.json") ??
    resolveFrom(join(process.cwd(), "apps/desktop/package.json"), "@deepseek-ai/dsh-llm-deepseek/package.json");
  assert.ok(piPkg, "official dsh-llm-pi-ai must ship with DSH");
  assert.ok(deepseekPkg, "official dsh-llm-deepseek must ship with DSH");
  const piManifest = JSON.parse(readFileSync(piPkg, "utf8")) as { name: string; version: string };
  const deepseekManifest = JSON.parse(readFileSync(deepseekPkg, "utf8")) as { name: string; version: string };
  assert.equal(piManifest.name, "@deepseek-ai/dsh-llm-pi-ai");
  assert.equal(deepseekManifest.name, "@deepseek-ai/dsh-llm-deepseek");
  assert.equal(piManifest.version, "0.1.1-rc.1");
  assert.equal(deepseekManifest.version, "0.1.1-rc.1");
  const piMod = await import(resolveFrom(piPkg, "@deepseek-ai/dsh-llm-pi-ai")!);
  assert.equal(piMod.name, "llm-pi-ai");
  assert.equal(typeof piMod.apply, "function");
  assert.doesNotMatch(readFileSync(new URL("./onboarding.ts", import.meta.url), "utf8"), /PENGLAI_PROVIDER_CATALOG|staticProviders\s*=/);
});

test("official non-DeepSeek vendors use Pi apiKeyEnv and llm-pi-ai routes", async () => {
  const vendors = [
    { id: "openai", model: "gpt-4.1", ref: "OPENAI_API_KEY" },
    { id: "anthropic", model: "claude-sonnet-4-5", ref: "ANTHROPIC_API_KEY" },
    { id: "minimax-cn", model: "MiniMax-M2.5", ref: "MINIMAX_CN_API_KEY" },
  ];
  const ctx = new Context();
  const llm = new LlmRuntime(ctx);
  llm.registerConfigurableProviders(
    vendors.map((vendor) => ({
      provider: vendor.id,
      displayName: vendor.id,
      settingsNs: "llm-pi-ai",
      settingsPath: ["providers", vendor.id],
    })),
  );
  const catalog = wizardProviderCatalog({
    listProviders: () => [{ id: "deepseek-official", name: "DeepSeek" }],
    listConfigurableProviders: () => llm.listConfigurableProviders(),
  });
  const ids = (catalog.providers as Array<{ id: string }>).map((row) => row.id);
  assert.ok(ids.includes("deepseek-official"));
  for (const vendor of vendors) {
    assert.ok(ids.includes(vendor.id), `wizard catalog missing official vendor ${vendor.id}`);
    assert.equal(resolveOfficialCredentialRef(vendor.id), vendor.ref);
    const ops: Array<{ ns: string; path: string[]; value: unknown }> = [];
    await ensureOfficialProviderRoute(
      {
        llm: {
          listProviders: () => [],
          listConfigurableProviders: () => llm.listConfigurableProviders(),
          listModels: async () => [],
          resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
        },
        settings: {
          mutate: async (ns, list) => {
            for (const item of list) ops.push({ ns, path: item.path, value: item.value });
          },
          describe: () => [],
        },
      },
      vendor.id,
    );
    assert.deepEqual(ops, [
      { ns: "llm-pi-ai", path: ["providers", vendor.id], value: { apiKeyEnv: vendor.ref } },
    ]);
  }
  assert.equal(resolveOfficialCredentialRef("deepseek-official"), "DEEPSEEK_API_KEY");

  for (const vendor of vendors) {
    const sets: Array<{ ref: string; value: string }> = [];
    const impl = createPenglaiOnboardingRemoteImpl({
      dir: userTree().dir,
      officialCatalog: () => catalog,
      officialWelcomeAck: () => true,
      agents: {
        credentials: {
          set: async (ref, value) => {
            sets.push({ ref, value });
          },
          describe: async () => ({ configured: true, source: "file", writable: true }),
        },
        settings: {
          mutate: async () => {},
          describe: () => [],
        },
        llm: {
          listProviders: () => [],
          listConfigurableProviders: () => llm.listConfigurableProviders(),
          listModels: async (provider) => [{ provider, id: vendor.model, name: vendor.model }],
          resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
        },
      },
    });
    impl.advance("appearance-locale-v1", { locale: "zh", theme: "system" });
    impl.advance("privacy-v1");
    await impl.selectModel({ provider: vendor.id, model: vendor.model });
    await impl.enterCredential({ provider: vendor.id, value: SECRET });
    assert.deepEqual(sets, [{ ref: vendor.ref, value: SECRET }]);
    assert.equal(impl.facts().credentialRef, vendor.ref);
  }
});

test("status surfaces official catalog cards and does not swallow an empty directory", () => {
  const { dir } = userTree();
  const impl = createPenglaiOnboardingRemoteImpl({
    dir,
    officialCatalog: () =>
      wizardProviderCatalog({
        listProviders: () => [{ id: "deepseek-official", name: "DeepSeek" }],
        listConfigurableProviders: () => [
          { provider: "anthropic", displayName: "anthropic", settingsNs: "llm-pi-ai" },
          { provider: "minimax-cn", displayName: "minimax-cn", settingsNs: "llm-pi-ai" },
        ],
      }),
    officialWelcomeAck: () => false,
    agents: {},
  });
  const status = impl.status();
  assert.deepEqual(
    status.providers.map((p) => p.id),
    ["deepseek-official", "anthropic", "minimax-cn"],
  );
  assert.equal("catalogError" in status, false);

  const empty = createPenglaiOnboardingRemoteImpl({
    dir: userTree().dir,
    officialCatalog: () => wizardProviderCatalog({}),
    officialWelcomeAck: () => false,
    agents: {},
  });
  const failed = empty.status();
  assert.deepEqual(failed.providers, []);
  assert.match(String(failed.catalogError), /empty|missing/i);
});

test("production plugin-center snapshots official.llm for the wizard catalog", () => {
  const src = readSource(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /officialCatalog: \(\) => wizardProviderCatalog\(official\.llm\)/);
  assert.doesNotMatch(src, /officialCatalog: \(\) => officialCatalogFrom\(ctx\)/);
});

test("ensureOfficialProviderRoute refuses empty settingsPath instead of inventing providers.<id>", async () => {
  const ops: Array<{ ns: string; path: string[] }> = [];
  await assert.rejects(
    () =>
      ensureOfficialProviderRoute(
        {
          llm: {
            listProviders: () => [],
            listConfigurableProviders: () => [
              { provider: "deepseek-official", settingsNs: "llm-deepseek", settingsPath: [] },
            ],
            listModels: async () => [],
            resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
          },
          settings: {
            mutate: async (ns, list) => {
              for (const item of list) ops.push({ ns, path: item.path });
            },
            describe: () => [],
          },
        },
        "deepseek-official",
      ),
    /no adapter registered/,
  );
  assert.deepEqual(ops, []);
});

test("completeWelcome writes penglai welcomeNoticeVersion then advances welcome-v1", async () => {
  const { dir } = userTree();
  const ops: Array<{ ns: string; path: string[]; value?: unknown }> = [];
  const impl = createPenglaiOnboardingRemoteImpl({
    dir,
    officialCatalog: catalog,
    officialWelcomeAck: () => false,
    agents: {
      settings: {
        mutate: async (ns, list) => {
          for (const item of list) ops.push({ ns, path: item.path, value: item.value });
        },
        describe: () => [],
      },
    },
  });
  assert.equal(impl.status().current, "welcome-v1");
  const state = await impl.completeWelcome();
  assert.equal(state.current, "appearance-locale-v1");
  assert.deepEqual(ops, [
    { ns: "ui-onboarding", path: ["welcomeNoticeVersion"], value: PENGLAI_WELCOME_NOTICE_VERSION },
  ]);
  assert.equal(PENGLAI_WELCOME_NOTICE_VERSION, "penglai-0.5.1.0");
  const again = await impl.completeWelcome();
  assert.equal(again.current, "appearance-locale-v1");
  assert.equal(ops.length, 2);
});

test("completeWelcome fails closed without official settings", async () => {
  const { dir } = userTree();
  const impl = createPenglaiOnboardingRemoteImpl({
    dir,
    officialCatalog: catalog,
    officialWelcomeAck: () => false,
    agents: {},
  });
  await assert.rejects(() => impl.completeWelcome(), /official settings persistence failed|services missing/);
  assert.equal(impl.status().current, "welcome-v1");
});

test("enterCredential for deepseek-official writes DEEPSEEK_API_KEY not the derived route name", async () => {
  const { dir } = userTree();
  const sets: Array<{ ref: string; value: string }> = [];
  const impl = createPenglaiOnboardingRemoteImpl({
    dir,
    officialCatalog: () => ({ providers: [{ id: "deepseek-official", protocol: "deepseek" }] }),
    officialWelcomeAck: () => true,
    agents: {
      credentials: {
        set: async (ref, value) => {
          sets.push({ ref, value });
        },
        describe: async () => ({ configured: true, source: "file", writable: true }),
      },
      llm: {
        listProviders: () => [{ id: "deepseek-official", name: "DeepSeek" }],
        listModels: async (provider) => [{ provider, id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" }],
        resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      },
    },
  });
  impl.advance("appearance-locale-v1", { locale: "zh", theme: "system" });
  impl.advance("privacy-v1");
  await impl.selectModel({ provider: "deepseek-official", model: "deepseek-v4-flash" });
  await impl.enterCredential({ provider: "deepseek-official", value: SECRET });
  assert.deepEqual(sets, [{ ref: "DEEPSEEK_API_KEY", value: SECRET }]);
  assert.equal(impl.facts().credentialRef, "DEEPSEEK_API_KEY");
});

test("enterCredential sets official seam, returns descriptor only, and never persists value", async () => {
  const { dir } = userTree();
  const sets: Array<{ ref: string; value: string }> = [];
  const impl = createPenglaiOnboardingRemoteImpl({
    dir,
    officialCatalog: catalog,
    officialWelcomeAck: () => true,
    agents: {
      credentials: {
        set: async (ref, value) => {
          sets.push({ ref, value });
        },
        describe: async () => ({ configured: true, source: "file", writable: true }),
      },
      llm: {
        listProviders: () => [{ id: "deepseek", name: "DeepSeek" }],
        listModels: async (provider) => [{ provider, id: "deepseek-chat", name: "DeepSeek Chat" }],
        resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      },
    },
  });
  impl.advance("appearance-locale-v1", { locale: "zh", theme: "system" });
  impl.advance("privacy-v1");
  await impl.selectModel({ provider: "deepseek", model: "deepseek-chat" });
  const descriptor = await impl.enterCredential({ provider: "deepseek", value: SECRET });
  assert.deepEqual(descriptor, { configured: true, source: "file", writable: true });
  assert.equal("value" in descriptor, false);
  assert.deepEqual(sets, [{ ref: "DEEPSEEK_API_KEY", value: SECRET }]);
  assert.equal(impl.status().current, "model-test-v1");
  assert.equal(impl.facts().credentialRef, "DEEPSEEK_API_KEY");
  const disk = `${readFileSync(join(dir, "onboarding.json"), "utf8")}\n${readFileSync(join(dir, "onboarding-facts.json"), "utf8")}`;
  assert.equal(disk.includes(SECRET), false);

  const again = await impl.enterCredential({ provider: "deepseek", value: SECRET });
  assert.deepEqual(again, descriptor);
  assert.equal(impl.status().current, "model-test-v1");
  assert.equal(sets.length, 2);
});

test("enterCredential at model-test-v1 rewrites a stale derived DeepSeek ref", async () => {
  const { dir } = userTree();
  const sets: Array<{ ref: string; value: string }> = [];
  const impl = createPenglaiOnboardingRemoteImpl({
    dir,
    officialCatalog: () => ({ providers: [{ id: "deepseek-official", protocol: "deepseek" }] }),
    officialWelcomeAck: () => true,
    agents: {
      credentials: {
        set: async (ref, value) => {
          sets.push({ ref, value });
        },
        describe: async () => ({ configured: true, source: "file", writable: true }),
      },
      llm: {
        listProviders: () => [{ id: "deepseek-official", name: "DeepSeek" }],
        listModels: async (provider) => [{ provider, id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" }],
        resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      },
    },
  });
  impl.advance("appearance-locale-v1", { locale: "zh", theme: "system" });
  impl.advance("privacy-v1");
  await impl.selectModel({ provider: "deepseek-official", model: "deepseek-v4-flash" });
  impl.saveFacts({
    selection: { provider: "deepseek-official", model: "deepseek-v4-flash" },
    credentialRef: "DEEPSEEK_OFFICIAL_API_KEY",
  });
  impl.advance("credential-v1", {
    descriptor: { configured: true, source: "file", writable: true, serverVerified: true },
  });
  assert.equal(impl.status().current, "model-test-v1");
  const descriptor = await impl.enterCredential({ provider: "deepseek-official", value: SECRET });
  assert.deepEqual(descriptor, { configured: true, source: "file", writable: true });
  assert.deepEqual(sets, [{ ref: "DEEPSEEK_API_KEY", value: SECRET }]);
  assert.equal(impl.facts().credentialRef, "DEEPSEEK_API_KEY");
  assert.equal(impl.status().current, "model-test-v1");
});

test("enterCredential rejects unknown provider, short/newline value, and leaked describe value", async () => {
  const { dir } = userTree();
  const impl = createPenglaiOnboardingRemoteImpl({
    dir,
    officialCatalog: catalog,
    officialWelcomeAck: () => true,
    agents: {
      credentials: {
        set: async () => undefined,
        describe: async () => ({ configured: true, source: "file", writable: true }),
      },
      llm: {
        listProviders: () => [{ id: "deepseek", name: "DeepSeek" }],
        listModels: async (provider) => [{ provider, id: "deepseek-chat", name: "DeepSeek Chat" }],
        resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      },
    },
  });
  impl.advance("appearance-locale-v1", { locale: "zh", theme: "system" });
  impl.advance("privacy-v1");
  await impl.selectModel({ provider: "deepseek", model: "deepseek-chat" });
  await assert.rejects(() => impl.enterCredential({ provider: "evil", value: "abcd" }), /catalog/);
  await assert.rejects(() => impl.enterCredential({ provider: "deepseek", value: "abc" }), /length|4\.\.4096|too short/);
  await assert.rejects(
    () => impl.enterCredential({ provider: "deepseek", value: "abcd\nmore" }),
    /newline/,
  );

  const leak = createPenglaiOnboardingRemoteImpl({
    dir: userTree().dir,
    officialCatalog: catalog,
    officialWelcomeAck: () => true,
    agents: {
      credentials: {
        set: async () => undefined,
        describe: async () => ({ configured: true, source: "file", writable: true, value: SECRET }),
      },
    },
  });
  leak.advance("appearance-locale-v1", { locale: "zh", theme: "system" });
  leak.advance("privacy-v1");
  leak.advance("model-provider-v1", {
    officialCatalog: catalog(),
    providerSelection: { provider: "deepseek", model: "deepseek-chat" },
  });
  await assert.rejects(() => leak.enterCredential({ provider: "deepseek", value: "abcd" }), /must not return value/);
});

test("listModels wraps official llm.listModels and requires catalog provider", async () => {
  const { dir } = userTree();
  const impl = createPenglaiOnboardingRemoteImpl({
    dir,
    officialCatalog: catalog,
    officialWelcomeAck: () => true,
    agents: {
      llm: {
        listProviders: () => [{ id: "deepseek", name: "DeepSeek" }],
        listModels: async (provider) => [{ provider, id: "deepseek-chat", name: "DeepSeek Chat" }],
        resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      },
    },
  });
  const models = await impl.listModels({ provider: "deepseek" });
  assert.deepEqual(models, [{ provider: "deepseek", id: "deepseek-chat", name: "DeepSeek Chat" }]);
  await assert.rejects(() => impl.listModels({ provider: "invented" }), /catalog/);
});

test("listModels maps official NO_ADAPTER to a closed PenglaiError", async () => {
  const { dir } = userTree();
  const impl = createPenglaiOnboardingRemoteImpl({
    dir,
    officialCatalog: () => ({ providers: [{ id: "opencode-go", protocol: "unknown" }] }),
    officialWelcomeAck: () => true,
    agents: {
      llm: {
        listProviders: () => [{ id: "opencode-go", name: "opencode-go" }],
        listModels: async () => {
          throw new Error('no adapter registered for provider "opencode-go"');
        },
        resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      },
    },
  });
  await assert.rejects(() => impl.listModels({ provider: "opencode-go" }), PenglaiError);
  await assert.rejects(() => impl.listModels({ provider: "opencode-go" }), /no adapter registered/);
});

test("createWorkspace uses official registry after path jail and never guesses list()[0]", async () => {
  const { userDataRoot, dir } = userTree();
  const installRoot = mkdtempSync(join(tmpdir(), "penglai-app-"));
  const allowed = mkdtempSync(join(tmpdir(), "penglai-ws-ok-"));
  const decoy = mkdtempSync(join(tmpdir(), "penglai-ws-decoy-"));
  const rows: Array<{ id: string; title?: string; path?: string }> = [
    { id: "ws-decoy", title: "Decoy", path: decoy },
  ];
  const impl = createPenglaiOnboardingRemoteImpl({
    dir,
    userDataRoot,
    installRoots: [installRoot],
    officialCatalog: catalog,
    officialWelcomeAck: () => true,
    agents: {
      workspaceRegistry: {
        list: () => rows,
        create: async (path, title) => {
          const row = { id: "ws-created", title, path };
          rows.push(row);
          return { id: row.id, title: row.title };
        },
      },
    },
  });
  impl.advance("appearance-locale-v1", { locale: "zh", theme: "system" });
  impl.advance("privacy-v1");
  impl.advance("model-provider-v1", {
    officialCatalog: catalog(),
    providerSelection: { provider: "deepseek", model: "deepseek-chat" },
  });
  impl.advance("credential-v1", {
    descriptor: { configured: true, source: "file", writable: true, serverVerified: true },
  });
  impl.advance("model-test-v1", { nonce: "n1", durableFinal: "PENGLAI_OK_n1" });
  assert.equal(impl.status().current, "COMPLETE");

  await assert.rejects(() => impl.createWorkspace({ path: "relative", title: "X" }), /absolute/);
  await assert.rejects(() => impl.createWorkspace({ path: dir, title: "X" }), /SECURITY_POLICY|onboarding/);
  await assert.rejects(() => impl.createWorkspace({ path: userDataRoot, title: "X" }), /SECURITY_POLICY|userData/);
  await assert.rejects(
    () => impl.createWorkspace({ path: join(userDataRoot, "dsh-home"), title: "X" }),
    /SECURITY_POLICY|userData/,
  );
  await assert.rejects(() => impl.createWorkspace({ path: installRoot, title: "X" }), /SECURITY_POLICY|install/);

  const nestedInstall = join(installRoot, "Contents");
  mkdirSync(nestedInstall);
  await assert.rejects(() => impl.createWorkspace({ path: nestedInstall, title: "X" }), /SECURITY_POLICY|install/);

  const link = join(mkdtempSync(join(tmpdir(), "penglai-link-")), "alias");
  symlinkSync(userDataRoot, link);
  await assert.rejects(() => impl.createWorkspace({ path: link, title: "X" }), /SECURITY_POLICY|userData/);

  await assert.rejects(() => impl.createWorkspace({ path: allowed, title: "Docs" }), /not allowed|expected|COMPLETE|workspace/);
});

test("status returns selection and workspaceId without secrets", async () => {
  const { dir } = userTree();
  const impl = createPenglaiOnboardingRemoteImpl({
    dir,
    officialCatalog: catalog,
    officialWelcomeAck: () => true,
    agents: {
      llm: {
        listProviders: () => [{ id: "deepseek", name: "DeepSeek" }],
        listModels: async (provider) => [{ provider, id: "deepseek-chat", name: "DeepSeek Chat" }],
        resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      },
    },
  });
  impl.advance("appearance-locale-v1", { locale: "zh", theme: "system" });
  impl.advance("privacy-v1");
  await impl.selectModel({ provider: "deepseek", model: "deepseek-chat" });
  const afterModel = impl.status();
  assert.deepEqual(afterModel.selection, { provider: "deepseek", model: "deepseek-chat" });
  assert.equal("value" in afterModel, false);
  impl.saveFacts({ workspaceId: "ws-resume" });
  const afterWorkspace = impl.status();
  assert.equal(afterWorkspace.workspaceId, "ws-resume");
  assert.deepEqual(afterWorkspace.selection, { provider: "deepseek", model: "deepseek-chat" });
});

test("wizard remotes exist without a generic advance", async () => {
  const remote = readFileSync(new URL("./onboarding-remote.ts", import.meta.url), "utf8");
  assert.match(remote, /@Remote\s+completeWelcome/);
  assert.match(remote, /@Remote\s+enterCredential/);
  assert.match(remote, /@Remote\s+listModels/);
  assert.match(remote, /@Remote\s+createWorkspace/);
  assert.doesNotMatch(remote, /@Remote\s+advance\b/);
});
