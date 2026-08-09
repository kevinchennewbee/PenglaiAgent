/**
 * Penglai Host - M0 spike entry point
 *
 * Minimal bootable process. Proves TS toolchain works.
 * In M1 this becomes the real Host wrapping Pi.
 */

import type { Conversation, Workspace } from "@penglai/protocol";
import { SCHEMA_VERSION } from "@penglai/protocol";

export type {
  AgentKernel,
  KernelEvent,
  KernelEventKind,
  KernelEventListener,
  KernelInputSource,
  KernelPrompt,
} from "./kernel/kernel.js";
export {
  createPiKernel,
  PI_ENGINE_VERSION,
} from "./kernel/pi-kernel.js";
export type { CreatePiKernelOptions } from "./kernel/pi-kernel.js";

// The home-grown agent loop (agent.ts), its M0 faux predecessor (loop.ts,
// faux-model.ts) and its private model client (provider.ts) were retired and
// deleted: TaskRunner delegates execution exclusively to the Pi AgentKernel.

// M1 public API
export { isWithinWorkspace, assertInWorkspace, resolveInWorkspace } from "./jail.js";
export {
  saveMessage,
  loadMessages,
  listConversations,
  conversationsBaseDir,
  penglaiHome,
} from "./conversation-store.js";
export { checkPolicy, isSensitivePath } from "./policy.js";
export type { PolicyDecision, PolicyProfileSpec } from "./policy.js";
export { resumeConversation } from "./resume.js";
export type { ResumeResult } from "./resume.js";
export { startServer } from "./server.js";
export type { ServerOptions, StartedServer, HostHandle } from "./server.js";
// M4: background services + doctor
export { SchedulerService, AutonomousService, CompanionService } from "./services.js";
export type {
  ScheduledTask,
  InboundEvent,
  ServiceOptions,
  CompanionSource,
  CompanionOptions,
} from "./services.js";
export { runDoctor } from "./doctor.js";
export type { DoctorResult, DoctorStatus, DoctorOptions } from "./doctor.js";
export { penglaiDataDir } from "./data-dir.js";
export { createProductionPiKernel } from "./kernel/create-production-pi-kernel.js";
export type { ProductionPiKernelOptions } from "./kernel/create-production-pi-kernel.js";
export { TaskRunner } from "./task-runner.js";
export type {
  StartTaskOptions,
  TaskKernelFactory,
  TaskKernelOptions,
} from "./task-runner.js";
export type {
  ConversationExecutor,
  ConversationImageAttachment,
  ConversationPromptInput,
  ConversationPromptResult,
} from "./conversation-executor.js";
export { ProductStore } from "./storage/product-store.js";
export type {
  AddEvidenceInput,
  CreateProjectInput,
  CreateRunInput,
  CreateStepInput,
  CreateTaskInput,
  RecordRunCheckpointInput,
  RequestApprovalInput,
  TaskBundle,
} from "./storage/product-store.js";
export {
  findPiSessionFile,
  indexRunCheckpoint,
  piSessionsRoot,
  sweepMissingCheckpoints,
} from "./checkpoints.js";
export type { SweepResult } from "./checkpoints.js";
export { localDay } from "./usage.js";
export { BudgetService, BUDGET_DIMENSION_DAY, projectDimension } from "./budget.js";
export type { BudgetEvent, BudgetGate } from "./budget.js";
export { DistillService, sopNameFor } from "./distill/distill.js";
export type {
  DistillOutcome,
  DistillRunInput,
  DistillServiceDeps,
} from "./distill/distill.js";
export { auditCandidateSop, SOP_AUDIT_RULES } from "./distill/audit.js";
export type { AuditFinding, AuditRule, AuditVerdict, LlmAuditor } from "./distill/audit.js";
export {
  buildReviewPrompt,
  callReviewModelHttp,
  transcriptExcerptFromSession,
  NO_SOP_SENTINEL,
} from "./distill/review.js";
export type { ReviewModelRequest, ReviewPrompt } from "./distill/review.js";

/**
 * Create a workspace (M0: in-memory only, no persistence).
 */
export function createWorkspace(rootPath: string, name: string): Workspace {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `ws_${Date.now().toString(36)}`,
    rootPath,
    name,
    trust: { mode: "project", extraReadRoots: [], extraWriteRoots: [] },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Create a conversation (M0: in-memory only).
 */
export function createConversation(workspaceId: string, title: string, modelProfileId: string): Conversation {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `conv_${Date.now().toString(36)}`,
    workspaceId,
    title,
    status: "idle",
    modelProfileId,
    mode: "chat",
    activeTaskId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    endedAt: null,
  };
}

// Boot message (proves the process can start)
if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  console.log(`Penglai Host M0 - schemaVersion=${SCHEMA_VERSION}`);
  console.log("Boot OK. Use tests to verify contracts.");
}
