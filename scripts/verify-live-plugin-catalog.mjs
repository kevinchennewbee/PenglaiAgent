import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finish } from "./lib/exit-contract.mjs";
import { PluginDistributionClient } from "../packages/plugin-registry/src/index.ts";
import { createCenterRemote } from "../packages/plugin-center/src/remotes.ts";
import {
  issuePluginOwnerGrant,
  pluginPermissionDigest,
} from "../packages/runtime/src/index.ts";

const expectedTag = process.argv[2] || "plugin-catalog-v1.000005";
const expectedPlugin = process.argv[3] || "@penglai/office-reader";
const expectedSequenceMatch = /^plugin-catalog-v1\.(\d{6})$/.exec(expectedTag);
if (!expectedSequenceMatch) throw new Error("expected catalog tag is invalid");
const expectedSequence = Number(expectedSequenceMatch[1]);
const root = mkdtempSync(join(tmpdir(), "penglai-live-plugin-catalog-"));
const githubToken = process.env.GITHUB_TOKEN?.trim();
const authenticatedGithubApiFetch = async (input, init = {}) => {
  const requestUrl = new URL(input instanceof Request ? input.url : String(input));
  if (!githubToken || requestUrl.hostname !== "api.github.com") {
    return fetch(input, init);
  }
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  headers.set("authorization", `Bearer ${githubToken}`);
  headers.set("x-github-api-version", "2022-11-28");
  return fetch(input, { ...init, headers });
};
const shared = {
  cacheRoot: join(root, "cas"),
  trustPath: join(root, "trust-state.json"),
  lastGoodPath: join(root, "last-good-catalog.json"),
  penglaiVersion: "0.5.5",
  dshExact: "0.1.1-rc.2",
  target: "darwin-aarch64",
  fetchImpl: authenticatedGithubApiFetch,
};

let record;
try {
  const online = new PluginDistributionClient(shared);
  const snapshot = await online.refresh();
  const entry = snapshot.catalog.entries.find((row) => row.id === expectedPlugin);
  if (!entry) throw new Error(`signed catalog is missing ${expectedPlugin}`);
  const pkg = await online.downloadPackage(expectedPlugin);
  const userDataRoot = join(root, "user-data");
  const profileDir = join(userDataRoot, "dsh-home", "profiles", "web");
  const txDir = join(userDataRoot, "profiles", "center-tx");
  const bundledPluginsDir = join(root, "bundled-plugins");
  const registryPackagesDir = join(userDataRoot, "plugins", "packages");
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  mkdirSync(bundledPluginsDir, { recursive: true, mode: 0o700 });
  mkdirSync(registryPackagesDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(profileDir, "cordis.patch.yml"), "# live signed catalog install\n", { mode: 0o600 });

  const desired = {};
  let installed = false;
  let enabled = false;
  const inventory = {
    list: () =>
      installed
        ? [
            {
              entryId: expectedPlugin.replace(/^@/, "").replaceAll("/", "-"),
              moduleName: entry.id,
              disabled: !enabled,
              enabled,
              fiberPhase: enabled ? "active" : null,
            },
          ]
        : [],
  };
  const host = {
    reconcile: () => [],
    desired: () => ({ ...desired }),
    setDesired: (id, value) => {
      desired[id] = value;
    },
    entries: () => [],
  };
  const remote = createCenterRemote({
    host,
    inventory,
    catalog: [],
    registry: online,
    lifecycle: {
      async apply(input) {
        installed = true;
        enabled = input.enabled;
      },
    },
    resourceProbe: () => ({
      snapshot: () => ({
        workers: 0,
        sockets: 0,
        timers: 0,
        remotes: 0,
        db: 0,
        modelSessions: 0,
        audioHandles: 0,
      }),
    }),
    profileDir,
    txDir,
    pluginsDir: bundledPluginsDir,
    registryPackagesDir,
    userDataRoot,
    target: "darwin-aarch64",
  });
  const grant = issuePluginOwnerGrant({
    userDataRoot,
    action: "plugin-install",
    pluginId: entry.id,
    version: entry.version,
    sha256: pkg.sha256,
    permissionDigest: pluginPermissionDigest({
      permissions: entry.permissions,
      networkOrigins: entry.networkOrigins,
      dataPaths: entry.dataPaths,
      nativeCode: entry.nativeCode,
    }),
  });
  const installedResult = await remote.installDisabled(entry.id, grant.capabilityId);
  const installedManifestPath = join(
    profileDir,
    "node_modules",
    ...entry.id.split("/"),
    "package.json",
  );
  const installedManifest = JSON.parse(readFileSync(installedManifestPath, "utf8"));
  const installedPatch = readFileSync(join(profileDir, "cordis.patch.yml"), "utf8");
  const journal = JSON.parse(readFileSync(join(txDir, "journal.json"), "utf8"));
  const installOk = Boolean(
    installedResult.installed === true &&
      installedResult.enabled === false &&
      installedResult.phase === "committed" &&
      installedManifest.name === entry.id &&
      installedManifest.version === entry.version &&
      installedPatch.includes(`name: "${entry.id}"`) &&
      /disabled:\s+true/.test(installedPatch) &&
      desired[entry.id] === false &&
      inventory.list()[0]?.enabled === false &&
      journal.phase === "committed" &&
      existsSync(join(registryPackagesDir, `${entry.id.replace("@", "").replaceAll("/", "-")}-${entry.version}.tgz`)) &&
      !existsSync(join(bundledPluginsDir, `${entry.id.replace("@", "").replaceAll("/", "-")}-${entry.version}.tgz`)) &&
      !existsSync(join(txDir, "active.lock")) &&
      !existsSync(join(userDataRoot, "plugins", "owner-capability.json")),
  );
  const offline = new PluginDistributionClient({
    ...shared,
    fetchImpl: async () => {
      throw new Error("offline verification path");
    },
  });
  const lastGood = await offline.refresh();
  const ok = Boolean(
    (snapshot.source === "github-immutable" || snapshot.source === "github-signed-tag-fallback") &&
      snapshot.tag === expectedTag &&
      snapshot.sequence === expectedSequence &&
      snapshot.signatureOk &&
      entry?.defaultEnabled === false &&
      entry.nativeCode === false &&
      entry.dsh.exact === "0.1.1-rc.2" &&
      pkg.id === entry.id &&
      pkg.version === entry.version &&
      pkg.sha256 === entry.artifacts[0]?.sha256 &&
      pkg.manifest.id === entry.id &&
      pkg.manifest.version === entry.version &&
      pkg.files.includes("package/index.js") &&
      pkg.files.includes("package/package.json") &&
      installOk &&
      lastGood.source === "last-good-offline" &&
      lastGood.sequence === snapshot.sequence &&
      lastGood.digest === snapshot.digest &&
      lastGood.signatureOk,
  );
  record = {
    command: "verify-live-plugin-catalog",
    verdict: ok ? "PASS" : "FAIL",
    source: snapshot.source,
    tag: snapshot.tag,
    sequence: snapshot.sequence,
    digest: snapshot.digest,
    signatureOk: snapshot.signatureOk,
    plugin: {
      id: pkg.id,
      version: pkg.version,
      sha256: pkg.sha256,
      size: pkg.size,
      defaultEnabled: entry?.defaultEnabled,
      nativeCode: entry?.nativeCode,
      dsh: entry?.dsh.exact,
      files: pkg.files,
    },
    installDisabled: {
      committed: installOk,
      installed: installedResult.installed,
      enabled: installedResult.enabled,
      phase: installedResult.phase,
      manifestName: installedManifest.name,
      manifestVersion: installedManifest.version,
      desired: desired[entry.id],
      inventoryEnabled: inventory.list()[0]?.enabled,
      capabilityConsumed: !existsSync(join(userDataRoot, "plugins", "owner-capability.json")),
    },
    offlineLastGood: {
      source: lastGood.source,
      sequence: lastGood.sequence,
      digest: lastGood.digest,
      signatureOk: lastGood.signatureOk,
    },
  };
} catch (error) {
  record = {
    command: "verify-live-plugin-catalog",
    verdict: "FAIL",
    reason: error instanceof Error ? error.message : String(error),
  };
} finally {
  rmSync(root, { recursive: true, force: true });
}

finish(record.verdict, record);
