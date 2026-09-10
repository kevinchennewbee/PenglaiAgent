import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import { OwnerApprovalBroker } from "@penglai/runtime";
import { hostMnemonTarget, resolveMnemonBinary, sha256File } from "./engine/mnemon-provider.js";
import { workspaceDataDir } from "./engine/service.js";
import { createTestMnemonBinary } from "./engine/test-binary.js";
import { createDurableMemoryService } from "./index.js";
import { CANDIDATE_KINDS, type CandidateKind } from "./v2/governance.js";
import { nativeCategoryForCandidateKind } from "./v2/native-category.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PRIOR_PHASE_MATERIALIZATION_EVIDENCE = "/tmp/penglai-061-memory-materialization-evidence";
const fakeBinaryPath = createTestMnemonBinary();
let cachedMaterializationEvidenceDir: string | undefined;

function materializationEvidenceDir(): string {
  if (cachedMaterializationEvidenceDir) return cachedMaterializationEvidenceDir;
  const selected = process.env.PENGLAI_MEMORY_MATERIALIZATION_EVIDENCE_DIR?.trim();
  if (selected) {
    const resolved = resolve(selected);
    if (resolved === resolve(PRIOR_PHASE_MATERIALIZATION_EVIDENCE)) {
      throw new Error("refusing to overwrite prior-phase memory materialization evidence");
    }
    cachedMaterializationEvidenceDir = resolved;
    return cachedMaterializationEvidenceDir;
  }
  cachedMaterializationEvidenceDir = mkdtempSync(join(tmpdir(), "penglai-mem-materialization-evidence-"));
  return cachedMaterializationEvidenceDir;
}

const inertSkills = { snapshot: async () => ({ skills: [] as Array<{ name: string }>, complete: true }) };

const KIND_FIXTURES: Array<{ kind: CandidateKind; text: string }> = [
  { kind: "preference", text: "Prefer compact diffs in this workspace" },
  { kind: "project_fact", text: "This workspace uses pnpm for package management" },
  { kind: "decision", text: "Keep the official DSH runtime as the only core" },
  { kind: "constraint", text: "Do not enable telemetry in this workspace" },
  { kind: "person_fact", text: "The maintainer of this workspace uses Simplified Chinese" },
];

const PERSONAL_TEXT = "Prefer short commit titles in personal memory";

function resolvePinnedMnemon(): { path: string; sha256: string; target: string } | undefined {
  const asset = hostMnemonTarget();
  if (!asset) return undefined;
  const candidates = [
    join(REPO_ROOT, "third_party", "mnemon", "bin", asset.target, asset.binaryFilename),
    join(REPO_ROOT, "dist", "Penglai-v0.6.1-arm64", "Penglai.app", "Contents", "Resources", "mnemon", "mnemon"),
  ];
  for (const explicitPath of candidates) {
    if (!existsSync(explicitPath)) continue;
    if (sha256File(explicitPath) !== asset.binarySha256) continue;
    return resolveMnemonBinary({ explicitPath, verifyHash: true });
  }
  return undefined;
}

function durable(
  root: string,
  extra: { binaryPath: string; allowUnpinnedTestBinary?: boolean },
) {
  const owner = new OwnerApprovalBroker(root, { dialog: async () => "approved" });
  const svc = createDurableMemoryService({
    userData: root,
    skills: inertSkills,
    owner,
    binaryPath: extra.binaryPath,
    ...(extra.allowUnpinnedTestBinary === true ? { allowUnpinnedTestBinary: true } : {}),
  });
  svc.setMemoryMode("suggest");
  return { svc, owner };
}

function enqueue(
  svc: ReturnType<typeof createDurableMemoryService>,
  input: { workspaceId: string; kind: CandidateKind; text: string; turnId: string },
) {
  const sourceDigest = createHash("sha256")
    .update(`${input.workspaceId}:${input.turnId}:${input.kind}:${input.text}`)
    .digest("hex");
  const row = svc.memoryV2.enqueue({
    workspaceId: input.workspaceId,
    sessionId: "s-factory",
    turnId: input.turnId,
    kind: input.kind,
    text: input.text,
    rationale: `neutral ${input.kind}`,
    confidence: 0.91,
    sourceDigest,
  });
  assert.equal("candidateId" in row, true);
  if (!("candidateId" in row)) throw new Error("expected candidate");
  return row;
}

async function ownerAccept(
  svc: ReturnType<typeof createDurableMemoryService>,
  owner: OwnerApprovalBroker,
  input: { candidateId: string; workspaceId: string; personal?: boolean },
) {
  const proposed = svc.proposeAction({
    action: input.personal === true ? "memory.personal" : "memory.accept",
    objectId: input.candidateId,
    workspaceId: input.workspaceId,
  });
  const decided = await owner.requestOwnerApproval(proposed.actionId);
  assert.equal(decided.decision, "approved");
  if (decided.decision !== "approved") throw new Error("expected receipt");
  const accepted = await svc.acceptCandidate({
    candidateId: input.candidateId,
    actionId: proposed.actionId,
    receipt: decided.receipt,
    ...(input.personal === true ? { personal: true } : {}),
  });
  return { proposed, decided, accepted };
}

interface FactoryKindRow {
  kind: CandidateKind;
  text: string;
  nativeCategory: string;
  candidateId: string;
  memoryId: string;
  status: string;
  journalKindTag: string;
  journalSource: string;
  nativeCategoryObserved: string | undefined;
}

async function replayEveryKind(
  extra: { binaryPath: string; allowUnpinnedTestBinary?: boolean },
): Promise<{
  root: string;
  rows: FactoryKindRow[];
  personalMemoryId: string;
}> {
  assert.deepEqual(KIND_FIXTURES.map((row) => row.kind), [...CANDIDATE_KINDS]);
  const root = mkdtempSync(join(tmpdir(), "penglai-mem-factory-"));
  const { svc, owner } = durable(root, extra);
  const rows: FactoryKindRow[] = [];
  try {
    for (const [index, fixture] of KIND_FIXTURES.entries()) {
      const pending = enqueue(svc, {
        workspaceId: "ws-a",
        kind: fixture.kind,
        text: fixture.text,
        turnId: `t-${index + 1}`,
      });
      assert.equal(pending.status, "pending");
      assert.equal(pending.kind, fixture.kind);
      const { proposed, accepted } = await ownerAccept(svc, owner, {
        candidateId: pending.candidateId,
        workspaceId: "ws-a",
      });
      assert.equal(owner.inspect(proposed.actionId).state, "committed");
      const stored = svc.memoryV2.getCandidate(pending.candidateId);
      assert.ok(stored);
      assert.equal(stored.status, "accepted");
      assert.equal(stored.kind, fixture.kind);
      const journal = svc.engine.journal.get(accepted.memoryId);
      assert.ok(journal);
      assert.equal(journal.scope, "workspace");
      assert.equal(journal.workspaceId, "ws-a");
      assert.equal(journal.source, "auto-curator");
      assert.match(journal.tags, new RegExp(`kind:${fixture.kind}`));
      const hits = await svc.search(fixture.text, "ws-a");
      const hit = hits.find((row) => row.id === accepted.memoryId) as { category?: string } | undefined;
      assert.ok(hit);
      assert.equal(hit.category, nativeCategoryForCandidateKind(fixture.kind));
      assert.equal((await svc.search(fixture.text, "ws-b")).some((row) => row.id === accepted.memoryId), false);
      rows.push({
        kind: fixture.kind,
        text: fixture.text,
        nativeCategory: nativeCategoryForCandidateKind(fixture.kind),
        candidateId: pending.candidateId,
        memoryId: accepted.memoryId,
        status: stored.status,
        journalKindTag: journal.tags,
        journalSource: journal.source,
        nativeCategoryObserved: hit.category,
      });
    }

    const personalPending = enqueue(svc, {
      workspaceId: "ws-a",
      kind: "preference",
      text: PERSONAL_TEXT,
      turnId: "t-personal",
    });
    const personal = await ownerAccept(svc, owner, {
      candidateId: personalPending.candidateId,
      workspaceId: "ws-a",
      personal: true,
    });
    assert.equal(svc.memoryV2.getCandidate(personalPending.candidateId)?.kind, "preference");
    assert.equal(svc.engine.journal.get(personal.accepted.memoryId)?.scope, "personal");
    assert.equal(svc.engine.journal.get(personal.accepted.memoryId)?.source, "owner-accepted-curator");
    assert.equal((await svc.search(PERSONAL_TEXT)).some((row) => row.id === personal.accepted.memoryId), true);
    assert.equal((await svc.search(PERSONAL_TEXT, "ws-a")).some((row) => row.id === personal.accepted.memoryId), false);

    svc.close();
    const restarted = durable(root, extra);
    try {
      for (const row of rows) {
        assert.equal(restarted.svc.memoryV2.getCandidate(row.candidateId)?.kind, row.kind);
        assert.equal(restarted.svc.memoryV2.getCandidate(row.candidateId)?.status, "accepted");
        assert.equal((await restarted.svc.search(row.text, "ws-a")).some((hit) => hit.id === row.memoryId), true);
        assert.equal((await restarted.svc.search(row.text, "ws-b")).some((hit) => hit.id === row.memoryId), false);
      }
      assert.equal((await restarted.svc.search(PERSONAL_TEXT)).some((hit) => hit.id === personal.accepted.memoryId), true);
    } finally {
      restarted.svc.close();
    }
    return { root, rows, personalMemoryId: personal.accepted.memoryId };
  } catch (error) {
    svc.close();
    throw error;
  }
}

test("factory materializes every CandidateKind through Owner proof on the fake engine", async () => {
  const replayed = await replayEveryKind({ binaryPath: fakeBinaryPath, allowUnpinnedTestBinary: true });
  assert.equal(replayed.rows.length, CANDIDATE_KINDS.length);
});

test("failed native write leaves the candidate pending for an explicit fresh Owner retry", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-mem-factory-retry-"));
  const { svc, owner } = durable(root, { binaryPath: fakeBinaryPath, allowUnpinnedTestBinary: true });
  try {
    const pending = enqueue(svc, {
      workspaceId: "ws-a",
      kind: "project_fact",
      text: "Retry after a failed native write must not strand this candidate",
      turnId: "t-retry",
    });
    const proposed = svc.proposeAction({
      action: "memory.accept",
      objectId: pending.candidateId,
      workspaceId: "ws-a",
    });
    const decided = await owner.requestOwnerApproval(proposed.actionId);
    assert.equal(decided.decision, "approved");
    if (decided.decision !== "approved") throw new Error("expected receipt");
    const originalRemember = svc.engine.remember.bind(svc.engine);
    svc.engine.remember = (async () => {
      throw new PenglaiError("DSH_UNAVAILABLE", "mnemon remember failed");
    }) as typeof svc.engine.remember;
    await assert.rejects(
      () =>
        svc.acceptCandidate({
          candidateId: pending.candidateId,
          actionId: proposed.actionId,
          receipt: decided.receipt,
        }),
      /mnemon remember failed/,
    );
    svc.engine.remember = originalRemember;
    assert.equal(svc.memoryV2.getCandidate(pending.candidateId)?.status, "pending");
    assert.equal(svc.memoryV2.getCandidate(pending.candidateId)?.kind, "project_fact");
    assert.equal(owner.inspect(proposed.actionId).state, "reserved");
    await assert.rejects(
      () =>
        svc.acceptCandidate({
          candidateId: pending.candidateId,
          actionId: proposed.actionId,
          receipt: decided.receipt,
        }),
      /REPLAY|PROPOSAL_STATE/,
    );
    const retried = await ownerAccept(svc, owner, {
      candidateId: pending.candidateId,
      workspaceId: "ws-a",
    });
    assert.equal(retried.accepted.status, "accepted");
    assert.equal(svc.memoryV2.getCandidate(pending.candidateId)?.kind, "project_fact");
    const hits = await svc.search(pending.text, "ws-a");
    assert.equal(hits.some((row) => row.id === retried.accepted.memoryId), true);
    assert.equal((hits.find((row) => row.id === retried.accepted.memoryId) as { category?: string } | undefined)?.category, "fact");
    assert.equal(owner.inspect(retried.proposed.actionId).state, "committed");
  } finally {
    svc.close();
  }
});

const pinned = resolvePinnedMnemon();
const requirePinnedHost = process.platform === "darwin" && process.arch === "arm64";

test("pinned Mnemon factory materializes every CandidateKind without an unpinned binary", { skip: requirePinnedHost ? false : !pinned }, async () => {
  assert.ok(pinned, `pinned Mnemon binary missing under ${REPO_ROOT}`);
  const replayed = await replayEveryKind({ binaryPath: pinned.path });
  const { svc } = durable(replayed.root, { binaryPath: pinned.path });
  try {
    assert.equal(svc.engine.degraded, false);
    const health = await svc.engine.health();
    assert.match(String(health.version), /0\.2\.8/);
    assert.equal(pinned.sha256, hostMnemonTarget()?.binarySha256);
    assert.ok(svc.engine.runner);
    const evidenceDir = materializationEvidenceDir();
    mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
    const nativeSearches = [];
    for (const row of replayed.rows) {
      const native = await svc.engine.runner.run({
        command: "search",
        dataDir: workspaceDataDir(replayed.root, "ws-a"),
        positionals: [row.text],
        flags: { "--limit": 10 },
      });
      nativeSearches.push({
        kind: row.kind,
        exitCode: native.exitCode,
        stdout: native.stdout,
        stderr: native.stderr,
      });
      assert.equal(native.exitCode, 0);
      assert.match(native.stdout, new RegExp(row.memoryId));
      const parsed = JSON.parse(native.stdout) as Array<{ id: string; category?: string }>;
      assert.equal(parsed.find((item) => item.id === row.memoryId)?.category, row.nativeCategory);
    }
    writeFileSync(
      join(evidenceDir, "pinned-binary.json"),
      `${JSON.stringify({
        path: pinned.path,
        sha256: pinned.sha256,
        target: pinned.target,
        version: String(health.version).trim(),
        allowUnpinnedTestBinary: false,
      }, null, 2)}\n`,
    );
    writeFileSync(
      join(evidenceDir, "mapping.json"),
      `${JSON.stringify({
        candidateKinds: [...CANDIDATE_KINDS],
        mapped: Object.fromEntries(CANDIDATE_KINDS.map((kind) => [kind, nativeCategoryForCandidateKind(kind)])),
      }, null, 2)}\n`,
    );
    writeFileSync(
      join(evidenceDir, "factory-replay.json"),
      `${JSON.stringify({ rows: replayed.rows, personalMemoryId: replayed.personalMemoryId, nativeSearches }, null, 2)}\n`,
    );
  } finally {
    svc.close();
  }
});

test("pinned Mnemon rejects a failed native write then accepts a fresh Owner retry", { skip: requirePinnedHost ? false : !pinned }, async () => {
  assert.ok(pinned, `pinned Mnemon binary missing under ${REPO_ROOT}`);
  const root = mkdtempSync(join(tmpdir(), "penglai-mem-native-retry-"));
  const { svc, owner } = durable(root, { binaryPath: pinned.path });
  const text = "Neutral native write retry token CORAL-061-FACTORY";
  try {
    const pending = enqueue(svc, {
      workspaceId: "ws-fail",
      kind: "project_fact",
      text,
      turnId: "t-native-fail",
    });
    const proposed = svc.proposeAction({
      action: "memory.accept",
      objectId: pending.candidateId,
      workspaceId: "ws-fail",
    });
    const decided = await owner.requestOwnerApproval(proposed.actionId);
    assert.equal(decided.decision, "approved");
    if (decided.decision !== "approved") throw new Error("expected receipt");
    const wsDir = workspaceDataDir(root, "ws-fail");
    mkdirSync(wsDir, { recursive: true, mode: 0o700 });
    // chmod(dir, 0555) does not make an owner-writable Windows directory fail.
    // Mnemon creates data/<store>/mnemon.db; a regular file at data/ is a
    // portable obstruction that the native write cannot mkdir through.
    const nestedStore = join(wsDir, "data");
    writeFileSync(nestedStore, "obstruct nested mnemon store\n", { mode: 0o600 });
    let nativeFailure: { message: string } | undefined;
    try {
      await svc.acceptCandidate({
        candidateId: pending.candidateId,
        actionId: proposed.actionId,
        receipt: decided.receipt,
      });
      assert.fail("unwritable native data dir must not materialize");
    } catch (error) {
      nativeFailure = { message: error instanceof Error ? error.message : String(error) };
      assert.match(nativeFailure.message, /mnemon remember failed|DSH_UNAVAILABLE/);
    } finally {
      rmSync(nestedStore, { force: true });
    }
    assert.equal(svc.memoryV2.getCandidate(pending.candidateId)?.status, "pending");
    assert.equal(svc.memoryV2.getCandidate(pending.candidateId)?.kind, "project_fact");
    assert.equal(owner.inspect(proposed.actionId).state, "reserved");
    await assert.rejects(
      () =>
        svc.acceptCandidate({
          candidateId: pending.candidateId,
          actionId: proposed.actionId,
          receipt: decided.receipt,
        }),
      /REPLAY|PROPOSAL_STATE/,
    );
    const retried = await ownerAccept(svc, owner, {
      candidateId: pending.candidateId,
      workspaceId: "ws-fail",
    });
    assert.equal(retried.accepted.status, "accepted");
    const hits = await svc.search(text, "ws-fail");
    assert.equal(hits.some((row) => row.id === retried.accepted.memoryId), true);
    assert.ok(svc.engine.runner);
    const native = await svc.engine.runner.run({
      command: "search",
      dataDir: wsDir,
      positionals: [text],
      flags: { "--limit": 10 },
    });
    const evidenceDir = materializationEvidenceDir();
    mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(evidenceDir, "failed-write-retry.json"),
      `${JSON.stringify({
        binarySha256: pinned.sha256,
        firstActionState: "reserved",
        candidateStatusAfterFailure: "pending",
        originalKind: "project_fact",
        nativeFailure,
        retryMemoryId: retried.accepted.memoryId,
        retryNativeSearch: { exitCode: native.exitCode, stdout: native.stdout, stderr: native.stderr },
      }, null, 2)}\n`,
    );
    assert.equal(native.exitCode, 0);
    assert.match(native.stdout, new RegExp(retried.accepted.memoryId));
  } finally {
    svc.close();
  }
});
