import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyApiTestError, unwrapTypertResult } from "./typert.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("classifyApiTestError maps AUTH, rate, and adapter failures", () => {
  assert.equal(classifyApiTestError(new Error("AUTH Authentication Fails")).class, "auth");
  assert.equal(classifyApiTestError(new Error("429 rate limit")).class, "rate");
  assert.equal(classifyApiTestError(new Error('no adapter registered for provider "x"')).class, "adapter");
  assert.equal(classifyApiTestError(new Error("something else")).class, "unknown");
});

test("unwrapTypertResult accepts envelopes and envelope-less success", () => {
  assert.equal(unwrapTypertResult({ ok: true, value: 7 }), 7);
  assert.deepEqual(unwrapTypertResult({ catalog: [] }), { catalog: [] });
  assert.throws(() => unwrapTypertResult({ ok: false, error: { message: "nope" } }), /nope/);
});

test("wizard classifier stays in lockstep with classifyApiTestError", () => {
  const js = readFileSync(join(root, "apps/desktop/static/wizard/wizard.js"), "utf8");
  const match = js.match(/function classifyApiTestError\(err\) \{[\s\S]*?return "unknown";\r?\n  \}/);
  assert.ok(match);
  const classify = Function(`${match[0]}; return classifyApiTestError;`)() as (err: unknown) => string;
  const fixtures = [
    "AUTH Authentication Fails, Your api key: ****0f08 is invalid",
    "401 unauthorized",
    "429 rate limit",
    "unknown model 404",
    "official nonce Turn produced no durable final",
    "ETIMEDOUT timed out",
    "ENOTFOUND offline network",
    'no adapter registered for provider "opencode-go"',
    "something else",
  ];
  for (const text of fixtures) {
    assert.equal(classify(new Error(text)), classifyApiTestError(new Error(text)).class, text);
  }
});

test("first-party dsh-client unwrapRemote matches unwrapTypertResult", () => {
  const files = [
    "packages/im/src/dsh-client.js",
    "packages/plugin-center/src/dsh-client.js",
    "packages/asr/src/dsh-client.js",
    "packages/moss-tts/src/dsh-client.js",
  ];
  const samples = [
    { ok: true, value: { id: "x" } },
    { ok: false, error: { message: "denied" } },
    { inventory: [] },
    0,
  ];
  for (const rel of files) {
    const src = readFileSync(join(root, rel), "utf8");
    const match =
      src.match(/function unwrapRemote\(result\) \{[\s\S]*?\n    \}/) ??
      src.match(/const unwrapRemote = \(result\) => \{[\s\S]*?\n      \};/);
    assert.ok(match, rel);
    const unwrap = Function(`${match[0]}; return unwrapRemote;`)() as (result: unknown) => unknown;
    for (const sample of samples) {
      let left: unknown;
      let right: unknown;
      let leftErr = "";
      let rightErr = "";
      try {
        left = unwrap(sample);
      } catch (err) {
        leftErr = err instanceof Error ? err.message : String(err);
      }
      try {
        right = unwrapTypertResult(sample);
      } catch (err) {
        rightErr = err instanceof Error ? err.message : String(err);
      }
      assert.equal(leftErr, rightErr, rel);
      assert.deepEqual(left, right, rel);
    }
  }
});
