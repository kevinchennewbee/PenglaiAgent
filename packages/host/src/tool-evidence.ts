/**
 * Observational tool evidence (证据轨：数据全部来自观测，零 LLM 自述).
 *
 * When a run's kernel reports a completed tool call, the runner derives the
 * durable Evidence row from the tool layer itself — never from anything the
 * model claims:
 *
 *   - edit : Pi's edit tool returns the real diff it applied
 *            (`details.diff`, computed from the on-disk before/after content
 *            by the tool, not narrated by the model);
 *   - write: the Host re-reads the written file from disk and records the
 *            observed facts (byte size, sha256, bounded content preview);
 *   - bash : the captured command output + exit status is the check result;
 *            commands that look like test runs classify as kind "test";
 *   - other tools keep the generic completion row.
 *
 * Everything here is best-effort: a recording failure never breaks a run —
 * it leaves a host log line and the generic row still lands.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { openRegularFileNoFollow } from "./security/private-file.js";
import * as crypto from "node:crypto";
import type { Evidence } from "@penglai/protocol";
import type { ProductStore } from "./storage/product-store.js";
import { isWithinWorkspace } from "./jail.js";

/** Bounded text budget for one evidence summary (diff / output / preview). */
export const MAX_TOOL_EVIDENCE_CHARS = 12 * 1024;
/** Bounded on-disk read for the write-observation preview. */
const MAX_WRITE_OBSERVE_BYTES = 64 * 1024;
const MAX_WRITE_PREVIEW_CHARS = 8 * 1024;

export interface ToolEvidenceContext {
  store: ProductStore;
  taskId: string;
  runId: string | null;
  stepId: string | null;
  /** The jail root the episode runs in (project.rootPath). */
  workspaceRoot: string;
  toolCallId: string | null;
  toolName: string | null;
  /** Tool arguments captured at tool.started (empty when unknown). */
  args: Record<string, unknown>;
  /** The raw tool result payload from tool_execution_end. */
  result: unknown;
  isError: boolean;
  log?: (line: string) => void;
}

/** Test-run command heuristic (classification only; content stays observed). */
const TEST_COMMAND_RE =
  /\b(vitest|jest|mocha|pytest|py\.test|go\s+test|cargo\s+test|npm\s+(run\s+)?test|pnpm\s+(run\s+)?test|yarn\s+test|bun\s+test|mvn\s+(verify|test)|gradle(w)?\s+test|xcodebuild\s+test|swift\s+test|ctest)\b/i;

function bound(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Tail-bounded text: keeps the end (exit lines / failures live there). */
function tail(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(-(max - 1))}`;
}

/** Extract the concatenated text of a Pi tool result ({content:[{text}]}). */
function resultText(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) {
    return typeof result === "string" ? result : "";
  }
  return content
    .map((part) =>
      part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? ((part as { text: string }).text as string)
        : "",
    )
    .filter((text) => text.length > 0)
    .join("\n");
}

function resultDetails(result: unknown): Record<string, unknown> | null {
  const details = (result as { details?: unknown })?.details;
  return details && typeof details === "object" && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : null;
}

function argString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Record the durable Evidence row for one completed tool call. Returns the
 * row (null when recording failed — the run must never depend on evidence).
 */
export function recordToolEvidence(ctx: ToolEvidenceContext): Evidence | null {
  try {
    switch (ctx.toolName) {
      case "edit":
        return recordEditEvidence(ctx);
      case "write":
        return recordWriteEvidence(ctx);
      case "bash":
        return recordBashEvidence(ctx);
      default:
        return ctx.store.addEvidence({
          taskId: ctx.taskId,
          runId: ctx.runId,
          stepId: ctx.stepId,
          kind: "log",
          title: `${ctx.toolName ?? "tool"} ${ctx.isError ? "failed" : "completed"}`,
          summary: ctx.isError
            ? "Pi reported a tool error"
            : "Pi completed the tool call",
          metadata: {
            toolCallId: ctx.toolCallId,
            toolName: ctx.toolName ?? null,
            isError: ctx.isError,
          },
        });
    }
  } catch (error) {
    ctx.log?.(
      `tool evidence recording failed for ${ctx.toolName ?? "tool"}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** edit: the tool's own applied diff (details.diff) is the change record. */
function recordEditEvidence(ctx: ToolEvidenceContext): Evidence | null {
  const details = resultDetails(ctx.result);
  const diff = typeof details?.diff === "string" ? details.diff : "";
  const relPath = argString(ctx.args, "path") ?? "(unknown path)";
  const firstChangedLine =
    typeof details?.firstChangedLine === "number" ? details.firstChangedLine : null;
  const text = resultText(ctx.result);
  return ctx.store.addEvidence({
    taskId: ctx.taskId,
    runId: ctx.runId,
    stepId: ctx.stepId,
    kind: "diff",
    title: `edit ${relPath}`,
    summary: bound(
      diff || text || (ctx.isError ? "edit failed" : "(no diff reported)"),
      MAX_TOOL_EVIDENCE_CHARS,
    ),
    metadata: {
      path: relPath,
      firstChangedLine,
      toolCallId: ctx.toolCallId,
      isError: ctx.isError,
      // The diff was generated by the edit tool from on-disk content.
      provenance: "tool-observed",
    },
  });
}

/** write: re-read the file from disk — the observed post-write state. */
function recordWriteEvidence(ctx: ToolEvidenceContext): Evidence | null {
  const relArg = argString(ctx.args, "path") ?? "(unknown path)";
  let observed: {
    relPath: string;
    bytes: number;
    sha256: string;
    preview: string;
    truncated: boolean;
  } | null = null;
  if (!ctx.isError) {
    try {
      const abs = path.resolve(ctx.workspaceRoot, relArg);
      const real = fs.realpathSync(abs);
      if (isWithinWorkspace(ctx.workspaceRoot, real)) {
        const opened = openRegularFileNoFollow(real);
        let buffer: Buffer;
        try {
          buffer = fs.readFileSync(opened.descriptor);
        } finally {
          fs.closeSync(opened.descriptor);
        }
        const slice = buffer.subarray(0, MAX_WRITE_OBSERVE_BYTES);
        // Both ends realpath-resolved before relativizing (macOS /var → /private/var).
        const realRoot = fs.realpathSync(ctx.workspaceRoot);
        observed = {
          relPath: path.relative(realRoot, real) || path.basename(real),
          bytes: buffer.length,
          sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
          preview: bound(slice.toString("utf-8"), MAX_WRITE_PREVIEW_CHARS),
          truncated: buffer.length > MAX_WRITE_OBSERVE_BYTES,
        };
      }
    } catch {
      observed = null; // fall through to the un-observed row
    }
  }
  return ctx.store.addEvidence({
    taskId: ctx.taskId,
    runId: ctx.runId,
    stepId: ctx.stepId,
    kind: "diff",
    title: `write ${observed?.relPath ?? relArg}`,
    summary: observed
      ? `写入 ${observed.relPath}（${observed.bytes} 字节 · sha256 ${observed.sha256.slice(0, 12)}）\n${observed.preview}`
      : bound(
          resultText(ctx.result) || (ctx.isError ? "write failed" : "(file not observed)"),
          MAX_TOOL_EVIDENCE_CHARS,
        ),
    metadata: {
      path: observed?.relPath ?? relArg,
      bytes: observed?.bytes ?? null,
      sha256: observed?.sha256 ?? null,
      previewTruncated: observed?.truncated ?? null,
      toolCallId: ctx.toolCallId,
      isError: ctx.isError,
      // "disk-observed": the Host re-read the file; "tool-reported" otherwise.
      provenance: observed ? "disk-observed" : "tool-reported",
    },
  });
}

/** bash: the captured output/exit is the check result (test-like → "test"). */
function recordBashEvidence(ctx: ToolEvidenceContext): Evidence | null {
  const command = argString(ctx.args, "command") ?? "(unknown command)";
  const details = resultDetails(ctx.result);
  const truncation = details?.truncation ?? null;
  const output = resultText(ctx.result);
  const isTest = TEST_COMMAND_RE.test(command);
  return ctx.store.addEvidence({
    taskId: ctx.taskId,
    runId: ctx.runId,
    stepId: ctx.stepId,
    kind: isTest ? "test" : "command",
    title: bound(command, 120),
    summary: tail(output || (ctx.isError ? "command failed" : "(no output)"), MAX_TOOL_EVIDENCE_CHARS),
    metadata: {
      command,
      exitOk: !ctx.isError,
      truncation,
      toolCallId: ctx.toolCallId,
      provenance: "tool-observed",
    },
  });
}
