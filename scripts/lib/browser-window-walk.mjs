import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { captureShot, delay, evaluate, waitEval } from "./cdp.mjs";

export const SNAPSHOT_JS = `(() => {
  const text = (el) => (el ? el.textContent || "" : "").replace(/\\s+/g, " ").trim();
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };
  const buttons = Array.from(document.querySelectorAll("button, [role=button]")).map((n) => ({
    text: text(n).slice(0, 80),
    disabled: Boolean(n.disabled),
    visible: visible(n),
    attrs: Array.from(n.attributes)
      .filter((a) => a.name.startsWith("data-") || a.name === "aria-current" || a.name === "role")
      .map((a) => a.name + "=" + a.value),
  })).filter((b) => b.text || b.attrs.length);
  const headings = Array.from(document.querySelectorAll("h1,h2,h3")).map((h) => text(h).slice(0, 120)).filter(Boolean);
  return {
    title: document.title,
    href: location.href,
    lang: document.documentElement.lang || "",
    readyState: document.readyState,
    hasRoot: Boolean(document.getElementById("root")),
    rootInert: Boolean(document.getElementById("root") && document.getElementById("root").inert),
    hasDshBoot: typeof window.__DSH_BOOT__ !== "undefined",
    bootOverlay: Boolean(document.querySelector("[data-dsh-boot]")),
    bootFailure: text(document.querySelector("[data-dsh-boot]")),
    recovery: Boolean(document.querySelector("[data-penglai-recovery]")),
    wizard: Boolean(document.querySelector("[data-penglai-wizard]")),
    wizardStep: (document.querySelector("[data-penglai-wizard-step]") && document.querySelector("[data-penglai-wizard-step]").getAttribute("data-penglai-wizard-step")) || "",
    wizardBackDisabled: Boolean(document.querySelector("[data-penglai-wizard-back]") && document.querySelector("[data-penglai-wizard-back]").disabled),
    wizardSkipDisabled: Boolean(document.querySelector("[data-penglai-wizard-skip]") && document.querySelector("[data-penglai-wizard-skip]").disabled),
    wizardContinueDisabled: Boolean(document.querySelector("[data-penglai-wizard-continue]") && document.querySelector("[data-penglai-wizard-continue]").disabled),
    wizardHasKey: Boolean(document.querySelector("[data-penglai-wizard-key]")),
    wizardError: text(document.querySelector("[data-penglai-wizard-error]")).slice(0, 200),
    wizardHasProvider: Boolean(document.querySelector("[data-penglai-wizard-provider]")),
    wizardHasModel: Boolean(document.querySelector("[data-penglai-wizard-model]")),
    wizardProviderCount: document.querySelector("[data-penglai-wizard-provider]") ? Array.from(document.querySelector("[data-penglai-wizard-provider]").options).filter((o) => o.value).length : 0,
    wizardModelCount: document.querySelector("[data-penglai-wizard-model]") ? Array.from(document.querySelector("[data-penglai-wizard-model]").options).filter((o) => o.value).length : 0,
    welcomeTitle: headings.some((h) => /选择语言|Choose language|欢迎使用蓬莱|Welcome to Penglai/.test(h)),
    officialByok: headings.some((h) => /API Key|API key|API 密钥/.test(h)),
    center: Boolean(document.querySelector("[data-penglai-center]")),
    im: Boolean(document.querySelector("[data-penglai-im]")),
    penglaiSettings: Boolean(document.querySelector("[data-penglai-settings]")),
    asr: Boolean(document.querySelector("[data-penglai-asr]")),
      tts: Boolean(document.querySelector("[data-penglai-tts]")),
      memorySources: Boolean(document.querySelector("[data-penglai-memory-sources-panel]")),
      office: Boolean(document.querySelector("[data-penglai-office]")),
      memory: Boolean(document.querySelector("[data-penglai-memory]")),
      memoryStatus: document.querySelector("[data-penglai-memory]")?.getAttribute("data-penglai-memory-status") || "",
    budget: Boolean(document.querySelector("[data-penglai-budget]")),
    companion: Boolean(document.querySelector("[data-penglai-companion]")),
    pluginCards: Array.from(document.querySelectorAll("[data-penglai-plugin-card]")).map((card) => ({
      id: card.getAttribute("data-penglai-plugin-card") || "",
      installed: card.getAttribute("data-penglai-plugin-installed") || "",
      loaded: card.getAttribute("data-penglai-plugin-loaded") === "true",
      actionStatus: card.querySelector("[data-penglai-plugin-action-status]")?.getAttribute("data-penglai-plugin-action-status") || "",
      actionBusy: card.querySelector("[data-penglai-plugin-action-status]")?.getAttribute("data-penglai-plugin-action-busy") === "true",
      text: text(card).slice(0, 400),
    })),
    update: Boolean(document.querySelector("[data-penglai-update]")),
    uninstall: Boolean(document.querySelector("[data-penglai-uninstall]")),
    qrBegin: Boolean(document.querySelector("[data-penglai-im-qr-begin]")),
    feishuWizard: Boolean(document.querySelector("[data-penglai-feishu-wizard]")),
    buttons: buttons.slice(0, 48),
    headings: headings.slice(0, 24),
    navLabels: Array.from(document.querySelectorAll("[role=dialog] nav button, [role=tab]")).map((n) => text(n)).filter(Boolean).slice(0, 30),
  };
})()`;

export const WIZARD_RESUME_STEPS = ["language", "privacy", "models", "keytest", "workspace", "firstturn"];

export function wizardResumeReady(snap) {
  return Boolean(snap?.wizard && snap.wizardStep && WIZARD_RESUME_STEPS.includes(snap.wizardStep));
}

export const HTTP_JS = `fetch(location.origin + "/", { credentials: "same-origin" }).then(async (res) => {
  const body = await res.text();
  return {
    status: res.status,
    ok: res.ok,
    official: body.includes('id="root"') && !body.includes("data-penglai-recovery"),
  };
})`;

export const WS_JS = `new Promise((resolve) => {
  const url = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/api/events.host";
  let settled = false;
  const done = (opened, readyState) => {
    if (settled) return;
    settled = true;
    resolve({ opened, url, readyState });
  };
  try {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* */ }
      done(false, ws.readyState);
    }, 4000);
    ws.onopen = () => {
      clearTimeout(timer);
      const readyState = ws.readyState;
      try { ws.close(); } catch { /* */ }
      done(true, readyState);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      done(false, ws.readyState);
    };
  } catch {
    done(false, 3);
  }
})`;

function clickSelector(sel) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return { ok: false, reason: "missing" };
    if (el.disabled) return { ok: false, reason: "disabled", text: (el.textContent || "").replace(/\\s+/g, " ").trim() };
    el.click();
    return { ok: true, text: (el.textContent || "").replace(/\\s+/g, " ").trim() };
  })()`;
}

function clickButtonText(patterns) {
  return `(() => {
    const patterns = ${JSON.stringify(patterns)};
    const buttons = Array.from(document.querySelectorAll("button, [role=button]"));
    const texts = buttons.map((n) => (n.textContent || "").replace(/\\s+/g, " ").trim()).filter(Boolean).slice(0, 24);
    for (const src of patterns) {
      const re = new RegExp(src);
      const btn = buttons.find((n) => re.test((n.textContent || "").replace(/\\s+/g, " ").trim()));
      if (btn) {
        if (btn.disabled) return { ok: false, reason: "disabled", text: (btn.textContent || "").replace(/\\s+/g, " ").trim(), texts };
        btn.click();
        return { ok: true, text: (btn.textContent || "").replace(/\\s+/g, " ").trim() };
      }
    }
    return { ok: false, reason: "missing", texts };
  })()`;
}

function clickPluginAction(pluginId, action) {
  return `(() => {
    const card = Array.from(document.querySelectorAll("[data-penglai-plugin-card]")).find(
      (node) => node.getAttribute("data-penglai-plugin-card") === ${JSON.stringify(pluginId)},
    );
    if (!card) return { ok: false, reason: "card-missing" };
    const button = card.querySelector(
      '[data-penglai-plugin-action="${action}"]',
    );
    if (!button) return { ok: false, reason: "action-missing" };
    if (button.disabled) return { ok: false, reason: "disabled" };
    button.click();
    return { ok: true };
  })()`;
}

const OPTIONAL_PLUGIN_IDS = [
  "@penglai/im",
  "@penglai/asr",
  "@penglai/moss-tts",
  "@penglai/companion",
];

async function installOptionalPlugins(session) {
  const results = [];
  const openCenter = async () => {
    const current = await waitEval(session, SNAPSHOT_JS, () => true, 1_000);
    if (current?.center) return current;
    if (!current?.hasDshBoot) {
      await waitEval(
        session,
        SNAPSHOT_JS,
        (snap) => Boolean(snap?.hasDshBoot && snap?.hasRoot && !snap?.recovery),
        45_000,
      );
    }
    await evaluate(session, clickButtonText(["^设置$", "^Settings$"]));
    await delay(300);
    await evaluate(session, clickButtonText(["^蓬莱$", "^Penglai$"]));
    return waitEval(session, SNAPSHOT_JS, (snap) => Boolean(snap?.center), 15_000);
  };
  for (const id of OPTIONAL_PLUGIN_IDS) {
    const before = await openCenter();
    const beforeCard = before?.pluginCards?.find((card) => card.id === id);
    if (beforeCard?.loaded) {
      results.push({ id, ok: true, alreadyLoaded: true });
      continue;
    }
    const click = await evaluate(session, clickPluginAction(id, "enable"));
    if (!click?.ok) {
      results.push({ id, ok: false, click, before: beforeCard ?? null });
      break;
    }
    const outcome = await waitEval(
      session,
      SNAPSHOT_JS,
      (snap) => snap?.pluginCards?.some(
        (card) =>
          card.id === id &&
          (card.actionStatus === "success" || card.actionStatus === "error"),
      ),
      60_000,
    );
    const outcomeCard = outcome?.pluginCards?.find((card) => card.id === id);
    if (outcomeCard?.actionStatus !== "success") {
      results.push({ id, ok: false, click, outcome: outcomeCard ?? null });
      break;
    }
    await delay(1_200);
    const after = await openCenter();
    const afterCard = after?.pluginCards?.find((card) => card.id === id);
    results.push({
      id,
      ok: Boolean(afterCard?.loaded),
      click,
      outcome: { actionStatus: outcomeCard.actionStatus, actionBusy: outcomeCard.actionBusy },
      after: afterCard ?? null,
    });
    if (!afterCard?.loaded) break;
  }
  return results;
}

function slim(snap) {
  if (!snap || typeof snap !== "object") return snap;
  return {
    title: snap.title,
    href: snap.href,
    wizard: snap.wizard,
    wizardStep: snap.wizardStep,
    wizardBackDisabled: snap.wizardBackDisabled,
    wizardSkipDisabled: snap.wizardSkipDisabled,
    wizardContinueDisabled: snap.wizardContinueDisabled,
    wizardHasKey: snap.wizardHasKey,
    wizardError: snap.wizardError,
    wizardHasProvider: snap.wizardHasProvider,
    wizardHasModel: snap.wizardHasModel,
    wizardProviderCount: snap.wizardProviderCount,
    wizardModelCount: snap.wizardModelCount,
    headings: snap.headings,
    welcomeTitle: snap.welcomeTitle,
    officialByok: snap.officialByok,
    center: snap.center,
    im: snap.im,
    penglaiSettings: snap.penglaiSettings,
    asr: snap.asr,
    tts: snap.tts,
    memorySources: snap.memorySources,
    memory: snap.memory,
    memoryStatus: snap.memoryStatus,
    budget: snap.budget,
    companion: snap.companion,
    pluginCards: snap.pluginCards,
    update: snap.update,
    uninstall: snap.uninstall,
    qrBegin: snap.qrBegin,
    feishuWizard: snap.feishuWizard,
    rootInert: snap.rootInert,
    hasDshBoot: snap.hasDshBoot,
    bootOverlay: snap.bootOverlay,
    bootFailure: snap.bootFailure,
    hasRoot: snap.hasRoot,
    recovery: snap.recovery,
    navLabels: snap.navLabels,
    buttons: (snap.buttons ?? []).filter((b) => b.visible).map((b) => ({ text: b.text, disabled: b.disabled })),
  };
}
function isDeadEnd(snap) {
  if (!snap) return true;
  const hasForwardInput = Boolean(
    (snap.wizardStep === "keytest" && snap.wizardHasKey) ||
      (snap.wizardStep === "credential" && snap.wizardHasKey) ||
      (snap.wizardStep === "models" && (snap.wizardProviderCount > 0 || snap.wizardModelCount > 0)),
  );
  if (hasForwardInput) return false;
  return Boolean(snap.wizardContinueDisabled && snap.wizardSkipDisabled && snap.wizardBackDisabled);
}

function readOnboardingLedger(userData) {
  if (!userData) return null;
  const path = join(userData, "onboarding", "onboarding.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function selectFirstOption(sel) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return { ok: false, reason: "missing", values: [] };
    const values = Array.from(el.options).map((o) => o.value).filter(Boolean);
    if (!values.length) return { ok: false, reason: "empty", values };
    el.value = values[0];
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: el.value, values };
  })()`;
}

export async function observeOfficialSurfaces(session) {
  const snap = await waitEval(
    session,
    SNAPSHOT_JS,
    (s) => s && s.hasRoot && s.hasDshBoot && !s.bootOverlay && !s.recovery,
    45_000,
  );
  const http = await evaluate(session, HTTP_JS);
  const websocket = await evaluate(session, WS_JS);
  return {
    snap,
    http,
    websocket,
    official: Boolean(
      snap?.hasDshBoot &&
      snap?.hasRoot &&
      !snap?.bootOverlay &&
      !snap?.recovery &&
      http?.official &&
      websocket?.opened
    ),
  };
}

export async function observeOfficialTransport(session) {
  const snap = await evaluate(session, SNAPSHOT_JS);
  const http = await evaluate(session, HTTP_JS);
  const websocket = await evaluate(session, WS_JS);
  return { snap, http, websocket, official: Boolean(http?.official && websocket?.opened) };
}

async function walkWizardKeyless(session, opts, helpers) {
  const { shot, steps, walked, userData, stopAfter } = helpers;
  const deadEnds = [];
  const ledgers = [];

  const recordLedger = (id) => {
    const ledger = readOnboardingLedger(userData);
    if (ledger) ledgers.push({ id, current: ledger.current, completed: ledger.completed ?? [] });
    return ledger;
  };

  const assertChrome = (id, snap, extra = {}) => {
    const slimSnap = slim(snap);
    const dead = isDeadEnd(snap);
    if (dead) deadEnds.push(id);
    steps.push({ id, snap: slimSnap, deadEnd: dead, ...extra });
    return dead;
  };

  const clickContinue = async () => evaluate(session, clickSelector("[data-penglai-wizard-continue]"));
  const clickBack = async () => evaluate(session, clickSelector("[data-penglai-wizard-back]"));

  const waitStep = async (id, timeoutMs = 20_000) => {
    const snap = await waitEval(session, SNAPSHOT_JS, (s) => Boolean(s && s.wizard && s.wizardStep === id), timeoutMs);
    if (snap?.wizardStep !== id) {
      deadEnds.push(`${id}-unreachable`);
    }
    return snap;
  };

  const language = await waitEval(
    session,
    SNAPSHOT_JS,
    (s) => Boolean(s && s.wizard && (s.wizardStep === "language" || s.wizardStep === "welcome")),
    45_000,
  );
  if (assertChrome("language", language)) return { deadEnds, ledgers };
  if (language?.wizardContinueDisabled) {
    deadEnds.push("language-continue-disabled");
    return { deadEnds, ledgers };
  }
  const languageClick = await clickContinue();
  if (languageClick.ok) walked.push("language");
  steps[steps.length - 1].click = languageClick;
  recordLedger("language");
  await shot("language");
  if (stopAfter === "welcome" || stopAfter === "language") return { deadEnds, ledgers };

  const privacy = await waitStep("privacy");
  if (privacy?.wizardStep !== "privacy" || assertChrome("privacy", privacy)) return { deadEnds, ledgers };
  if (privacy?.wizardBackDisabled) deadEnds.push("privacy-back-missing");
  const privacyClick = await clickContinue();
  if (privacyClick.ok) walked.push("privacy");
  steps[steps.length - 1].click = privacyClick;
  recordLedger("privacy");
  await shot("privacy");
  if (stopAfter === "privacy") return { deadEnds, ledgers };

  const models = await waitStep("models", 25_000);
  if (models?.wizardStep !== "models" || assertChrome("models", models)) return { deadEnds, ledgers };
  const providerPick = await evaluate(session, selectFirstOption("[data-penglai-wizard-provider]"));
  await delay(800);
  const afterProvider = await waitEval(
    session,
    SNAPSHOT_JS,
    (s) => Boolean(s && s.wizardStep === "models" && (s.wizardModelCount > 0 || s.wizardContinueDisabled)),
    15_000,
  );
  const modelPick = afterProvider?.wizardModelCount
    ? await evaluate(session, selectFirstOption("[data-penglai-wizard-model]"))
    : { ok: false, reason: "no-models" };
  await delay(400);
  const modelsReady = await waitEval(session, SNAPSHOT_JS, (s) => s && s.wizardStep === "models", 5_000);
  if (isDeadEnd(modelsReady) || (!modelsReady?.wizardProviderCount && modelsReady?.wizardContinueDisabled)) {
    deadEnds.push("models");
    steps.push({
      id: "models-select",
      snap: slim(modelsReady),
      providerPick,
      modelPick,
      deadEnd: true,
    });
    await shot("models");
    return { deadEnds, ledgers };
  }
  const modelsClick = await clickContinue();
  if (modelsClick.ok || modelsReady?.wizardStep === "models") walked.push("models");
  steps.push({
    id: "models-select",
    snap: slim(modelsReady),
    click: modelsClick,
    providerPick,
    modelPick,
    providers: { source: "penglaiOnboarding/status", rows: modelsReady?.wizardProviderCount ?? 0 },
    deadEnd: false,
  });
  recordLedger("models");
  await shot("models");
  if (stopAfter === "models") return { deadEnds, ledgers };

  const credential = await waitStep("keytest", 20_000);
  const credentialDead = assertChrome("keytest", credential);
  if (credential?.wizardStep === "keytest") walked.push("keytest");
  if (credentialDead) return { deadEnds, ledgers };
  if (!credential?.wizardHasKey) deadEnds.push("credential-key-missing");
  if (!credential?.wizardContinueDisabled) deadEnds.push("credential-continue-should-be-disabled");
  if (credential?.wizardBackDisabled) deadEnds.push("credential-back-missing");
  const back = await clickBack();
  await delay(400);
  const afterBack = await waitEval(session, SNAPSHOT_JS, (s) => s && s.wizardStep === "models", 8_000);
  if (afterBack?.wizardStep === "models") walked.push("back-to-models");
  steps.push({ id: "credential-back", click: back, snap: slim(afterBack) });
  const forwardAgain = await clickContinue();
  await delay(400);
  const credentialAgain = await waitStep("keytest", 10_000);
  if (credentialAgain?.wizardStep === "keytest") walked.push("keytest-resume");
  steps.push({ id: "credential-again", click: forwardAgain, snap: slim(credentialAgain) });
  recordLedger("credential");
  await shot("credential");
  return { deadEnds, ledgers };
}

export async function walkInstalledBrowserWindow(session, opts = {}) {
  const shotDir = opts.shotDir;
  const userData = opts.userData;
  const steps = [];
  const walked = [];
  const settingsWalked = [];
  const shot = async (name) => {
    if (!shotDir) return;
    try {
      await captureShot(session, `${shotDir}/${String(steps.length).padStart(2, "0")}-${name}.png`);
    } catch {
      /* screenshots are diagnostics only */
    }
  };

  const first = await waitEval(
    session,
    SNAPSHOT_JS,
    (s) => Boolean(s && (s.wizard || s.hasDshBoot || s.recovery)),
    45_000,
  );
  steps.push({ id: "boot", snap: slim(first) });
  await shot("boot");

  if (first?.recovery) {
    return {
      walked,
      settingsWalked,
      steps,
      last: slim(first),
      official: { snap: first, http: { official: false }, websocket: { opened: false } },
      welcome: { clicked: false },
      blocked: ["recovery"],
      deadEnds: ["recovery"],
      wizardKeyless: { ok: false, honestStop: "", reason: "recovery" },
      overlayCoversSettings: false,
    };
  }

  if (first?.wizard) {
    const result = await walkWizardKeyless(session, opts, {
      shot,
      steps,
      walked,
      userData,
      stopAfter: opts.stopAfter,
    });
    const last = await waitEval(session, SNAPSHOT_JS, () => true, 1_000);
    const required = ["language", "privacy", "models", "keytest"];
    const missing = opts.stopAfter ? [] : required.filter((id) => !walked.includes(id));
    const blocked = [...result.deadEnds, ...missing];
    if (!opts.stopAfter) {
      blocked.push("settings-requires-complete-onboarding");
    }
    const wizardKeyless = {
      ok: result.deadEnds.length === 0 && (Boolean(opts.stopAfter) || missing.length === 0),
      honestStop: last?.wizardStep === "keytest" ? "keytest" : "keytest",
      ledgers: result.ledgers,
      skippedNonceTurn: true,
    };
    return {
      walked,
      settingsWalked,
      steps,
      last: slim(last),
      official: { snap: last, http: { official: false }, websocket: { opened: false } },
      welcome: { clicked: walked.includes("language") || walked.includes("welcome") },
      blocked,
      deadEnds: result.deadEnds,
      wizardKeyless,
      overlayCoversSettings: false,
    };
  }

  const official = await observeOfficialSurfaces(session);
  steps.push({ id: "official-dom", snap: slim(official.snap), http: official.http, websocket: official.websocket });
  await shot("official-dom");

  const settingsTargets = [
    { id: "ui-settings-open", patterns: ["^设置$", "^Settings$"], flag: null },
    { id: "ui-penglai", patterns: ["^蓬莱$", "^Penglai$"], flag: "penglaiSettings" },
    { id: "ui-center", patterns: ["^蓬莱$", "^Penglai$"], flag: "center" },
    { id: "ui-im", patterns: ["^消息连接$", "^Messages$", "^Penglai IM$"], flag: "im" },
    { id: "ui-asr", patterns: ["^蓬莱语音识别$", "^Speech recognition$"], flag: "asr" },
    { id: "ui-tts", patterns: ["^蓬莱语音合成$", "^Speech synthesis$"], flag: "tts" },
    { id: "ui-office", patterns: ["^蓬莱办公$", "^Penglai Office$"], flag: "office" },
    { id: "ui-memory", patterns: ["^蓬莱记忆$", "^Penglai Memory$"], flag: "memory" },
    { id: "ui-companion", patterns: ["^主动陪伴$", "^Proactive Companion$", "^Companion$"], flag: "companion" },
    { id: "ui-update", patterns: ["^更新$", "^Updates$"], flag: "update" },
    { id: "ui-uninstall", patterns: ["^存储与卸载$", "^Storage and uninstall$"], flag: "uninstall" },
  ];
  const installResults = [];
  for (const target of settingsTargets) {
    const click = await evaluate(session, clickButtonText(target.patterns));
    await delay(700);
    const after = await waitEval(session, SNAPSHOT_JS, () => true, 1_000);
    if (target.flag && after?.[target.flag] && !settingsWalked.includes(target.id)) settingsWalked.push(target.id);
    steps.push({ id: target.id, click, observed: Boolean(target.flag && after?.[target.flag]), snap: slim(after) });
    await shot(target.id);
    if (target.id === "ui-center" && opts.installOptionalPlugins) {
      installResults.push(...(await installOptionalPlugins(session)));
      steps.push({ id: "install-optional-plugins", results: installResults });
      await shot("install-optional-plugins");
    }
  }
  const last = await waitEval(session, SNAPSHOT_JS, () => true, 1_000);
  const blocked = [];
  const requiredSettings = opts.requireOptionalPlugins
    ? ["ui-penglai", "ui-center", "ui-im", "ui-asr", "ui-tts", "ui-office", "ui-memory", "ui-companion", "ui-update", "ui-uninstall"]
    : ["ui-penglai", "ui-center", "ui-office", "ui-memory", "ui-update", "ui-uninstall"];
  for (const id of requiredSettings) {
    if (!settingsWalked.includes(id)) blocked.push(id);
  }
  const memoryStep = steps.find((step) => step.id === "ui-memory");
  if (memoryStep?.snap?.memoryStatus !== "ready") {
    blocked.push("ui-memory-engine-not-ready");
  }
  if (opts.installOptionalPlugins && !OPTIONAL_PLUGIN_IDS.every((id) => installResults.some((row) => row.id === id && row.ok))) {
    blocked.push("install-optional-plugins");
  }
  return {
    walked,
    settingsWalked,
    steps,
    last: slim(last),
    official,
    welcome: { clicked: false },
    blocked,
    deadEnds: [],
    wizardKeyless: { ok: false, honestStop: "", reason: "already-complete" },
    overlayCoversSettings: false,
    installResults,
  };
}
