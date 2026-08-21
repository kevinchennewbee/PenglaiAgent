import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "static", "wizard");
const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "wizard.css"), "utf8");
const js = readFileSync(join(root, "wizard.js"), "utf8");

function extractObject(name: string, closer: string) {
  const match = js.match(new RegExp(`const ${name} = (${closer})`));
  assert.ok(match, `wizard.js must declare ${name}`);
  return Function(`"use strict"; return (${match[1].replace(/;$/, "")});`)() as unknown;
}

test("wizard HTML is static, token-page-shaped, and CSP-safe", () => {
  assert.match(html, /data-penglai-wizard/);
  assert.match(html, /<main id="wizard-root">/);
  assert.match(html, /href="\/wizard\/wizard\.css"/);
  assert.match(html, /src="\/wizard\/wizard\.js"/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /react/i);
});

test("wizard JS is plain source with Typert envelope and no DSH client", () => {
  assert.doesNotMatch(js, /from\s+["']react["']|ReactDOM|createRoot|jsx/i);
  assert.doesNotMatch(js, /dsh-client|@deepseek-ai\/dsh-client|registerOnboarding/);
  assert.match(js, /data-penglai-wizard-back/);
  assert.match(js, /data-penglai-wizard-skip/);
  assert.match(js, /data-penglai-wizard-continue/);
  assert.match(js, /data-penglai-wizard-locale/);
  assert.match(js, /data-penglai-wizard-provider/);
  assert.match(js, /data-penglai-wizard-model/);
  assert.match(js, /rpc\("listProviders"\)/);
  assert.match(js, /data-penglai-wizard-retry-catalog/);
  assert.match(js, /errorCatalog/);
  assert.match(js, /data-penglai-wizard-key/);
  assert.match(js, /data-penglai-wizard-language-zh/);
  assert.match(js, /data-penglai-wizard-language-en/);
  assert.match(js, /data-penglai-wizard-workspace/);
  assert.match(js, /data-penglai-wizard-message/);
  assert.match(js, /createWorkspace/);
  assert.match(js, /listWorkspaces/);
  assert.match(js, /recordWorkspace/);
  assert.match(js, /runFirstConversation/);
  assert.doesNotMatch(js, /data-penglai-wizard-im/);
  assert.match(js, /readKeyDraft\(\);\s*state\.busy = true/);
  assert.match(js, /patchStatus\(\)/);
  assert.match(js, /value: state\.keyDraft/);
  assert.doesNotMatch(js, /state\.busy = true;\s*state\.error = "";\s*render\(\);/);
  assert.match(js, /data-penglai-wizard-error/);
  assert.doesNotMatch(js, /onInput: \(ev\) => \{\s*state\.(message|keyDraft|newTitle) = ev\.target\.value;\s*render\(\);/);
  assert.match(js, /type:\s*"client-request"/);
  assert.match(js, /method:\s*"penglaiOnboarding\/" \+ method/);
  assert.match(js, /rpcId:\s*crypto\.randomUUID\(\)/);
  assert.match(js, /payload:\s*input === undefined \? \{ args: \{\} \} : \{ args: \{ input \} \}/);
  assert.doesNotMatch(js, /JSON\.stringify\(\{ type: "client-request", method:[^}]*\.\.\.payload \}\)/);
  assert.match(js, /window\.__PENGLAI_WIZARD__/);
  assert.match(js, /wizardFinished/);
});

test("wizard CSS covers light, dark, and system color-scheme", () => {
  assert.match(css, /color-scheme:\s*light dark/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /\.mark/);
  assert.match(css, /\.steps/);
});

test("wizard zh and en copy share the same keys", () => {
  const copy = extractObject("COPY", "\\{[\\s\\S]*?\\n  \\};") as { zh: Record<string, string>; en: Record<string, string> };
  assert.deepEqual(Object.keys(copy.zh).sort(), Object.keys(copy.en).sort());
  for (const key of Object.keys(copy.zh)) {
    assert.notEqual(copy.zh[key].trim(), "");
    assert.notEqual(copy.en[key].trim(), "");
  }
});

test("wizard user-facing copy is Penglai product language", () => {
  const copy = extractObject("COPY", "\\{[\\s\\S]*?\\n  \\};") as { zh: Record<string, string>; en: Record<string, string> };
  assert.match(copy.zh.privacyBody, /YAML/);
  assert.match(copy.en.privacyBody, /YAML/);
  assert.match(copy.zh.privacyBody, /微信/);
  assert.match(copy.en.privacyBody, /Weixin/);
  assert.match(copy.zh.languageTitle, /蓬莱/);
  assert.match(copy.en.languageTitle, /Penglai/);
  for (const table of [copy.zh, copy.en]) {
    for (const key of ["languageBody", "privacyBody", "modelsBody", "credentialBody", "doneBody", "errorModel", "errorCatalog"]) {
      assert.doesNotMatch(table[key], /official DSH|credentials\.set|nonce|DSH Web/i);
    }
  }
  assert.match(js, /data-penglai-wizard-theme-system/);
  assert.match(js, /data-penglai-wizard-theme-light/);
  assert.match(js, /data-penglai-wizard-theme-dark/);
});

test("wizard unwraps official server-response and refuses a top-level args envelope", () => {
  const match = js.match(/function unwrapOfficialResult\(payload\) \{[\s\S]*?\n  \}/);
  assert.ok(match, "wizard.js must unwrap official result.ok / result.value");
  const unwrap = Function(`${match[0]}; return unwrapOfficialResult;`)() as (payload: unknown) => unknown;
  const value = unwrap({
    type: "server-response",
    rpcId: "1",
    result: { ok: true, value: { current: "model-provider-v1", providers: [{ id: "deepseek-official" }] } },
  }) as { current: string; providers: Array<{ id: string }> };
  assert.equal(value.current, "model-provider-v1");
  assert.equal(value.providers[0]?.id, "deepseek-official");
  assert.throws(
    () =>
      unwrap({
        type: "server-response",
        result: { ok: false, error: { message: "invalid client-request message" } },
      }),
    /invalid client-request message/,
  );
  assert.throws(() => unwrap({ type: "client-request", method: "penglaiOnboarding/status", args: {} }), /rpc/);
  assert.match(js, /if \(!state\.current\) return false;/);
});

test("wizard screens are 7 numbered steps including workspace and first turn", () => {
  const screens = extractObject("LEDGER_SCREENS", "\\[[\\s\\S]*?\\n  \\];") as Array<{
    id: string;
    ledger: string;
    number: number;
    skippable: boolean;
  }>;
  assert.deepEqual(
    screens.map((s) => s.id),
    ["language", "privacy", "models", "keytest", "workspace", "firstturn", "done"],
  );
  assert.deepEqual(screens.map((s) => s.number), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(screens.every((s) => s.skippable === false), true);
});

test("wizard API-test classifier distinguishes auth, rate, model, timeout, network, and adapter", () => {
  const match = js.match(/function classifyApiTestError\(err\) \{[\s\S]*?return "unknown";\n  \}/);
  assert.ok(match);
  const classify = Function(`${match[0]}; return classifyApiTestError;`)() as (err: unknown) => string;
  assert.equal(classify(new Error("401 unauthorized invalid key")), "auth");
  assert.equal(classify(new Error("AUTH Authentication Fails, Your api key: ****0f08 is invalid")), "auth");
  assert.equal(classify(new Error("MISSING_CREDENTIAL no credential")), "auth");
  assert.equal(classify(new Error('llm-deepseek: no API key for provider route "deepseek-official"')), "auth");
  assert.equal(classify(new Error("429 rate limit")), "rate");
  assert.equal(classify(new Error("unknown model 404")), "model");
  assert.equal(classify(new Error("official nonce Turn produced no durable final")), "empty");
  assert.equal(classify(new Error("official nonce Turn did not complete")), "empty");
  assert.equal(classify(new Error("ETIMEDOUT timed out")), "timeout");
  assert.equal(classify(new Error("ENOTFOUND offline network")), "network");
  assert.equal(classify(new Error('no adapter registered for provider "opencode-go"')), "adapter");
  assert.equal(classify(new Error("something else")), "unknown");
  assert.doesNotMatch(js, /classifyApiTestError\(err\) \+ ": "/);
  assert.match(js, /errorAdapter/);
  assert.match(js, /errorEmpty/);
  assert.match(js, /formatWizardError/);
  assert.match(js, /errorJail/);
  assert.match(js, /errorRpc/);
  assert.match(js, /kind === "api-test"/);
  assert.match(js, /screen.id === "keytest"/);
  assert.match(js, /testing/);
  assert.match(
    js,
    /canWrite && \(state\.current === "credential-v1" \|\| state\.current === "model-test-v1"\)/,
  );
  assert.match(js, /throw new Error\(t\("errorGeneric"\)\)/);
  assert.doesNotMatch(js, /if \(!result \|\| result\.passed !== true\) throw new Error\(t\("errorGeneric"\)\)/);
  assert.match(js, /official nonce Turn did not complete/);
  assert.match(js, /official first Turn did not complete/);
});
