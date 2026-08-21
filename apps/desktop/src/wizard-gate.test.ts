import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onboardingLedgerComplete, sanitizeStartupReason, wizardUrlForOrigin } from "./wizard-gate.js";
import { PRELOAD_API, navigationDecision } from "./preload.js";

test("onboarding ledger is complete only when current is COMPLETE", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-ledger-"));
  assert.equal(onboardingLedgerComplete(root), false);
  mkdirSync(join(root, "onboarding"), { mode: 0o700 });
  writeFileSync(join(root, "onboarding", "onboarding.json"), JSON.stringify({ schema: 2, current: "welcome-v1" }));
  assert.equal(onboardingLedgerComplete(root), false);
  writeFileSync(join(root, "onboarding", "onboarding.json"), JSON.stringify({ schema: 2, current: "COMPLETE" }));
  assert.equal(onboardingLedgerComplete(root), false, "P51-ONBOARD-001 COMPLETE without facts is not ready");
  const facts = {
    selection: { provider: "deepseek", model: "chat" },
    credentialRef: "DEEPSEEK_API_KEY",
    workspaceId: "ws-1",
    apiTest: { nonceDigest: "a".repeat(64), finalDigest: "b".repeat(64), sessionId: "s1" },
    firstConversation: { sessionId: "s-first", messageDigest: "c".repeat(64), finalDigest: "d".repeat(64) },
  };
  writeFileSync(join(root, "onboarding", "onboarding-facts.json"), JSON.stringify(facts));
  assert.equal(onboardingLedgerComplete(root), false, "JSON-only COMPLETE cannot skip");
  mkdirSync(join(root, "dsh-home"), { recursive: true });
  writeFileSync(join(root, "dsh-home", ".credentials.yaml"), "DEEPSEEK_API_KEY: sk-test-value\n");
  mkdirSync(join(root, "dsh-home", "workspaces", "ws-1"), { recursive: true });
  mkdirSync(join(root, "dsh-home", "sessions", "s1"), { recursive: true });
  mkdirSync(join(root, "dsh-home", "sessions", "s-first"), { recursive: true });
  writeFileSync(join(root, "onboarding", "current-nonce.digest"), `${"a".repeat(64)}\n`);
  assert.equal(onboardingLedgerComplete(root), true);
  writeFileSync(join(root, "dsh-home", ".credentials.yaml"), "# gone\n");
  assert.equal(onboardingLedgerComplete(root), false, "deleted credential cannot skip");
  writeFileSync(join(root, "dsh-home", ".credentials.yaml"), "DEEPSEEK_API_KEY: sk-test-value\n");
  rmSync(join(root, "dsh-home", "workspaces", "ws-1"), { recursive: true, force: true });
  assert.equal(onboardingLedgerComplete(root), false, "deleted Workspace cannot skip");
  mkdirSync(join(root, "dsh-home", "workspaces", "ws-1"), { recursive: true });
  writeFileSync(join(root, "onboarding", "current-nonce.digest"), `${"e".repeat(64)}\n`);
  assert.equal(onboardingLedgerComplete(root), false, "stale nonce cannot skip");
  writeFileSync(join(root, "onboarding", "current-nonce.digest"), `${"a".repeat(64)}\n`);
  rmSync(join(root, "dsh-home", "sessions", "s-first"), { recursive: true, force: true });
  assert.equal(onboardingLedgerComplete(root), false, "missing first conversation cannot skip");
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
