/**
 * penglai CLI — non-chat commands.
 *
 * Every command is a thin composition over the Host's JSON-RPC surface: the
 * CLI holds no product state (Host 能做的，CLI 必须全能做 — the CLI is the
 * acceptance surface for host completeness).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Conversation, ModelProfile, RunCheckpoint, UsageReport } from "@penglai/protocol";
import { runDoctor } from "../doctor.js";
import { exportDiagnostics } from "../diagnostics.js";
import { penglaiDataDir } from "../data-dir.js";
import { localDay } from "../usage.js";
import { MemoryStore } from "../memory.js";
import { runIdentityCeremony } from "./identity-ceremony.js";
import type { CatalogOverlayEntry } from "../providers/overlay.js";
import { calibrationLine } from "../providers/overlay.js";
import type { RefreshReport } from "../providers/refresh.js";
import { CliError, HostClient } from "./client.js";
import {
  createReadlinePrompter,
  runSetupWizard,
  type WizardPrompter,
} from "./setup-wizard.js";
import {
  count,
  flagValue,
  oneLine,
  parseArgs,
  shortId,
  styleFor,
  timeAgo,
  type CliIO,
  type ParsedArgs,
  type Style,
} from "./format.js";

export interface CommandContext {
  client: HostClient;
  io: CliIO;
  style: Style;
}

export function makeContext(client: HostClient, io: CliIO): CommandContext {
  return { client, io, style: styleFor(io.tty) };
}

function requireArg(args: ParsedArgs, index: number, what: string): string {
  const value = args.positionals[index];
  if (!value) throw new CliError(`missing ${what} (see \`penglai help\`)`);
  return value;
}

// ── conversation resolution (deterministic: explicit > most recent) ──

async function resolveConversationId(
  ctx: CommandContext,
  explicit?: string,
): Promise<string> {
  if (explicit) return explicit;
  const conversations = (await ctx.client.rpc("conversation.list", {})) as Conversation[];
  if (conversations.length === 0) {
    throw new CliError("no conversation yet — start one with `penglai chat`");
  }
  return conversations[0].id;
}

// ── status ─────────────────────────────────────────────────────

export async function cmdStatus(ctx: CommandContext): Promise<number> {
  const { io, style } = ctx;
  const handshake = await ctx.client.health();
  io.line(
    `host     ${style.green("ok")} · v${handshake.productVersion} · 127.0.0.1:${ctx.client.port} ` +
      style.dim(`· instance ${shortId(handshake.instanceId)}`),
  );

  const conversations = (await ctx.client.rpc("conversation.list", {})) as Conversation[];
  const current = conversations[0];
  if (current) {
    let anchorLine = "anchor floating";
    try {
      const mode = await ctx.client.rpc("mode.get", { conversationId: current.id });
      if (mode.mode === "work" && mode.task) {
        anchorLine = `anchor project · task ${shortId(mode.task.id)} "${oneLine(mode.task.title, 40)}" (${mode.task.status})`;
      }
    } catch {
      /* mode.get is best-effort in the status view */
    }
    io.line(
      `chat     ${shortId(current.id)} "${oneLine(current.title, 48)}" · ${anchorLine} · ${style.dim(timeAgo(current.updatedAt))}`,
    );
  } else {
    io.line(`chat     ${style.dim("no conversation yet — `penglai chat` to start")}`);
  }

  const projects = await ctx.client.rpc("project.list", {});
  const active: Array<{ task: any; project: any }> = [];
  for (const project of projects) {
    const tasks = await ctx.client.rpc("task.list", { projectId: project.id });
    for (const task of tasks) {
      if (["running", "blocked", "waiting_approval", "ready"].includes(task.status)) {
        active.push({ task, project });
      }
    }
  }
  if (active.length === 0) {
    io.line(`tasks    ${style.dim("none active")}`);
  } else {
    io.line(`tasks    ${active.length} active`);
    for (const { task, project } of active.slice(0, 5)) {
      io.line(
        `         ${task.status.padEnd(9)} ${oneLine(task.title, 44)} ` +
          style.dim(`· ${oneLine(project.name, 20)} · ${timeAgo(task.updatedAt)}`),
      );
    }
  }

  const report = (await ctx.client.rpc("usage.get", {})) as UsageReport;
  const today = localDay();
  const todayRows = report.rows.filter((row) => row.day === today);
  const todayTokens = todayRows.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0);
  const todayRequests = todayRows.reduce((sum, row) => sum + row.requests, 0);
  const chatTokens = todayRows
    .filter((row) => row.mode === "chat")
    .reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0);
  io.line(
    `usage    today ${count(todayTokens)} tokens (chat ${count(chatTokens)} / work ${count(todayTokens - chatTokens)}) · ${todayRequests} requests`,
  );
  io.line(
    `         total ${count(report.totalTokens)} tokens · ${report.totalRequests} requests`,
  );

  // 成本熔断（design §7）：配置了上限的维度在 status 里常显；撞线红显。
  try {
    const budget = await ctx.client.rpc("budget.status", {});
    const rows = (budget.dimensions as Array<{
      dimension: string;
      limitTokens: number | null;
      usedTokens: number;
      ratio: number | null;
      tripped: boolean;
      lifted: boolean;
      warned: boolean;
    }>).filter((row) => row.limitTokens !== null);
    if (rows.length > 0) {
      const parts = rows.map((row) => {
        const label = row.dimension === "day" ? "全局日" : `项目 ${shortId(row.dimension.slice("project:".length))}`;
        const pct = row.ratio === null ? "" : ` ${Math.round(row.ratio * 100)}%`;
        const state =
          row.tripped && !row.lifted
            ? style.red(`已熔断${pct}`)
            : row.warned
              ? style.yellow(`预警${pct}`)
              : style.dim(pct || " 0%");
        return `${label} ${count(row.usedTokens)}/${count(row.limitTokens ?? 0)}${state}`;
      });
      io.line(`budget   ${parts.join(style.dim(" · "))}`);
    }
  } catch {
    /* budget status is best-effort in the status view */
  }
  return 0;
}

// ── doctor ─────────────────────────────────────────────────────

export async function cmdDoctor(
  ctx: CommandContext,
  port: number,
  options: { exportBundle?: boolean } = {},
): Promise<number> {
  const { io, style } = ctx;
  const results = await runDoctor({ port });
  const reachable = await HostClient.probe(`http://127.0.0.1:${port}`, 800);
  const icon = { ok: style.green("✓"), warn: style.yellow("!"), fail: style.red("✗") } as const;
  io.line(
    `${reachable ? icon.ok : icon.warn} host         ${reachable ? `reachable on 127.0.0.1:${port}` : `not reachable on 127.0.0.1:${port} (\`penglai serve\`)`}`,
  );
  let worst = 0;
  for (const result of results) {
    io.line(`${icon[result.status]} ${result.check.padEnd(12)} ${result.message}`);
    if (result.fix && result.status !== "ok") io.line(style.dim(`  → ${result.fix}`));
    if (result.status === "fail") worst = 1;
  }
  if (options.exportBundle) {
    const bundle = await exportDiagnostics({ doctorResults: results });
    io.line(
      `${icon.ok} diagnostics  ${bundle.path} ` +
        style.dim(`· ${bundle.bytes} bytes · ${bundle.includedLogs} logs · ${bundle.redactions} redactions`),
    );
  }
  return worst;
}

// ── mode ───────────────────────────────────────────────────────

export async function cmdMode(ctx: CommandContext, args: ParsedArgs): Promise<number> {
  const conversationId = await resolveConversationId(
    ctx,
    flagValue(args.flags, "conversation"),
  );
  const mode = await ctx.client.rpc("mode.get", { conversationId });
  const { io, style } = ctx;
  io.line(
    `${shortId(conversationId)} · ${style.bold(mode.mode === "work" ? "project anchored" : "floating")}`,
  );
  if (mode.mode === "work" && mode.task) {
    io.line(`  task    ${shortId(mode.task.id)} "${oneLine(mode.task.title, 56)}" (${mode.task.status})`);
    io.line(`  project ${shortId(mode.projectId ?? "")} ${style.dim("· mode.exitWork 可释放项目锚点")}`);
  }
  return 0;
}

// ── work (mode.proposeWork 便捷封装) ───────────────────────────

export async function cmdWork(ctx: CommandContext, args: ParsedArgs): Promise<number> {
  if (args.positionals[0] === "confirm") {
    const proposalId = requireArg(args, 1, "proposal id");
    const confirmedRootPath = requireArg(args, 2, "confirmed project path");
    const conversationId = await resolveConversationId(
      ctx,
      flagValue(args.flags, "conversation"),
    );
    const confirmed = await ctx.client.rpc("mode.confirmWork", {
      proposalId,
      conversationId,
      confirmedRootPath,
      confirmedBy: "cli:owner",
    });
    const { io, style } = ctx;
    io.line(
      `${style.green(confirmed.idempotent ? "already confirmed" : "confirmed")} · ` +
        `conversation ${shortId(conversationId)}`,
    );
    io.line(`  project ${oneLine(confirmed.project.name, 40)} (${confirmed.project.rootPath})`);
    io.line(`  task    ${confirmed.task.id}`);
    io.line(`          "${oneLine(confirmed.task.title, 56)}"`);
    return 0;
  }
  const rootPath = requireArg(args, 0, "project path — penglai work <路径> \"<目标>\"");
  const objective = args.positionals.slice(1).join(" ").trim();
  if (!objective) {
    throw new CliError("missing objective — penglai work <路径> \"<目标>\"");
  }
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    throw new CliError(`project path does not exist: ${rootPath}`);
  }
  const conversationId = await resolveConversationId(
    ctx,
    flagValue(args.flags, "conversation"),
  );
  const proposed = await ctx.client.rpc("mode.proposeWork", {
    conversationId,
    rootPath,
    objective,
    sourceChannel: "api",
  });
  const { io, style } = ctx;
  io.line(
    `work ${style.yellow("pending Owner confirmation")} · conversation ${shortId(conversationId)}`,
  );
  io.line(
    `  project ${oneLine(proposed.projectName, 40)} (${proposed.proposal.canonicalRootPath})` +
      (proposed.reusedProject ? style.dim(" · registered") : style.dim(" · registers only on confirm")),
  );
  io.line(`  proposal ${proposed.proposal.id}`);
  io.line(`           "${oneLine(proposed.proposal.title, 56)}"`);
  io.line(
    style.dim(
      `  confirm  penglai work confirm ${proposed.proposal.id} ${JSON.stringify(proposed.proposal.canonicalRootPath)}`,
    ),
  );
  return 0;
}

// ── project ────────────────────────────────────────────────────

export async function cmdProject(ctx: CommandContext, args: ParsedArgs): Promise<number> {
  const sub = args.positionals[0] ?? "list";
  const { io, style } = ctx;
  if (sub === "list") {
    const projects = await ctx.client.rpc("project.list", {
      includeArchived: args.flags.all === true,
    });
    if (projects.length === 0) {
      io.line(style.dim("no projects — `penglai work <路径> \"<目标>\"` 锚定一个"));
      return 0;
    }
    for (const project of projects) {
      io.line(
        `${project.trusted ? style.green("trusted ") : style.yellow("pending ")} ${shortId(project.id)} ${oneLine(project.name, 32)} ${style.dim(project.rootPath)}`,
      );
    }
    return 0;
  }
  if (sub === "show") {
    const projectId = requireArg(args, 1, "project id");
    const { project, tasks } = await ctx.client.rpc("project.get", { projectId });
    io.line(`${oneLine(project.name, 56)} ${style.dim(`(${project.id})`)}`);
    io.line(`  root    ${project.rootPath}`);
    io.line(
      `  trust   ${project.trusted ? style.green("trusted") : style.yellow("not trusted — `penglai project trust " + project.id + "`")}`,
    );
    io.line(`  tasks   ${tasks.length}`);
    for (const task of tasks.slice(0, 10)) {
      io.line(`          ${task.status.padEnd(9)} ${shortId(task.id)} ${oneLine(task.title, 44)}`);
    }
    return 0;
  }
  if (sub === "trust" || sub === "untrust") {
    const projectId = requireArg(args, 1, "project id");
    const { project } = await ctx.client.rpc("project.get", { projectId });
    if (sub === "trust") {
      await ctx.client.rpc("project.trust", {
        projectId,
        // The owner typing the command IS the confirmation; the RPC still
        // requires the path to match the registered root.
        confirmedRootPath: project.rootPath,
      });
      io.line(`${style.green("trusted")} ${project.name} (${project.rootPath})`);
    } else {
      await ctx.client.rpc("project.untrust", { projectId });
      io.line(`${style.yellow("untrusted")} ${project.name}`);
    }
    return 0;
  }
  throw new CliError(`unknown project subcommand: ${sub} (list|show|trust|untrust)`);
}

// ── task ───────────────────────────────────────────────────────

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
const RUN_END_EVENTS = new Set([
  "task.run.completed",
  "task.run.failed",
  "task.run.cancelled",
  "task.run.blocked",
  "task.run.paused",
]);

interface RunOutcome {
  status: string;
  error?: string | null;
}

/**
 * Subscribe to the task channel BEFORE the run starts so no frame is lost.
 * The handler tolerates events arriving before the run id is known (a task
 * has at most one active run), and a slow poll of the durable run row is
 * the backstop against a dropped frame.
 */
async function startTaskFlow(
  ctx: CommandContext,
  args: ParsedArgs,
  taskId: string,
): Promise<number> {
  const { io, style } = ctx;
  const bundle = await ctx.client.rpc("task.get", { taskId });
  const project = (await ctx.client.rpc("project.get", {
    projectId: bundle.task.projectId,
  })) as { project: any };

  let modelProfileId = flagValue(args.flags, "profile") ?? project.project.defaultModelProfileId;
  if (!modelProfileId) {
    const resolved = await ctx.client.rpc("config.resolveProfile", {});
    if (!resolved.profile) {
      throw new CliError(
        "no model profile has an API key — run `penglai setup`（首次运行向导）, " +
          "set GROK_API_KEY / DEEPSEEK_API_KEY / ZAI_API_KEY / OPENAI_API_KEY, " +
          "or `penglai config add` a custom endpoint",
      );
    }
    modelProfileId = resolved.profile.id;
  }
  if (!project.project.trusted) {
    throw new CliError(
      `project is not trusted for execution — \`penglai project trust ${project.project.id}\` first`,
    );
  }

  let runId: string | null = null;
  let settled: RunOutcome | null = null;
  const unsubscribe = await ctx.client.subscribe(taskId, (event) => {
    if (runId && event.runId && event.runId !== runId) return;
    if (event.event === "message.delta" && typeof event.textDelta === "string") {
      ctx.io.out(event.textDelta);
    } else if (event.event === "tool.started") {
      io.line(style.dim(`\n  ⚙ ${String(event.toolName ?? "tool")}…`));
    } else if (event.event === "tool.completed") {
      io.line(
        style.dim(
          `  ⚙ ${String(event.toolName ?? "tool")} ${event.isError ? "failed" : "done"}`,
        ),
      );
    } else if (event.event === "task.run.waiting_approval") {
      const approval = event.approval as
        | { id?: string; capability?: string; action?: string }
        | undefined;
      const id = shortId(String(approval?.id ?? ""));
      io.line(
        style.yellow(
          `\n  ⏸ 等待审批 [${String(approval?.capability ?? "")}] ${oneLine(String(approval?.action ?? ""), 56)}`,
        ),
      );
      io.line(
        style.dim(
          `    penglai approval approve ${id}（可加 --remember 同类免问）· penglai approval reject ${id}`,
        ),
      );
    } else if (event.event === "task.run.resumed") {
      io.line(style.dim("  审批已决定，run 继续"));
    } else if (event.event === "budget.warning" || event.event === "budget.tripped") {
      // 成本熔断播报（该任务/项目维度撞线或预警时实时可见）。
      io.line(
        (event.event === "budget.tripped" ? style.red : style.yellow)(
          `\n  [预算] ${oneLine(String(event.message ?? ""), 120)}`,
        ),
      );
    } else if (typeof event.event === "string" && RUN_END_EVENTS.has(event.event)) {
      settled = { status: String(event.event).replace("task.run.", "") };
    }
  });

  const run = await ctx.client.rpc("task.start", {
    taskId,
    modelProfileId,
    source: "cli",
  });
  runId = run.id;
  io.line(
    style.dim(`run ${shortId(run.id)} started on profile ${run.modelProfileId} — Ctrl+C 中断`),
  );

  let interrupted = false;
  const onSigint = (): void => {
    if (interrupted) return;
    interrupted = true;
    void ctx.client.rpc("task.abort", { runId: run.id }).catch(() => undefined);
  };
  process.on("SIGINT", onSigint);
  try {
    while (!settled) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (settled) break;
      const latest = await ctx.client.rpc("task.get", { taskId }).catch(() => null);
      const row = latest?.runs?.find((r: any) => r.id === runId);
      if (!row) continue;
      if (
        TERMINAL_RUN_STATUSES.has(row.status) ||
        row.status === "blocked" ||
        row.status === "paused"
      ) {
        settled = { status: row.status, error: row.error };
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    unsubscribe();
  }
  io.line("");
  const outcome = settled;
  const ok = outcome.status === "completed" || outcome.status === "paused";
  io.line(
    ok
      ? style.green(`run ${outcome.status}`) + style.dim(` · penglai task show ${taskId}`)
      : style.red(`run ${outcome.status}`) + (outcome.error ? style.dim(` · ${oneLine(outcome.error, 120)}`) : ""),
  );
  return ok ? 0 : 1;
}

export async function cmdTask(ctx: CommandContext, args: ParsedArgs): Promise<number> {
  const sub = args.positionals[0] ?? "list";
  const { io, style } = ctx;

  if (sub === "list") {
    const projectFilter = flagValue(args.flags, "project");
    const projects = (await ctx.client.rpc("project.list", {})) as any[];
    const lines: string[] = [];
    for (const project of projects) {
      if (projectFilter && project.id !== projectFilter) continue;
      const tasks = (await ctx.client.rpc("task.list", { projectId: project.id })) as any[];
      for (const task of tasks) {
        if (task.status === "archived" && args.flags.all !== true) continue;
        lines.push(
          `${task.status.padEnd(9)} ${shortId(task.id)} ${oneLine(task.title, 48)} ` +
            style.dim(`· ${oneLine(project.name, 18)} · ${timeAgo(task.updatedAt)}`),
        );
      }
    }
    if (lines.length === 0) {
      io.line(style.dim("no tasks — `penglai work <路径> \"<目标>\"` 开一个"));
      return 0;
    }
    for (const line of lines) io.line(line);
    return 0;
  }

  if (sub === "show") {
    const taskId = requireArg(args, 1, "task id");
    const bundle = await ctx.client.rpc("task.get", { taskId });
    const { task } = bundle;
    io.line(`${style.bold(oneLine(task.title, 64))} ${style.dim(`(${task.id})`)}`);
    io.line(`  status    ${task.status}`);
    io.line(`  objective ${oneLine(task.objective, 100)}`);
    io.line(
      `  origin    ${task.sourceChannel} · created ${timeAgo(task.createdAt)} · updated ${timeAgo(task.updatedAt)}`,
    );
    for (const run of bundle.runs) {
      const budget = run.budget ?? {};
      io.line(
        `  run #${run.sequence} ${run.status.padEnd(9)} ${style.dim(
          `budget ${budget.maxTurns ?? "∞"} turns / ${budget.maxTokens ? count(budget.maxTokens) : "∞"} tokens / ${budget.maxToolFailures} failures`,
        )}`,
      );
      const checkpoint = bundle.checkpoints.find(
        (c: RunCheckpoint) => c.runId === run.id,
      );
      if (checkpoint) {
        io.line(
          style.dim(
            `           checkpoint turns=${checkpoint.turns} tokens=${count(checkpoint.inputTokens + checkpoint.outputTokens)}` +
              (checkpoint.sessionPath ? ` session ${checkpoint.sessionPath}` : " (no session file)"),
          ),
        );
      }
      if (run.error) io.line(style.dim(`           ${oneLine(run.error, 110)}`));
    }
    io.line(
      `  steps ${bundle.steps.length} · evidence ${bundle.evidence.length} · approvals ${bundle.approvals.length}`,
    );
    return 0;
  }

  if (sub === "start" || sub === "resume") {
    const taskId = requireArg(args, 1, "task id");
    // resume = a fresh run; the durable checkpoint is what it resumes from.
    return startTaskFlow(ctx, args, taskId);
  }

  if (sub === "pause" || sub === "cancel") {
    const taskId = requireArg(args, 1, "task id");
    const result = await ctx.client.rpc(`task.${sub}`, { taskId });
    const done = sub === "pause" ? result.paused : result.cancelled;
    if (done) {
      const verb = sub === "pause" ? "paused" : "cancelled";
      const hint = sub === "pause" ? "resume" : "start";
      io.line(
        `${verb} run ${shortId(result.runId)} ` +
          style.dim(`· penglai task ${hint} ${taskId} 可续`),
      );
    } else {
      io.line(style.dim(result.message ?? `nothing to ${sub}`));
    }
    return 0;
  }

  throw new CliError(`unknown task subcommand: ${sub} (list|show|start|pause|resume|cancel)`);
}

// ── approval (审批四级制) ──────────────────────────────────────

/** The CLI's decision identity (决策溯源: 谁批准的). */
function cliIdentity(): string {
  try {
    return `cli:${os.userInfo().username}`;
  } catch {
    return "cli";
  }
}

interface ApprovalRow {
  id: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  capability: string;
  action: string;
  reason: string;
  status: string;
  requestedBy: string;
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: number;
  decidedAt: number | null;
}

export async function cmdApproval(ctx: CommandContext, args: ParsedArgs): Promise<number> {
  const sub = args.positionals[0] ?? "list";
  const { io, style } = ctx;

  if (sub === "list") {
    const rows = (await ctx.client.rpc("approval.list", {
      status: args.flags.all === true ? "all" : "pending",
    })) as ApprovalRow[];
    if (rows.length === 0) {
      io.line(style.dim(args.flags.all === true ? "no approvals yet" : "没有待审批项"));
      return 0;
    }
    for (const row of rows) {
      const level = row.capability.startsWith("l3:") ? "L3" : "L2";
      io.line(
        `${row.status.padEnd(9)} ${level} ${row.capability.padEnd(20)} ${oneLine(row.action, 44)} ` +
          style.dim(
            `· ${shortId(row.id)} · task ${shortId(row.taskId)} "${oneLine(row.taskTitle, 20)}" · ${timeAgo(row.createdAt)}`,
          ),
      );
      if (row.status !== "pending" && row.decidedBy) {
        io.line(
          style.dim(
            `           ${row.decidedBy}${row.decisionNote ? ` · ${oneLine(row.decisionNote, 48)}` : ""}`,
          ),
        );
      }
    }
    if (rows.some((row) => row.status === "pending")) {
      io.line(
        style.dim(
          "penglai approval approve <id> [--note \"…\"] [--remember] · penglai approval reject <id> [--note \"…\"]",
        ),
      );
    }
    return 0;
  }

  if (sub === "approve" || sub === "reject") {
    const approvalId = requireArg(args, 1, `approval id — penglai approval ${sub} <id>`);
    const note = flagValue(args.flags, "note");
    const remember = sub === "approve" && args.flags.remember === true;
    const result = (await ctx.client.rpc(`approval.${sub}`, {
      approvalId,
      decidedBy: cliIdentity(),
      note,
      remember,
    })) as { approval: ApprovalRow; grant: { grantKey: string } | null };
    const { approval } = result;
    io.line(
      `${sub === "approve" ? style.green("approved") : style.yellow("denied")} ${shortId(approval.id)} ${oneLine(approval.action, 56)}`,
    );
    if (result.grant) {
      io.line(
        style.green(
          `已记住：本项目「${result.grant.grantKey}」同类免问（授权已落 product-store）`,
        ),
      );
    }
    if (sub === "reject") {
      io.line(style.dim("拒绝理由已回给模型并留痕。"));
    }
    return 0;
  }

  throw new CliError(`unknown approval subcommand: ${sub} (list|approve|reject)`);
}

// ── memory ─────────────────────────────────────────────────────

export async function cmdMemory(ctx: CommandContext, args: ParsedArgs): Promise<number> {
  const sub = args.positionals[0] ?? "list";
  const { io, style } = ctx;
  const projectId = flagValue(args.flags, "project");

  if (sub === "sop") {
    // SOP 技能树（蒸馏环产物）：list / show / remove。写入只走蒸馏环
    // （复盘→候选 SOP→审计→入树），CLI 无写入后门。
    const action = args.positionals[1] ?? "list";
    if (action === "list") {
      const sops = (await ctx.client.rpc("memory.sopList", {})) as Array<{
        name: string;
        title: string;
        sizeBytes: number;
        updatedAt: number;
        sourceTaskId: string | null;
      }>;
      io.line(style.bold("SOP 技能树（全局记忆 · 蒸馏环入树）"));
      if (sops.length === 0) {
        io.line(style.dim("  (空——任务完工后蒸馏环会沉淀过审的 SOP）"));
        return 0;
      }
      for (const sop of sops) {
        io.line(
          `  ${sop.name.padEnd(36)} ${oneLine(sop.title, 40)} ${style.dim(`· ${sop.sizeBytes}B · ${timeAgo(sop.updatedAt)}`)}`,
        );
      }
      io.line(style.dim("  penglai memory sop show <name> 看全文 · remove 移除"));
      return 0;
    }
    if (action === "show") {
      const name = requireArg(args, 2, "sop name — penglai memory sop show <name>");
      const result = await ctx.client.rpc("memory.sopShow", { name });
      io.line(result.content);
      return 0;
    }
    if (action === "remove") {
      const name = requireArg(args, 2, "sop name — penglai memory sop remove <name>");
      const result = (await ctx.client.rpc("memory.sopRemove", { name })) as { ok: boolean };
      io.line(
        result.ok
          ? `${style.yellow("removed")} ${name}（L1 索引已同步）`
          : style.dim(`${name} 不在技能树里`),
      );
      return 0;
    }
    throw new CliError(`unknown memory sop action: ${action} (list|show|remove)`);
  }

  if (sub === "list") {
    if (projectId) {
      const result = await ctx.client.rpc("memory.readProject", { projectId });
      io.line(style.bold(`project memory (${projectId})`));
      if (result.notes.length === 0) io.line(style.dim("  (empty)"));
      for (const note of result.notes) {
        io.line(`  ${note.name.padEnd(24)} ${oneLine(note.title, 48)} ${style.dim(`· ${note.sizeBytes}B`)}`);
      }
      return 0;
    }
    const result = await ctx.client.rpc("memory.readGlobal", {});
    io.line(style.bold("global L1 (≤30 行铁律)"));
    io.line(result.l1.content || style.dim("(empty)"));
    if (result.l1.truncated) io.line(style.yellow("  (L1 超 30 行，注入时已截断)"));
    io.line("");
    io.line(style.bold("global notes"));
    if (result.notes.length === 0) io.line(style.dim("  (none)"));
    for (const note of result.notes) {
      io.line(`  ${note.name.padEnd(24)} ${oneLine(note.title, 48)} ${style.dim(`· ${note.sizeBytes}B`)}`);
    }
    io.line(style.dim("writes stay closed: global 走蒸馏环（M2′），project 仅在项目锚定后"));
    return 0;
  }

  if (sub === "read") {
    const target = requireArg(args, 1, "memory path — <name> | <projectId>/<name>");
    if (projectId) {
      const result = await ctx.client.rpc("memory.readProject", { projectId, name: target });
      io.line(result.content);
      return 0;
    }
    const slash = target.indexOf("/");
    if (slash !== -1) {
      const result = await ctx.client.rpc("memory.readProject", {
        projectId: target.slice(0, slash),
        name: target.slice(slash + 1),
      });
      io.line(result.content);
      return 0;
    }
    const result = await ctx.client.rpc("memory.readGlobal", { name: target });
    io.line(result.content);
    return 0;
  }

  // The anti-pollution iron rules apply to the CLI too: no write backdoor.
  throw new CliError(
    `unknown memory subcommand: ${sub} (list|read|sop) — writes are closed by design ` +
      `(global → 蒸馏环 writeGlobalSop；project → 项目锚定后的内核直写)`,
  );
}

// ── distill（蒸馏环配置） ──────────────────────────────────────

/**
 * `penglai distill` — 蒸馏环面板（design §6/§9）。
 * status = 当前配置；set 配复盘/审计模型档位（走现有 profile，可指定
 * 轻量档；审计位 = 不同 provider 预留接口）。
 */
export async function cmdDistill(ctx: CommandContext, args: ParsedArgs): Promise<number> {
  const sub = args.positionals[0] ?? "status";
  const { io, style } = ctx;

  if (sub === "status") {
    const config = await ctx.client.rpc("distill.getConfig", {});
    io.line(style.bold("distill（蒸馏环：复盘 → 候选 SOP → 审计 → 入树）"));
    io.line(`  状态        ${config.enabled ? style.green("enabled") : style.yellow("disabled")}`);
    io.line(
      `  复盘模型    ${config.reviewProfileId ?? style.dim("（跟随任务档案）")}` +
        style.dim("——可指定轻量档位"),
    );
    io.line(
      `  审计模型    ${config.auditProfileId ?? style.dim("（未配——确定性规则表审计）")}` +
        style.dim("——不同 provider 预留位"),
    );
    return 0;
  }

  if (sub === "set") {
    const params: Record<string, unknown> = { updatedBy: cliIdentity() };
    const review = flagValue(args.flags, "review-profile");
    const audit = flagValue(args.flags, "audit-profile");
    if (review !== undefined) params.reviewProfileId = review === "off" ? null : review;
    if (audit !== undefined) params.auditProfileId = audit === "off" ? null : audit;
    if (args.flags.enable === true) params.enabled = true;
    if (args.flags.disable === true) params.enabled = false;
    if (review === undefined && audit === undefined && args.flags.enable !== true && args.flags.disable !== true) {
      throw new CliError(
        "distill set 需要 --review-profile <id|off> / --audit-profile <id|off> / --enable / --disable",
      );
    }
    const config = await ctx.client.rpc("distill.setConfig", params);
    io.line(
      `${style.green("saved")} 蒸馏环 ${config.enabled ? "enabled" : "disabled"} · ` +
        `复盘 ${config.reviewProfileId ?? "跟随任务档案"} · 审计 ${config.auditProfileId ?? "规则表"}`,
    );
    return 0;
  }

  throw new CliError(`unknown distill subcommand: ${sub} (status|set)`);
}

// ── setup (first-run wizard) ───────────────────────────────────

/** One-line guidance for non-interactive environments (never hangs). */
export const SETUP_NONTTY_GUIDANCE =
  "首次运行需要交互终端来配模型：请在终端里运行 `penglai setup`，" +
  "或用 `penglai config add <id> --base-url <u> --model <m> [--api-key K | --api-key-env VAR]` 手动配置，" +
  "也可以直接 export 内建档案的环境变量（DEEPSEEK_API_KEY / ZAI_API_KEY / GROK_API_KEY / OPENAI_API_KEY）。";

/**
 * The first-run setup wizard (`penglai setup`, and the bare-`penglai`
 * fallback when no key-ready profile exists). Returns the saved profile id,
 * or null when the environment cannot run the interactive wizard (non-tty:
 * one guidance line, never a hang).
 */
export async function cmdSetup(
  ctx: CommandContext,
  prompter?: WizardPrompter,
): Promise<string | null> {
  const { io, style } = ctx;
  if (!io.tty && !prompter) {
    io.err(SETUP_NONTTY_GUIDANCE);
    return null;
  }
  const rl = prompter ? null : createReadlinePrompter();
  const activePrompter = prompter ?? rl!;
  try {
    const result = await runSetupWizard({
      io,
      prompter: activePrompter,
      dataDir: penglaiDataDir(),
      smoke: (input) =>
        ctx.client.rpc("config.smokeTest", {
          baseUrl: input.baseUrl,
          model: input.model,
          apiKey: input.apiKey,
          apiKeyEnv: input.apiKeyEnv,
        }),
      listModels: (input) =>
        ctx.client.rpc("config.listModels", {
          baseUrl: input.baseUrl,
          apiKey: input.apiKey ?? "",
          apiKeyEnv: input.apiKeyEnv ?? "",
        }),
      catalogOverlay: async () => {
        const status = (await ctx.client.rpc("catalog.status", {}).catch(() => null)) as {
          overlay?: CatalogOverlayEntry[];
        } | null;
        return status?.overlay ?? null;
      },
      saveProfile: (input) => ctx.client.rpc("config.createProfile", { ...input }),
    });
    // M3′ 身份诞生环节（可跳过；非 tty/已有身份自动略过；种子 SOP 过审入树）。
    if (result.profileId) {
      const ceremony = await runIdentityCeremony({
        io,
        prompter: activePrompter,
        memory: new MemoryStore(path.join(penglaiDataDir(), "memory", "global")),
      });
      if (!ceremony.ran && ceremony.existingName) {
        io.line(style.dim(`  （身份已在：${ceremony.existingName}——仪式不重复举行）`));
      }
    }
    return result.profileId;
  } finally {
    rl?.close();
  }
}

// ── channel（IM 渠道：飞书先行） ───────────────────────────────

interface ChannelRow {
  channel: string;
  configured: boolean;
  enabled: boolean;
  state: string;
  appId: string | null;
  domain: string | null;
  whitelist: number;
  routes: number;
}

interface ChannelIdentityRow {
  channelUserId: string;
  identity: string;
  note: string | null;
  createdAt: number;
}

/**
 * `penglai channel` — IM 渠道配置面板（飞书先行）。
 * list / setup feishu / allow / deny / disable；白名单与路由是 product-store
 * 持久记录，密钥走 channels.json（0600），CLI 只经手一跳、不落盘。
 */
export async function cmdChannel(ctx: CommandContext, args: ParsedArgs): Promise<number> {
  const sub = args.positionals[0] ?? "list";
  const { io, style } = ctx;

  if (sub === "list") {
    const rows = (await ctx.client.rpc("channel.list", {})) as ChannelRow[];
    // Host always returns the product catalog (feishu/wechat) so desktop can
    // show cards; "none configured" means every row is still unconfigured.
    const configured = rows.filter((row) => row.configured);
    if (rows.length === 0 || configured.length === 0) {
      io.line(style.dim("没有已配置的渠道。接入飞书：`penglai channel setup feishu --app-id <id> --app-secret <secret>`"));
      for (const row of rows) {
        io.line(style.dim(`  ${row.channel}  unconfigured · app —`));
      }
      return 0;
    }
    for (const row of rows) {
      const stateColor =
        row.state === "connected" || row.state === "live" ? style.green : style.yellow;
      io.line(
        `${row.channel}  ${stateColor(row.state)} · app ${row.appId ?? "—"} · ${row.domain ?? ""}`,
      );
      io.line(
        style.dim(
          `  enabled=${row.enabled} · 白名单 ${row.whitelist} · 会话路由 ${row.routes}`,
        ),
      );
    }
    const identities = (await ctx.client.rpc("channel.identities", { channel: "feishu" })) as ChannelIdentityRow[];
    if (identities.length > 0) {
      io.line("");
      io.line(style.bold("白名单（默认拒绝一切未列名用户）"));
      for (const identity of identities) {
        io.line(
          `  ${identity.identity.padEnd(12)} ${identity.channelUserId}${identity.note ? style.dim(` · ${identity.note}`) : ""} ${style.dim(`· ${timeAgo(identity.createdAt)}`)}`,
        );
      }
    }
    return 0;
  }

  if (sub === "setup") {
    const channel = args.positionals[1];
    if (channel !== "feishu") {
      throw new CliError("目前只支持 feishu：`penglai channel setup feishu --app-id <id> --app-secret <secret>`");
    }
    const appId = flagValue(args.flags, "app-id");
    const appSecret = flagValue(args.flags, "app-secret");
    if (!appId || !appSecret) {
      throw new CliError("channel setup feishu 需要 --app-id <id> 和 --app-secret <secret>");
    }
    const result = (await ctx.client.rpc("channel.setup", {
      channel: "feishu",
      appId,
      appSecret,
      domain: flagValue(args.flags, "domain"),
    })) as { ok: boolean; state: string };
    io.line(`feishu ${style.green("configured")} · ws ${result.state}`);
    io.line(
      style.dim(
        "密钥存 <数据目录>/channels.json (0600)；host 重启自启。下一步：`penglai channel allow feishu <open_id>` 放行 owner。",
      ),
    );
    return 0;
  }

  if (sub === "allow") {
    const channel = args.positionals[1];
    const openId = args.positionals[2];
    if (channel !== "feishu" || !openId) {
      throw new CliError("用法：penglai channel allow feishu <open_id> [--name <称呼>] [--note <备注>]");
    }
    const identity = await ctx.client.rpc("channel.allow", {
      channel: "feishu",
      channelUserId: openId,
      identity: flagValue(args.flags, "name"),
      note: flagValue(args.flags, "note"),
    });
    io.line(`${style.green("allowed")} ${identity.channelUserId} → ${identity.identity}`);
    return 0;
  }

  if (sub === "deny") {
    const channel = args.positionals[1];
    const openId = args.positionals[2];
    if (channel !== "feishu" || !openId) {
      throw new CliError("用法：penglai channel deny feishu <open_id>");
    }
    const result = await ctx.client.rpc("channel.deny", { channel: "feishu", channelUserId: openId });
    io.line(result.ok ? `${style.yellow("denied")} ${openId}（已从白名单移除）` : style.dim(`${openId} 不在白名单里`));
    return 0;
  }

  if (sub === "disable") {
    const channel = args.positionals[1];
    if (channel !== "feishu") {
      throw new CliError("用法：penglai channel disable feishu");
    }
    await ctx.client.rpc("channel.disable", { channel: "feishu" });
    io.line(`${style.yellow("disabled")} feishu（已停连；channels.json 保留，setup 可重开）`);
    return 0;
  }

  throw new CliError(`unknown channel subcommand: ${sub} (list|setup|allow|deny|disable)`);
}

// ── budget (成本熔断) ──────────────────────────────────────────

interface BudgetStatusRow {
  dimension: string;
  day: string;
  limitTokens: number | null;
  usedTokens: number;
  ratio: number | null;
  warned: boolean;
  tripped: boolean;
  lifted: boolean;
}

function budgetStateIcon(
  row: BudgetStatusRow,
  style: Style,
): string {
  if (row.tripped && !row.lifted) return style.red("已熔断");
  if (row.tripped && row.lifted) return style.green("已放行");
  if (row.warned) return style.yellow("预警");
  return style.dim("正常");
}

/**
 * `penglai budget` — 成本熔断面板（design §7 成本可见性）。
 * 无参 = 今日状态；set 配上限（落 product-store）；lift = 撞线后的
 * owner 放行（L3 级人工决定，breaker 行留痕）。
 */
export async function cmdBudget(ctx: CommandContext, args: ParsedArgs): Promise<number> {
  const sub = args.positionals[0] ?? "status";
  const { io, style } = ctx;

  if (sub === "status") {
    const status = await ctx.client.rpc("budget.status", {});
    const config = status.config as {
      dailyTokenLimit: number | null;
      projectDailyTokenLimit: number | null;
    };
    io.line(style.bold(`budget · ${status.day}`));
    io.line(
      `  上限  全局日 ${config.dailyTokenLimit === null ? style.dim("不限") : count(config.dailyTokenLimit)}` +
        ` · 项目日 ${config.projectDailyTokenLimit === null ? style.dim("不限") : count(config.projectDailyTokenLimit)}` +
        style.dim("（token；penglai budget set 配置）"),
    );
    const rows = (status.dimensions as BudgetStatusRow[]).filter(
      (row) => row.limitTokens !== null || row.usedTokens > 0 || row.tripped,
    );
    if (rows.length === 0) {
      io.line(style.dim("  今日无用量，也未配置上限。"));
      return 0;
    }
    for (const row of rows) {
      const label = row.dimension === "day" ? "全局日" : `项目 ${shortId(row.dimension.slice("project:".length))}`;
      const limit = row.limitTokens === null ? "不限" : count(row.limitTokens);
      const pct = row.ratio === null ? "" : ` (${Math.round(row.ratio * 100)}%)`;
      io.line(
        `  ${budgetStateIcon(row, style)} ${label.padEnd(10)} ${count(row.usedTokens)} / ${limit}${pct}`,
      );
    }
    if (rows.some((row) => row.tripped && !row.lifted)) {
      io.line(
        style.yellow(
          "  撞线维度已降级为审批模式：task.start 需 L3 审批；chat 需 `penglai budget lift` 放行。",
        ),
      );
    }
    return 0;
  }

  if (sub === "set") {
    const params: Record<string, unknown> = { updatedBy: cliIdentity() };
    const parseLimit = (raw: string | undefined, flag: string): number | null | undefined => {
      if (raw === undefined) return undefined;
      if (raw === "off" || raw === "0") return null;
      const value = Number(raw);
      if (!Number.isInteger(value) || value <= 0) {
        throw new CliError(`invalid ${flag}: ${raw}（正整数 token 数，或 off 清除）`);
      }
      return value;
    };
    const daily = parseLimit(flagValue(args.flags, "daily-tokens"), "--daily-tokens");
    const perProject = parseLimit(
      flagValue(args.flags, "project-daily-tokens"),
      "--project-daily-tokens",
    );
    if (daily === undefined && perProject === undefined) {
      throw new CliError(
        "budget set 需要 --daily-tokens <n|off> 和/或 --project-daily-tokens <n|off>",
      );
    }
    if (daily !== undefined) params.dailyTokenLimit = daily;
    if (perProject !== undefined) params.projectDailyTokenLimit = perProject;
    const config = await ctx.client.rpc("budget.set", params);
    io.line(
      `${style.green("saved")} 全局日 ${config.dailyTokenLimit === null ? "不限" : count(config.dailyTokenLimit)}` +
        ` · 项目日 ${config.projectDailyTokenLimit === null ? "不限" : count(config.projectDailyTokenLimit)}` +
        style.dim("（落 product-store，重启不丢）"),
    );
    return 0;
  }

  if (sub === "lift") {
    const dimension = flagValue(args.flags, "dimension") ?? "all";
    const result = (await ctx.client.rpc("budget.lift", {
      dimension,
      liftedBy: cliIdentity(),
      note: flagValue(args.flags, "note"),
    })) as { lifted: Array<{ dimension: string; day: string }> };
    if (result.lifted.length === 0) {
      io.line(style.dim("今天没有处于撞线状态的预算维度。"));
      return 0;
    }
    for (const row of result.lifted) {
      io.line(
        `${style.green("lifted")} ${row.dimension === "day" ? "全局日" : row.dimension}（${row.day} 剩余时间恢复自主，决定已留痕）`,
      );
    }
    return 0;
  }

  throw new CliError(`unknown budget subcommand: ${sub} (status|set|lift)`);
}

// ── config ─────────────────────────────────────────────────────

export async function cmdConfig(ctx: CommandContext, args: ParsedArgs): Promise<number> {
  const sub = args.positionals[0] ?? "list";
  const { io, style } = ctx;

  if (sub === "list") {
    const profiles = (await ctx.client.rpc("config.listProfiles", {})) as ModelProfile[];
    for (const profile of profiles) {
      const resolved = await ctx.client
        .rpc("config.resolveProfile", { profileId: profile.id })
        .catch(() => ({ hasKey: false }));
      io.line(
        `${resolved.hasKey ? style.green("key ✓") : style.dim("key —")} ${profile.id.padEnd(10)} ${profile.model.padEnd(18)} ${style.dim(profile.baseUrl)}`,
      );
    }
    return 0;
  }

  if (sub === "add") {
    const id = requireArg(args, 1, "profile id");
    const baseUrl = flagValue(args.flags, "base-url");
    const model = flagValue(args.flags, "model");
    if (!baseUrl || !model) {
      throw new CliError("config add needs --base-url <url> and --model <name>");
    }
    const apiKey = flagValue(args.flags, "api-key");
    const apiKeyEnv = flagValue(args.flags, "api-key-env");
    const profile = await ctx.client.rpc("config.createProfile", {
      id,
      baseUrl,
      model,
      label: flagValue(args.flags, "label"),
      apiKey: apiKey ?? "",
      apiKeyEnv: apiKeyEnv ?? "",
    });
    io.line(`profile ${style.green(profile.id)} saved (${profile.model} @ ${profile.baseUrl})`);
    if (apiKey) {
      io.line(
        style.dim(
          "key stored in <数据目录>/profiles.json (0600) — survives host restarts; " +
            "prefer --api-key-env to keep key material out of files",
        ),
      );
    } else if (apiKeyEnv) {
      io.line(
        style.dim(
          `key resolves from the host's ${apiKeyEnv} env var at runtime (nothing secret on disk)`,
        ),
      );
    }
    return 0;
  }

  throw new CliError(`unknown config subcommand: ${sub} (list|add)`);
}

// ── catalog（目录自校准：yaml 种子 → 实时拉取 → refresh 覆盖层） ──

/**
 * `penglai catalog` — 供应商目录新鲜度面板。
 * status（默认）= 种子日期 + 每个供应商/计费模式的校准状态
 * （已知模型 N 个 · 校准于 <时间> / 未校准）；
 * refresh = 对有 key 的档案实拉 GET /models 刷新覆盖层
 * （无 key 的供应商如实报「配置后可校准」）。
 */
export async function cmdCatalog(ctx: CommandContext, args: ParsedArgs): Promise<number> {
  const sub = args.positionals[0] ?? "status";
  const { io, style } = ctx;

  if (sub === "status") {
    const status = (await ctx.client.rpc("catalog.status", {})) as {
      catalogUpdated: string;
      overlay: CatalogOverlayEntry[];
    };
    io.line(style.bold(`catalog · 种子数据 ${status.catalogUpdated}（penglai_providers.yaml，兜底永可用）`));
    if (status.overlay.length === 0) {
      io.line(style.dim("  尚未校准——`penglai catalog refresh` 对有 key 的档案实拉 /models 刷新。"));
      return 0;
    }
    for (const entry of status.overlay) {
      io.line(
        `  ${entry.providerId}/${entry.billingId}  ${style.green(calibrationLine(entry) ?? "")}`,
      );
      io.line(style.dim(`     ${entry.baseUrl}`));
    }
    io.line(style.dim("  重新校准：penglai catalog refresh"));
    return 0;
  }

  if (sub === "refresh") {
    io.line(style.dim("对每个档案实拉 GET /models（有 key 的才校准；yaml 种子永为兜底）…"));
    const report = (await ctx.client.rpc("catalog.refresh", {})) as RefreshReport;
    for (const row of report.rows) {
      const where = row.providerId ? `${row.providerId}/${row.billingId}` : "—";
      if (row.status === "refreshed") {
        io.line(`  ${style.green("✓")} ${row.profileId.padEnd(18)} ${where.padEnd(24)} ${row.detail}`);
      } else if (row.status === "no-key" || row.status === "not-in-catalog") {
        io.line(`  ${style.dim("○")} ${row.profileId.padEnd(18)} ${where.padEnd(24)} ${style.dim(row.detail)}`);
      } else {
        io.line(`  ${style.yellow("!")} ${row.profileId.padEnd(18)} ${where.padEnd(24)} ${row.detail}`);
      }
    }
    io.line(
      `${style.green("done")} 校准 ${report.refreshed} · 失败 ${report.failed} · 跳过 ${report.skipped}` +
        style.dim("（覆盖层落 <数据目录>/catalog-overlay.json，向导选模型页可见校准状态）"),
    );
    return report.failed > 0 && report.refreshed === 0 ? 1 : 0;
  }

  throw new CliError(`unknown catalog subcommand: ${sub} (status|refresh)`);
}
