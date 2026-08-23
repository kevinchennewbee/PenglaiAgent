export const REQUIRED_FRESH_SETTINGS_WALK = [
  "ui-penglai",
  "ui-center",
  "ui-office",
  "ui-memory",
  "ui-update",
  "ui-uninstall",
] as const;
export const REQUIRED_FULL_SETTINGS_WALK = [
  "ui-penglai",
  "ui-center",
  "ui-im",
  "ui-asr",
  "ui-tts",
  "ui-office",
  "ui-memory",
  "ui-companion",
  "ui-update",
  "ui-uninstall",
] as const;
export const REQUIRED_SETTINGS_WALK = REQUIRED_FULL_SETTINGS_WALK;
export const REQUIRED_WIZARD_KEYLESS = ["welcome", "privacy", "appearance", "models", "credential"] as const;
export const WIZARD_RESUME_STEPS = ["appearance", "models", "credential", "test"] as const;

export type SettingsWalkId = (typeof REQUIRED_SETTINGS_WALK)[number];
export type WizardKeylessId = (typeof REQUIRED_WIZARD_KEYLESS)[number];

export function settingsWalkComplete(walked: readonly string[], mode: "fresh" | "full" = "full"): boolean {
  const required = mode === "fresh" ? REQUIRED_FRESH_SETTINGS_WALK : REQUIRED_FULL_SETTINGS_WALK;
  return required.every((id) => walked.includes(id));
}

export function wizardKeylessComplete(walked: readonly string[]): boolean {
  return REQUIRED_WIZARD_KEYLESS.every((id) => walked.includes(id));
}

/** HTML shell has data-penglai-wizard before wizard.js paints a step. */
export function wizardResumeReady(snap: { wizard?: boolean; wizardStep?: string } | null | undefined): boolean {
  return Boolean(snap?.wizard && snap.wizardStep && (WIZARD_RESUME_STEPS as readonly string[]).includes(snap.wizardStep));
}

/** Continue disabled AND skip unavailable AND back unavailable. A typed key field is a forward path. */
export function wizardStepDeadEnd(input: {
  continueDisabled: boolean;
  skipEnabled: boolean;
  backEnabled: boolean;
  hasForwardInput?: boolean;
}): boolean {
  if (input.hasForwardInput) return false;
  return input.continueDisabled && !input.skipEnabled && !input.backEnabled;
}

export function clickButtonByTextScript(pattern: string, role?: "tab" | "button"): string {
  const roleFilter = role ? ` && n.getAttribute("role") === ${JSON.stringify(role)}` : "";
  return `(() => {
    const re = ${pattern};
    const btn = Array.from(document.querySelectorAll("button")).find((n) => re.test((n.textContent || "").replace(/\\s+/g, " ").trim())${roleFilter});
    if (!btn) return false;
    btn.click();
    return true;
  })()`;
}

export function settingsShotScript(): string {
  return `(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const nav = dialog ? Array.from(dialog.querySelectorAll("nav button")).map((n) => (n.textContent || "").replace(/\\s+/g, " ").trim()).filter(Boolean) : [];
    const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map((n) => (n.textContent || "").replace(/\\s+/g, " ").trim()).filter(Boolean);
    return {
      dialog: Boolean(dialog),
      nav,
      tabs,
      wizard: Boolean(document.querySelector("[data-penglai-wizard]")),
      wizardStep: (document.querySelector("[data-penglai-wizard-step]") && document.querySelector("[data-penglai-wizard-step]").getAttribute("data-penglai-wizard-step")) || "",
      update: Boolean(document.querySelector("[data-penglai-update]")),
      uninstall: Boolean(document.querySelector("[data-penglai-uninstall]")),
      center: Boolean(document.querySelector("[data-penglai-center]")),
      im: Boolean(document.querySelector("[data-penglai-im]")),
      penglaiSettings: Boolean(document.querySelector("[data-penglai-settings]")),
      asr: Boolean(document.querySelector("[data-penglai-asr]")),
      tts: Boolean(document.querySelector("[data-penglai-tts]")),
      memorySources: Boolean(document.querySelector("[data-penglai-memory-sources-panel]")),
      memory: Boolean(document.querySelector("[data-penglai-memory]")),
      budget: Boolean(document.querySelector("[data-penglai-budget]")),
      companion: Boolean(document.querySelector("[data-penglai-companion]")),
      qrBegin: Boolean(document.querySelector("[data-penglai-im-qr-begin]")),
      feishuWizard: Boolean(document.querySelector("[data-penglai-feishu-wizard]")),
    };
  })()`;
}
