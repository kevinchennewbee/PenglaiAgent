import { createHash } from "node:crypto";
import { accessSync, constants, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError } from "@penglai/contracts";
import {
  assertCredentialValueShape,
  assertWorkspacePathAllowed,
  createOnboardingHost,
  namedApiKeyEnvFromOfficialSettings,
  rematerializeOfficialCredentialRef,
  resolveOfficialCredentialRef,
  ensureOfficialProviderRoute,
  describeOfficialCredential,
  persistAppearanceToOfficialSettings,
  persistWelcomeAckToOfficialSettings,
  runOfficialNonceTurn,
  runOfficialFirstConversation,
  onboardingApiTestCwd,
  releaseOnboardingTestWorkspaces,
  verifyWorkspaceInRegistry,
  type OnboardingHost,
  type PublicOnboardingState,
  type ReconfigurableOnboardingStep,
  type OfficialUsableCtx,
} from "./onboarding.js";

function assertWritableWorkspace(path: string | undefined): void {
  if (!path)
    throw new PenglaiError("INVALID_INPUT", "official workspace path required");
  try {
    accessSync(path, constants.W_OK);
  } catch {
    throw new PenglaiError("INVALID_INPUT", "workspace path not writable");
  }
}

export function createPenglaiOnboardingRemoteImpl(opts: {
  dir: string;
  userDataRoot?: string;
  installRoots?: string[];
  officialCatalog?: () => unknown;
  officialWelcomeAck?: () => boolean;
  agents?: OfficialUsableCtx;
}): OnboardingHost & {
  rewindOnboarding(input: { step: ReconfigurableOnboardingStep }): PublicOnboardingState;
  completeWelcome(): Promise<PublicOnboardingState>;
  enterCredential(input: {
    provider: string;
    value: string;
  }): Promise<{ configured: boolean; source: string; writable: boolean }>;
  listModels(input: {
    provider: string;
  }): Promise<Array<{ provider: string; id: string; name: string }>>;
  createWorkspace(input: { path: string; title: string }): Promise<PublicOnboardingState>;
  selectModel(input: {
    provider: string;
    model: string;
  }): Promise<PublicOnboardingState>;
  testSelectedModel(input: { nonce: string }): Promise<unknown>;
  completeAppearance(input: {
    locale: "zh" | "en";
    theme: "light" | "dark" | "system";
  }): Promise<PublicOnboardingState>;
  verifyCredential(input: { ref: string }): Promise<PublicOnboardingState>;
  listWorkspaces(): Array<{ id: string; title?: string; path?: string }>;
  recordWorkspace(input: { workspaceId: string }): PublicOnboardingState;
  runFirstConversation(input: { message: string }): Promise<unknown>;
} {
  const host = createOnboardingHost(opts);
  const userDataRoot = opts.userDataRoot ?? resolve(opts.dir, "..");
  const installRoots = opts.installRoots ?? [];
  const official = (): OfficialUsableCtx => {
    if (!opts.agents)
      throw new PenglaiError(
        "DSH_UNAVAILABLE",
        "official DSH services missing",
      );
    return opts.agents;
  };
  const requireCatalogProvider = (provider: string): void => {
    if (!host.status().providers.some((card) => card.id === provider)) {
      throw new PenglaiError(
        "INVALID_INPUT",
        "provider missing from server-side official catalog",
      );
    }
  };
  return {
    ...host,
    rewindOnboarding(input) {
      return host.rewind(input.step);
    },
    async completeWelcome() {
      const persisted = await persistWelcomeAckToOfficialSettings(official());
      if (!persisted)
        throw new PenglaiError(
          "DSH_UNAVAILABLE",
          "official settings persistence failed",
        );
      const state = host.status();
      if (state.current === "welcome-v1") {
        return host.advance("welcome-v1", { officialWelcomeAck: true });
      }
      if (state.completed.includes("welcome-v1")) return state;
      throw new PenglaiError(
        "INVALID_INPUT",
        `welcome acknowledgement is not allowed from ${state.current}`,
      );
    },
    async enterCredential(input) {
      assertCredentialValueShape(input.value);
      if (host.status().current === "COMPLETE") {
        throw new PenglaiError("SECURITY_POLICY", "credential entry is not allowed after onboarding is complete");
      }
      const services = official();
      if (!services.credentials?.set) {
        throw new PenglaiError(
          "DSH_UNAVAILABLE",
          "official credentials service missing",
        );
      }
      requireCatalogProvider(input.provider);
      const named = namedApiKeyEnvFromOfficialSettings(
        input.provider,
        official().settings?.describe?.(),
      );
      const ref = resolveOfficialCredentialRef(input.provider, named);
      const state = host.status();
      if (state.current === "model-test-v1") {
        const facts = host.facts();
        if (facts.selection?.provider !== input.provider) {
          throw new PenglaiError(
            "INVALID_INPUT",
            `credential entry is not allowed from ${state.current}`,
          );
        }
        await services.credentials.set(ref, input.value);
        const rewritten = await describeOfficialCredential(services, ref);
        if (!rewritten.configured) {
          throw new PenglaiError("INVALID_INPUT", "official credential not configured");
        }
        // Re-entry after a MISSING_CREDENTIAL remap: drop the stale derived
        // ref so the YAML keeps a single DeepSeek secret for this provider.
        const stale = facts.credentialRef?.trim();
        if (stale && stale !== ref) {
          try {
            await services.credentials.unset?.(stale);
          } catch {
            /* read-only layer shadows the stale ref; the official ref wins */
          }
        }
        host.saveFacts({ credentialRef: ref });
        return rewritten;
      }
      if (state.current !== "credential-v1") {
        throw new PenglaiError(
          "INVALID_INPUT",
          `credential entry is not allowed from ${state.current}`,
        );
      }
      await services.credentials.set(ref, input.value);
      const descriptor = await describeOfficialCredential(services, ref);
      if (!descriptor.configured) {
        throw new PenglaiError(
          "INVALID_INPUT",
          "official credential not configured",
        );
      }
      host.saveFacts({ credentialRef: ref });
      host.advance("credential-v1", {
        descriptor: { ...descriptor, serverVerified: true },
      });
      return descriptor;
    },
    async listModels(input) {
      const services = official();
      if (!services.llm?.listModels) {
        throw new PenglaiError(
          "DSH_UNAVAILABLE",
          "official llm model directory missing",
        );
      }
      requireCatalogProvider(input.provider);
      try {
        await ensureOfficialProviderRoute(services, input.provider);
        return await services.llm.listModels(input.provider);
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        if (/no adapter registered/i.test(text)) {
          throw new PenglaiError("INVALID_INPUT", text);
        }
        throw err;
      }
    },
    async createWorkspace(input) {
      const title = input.title.trim();
      if (!title || title.length > 128) {
        throw new PenglaiError("INVALID_INPUT", "workspace title required");
      }
      assertWorkspacePathAllowed(input.path, {
        onboardingDir: opts.dir,
        userDataRoot,
        installRoots,
      });
      if (host.status().current !== "workspace-v1") {
        throw new PenglaiError(
          "INVALID_INPUT",
          `workspace creation is not allowed from ${host.status().current}`,
        );
      }
      const registry = official().workspaceRegistry;
      if (!registry?.create || !registry.list) {
        throw new PenglaiError("DSH_UNAVAILABLE", "official workspace registry missing");
      }
      const created = await registry.create(input.path, title);
      const found = verifyWorkspaceInRegistry(registry, created.id);
      assertWritableWorkspace(found.path ?? input.path);
      host.saveFacts({ workspaceId: found.id, workspacePath: found.path ?? input.path });
      return host.advance("workspace-v1", {
        workspaceId: found.id,
        workspaceWritable: true,
      });
    },
    async selectModel(input) {
      const state = host.status();
      if (state.current !== "model-provider-v1") {
        const saved = host.facts().selection;
        if (saved?.provider === input.provider && saved.model === input.model)
          return state;
        throw new PenglaiError(
          "INVALID_INPUT",
          `model selection is not allowed from ${state.current}`,
        );
      }
      const services = official();
      if (!services.llm?.listModels || !services.llm.resolveModelInfo) {
        throw new PenglaiError(
          "DSH_UNAVAILABLE",
          "official llm model directory missing",
        );
      }
      const catalog = opts.officialCatalog?.();
      const cards = host.status().providers;
      if (!cards.some((card) => card.id === input.provider)) {
        throw new PenglaiError(
          "INVALID_INPUT",
          "provider missing from server-side official catalog",
        );
      }
      await ensureOfficialProviderRoute(services, input.provider);
      const models = await services.llm.listModels(input.provider);
      if (
        !models.some(
          (model) =>
            model.provider === input.provider && model.id === input.model,
        )
      ) {
        throw new PenglaiError(
          "INVALID_INPUT",
          "model missing from server-side official model directory",
        );
      }
      const resolved = await services.llm.resolveModelInfo(
        input.provider,
        input.model,
      );
      if (resolved.provider !== input.provider || resolved.id !== input.model) {
        throw new PenglaiError(
          "INVALID_INPUT",
          "official model resolution identity mismatch",
        );
      }
      host.saveFacts({
        selection: { provider: input.provider, model: input.model },
      });
      return host.advance("model-provider-v1", {
        officialCatalog: catalog,
        providerSelection: { provider: input.provider, model: input.model },
      });
    },
    async completeAppearance(input) {
      const services = official();
      const persisted = await persistAppearanceToOfficialSettings(
        services,
        input.locale,
        input.theme,
      );
      if (!persisted)
        throw new PenglaiError(
          "DSH_UNAVAILABLE",
          "official settings persistence failed",
        );
      return host.advance("appearance-locale-v1", {
        ...input,
        officialSettingsPersisted: true,
      });
    },
    async verifyCredential(input) {
      const descriptor = await describeOfficialCredential(
        official(),
        input.ref,
      );
      if (!descriptor.configured)
        throw new PenglaiError(
          "INVALID_INPUT",
          "official credential not configured",
        );
      const state = host.status();
      // The ref must be the official ref for the currently selected provider,
      // never an arbitrary configured ref handed in by the caller.
      const selection = host.facts().selection;
      const expected = selection
        ? resolveOfficialCredentialRef(
            selection.provider,
            namedApiKeyEnvFromOfficialSettings(
              selection.provider,
              official().settings?.describe?.(),
            ),
          )
        : undefined;
      if (expected && input.ref !== expected) {
        throw new PenglaiError(
          "INVALID_INPUT",
          "credential ref does not match the selected provider",
        );
      }
      if (state.current === "credential-v1") {
        host.saveFacts({ credentialRef: input.ref });
        return host.advance("credential-v1", {
          descriptor: { ...descriptor, serverVerified: true },
        });
      }
      if (
        state.current === "model-test-v1" &&
        host.facts().credentialRef === input.ref
      )
        return state;
      throw new PenglaiError(
        "INVALID_INPUT",
        `credential verification is not allowed from ${state.current}`,
      );
    },
    async testSelectedModel(input) {
      const state = host.status();
      if (state.current !== "model-test-v1") {
        throw new PenglaiError(
          "INVALID_INPUT",
          `model test is not allowed from ${state.current}`,
        );
      }
      const selection = host.facts().selection;
      if (!selection)
        throw new PenglaiError(
          "INVALID_INPUT",
          "server-verified model selection required",
        );
      const aligned = await rematerializeOfficialCredentialRef(official(), {
        provider: selection.provider,
        ...(host.facts().credentialRef ? { credentialRef: host.facts().credentialRef } : {}),
      });
      if (aligned.remapped || host.facts().credentialRef !== aligned.ref) {
        host.saveFacts({ credentialRef: aligned.ref });
      }
      const cwd = onboardingApiTestCwd(opts.dir);
      mkdirSync(cwd, { recursive: true, mode: 0o700 });
      const result = await runOfficialNonceTurn(official(), {
        nonce: input.nonce,
        provider: selection.provider,
        model: selection.model,
        cwd,
      });
      try {
        await releaseOnboardingTestWorkspaces(official().workspaceRegistry, opts.dir);
      } catch {
        /* leftover test workspace is cleaned again on next host apply */
      }
      if (!result.passed || !result.final) return { passed: result.passed, digest: result.digest, sessionId: result.sessionId };
      host.saveFacts({
        apiTest: {
          nonceDigest: result.digest,
          sessionId: result.sessionId,
          finalDigest: createHash("sha256")
            .update(result.final, "utf8")
            .digest("hex"),
        },
      });
      host.advance("model-test-v1", {
        nonce: input.nonce,
        durableFinal: result.final,
      });
      return { passed: true, digest: result.digest, sessionId: result.sessionId };
    },
    listWorkspaces() {
      const registry = official().workspaceRegistry;
      if (!registry?.list)
        throw new PenglaiError(
          "DSH_UNAVAILABLE",
          "official workspace registry missing",
        );
      return registry.list().map((workspace) => ({
        id: workspace.id,
        ...(workspace.title ? { title: workspace.title } : {}),
        ...(workspace.path ? { path: workspace.path } : {}),
      }));
    },
    recordWorkspace(input) {
      if (host.status().current !== "workspace-v1") {
        throw new PenglaiError(
          "INVALID_INPUT",
          `workspace selection is not allowed from ${host.status().current}`,
        );
      }
      const registry = official().workspaceRegistry;
      const found = verifyWorkspaceInRegistry(registry, input.workspaceId);
      assertWritableWorkspace(found.path);
      host.saveFacts({ workspaceId: found.id, ...(found.path ? { workspacePath: found.path } : {}) });
      return host.advance("workspace-v1", {
        workspaceId: found.id,
        workspaceWritable: true,
      });
    },
    async runFirstConversation(input) {
      if (host.status().current !== "first-turn-v1") {
        throw new PenglaiError(
          "INVALID_INPUT",
          `first conversation is not allowed from ${host.status().current}`,
        );
      }
      const facts = host.facts();
      const cwd = facts.workspacePath;
      if (!cwd) throw new PenglaiError("INVALID_INPUT", "official workspace path required");
      if (!facts.workspaceId) throw new PenglaiError("INVALID_INPUT", "official workspace required");
      const selection = facts.selection;
      if (!selection?.provider || !selection.model) {
        throw new PenglaiError("INVALID_INPUT", "provider and model selection required");
      }
      const result = await runOfficialFirstConversation(official(), {
        message: input.message,
        provider: selection.provider,
        model: selection.model,
        cwd,
        workspaceId: facts.workspaceId,
      });
      if (!result.passed || !result.finalDigest) {
        throw new PenglaiError("DSH_UNAVAILABLE", "official first Turn did not complete");
      }
      host.saveFacts({
        firstConversation: {
          sessionId: result.sessionId,
          messageDigest: result.messageDigest,
          finalDigest: result.finalDigest,
        },
      });
      return {
        passed: true,
        sessionId: result.sessionId,
        digest: result.finalDigest,
        ...(host.advance("first-turn-v1", {
          officialSessionId: result.sessionId,
          durableFinalDigest: result.finalDigest,
          turnCompleted: true,
        }) as object),
      };
    },
  };
}

export function assertOnboardingRemoteHasNoSecretSurface(source: string): void {
  const body =
    source.split("assertOnboardingRemoteHasNoSecretSurface")[0] ?? "";
  if (/\b(getSecret|readSecret|exportKey|setKey)\s*\(/.test(body)) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "onboarding remote exposes secret surface",
    );
  }
}

export class PenglaiOnboardingRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly impl: ReturnType<typeof createPenglaiOnboardingRemoteImpl>,
  ) {
    super(ctx, "penglaiOnboarding");
  }

  @Remote
  status() {
    return this.impl.status();
  }

  @Remote
  completeWelcome() {
    return this.impl.completeWelcome();
  }

  @Remote
  enterCredential(input: { provider: string; value: string }) {
    return this.impl.enterCredential(input);
  }

  @Remote
  listModels(input: { provider: string }) {
    return this.impl.listModels(input);
  }

  @Remote
  createWorkspace(input: { path: string; title: string }) {
    return this.impl.createWorkspace(input);
  }

  @Remote
  listProviders() {
    return this.impl.status().providers;
  }

  @Remote
  completePrivacy() {
    return this.impl.advance("privacy-v1");
  }

  @Remote
  rewindOnboarding(input: { step: ReconfigurableOnboardingStep }) {
    return this.impl.rewindOnboarding(input);
  }

  @Remote
  completeAppearance(input: {
    locale: "zh" | "en";
    theme: "light" | "dark" | "system";
  }) {
    return this.impl.completeAppearance(input);
  }

  @Remote
  selectModel(input: { provider: string; model: string }) {
    return this.impl.selectModel(input);
  }

  @Remote
  verifyCredential(input: { ref: string }) {
    return this.impl.verifyCredential(input);
  }

  @Remote
  testSelectedModel(input: { nonce: string }) {
    return this.impl.testSelectedModel(input);
  }

  @Remote
  listWorkspaces() {
    return this.impl.listWorkspaces();
  }

  @Remote
  recordWorkspace(input: { workspaceId: string }) {
    return this.impl.recordWorkspace(input);
  }

  @Remote
  runFirstConversation(input: { message: string }) {
    return this.impl.runFirstConversation(input);
  }

  @Remote
  offerIm(input: { choice: "weixin" | "feishu" | "later" }) {
    void input;
    throw new PenglaiError("INVALID_INPUT", "im offer is not part of first-run wizard");
  }

  @Remote
  offerExtension(input: {
    id: "voice-offer-v1" | "memory-offer-v1";
    choice: "later" | "configured";
  }) {
    void input;
    throw new PenglaiError("INVALID_INPUT", "extension offer is not part of first-run wizard");
  }
}
