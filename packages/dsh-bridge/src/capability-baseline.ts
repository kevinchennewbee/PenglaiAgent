import { createRequire } from "node:module";
import { PenglaiError } from "@penglai/contracts";
import { PINNED_DSH, PINNED_DSH_COMMIT } from "./index.js";

export const PINNED_DSH_SOURCE_TARBALL_SHA256 =
  "96595c6403ddfcedb694111c85f451348ac4ffc1ca1a6e73dfd71fca772a718e";

export const REQUIRED_OFFICIAL_MODULES = [
  "@deepseek-ai/dsh",
  "@deepseek-ai/dsh-typert-protocol",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-theme",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-host-plugin-inventory",
  "@deepseek-ai/dsh-credentials-local",
  "@deepseek-ai/dsh-api-session-controller",
  "@deepseek-ai/dsh-client-ui-slots",
] as const;

export const OFFICIAL_THEME_PREFERENCES = ["light", "dark", "system"] as const;
export const OFFICIAL_LOCALES = ["zh", "en"] as const;

export interface CapabilityBaseline {
  dsh: string;
  commit: string;
  sourceTarballSha256: string;
  modules: Record<string, string>;
  seams: {
    typertRemoteService: boolean;
    remoteDecorator: boolean;
    localePreference: boolean;
    locales: string[];
    themePreferences: string[];
    onboardingSlot: "settings.onboarding";
    pluginsTabSlot: "settings.plugins.tab";
    credentialsLocal: boolean;
    pluginInventory: boolean;
  };
  overlay: {
    applied: false;
    officialSlots: true;
    reason: string;
  };
}

const req = createRequire(import.meta.url);

export function readInstalledVersion(name: string): string {
  try {
    const pkg = req(`${name}/package.json`) as { version?: string };
    if (!pkg.version) throw new PenglaiError("DSH_CONTRACT_DRIFT", `${name} missing version`);
    return pkg.version;
  } catch (err) {
    if (err instanceof PenglaiError) throw err;
    throw new PenglaiError("DSH_CONTRACT_DRIFT", `${name} not installed`);
  }
}

export function captureCapabilityBaseline(): CapabilityBaseline {
  const modules: Record<string, string> = {};
  for (const name of REQUIRED_OFFICIAL_MODULES) {
    const version = readInstalledVersion(name);
    if (version !== PINNED_DSH) {
      throw new PenglaiError("DSH_CONTRACT_DRIFT", `${name} ${version} != ${PINNED_DSH}`);
    }
    modules[name] = version;
  }
  const proto = req("@deepseek-ai/dsh-typert-protocol") as {
    TypertRemoteService?: unknown;
    Remote?: unknown;
  };
  const locale = req("@deepseek-ai/dsh-client-locale") as {
    LOCALE_IDS?: readonly string[];
    LOCALE_PREFERENCE_FIELD?: string;
  };
  const theme = req("@deepseek-ai/dsh-client-ui-theme") as {
    THEME_PREFERENCES?: readonly string[];
  };
  const primitives = req("@deepseek-ai/dsh-client-ui-primitives/package.json") as { name?: string };
  return {
    dsh: PINNED_DSH,
    commit: PINNED_DSH_COMMIT,
    sourceTarballSha256: PINNED_DSH_SOURCE_TARBALL_SHA256,
    modules,
    seams: {
      typertRemoteService: typeof proto.TypertRemoteService === "function",
      remoteDecorator: typeof proto.Remote === "function",
      localePreference: locale.LOCALE_PREFERENCE_FIELD === "preference",
      locales: [...(locale.LOCALE_IDS ?? [])],
      themePreferences: [...(theme.THEME_PREFERENCES ?? [])],
      onboardingSlot: "settings.onboarding",
      pluginsTabSlot: "settings.plugins.tab",
      credentialsLocal: Boolean(modules["@deepseek-ai/dsh-credentials-local"]),
      pluginInventory: Boolean(modules["@deepseek-ai/dsh-host-plugin-inventory"]),
    },
    overlay: {
      applied: false,
      officialSlots: true,
      reason: `${primitives.name ?? "dsh-client-ui-primitives"} is composed through the official alpha client slot graph without patching DSH bytes`,
    },
  };
}

export function assertCapabilityBaseline(baseline: CapabilityBaseline): void {
  if (baseline.dsh !== PINNED_DSH) throw new PenglaiError("DSH_CONTRACT_DRIFT", "dsh pin");
  if (baseline.commit !== PINNED_DSH_COMMIT) throw new PenglaiError("DSH_CONTRACT_DRIFT", "dsh commit");
  if (baseline.sourceTarballSha256 !== PINNED_DSH_SOURCE_TARBALL_SHA256) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "dsh source tarball");
  }
  if (!baseline.seams.typertRemoteService || !baseline.seams.remoteDecorator) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "Typert Remote seam missing");
  }
  if (!baseline.seams.localePreference || baseline.seams.locales.join(",") !== OFFICIAL_LOCALES.join(",")) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "locale seam");
  }
  if (baseline.seams.themePreferences.join(",") !== OFFICIAL_THEME_PREFERENCES.join(",")) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "theme seam");
  }
  if (!baseline.seams.credentialsLocal || !baseline.seams.pluginInventory) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "credentials/inventory seam");
  }
  if (baseline.overlay.applied !== false || baseline.overlay.officialSlots !== true) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "alpha client slot composition seam");
  }
}
