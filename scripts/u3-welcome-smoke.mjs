import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { attachPage, evaluate, freePort, waitEval } from "./lib/cdp.mjs";
import { observeOfficialSurfaces } from "./lib/browser-window-walk.mjs";
import {
  installFromExactInstaller,
  launchInstalledHarness,
  leftoversByCommand,
  ownedProcessTree,
  resourcesInside,
  stopChild,
  waitForFile,
  assertInstalledPenglaiIdentity,
  resolveInstalledUiHarness,
} from "./lib/installed-app.mjs";
import { inspectPackagedCandidate } from "./lib/packaged-candidate.mjs";
import { installerForTarget, nativeBlocked, parseTargetArg } from "./lib/release-targets.mjs";

const WELCOME_JS = `(() => {
  const text = (document.body && document.body.innerText ? document.body.innerText : "").replace(/\\s+/g, " ");
  const headings = Array.from(document.querySelectorAll("h1,h2,h3,[role=heading]")).map((h) =>
    (h.textContent || "").replace(/\\s+/g, " ").trim(),
  );
  const buttons = Array.from(document.querySelectorAll("button, [role=button]")).map((n) => ({
    text: (n.textContent || "").replace(/\\s+/g, " ").trim(),
    disabled: Boolean(n.disabled),
  }));
  const welcomePenglai = /欢迎使用蓬莱|Welcome to Penglai/.test(text) || headings.some((h) => /欢迎使用蓬莱|Welcome to Penglai/.test(h));
  const privacyStep = /隐私说明|Privacy notice/i.test(text) || headings.some((h) => /隐私说明|Privacy notice/i.test(h));
  const officialInternalNotice = /内测声明|Internal Testing Notice/.test(text);
  const continueBtn = buttons.find((b) => /^(继续|Continue)$/.test(b.text));
  return {
    title: document.title,
    href: location.href,
    hasRoot: Boolean(document.getElementById("root")),
    hasDshBoot: typeof window.__DSH_BOOT__ !== "undefined",
    recovery: Boolean(document.querySelector("[data-penglai-recovery]")),
    welcomePenglai,
    privacyStep,
    officialInternalNotice,
    continueVisible: Boolean(continueBtn),
    continueDisabled: Boolean(continueBtn?.disabled),
    headings: headings.filter(Boolean).slice(0, 16),
    buttons: buttons.filter((b) => b.text).slice(0, 24),
  };
})()`;

const CLICK_CONTINUE_JS = `(() => {
  const buttons = Array.from(document.querySelectorAll("button, [role=button]"));
  const btn = buttons.find((n) => /^(继续|Continue)$/.test((n.textContent || "").replace(/\\s+/g, " ").trim()));
  if (!btn) return { ok: false, reason: "missing" };
  if (btn.disabled) return { ok: false, reason: "disabled" };
  btn.click();
  return { ok: true, text: (btn.textContent || "").replace(/\\s+/g, " ").trim() };
})()`;

const outDir = join(ROOT, "evidence/generated");
mkdirSync(outDir, { recursive: true });
const recPath = join(outDir, "u3-welcome-smoke.json");
const source = requireCleanCandidateSource();
if (!source.ok) {
  finish("STALE", { command: "u3-welcome-smoke", reason: source.reason, ...source.git });
}
const git = source.git;

function writeRec(rec) {
  writeFileSync(recPath, `${JSON.stringify(rec, null, 2)}\n`);
}

const expectedTarget = parseTargetArg();
const blocked = nativeBlocked("u3-welcome-smoke", expectedTarget);
if (blocked) finish("BLOCKED", { command: "u3-welcome-smoke", ...blocked });
const expectedInstaller = installerForTarget(expectedTarget);
const installed = installFromExactInstaller(
  join(ROOT, "dist", expectedInstaller),
  join(ROOT, ".tmp", "u3-welcome-app"),
  expectedTarget,
);
if (!installed.ok) {
  const rec = { command: "u3-welcome-smoke", verdict: installed.blocked ? "BLOCKED" : "INCOMPLETE", reason: installed.reason ?? "exact installer missing", target: expectedTarget };
  writeRec(rec);
  finish(rec.verdict, rec);
}
const identity = assertInstalledPenglaiIdentity(installed.app, expectedTarget);
if (!identity.ok) {
  const rec = { command: "u3-welcome-smoke", verdict: "FAIL", reason: `installed app identity ${identity.reason}` };
  writeRec(rec);
  finish("FAIL", rec);
}
const packaged = inspectPackagedCandidate({ app: installed.app, candidateSha: git.head, expectedTarget });
if (packaged.verdict !== "PASS") {
  const rec = { command: "u3-welcome-smoke", verdict: packaged.verdict, reason: packaged.reason };
  writeRec(rec);
  finish(packaged.verdict, rec);
}

const app = installed.app;
const resources = resourcesInside(app, expectedTarget);
const harnessApp = resolveInstalledUiHarness();
if (!harnessApp) {
  finish("INCOMPLETE", {
    command: "u3-welcome-smoke",
    reason: "installed UI walk requires a separate Electron harness executable",
    target: expectedTarget,
  });
}
const userData = join(ROOT, ".tmp", "u3-welcome-profile");
rmSync(userData, { recursive: true, force: true });
mkdirSync(userData, { recursive: true });

const debugPort = await freePort();
const launched = launchInstalledHarness(harnessApp, resources, userData, [
  `--remote-debugging-port=${debugPort}`,
  "--remote-allow-origins=*",
]);
const gatewayFile = join(userData, "gateway.port");
const sawGateway = await waitForFile(gatewayFile, 90_000);

let official = null;
let welcome = null;
let welcomeClick = { ok: false, reason: "not-run" };
let afterContinue = null;
let attachErr = "";
try {
  const { session } = await attachPage(debugPort, 90_000);
  official = await observeOfficialSurfaces(session);
  welcome = await waitEval(
    session,
    WELCOME_JS,
    (s) => Boolean(s && s.welcomePenglai && s.continueVisible && !s.continueDisabled && !s.officialInternalNotice && !s.recovery),
    30_000,
  );
  if (welcome?.welcomePenglai && welcome.continueVisible && !welcome.continueDisabled) {
    welcomeClick = await evaluate(session, CLICK_CONTINUE_JS);
  }
  if (welcomeClick.ok) {
    afterContinue = await waitEval(
      session,
      WELCOME_JS,
      (s) => Boolean(s && s.privacyStep && !s.recovery),
      15_000,
    );
  }
  session.close();
} catch (err) {
  attachErr = err instanceof Error ? err.message : String(err);
}

const tree = ownedProcessTree(app, resources, launched.child.pid);
const leftoverNeedle = resolve(join(resources, "runtime/dsh/lib/bin.js"));
const stopped = await stopChild(launched.child);
const leftovers = leftoversByCommand(leftoverNeedle);
const readDiagnostic = (path) =>
  existsSync(path) ? readFileSync(path, "utf8").slice(-4000) : "";

const welcomeReachable = Boolean(
  welcome?.welcomePenglai && welcome.continueVisible && !welcome.continueDisabled && !welcome.officialInternalNotice,
);
const wizardAdvanced = Boolean(
  !official?.snap?.recovery &&
    official?.http?.official &&
    official?.websocket?.opened &&
    welcomeClick.ok &&
    afterContinue?.privacyStep &&
    !afterContinue?.recovery,
);
const ownedDsh = Boolean(tree.dshPid && tree.ownedAbsolute);
const ok = Boolean(sawGateway && !attachErr && welcomeReachable && wizardAdvanced && ownedDsh && leftovers.length === 0);

const rec = {
  command: "u3-welcome-smoke",
  verdict: ok ? "PASS" : attachErr || !sawGateway ? "FAIL" : "FAIL",
  installer: expectedInstaller,
  installerSha256: installed.installerSha256,
  sourceSha: packaged.release.sourceSha,
  target: expectedTarget,
  dsh: packaged.release.dsh,
  sawGateway,
  attachErr: attachErr || undefined,
  official: {
    href: official?.snap?.href,
    title: official?.snap?.title,
    hasRoot: official?.snap?.hasRoot,
    hasDshBoot: official?.snap?.hasDshBoot,
    recovery: official?.snap?.recovery,
    http: official?.http,
    websocket: official?.websocket,
  },
  welcome: {
    reachable: welcomeReachable,
    penglai: welcome?.welcomePenglai,
    officialInternalNotice: welcome?.officialInternalNotice,
    continueVisible: welcome?.continueVisible,
    continueDisabled: welcome?.continueDisabled,
    headings: welcome?.headings,
    click: welcomeClick,
  },
  nextStep: {
    privacy: wizardAdvanced,
    afterContinue: afterContinue
      ? {
          href: afterContinue.href,
          privacyStep: afterContinue.privacyStep,
          recovery: afterContinue.recovery,
          headings: afterContinue.headings,
        }
      : null,
  },
  processTree: { dshPid: tree.dshPid, ownedAbsolute: tree.ownedAbsolute, leftovers: leftovers.length },
  stopped: { code: stopped[0], signal: stopped[1] },
  diagnostics: {
    startupError: readDiagnostic(join(userData, "logs", "startup.error.log")),
    dshError: readDiagnostic(join(userData, "logs", "dsh.stderr.log")),
  },
  outputTail: launched.output().slice(-2000),
};
writeRec(rec);
if (!ok) finish("FAIL", rec);
finish("PASS", rec);
