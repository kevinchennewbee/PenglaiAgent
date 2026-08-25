import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { PenglaiError, classifyApiTestError, type ApiTestErrorClass } from "@penglai/contracts";

export { classifyApiTestError, type ApiTestErrorClass };

export interface OfficialSessionLog {
  id?: string;
  events?: readonly unknown[];
  deriveMessages?: () => unknown[];
}

export interface OfficialUsableCtx {
  credentials?: {
    set: (ref: string, value: string) => Promise<void>;
    describe: (ref: string) => Promise<{ configured?: boolean; source?: string; writable?: boolean; value?: unknown }>;
    resolve?: (ref: string) => Promise<{ value: string; source?: string } | undefined>;
    unset?: (ref: string) => Promise<void>;
  };
  settings?: {
    mutate: (ns: string, ops: Array<{ op: "set" | "unset"; path: string[]; value?: unknown }>) => Promise<void>;
    describe: () => Array<{ ns: string; value: unknown }>;
  };
  workspaceRegistry?: {
    create: (path: string, title?: string) => Promise<{ id: string; title?: string }>;
    list: () => Array<{
      id: string;
      title?: string;
      path?: string;
      sessionIds?: readonly string[];
      attachSession?: (sessionId: string) => Promise<void>;
      detachSession?: (sessionId: string) => Promise<void>;
    }>;
    delete?: (id: string) => Promise<boolean>;
  };
  agents?: {
    create: (opts: {
      sessionId: string;
      meta?: { cwd?: string };
      agentOptions?: { provider?: string; model?: string };
    }) => Promise<{
      agent: {
        followup: (m: unknown) => void;
        whenIdle?: () => Promise<void>;
        session?: OfficialSessionLog & { flush?: () => Promise<void> };
      };
      dispose: () => Promise<void>;
    }>;
    resume?: (opts: { resumeSessionId: string }) => Promise<{
      agent: { followup: (m: unknown) => void; whenIdle?: () => Promise<void>; session?: OfficialSessionLog };
      dispose: () => Promise<void>;
    }>;
  };
  llm?: {
    listProviders: () => Array<{ id: string; name: string }>;
    listConfigurableProviders?: () => Array<{
      provider?: string;
      id?: string;
      displayName?: string;
      name?: string;
      settingsNs?: string;
      settingsPath?: readonly string[];
    }>;
    listModels: (provider: string) => Promise<Array<{ provider: string; id: string; name: string }>>;
    resolveModelInfo: (provider: string, model: string) => Promise<{ provider: string; id: string; name: string }>;
  };
  on?: (ev: string, fn: (...args: unknown[]) => void) => void | (() => unknown);
}

export const OFFICIAL_LOCALE_SETTINGS_NS = "locale" as const;
export const OFFICIAL_THEME_SETTINGS_NS = "ui-theme" as const;
export const OFFICIAL_SETTINGS_PREFERENCE_FIELD = "preference" as const;
export const OFFICIAL_WELCOME_SETTINGS_NS = "ui-onboarding" as const;
export const OFFICIAL_WELCOME_ACK_FIELD = "welcomeNoticeVersion" as const;
export const PENGLAI_WELCOME_NOTICE_VERSION = "penglai-0.5.6.0" as const;

export const ONBOARDING_STEPS = [
  "welcome-v1",
  "appearance-locale-v1",
  "privacy-v1",
  "model-provider-v1",
  "credential-v1",
  "model-test-v1",
  "workspace-v1",
  "first-turn-v1",
] as const;

export const OFFICIAL_ONBOARDING_SLOT = "settings.onboarding" as const;

export const OFFICIAL_ONBOARDING_STEPS = [
  { id: "penglai-privacy", order: -90, step: "privacy-v1" },
  { id: "penglai-appearance-locale", order: -80, step: "appearance-locale-v1" },
  { id: "penglai-models", order: -10, step: "model-provider-v1" },
  { id: "penglai-credential", order: -5, step: "credential-v1" },
  { id: "penglai-workspace", order: 10, step: "workspace-v1" },
  { id: "penglai-core-ready", order: 20, step: "core-ready-v1" },
  { id: "penglai-im-offer", order: 30, step: "im-offer-v1" },
  { id: "penglai-voice-offer", order: 40, step: "voice-offer-v1" },
  { id: "penglai-memory-offer", order: 50, step: "memory-offer-v1" },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];
export const RECONFIGURABLE_ONBOARDING_STEPS = [
  "model-provider-v1",
  "credential-v1",
  "workspace-v1",
  "first-turn-v1",
] as const;
export type ReconfigurableOnboardingStep = (typeof RECONFIGURABLE_ONBOARDING_STEPS)[number];

export interface OnboardingState {
  schema: 2;
  completed: OnboardingStepId[];
  current: OnboardingStepId | "COMPLETE";
  advanceToken: string;
}

/** Renderer-visible state: identical to OnboardingState minus the CAS token. */
export type PublicOnboardingState = Omit<OnboardingState, "advanceToken">;

export function publicState(state: OnboardingState): PublicOnboardingState {
  const { advanceToken: _drop, ...rest } = state;
  return rest;
}

export interface OnboardingFacts {
  selection?: { provider: string; model: string };
  credentialRef?: string;
  apiTest?: { nonceDigest: string; sessionId: string; finalDigest: string };
  workspaceId?: string;
  workspacePath?: string;
  firstConversation?: { sessionId: string; messageDigest: string; finalDigest: string };
}

export function emptyOnboarding(): OnboardingState {
  return { schema: 2, completed: [], current: "welcome-v1", advanceToken: randomUUID() };
}

export function nextStep(completed: readonly string[]): OnboardingStepId | "COMPLETE" {
  for (const step of ONBOARDING_STEPS) {
    if (!completed.includes(step)) return step;
  }
  return "COMPLETE";
}

export function completeStep(state: OnboardingState, id: OnboardingStepId, token = state.advanceToken): OnboardingState {
  if (token !== state.advanceToken) throw new PenglaiError("INVALID_INPUT", "onboarding CAS token mismatch");
  const expected = nextStep(state.completed);
  if (expected !== id) throw new PenglaiError("INVALID_INPUT", `onboarding expected ${expected}`);
  const completed = [...state.completed, id];
  return { schema: 2, completed, current: nextStep(completed), advanceToken: randomUUID() };
}

export function canMarkTestPassed(input: {
  nonce: string;
  durableFinal?: string;
  httpOk?: boolean;
  modelListOk?: boolean;
  configured?: boolean;
}): boolean {
  if (!input.nonce || !input.durableFinal) return false;
  return input.durableFinal.includes(input.nonce);
}

export function canMarkConversationPassed(input: {
  sessionId?: string;
  durableFinalDigest?: string;
  turnCompleted?: boolean;
}): boolean {
  return Boolean(
    input.sessionId &&
      /^[0-9a-f-]{16,64}$/i.test(input.sessionId) &&
      input.turnCompleted === true &&
      /^[0-9a-f]{64}$/.test(input.durableFinalDigest ?? ""),
  );
}

export interface OfficialProviderCard {
  id: string;
  displayName: string;
  protocol: string;
  configured: boolean;
}

export function cardsFromOfficialDirectory(raw: unknown): OfficialProviderCard[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && "providers" in raw
      ? (raw as { providers?: unknown }).providers
      : raw && typeof raw === "object" && "data" in raw
        ? (raw as { data?: unknown }).data
        : undefined;
  if (!Array.isArray(list)) throw new PenglaiError("INVALID_INPUT", "official provider catalog missing");
  const cards: OfficialProviderCard[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? o.provider ?? o.route ?? o.name ?? "");
    if (!id || /loopback/i.test(id)) continue;
    cards.push({
      id,
      displayName: String(o.displayName ?? o.title ?? o.name ?? id),
      protocol: String(o.protocol ?? o.api ?? o.kind ?? o.settingsNs ?? "unknown"),
      configured: o.configured === true,
    });
  }
  if (!cards.length) throw new PenglaiError("INVALID_INPUT", "official provider catalog empty");
  return cards;
}

export function supportsOfficialOpenAiCompatible(cards: readonly OfficialProviderCard[]): boolean {
  return cards.some((c) => /openai-compatible|openai|anthropic|gemini|google|deepseek/i.test(`${c.id} ${c.protocol}`));
}

export function credentialDescriptor(input: {
  configured?: boolean | undefined;
  source?: string | undefined;
  writable?: boolean | undefined;
  value?: unknown;
}): { configured: boolean; source: string; writable: boolean } {
  if (input.value !== undefined) throw new PenglaiError("SECURITY_POLICY", "credential descriptor must not carry value");
  return {
    configured: input.configured === true,
    source: String(input.source ?? "unknown"),
    writable: input.writable === true,
  };
}

export interface StepEvidence {
  officialWelcomeAck?: boolean;
  locale?: "zh" | "en";
  theme?: "light" | "dark" | "system";
  officialSettingsPersisted?: boolean;
  officialCatalog?: unknown;
  providerSelection?: { provider: string; model: string };
  descriptor?: { configured?: boolean; source?: string; writable?: boolean; serverVerified?: boolean; value?: unknown };
  nonce?: string;
  durableFinal?: string;
  officialSessionId?: string;
  durableFinalDigest?: string;
  turnCompleted?: boolean;
  workspaceId?: string;
  workspaceWritable?: boolean;
  imChoice?: "weixin" | "feishu" | "later" | "configured";
}

export function completeStepWithEvidence(
  state: OnboardingState,
  id: OnboardingStepId,
  token: string,
  evidence: StepEvidence = {},
): OnboardingState {
  const expected = nextStep(state.completed);
  if (expected !== id) throw new PenglaiError("INVALID_INPUT", `onboarding expected ${expected}`);
  if (id === "welcome-v1" && evidence.officialWelcomeAck !== true) {
    throw new PenglaiError("INVALID_INPUT", "official welcome acknowledgement required");
  }
  if (id === "appearance-locale-v1" && (!evidence.locale || !evidence.theme)) {
    throw new PenglaiError("INVALID_INPUT", "locale and theme required");
  }
  if (id === "model-provider-v1") {
    const cards = cardsFromOfficialDirectory(evidence.officialCatalog);
    if (!supportsOfficialOpenAiCompatible(cards)) {
      throw new PenglaiError("INVALID_INPUT", "official catalog missing usable providers");
    }
    const sel = evidence.providerSelection;
    if (!sel || !sel.provider || !sel.model) {
      throw new PenglaiError("INVALID_INPUT", "provider and model selection required");
    }
    if (!cards.some((c) => c.id === sel.provider)) {
      throw new PenglaiError("INVALID_INPUT", "selected provider missing from official catalog");
    }
    if (!sel.model.trim() || sel.model === sel.provider) {
      throw new PenglaiError("INVALID_INPUT", "selected model must be a real model id, not the provider id");
    }
  }
  if (id === "credential-v1") {
    const d = credentialDescriptor(evidence.descriptor ?? {});
    if (!d.configured) throw new PenglaiError("INVALID_INPUT", "official credential not configured");
    if (evidence.descriptor?.serverVerified !== true) {
      throw new PenglaiError("INVALID_INPUT", "credential descriptor must be verified server-side");
    }
  }
  if (id === "model-test-v1") {
    if (
      !canMarkTestPassed({
        nonce: evidence.nonce ?? "",
        ...(evidence.durableFinal ? { durableFinal: evidence.durableFinal } : {}),
      })
    ) {
      throw new PenglaiError("INVALID_INPUT", "official nonce Turn required");
    }
  }
  if (id === "workspace-v1") {
    if (!evidence.workspaceId || evidence.workspaceWritable !== true) {
      throw new PenglaiError("INVALID_INPUT", "official workspace required");
    }
  }
  if (id === "first-turn-v1") {
    if (
      !canMarkConversationPassed({
        ...(evidence.officialSessionId ? { sessionId: evidence.officialSessionId } : {}),
        ...(evidence.durableFinalDigest ? { durableFinalDigest: evidence.durableFinalDigest } : {}),
        ...(evidence.turnCompleted !== undefined ? { turnCompleted: evidence.turnCompleted } : {}),
      })
    ) {
      throw new PenglaiError("INVALID_INPUT", "official first Turn required");
    }
  }
  return completeStep(state, id, token);
}

export function syncWelcomeFromOfficial(state: OnboardingState, officialWelcomeAck: boolean): OnboardingState {
  if (!officialWelcomeAck || state.current !== "welcome-v1") return state;
  return completeStep(state, "welcome-v1", state.advanceToken);
}

export async function describeOfficialCredential(
  ctx: OfficialUsableCtx,
  ref: string,
): Promise<{ configured: boolean; source: string; writable: boolean }> {
  if (!ref || !ref.trim()) throw new PenglaiError("INVALID_INPUT", "credential ref required");
  if (!ctx.credentials?.describe) throw new PenglaiError("DSH_UNAVAILABLE", "official credentials service missing");
  const info = await ctx.credentials.describe(ref);
  if (info && typeof info === "object" && "value" in info && info.value !== undefined) {
    throw new PenglaiError("SECURITY_POLICY", "credentials.describe must not return value");
  }
  return credentialDescriptor({
    configured: info?.configured,
    ...(info?.source ? { source: info.source } : {}),
    writable: info?.writable,
  });
}

export function verifyWorkspaceInRegistry(
  registry: OfficialUsableCtx["workspaceRegistry"] | undefined,
  workspaceId: string,
): { id: string; title?: string; path?: string } {
  if (!registry?.list) throw new PenglaiError("DSH_UNAVAILABLE", "official workspace registry missing");
  const found = registry.list().find((w) => w && w.id === workspaceId);
  if (!found) throw new PenglaiError("INVALID_INPUT", "workspace not present in official registry");
  return found;
}

export async function persistAppearanceToOfficialSettings(
  ctx: OfficialUsableCtx,
  locale: "zh" | "en",
  theme: "light" | "dark" | "system",
): Promise<boolean> {
  if (!ctx.settings?.mutate) return false;
  await ctx.settings.mutate(OFFICIAL_LOCALE_SETTINGS_NS, [
    { op: "set", path: [OFFICIAL_SETTINGS_PREFERENCE_FIELD], value: locale },
  ]);
  await ctx.settings.mutate(OFFICIAL_THEME_SETTINGS_NS, [
    { op: "set", path: [OFFICIAL_SETTINGS_PREFERENCE_FIELD], value: theme },
  ]);
  return true;
}

export async function persistWelcomeAckToOfficialSettings(ctx: OfficialUsableCtx): Promise<boolean> {
  if (!ctx.settings?.mutate) return false;
  await ctx.settings.mutate(OFFICIAL_WELCOME_SETTINGS_NS, [
    { op: "set", path: [OFFICIAL_WELCOME_ACK_FIELD], value: PENGLAI_WELCOME_NOTICE_VERSION },
  ]);
  return true;
}

export function deriveOfficialCredentialRef(provider: string): string {
  const id = provider.trim();
  if (!id) throw new PenglaiError("INVALID_INPUT", "provider required");
  return `${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

/** Pinned official adapter defaults. `dsh-llm-deepseek` uses DEEPSEEK_API_KEY, not deriveKeyRef(deepseek-official). */
export const OFFICIAL_ADAPTER_DEFAULT_API_KEY_ENV: Readonly<Record<string, string>> = {
  "deepseek-official": "DEEPSEEK_API_KEY",
};

export function namedApiKeyEnvFromOfficialSettings(
  provider: string,
  described: ReadonlyArray<{ ns?: string; value?: unknown }> | undefined,
): string | undefined {
  if (!Array.isArray(described)) return undefined;
  for (const row of described) {
    const value = row?.value;
    if (!value || typeof value !== "object") continue;
    const rec = value as Record<string, unknown>;
    if (row.ns === "llm-deepseek" && provider === "deepseek-official") {
      if (typeof rec.apiKeyEnv === "string" && rec.apiKeyEnv.trim()) return rec.apiKeyEnv.trim();
    }
    const providers = rec.providers;
    if (providers && typeof providers === "object") {
      const profile = (providers as Record<string, unknown>)[provider];
      if (profile && typeof profile === "object") {
        const env = (profile as { apiKeyEnv?: unknown }).apiKeyEnv;
        if (typeof env === "string" && env.trim()) return env.trim();
      }
    }
  }
  return undefined;
}

export function resolveOfficialCredentialRef(provider: string, namedApiKeyEnv?: string): string {
  const named = namedApiKeyEnv?.trim();
  if (named) return named;
  const fromAdapter = OFFICIAL_ADAPTER_DEFAULT_API_KEY_ENV[provider.trim()];
  if (fromAdapter) return fromAdapter;
  return deriveOfficialCredentialRef(provider);
}

export function adapterCredentialRefFromOfficial(
  provider: string,
  described?: ReadonlyArray<{ ns?: string; value?: unknown }>,
): string {
  return resolveOfficialCredentialRef(provider, namedApiKeyEnvFromOfficialSettings(provider, described));
}

/** Same-generation remap of deriveKeyRef(provider) → official adapter apiKeyEnv. Host-only; never returns the secret. */
export async function rematerializeOfficialCredentialRef(
  ctx: OfficialUsableCtx,
  input: { provider: string; credentialRef?: string },
): Promise<{ ref: string; remapped: boolean; legacyRefRemaining?: string }> {
  const target = adapterCredentialRefFromOfficial(providerOrThrow(input.provider), ctx.settings?.describe?.());
  const current = input.credentialRef?.trim();
  if (!current) {
    throw new PenglaiError("INVALID_INPUT", "MISSING_CREDENTIAL no credential; reenter the API key");
  }
  if (current === target) return { ref: target, remapped: false };
  const derived = deriveOfficialCredentialRef(input.provider);
  if (current !== derived) {
    throw new PenglaiError(
      "INVALID_INPUT",
      "MISSING_CREDENTIAL no credential on the official adapter ref; reenter the API key",
    );
  }
  if (!ctx.credentials?.set || !ctx.credentials.resolve) {
    throw new PenglaiError(
      "INVALID_INPUT",
      "MISSING_CREDENTIAL no credential on the official adapter ref; reenter the API key",
    );
  }
  const hit = await ctx.credentials.resolve(current);
  const value = typeof hit?.value === "string" ? hit.value : "";
  if (!value) {
    throw new PenglaiError(
      "INVALID_INPUT",
      "MISSING_CREDENTIAL no credential on the official adapter ref; reenter the API key",
    );
  }
  assertCredentialValueShape(value);
  await ctx.credentials.set(target, value);
  const descriptor = await describeOfficialCredential(ctx, target);
  if (!descriptor.configured) {
    throw new PenglaiError("INVALID_INPUT", "official credential not configured");
  }
  let legacyRefRemaining: string | undefined;
  try {
    await ctx.credentials.unset?.(current);
  } catch (err) {
    // A read-only layer shadowing the legacy ref leaves it behind; surface
    // that fact instead of silently keeping a duplicate secret in the YAML.
    legacyRefRemaining = current;
    void err;
  }
  return { ref: target, remapped: true, ...(legacyRefRemaining ? { legacyRefRemaining } : {}) };
}

function providerOrThrow(provider: string): string {
  if (!provider.trim()) throw new PenglaiError("INVALID_INPUT", "provider required");
  return provider;
}

/**
 * Same merge as official `llm.providers` (dsh-host-apiproxy):
 * configurable directory first, then live-only routes. Loopback stays hidden.
 */
export function wizardProviderCatalog(llm?: {
  listProviders?: () => unknown[];
  listConfigurableProviders?: () => unknown[];
}): { providers: unknown[] } {
  const registered = typeof llm?.listProviders === "function" ? llm.listProviders() : [];
  const directory =
    typeof llm?.listConfigurableProviders === "function" ? llm.listConfigurableProviders() : [];
  const liveIds = new Set(
    (Array.isArray(registered) ? registered : [])
      .map((row) => asRecord(row)?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const declared = new Set<string>();
  const views: Record<string, unknown>[] = [];
  for (const row of Array.isArray(directory) ? directory : []) {
    const rec = asRecord(row);
    if (!rec) continue;
    const id = typeof rec.provider === "string" ? rec.provider : typeof rec.id === "string" ? rec.id : "";
    if (!id || /loopback/i.test(id)) continue;
    declared.add(id);
    views.push({
      id,
      provider: id,
      displayName: rec.displayName ?? rec.name ?? id,
      name: rec.name ?? rec.displayName ?? id,
      protocol: rec.settingsNs ?? rec.protocol ?? "configurable",
      settingsNs: rec.settingsNs,
      settingsPath: rec.settingsPath,
      live: liveIds.has(id),
      active: liveIds.has(id),
      ...(typeof rec.declared === "boolean" ? { declared: rec.declared } : {}),
    });
  }
  for (const row of Array.isArray(registered) ? registered : []) {
    const rec = asRecord(row);
    if (!rec) continue;
    const id = typeof rec.id === "string" ? rec.id : "";
    if (!id || /loopback/i.test(id) || declared.has(id)) continue;
    views.push({
      id,
      provider: id,
      displayName: rec.displayName ?? rec.name ?? id,
      name: rec.name ?? rec.displayName ?? id,
      protocol: rec.protocol ?? "live",
      settingsNs: "",
      settingsPath: [],
      live: true,
      active: true,
    });
  }
  views.sort((left, right) => {
    if (left.id === "deepseek-official") return -1;
    if (right.id === "deepseek-official") return 1;
    return String(left.displayName ?? left.id).localeCompare(String(right.displayName ?? right.id));
  });
  return { providers: views };
}

export async function ensureOfficialProviderRoute(
  ctx: OfficialUsableCtx,
  provider: string,
): Promise<void> {
  const id = provider.trim();
  if (!id) throw new PenglaiError("INVALID_INPUT", "provider required");
  const live = typeof ctx.llm?.listProviders === "function" ? ctx.llm.listProviders() : [];
  if (Array.isArray(live) && live.some((row) => asRecord(row)?.id === id)) return;
  const configurable =
    typeof ctx.llm?.listConfigurableProviders === "function" ? ctx.llm.listConfigurableProviders() : [];
  const entry = (Array.isArray(configurable) ? configurable : [])
    .map((row) => asRecord(row))
    .find((row) => row?.provider === id || row?.id === id);
  if (!entry || !ctx.settings?.mutate) {
    throw new PenglaiError("INVALID_INPUT", `no adapter registered for provider "${id}"`);
  }
  const ns = typeof entry.settingsNs === "string" && entry.settingsNs ? entry.settingsNs : "llm-pi-ai";
  if (Array.isArray(entry.settingsPath) && entry.settingsPath.length === 0) {
    throw new PenglaiError("INVALID_INPUT", `no adapter registered for provider "${id}"`);
  }
  const path = Array.isArray(entry.settingsPath) ? [...entry.settingsPath] : ["providers", id];
  await ctx.settings.mutate(ns, [
    { op: "set", path, value: { apiKeyEnv: resolveOfficialCredentialRef(id) } },
  ]);
}

export function assertCredentialValueShape(value: string): void {
  if (typeof value !== "string" || value.length < 4 || value.length > 4096) {
    throw new PenglaiError("INVALID_INPUT", "credential value length must be 4..4096");
  }
  if (/[\r\n]/.test(value)) {
    throw new PenglaiError("INVALID_INPUT", "credential value must not contain newline");
  }
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function realpathOrResolve(input: string): string {
  try {
    return realpathSync(input);
  } catch {
    const parent = dirname(input);
    if (parent === input) return resolve(input);
    return join(realpathOrResolve(parent), basename(input));
  }
}

export function assertWorkspacePathAllowed(
  inputPath: string,
  jail: { onboardingDir: string; userDataRoot: string; installRoots?: readonly string[] },
): string {
  if (!inputPath || !isAbsolute(inputPath)) {
    throw new PenglaiError("INVALID_INPUT", "workspace path must be absolute");
  }
  const candidate = realpathOrResolve(inputPath);
  const roots: Array<{ path: string; reason: string }> = [
    { path: jail.onboardingDir, reason: "onboarding" },
    { path: jail.userDataRoot, reason: "userData" },
    ...(jail.installRoots ?? []).map((path) => ({ path, reason: "install" })),
  ];
  for (const root of roots) {
    if (!root.path) continue;
    const resolvedRoot = realpathOrResolve(root.path);
    if (isPathInsideRoot(resolvedRoot, candidate)) {
      throw new PenglaiError("SECURITY_POLICY", `workspace path inside ${root.reason} tree`);
    }
  }
  return candidate;
}

export interface OnboardingHost {
  status(): PublicOnboardingState & {
    slot: typeof OFFICIAL_ONBOARDING_SLOT;
    providers: OfficialProviderCard[];
    catalogError?: string;
    selection?: { provider: string; model: string };
    workspaceId?: string;
  };
  advance(id: OnboardingStepId, evidence?: StepEvidence): OnboardingState;
  rewind(id: ReconfigurableOnboardingStep): OnboardingState;
  facts(): OnboardingFacts;
  saveFacts(patch: Partial<OnboardingFacts>): OnboardingFacts;
}

export function createOnboardingHost(opts: {
  dir: string;
  officialCatalog?: () => unknown;
  officialWelcomeAck?: () => boolean;
}): OnboardingHost {
  const load = (): OnboardingState => {
    let state = loadOnboarding(opts.dir);
    if (opts.officialWelcomeAck?.()) {
      const next = syncWelcomeFromOfficial(state, true);
      if (next !== state) persistOnboarding(opts.dir, next);
      state = next;
    }
    return state;
  };
  return {
    status() {
      const state = load();
      persistOnboarding(opts.dir, state);
      let providers: OfficialProviderCard[] = [];
      let catalogError: string | undefined;
      try {
        providers = cardsFromOfficialDirectory(opts.officialCatalog?.() ?? []);
      } catch (err) {
        providers = [];
        catalogError = err instanceof Error ? err.message : "official provider catalog empty";
      }
      const facts = loadOnboardingFacts(opts.dir);
      // advanceToken is an internal CAS token; never expose it to a renderer.
      return {
        schema: state.schema,
        current: state.current,
        completed: state.completed,
        slot: OFFICIAL_ONBOARDING_SLOT,
        providers,
        ...(catalogError ? { catalogError } : {}),
        ...(facts.selection ? { selection: facts.selection } : {}),
        ...(facts.workspaceId ? { workspaceId: facts.workspaceId } : {}),
      };
    },
    advance(id, evidence = {}) {
      const state = load();
      const next = completeStepWithEvidence(state, id, state.advanceToken, evidence);
      persistOnboarding(opts.dir, next);
      return next;
    },
    rewind(id) {
      const state = load();
      const target = ONBOARDING_STEPS.indexOf(id);
      if (target < 0) throw new PenglaiError("INVALID_INPUT", "unknown onboarding rewind step");
      const current = state.current === "COMPLETE" ? ONBOARDING_STEPS.length : ONBOARDING_STEPS.indexOf(state.current);
      if (current < target) throw new PenglaiError("INVALID_INPUT", `onboarding cannot rewind forward to ${id}`);
      const next: OnboardingState = {
        schema: 2,
        completed: state.completed.filter((step) => ONBOARDING_STEPS.indexOf(step) < target),
        current: id,
        advanceToken: randomUUID(),
      };
      const facts = loadOnboardingFacts(opts.dir);
      if (target <= ONBOARDING_STEPS.indexOf("model-provider-v1")) delete facts.selection;
      if (target <= ONBOARDING_STEPS.indexOf("credential-v1")) {
        delete facts.credentialRef;
        delete facts.apiTest;
      }
      if (target <= ONBOARDING_STEPS.indexOf("workspace-v1")) {
        delete facts.workspaceId;
        delete facts.workspacePath;
      }
      if (target <= ONBOARDING_STEPS.indexOf("first-turn-v1")) delete facts.firstConversation;
      persistOnboardingFacts(opts.dir, facts);
      persistOnboarding(opts.dir, next);
      return next;
    },
    facts() {
      return loadOnboardingFacts(opts.dir);
    },
    saveFacts(patch) {
      const next = { ...loadOnboardingFacts(opts.dir), ...patch };
      persistOnboardingFacts(opts.dir, next);
      return next;
    },
  };
}

export function persistOnboarding(dir: string, state: OnboardingState): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  atomicWritePrivateJson(join(dir, "onboarding.json"), state);
}

function atomicWritePrivateJson(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

export function persistOnboardingFacts(dir: string, facts: OnboardingFacts): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  atomicWritePrivateJson(join(dir, "onboarding-facts.json"), facts);
  if (facts.apiTest?.nonceDigest) {
    writeFileSync(join(dir, "current-nonce.digest"), `${facts.apiTest.nonceDigest}\n`, { mode: 0o600 });
  } else {
    try {
      unlinkSync(join(dir, "current-nonce.digest"));
    } catch {
      /* already absent */
    }
  }
}

export function loadOnboardingFacts(dir: string): OnboardingFacts {
  const path = join(dir, "onboarding-facts.json");
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, "utf8")) as OnboardingFacts;
  const facts: OnboardingFacts = {};
  if (raw.selection?.provider && raw.selection.model) {
    facts.selection = { provider: String(raw.selection.provider), model: String(raw.selection.model) };
  }
  if (typeof raw.credentialRef === "string" && raw.credentialRef.length <= 256) facts.credentialRef = raw.credentialRef;
  if (typeof raw.workspaceId === "string" && raw.workspaceId.length <= 256) facts.workspaceId = raw.workspaceId;
  if (typeof raw.workspacePath === "string" && raw.workspacePath.length <= 4096) facts.workspacePath = raw.workspacePath;
  if (
    raw.apiTest &&
    /^[0-9a-f]{64}$/.test(raw.apiTest.nonceDigest) &&
    /^[0-9a-f]{64}$/.test(raw.apiTest.finalDigest) &&
    typeof raw.apiTest.sessionId === "string"
  ) {
    facts.apiTest = { ...raw.apiTest };
  }
  if (
    raw.firstConversation &&
    /^[0-9a-f]{64}$/.test(raw.firstConversation.messageDigest) &&
    /^[0-9a-f]{64}$/.test(raw.firstConversation.finalDigest) &&
    typeof raw.firstConversation.sessionId === "string"
  ) {
    facts.firstConversation = { ...raw.firstConversation };
  }
  return facts;
}

export function loadOnboarding(dir: string): OnboardingState {
  const p = join(dir, "onboarding.json");
  if (!existsSync(p)) return emptyOnboarding();
  const raw = JSON.parse(readFileSync(p, "utf8")) as {
    schema?: number;
    completed?: OnboardingStepId[];
    advanceToken?: string;
  };
  if (raw.schema !== 1 && raw.schema !== 2) return emptyOnboarding();
  return {
    schema: 2,
    completed: raw.completed ?? [],
    current: nextStep(raw.completed ?? []),
    advanceToken: raw.advanceToken || randomUUID(),
  };
}

export const ONBOARDING_API_TEST_DIR = "api-test";

export function onboardingApiTestCwd(onboardingDir: string): string {
  return join(onboardingDir, ONBOARDING_API_TEST_DIR);
}

function workspacePathMatches(workspacePath: string | undefined, target: string): boolean {
  if (!workspacePath) return false;
  try {
    return realpathOrResolve(workspacePath) === realpathOrResolve(target);
  } catch {
    return false;
  }
}

function pathUnder(child: string | undefined, parent: string): boolean {
  if (!child) return false;
  try {
    const rel = relative(realpathOrResolve(parent), realpathOrResolve(child));
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  } catch {
    return false;
  }
}

const ONBOARDING_TEST_TITLES = new Set(["api-test", "api-test-workspace"]);

export function isOnboardingTestWorkspace(
  workspace: { title?: string; path?: string },
  onboardingDir: string,
): boolean {
  const roots = [onboardingApiTestCwd(onboardingDir), join(onboardingDir, "api-test-workspace")];
  if (roots.some((root) => workspacePathMatches(workspace.path, root))) return true;
  const title = workspace.title?.trim() ?? "";
  const base = workspace.path ? basename(workspace.path) : "";
  if (title === "Downloads" || base === "Downloads") return false;
  if (!ONBOARDING_TEST_TITLES.has(title) && !ONBOARDING_TEST_TITLES.has(base)) return false;
  return pathUnder(workspace.path, onboardingDir);
}

/** Remove official registry rows that only exist for the wizard nonce Turn. */
export async function releaseOnboardingTestWorkspaces(
  registry: OfficialUsableCtx["workspaceRegistry"] | undefined,
  onboardingDir: string,
): Promise<number> {
  if (!registry?.list || !registry.delete) return 0;
  let removed = 0;
  for (const workspace of [...registry.list()]) {
    if (!isOnboardingTestWorkspace(workspace, onboardingDir)) continue;
    for (const sessionId of [...(workspace.sessionIds ?? [])]) {
      try {
        await workspace.detachSession?.(sessionId);
      } catch {
        /* session log stays; the registry row must still go */
      }
    }
    if (await registry.delete(workspace.id)) removed += 1;
  }
  return removed;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function textBlocks(value: unknown): { type?: string; text?: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((block) => block && typeof block === "object") as { type?: string; text?: string }[];
}

function textFromOfficialBlocks(value: unknown): string {
  const blocks = textBlocks(value);
  if (!blocks) return "";
  return blocks.map((block) => (typeof block.text === "string" ? block.text : "")).join("");
}

function textFromOfficialMessage(message: unknown): string {
  return textFromOfficialBlocks(asRecord(message)?.content);
}

function textFromAssistantChunk(data: unknown): string {
  const chunk = asRecord(asRecord(data)?.chunk);
  return chunk?.type === "text-delta" && typeof chunk.text === "string" ? chunk.text : "";
}

export function durableFinalFromOfficialSession(session: unknown): {
  final: string;
  turnCompleted: boolean;
  reason?: unknown;
} {
  const rec = session && typeof session === "object" ? (session as OfficialSessionLog) : undefined;
  if (!rec) return { final: "", turnCompleted: false };
  let final = "";
  let turnCompleted = false;
  let reason: unknown;
  for (const raw of rec.events ?? []) {
    const event = asRecord(raw);
    if (!event) continue;
    const data = asRecord(event.data) ?? event;
    if (event.type === "assistant/chunk") final += textFromAssistantChunk(data);
    if (event.type === "assistant/message") {
      const assembled = textFromOfficialMessage(asRecord(data.message) ?? data.message);
      if (assembled) final = assembled;
    }
    if (event.type === "turn/end") {
      turnCompleted = true;
      reason = data.reason ?? event.reason;
    }
  }
  if (!final && typeof rec.deriveMessages === "function") {
    try {
      for (const message of rec.deriveMessages() ?? []) {
        const row = asRecord(message);
        if (row?.role !== "assistant") continue;
        const assembled = textFromOfficialMessage(row);
        if (assembled) final = assembled;
      }
    } catch {
      /* deriveMessages is official surface, not required for chunk logs */
    }
  }
  return { final, turnCompleted, ...(reason !== undefined ? { reason } : {}) };
}

/** Official DSH firehose is `(session, event)` with session.id on the subject and no sessionId in event.data. */
export function viewOfficialSessionEvent(args: unknown[]): {
  type: string;
  sessionId?: string;
  content?: { type?: string; text?: string }[];
  chunkText?: string;
  reason?: unknown;
} {
  const first = asRecord(args[0]);
  const second = asRecord(args[1]);
  const wrapped = first ? asRecord(first.event) : undefined;
  const event =
    second && typeof second.type === "string" ? second : first && typeof first.type === "string" ? first : wrapped;
  const data = event ? asRecord(event.data) : undefined;
  const message = data ? asRecord(data.message) : event ? asRecord(event.message) : undefined;
  const firstId = first && "id" in first ? first.id : undefined;
  const sessionId =
    (typeof firstId === "string" && firstId) ||
    (typeof event?.sessionId === "string" ? event.sessionId : undefined) ||
    (typeof data?.sessionId === "string" ? data.sessionId : undefined) ||
    (typeof wrapped?.sessionId === "string" ? wrapped.sessionId : undefined) ||
    undefined;
  const content = textBlocks(message?.content);
  const chunkText = textFromAssistantChunk(data);
  const reason = data && "reason" in data ? data.reason : event && "reason" in event ? event.reason : undefined;
  return {
    type: typeof event?.type === "string" ? event.type : "",
    ...(sessionId ? { sessionId } : {}),
    ...(content ? { content } : {}),
    ...(chunkText ? { chunkText } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

function turnFailureFromReason(reason: unknown): PenglaiError | undefined {
  const rec = asRecord(reason);
  if (!rec || rec.kind !== "error") return undefined;
  const error = rec.error;
  if (typeof error === "string" && error.trim()) return new PenglaiError("INVALID_INPUT", error);
  const detail = asRecord(error);
  const code = typeof detail?.code === "string" ? detail.code : "";
  const status = typeof detail?.status === "number" ? String(detail.status) : "";
  const message = typeof detail?.message === "string" && detail.message.trim() ? detail.message : "official turn failed";
  return new PenglaiError("INVALID_INPUT", [code, status, message].filter(Boolean).join(" "));
}

async function runOfficialTurn(
  ctx: OfficialUsableCtx,
  opts: {
    provider: string;
    model: string;
    cwd: string;
    prompt: string;
    sourceKind: "penglai-onboarding-api-test" | "penglai-onboarding-first-conversation";
    maxTokens: number;
    attachWorkspaceId?: string;
  },
): Promise<{ sessionId: string; final: string; turnCompleted: boolean }> {
  if (!ctx.agents) throw new PenglaiError("DSH_UNAVAILABLE", "official agents missing");
  const sessionId = randomUUID();
  let final = "";
  let turnCompleted = false;
  let turnFailure: PenglaiError | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveWait: () => void = () => {};
  const onEvent = (...args: unknown[]): void => {
    const view = viewOfficialSessionEvent(args);
    if (view.sessionId && view.sessionId !== sessionId) return;
    const text = Array.isArray(view.content)
      ? view.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("")
      : "";
    if (view.type === "assistant/chunk" && view.chunkText) final += view.chunkText;
    if (view.type === "assistant/message" && text) final = text;
    if (view.type === "turn/end") {
      turnCompleted = true;
      turnFailure = turnFailureFromReason(view.reason);
      clearTimeout(timer);
      resolveWait();
    }
  };
  const done = new Promise<void>((resolve) => {
    resolveWait = resolve;
    // The wizard allows 180 seconds. Keep a bounded margin for UI recovery,
    // while allowing official reasoning models to produce a durable first Turn.
    timer = setTimeout(() => resolve(), 120_000);
  });
  const disposeEvent = ctx.on?.("session/event", onEvent);
  let handle: Awaited<ReturnType<NonNullable<OfficialUsableCtx["agents"]>["create"]>> | undefined;
  try {
    handle = await ctx.agents.create({
      sessionId,
      meta: { cwd: opts.cwd },
      agentOptions: {
        provider: opts.provider,
        model: opts.model,
        tools: false,
        maxTokens: opts.maxTokens,
        reasoningEffort: "off",
      } as never,
    });
    handle.agent.followup({
      id: randomUUID(),
      role: "user",
      content: [{ type: "text", text: opts.prompt }],
      source: { kind: opts.sourceKind },
    });
    const idle = typeof handle.agent.whenIdle === "function" ? handle.agent.whenIdle() : done;
    await Promise.race([idle, done]);
    let durable = durableFinalFromOfficialSession(handle.agent.session);
    // DSH may report idle before the durable turn/end event has reached the
    // session log. Do not dispose a successful Turn during that short race.
    if (!turnCompleted && !durable.turnCompleted) {
      await done;
      durable = durableFinalFromOfficialSession(handle.agent.session);
    }
    if (durable.final) final = durable.final;
    if (durable.turnCompleted) {
      turnCompleted = true;
      turnFailure = turnFailureFromReason(durable.reason) ?? turnFailure;
    }
    if (!turnFailure && opts.attachWorkspaceId) {
      if (!handle) throw new PenglaiError("DSH_UNAVAILABLE", "official agents missing");
      const workspace = ctx.workspaceRegistry?.list?.().find((row) => row.id === opts.attachWorkspaceId);
      if (!workspace?.attachSession) {
        throw new PenglaiError("DSH_UNAVAILABLE", "official workspace attachSession missing");
      }
      await workspace.attachSession(sessionId);
      if (typeof handle.agent.session?.flush === "function") await handle.agent.session.flush();
    }
  } finally {
    clearTimeout(timer);
    if (typeof disposeEvent === "function") disposeEvent();
    await handle?.dispose();
  }
  if (turnFailure) throw turnFailure;
  return { sessionId, final, turnCompleted };
}

export async function runOfficialNonceTurn(
  ctx: OfficialUsableCtx,
  opts: { nonce: string; provider: string; model: string; cwd: string },
): Promise<{ passed: boolean; digest: string; sessionId: string; final?: string }> {
  const digest = createHash("sha256").update(opts.nonce, "utf8").digest("hex");
  const result = await runOfficialTurn(ctx, {
    provider: opts.provider,
    model: opts.model,
    cwd: opts.cwd,
    prompt: `PENGLAI_OK_${opts.nonce}`,
    sourceKind: "penglai-onboarding-api-test",
    maxTokens: 256,
  });
  const final = result.final;
  if (!result.turnCompleted && !final) {
    throw new PenglaiError("DSH_UNAVAILABLE", "official nonce Turn did not complete");
  }
  if (!final) {
    throw new PenglaiError("DSH_UNAVAILABLE", "official nonce Turn produced no durable final");
  }
  if (!canMarkTestPassed({ nonce: opts.nonce, durableFinal: final })) {
    throw new PenglaiError("INVALID_INPUT", "official nonce Turn final did not include the nonce");
  }
  return { passed: true, digest, sessionId: result.sessionId, final };
}

export async function runOfficialFirstConversation(
  ctx: OfficialUsableCtx,
  opts: { message: string; provider: string; model: string; cwd: string; workspaceId: string },
): Promise<{
  passed: boolean;
  sessionId: string;
  messageDigest: string;
  finalDigest?: string;
  final?: string;
  turnCompleted: boolean;
}> {
  const message = opts.message.trim();
  if (!message || message.length > 4000) throw new PenglaiError("INVALID_INPUT", "first conversation message required");
  if (!opts.workspaceId) throw new PenglaiError("INVALID_INPUT", "official workspace required");
  const result = await runOfficialTurn(ctx, {
    provider: opts.provider,
    model: opts.model,
    cwd: opts.cwd,
    prompt: message,
    sourceKind: "penglai-onboarding-first-conversation",
    maxTokens: 1024,
    attachWorkspaceId: opts.workspaceId,
  });
  const finalDigest = result.final ? createHash("sha256").update(result.final, "utf8").digest("hex") : undefined;
  return {
    passed: result.turnCompleted && Boolean(finalDigest),
    sessionId: result.sessionId,
    messageDigest: createHash("sha256").update(message, "utf8").digest("hex"),
    ...(finalDigest ? { finalDigest } : {}),
    ...(result.final ? { final: result.final } : {}),
    turnCompleted: result.turnCompleted,
  };
}
