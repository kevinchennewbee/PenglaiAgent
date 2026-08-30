import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const INVENTORY_PATH = "docs/0.5.8/DSH_MIGRATION_INVENTORY.json";
const SOURCE_TAG = "dsh-v0.1.2-alpha.1";
const SOURCE_COMMIT = "cd5ef8148158c3a752a658978873241fdf8e2bbc";
const SOURCE_TREE = "a712eec535b48badc4fefb4df5176a7002e4280b";
const RELEASE_DSH = "0.1.2-alpha.1";

const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relative) {
  return readFileSync(join(ROOT, relative), "utf8");
}

function readJson(relative) {
  return JSON.parse(read(relative));
}

function trackedCodeFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((path) => /^(?:apps|packages|scripts)\//.test(path))
    .filter((path) => /\.(?:c?js|mjs|json|tsx?)$/.test(path))
    .filter((path) => path !== "scripts/verify-058-migration-inventory.mjs")
    .filter((path) => path !== "scripts/verify-dsh-alpha-owner-remotes.mjs")
    .filter((path) => existsSync(join(ROOT, path)));
}

function countLiteral(text, token) {
  let count = 0;
  let cursor = 0;
  while (true) {
    const next = text.indexOf(token, cursor);
    if (next < 0) return count;
    count += 1;
    cursor = next + token.length;
  }
}

function observedFiles(files, tokens) {
  const observed = {};
  for (const path of files) {
    const text = read(path);
    const count = tokens.reduce((total, token) => total + countLiteral(text, token), 0);
    if (count > 0) observed[path] = count;
  }
  return observed;
}

function compareReferenceSet(name, expected, actual) {
  const expectedEntries = Object.entries(expected).sort(([a], [b]) => a.localeCompare(b));
  const actualEntries = Object.entries(actual).sort(([a], [b]) => a.localeCompare(b));
  if (JSON.stringify(expectedEntries) === JSON.stringify(actualEntries)) return;
  const expectedMap = new Map(expectedEntries);
  const actualMap = new Map(actualEntries);
  const missing = expectedEntries
    .filter(([path, count]) => actualMap.get(path) !== count)
    .map(([path, count]) => `${path}:${count}`);
  const unexpected = actualEntries
    .filter(([path, count]) => expectedMap.get(path) !== count)
    .map(([path, count]) => `${path}:${count}`);
  fail(`${name} reference inventory drifted; expected/missing=${missing.join(", ") || "none"}; observed/unexpected=${unexpected.join(", ") || "none"}`);
}

const inventory = readJson(INVENTORY_PATH);
if (inventory.schema !== 1) fail(`migration inventory schema is ${inventory.schema}, expected 1`);
if (inventory.sourceBaseline?.tag !== SOURCE_TAG) fail("migration inventory source tag drifted");
if (inventory.sourceBaseline?.commit !== SOURCE_COMMIT) fail("migration inventory source commit drifted");
if (inventory.sourceBaseline?.tree !== SOURCE_TREE) fail("migration inventory source tree drifted");
if (inventory.packagePlane?.activeProductPin !== RELEASE_DSH) fail("migration inventory product pin drifted");
if (inventory.packagePlane?.state !== "SOURCE_CLOSURE_INTEGRATED") {
  fail("migration inventory must expose the integrated fixed-source closure gate");
}

const files = trackedCodeFiles();
const legacyRuntime = "@deepseek-ai/dsh-client-runtime";
const manifestConsumers = files
  .filter((path) => path.endsWith("/package.json"))
  .filter((path) => read(path).includes(legacyRuntime))
  .sort();
const expectedManifestConsumers = [];
if (manifestConsumers.length !== 0) {
  fail(`client-runtime manifest set drifted: ${manifestConsumers.join(", ") || "none"}`);
}
for (const path of inventory.clientRuntimeMigratedPluginManifests ?? []) {
  const manifest = readJson(path);
  const inject = manifest.dsh?.client?.inject;
  const expected = [
    "@deepseek-ai/dsh-api-remotes",
    "@deepseek-ai/dsh-client-ui-slots",
    "@deepseek-ai/dsh-client-ui-settings",
    ...(manifest.name === "@penglai/plugin-center" ? ["@deepseek-ai/dsh-client-ui-settings-general"] : []),
  ];
  if (!Array.isArray(inject) || JSON.stringify(inject) !== JSON.stringify(expected)) {
    fail(`${path} does not declare the fixed alpha client injection graph`);
  }
}

const bridge = read("packages/dsh-bridge/src/rc2-owner-adapter.ts");
for (const operation of ["sessions?.create", "sessions?.models", "sessions?.selectModel"]) {
  if (!bridge.includes(operation)) fail(`rc.2 owner adapter no longer contains inventoried ApiProxy operation ${operation}`);
}
const ownerPorts = read("packages/dsh-bridge/src/owner-ports.ts");
for (const owner of ["DshAgentOwner", "DshWorkspaceOwner", "DshSessionOwner"]) {
  if (!ownerPorts.includes(`interface ${owner}`)) fail(`bridge owner port is missing ${owner}`);
}
const bridgePlugin = read("packages/dsh-bridge/src/plugin.ts");
if (bridgePlugin.includes("apiProxy?:") || bridgePlugin.includes("sessions?.create")) {
  fail("composition plugin reabsorbed the historical rc.2 ApiProxy contract");
}
const alphaAdapter = read("packages/dsh-bridge/src/alpha1-owner-adapter.ts");
for (const operation of ["controller.list", "controller.create", "controller.rename", "controller.modelCatalog", ".selectModel"]) {
  if (!alphaAdapter.includes(operation)) fail(`alpha owner adapter lost official operation ${operation}`);
}
if (alphaAdapter.includes("ctx.apiProxy")) fail("alpha owner adapter reintroduced removed ApiProxy");
for (const path of [
  ...(inventory.desktopSupervisor?.sourceFiles ?? []),
  ...(inventory.desktopSupervisor?.testFiles ?? []),
]) {
  if (!existsSync(join(ROOT, path))) fail(`supervisor inventory path is missing: ${path}`);
}
const runtimeSupervisor = read("packages/runtime/src/index.ts");
for (const contract of [
  "class EmbeddedDshSupervisor",
  "shouldRestartAfterExit",
  "spawnOwnedDshProcess",
  "readOwnedWindowsJobReport",
  "killIdentity",
  "reapDshOrphans",
]) {
  if (!runtimeSupervisor.includes(contract)) fail(`supervisor source lost characterized contract ${contract}`);
}

for (const path of [
  ...(inventory.memoryCurator?.sourceFiles ?? []),
  ...(inventory.memoryCurator?.testFiles ?? []),
]) {
  if (!existsSync(join(ROOT, path))) fail(`memory curator inventory path is missing: ${path}`);
}
const memoryIndex = read("packages/memory/src/index.ts");
const memoryPipeline = read("packages/memory/src/turn-pipeline.ts");
const memoryQueue = read("packages/memory/src/v2/internal-curator.ts");
const memoryCandidates = read("packages/memory/src/v2/candidates.ts");
const resourceBudgets = read("packages/contracts/src/index.ts");
const asrService = read("packages/asr/src/index.ts");
const ttsService = read("packages/moss-tts/src/service.ts");
const budgetIndex = read("packages/budget/src/index.ts");
const budgetLedger = read("packages/budget/src/ledger.ts");
const memoryManifest = readJson("packages/memory/package.json");
for (const contract of [
  "InternalCuratorQueue",
  "internalCuratorJobKey",
  "runOfficialLlmCurator",
  "turnAlreadyProcessed",
  "reserveAuxiliary",
  "settleAuxiliary",
  "releaseAuxiliary",
  'MemoryCuratorFailure("OUTPUT_INVALID", false)',
]) {
  if (!memoryIndex.includes(contract)) fail(`memory curator source lost ${contract}`);
}
if (memoryIndex.indexOf("opts.onClose?.();") > memoryIndex.indexOf("v2.close();")) {
  fail("memory curator teardown must publish cancellation audit before closing its store");
}
for (const contract of [
  "createUserMessage",
  "input.llm.stream",
  "tools: []",
  "maxTokens: 1200",
  "signal: input.signal",
  "curatorUsageTokens",
  "usageSeen",
]) {
  if (!memoryPipeline.includes(contract)) fail(`memory curator official LLM path lost ${contract}`);
}
for (const contract of [
  'PENGLAI_RESOURCE_JOB_BUDGETS["@penglai/memory"].totalJobs',
  "INTERNAL_CURATOR_TIMEOUT_MS = 45_000",
  "INTERNAL_CURATOR_MAX_ATTEMPTS = 2",
  "controller.abort()",
  "this.seenKeys",
  'code: "TIMEOUT", retry: true',
  "this.options.observe",
  "cancelledByClose",
]) {
  if (!memoryQueue.includes(contract)) fail(`memory curator queue lost ${contract}`);
}
for (const budget of [
  { owner: "@penglai/asr", active: 1, queued: 7, total: 8, source: asrService },
  { owner: "@penglai/memory", active: 1, queued: 7, total: 8, source: memoryQueue },
  { owner: "@penglai/moss-tts", active: 1, queued: 3, total: 4, source: ttsService },
]) {
  const escapedOwner = budget.owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declaration = new RegExp(
    `"${escapedOwner}"\\s*:\\s*Object\\.freeze\\(\\{\\s*activeJobs:\\s*${budget.active},\\s*queuedJobs:\\s*${budget.queued},\\s*totalJobs:\\s*${budget.total}`,
  );
  if (!declaration.test(resourceBudgets)) {
    fail(`${budget.owner} shared job budget drifted from ${budget.active}+${budget.queued}=${budget.total}`);
  }
  if (!budget.source.includes(`PENGLAI_RESOURCE_JOB_BUDGETS["${budget.owner}"].totalJobs`)) {
    fail(`${budget.owner} service no longer consumes the shared job budget`);
  }
}
for (const contract of ["CURATOR_AUDIT_MAX_ROWS = 256", "recordCuratorAudit", "operationDigest"]) {
  if (!memoryCandidates.includes(contract)) fail(`memory curator audit lost ${contract}`);
}
for (const contract of ["reserveAuxiliary", "settleAuxiliary", "releaseAuxiliary"]) {
  if (!budgetIndex.includes(contract)) fail(`budget auxiliary service lost ${contract}`);
}
for (const contract of ["releaseReservation", "budget_releases"]) {
  if (!budgetLedger.includes(contract)) fail(`budget auxiliary ledger lost ${contract}`);
}
for (const forbidden of ["agents.create", 'origin: "subagent"', "penglai-memory-curator-"]) {
  if (memoryIndex.includes(forbidden)) fail(`memory curator reintroduced user-visible lifecycle: ${forbidden}`);
}
if (memoryManifest.dependencies?.["@deepseek-ai/dsh-llm"] !== RELEASE_DSH) {
  fail("memory official LLM dependency is not on the fixed alpha source package");
}
if (!read("packages/dsh-bridge/src/r56-memory-curator-spike.ts").includes('alphaJobsDecision: "REJECT_USER_VISIBLE"')) {
  fail("memory curator spike no longer records why alpha.1 Jobs are rejected");
}

if (failures.length > 0) {
  console.error(JSON.stringify({
    schema: 1,
    gate: "Penglai-0.5.8-migration-inventory",
    result: "FAIL",
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema: 1,
  gate: "Penglai-0.5.8-migration-inventory",
  result: "PASS",
  sourceBaseline: inventory.sourceBaseline,
  productDshPin: inventory.packagePlane.activeProductPin,
  preMigrationReferenceFiles: Object.fromEntries(
    Object.entries(inventory.preMigrationObservedReferences ?? {}).map(([name, seam]) => [name, Object.keys(seam.files).length]),
  ),
  clientRuntimePluginManifests: expectedManifestConsumers.length,
  supervisorEvidence: inventory.desktopSupervisor.state,
  memoryCuratorEvidence: inventory.memoryCurator.state,
}, null, 2));
