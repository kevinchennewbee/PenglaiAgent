import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDshLocalDependencyMap,
  stringifyCanonicalJson,
  verifyDshLocalDependencyLock,
} from "./lib/dsh-local-dependency-map.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { ROOT } from "./lib/repo.mjs";

const write = process.argv.includes("--write");
const mapPath = join(ROOT, "docs/0.5.8/DSH_LOCAL_DEPENDENCY_MAP.json");
const map = buildDshLocalDependencyMap(ROOT);
const expectedMap = stringifyCanonicalJson(map);
const stringifyManifest = (value) => `${JSON.stringify(value, null, 2)}\n`;
const rootPackagePath = join(ROOT, "package.json");
const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
const preservedOverrides = {
  "@liustack/pptfast>sharp": "0.35.3",
  "exceljs>uuid": "11.1.1",
  "exceljs>unzipper": "0.12.5",
  "pptxgenjs>image-size": "workspace:*",
  "onnxruntime-node>adm-zip": "0.6.0",
};
const allOverrides = preservedOverrides;
delete rootPackage.pnpm;
rootPackage.packageManager = "pnpm@11.7.0";
rootPackage.engines.pnpm = "11.7.0";
const existingRootDevDependencies = rootPackage.devDependencies ?? {};
rootPackage.devDependencies = Object.fromEntries(
  Object.entries(existingRootDevDependencies).filter(([name]) => !name.startsWith("@deepseek-ai/")),
);
const workspaceYaml = [
  "packages:",
  "  - packages/*",
  "  - apps/*",
  "autoInstallPeers: true",
  "resolvePeersFromWorkspaceRoot: true",
  "strictPeerDependencies: false",
  "engineStrict: true",
  "ignoreScripts: true",
  "nodeLinker: hoisted",
  "packageImportMethod: copy",
  "overrides:",
  ...Object.entries(allOverrides).map(([name, value]) => `  '${name.replaceAll("'", "''")}': '${value.replaceAll("'", "''")}'`),
  "",
].join("\n");
const workspacePath = join(ROOT, "pnpm-workspace.yaml");

const localRows = new Map(map.packages.map((row) => [row.name, row]));
const runtimeIntegrationRoots = [
  "@deepseek-ai/dsh-api-remotes",
  "@deepseek-ai/dsh-client-ui-settings",
  "@deepseek-ai/dsh-client-ui-settings-general",
  "@deepseek-ai/dsh-client-ui-slots",
];
rootPackage.devDependencies = {
  ...rootPackage.devDependencies,
  ...Object.fromEntries(runtimeIntegrationRoots.map((name) => [name, localRows.get(name).version])),
};
rootPackage.devDependencies = Object.fromEntries(
  Object.entries(rootPackage.devDependencies).sort(([left], [right]) => left.localeCompare(right)),
);
const changedManifests = [];
for (const workspaceRoot of [join(ROOT, "apps"), join(ROOT, "packages")]) {
  if (!existsSync(workspaceRoot)) continue;
  for (const entry of readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(workspaceRoot, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    let changed = false;
    if (manifest.name === "@penglai/desktop") {
      const expectedDevDependencies = {
        ...Object.fromEntries(
          Object.entries(manifest.devDependencies ?? {}).filter(([name]) => !name.startsWith("@deepseek-ai/")),
        ),
      };
      if (JSON.stringify(manifest.devDependencies ?? {}) !== JSON.stringify(expectedDevDependencies)) {
        manifest.devDependencies = expectedDevDependencies;
        changed = true;
      }
    }
    for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        const row = localRows.get(name);
        if (!row) continue;
        const expected = row.version;
        if (manifest[field][name] !== expected) {
          manifest[field][name] = expected;
          changed = true;
        }
      }
    }
    if (changed) changedManifests.push({ path: manifestPath, bytes: stringifyManifest(manifest) });
  }
}

if (write) {
  writeFileSync(mapPath, expectedMap);
  writeFileSync(rootPackagePath, stringifyManifest(rootPackage));
  writeFileSync(workspacePath, workspaceYaml);
  for (const manifest of changedManifests) writeFileSync(manifest.path, manifest.bytes);
}

const actualMap = existsSync(mapPath) ? readFileSync(mapPath, "utf8") : "";
const actualRoot = readFileSync(rootPackagePath, "utf8");
const actualWorkspace = readFileSync(workspacePath, "utf8");
const rootMatches = actualRoot === stringifyManifest(rootPackage);
const workspaceMatches = actualWorkspace === workspaceYaml;
const manifestsMatch = changedManifests.length === 0 || write;
let lockResult;
let lockError;
try {
  lockResult = verifyDshLocalDependencyLock(readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8"), map);
} catch (error) {
  lockError = error instanceof Error ? error.message : String(error);
}
if (actualMap !== expectedMap || !rootMatches || !workspaceMatches || !manifestsMatch || lockError) {
  finish("FAIL", {
    command: "verify:dsh-local-dependencies",
    reason: "local DSH dependency map, root overrides, or direct workspace pins require regeneration",
    repair: "pnpm generate:dsh-local-dependencies",
    mapMatches: actualMap === expectedMap,
    rootMatches,
    workspaceMatches,
    changedManifests: changedManifests.map((entry) => entry.path),
    lockError,
  });
}

finish("PASS", {
  command: "verify:dsh-local-dependencies",
  sourceCommit: map.source.commit,
  dshVersion: map.source.version,
  packageCount: map.packageCount,
  resolvedPackageCount: lockResult.resolvedPackageCount,
  registryFallbackAllowed: false,
});
