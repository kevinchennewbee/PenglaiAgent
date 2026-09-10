import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { Config } from "@deepseek-ai/dsh-llm-deepseek";
import FileSettingsProvider from "@deepseek-ai/dsh-settings-file";
import { PenglaiError } from "@penglai/contracts";
import {
  applyImageInputToCatalog,
  catalogModelFromUnknown,
  catalogModelsFromSettingsValue,
  listOfficialDeepSeekCatalog,
  modalitiesAcceptImage,
  setOfficialDeepSeekImageInput,
  withImageModality,
  type CatalogModelDraft,
} from "./model-input-modalities.js";

test("custom catalog rows default to text and do not infer vision from the model id", () => {
  const rows = catalogModelsFromSettingsValue({
    models: [
      { id: "deepseek-v4-flash-vision-exp", inputModalities: ["text", "image"] },
      { id: "deepseek-v4.1-flash-expires-on-0910" },
      { id: "any-custom-id" },
    ],
  });
  assert.deepEqual(
    rows.map((row) => ({ id: row.id, image: modalitiesAcceptImage(row.inputModalities) })),
    [
      { id: "deepseek-v4-flash-vision-exp", image: true },
      { id: "deepseek-v4.1-flash-expires-on-0910", image: false },
      { id: "any-custom-id", image: false },
    ],
  );
  assert.deepEqual(withImageModality(["text"], true), ["text", "image"]);
  assert.deepEqual(withImageModality(["text", "image"], false), ["text"]);
});

test("image toggle writes official inputModalities without inventing unknown models", () => {
  const catalog: CatalogModelDraft[] = [
    { id: "deepseek-v4-flash", name: "Flash", inputModalities: ["text"] },
    { id: "custom-vision-capable", inputModalities: ["text"] },
  ];
  const enabled = applyImageInputToCatalog(catalog, "custom-vision-capable", true);
  assert.deepEqual(enabled.find((row) => row.id === "custom-vision-capable")?.inputModalities, [
    "text",
    "image",
  ]);
  assert.equal(enabled.find((row) => row.id === "deepseek-v4-flash")?.inputModalities.includes("image"), false);
  const disabled = applyImageInputToCatalog(enabled, "custom-vision-capable", false);
  assert.deepEqual(disabled.find((row) => row.id === "custom-vision-capable")?.inputModalities, ["text"]);
  assert.equal(disabled.find((row) => row.id === "custom-vision-capable")?.imagePixelBudget, undefined);
  assert.throws(
    () => applyImageInputToCatalog(catalog, "not-in-catalog", true),
    (err: unknown) => err instanceof PenglaiError && err.errorClass === "INVALID_INPUT",
  );
});

test("setOfficialDeepSeekImageInput writes the official llm-deepseek models array", async () => {
  const ops: unknown[] = [];
  const official = {
    settings: {
      describe: () => [{ ns: "llm-deepseek", value: { models: [{ id: "custom-a" }] } }],
      mutate: async (ns: string, next: unknown) => {
        ops.push({ ns, next });
      },
    },
  };
  const result = await setOfficialDeepSeekImageInput(official, { modelId: "custom-a", enabled: true });
  assert.deepEqual(ops[0], {
    ns: "llm-deepseek",
    next: [{ op: "set", path: ["models"], value: result }],
  });
  assert.deepEqual(result[0]?.inputModalities, ["text", "image"]);
  await assert.rejects(
    () => setOfficialDeepSeekImageInput(official, { modelId: "missing", enabled: true }),
    (err: unknown) => err instanceof PenglaiError && err.errorClass === "INVALID_INPUT",
  );
  assert.equal(ops.length, 1);
});

test("image toggle keeps unknown official fields including nested metadata and in-history systemPromptUpdate", () => {
  const officialFlash = {
    id: "deepseek-flash",
    name: "DeepSeek-V41-Flash",
    contextWindow: 128_000,
    inputModalities: ["text", "image"],
    imagePixelBudget: 640_000,
    imageMaxBytes: 1_048_576,
    systemPromptUpdate: "in-history",
    futureCapability: { nested: { flag: true, items: [1, "keep"] }, extra: "untouched" },
  };
  const catalog = catalogModelsFromSettingsValue({ models: [officialFlash] });
  assert.equal(catalog[0]?.systemPromptUpdate, "in-history");
  assert.deepEqual(catalog[0]?.futureCapability, officialFlash.futureCapability);
  const disabled = applyImageInputToCatalog(catalog, "deepseek-flash", false);
  const disabledRow = disabled.find((row) => row.id === "deepseek-flash");
  assert.deepEqual(disabledRow?.inputModalities, ["text"]);
  assert.equal(disabledRow?.systemPromptUpdate, "in-history");
  assert.deepEqual(disabledRow?.futureCapability, officialFlash.futureCapability);
  assert.equal(disabledRow?.imagePixelBudget, undefined);
  assert.equal(disabledRow?.name, "DeepSeek-V41-Flash");
  const enabled = applyImageInputToCatalog(disabled, "deepseek-flash", true);
  const enabledRow = enabled.find((row) => row.id === "deepseek-flash");
  assert.deepEqual(enabledRow?.inputModalities, ["text", "image"]);
  assert.equal(enabledRow?.systemPromptUpdate, "in-history");
  assert.deepEqual(enabledRow?.futureCapability, officialFlash.futureCapability);
  assert.equal(enabledRow?.imagePixelBudget, 640_000);
});

test("resolveModelInfo fallback catalog draft round-trips official settings.mutate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-llm-deepseek-settings-"));
  const app = new Context();
  await app.plugin(FileSettingsProvider, { path: join(dir, "settings.json"), watch: false });
  app.settings.register("llm-deepseek", Config);
  const resolvedInfo = {
    provider: "deepseek-official",
    id: "deepseek-flash",
    name: "DeepSeek-V41-Flash",
    inputModalities: ["text", "image"],
    systemPromptUpdate: "in-history",
    context: { contextWindow: 1_000_000 },
    defaultMaxTokens: 256_000,
    reasoning: { efforts: [{ id: "high", name: "High" }] },
  };
  const official = {
    settings: app.settings,
    llm: {
      async listModels() {
        return [{ id: "deepseek-flash", name: "DeepSeek-V41-Flash" }];
      },
      async resolveModelInfo() {
        return resolvedInfo;
      },
    },
  };
  const fallbackOfficial = {
    settings: {
      describe: () => [{ ns: "llm-deepseek", value: { models: [] } }],
      mutate: app.settings.mutate.bind(app.settings),
    },
    llm: official.llm,
  };
  const listed = await listOfficialDeepSeekCatalog(fallbackOfficial);
  assert.equal(listed[0]?.id, "deepseek-flash");
  assert.equal(listed[0]?.systemPromptUpdate, "in-history");
  assert.equal(listed[0]?.context, undefined);
  assert.equal(listed[0]?.reasoning, undefined);
  assert.equal(listed[0]?.defaultMaxTokens, undefined);
  assert.equal(listed[0]?.provider, undefined);
  const spreadDraft = catalogModelFromUnknown({ ...resolvedInfo, id: "deepseek-flash" });
  await app.settings.mutate("llm-deepseek", [{ op: "set", path: ["models"], value: [spreadDraft] }]);
  await app.settings.mutate("llm-deepseek", [{ op: "set", path: ["models"], value: listed }]);
  const enabled = await setOfficialDeepSeekImageInput(
    { settings: app.settings, llm: official.llm },
    { modelId: "deepseek-flash", enabled: true },
  );
  assert.equal(enabled[0]?.systemPromptUpdate, "in-history");
  assert.deepEqual(enabled[0]?.inputModalities, ["text", "image"]);
  assert.equal(listed[0]?.contextWindow, 1_000_000);
  assert.equal(listed[0]?.maxTokens, 256_000);
});

test("client settings section uses official settings.mutate and does not special-case a model id", () => {
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  const remote = readFileSync(new URL("./model-input-remote.ts", import.meta.url), "utf8");
  assert.match(client, /id: "penglai-model-input"/);
  assert.match(client, /penglaiModelInput/);
  assert.match(client, /setImageInput/);
  assert.doesNotMatch(client, /deepseek-v4\.1-flash-expires-on-0910/);
  assert.match(remote, /llm-deepseek/);
  assert.match(remote, /setOfficialDeepSeekImageInput/);
  assert.doesNotMatch(remote, /deepseek-v4\.1-flash-expires-on-0910/);
});
