import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ROOT } from "./lib/repo.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { attachPage, delay, evaluate, freePort, waitEval } from "./lib/cdp.mjs";
import {
  assertInstalledPenglaiIdentity,
  installFromExactInstaller,
  launchInstalledHarness,
  leftoversByCommand,
  ownedProcessTree,
  resolveInstalledUiHarness,
  resourcesInside,
  stopChild,
  waitForFile,
} from "./lib/installed-app.mjs";
import { inspectPackagedCandidate } from "./lib/packaged-candidate.mjs";
import { evidenceName, installerForTarget, nativeBlocked, parseTargetArg } from "./lib/release-targets.mjs";

const PRODUCT_VERSION = "0.5.5";
const PROVIDER = "deepseek-official";
const PREFERRED_MODEL = "deepseek-v4-flash-vision-exp";

function readSecretLine() {
  if (process.stdin.isTTY) process.stderr.write("DeepSeek API key (input is not recorded): ");
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.once("line", (line) => {
      rl.close();
      resolve(String(line).trim());
    });
    rl.once("error", reject);
  });
}

function inputValue(selector, value) {
  return `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return { ok: false, reason: "missing-input" };
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) return { ok: false, reason: "missing-setter" };
    setter.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  })()`;
}

function selectValue(selector, value) {
  return `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return { ok: false, reason: "missing-select" };
    if (!Array.from(node.options || []).some((row) => row.value === ${JSON.stringify(value)})) {
      return { ok: false, reason: "missing-option", options: Array.from(node.options || []).map((row) => row.value) };
    }
    node.value = ${JSON.stringify(value)};
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  })()`;
}

const CLICK_CONTINUE = `(() => {
  const node = document.querySelector("[data-penglai-wizard-continue]");
  if (!node) return { ok: false, reason: "missing-continue" };
  if (node.disabled) return { ok: false, reason: "disabled" };
  node.click();
  return { ok: true };
})()`;

const SNAPSHOT = `(() => ({
  wizard: Boolean(document.querySelector("[data-penglai-wizard]")),
  step: document.querySelector("[data-penglai-wizard-step]")?.getAttribute("data-penglai-wizard-step") || "",
  error: document.querySelector("[data-penglai-wizard-error]")?.textContent?.trim().slice(0, 240) || "",
  disabled: Boolean(document.querySelector("[data-penglai-wizard-continue]")?.disabled),
  root: Boolean(document.querySelector("#root")),
  dsh: Boolean(document.querySelector("[data-dsh-boot]") || document.querySelector("[data-penglai-settings]")),
  href: location.href,
}))()`;

function rpcExpression(method, input) {
  return `(async () => {
    const res = await fetch("/api/penglaiOnboarding/${method}", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId: crypto.randomUUID(),
        method: "penglaiOnboarding/${method}",
        payload: { args: { input: ${JSON.stringify(input)} } },
      }),
    });
    const json = await res.json();
    const result = json && json.result;
    if (!result || result.ok !== true) return { ok: false, code: result?.error?.code || "RPC_FAILED" };
    return { ok: true };
  })()`;
}

async function waitStep(session, step, timeoutMs = 45_000) {
  return waitEval(session, SNAPSHOT, (snap) => snap?.wizard && snap.step === step, timeoutMs);
}

async function advance(session, current, next, timeoutMs = 45_000) {
  const snap = await waitStep(session, current, timeoutMs);
  if (snap?.step !== current || snap.disabled) throw new Error(`wizard ${current} is not ready`);
  const clicked = await evaluate(session, CLICK_CONTINUE);
  if (!clicked?.ok) throw new Error(`wizard ${current} continue ${clicked?.reason || "failed"}`);
  const after = await waitStep(session, next, timeoutMs);
  if (after?.step !== next) throw new Error(`wizard did not reach ${next}`);
  if (after.error) throw new Error(`wizard ${next} reported an error`);
  return after;
}

const source = requireCleanCandidateSource();
if (!source.ok) finish("STALE", { command: "test:e2e:installed:live", reason: source.reason, ...source.git });
const target = parseTargetArg();
const blocked = nativeBlocked("test:e2e:installed:live", target);
if (blocked) finish("BLOCKED", { command: "test:e2e:installed:live", ...blocked });
const expectedSource = process.env.PENGLAI_EXPECTED_SOURCE_SHA ?? source.git.head;
const installer = installerForTarget(target);
const artifactPath = process.env.PENGLAI_ARTIFACT || join(ROOT, "dist", installer);
const installed = installFromExactInstaller(artifactPath, join(ROOT, ".tmp-installed-live-app"), target);
if (!installed.ok) finish(installed.blocked ? "BLOCKED" : "INCOMPLETE", { command: "test:e2e:installed:live", reason: installed.reason, target });
const identity = assertInstalledPenglaiIdentity(installed.app, target);
if (!identity.ok) finish("FAIL", { command: "test:e2e:installed:live", reason: `installed identity ${identity.reason}` });
const packaged = inspectPackagedCandidate({ app: installed.app, candidateSha: expectedSource, expectedTarget: target });
if (packaged.verdict !== "PASS") finish(packaged.verdict, { command: "test:e2e:installed:live", reason: packaged.reason });

const harness = resolveInstalledUiHarness();
if (!harness) finish("INCOMPLETE", { command: "test:e2e:installed:live", reason: "installed UI harness missing" });
const secret = await readSecretLine();
if (secret.length < 4 || secret.length > 4096 || /[\r\n]/.test(secret)) {
  finish("FAIL", { command: "test:e2e:installed:live", reason: "credential input shape invalid" });
}

const userData = join(ROOT, ".tmp-installed-live");
const workspace = join(ROOT, ".tmp-installed-live-workspace");
rmSync(userData, { recursive: true, force: true });
rmSync(workspace, { recursive: true, force: true });
mkdirSync(userData, { recursive: true, mode: 0o700 });
mkdirSync(workspace, { recursive: true, mode: 0o700 });
const resources = resourcesInside(installed.app, target);
const port = await freePort();
const launched = launchInstalledHarness(harness, resources, userData, [
  `--remote-debugging-port=${port}`,
  "--remote-allow-origins=*",
]);
let session;
let verdict = "FAIL";
let rec;
try {
  if (!(await waitForFile(join(userData, "gateway.port"), 90_000))) throw new Error("gateway did not start");
  ({ session } = await attachPage(port, 90_000));
  await advance(session, "language", "privacy");
  await advance(session, "privacy", "models");

  const provider = await evaluate(session, selectValue("[data-penglai-wizard-provider]", PROVIDER));
  if (!provider?.ok) throw new Error(`official DeepSeek provider unavailable: ${provider?.reason || "unknown"}`);
  await delay(1_000);
  const models = await evaluate(session, `(() => Array.from(document.querySelector("[data-penglai-wizard-model]")?.options || []).map((row) => row.value).filter(Boolean))()`);
  const model = Array.isArray(models) && models.includes(PREFERRED_MODEL) ? PREFERRED_MODEL : Array.isArray(models) ? models[0] : "";
  if (!model) throw new Error("official DeepSeek model directory is empty");
  const selected = await evaluate(session, selectValue("[data-penglai-wizard-model]", model));
  if (!selected?.ok) throw new Error("official DeepSeek model selection failed");
  await delay(300);
  await advance(session, "models", "keytest");

  const filled = await evaluate(session, inputValue("[data-penglai-wizard-key]", secret));
  if (!filled?.ok) throw new Error("credential field unavailable");
  const keyReady = await waitEval(session, SNAPSHOT, (snap) => snap?.step === "keytest" && !snap.disabled, 5_000);
  if (keyReady?.disabled) throw new Error("credential input did not enable model test");
  const clicked = await evaluate(session, CLICK_CONTINUE);
  if (!clicked?.ok) throw new Error("credential test did not start");
  const workspaceStep = await waitStep(session, "workspace", 180_000);
  if (workspaceStep?.step !== "workspace" || workspaceStep.error) throw new Error("official nonce Turn did not reach workspace");

  const created = await evaluate(session, rpcExpression("createWorkspace", { path: workspace, title: "Penglai 0.5.5 Live" }));
  if (!created?.ok) throw new Error(`official workspace creation failed: ${created?.code || "unknown"}`);
  await evaluate(session, "location.reload(); true");
  const firstStep = await waitStep(session, "firstturn", 30_000);
  if (firstStep?.step !== "firstturn") throw new Error("wizard did not reach first Turn");
  const firstMessage = `Penglai 0.5.5 live verification ${randomUUID().slice(0, 8)}. Reply with OK.`;
  const message = await evaluate(session, inputValue("[data-penglai-wizard-message]", firstMessage));
  if (!message?.ok) throw new Error("first message field unavailable");
  const firstReady = await waitEval(session, SNAPSHOT, (snap) => snap?.step === "firstturn" && !snap.disabled, 5_000);
  if (firstReady?.disabled) throw new Error("first message did not enable Turn");
  const firstClick = await evaluate(session, CLICK_CONTINUE);
  if (!firstClick?.ok) throw new Error("first Turn did not start");
  const done = await waitStep(session, "done", 180_000);
  if (done?.step !== "done" || done.error) throw new Error("official first Turn did not complete");

  const ledgerPath = join(userData, "onboarding", "onboarding.json");
  const factsPath = join(userData, "onboarding", "onboarding-facts.json");
  const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : {};
  const facts = existsSync(factsPath) ? JSON.parse(readFileSync(factsPath, "utf8")) : {};
  const completed = ledger.current === "COMPLETE" && Boolean(facts.apiTest?.finalDigest) && Boolean(facts.firstConversation?.finalDigest);
  if (!completed) throw new Error("onboarding completion evidence missing");
  const tree = ownedProcessTree(installed.app, resources, launched.child.pid);
  rec = {
    command: "test:e2e:installed:live",
    verdict: "PASS",
    productVersion: PRODUCT_VERSION,
    target,
    sourceSha: packaged.release.sourceSha,
    installer,
    installerSha256: installed.installerSha256,
    provider: PROVIDER,
    model,
    officialNonceTurn: true,
    officialFirstTurn: true,
    onboardingComplete: true,
    apiTestFinalDigest: facts.apiTest.finalDigest,
    firstTurnFinalDigest: facts.firstConversation.finalDigest,
    processOwned: tree.ownedAbsolute,
  };
  verdict = "PASS";
} catch (error) {
  rec = {
    command: "test:e2e:installed:live",
    verdict: "FAIL",
    productVersion: PRODUCT_VERSION,
    target,
    sourceSha: packaged.release.sourceSha,
    installer,
    installerSha256: installed.installerSha256,
    reason: error instanceof Error ? error.message.replaceAll(secret, "[redacted]") : "live onboarding failed",
  };
} finally {
  if (session) session.close();
  await stopChild(launched.child);
  const tree = ownedProcessTree(installed.app, resources, launched.child.pid);
  const leftovers = leftoversByCommand(tree.dshEntry).filter((line) => line.includes(tree.nodeBin) || line.includes(userData));
  if (leftovers.length) {
    rec = { ...rec, verdict: "FAIL", reason: "owned DSH process remained after live onboarding" };
    verdict = "FAIL";
  }
  rmSync(userData, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
}

const outDir = join(ROOT, "evidence/generated");
mkdirSync(outDir, { recursive: true });
const payload = JSON.stringify(rec, null, 2);
writeFileSync(join(outDir, "installed-e2e-live.json"), payload);
writeFileSync(join(outDir, evidenceName("installed-e2e-live", target)), payload);
finish(verdict, rec);
