import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { isRecord, PenglaiError, RELEASE } from "@penglai/contracts";
import {
  FIRST_PARTY_PLUGIN_METADATA,
  loadPluginCatalog,
  PINNED_PLUGIN_DSH,
  runtimePluginTarget,
  type PluginCatalogEntry as CatalogEntry,
  type PluginCatalogMetadata,
  type PluginProvenanceClass as ProvenanceClass,
} from "@penglai/runtime";
import { PluginDistributionClient } from "@penglai/plugin-registry";
import { createCenterRemote, PenglaiCenterRemote } from "./remotes.js";
import {
  createPenglaiOnboardingRemoteImpl,
  PenglaiOnboardingRemote,
} from "./onboarding-remote.js";
import { recoverInterruptedTransaction } from "./profile-tx.js";
import {
  releaseOnboardingTestWorkspaces,
  wizardProviderCatalog,
  type OfficialUsableCtx,
} from "./onboarding.js";
import { normalizeInventory, rowLoaded, rowMatches } from "./inventory.js";
import { installPenglaiProductIdentity } from "./identity.js";
export * from "./inventory.js";
export {
  applyPenglaiProductIdentity,
  HARNESS_IDENTITY_NAME,
  installPenglaiProductIdentity,
  PENGLAI_PRODUCT_IDENTITY,
} from "./identity.js";

export const name = "@penglai/plugin-center";
export const inject = [
  "loader",
  "pluginInventory",
  "llm",
  "agents",
  "workspaceRegistry",
  "credentials",
  "settings",
];

export type { CatalogEntry, PluginCatalogMetadata, ProvenanceClass };

export interface PluginState {
  id: string;
  desired: string;
  installed: string;
  loaded: boolean;
  healthy: boolean;
  actual: "active" | "failed" | "disabled";
  error?: string;
  configuration?: unknown;
}

export const R2_CATALOG = FIRST_PARTY_PLUGIN_METADATA;

export interface WorkspaceProtectionSnapshot {
  schema: 1;
  complete: boolean;
  at: string;
  roots: string[];
  errorClass?: string;
}

function installRootsFromEnv(): string[] {
  const resources = process.env.PENGLAI_RESOURCES;
  if (!resources || !isAbsolute(resources)) return [];
  return [
    ...new Set([
      resolve(resources),
      resolve(resources, ".."),
      resolve(resources, "..", ".."),
    ]),
  ];
}

export function workspaceProtectionSnapshot(
  rows: Array<{ id?: unknown; path?: unknown }>,
  at = new Date().toISOString(),
): WorkspaceProtectionSnapshot {
  try {
    const roots = new Set<string>();
    for (const row of rows) {
      if (
        typeof row.id !== "string" ||
        !row.id ||
        typeof row.path !== "string" ||
        !isAbsolute(row.path)
      ) {
        throw new PenglaiError(
          "STORE_CORRUPT",
          "official Workspace registry path invalid",
        );
      }
      const requested = resolve(row.path);
      roots.add(requested);
      if (existsSync(requested)) roots.add(realpathSync(requested));
    }
    return { schema: 1, complete: true, at, roots: [...roots].sort() };
  } catch (error) {
    return {
      schema: 1,
      complete: false,
      at,
      roots: [],
      errorClass:
        error instanceof PenglaiError
          ? error.errorClass
          : "WORKSPACE_REGISTRY_UNAVAILABLE",
    };
  }
}

export function validateCatalog(
  entries: readonly PluginCatalogMetadata[],
): void {
  const ids = new Set<string>();
  for (const e of entries) {
    if (ids.has(e.id))
      throw new PenglaiError("INVALID_INPUT", `duplicate catalog ${e.id}`);
    ids.add(e.id);
    if (e.dsh.exact !== PINNED_PLUGIN_DSH)
      throw new PenglaiError("DSH_CONTRACT_DRIFT", e.id);
    if (
      e.id.includes("community") &&
      e.provenanceClass !== "community-reviewed"
    ) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        "unreviewed community plugin is not a product catalog entry",
      );
    }
    if (
      e.id.includes("credentials-keychain") ||
      e.id.includes("plugin-smoke")
    ) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        `historical package ${e.id} is not a product catalog entry`,
      );
    }
    if (e.permissions.includes("keychain")) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        `${e.id} must not declare keychain permission`,
      );
    }
    if (!e.provenanceClass) {
      throw new PenglaiError(
        "INVALID_INPUT",
        `${e.id} missing provenanceClass`,
      );
    }
    if (!e.license || !e.migration) {
      throw new PenglaiError(
        "INVALID_INPUT",
        `${e.id} missing license/migration`,
      );
    }
    if (!e.source || !e.version || !e.packageFile) {
      throw new PenglaiError(
        "INVALID_INPUT",
        `${e.id} missing version/source/packageFile`,
      );
    }
    for (const plat of ["darwin-arm64", "darwin-x64", "win32-x64"] as const) {
      if (!e.platforms.includes(plat))
        throw new PenglaiError(
          "INVALID_INPUT",
          `${e.id} missing platform ${plat}`,
        );
    }
  }
}

export function verifyPackage(file: string, expectedSha: string): void {
  if (!existsSync(file))
    throw new PenglaiError("INVALID_INPUT", "package missing");
  if (file.includes("..") || file.startsWith("/"))
    throw new PenglaiError("SECURITY_POLICY", "unsafe package path");
  if (!/^[0-9a-f]{64}$/.test(expectedSha))
    throw new PenglaiError("SECURITY_POLICY", "checksum required");
  const got = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (got !== expectedSha)
    throw new PenglaiError("SECURITY_POLICY", "checksum mismatch");
}

function atomicJson(path: string, value: unknown): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), {
    mode: 0o600,
    flag: "w",
  });
  renameSync(temp, path);
}

export interface PluginHealthResult {
  healthy: boolean;
  error?: string;
  configuration?: unknown;
}

export class PluginCenterHost {
  constructor(
    private readonly stateDir: string,
    private readonly inventory: { list(): unknown },
    private readonly catalog: readonly CatalogEntry[],
    private readonly profileDir?: string,
    private readonly health?: (id: string) => PluginHealthResult,
    private readonly allowId?: (id: string) => boolean,
  ) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    validateCatalog(catalog);
    if (
      !catalog.length ||
      catalog.some((entry) => !/^[0-9a-f]{64}$/.test(entry.sha256))
    ) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        "resolved catalog checksum required",
      );
    }
  }

  entries(): readonly CatalogEntry[] {
    return this.catalog;
  }

  desired(): Record<string, boolean> {
    const p = join(this.stateDir, "desired.json");
    if (!existsSync(p)) {
      const init: Record<string, boolean> = {};
      for (const e of this.catalog) init[e.id] = e.defaultEnabled;
      atomicJson(p, init);
      return init;
    }
    const raw: unknown = JSON.parse(readFileSync(p, "utf8"));
    if (!isRecord(raw)) throw new PenglaiError("STORE_CORRUPT", "desired");
    return raw as Record<string, boolean>;
  }

  setDesired(id: string, enabled: boolean): void {
    if (!this.catalog.some((e) => e.id === id) && !this.allowId?.(id))
      throw new PenglaiError("INVALID_INPUT", "unlisted package");
    const next = { ...this.desired(), [id]: enabled };
    atomicJson(join(this.stateDir, "desired.json"), next);
  }

  private installedVersion(id: string): string {
    if (!this.profileDir) return "not-installed";
    const file = join(
      this.profileDir,
      "node_modules",
      ...id.split("/"),
      "package.json",
    );
    if (!existsSync(file)) return "not-installed";
    try {
      const value = JSON.parse(readFileSync(file, "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
      return value.name === id && typeof value.version === "string"
        ? value.version
        : "invalid";
    } catch {
      return "invalid";
    }
  }

  reconcile(): PluginState[] {
    const desired = this.desired();
    let loaded: ReturnType<typeof normalizeInventory> = [];
    try {
      loaded = normalizeInventory(this.inventory.list());
    } catch {
      loaded = [];
    }
    const ids = new Set(this.catalog.map((e) => e.id));
    for (const id of Object.keys(desired)) ids.add(id);
    return [...ids].map((id) => {
      const e = this.catalog.find((row) => row.id === id);
      const hit = loaded.find((n) => rowMatches(n, id));
      const isLoaded = rowLoaded(hit);
      const wanted = Boolean(desired[id]);
      const installed = this.installedVersion(id);
      const version = e?.version ?? (installed !== "not-installed" && installed !== "invalid" ? installed : "remote");
      let health: PluginHealthResult = { healthy: false };
      if (isLoaded) {
        try {
          health = this.health?.(id) ?? { healthy: true };
        } catch (error) {
          health = {
            healthy: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      return {
        id,
        desired: wanted ? version : "disabled",
        installed,
        loaded: isLoaded,
        healthy:
          wanted && isLoaded && installed === version && health.healthy,
        actual: isLoaded ? "active" : wanted ? "failed" : "disabled",
        ...(health.error ? { error: health.error } : {}),
        ...(health.configuration === undefined
          ? {}
          : { configuration: health.configuration }),
      };
    });
  }
}

type OfficialLlm = {
  listProviders?: () => unknown[];
  listConfigurableProviders?: () => unknown[];
  listModels?: (
    provider: string,
  ) => Promise<Array<{ provider: string; id: string; name: string }>>;
  resolveModelInfo?: (
    provider: string,
    model: string,
  ) => Promise<{ provider: string; id: string; name: string }>;
  registerAdapter?: (providers: string[], adapter: unknown) => unknown;
  registerConfigurableProviders?: (entries: unknown[]) => unknown;
};

function officialService<T>(
  ctx: { get?: (name: string) => unknown } & Record<string, unknown>,
  name: string,
): T | undefined {
  return (ctx[name] as T | undefined) ?? (ctx.get?.(name) as T | undefined);
}

function officialOnboardingContext(
  ctx: {
    get?: (name: string) => unknown;
    on?: (...args: unknown[]) => unknown;
  } & Record<string, unknown>,
): OfficialUsableCtx {
  const llm = officialService<NonNullable<OfficialUsableCtx["llm"]>>(
    ctx,
    "llm",
  );
  const credentials = officialService<
    NonNullable<OfficialUsableCtx["credentials"]>
  >(ctx, "credentials");
  const settings = officialService<NonNullable<OfficialUsableCtx["settings"]>>(
    ctx,
    "settings",
  );
  const agents = officialService<NonNullable<OfficialUsableCtx["agents"]>>(
    ctx,
    "agents",
  );
  const workspaceRegistry = officialService<
    NonNullable<OfficialUsableCtx["workspaceRegistry"]>
  >(ctx, "workspaceRegistry");
  return {
    ...(llm ? { llm } : {}),
    ...(credentials ? { credentials } : {}),
    ...(settings ? { settings } : {}),
    ...(agents ? { agents } : {}),
    ...(workspaceRegistry ? { workspaceRegistry } : {}),
    ...(ctx.on
      ? { on: ctx.on.bind(ctx) as NonNullable<OfficialUsableCtx["on"]> }
      : {}),
  };
}

function pluginHealthFrom(
  ctx: { get?: (name: string, strict?: boolean) => unknown },
  id: string,
): PluginHealthResult {
  const serviceName: Record<string, string> = {
    "@penglai/im": "penglaiImCore",
    "@penglai/asr": "penglaiAsr",
    "@penglai/moss-tts": "penglaiMossTts",
    "@penglai/context": "penglaiContext",
    "@penglai/memory": "penglaiMemory",
    "@penglai/budget": "penglaiBudget",
    "@penglai/companion": "penglaiCompanion",
  };
  const name = serviceName[id];
  if (!name) return { healthy: true };
  // These are optional sibling-plugin services. Cordis property access is
  // intentionally inject-gated, while Context#get is the official dynamic
  // lookup for hot-pluggable services that must not block Center itself.
  const service = ctx.get?.(name) as Record<string, unknown> | undefined;
  if (!service) return { healthy: false, error: `${name} service missing` };
  try {
    if (typeof service.describeCapability === "function") {
      return {
        healthy: true,
        configuration: service.describeCapability(),
      };
    }
    if (typeof service.status === "function") {
      return { healthy: true, configuration: service.status() };
    }
    if (typeof service.getDiagnostics === "function") {
      return { healthy: true, configuration: service.getDiagnostics() };
    }
    return { healthy: true, configuration: { state: "active" } };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const ZERO_RESOURCES = {
  workers: 0,
  sockets: 0,
  timers: 0,
  remotes: 0,
  db: 0,
  modelSessions: 0,
  audioHandles: 0,
} as const;

function resourceProbeFrom(
  ctx: { get?: (name: string, strict?: boolean) => unknown },
  inventory: { list(): unknown },
  id: string,
) {
  if (id === "@penglai/plugin-reference") {
    return { snapshot: () => ({ ...ZERO_RESOURCES }) };
  }
  const serviceNames: Record<string, string> = {
    "@penglai/im": "penglaiImCore",
    "@penglai/asr": "penglaiAsr",
    "@penglai/moss-tts": "penglaiMossTts",
    "@penglai/context": "penglaiContext",
    "@penglai/memory": "penglaiMemory",
    "@penglai/budget": "penglaiBudget",
    "@penglai/companion": "penglaiCompanion",
  };
  const serviceName = serviceNames[id];
  if (!serviceName) return { snapshot: () => ({ ...ZERO_RESOURCES }) };
  const service = ctx.get?.(serviceName) as
    | {
        resourceSnapshot?: () => Partial<typeof ZERO_RESOURCES>;
      }
    | undefined;
  if (!service || typeof service.resourceSnapshot !== "function")
    return undefined;
  return {
    snapshot() {
      const measured = service.resourceSnapshot?.() ?? {};
      const loaded = normalizeInventory(inventory.list()).some(
        (entry) => rowMatches(entry, id) && rowLoaded(entry),
      );
      return {
        workers: Number(measured.workers ?? 0),
        sockets: Number(measured.sockets ?? 0),
        timers: Number(measured.timers ?? 0),
        remotes: loaded ? 1 : Number(measured.remotes ?? 0),
        db: Number(measured.db ?? 0),
        modelSessions: Number(measured.modelSessions ?? 0),
        audioHandles: Number(measured.audioHandles ?? 0),
      };
    },
  };
}

export function apply(ctx: {
  loader: {
    resolve(id: string): {
      update(
        options: { disabled?: boolean },
        create?: boolean,
        force?: boolean,
      ): Promise<void>;
    };
    await(): Promise<void>;
  };
  pluginInventory: { list(): unknown };
  llm?: OfficialLlm;
  get?: (name: string) => unknown;
  on?: (...args: unknown[]) => unknown;
  effect?: (setup: () => () => void) => unknown;
  webServer?: {
    register: (route: {
      kind?: "exact" | "prefix";
      path: string;
      handler: (
        req: unknown,
        res: {
          writeHead: (n: number, h?: unknown) => void;
          end: (b?: string) => void;
        },
      ) => void;
    }) => void;
  };
}): PluginCenterHost {
  const userData = process.env.PENGLAI_USER_DATA;
  if (!userData)
    throw new PenglaiError(
      "DSH_UNAVAILABLE",
      "PENGLAI_USER_DATA is required for app-private plugin state",
    );
  const dir = join(userData, "plugins");
  const inventory = ctx.pluginInventory;
  const profileDir = join(userData, "dsh-home", "profiles", "web");
  const pluginsDir = process.env.PENGLAI_PLUGINS_DIR;
  if (!pluginsDir) {
    throw new PenglaiError(
      "DSH_UNAVAILABLE",
      "PENGLAI_PLUGINS_DIR is required for trusted bundled catalog",
    );
  }
  installPenglaiProductIdentity(ctx);
  const catalog = loadPluginCatalog(pluginsDir, runtimePluginTarget(), true);
  const registry = new PluginDistributionClient({
    cacheRoot: join(userData, "plugins", "cas"),
    trustPath: join(userData, "plugins", "trust-state.json"),
    lastGoodPath: join(userData, "plugins", "last-good-catalog.json"),
    penglaiVersion: RELEASE,
    dshExact: PINNED_PLUGIN_DSH,
    target: runtimePluginTarget(),
  });
  const host = new PluginCenterHost(
    dir,
    inventory,
    catalog.entries,
    profileDir,
    (id) => pluginHealthFrom(ctx as typeof ctx & Record<string, unknown>, id),
    (id) => {
      try {
        registry.entry(id);
        return true;
      } catch {
        return false;
      }
    },
  );
  const recovered = recoverInterruptedTransaction({
    userDataRoot: userData,
    profileDir,
    txDir: join(userData, "profiles", "center-tx"),
  });
  if (
    recovered.phase === "rolled_back" &&
    typeof recovered.previousEnabled === "boolean"
  ) {
    host.setDesired(recovered.id, recovered.previousEnabled);
  }
  const writeSnap = (): void => {
    const entries = normalizeInventory(inventory.list());
    writeFileSync(
      join(dir, "inventory-snapshot.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          entries,
          required: {
            credentials: entries.some(
              (e) =>
                rowMatches(e, "@deepseek-ai/dsh-credentials-local") &&
                rowLoaded(e),
            ),
            "plugin-center": entries.some(
              (e) => rowMatches(e, "@penglai/plugin-center") && rowLoaded(e),
            ),
            im: entries.some(
              (e) => rowMatches(e, "@penglai/im") && rowLoaded(e),
            ),
            smokeDisabled: !entries.some(
              (e) => rowMatches(e, "@penglai/plugin-smoke") && rowLoaded(e),
            ),
          },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const registry = officialService<
      NonNullable<OfficialUsableCtx["workspaceRegistry"]>
    >(ctx as typeof ctx & Record<string, unknown>, "workspaceRegistry");
    const protection = registry?.list
      ? workspaceProtectionSnapshot(registry.list())
      : {
          schema: 1 as const,
          complete: false,
          at: new Date().toISOString(),
          roots: [],
          errorClass: "DSH_UNAVAILABLE",
        };
    atomicJson(join(dir, "workspace-protection.json"), protection);
  };
  writeSnap();
  const timer = setInterval(writeSnap, 1_000);
  timer.unref?.();
  ctx.effect?.(() => () => clearInterval(timer));
  const txDir = join(userData, "profiles", "center-tx");
  const remote = createCenterRemote({
    host,
    inventory,
    catalog: catalog.entries,
    registry,
    lifecycle: {
      async apply(input) {
        const row = normalizeInventory(inventory.list()).find((entry) =>
          rowMatches(entry, input.id),
        );
        if (!row?.entryId) {
          await ctx.loader.resolve(input.id).update({ disabled: !input.enabled }, true, true);
          await ctx.loader.await();
          return;
        }
        const entry = ctx.loader.resolve(row.entryId);
        if (input.forceReload && input.enabled) {
          await entry.update({ disabled: true }, false, true);
        }
        await entry.update({ disabled: !input.enabled }, false, true);
        await ctx.loader.await();
      },
    },
    resourceProbe: (id) =>
      resourceProbeFrom(
        ctx as typeof ctx & Record<string, unknown>,
        inventory,
        id,
      ),
    profileDir,
    txDir,
    pluginsDir,
    userDataRoot: userData,
    async stagePackage(pkg) {
      const bytes = readFileSync(pkg.path);
      const catalogName = `${pkg.id.replace("@", "").replaceAll("/", "-")}-${pkg.version}.tgz`;
      writeFileSync(join(pluginsDir, catalogName), bytes, { mode: 0o600 });
    },
  });
  const welcomeAck = (): boolean => {
    try {
      const settings = join(userData, "dsh-home", "settings.yaml");
      return (
        existsSync(settings) &&
        readFileSync(settings, "utf8").includes("welcomeNoticeVersion")
      );
    } catch {
      return false;
    }
  };
  new PenglaiCenterRemote(ctx as never, remote);
  // Snapshot official services at apply. Later Typert calls must not re-read
  // fiber-scoped ctx.llm or the Models directory disappears from the wizard.
  const official = officialOnboardingContext(
    ctx as typeof ctx & Record<string, unknown>,
  );
  const onboarding = createPenglaiOnboardingRemoteImpl({
    dir: join(userData, "onboarding"),
    userDataRoot: userData,
    installRoots: installRootsFromEnv(),
    officialCatalog: () => wizardProviderCatalog(official.llm),
    officialWelcomeAck: welcomeAck,
    agents: official,
  });
  new PenglaiOnboardingRemote(ctx as never, onboarding);
  void releaseOnboardingTestWorkspaces(
    official.workspaceRegistry,
    join(userData, "onboarding"),
  ).catch(() => undefined);
  return host;
}

Object.assign(apply, { inject });
export default { name, inject, apply };
