import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import { assertUpdateManifest, compareSemver, nextUpdateState, verifyPayload } from "./update.js";
import { assertSafeDeletePath, buildDeletionPlan } from "./uninstall.js";

const POSIX_INSPECTION = { platform: "darwin" as const };
const portable = (path: string) => path.replace(/\\/g, "/");

test("R50-UPD-001/002/004 assisted update rejects mutable latest URL downgrade and unsigned payload", () => {
  assert.throws(
    () =>
      assertUpdateManifest(
        {
          schemaVersion: 1,
          channel: "desktop-v0.5",
          version: "0.5.0",
          minimumVersion: "0.5.0",
          platforms: {
            "darwin-aarch64": { url: "https://example.com/releases/latest/x.dmg", sha256: "a".repeat(64), size: 1 },
          },
        },
        "0.5.0",
        "darwin-aarch64",
      ),
    /latest|same-version|downgrade|mutable/,
  );
  assert.equal(compareSemver("0.5.1", "0.5.0"), 1);
  assert.equal(nextUpdateState("IDLE", "check"), "CHECKING");
  assert.throws(() => nextUpdateState("IDLE", "confirm"), PenglaiError);
});

test("payload signature and hash are both required", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPub = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const payload = Buffer.from("penglai-update");
  const sha = createHash("sha256").update(payload).digest("hex");
  const sig = sign(null, payload, privateKey);
  verifyPayload(payload, sha, sig, Buffer.from(rawPub).toString("hex"));
  assert.throws(() => verifyPayload(payload, "0".repeat(64), sig, Buffer.from(rawPub).toString("hex")), /hash/);
});

test("R50-UPD-005/007/011 staging is not executable and journal drains before handoff", async () => {
  const { statSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const {
    assertStagingNotExecutable,
    writeUpdateJournal,
    nextUpdateState,
    assertProductionHasNoFixtureKey,
  } = await import("./update.js");
  assert.throws(() => assertStagingNotExecutable(0o755), /not be executable/);
  assertStagingNotExecutable(0o600);
  const dir = mkdtempSync(join(tmpdir(), "penglai-upd-"));
  const dest = writeUpdateJournal(dir, {
    operationId: "op-1",
    state: "DRAINING_DSH",
    version: "0.5.1",
    drained: true,
  });
  assert.equal(statSync(dest).mode & 0o111, 0);
  let state = nextUpdateState("IDLE", "check");
  state = nextUpdateState(state, "found");
  state = nextUpdateState(state, "download");
  state = nextUpdateState(state, "verify");
  state = nextUpdateState(state, "confirm");
  state = nextUpdateState(state, "confirm");
  state = nextUpdateState(state, "drain");
  state = nextUpdateState(state, "handoff");
  assert.equal(nextUpdateState(state, "commit"), "COMMITTED");
  assert.throws(() => assertProductionHasNoFixtureKey("PENGLAI_FIXTURE_UPDATER_PRIVATE=abc"), /fixture updater/);
});

test("R50-UN-002/009 legacy detector is read-only and locked delete stops", async (context) => {
  const { mkdirSync, writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { detectLegacy, executeDeletionPlan, buildDeletionPlan } = await import("./uninstall.js");
  const root = mkdtempSync(join(tmpdir(), "penglai-legacy-"));
  writeFileSync(join(root, "version"), "0.4.1\n");
  const seen = detectLegacy(root);
  assert.equal(seen.present, true);
  assert.equal(seen.version, "0.4.1");
  const cache = join(root, "cache");
  mkdirSync(cache);
  writeFileSync(join(cache, "keep.txt"), "x");
  const plan = buildDeletionPlan({
    operationId: "del-1",
    categories: ["cache"],
    userData: root,
    confirmCredentials: false,
  });
  const out = executeDeletionPlan(plan, root, [], [], POSIX_INSPECTION);
  assert.equal(out.deleted.length, 1);
  const { symlinkSync, rmSync } = await import("node:fs");
  const link = join(root, "im");
  try {
    symlinkSync(cache, link, process.platform === "win32" ? "junction" : undefined);
  } catch (error) {
    if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    context.skip("Windows account cannot create a directory link without Developer Mode or elevation");
    return;
  }
  const imPlan = buildDeletionPlan({
    operationId: "del-2",
    categories: ["im"],
    userData: root,
    confirmCredentials: false,
  });
  assert.throws(() => executeDeletionPlan(imPlan, root, [], [], POSIX_INSPECTION), /symlink|locked or permission/);
  rmSync(link, { force: true });
});

test("R50-UN-005/007/008 deletion plan is exact and refuses escapes", () => {
  assert.throws(
    () => buildDeletionPlan({ operationId: "op", categories: ["credentials"], userData: "/tmp/Penglai/0.5", confirmCredentials: false }),
    /second confirm/,
  );
  const plan = buildDeletionPlan({
    operationId: "op-2",
    categories: ["cache", "im"],
    userData: "/tmp/Penglai/0.5",
    confirmCredentials: false,
  });
  assert.equal(plan.paths.length, 2);
  assert.ok(plan.paths.every((p) => portable(p).includes("/tmp/Penglai/0.5/")));
  assert.throws(() => assertSafeDeletePath("/", "/tmp/Penglai/0.5", [], []), /root|home|drive/);
  assert.throws(
    () => assertSafeDeletePath("/tmp/ws-project", "/tmp/Penglai/0.5", ["/tmp/ws-project"], []),
    /workspace/,
  );
  assert.throws(
    () => assertSafeDeletePath("/tmp/legacy-041", "/tmp/Penglai/0.5", [], ["/tmp/legacy-041"]),
    /legacy/,
  );
});

test("R50-UN: voice/memory/budget/companion categories never resolve to whole userData", () => {
  const plan = buildDeletionPlan({
    operationId: "op-cat",
    categories: ["asr-models", "tts-models", "local-voices", "voice-temp", "context-indexes", "memory", "budget", "companion"],
    userData: "/tmp/Penglai/0.5",
    confirmCredentials: false,
    confirmSensitive: true,
  });
  assert.equal(plan.paths.length, 8);
  assert.ok(plan.paths.every((p) => portable(p).includes("/tmp/Penglai/0.5/") && !portable(p).endsWith("/tmp/Penglai/0.5")));
  assert.ok(plan.paths.some((p) => portable(p).endsWith("/voice/models/asr")));
  assert.ok(plan.paths.some((p) => portable(p).endsWith("/memory")));
  assert.throws(
    () =>
      buildDeletionPlan({
        operationId: "op-mem",
        categories: ["memory"],
        userData: "/tmp/Penglai/0.5",
        confirmCredentials: false,
      }),
    /sensitive|second confirm/,
  );
});

test("deletion plan refuses workspace legacy symlink and unconfirmed credentials", () => {
  assert.throws(
    () => buildDeletionPlan({ operationId: "op", categories: ["credentials"], userData: "/tmp/Penglai/0.5", confirmCredentials: false }),
    /second confirm/,
  );
  const plan = buildDeletionPlan({
    operationId: "op",
    categories: ["cache"],
    userData: "/tmp/Penglai/0.5",
    confirmCredentials: false,
  });
  assert.ok(portable(plan.paths[0] ?? "").includes("/cache"));
  assert.throws(
    () => assertSafeDeletePath("/tmp/ws-project", "/tmp/Penglai/0.5", ["/tmp/ws-project"], []),
    /workspace/,
  );
  assert.throws(
    () => assertSafeDeletePath("/tmp/legacy-041", "/tmp/Penglai/0.5", [], ["/tmp/legacy-041"]),
    /legacy/,
  );
});

test("R50-UN-006/007 deletion capability binds type count owner and tree digest", async () => {
  const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { DeletionAuthorizer, previewDeletionPlan } = await import("./uninstall.js");
  const root = mkdtempSync(join(tmpdir(), "penglai-delete-cap-"));
  const cache = join(root, "cache");
  const journal = join(root, "uninstall");
  mkdirSync(cache);
  writeFileSync(join(cache, "one.txt"), "one");
  const plan = buildDeletionPlan({
    operationId: "delete-capability-1",
    categories: ["cache"],
    userData: root,
    confirmCredentials: false,
  });
  const preview = previewDeletionPlan(plan, root, [], [], POSIX_INSPECTION);
  assert.equal(preview.targets[0]?.type, "directory");
  assert.equal(preview.targets[0]?.entryCount, 2);
  assert.match(preview.targets[0]?.treeSha256 ?? "", /^[a-f0-9]{64}$/);
  const auth = new DeletionAuthorizer(root, [], [], journal, POSIX_INSPECTION);
  auth.prepare(plan);
  writeFileSync(join(cache, "two.txt"), "two");
  assert.throws(() => auth.execute(plan.operationId), /changed after confirmation/);
  assert.throws(() => auth.execute(plan.operationId), /consumed/);
  const stopped = JSON.parse(readFileSync(join(journal, "deletion-journal.json"), "utf8")) as { state: string };
  assert.equal(stopped.state, "stopped");
});

test("nested symlinks and overlapping category plans are rejected before deletion", async (context) => {
  const { mkdirSync, mkdtempSync, symlinkSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { previewDeletionPlan } = await import("./uninstall.js");
  const root = mkdtempSync(join(tmpdir(), "penglai-delete-link-"));
  const cache = join(root, "cache");
  mkdirSync(cache);
  let symlinkAvailable = true;
  try {
    symlinkSync(root, join(cache, "escape"), process.platform === "win32" ? "junction" : undefined);
  } catch (error) {
    if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    symlinkAvailable = false;
    context.diagnostic("Windows account cannot create a directory link without Developer Mode or elevation");
  }
  const plan = buildDeletionPlan({
    operationId: "delete-nested-link",
    categories: ["cache"],
    userData: root,
    confirmCredentials: false,
  });
  if (symlinkAvailable) {
    assert.throws(() => previewDeletionPlan(plan, root, [], [], POSIX_INSPECTION), /symlink|reparse/);
  }
  assert.throws(
    () => buildDeletionPlan({
      operationId: "delete-overlap",
      categories: ["dsh", "settings"],
      userData: root,
      confirmCredentials: false,
    }),
    /overlapping/,
  );
  assert.throws(
    () => previewDeletionPlan(plan, root, [], [], { platform: "win32" }),
    /native owner and reparse-point probes/,
  );
});

test("managed layout keeps settings DSH credentials memory and cache as disjoint exact targets", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { inspectStorageInventory, previewDeletionPlan } = await import("./uninstall.js");
  const root = mkdtempSync(join(tmpdir(), "penglai-layout-user-"));
  const cacheRoot = mkdtempSync(join(tmpdir(), "penglai-layout-cache-"));
  const logsRoot = mkdtempSync(join(tmpdir(), "penglai-layout-logs-"));
  const dataLayout = { userData: root, cacheRoot, logsRoot };
  const plan = buildDeletionPlan({
    operationId: "managed-layout",
    categories: ["cache", "settings", "dsh", "credentials", "memory"],
    userData: root,
    confirmCredentials: true,
    confirmSensitive: true,
    dataLayout,
  });
  assert.ok(plan.paths.length > plan.categories.length);
  assert.equal(new Set(plan.paths).size, plan.paths.length);
  assert.equal(plan.paths.some((path) => path === join(root, "dsh-home")), false);
  assert.equal(plan.paths.includes(join(root, "dsh-home", ".credentials.yaml")), true);
  assert.equal(plan.paths.includes(join(root, "dsh-home", "storages")), true);
  assert.equal(plan.paths.includes(join(root, "dsh-home", "skills")), true);
  assert.equal(plan.paths.includes(cacheRoot), true);
  assert.equal(plan.paths.includes(logsRoot), true);
  const preview = previewDeletionPlan(plan, root, [], [], { ...POSIX_INSPECTION, dataLayout });
  assert.equal(preview.targets.length, plan.paths.length);
  assert.equal(preview.targets.every((target) => target.category.length > 0), true);
  const inventory = inspectStorageInventory(dataLayout, [], [], { ...POSIX_INSPECTION, dataLayout });
  assert.equal(inventory.categories.length, 13);
  assert.equal(inventory.categories.every((category) => category.deletable), true);

  const workspaceInsideDsh = join(root, "dsh-home", "storages", "workspace-source");
  assert.throws(
    () => previewDeletionPlan(plan, root, [workspaceInsideDsh], [], { ...POSIX_INSPECTION, dataLayout }),
    /workspace never deleted/,
  );
});
