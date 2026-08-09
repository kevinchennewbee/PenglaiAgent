/**
 * Deterministic mode-switch loop (0.4.0 design §5 切换语义).
 *
 * Host-owned state machine — no NL intent guessing anywhere:
 *
 *   mode.proposeWork
 *     Resolve and persist a canonical pending proposal. It cannot grant
 *     trust, create a Task, or change the Conversation anchor.
 *
 *   mode.confirmWork  chat ──▶ work
 *     An explicit Owner confirmation of the exact proposal + canonical path
 *     grants project trust, creates one durable Task, and activates it.
 *
 *   mode.exitWork  work ──▶ chat
 *     Mark the anchored task completed (or leave it paused), then flip the
 *     conversation back to "chat" with activeTaskId = null. Idempotent when
 *     already in chat.
 *
 *   mode.get
 *     Report the conversation's current mode + anchored task.
 *
 * Proposal state intentionally lives outside product.db: an unconfirmed
 * intent is not product work and must never appear in the executable Task set.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  SCHEMA_VERSION,
  type Conversation,
  type Project,
  type Task,
  type WorkProposal,
} from "@penglai/protocol";
import type { ProductStore } from "./storage/product-store.js";
import { atomicWritePrivateJson, readPrivateTextFile } from "./security/private-file.js";

export type ModeSwitchErrorCode =
  | "conversation_not_found"
  | "project_not_found"
  | "workspace_required"
  | "mode_conflict"
  | "invalid_params"
  | "proposal_not_found"
  | "proposal_mismatch"
  | "proposal_blocked"
  | "proposal_replayed";

export class ModeSwitchError extends Error {
  constructor(
    public readonly code: ModeSwitchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ModeSwitchError";
  }
}

/** Host-owned dependencies the loop needs (injected by server.ts). */
export interface ModeSwitchContext {
  store: ProductStore;
  proposalStore: WorkProposalStore;
  /** Canonicalization boundary used to reject Host-owned/protected roots. */
  dataDir: string;
  getConversation: (conversationId: string) => Conversation | null;
  saveConversation: (conversation: Conversation) => void;
  now?: () => number;
}

export interface ProposeWorkInput {
  conversationId: string;
  /** Existing project anchor (alternative to rootPath). */
  projectId?: string | null;
  /** Workspace path anchor; the project is created/reused deterministically. */
  rootPath?: string | null;
  /** What the work episode should accomplish. */
  objective: string;
  title?: string | null;
  sourceChannel?: Task["sourceChannel"];
}

export interface ProposeWorkResult {
  conversation: Conversation;
  /** Existing project, or null when confirmation must register a new path. */
  project: Project | null;
  projectName: string;
  proposal: WorkProposal;
  /** A proposal never creates executable work. Kept explicit for migrating callers. */
  task: null;
  requiresConfirmation: true;
  /** True when the anchor path was already a registered project. */
  reusedProject: boolean;
  /** True when an identical pending proposal already existed. */
  reusedProposal: boolean;
  message: string;
}

export interface ConfirmWorkInput {
  proposalId: string;
  conversationId: string;
  confirmedRootPath: string;
  confirmedBy?: string | null;
}

export interface ConfirmWorkResult {
  conversation: Conversation;
  project: Project;
  proposal: WorkProposal;
  task: Task;
  changed: boolean;
  idempotent: boolean;
  message: string;
}

export interface ExitWorkInput {
  conversationId: string;
  /** "completed" marks the anchored task done; "paused" leaves it as-is. */
  outcome?: "completed" | "paused";
}

export interface ExitWorkResult {
  conversation: Conversation;
  task: Task | null;
  /** False when the conversation was already in chat (idempotent no-op). */
  changed: boolean;
  message: string;
}

export interface ModeGetResult {
  conversationId: string;
  mode: Conversation["mode"];
  activeTaskId: string | null;
  projectId: string | null;
  task: Task | null;
  pendingProposal: WorkProposal | null;
}

interface ProposalFile {
  version: typeof SCHEMA_VERSION;
  proposals: WorkProposal[];
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseProposal(value: unknown): WorkProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("work proposal entry is not an object");
  }
  const row = value as Record<string, unknown>;
  const sourceChannels = new Set(["desktop", "feishu", "wechat", "schedule", "api"]);
  const statuses = new Set(["pending", "confirmed", "blocked"]);
  const requiredStrings = [
    "id",
    "conversationId",
    "projectName",
    "canonicalRootPath",
    "objective",
    "title",
  ] as const;
  for (const key of requiredStrings) {
    if (typeof row[key] !== "string" || !(row[key] as string).trim()) {
      throw new Error(`invalid work proposal ${key}`);
    }
  }
  if (row.schemaVersion !== SCHEMA_VERSION) throw new Error("unsupported work proposal schema");
  if (!sourceChannels.has(String(row.sourceChannel))) throw new Error("invalid proposal sourceChannel");
  if (!statuses.has(String(row.status))) throw new Error("invalid proposal status");
  if (
    !isNullableString(row.projectId) ||
    !isNullableString(row.taskId) ||
    !isNullableString(row.blockedReason) ||
    !isNullableString(row.confirmedBy)
  ) {
    throw new Error("invalid nullable work proposal field");
  }
  if (
    typeof row.createdAt !== "number" ||
    typeof row.updatedAt !== "number" ||
    !(row.confirmedAt === null || typeof row.confirmedAt === "number")
  ) {
    throw new Error("invalid work proposal timestamp");
  }
  return row as unknown as WorkProposal;
}

/** Atomic, fail-closed sidecar for non-executable Owner intent. */
export class WorkProposalStore {
  private readonly proposals = new Map<string, WorkProposal>();

  constructor(private readonly filename: string) {
    let raw: string;
    try {
      raw = readPrivateTextFile(filename, 4 * 1024 * 1024, true).text;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("work proposal file is not an object");
    }
    const file = parsed as Record<string, unknown>;
    if (file.version !== SCHEMA_VERSION || !Array.isArray(file.proposals)) {
      throw new Error("unsupported work proposal file");
    }
    for (const raw of file.proposals) {
      const proposal = parseProposal(raw);
      if (this.proposals.has(proposal.id)) throw new Error(`duplicate work proposal: ${proposal.id}`);
      this.proposals.set(proposal.id, proposal);
    }
  }

  get(proposalId: string): WorkProposal | null {
    return this.proposals.get(proposalId) ?? null;
  }

  latestPendingForConversation(conversationId: string): WorkProposal | null {
    return [...this.proposals.values()]
      .filter((proposal) => proposal.conversationId === conversationId && proposal.status === "pending")
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  }

  createOrReuse(
    input: Omit<WorkProposal, "schemaVersion" | "id" | "status" | "taskId" | "blockedReason" | "confirmedBy" | "createdAt" | "updatedAt" | "confirmedAt">,
    now: number,
  ): { proposal: WorkProposal; reused: boolean } {
    const pending = this.latestPendingForConversation(input.conversationId);
    if (
      pending &&
      pending.projectId === input.projectId &&
      pending.canonicalRootPath === input.canonicalRootPath &&
      pending.objective === input.objective &&
      pending.title === input.title &&
      pending.sourceChannel === input.sourceChannel
    ) {
      return { proposal: pending, reused: true };
    }
    if (pending) {
      this.proposals.set(pending.id, {
        ...pending,
        status: "blocked",
        blockedReason: "superseded by a newer Owner proposal",
        updatedAt: now,
      });
    }
    const proposal: WorkProposal = {
      schemaVersion: SCHEMA_VERSION,
      id: `proposal_${crypto.randomUUID().replaceAll("-", "")}`,
      ...input,
      status: "pending",
      taskId: null,
      blockedReason: null,
      confirmedBy: null,
      createdAt: now,
      updatedAt: now,
      confirmedAt: null,
    };
    this.proposals.set(proposal.id, proposal);
    this.persist();
    return { proposal, reused: false };
  }

  update(proposal: WorkProposal): WorkProposal {
    if (!this.proposals.has(proposal.id)) throw new Error(`unknown work proposal: ${proposal.id}`);
    this.proposals.set(proposal.id, proposal);
    this.persist();
    return proposal;
  }

  private persist(): void {
    const file: ProposalFile = {
      version: SCHEMA_VERSION,
      proposals: [...this.proposals.values()].sort((a, b) => a.createdAt - b.createdAt),
    };
    atomicWritePrivateJson(this.filename, file, 4 * 1024 * 1024);
  }
}

function requireConversation(
  ctx: ModeSwitchContext,
  conversationId: string,
): Conversation {
  const conversation = ctx.getConversation(conversationId);
  if (!conversation) {
    throw new ModeSwitchError(
      "conversation_not_found",
      `unknown conversationId: ${conversationId}`,
    );
  }
  return conversation;
}

function resolveProject(
  ctx: ModeSwitchContext,
  input: ProposeWorkInput,
): {
  project: Project | null;
  projectName: string;
  reused: boolean;
  canonicalRootPath: string;
} {
  if (input.projectId) {
    const project = ctx.store.getProject(input.projectId);
    if (!project || project.status !== "active") {
      throw new ModeSwitchError(
        "project_not_found",
        `unknown projectId: ${input.projectId}`,
      );
    }
    const canonicalRootPath = canonicalDirectory(project.rootPath);
    if (input.rootPath && canonicalDirectory(input.rootPath) !== canonicalRootPath) {
      throw new ModeSwitchError(
        "proposal_mismatch",
        "projectId and rootPath do not resolve to the same canonical project",
      );
    }
    return { project, projectName: project.name, reused: true, canonicalRootPath };
  }
  if (!input.rootPath) {
    throw new ModeSwitchError(
      "invalid_params",
      "mode.proposeWork needs a project anchor: projectId or rootPath",
    );
  }
  const realRoot = canonicalDirectory(input.rootPath);
  const existing = ctx.store.getProjectByRootPath(realRoot);
  if (existing && existing.status === "active") {
    return {
      project: existing,
      projectName: existing.name,
      reused: true,
      canonicalRootPath: realRoot,
    };
  }
  if (existing) {
    throw new ModeSwitchError("project_not_found", `project is archived: ${existing.id}`);
  }
  return {
    project: null,
    projectName: path.basename(realRoot) || "Project",
    reused: false,
    canonicalRootPath: realRoot,
  };
}

function canonicalDirectory(rootPath: string): string {
  const resolved = path.resolve(rootPath);
  try {
    if (!fs.statSync(resolved).isDirectory()) {
      throw new ModeSwitchError("workspace_required", `project root is not a directory: ${resolved}`);
    }
    return fs.realpathSync(resolved);
  } catch (error) {
    if (error instanceof ModeSwitchError) throw error;
    throw new ModeSwitchError("workspace_required", `project root does not exist: ${resolved}`);
  }
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function protectedConfirmationReason(ctx: ModeSwitchContext, canonicalRootPath: string): string | null {
  if (canonicalRootPath === path.parse(canonicalRootPath).root) return "filesystem root is protected";
  const home = fs.realpathSync(os.homedir());
  if (canonicalRootPath === home) return "owner home directory is protected";
  const dataDir = canonicalDirectory(ctx.dataDir);
  if (
    isSameOrDescendant(canonicalRootPath, dataDir) ||
    isSameOrDescendant(dataDir, canonicalRootPath)
  ) {
    return "Host data directory, its ancestors, and its descendants are protected";
  }
  return null;
}

/** Resolve and persist Owner intent only. No trust, Task, or anchor mutation. */
export function proposeWork(
  ctx: ModeSwitchContext,
  input: ProposeWorkInput,
): ProposeWorkResult {
  const conversation = requireConversation(ctx, input.conversationId);
  // ZCode: workspacePurpose is fixed when the session is created — no mid-thread
  // project switch. Once anchored, stay on that jail until the conversation ends
  // or the owner exits to floating chat and starts a new thread.
  // SSOT: activeTaskId (mode is a derived mirror only).
  if (conversation.activeTaskId) {
    throw new ModeSwitchError(
      "mode_conflict",
      `conversation ${conversation.id} is already anchored on task ` +
        `${conversation.activeTaskId}; workspace is fixed for this session (ZCode-like). ` +
        `Start a new conversation to use another project.`,
    );
  }
  const { project, projectName, reused, canonicalRootPath } = resolveProject(ctx, input);
  const objective =
    typeof input.objective === "string" && input.objective.trim()
      ? input.objective.trim()
      : `在项目「${projectName}」中协作`;
  const title = input.title?.trim() || objective.slice(0, 60);
  const { proposal, reused: reusedProposal } = ctx.proposalStore.createOrReuse({
    conversationId: conversation.id,
    projectId: project?.id ?? null,
    projectName,
    canonicalRootPath,
    objective,
    title,
    sourceChannel: input.sourceChannel ?? "api",
  }, (ctx.now ?? Date.now)());
  return {
    conversation,
    project,
    projectName,
    proposal,
    task: null,
    requiresConfirmation: true,
    reusedProject: reused,
    reusedProposal,
    message:
      `已提出在「${projectName}」(${canonicalRootPath}) 开工。` +
      `Owner 必须确认 proposal ${proposal.id} 与该精确路径后才会创建并激活任务。`,
  };
}

/** Owner-only confirmation: exact proposal + exact canonical path → one active Task. */
export function confirmWork(
  ctx: ModeSwitchContext,
  input: ConfirmWorkInput,
): ConfirmWorkResult {
  const proposal = ctx.proposalStore.get(input.proposalId);
  if (!proposal) {
    throw new ModeSwitchError("proposal_not_found", `unknown proposalId: ${input.proposalId}`);
  }
  if (proposal.conversationId !== input.conversationId) {
    throw new ModeSwitchError("proposal_mismatch", "proposal does not belong to this conversation");
  }
  const confirmedRootPath = canonicalDirectory(input.confirmedRootPath);
  if (confirmedRootPath !== proposal.canonicalRootPath) {
    throw new ModeSwitchError("proposal_mismatch", "confirmed path does not match the proposal's canonical path");
  }
  const protectedReason = protectedConfirmationReason(ctx, confirmedRootPath);
  if (protectedReason) {
    if (proposal.status === "pending") {
      ctx.proposalStore.update({
        ...proposal,
        status: "blocked",
        blockedReason: protectedReason,
        updatedAt: (ctx.now ?? Date.now)(),
      });
    }
    throw new ModeSwitchError("proposal_blocked", protectedReason);
  }
  const conversation = requireConversation(ctx, input.conversationId);
  if (proposal.status === "blocked") {
    throw new ModeSwitchError(
      "proposal_blocked",
      `proposal is blocked: ${proposal.blockedReason ?? "no reason recorded"}`,
    );
  }
  if (proposal.status === "confirmed") {
    const project = proposal.projectId ? ctx.store.getProject(proposal.projectId) : null;
    const task = proposal.taskId ? ctx.store.getTask(proposal.taskId) : null;
    if (
      project &&
      project.status === "active" &&
      task &&
      task.projectId === project.id &&
      project.trusted === true &&
      canonicalDirectory(project.rootPath) === proposal.canonicalRootPath &&
      conversation.activeTaskId === task.id &&
      conversation.mode === "work"
    ) {
      return {
        conversation,
        project,
        proposal,
        task,
        changed: false,
        idempotent: true,
        message: `proposal ${proposal.id} was already confirmed for task ${task.id}`,
      };
    }
    throw new ModeSwitchError("proposal_replayed", "confirmed proposal no longer matches its exact active task");
  }
  const proposalMarker = `owner-proposal:${proposal.id}`;
  const preexistingActiveTask = conversation.activeTaskId
    ? ctx.store.getTask(conversation.activeTaskId)
    : null;
  if (
    conversation.activeTaskId &&
    (!preexistingActiveTask || !preexistingActiveTask.acceptanceCriteria.includes(proposalMarker))
  ) {
    const blocked = ctx.proposalStore.update({
      ...proposal,
      status: "blocked",
      blockedReason: `conversation is already anchored on task ${conversation.activeTaskId}`,
      updatedAt: (ctx.now ?? Date.now)(),
    });
    throw new ModeSwitchError("proposal_blocked", blocked.blockedReason ?? "conversation already anchored");
  }

  let project: Project;
  if (proposal.projectId) {
    const existing = ctx.store.getProject(proposal.projectId);
    if (!existing || existing.status !== "active") {
      ctx.proposalStore.update({
        ...proposal,
        status: "blocked",
        blockedReason: "project is missing or archived",
        updatedAt: (ctx.now ?? Date.now)(),
      });
      throw new ModeSwitchError("proposal_blocked", "proposal project is missing or archived");
    }
    project = existing;
  } else {
    const existing = ctx.store.getProjectByRootPath(proposal.canonicalRootPath);
    if (existing?.status === "active") {
      project = existing;
    } else if (existing) {
      ctx.proposalStore.update({
        ...proposal,
        status: "blocked",
        blockedReason: "canonical project is archived",
        updatedAt: (ctx.now ?? Date.now)(),
      });
      throw new ModeSwitchError("proposal_blocked", "canonical project is archived");
    } else {
      // Project registration is part of the explicit Owner confirmation,
      // never part of proposal creation.
      project = ctx.store.createProject({
        name: proposal.projectName,
        rootPath: proposal.canonicalRootPath,
        trusted: false,
      });
    }
  }
  let currentProjectRoot: string;
  try {
    currentProjectRoot = canonicalDirectory(project.rootPath);
  } catch {
    ctx.proposalStore.update({
      ...proposal,
      status: "blocked",
      blockedReason: "project root no longer exists",
      updatedAt: (ctx.now ?? Date.now)(),
    });
    throw new ModeSwitchError("proposal_blocked", "proposal project root no longer exists");
  }
  if (currentProjectRoot !== proposal.canonicalRootPath) {
    ctx.proposalStore.update({
      ...proposal,
      status: "blocked",
      blockedReason: "project root changed after proposal",
      updatedAt: (ctx.now ?? Date.now)(),
    });
    throw new ModeSwitchError("proposal_blocked", "project root changed after proposal");
  }

  const now = (ctx.now ?? Date.now)();
  const recoveryCandidates = ctx.store
    .listTasks(project.id)
    .filter((candidate) => candidate.acceptanceCriteria.includes(proposalMarker));
  const recoveryCandidate = recoveryCandidates[0] ?? null;
  if (
    recoveryCandidates.length > 1 ||
    (preexistingActiveTask && recoveryCandidate?.id !== preexistingActiveTask.id) ||
    (recoveryCandidate &&
      (recoveryCandidate.title !== proposal.title ||
        recoveryCandidate.objective !== proposal.objective ||
        recoveryCandidate.sourceChannel !== proposal.sourceChannel ||
        recoveryCandidate.status !== "ready" ||
        recoveryCandidate.acceptanceCriteria.length !== 1))
  ) {
    ctx.proposalStore.update({
      ...proposal,
      status: "blocked",
      blockedReason: "proposal recovery marker is ambiguous or mismatched",
      updatedAt: now,
    });
    throw new ModeSwitchError("proposal_blocked", "proposal recovery marker is ambiguous or mismatched");
  }
  const task = recoveryCandidate ?? ctx.store.createTask({
    projectId: project.id,
    title: proposal.title,
    objective: proposal.objective,
    acceptanceCriteria: [proposalMarker],
    sourceChannel: proposal.sourceChannel,
  });
  const trustedProject = project.trusted ? project : ctx.store.setProjectTrusted(project.id, true);
  const switched: Conversation = {
    ...conversation,
    activeTaskId: task.id,
    mode: "work",
    updatedAt: now,
  };
  ctx.saveConversation(switched);
  const confirmed = ctx.proposalStore.update({
    ...proposal,
    projectId: project.id,
    status: "confirmed",
    taskId: task.id,
    blockedReason: null,
    confirmedBy: input.confirmedBy?.trim() || "owner",
    updatedAt: now,
    confirmedAt: now,
  });
  return {
    conversation: switched,
    project: trustedProject,
    proposal: confirmed,
    task,
    changed: true,
    idempotent: false,
    message: `Owner 已确认「${trustedProject.name}」并激活任务 ${task.id}。`,
  };
}

/** Release a project anchor and settle or pause its task. */
export function exitWork(
  ctx: ModeSwitchContext,
  input: ExitWorkInput,
): ExitWorkResult {
  const conversation = requireConversation(ctx, input.conversationId);
  if (!conversation.activeTaskId) {
    return {
      conversation: {
        ...conversation,
        mode: "chat",
        activeTaskId: null,
      },
      task: null,
      changed: false,
      message: "already floating (no project is anchored)",
    };
  }
  let task = conversation.activeTaskId
    ? ctx.store.getTask(conversation.activeTaskId)
    : null;
  if (task && input.outcome === "completed" && task.status !== "completed") {
    task = ctx.store.setTaskStatus(task.id, "completed");
  }
  const switched: Conversation = {
    ...conversation,
    mode: "chat",
    activeTaskId: null,
    updatedAt: (ctx.now ?? Date.now)(),
  };
  ctx.saveConversation(switched);
  return {
    conversation: switched,
    task,
    changed: true,
    message:
      input.outcome === "completed"
        ? `project anchor released: task '${task?.title ?? "(none)"}' marked completed`
        : "project anchor released: task paused for a later run",
  };
}

/** Report the conversation's wire-compatible anchor label and anchored task. */
export function getMode(
  ctx: ModeSwitchContext,
  conversationId: string,
): ModeGetResult {
  const conversation = requireConversation(ctx, conversationId);
  const task = conversation.activeTaskId
    ? ctx.store.getTask(conversation.activeTaskId)
    : null;
  return {
    conversationId: conversation.id,
    mode: conversation.mode,
    activeTaskId: conversation.activeTaskId,
    projectId: task?.projectId ?? null,
    task,
    pendingProposal: conversation.activeTaskId
      ? null
      : ctx.proposalStore.latestPendingForConversation(conversation.id),
  };
}
