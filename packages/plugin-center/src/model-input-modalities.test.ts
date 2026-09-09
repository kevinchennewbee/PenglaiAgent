import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PenglaiError } from "@penglai/contracts";
import {
  applyImageInputToCatalog,
  catalogModelsFromSettingsValue,
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
