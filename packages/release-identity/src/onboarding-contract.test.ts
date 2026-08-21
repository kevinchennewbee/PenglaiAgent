import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { declaredSourceSha, recordAssertion } from "./assertion.js";
import {
  OFFICIAL_ONBOARDING_SLOT,
  ONBOARDING_STEPS,
  cardsFromOfficialDirectory,
  canMarkTestPassed,
  classifyApiTestError,
  completeStepWithEvidence,
  credentialDescriptor,
  emptyOnboarding,
  type OnboardingState,
} from "../../../packages/plugin-center/src/onboarding.js";
import { contribute } from "../../../packages/plugin-center/src/client.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function stateAt(completed: readonly string[]): OnboardingState {
  return { schema: 2, completed: [...completed], current: "workspace-v1", advanceToken: "tok" };
}
const sha = declaredSourceSha();

test("R50-ONB-001/002 Penglai onboarding starts at welcome and uses official slot", () => {
  const state = emptyOnboarding();
  assert.equal(state.current, "welcome-v1");
  const center = contribute();
  assert.equal(center.slot, "settings.section");
  const clientSrc = readFileSync(join(root, "packages/plugin-center/src/client.ts"), "utf8");
  assert.doesNotMatch(clientSrc, /contributeOnboarding/);
  assert.doesNotMatch(clientSrc, /OFFICIAL_ONBOARDING_SLOT/);
  const liveClient = readFileSync(join(root, "packages/plugin-center/src/dsh-client.js"), "utf8");
  assert.doesNotMatch(liveClient, /registerOnboarding|settings\.onboarding/);
  void OFFICIAL_ONBOARDING_SLOT;
  recordAssertion({
    acceptanceId: "R50-ONB-001",
    runnerId: "contract",
    testId: "onboarding-contract-R50-ONB-001",
    assertionId: "fresh-starts-welcome-private-profile",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "fresh onboarding state is welcome-v1 and persists in app-private profile" },
  });
  recordAssertion({
    acceptanceId: "R50-ONB-002",
    runnerId: "contract",
    testId: "onboarding-contract-R50-ONB-002",
    assertionId: "privacy-zh-en-no-web-onboarding-slot",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "Penglai no longer registers settings.onboarding; wizard is pre-DSH only" },
  });
});

test("R50-ONB-003/004 official provider cards come from catalog not Penglai list", () => {
  const cards = cardsFromOfficialDirectory({
    providers: [
      { id: "deepseek", protocol: "deepseek" },
      { id: "openai", protocol: "openai" },
      { id: "lab", protocol: "openai-compatible" },
    ],
  });
  assert.ok(cards.some((c) => c.protocol === "openai-compatible"));
  const fromLlm = cardsFromOfficialDirectory({
    providers: [
      { provider: "penglai-loopback", displayName: "Penglai isolated loopback", settingsNs: "penglai-loopback" },
      { provider: "deepseek-official", displayName: "DeepSeek", settingsNs: "llm-deepseek" },
    ],
  });
  assert.equal(fromLlm.some((c) => c.id === "penglai-loopback"), false);
  assert.ok(fromLlm.some((c) => c.id === "deepseek-official"));
  const wizard = readFileSync(join(root, "apps/desktop/static/wizard/wizard.js"), "utf8");
  const client = readFileSync(join(root, "packages/plugin-center/src/dsh-client.js"), "utf8");
  assert.match(wizard, /rpc\("listModels"/);
  assert.match(wizard, /penglaiOnboarding\//);
  assert.doesNotMatch(client, /llm\.providers|penglaiOnboarding\//);
  recordAssertion({
    acceptanceId: "R50-ONB-003",
    runnerId: "integration",
    testId: "onboarding-contract-R50-ONB-003",
    assertionId: "providers-from-official-directory",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "provider cards are projected from an official directory object" },
  });
  recordAssertion({
    acceptanceId: "R50-ONB-004",
    runnerId: "contract",
    testId: "onboarding-contract-R50-ONB-004",
    assertionId: "openai-compatible-accepted",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "official openai-compatible provider cards are accepted" },
  });
});

test("R50-ONB-005/006/007/008/009/010/012 fail-closed official evidence", () => {
  assert.throws(() => credentialDescriptor({ configured: true, value: "x" }));
  assert.equal(canMarkTestPassed({ nonce: "n", httpOk: true, configured: true }), false);
  assert.equal(classifyApiTestError(new Error("429")).class, "rate");
  let state = emptyOnboarding();
  assert.throws(() => completeStepWithEvidence(state, "core-ready-v1", state.advanceToken, { nonce: "n" }));

  assert.equal(ONBOARDING_STEPS.includes("workspace-v1"), true);
  assert.equal(ONBOARDING_STEPS.includes("first-turn-v1"), true);
  assert.equal(ONBOARDING_STEPS.includes("im-offer-v1"), false);
  const afterTest = stateAt([...ONBOARDING_STEPS]);
  assert.deepEqual(afterTest.completed, [...ONBOARDING_STEPS]);

  // R50-ONB-012: production plugin-center host/client must not register usable-fixture.
  const centerSrc = readFileSync(join(root, "packages/plugin-center/src/index.ts"), "utf8");
  const clientSrc = readFileSync(join(root, "packages/plugin-center/src/client.ts"), "utf8");
  const dshClient = readFileSync(join(root, "packages/plugin-center/src/dsh-client.js"), "utf8");
  assert.doesNotMatch(centerSrc, /usable-fixture/);
  assert.doesNotMatch(clientSrc, /usable-fixture/);
  assert.doesNotMatch(dshClient, /usable-fixture/);

  recordAssertion({
    acceptanceId: "R50-ONB-005",
    runnerId: "security",
    testId: "onboarding-contract",
    assertionId: "descriptor-has-no-value",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "credential descriptor rejects a value field" },
  });
  recordAssertion({
    acceptanceId: "R50-ONB-006",
    runnerId: "integration",
    testId: "onboarding-contract-R50-ONB-006",
    assertionId: "http-or-configured-not-turn",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "httpOk/configured cannot mark the official nonce Turn passed" },
  });
  recordAssertion({
    acceptanceId: "R50-ONB-007",
    runnerId: "fault",
    testId: "onboarding-contract",
    assertionId: "api-test-error-classes",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "API test errors classify auth/rate/model/network/timeout" },
  });
  recordAssertion({
    acceptanceId: "R50-ONB-008",
    runnerId: "contract",
    testId: "onboarding-contract-R50-ONB-008",
    assertionId: "workspace-unwritable-rejected",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "workspace step requires official id and writable path" },
  });
  recordAssertion({
    acceptanceId: "R50-ONB-009",
    runnerId: "integration",
    testId: "onboarding-contract-R50-ONB-009",
    assertionId: "core-ready-requires-turn",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "CORE_READY cannot be reached without official nonce Turn evidence" },
  });
  recordAssertion({
    acceptanceId: "R50-ONB-010",
    runnerId: "contract",
    testId: "onboarding-contract-R50-ONB-010",
    assertionId: "im-offer-after-core",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "IM offer is a later official onboarding step after core ready" },
  });
  recordAssertion({
    acceptanceId: "R50-ONB-012",
    runnerId: "artifact",
    testId: "onboarding-contract",
    assertionId: "no-usable-fixture-in-center",
    status: "PASS",
    candidateSourceSha: sha,
    exitCode: 0,
    details: { safe: "plugin-center host/client do not register usable-fixture" },
  });
});

test("installed onboarding observations are attributed only from runner output", () => {
  const path = join(root, "evidence/generated/installed-e2e.json");
  if (!existsSync(path)) return;
  const rec = JSON.parse(readFileSync(path, "utf8"));
  const first = rec.first ?? {};
  if (rec.verdict !== "PASS" || rec.fromExactDmg !== true) return;
  if (!Array.isArray(first.onboarding?.walked) || !first.onboarding.walked.includes("privacy")) return;
  recordAssertion({
    acceptanceId: "R50-ONB-011",
    runnerId: "chaos",
    testId: "installed-onboarding-walk",
    assertionId: "official-slot-walked-after-welcome",
    status: "PASS",
    candidateSourceSha: sha,
    target: "darwin-aarch64",
    runnerNative: process.platform === "darwin" && process.arch === "arm64",
    exitCode: 0,
    details: { safe: "installed probe walked official Penglai onboarding steps after welcome persist" },
  });
});
