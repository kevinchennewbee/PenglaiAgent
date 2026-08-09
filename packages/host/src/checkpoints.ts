/**
 * Lightweight run checkpoints (the worldline replacement).
 *
 * When a Run ends, the engine's own session transcript — the Pi session
 * JSONL under `<data-dir>/pi-sessions/<encoded-cwd>/<ts>_<runId>.jsonl` — is
 * indexed as the engine attachment: runId → session path + task summary +
 * budget usage, durable in the product store and visible in the task bundle.
 *
 * Crash recovery: the product database marks interrupted runs failed on boot
 * (recoverInterruptedRuns); the sweep here then indexes any session file the
 * dead process left behind, so the task view — what ran, where it stopped,
 * what the engine saw — is rebuilt from observation, never from LLM自述.
 * Arbitrary node-level rewind is explicitly out of scope (发布后 candidate).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Run, RunCheckpoint, Task } from "@penglai/protocol";
import type { ProductStore } from "./storage/product-store.js";

/** Directory the production kernel factory writes Pi sessions into. */
export function piSessionsRoot(dataDir: string): string {
  return path.join(dataDir, "pi-sessions");
}

/**
 * Locate the Pi session JSONL for a session. Files are named
 * `<timestamp>_<sessionId>.jsonl` (or `<sessionId>.jsonl`). The session id is
 * the run id for task-only runs and `conv_<conversationId>` for runs started
 * from a conversation surface (the kernel's `sessionId`). Matching by suffix
 * keeps this indexer independent of the engine's per-workspace directory
 * encoding.
 *
 * @param sessionId the engine session id (kernel.sessionId) to match
 * @param taskId    optional: when the suffix does not match, fall back to
 *                  scanning `conv_*` session files whose JSONL metadata
 *                  carries this task id (crash-recovery sweep for
 *                  conversation-started runs)
 */
export function findPiSessionFile(
  dataDir: string,
  sessionId: string,
  taskId?: string | null,
): string | null {
  const root = piSessionsRoot(dataDir);
  let workspaceDirs: fs.Dirent[];
  try {
    workspaceDirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null; // no sessions root at all
  }
  const suffix = `_${sessionId}.jsonl`;
  for (const entry of workspaceDirs) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (file.endsWith(suffix) || file === `${sessionId}.jsonl`) {
        return path.join(dir, file);
      }
    }
    // Crash-sweep fallback for conversation-started runs: the session id
    // (conv_<conversationId>) cannot be derived from the run row, but the
    // session file's JSONL metadata carries the task id.
    if (taskId) {
      for (const file of files) {
        if (!file.includes("_conv_")) continue;
        const candidate = path.join(dir, file);
        try {
          const firstLine = fs
            .readFileSync(candidate, "utf-8")
            .split("\n", 1)[0];
          const meta = firstLine ? JSON.parse(firstLine)?.metadata : null;
          if (meta?.taskId === taskId) return candidate;
        } catch {
          continue;
        }
      }
    }
  }
  return null;
}

export interface IndexRunCheckpointInput {
  run: Run;
  task: Task;
  /** Episode counters at stop (0 for crash-swept runs). */
  turns: number;
  toolFailures: number;
  inputTokens: number;
  outputTokens: number;
  /** Absolute session path when already known; otherwise discovered. */
  sessionPath?: string | null;
  /**
   * Engine session id (kernel.sessionId). Conversation-started runs use
   * `conv_<conversationId>`, which the run id alone cannot derive; passing it
   * lets the indexer locate the right engine transcript.
   */
  sessionId?: string;
}

/**
 * Index one run's engine session as its checkpoint. Also attaches the
 * session file to the run's evidence trail (kind "artifact") so the bundle
 * shows the attachment next to the tool/test evidence. Idempotent per run.
 */
export function indexRunCheckpoint(
  store: ProductStore,
  dataDir: string,
  input: IndexRunCheckpointInput,
): RunCheckpoint {
  const sessionPath =
    input.sessionPath !== undefined
      ? input.sessionPath
      : findPiSessionFile(dataDir, input.sessionId ?? input.run.id, input.task.id) ??
        // Fallback: some kernels report a session id that does not match the
        // file naming; always try the run id too so the engine transcript is
        // still indexed.
        findPiSessionFile(dataDir, input.run.id, input.task.id);
  const checkpoint = store.recordRunCheckpoint({
    runId: input.run.id,
    taskId: input.task.id,
    sessionPath,
    taskTitle: input.task.title,
    taskObjective: input.task.objective,
    status: input.run.status,
    turns: input.turns,
    toolFailures: input.toolFailures,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    budget: input.run.budget,
  });
  if (sessionPath) {
    // Evidence is append-only; attach the session file once per run even when
    // both the settle path and the crash-recovery sweep index it.
    const bundle = store.getTaskBundle(input.task.id);
    const hasAttachment = bundle?.evidence.some(
      (e) => e.metadata?.checkpointRunId === input.run.id,
    );
    if (!hasAttachment) {
      store.addEvidence({
        taskId: input.task.id,
        runId: input.run.id,
        kind: "artifact",
        title: "Engine session checkpoint",
        summary:
          `Pi session transcript for run ${input.run.id} ` +
          `(status ${input.run.status}; turns=${input.turns}, ` +
          `toolFailures=${input.toolFailures}, ` +
          `tokens=${input.inputTokens + input.outputTokens}).`,
        uri: sessionPath,
        metadata: {
          checkpointRunId: input.run.id,
          engine: "pi",
          sessionPath,
        },
      });
    }
  }
  return checkpoint;
}

export interface SweepResult {
  /** Runs that gained a checkpoint row during this sweep. */
  indexed: string[];
  /** Stopped runs with no checkpoint row and no session file on disk. */
  missing: string[];
}

/**
 * Crash-recovery sweep: every stopped run without a checkpoint row gets one
 * when its engine session file is still on disk. Counters are unknowable
 * post-crash and stay 0 — the checkpoint exists to rebuild the task view,
 * not to audit the dead episode's budget usage.
 */
export function sweepMissingCheckpoints(
  store: ProductStore,
  dataDir: string,
): SweepResult {
  const result: SweepResult = { indexed: [], missing: [] };
  for (const run of store.listRunsMissingCheckpoint()) {
    const sessionPath = findPiSessionFile(dataDir, run.id, run.taskId);
    if (!sessionPath) {
      result.missing.push(run.id);
      continue;
    }
    const task = store.getTask(run.taskId);
    if (!task) {
      result.missing.push(run.id);
      continue;
    }
    indexRunCheckpoint(store, dataDir, {
      run,
      task,
      turns: 0,
      toolFailures: 0,
      inputTokens: 0,
      outputTokens: 0,
      sessionPath,
    });
    result.indexed.push(run.id);
  }
  return result;
}
