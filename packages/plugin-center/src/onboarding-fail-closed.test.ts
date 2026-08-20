import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { createPenglaiOnboardingRemoteImpl } from "./onboarding-remote.js";

function impl(agents?: Parameters<typeof createPenglaiOnboardingRemoteImpl>[0]["agents"]) {
  return createPenglaiOnboardingRemoteImpl({
    dir: mkdtempSync(join(tmpdir(), "penglai-onb-fc-")),
    officialCatalog: () => ({
      providers: [{ id: "deepseek", protocol: "deepseek", configured: true }],
    }),
    officialWelcomeAck: () => true,
    ...(agents ? { agents } : {}),
  });
}

test("first conversation is refused without server-verified model test and Workspace", async () => {
  const missingAgents = impl();
  await assert.rejects(() => missingAgents.runFirstConversation({ message: "hello" }), PenglaiError);

  const host = impl();
  host.advance("appearance-locale-v1", { locale: "zh", theme: "system" });
  host.advance("privacy-v1");
  await assert.rejects(() => host.runFirstConversation({ message: "hello" }), /first conversation|model test|workspace|not allowed/i);
  assert.notEqual(host.status().current, "COMPLETE");
  assert.notEqual(host.status().current, "im-offer-v1");
});

test("IM offer is refused until CORE_READY", () => {
  const host = impl();
  assert.throws(() => host.advance("im-offer-v1", { imChoice: "later" }), /expected|not assignable|im offer/);
});

test("DSH Web client no longer mounts a Penglai onboarding overlay", () => {
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.equal(/background:\s*["']#fff/i.test(client), false);
  assert.equal(/color:\s*["']#111/.test(client), false);
  assert.doesNotMatch(client, /registerOnboarding|function StepChrome|wrapStep|__PENGLAI_ONB/);
  assert.doesNotMatch(client, /data-penglai-onboarding|position:\s*"fixed"/);
  assert.doesNotMatch(client, /function (Privacy|Appearance|Models|Credential|Workspace|CoreReady|ImOffer)Step/);
  assert.match(client, /data-penglai-center": "1"/);
  assert.match(client, /data-penglai-update": "1"/);
  assert.match(client, /data-penglai-uninstall": "1"/);
  assert.match(client, /settings\.section/);
  assert.doesNotMatch(client, /settings\.penglai\.page/);
  assert.doesNotMatch(client, /settings\.onboarding/);
});
