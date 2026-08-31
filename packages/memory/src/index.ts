import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import type { LlmRuntime } from "@deepseek-ai/dsh-llm";
import { isPenglaiRemoteContext, PenglaiError, RELEASE } from "@penglai/contracts";
import { applyEmbeddedMemorySources, createContextSettingsApi } from "@penglai/memory-sources";
import { assertReadable, createMemoryService, modelCannotWriteGlobal, type MemoryWrite } from "./service.js";
import { MemoryStore } from "./store.js";
import { createMemorySettingsApi, PenglaiMemoryRemote } from "./remote.js";
import { MnemonMemoryService } from "./engine/service.js";
import { importLegacy, previewLegacy } from "./migration/legacy-053.js";
import { registerMemoryTools } from "./tools.js";
import { MemoryV2Store, type MemoryCandidateV1 } from "./v2/candidates.js";
import { ingestCuratorOutput } from "./v2/curator.js";
import { migrateJournalToV2 } from "./v2/migrate.js";
import { MEMORY_OWNER_ACTIONS } from "./v2/owner.js";
import { proposeMemoryAction, reserveMemoryOwnerProof, type MemoryOwnerBrokerPort } from "./v2/owner-adapter.js";
import { InternalCuratorQueue, internalCuratorJobKey } from "./v2/internal-curator.js";
import { CURATOR_ESTIMATED_TOKENS, MemoryCuratorFailure, classifyMemoryCuratorFailure, ingestOfficialTurn, resolveSessionTurn, runOfficialLlmCurator, sessionEventParts, turnSourceDigest, turnSummary, withMemoryRecall, workspaceIdForSession } from "./turn-pipeline.js";
import { OwnerApprovalBroker } from "@penglai/runtime/owner-broker";
import { createHostOwnerDialog } from "@penglai/runtime/owner-dialog";

export const name = "@penglai/memory";
export const inject = ["skills", "workspaceRegistry", "tools", "agents", "llm"];
export const version = RELEASE;
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface OfficialSkillSummary {
  name: string;
}

interface OfficialAgentLike {
  options: { provider?: string; model?: string; maxTokens?: number };
}

interface CordisContextLike {
  skills?: {
    snapshot(options?: { cwd?: string }): Promise<{ skills: OfficialSkillSummary[]; complete: boolean }>;
  };
  workspaceRegistry?: {
    list(): Array<{ id: string; title?: string; path?: string; sessionIds?: readonly string[] }>;
  };
  agents?: {
    get(id: string): OfficialAgentLike | undefined;
  };
  llm?: Pick<LlmRuntime, "stream">;
  penglaiBudget?: MemoryBudgetServiceLike;
  get?: (name: string, strict?: boolean) => unknown;
  provide?: (name: string, service: unknown) => unknown;
  effect?: (setup: () => () => void) => unknown;
  on?: (event: string, listener: (...args: unknown[]) => unknown, options?: Record<string, unknown>) => unknown;
}

interface MemoryBudgetServiceLike {
  reserveAuxiliary(input: {
    operationId: string;
    provider: string;
    model: string;
    workspaceId?: string;
    estimatedTokens: number;
  }): void;
  settleAuxiliary(input: { operationId: string; tokens: number }): boolean;
  releaseAuxiliary(input: { operationId: string; reason: string }): boolean;
}

function optionalBudget(ctx: CordisContextLike): MemoryBudgetServiceLike | undefined {
  if (typeof ctx.get === "function") {
    return ctx.get("penglaiBudget", true) as MemoryBudgetServiceLike | undefined;
  }
  return ctx.penglaiBudget;
}

function budgetFailure(error: unknown): MemoryCuratorFailure {
  return new MemoryCuratorFailure(
    (error as { code?: unknown } | undefined)?.code === "SECURITY_POLICY"
      ? "BUDGET_BLOCKED"
      : "BUDGET_ACCOUNTING",
    false,
  );
}

export interface SopPromotion {
  name: string;
  description: string;
  body: string;
  visibleDiff: string;
  ownerConfirmed: boolean;
  actionId?: string;
  receipt?: string;
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function resultDigest(value: unknown): string {
  return sha256(JSON.stringify(value));
}

export interface SopReceipt {
  registry: "official-dsh-skills";
  name: string;
  sha256: string;
  observed: true;
}

function requireUserData(): string {
  const root = process.env.PENGLAI_USER_DATA;
  if (!root) throw new PenglaiError("DSH_UNAVAILABLE", "PENGLAI_USER_DATA required for @penglai/memory");
  return resolve(root);
}

function officialSkillsRoot(userData: string): string {
  const dshHome = resolve(process.env.DSH_HOME ?? join(userData, "dsh-home"));
  const rel = relative(userData, dshHome);
  if (!isAbsolute(dshHome) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new PenglaiError("SECURITY_POLICY", "official DSH_HOME must stay under Penglai userData");
  }
  return join(dshHome, "skills");
}

function assertNoSymlink(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "official skill path must not be a symlink");
  }
}

function skillMarkdown(input: SopPromotion): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.name)) {
    throw new PenglaiError("INVALID_INPUT", "official skill name must be kebab-case");
  }
  if (!input.ownerConfirmed || !input.visibleDiff.trim()) {
    throw new PenglaiError("SECURITY_POLICY", "SOP promotion requires visible diff and Owner confirm");
  }
  if (!input.description.trim() || !input.body.trim()) {
    throw new PenglaiError("INVALID_INPUT", "SOP description and body required");
  }
  if (/api[_-]?key|app[_-]?secret|private[_-]?key|password\s*[:=]/i.test(input.body)) {
    throw new PenglaiError("SECURITY_POLICY", "SOP content looks secret-bearing");
  }
  const description = input.description.replace(/[\r\n]+/g, " ").trim();
  return `---\nname: ${input.name}\ndescription: ${JSON.stringify(description)}\ndisable-model-invocation: false\nuser-invocable: true\n---\n\n${input.body.trim()}\n`;
}

async function waitForOfficialSkill(
  skills: NonNullable<CordisContextLike["skills"]>,
  name: string,
  cwd: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const snapshot = await skills.snapshot({ cwd });
    if (snapshot.complete && snapshot.skills.some((skill) => skill.name === name)) return;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new PenglaiError("DSH_UNAVAILABLE", "official Skills registry did not observe promoted SOP");
}

export function createDurableMemoryService(opts: {
  userData: string;
  skills: NonNullable<CordisContextLike["skills"]>;
  onClose?: () => void;
  owner?: MemoryOwnerBrokerPort;
  internalCuratorSnapshot?: () => { active: number; queued: number; timers: number };
  sources?: ReturnType<typeof createContextSettingsApi>;
}) {
  const v2 = new MemoryV2Store(join(opts.userData, "memory", "v2.sqlite3"));
  const engine = new MnemonMemoryService(opts.userData, {
    ...(process.env.PENGLAI_MNEMON_BINARY ? { binaryPath: process.env.PENGLAI_MNEMON_BINARY } : {}),
    ...(process.env.PENGLAI_APP_ROOT ? { appRoot: process.env.PENGLAI_APP_ROOT } : {}),
    packageRoot: PACKAGE_ROOT,
  });
  const skillsRoot = officialSkillsRoot(opts.userData);
  migrateJournalToV2(engine.journal, v2, { userData: opts.userData });
  let closed = false;

  const candidateDigest = (candidate: MemoryCandidateV1): string =>
    resultDigest({
      candidateId: candidate.candidateId,
      workspaceId: candidate.workspaceId,
      sessionId: candidate.sessionId,
      turnId: candidate.turnId,
      kind: candidate.kind,
      text: candidate.text,
      sourceDigest: candidate.sourceDigest,
    });

  const scopeDigest = (workspaceId?: string): string => {
    const rows = engine.journal
      .listActive(workspaceId ? "workspace" : "personal", workspaceId)
      .map((row) => ({ id: row.id, digest: row.contentDigest }))
      .sort((left, right) => left.id.localeCompare(right.id));
    return resultDigest({ scope: workspaceId ? "workspace" : "personal", workspaceId: workspaceId ?? null, rows });
  };

  const materializeCandidate = async (candidate: MemoryCandidateV1, personal = false) => {
    const workspaceId = personal ? undefined : candidate.workspaceId;
    const scope = personal ? "personal" : "workspace";
    const existing = engine
      .listConfirmed({ scope, ...(workspaceId ? { workspaceId } : {}), limit: 200 })
      .find((row) => row.content === candidate.text);
    if (existing) {
      v2.setMeta(`materialized:${candidate.candidateId}`, existing.id);
      return { id: existing.id, reused: true as const };
    }
    const remembered = await engine.remember({
      text: candidate.text,
      ...(workspaceId ? { workspaceId } : {}),
      cat: candidate.kind,
      tags: `candidate:${candidate.candidateId}`,
      source: personal ? "owner-accepted-curator" : "auto-curator",
    });
    v2.setMeta(`materialized:${candidate.candidateId}`, remembered.id);
    return { id: remembered.id, reused: false as const };
  };

  const actionSourceDigest = (input: {
    action: (typeof MEMORY_OWNER_ACTIONS)[keyof typeof MEMORY_OWNER_ACTIONS];
    objectId: string;
    workspaceId?: string;
    sourceText?: string;
  }): string => {
    if (input.action === MEMORY_OWNER_ACTIONS.accept || input.action === MEMORY_OWNER_ACTIONS.personal) {
      const candidate = v2.getCandidate(input.objectId);
      if (!candidate || candidate.status !== "pending") {
        throw new PenglaiError("INVALID_INPUT", "MEMORY_CANDIDATE_MISSING");
      }
      if ((input.workspaceId ?? "") !== candidate.workspaceId) {
        throw new PenglaiError("SECURITY_POLICY", "memory candidate Workspace mismatch");
      }
      return candidateDigest(candidate);
    }
    if (input.action === MEMORY_OWNER_ACTIONS.correct) {
      const prior = engine.journal.get(input.objectId);
      if (!prior || !input.sourceText?.trim()) throw new PenglaiError("INVALID_INPUT", "memory correction source missing");
      if ((prior.workspaceId ?? "") !== (input.workspaceId ?? "")) {
        throw new PenglaiError("SECURITY_POLICY", "memory correction Workspace mismatch");
      }
      return resultDigest({ id: prior.id, contentDigest: prior.contentDigest, replacement: input.sourceText.trim() });
    }
    if (input.action === MEMORY_OWNER_ACTIONS.forget) {
      const prior = engine.journal.get(input.objectId);
      if (!prior) throw new PenglaiError("INVALID_INPUT", "memory id missing");
      if ((prior.workspaceId ?? "") !== (input.workspaceId ?? "")) {
        throw new PenglaiError("SECURITY_POLICY", "memory forget Workspace mismatch");
      }
      return resultDigest({ id: prior.id, contentDigest: prior.contentDigest });
    }
    if (input.action === MEMORY_OWNER_ACTIONS.delete) {
      const expectedObject = input.workspaceId ? `scope:workspace:${input.workspaceId}` : "scope:personal";
      if (input.objectId !== expectedObject) throw new PenglaiError("SECURITY_POLICY", "memory delete scope mismatch");
      return scopeDigest(input.workspaceId);
    }
    if (input.action === MEMORY_OWNER_ACTIONS.import) {
      if (input.objectId !== "legacy-import") throw new PenglaiError("SECURITY_POLICY", "memory import identity mismatch");
      return resultDigest(previewLegacy(opts.userData) ?? null);
    }
    if (input.action === MEMORY_OWNER_ACTIONS.personalize || input.action === MEMORY_OWNER_ACTIONS.promoteSop) {
      if (!input.sourceText?.trim()) throw new PenglaiError("INVALID_INPUT", "memory Owner source missing");
      return sha256(input.sourceText.trim());
    }
    if (input.action === MEMORY_OWNER_ACTIONS.sourcesRevoke) {
      if (input.objectId !== "source-grant" || !input.sourceText?.trim()) {
        throw new PenglaiError("INVALID_INPUT", "memory source grant missing");
      }
      return sha256(input.sourceText.trim());
    }
    throw new PenglaiError("SECURITY_POLICY", "MEMORY_OWNER_ACTION");
  };
  return {
    engine,
    async remember(input: { text: string; workspaceId?: string }) {
      return engine.remember(input);
    },
    async search(query: string, workspaceId?: string) {
      return engine.search(query, workspaceId);
    },
    async recall(query: string, workspaceId?: string) {
      return engine.recall(query, workspaceId);
    },
    async related(id: string, workspaceId?: string) {
      return engine.related(id, workspaceId);
    },
    async why(id: string, workspaceId?: string) {
      return engine.why(id, workspaceId);
    },
    async correct(oldId: string, text: string, workspaceId?: string, proof?: { actionId: string; receipt: string }) {
      if (!proof?.actionId || !proof.receipt) {
        throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
      }
      const sourceDigest = actionSourceDigest({
        action: MEMORY_OWNER_ACTIONS.correct,
        objectId: oldId,
        ...(workspaceId ? { workspaceId } : {}),
        sourceText: text,
      });
      const reservation = reserveMemoryOwnerProof(opts.owner, {
        action: MEMORY_OWNER_ACTIONS.correct,
        actionId: proof.actionId,
        receipt: proof.receipt,
        objectId: oldId,
        ...(workspaceId ? { workspaceId } : {}),
        sourceDigest,
      });
      const corrected = await engine.correct(oldId, text, workspaceId);
      reservation.complete(resultDigest({ oldId, newId: corrected.id, replacement: sha256(text) }));
      return corrected;
    },
    async forget(id: string, workspaceId?: string, proof?: { actionId: string; receipt: string }) {
      if (!proof?.actionId || !proof.receipt) {
        throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
      }
      const sourceDigest = actionSourceDigest({
        action: MEMORY_OWNER_ACTIONS.forget,
        objectId: id,
        ...(workspaceId ? { workspaceId } : {}),
      });
      const reservation = reserveMemoryOwnerProof(opts.owner, {
        action: MEMORY_OWNER_ACTIONS.forget,
        actionId: proof.actionId,
        receipt: proof.receipt,
        objectId: id,
        ...(workspaceId ? { workspaceId } : {}),
        sourceDigest,
      });
      const prior = engine.journal.get(id);
      const result = await engine.forget(id, workspaceId);
      if (prior) v2.recordTombstone(id, prior.contentDigest);
      reservation.complete(resultDigest({ id, forgotten: true, sourceDigest }));
      return result;
    },
    proposeAction(input: { action: string; objectId: string; workspaceId?: string; sessionId?: string; sourceText?: string }) {
      if (!opts.owner) throw new PenglaiError("DSH_UNAVAILABLE", "owner broker required");
      const action = input.action as (typeof MEMORY_OWNER_ACTIONS)[keyof typeof MEMORY_OWNER_ACTIONS];
      if (!Object.values(MEMORY_OWNER_ACTIONS).includes(action)) {
        throw new PenglaiError("SECURITY_POLICY", "MEMORY_OWNER_ACTION");
      }
      const sourceDigest = actionSourceDigest({
        action,
        objectId: input.objectId,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.sourceText ? { sourceText: input.sourceText } : {}),
      });
      return proposeMemoryAction(opts.owner, {
        action,
        objectId: input.objectId,
        sourceDigest,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      });
    },
    async acceptCandidate(input: { candidateId: string; actionId: string; receipt: string; personal?: boolean }) {
      if (!input.receipt) throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
      const hit = v2.getCandidate(input.candidateId);
      if (!hit || hit.status !== "pending") throw new PenglaiError("INVALID_INPUT", "MEMORY_CANDIDATE_MISSING");
      const sourceDigest = candidateDigest(hit);
      const reservation = reserveMemoryOwnerProof(opts.owner, {
        action: input.personal ? MEMORY_OWNER_ACTIONS.personal : MEMORY_OWNER_ACTIONS.accept,
        actionId: input.actionId,
        receipt: input.receipt,
        objectId: input.candidateId,
        workspaceId: hit.workspaceId,
        sourceDigest,
      });
      const remembered = await materializeCandidate(hit, input.personal === true);
      const candidate = v2.decide(input.candidateId, "accepted", {
        actionId: input.actionId,
        ...(input.personal ? { personal: true } : {}),
      });
      reservation.complete(resultDigest({
        candidateId: candidate.candidateId,
        memoryId: remembered.id,
        scope: input.personal ? "personal" : "workspace",
        sourceDigest,
      }));
      return { ...candidate, memoryId: remembered.id };
    },
    rejectCandidate(input: { candidateId: string }) {
      return v2.decide(input.candidateId, "rejected");
    },
    setMemoryMode(mode: string) {
      return v2.setMode(mode);
    },
    ingestCurator(
      raw: string,
      ctx: { workspaceId: string; sessionId: string; turnId: string; sourceDigest: string },
    ) {
      try {
        return ingestCuratorOutput(v2, raw, ctx);
      } catch {
        return { failOpen: true, enqueued: 0, skipped: 0, code: "CURATOR_SCHEMA_INVALID" as const };
      }
    },
    queueToolCandidate(input: {
      text: string;
      suggestedScope: "personal" | "workspace";
      workspaceId: string;
      sessionId: string;
      turnId: string;
    }) {
      const text = input.text.trim();
      if (!text) throw new PenglaiError("INVALID_INPUT", "memory text required");
      const sourceDigest = resultDigest({
        source: "penglai-memory-remember-tool",
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        suggestedScope: input.suggestedScope,
        text,
      });
      const candidate = v2.enqueue({
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        turnId: `tool:${input.turnId}`,
        kind: "project_fact",
        text,
        rationale:
          input.suggestedScope === "personal"
            ? "The conversation requested a personal memory; Owner must explicitly upgrade it."
            : "The conversation requested a Workspace memory; Owner must review it.",
        confidence: 1,
        sourceDigest,
      });
      return {
        ...candidate,
        suggestedScope: input.suggestedScope,
      };
    },
    async materializeCandidate(candidate: MemoryCandidateV1) {
      return materializeCandidate(candidate, false);
    },
    async deleteKnown(workspaceId: string | undefined, proof?: { actionId: string; receipt: string }) {
      if (!proof?.actionId || !proof.receipt) throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
      const objectId = workspaceId ? `scope:workspace:${workspaceId}` : "scope:personal";
      const sourceDigest = scopeDigest(workspaceId);
      const reservation = reserveMemoryOwnerProof(opts.owner, {
        action: MEMORY_OWNER_ACTIONS.delete,
        actionId: proof.actionId,
        receipt: proof.receipt,
        objectId,
        ...(workspaceId ? { workspaceId } : {}),
        sourceDigest,
      });
      const result = await engine.deleteScope(workspaceId);
      reservation.complete(resultDigest({ objectId, removed: result.removed, sourceDigest }));
      return result;
    },
    async graph(workspaceId?: string, includePersonal = false) {
      return engine.graph(workspaceId, includePersonal);
    },
    write(input: MemoryWrite) {
      throw new PenglaiError("SECURITY_POLICY", "runtime memory writes go through remember()");
    },
    list(scope?: string, workspaceId?: string) {
      if (scope === "candidate") {
        return v2.listCandidates(workspaceId ?? "").map((row) => ({
          id: row.candidateId,
          text: row.text,
          workspaceId: row.workspaceId,
        }));
      }
      return engine
        .listConfirmed({
          scope: scope === "workspace" ? "workspace" : "personal",
          ...(workspaceId ? { workspaceId } : {}),
        })
        .map((row) => ({ id: row.id, text: row.content, workspaceId: row.workspaceId }));
    },
    count(workspaceId?: string) {
      const confirmed = engine.countConfirmed(workspaceId ? { workspaceId } : {});
      return {
        ...confirmed,
        pending: workspaceId ? v2.listCandidates(workspaceId).length : 0,
        mode: v2.mode(),
      };
    },
    memoryV2: v2,
    deleteScope() {
      throw new PenglaiError("SECURITY_POLICY", "runtime memory delete goes through forget()");
    },
    async promoteSop(input: SopPromotion): Promise<SopReceipt> {
      const markdown = skillMarkdown(input);
      if (!input.actionId || !input.receipt) {
        throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
      }
      const objectId = `skill:${input.name}`;
      const sourceDigest = sha256(JSON.stringify({
        name: input.name,
        description: input.description,
        body: input.body,
      }));
      const reservation = reserveMemoryOwnerProof(opts.owner, {
        action: MEMORY_OWNER_ACTIONS.promoteSop,
        actionId: input.actionId,
        receipt: input.receipt,
        objectId,
        sourceDigest,
      });
      mkdirSync(skillsRoot, { recursive: true, mode: 0o700 });
      assertNoSymlink(skillsRoot);
      const canonicalRoot = realpathSync(skillsRoot);
      const skillDir = join(canonicalRoot, input.name);
      assertNoSymlink(skillDir);
      mkdirSync(skillDir, { recursive: true, mode: 0o700 });
      assertNoSymlink(skillDir);
      const canonicalDir = realpathSync(skillDir);
      if (relative(canonicalRoot, canonicalDir).startsWith("..")) {
        throw new PenglaiError("SECURITY_POLICY", "official skill path escaped root");
      }
      const target = join(canonicalDir, "SKILL.md");
      assertNoSymlink(target);
      const temp = join(canonicalDir, `.SKILL.${process.pid}.${randomUUID()}.tmp`);
      writeFileSync(temp, markdown, { encoding: "utf8", mode: 0o600, flag: "wx" });
      renameSync(temp, target);
      await waitForOfficialSkill(opts.skills, input.name, opts.userData);
      const fileSha256 = createHash("sha256").update(readFileSync(target)).digest("hex");
      reservation.complete(resultDigest({ registry: "official-dsh-skills", name: input.name, sha256: fileSha256 }));
      return { registry: "official-dsh-skills", name: input.name, sha256: fileSha256, observed: true };
    },
    async rememberExplicit(input: { text: string; workspaceId?: string }) {
      const row = await engine.remember(input);
      return { ok: true as const, id: row.id };
    },
    async rememberPersonal(input: { text: string; actionId: string; receipt: string }) {
      const text = input.text.trim();
      if (!text) throw new PenglaiError("INVALID_INPUT", "memory text required");
      const sourceDigest = sha256(text);
      const reservation = reserveMemoryOwnerProof(opts.owner, {
        action: MEMORY_OWNER_ACTIONS.personalize,
        actionId: input.actionId,
        receipt: input.receipt,
        objectId: "personal-memory",
        sourceDigest,
      });
      const row = await engine.remember({ text, source: "owner-explicit" });
      reservation.complete(resultDigest({ id: row.id, sourceDigest }));
      return { ok: true as const, id: row.id };
    },
    async importPreview() {
      const preview = previewLegacy(opts.userData);
      return preview
        ? { personal: preview.personal, workspace: preview.workspace, candidate: preview.candidate }
        : undefined;
    },
    async importConfirm(proof?: { actionId: string; receipt: string }) {
      if (!proof?.actionId || !proof.receipt) throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
      const preview = previewLegacy(opts.userData);
      const sourceDigest = resultDigest(preview ?? null);
      const reservation = reserveMemoryOwnerProof(opts.owner, {
        action: MEMORY_OWNER_ACTIONS.import,
        actionId: proof.actionId,
        receipt: proof.receipt,
        objectId: "legacy-import",
        sourceDigest,
      });
      if (v2.meta("legacy-import-complete")) {
        throw new PenglaiError("SECURITY_POLICY", "legacy memory was already imported");
      }
      const imported = await importLegacy(opts.userData, engine);
      const digest = resultDigest({ personal: imported.personal, workspace: imported.workspace, candidate: imported.candidate });
      v2.setMeta("legacy-import-complete", digest);
      reservation.complete(digest);
      return { personal: imported.personal, workspace: imported.workspace, candidate: imported.candidate };
    },
    async revokeSource(root: string, proof?: { actionId: string; receipt: string }) {
      if (!proof?.actionId || !proof.receipt) {
        throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
      }
      if (!opts.sources) throw new PenglaiError("DSH_UNAVAILABLE", "memory sources unavailable");
      const normalizedRoot = root.trim();
      const active = (opts.sources.status() as { grants?: Array<{ root?: string }> }).grants?.some(
        (grant) => grant.root === normalizedRoot,
      );
      if (!active) throw new PenglaiError("UNAUTHORIZED", "context grant is not active");
      const sourceDigest = sha256(normalizedRoot);
      const reservation = reserveMemoryOwnerProof(opts.owner, {
        action: MEMORY_OWNER_ACTIONS.sourcesRevoke,
        actionId: proof.actionId,
        receipt: proof.receipt,
        objectId: "source-grant",
        sourceDigest,
      });
      const result = opts.sources.revoke({ root: normalizedRoot });
      reservation.complete(resultDigest({ sourceDigest, ...result }));
      return result;
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        opts.onClose?.();
      } finally {
        try {
          engine.close();
        } finally {
          v2.close();
        }
      }
    },
    resourceSnapshot() {
      const curator = opts.internalCuratorSnapshot?.() ?? { active: 0, queued: 0, timers: 0 };
      return {
        workers: curator.active + curator.queued,
        sockets: 0,
        timers: curator.timers,
        remotes: 0,
        db: closed ? 0 : engine.resourceSnapshot().db,
        modelSessions: 0,
        audioHandles: 0,
        activeJobs: curator.active,
        queuedJobs: curator.queued,
      };
    },
  };
}

export function apply(ctx: CordisContextLike) {
  const userData = requireUserData();
  if (!ctx.skills?.snapshot) throw new PenglaiError("DSH_UNAVAILABLE", "official DSH Skills registry required for memory");
  if (!ctx.provide) throw new PenglaiError("DSH_UNAVAILABLE", "Cordis provide service required for memory");
  const workspaceRegistry = ctx.workspaceRegistry;
  if (!workspaceRegistry?.list) throw new PenglaiError("DSH_UNAVAILABLE", "official Workspace registry required for memory");
  const agents = ctx.agents;
  if (!agents?.get) throw new PenglaiError("DSH_UNAVAILABLE", "official Agents registry required for memory");
  const llm = ctx.llm;
  if (!llm?.stream) throw new PenglaiError("DSH_UNAVAILABLE", "official DSH LLM runtime required for memory");
  const sources = applyEmbeddedMemorySources(ctx);
  const sourcesApi = createContextSettingsApi(sources, userData, workspaceRegistry);
  const owner = new OwnerApprovalBroker(userData, { dialog: createHostOwnerDialog(userData) });
  let service: ReturnType<typeof createDurableMemoryService> | undefined;
  const curatorQueue = new InternalCuratorQueue({
    observe: (event) => {
      service?.memoryV2.recordCuratorAudit({
        operationKey: event.key,
        outcome: event.outcome,
        code: event.code,
        attempt: event.attempt,
      });
    },
  });
  try {
    service = createDurableMemoryService({
      userData,
      skills: ctx.skills,
      owner,
      sources: sourcesApi,
      internalCuratorSnapshot: () => curatorQueue.snapshot(),
      onClose: () => {
        curatorQueue.close();
        sources.close();
      },
    });
    const activeService = service;
    const turns = new Map<string, { user?: string; assistant?: string }>();
    const activeTurns = new Map<string, number>();
    ctx.on?.("session/event", (...args: unknown[]) => {
      const parts = sessionEventParts(args);
      if (!parts.sessionId) return;
      const turn = resolveSessionTurn(parts, activeTurns);
      if (typeof turn !== "number") return;
      const key = `${parts.sessionId}:${turn}`;
      const prev = turns.get(key) ?? {};
      if (parts.type === "user/message" && parts.text) prev.user = parts.text;
      if (parts.type === "assistant/message" && parts.text) prev.assistant = parts.text;
      turns.set(key, prev);
      if (parts.type !== "turn/end") return;
      const workspaceId = workspaceIdForSession(workspaceRegistry.list(), parts.sessionId);
      if (!workspaceId || activeService.memoryV2.mode() === "off") {
        turns.delete(key);
        return;
      }
      const summary = turnSummary(prev);
      turns.delete(key);
      const turnId = String(turn);
      const sourceDigest = turnSourceDigest({ workspaceId, sessionId: parts.sessionId, turnId, summary });
      if (activeService.memoryV2.turnAlreadyProcessed(parts.sessionId, turnId, sourceDigest)) return;
      const route = agents.get(parts.sessionId)?.options;
      if (!route?.provider || !route.model) return;
      const jobKey = internalCuratorJobKey({ workspaceId, sessionId: parts.sessionId, turnId });
      const operationId = createHash("sha256").update(jobKey).digest("hex");
      curatorQueue.enqueue({
        key: jobKey,
        maxAttempts: 2,
        classifyFailure: classifyMemoryCuratorFailure,
        execute: async (signal, attempt) => {
          if (workspaceIdForSession(workspaceRegistry.list(), parts.sessionId!) !== workspaceId) {
            throw new MemoryCuratorFailure("WORKSPACE_CHANGED", false);
          }
          const budget = optionalBudget(ctx);
          const attemptOperationId = `${operationId}:${attempt}`;
          let reserved = false;
          let settled = false;
          try {
            if (budget) {
              try {
                budget.reserveAuxiliary({
                  operationId: attemptOperationId,
                  provider: route.provider!,
                  model: route.model!,
                  workspaceId,
                  estimatedTokens: CURATOR_ESTIMATED_TOKENS,
                });
                reserved = true;
              } catch (error: unknown) {
                throw budgetFailure(error);
              }
            }
            return await runOfficialLlmCurator({
              llm,
              provider: route.provider!,
              model: route.model!,
              summary,
              signal,
              onUsage: (tokens) => {
                if (!budget) return;
                try {
                  if (!budget.settleAuxiliary({ operationId: attemptOperationId, tokens })) {
                    throw new Error("missing auxiliary reservation");
                  }
                  settled = true;
                } catch (error: unknown) {
                  throw budgetFailure(error);
                }
              },
            });
          } finally {
            if (budget && reserved && !settled) {
              try {
                budget.releaseAuxiliary({ operationId: attemptOperationId, reason: "memory_curator_failed" });
              } catch {
                // Queue failure audit remains authoritative; cleanup is best effort.
              }
            }
          }
        },
        commit: async (raw) => {
          if (workspaceIdForSession(workspaceRegistry.list(), parts.sessionId!) !== workspaceId) {
            throw new MemoryCuratorFailure("WORKSPACE_CHANGED", false);
          }
          const result = await ingestOfficialTurn({
            store: activeService.memoryV2,
            workspaceId,
            sessionId: parts.sessionId!,
            turnId,
            raw,
            summary,
            persist: (candidate) => activeService.materializeCandidate(candidate),
          });
          if (result.failOpen) throw new MemoryCuratorFailure("OUTPUT_INVALID", false);
        },
      });
    });
    ctx.on?.(
      "agent/pre-step",
      async (payload: unknown, next: unknown) => {
        const decision = typeof next === "function" ? await (next as () => unknown)() : next;
        const row = decision && typeof decision === "object" ? (decision as { kind?: string; messages?: Array<{ content?: unknown[] }> }) : undefined;
        if (row?.kind !== "enter" || !Array.isArray(row.messages)) return decision;
        const sessionId = String((payload as { agent?: { id?: string } } | undefined)?.agent?.id ?? "");
        const workspaceId = workspaceIdForSession(workspaceRegistry.list(), sessionId);
        if (!workspaceId || activeService.memoryV2.mode() === "off") return decision;
        const workspaceConfirmed = activeService.engine
          .listConfirmed({ scope: "workspace", workspaceId })
          .map((item) => ({
            id: item.id,
            scope: "workspace" as const,
            text: item.content,
            sourceDigest: item.contentDigest ?? "a".repeat(64),
          }));
        const personalConfirmed = activeService.engine
          .listConfirmed({ scope: "personal" })
          .map((item) => ({
            id: item.id,
            scope: "personal" as const,
            text: item.content,
            sourceDigest: item.contentDigest ?? "a".repeat(64),
          }));
        const confirmed = [...workspaceConfirmed, ...personalConfirmed];
        const recall = activeService.memoryV2.recallSet({ workspaceId, confirmed });
        return { ...row, messages: withMemoryRecall(row.messages, recall), penglaiMemoryUsed: recall.used };
      },
      { global: true, prepend: true },
    );
    registerMemoryTools(ctx, activeService);
    ctx.provide("penglaiMemory", activeService);
    if (isPenglaiRemoteContext(ctx)) {
      new PenglaiMemoryRemote(ctx as Context, createMemorySettingsApi(activeService, workspaceRegistry, sourcesApi));
    }
    ctx.effect?.(() => () => activeService.close?.());
  } catch (error) {
    curatorQueue.close();
    if (service) service.close();
    else sources.close();
    throw error;
  }
  return service;
}

Object.assign(apply, { inject });
export default { name, inject, apply, version };
export * from "./service.js";
export * from "./store.js";
export { MnemonMemoryService, IsolatedMemoryEngine } from "./engine/service.js";
export { bundledMnemonBinary, MNEMON_ASSETS } from "./engine/mnemon-provider.js";
export { importLegacy, previewLegacy } from "./migration/legacy-053.js";
export { projectGraph } from "./graph/projection.js";
export { MemoryV2Store } from "./v2/candidates.js";
export { ingestCuratorOutput } from "./v2/curator.js";
export { migrateJournalToV2 } from "./v2/migrate.js";
export type { MemoryWrite };
export { modelCannotWriteGlobal, assertReadable };
export type { MemoryWrite as WriteInput };
