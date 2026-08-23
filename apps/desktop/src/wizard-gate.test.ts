import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onboardingLedgerComplete, sanitizeStartupReason, wizardUrlForOrigin } from "./wizard-gate.js";
import { PRELOAD_API, navigationDecision } from "./preload.js";

test("onboarding completion is durable after the evidence-gated first run", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-ledger-"));
  assert.equal(onboardingLedgerComplete(root), false);
  mkdirSync(join(root, "onboarding"), { mode: 0o700 });
  writeFileSync(join(root, "onboarding", "onboarding.json"), JSON.stringify({ schema: 2, current: "welcome-v1" }));
  assert.equal(onboardingLedgerComplete(root), false);
  const completed = [
    "welcome-v1",
    "appearance-locale-v1",
    "privacy-v1",
    "model-provider-v1",
    "credential-v1",
    "model-test-v1",
    "workspace-v1",
    "first-turn-v1",
  ];
  writeFileSync(join(root, "onboarding", "onboarding.json"), JSON.stringify({ schema: 2, current: "COMPLETE", completed }));
  assert.equal(onboardingLedgerComplete(root), false, "P51-ONBOARD-001 COMPLETE without facts is not ready");
  const facts = {
    selection: { provider: "deepseek", model: "chat" },
    credentialRef: "DEEPSEEK_API_KEY",
    workspaceId: "ws-1",
    apiTest: { nonceDigest: "a".repeat(64), finalDigest: "b".repeat(64), sessionId: "s1" },
    firstConversation: { sessionId: "s-first", messageDigest: "c".repeat(64), finalDigest: "d".repeat(64) },
  };
  writeFileSync(join(root, "onboarding", "onboarding-facts.json"), JSON.stringify(facts));
  assert.equal(onboardingLedgerComplete(root), true);
  assert.equal(onboardingLedgerComplete(root), true, "mutable credential, Workspace and Session files are not boot gates");

  writeFileSync(join(root, "onboarding", "onboarding.json"), JSON.stringify({ schema: 2, current: "COMPLETE", completed: completed.slice(0, -1) }));
  assert.equal(onboardingLedgerComplete(root), false, "all evidence-gated steps must have completed");
  writeFileSync(join(root, "onboarding", "onboarding.json"), JSON.stringify({ schema: 2, current: "COMPLETE", completed }));
  writeFileSync(join(root, "onboarding", "onboarding-facts.json"), JSON.stringify({ ...facts, apiTest: { ...facts.apiTest, finalDigest: "bad" } }));
  assert.equal(onboardingLedgerComplete(root), false, "malformed evidence digest is rejected");

  writeFileSync(join(root, "onboarding", "onboarding-facts-real.json"), JSON.stringify(facts));
  rmSync(join(root, "onboarding", "onboarding-facts.json"));
  symlinkSync(join(root, "onboarding", "onboarding-facts-real.json"), join(root, "onboarding", "onboarding-facts.json"));
  assert.equal(onboardingLedgerComplete(root), false, "completion facts cannot be a symlink");
});

test("wizard URL stays on the authenticated proxy origin", () => {
  assert.equal(wizardUrlForOrigin("http://127.0.0.1:9/"), "http://127.0.0.1:9/wizard/");
  assert.equal(navigationDecision("http://127.0.0.1:9/wizard/", "http://127.0.0.1:9/"), "allow");
  assert.equal(navigationDecision("http://127.0.0.1:9/wizard/index.html", "http://127.0.0.1:9/"), "allow");
  assert.equal(
    navigationDecision("http://127.0.0.1:9/wizard/", "http://127.0.0.1:9/", undefined, { wizardComplete: true }),
    "deny",
  );
  assert.equal(
    navigationDecision("http://127.0.0.1:9/", "http://127.0.0.1:9/", undefined, { wizardComplete: true }),
    "allow",
  );
});

test("preload API includes wizardFinished and wizardPickFolder", () => {
  assert.ok(PRELOAD_API.includes("wizardFinished"));
  assert.ok(PRELOAD_API.includes("wizardPickFolder"));
  assert.ok(PRELOAD_API.includes("confirmPluginAction"));
});

test("startup failure text redacts secret-shaped fragments", () => {
  const raw = "credentials.set failed: api_key=sk-abcdefghijklmnopqrstuvwxyz012345 token=wx-secret leftover sk-zzzzzzzzzzzzzzzz";
  const safe = sanitizeStartupReason(raw);
  assert.equal(safe.includes("sk-abcdefghijklmnopqrstuvwxyz012345"), false);
  assert.equal(safe.includes("wx-secret"), false);
  assert.match(safe, /sk-\[redacted\]/);
  assert.match(safe, /api_key=\[redacted\]/);
  assert.match(safe, /token=\[redacted\]/);
});
