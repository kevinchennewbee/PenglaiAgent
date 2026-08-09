/**
 * Tool Execution Policy + the four-level adjudication (审批四级制).
 *
 * Product model (owner decision): ONE conversation surface, one broker-safe
 * tool profile
 * always. "chat" / "work" are NOT capability classes - they are only storage
 * labels for floating (no project jail) vs project-anchored. The jail root
 * differs by anchor; the tool names, budgets, and adjudication do not.
 * Anchoring a project is a jail switch, never a capability switch.
 *
 * The four-level adjudication (审批四级制):
 *
 *   L1 自主     - reversible, local, low-risk (read and new-file drafts
 *                 inside the jail). No approval; the
 *                 tool evidence trail records everything.
 *   L2 常规确认 - reversible but workspace-affecting (overwriting existing
 *                 files). One-click confirm; the
 *                 owner may grant a per-project "同类免问" (persisted in the
 *                 product store) that turns the kind into L1 for that
 *                 project.
 *   L3 人机协同 - external-state or irreversible (git push, publishes,
 *                 deletions, outbound network). Mandatory human decision
 *                 carries full provenance (who / when / based on which
 *                 evidence); the run pauses at awaiting_approval until the
 *                 owner decides. Never grantable.
 *   L4 禁止     - beyond the task boundary (jail escape, credential paths,
 *                 new trust roots). Hard refusal + recorded denial.
 *
 * Sensitive key paths are denied under all anchors, regardless of whether
 * they live inside the workspace.
 *
 * Note: `checkPolicy` no longer takes a Mode - there is one tool gate.
 * The chat/work label only selects the jail root; tool names, budgets, and
 * adjudication are identical across anchors.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isWithinWorkspace } from "./jail.js";
import {
  bashCommandEscapesJail,
  isCloudMetadataCommand,
  isOutboundCommand as bashIsOutbound,
  tokenizeBash,
} from "./bash-guard.js";

// ── tunables ───────────────────────────────────────────────────
// 以下预算/约束均为临时取值，集中在 policy.ts 顶部，待 owner 校准。
// (All provisional budget/constraint values live here, each awaiting owner
// calibration. Do not scatter mode constants across the codebase.)

/**
 * Episode safety rails (NOT a product "budget" concept).
 *
 * Owner direction: completion is goal-driven, not budget-driven - there is no
 * "turn budget 6/6". These ceilings exist ONLY as runaway-loss safety nets,
 * calibrated generously so normal multi-tool research/work never trips them.
 * The real stop signal is the model reaching its objective (a future
 * Codex-style goal-completion mechanism will make this explicit); until then
 * these rails prevent infinite loops / runaway cost, nothing more.
 */
/** Soft turn ceiling for one episode (safety rail, not a product budget). */
export const CHAT_MAX_TURNS = 200;
/** Soft wall-clock for a single episode - generous safety rail (2h). */
export const CHAT_MAX_DURATION_MS = 2 * 60 * 60_000;
/** Soft token ceiling - effectively open for BYOK; real limit is model window. */
export const CHAT_MAX_TOKENS = 2_000_000;
/** Tool-failure loop breaker - the primary runaway-loop safety rail. */
export const CHAT_MAX_TOOL_FAILURES = 15;

/**
 * Task/run episodes (advanced path) share the same generous safety rails as
 * the conversation surface: one tool gate, one ceiling set.
 */
export const WORK_MAX_TURNS = CHAT_MAX_TURNS;
export const WORK_MAX_DURATION_MS = CHAT_MAX_DURATION_MS;
export const WORK_MAX_TOKENS = CHAT_MAX_TOKENS;
export const WORK_MAX_TOOL_FAILURES = CHAT_MAX_TOOL_FAILURES;

/** L1 指针文件行数铁律（设计 §6：≤30 行，始终注入系统提示词）。 */
export const MEMORY_L1_MAX_LINES = 30;
/** 待 owner 校准：记忆注入系统提示词的总字节上限。 */
export const MEMORY_INJECT_MAX_BYTES = 16 * 1024;
/** 待 owner 校准：单条记忆笔记字节上限。 */
export const MEMORY_NOTE_MAX_BYTES = 64 * 1024;

/** 待 owner 校准：成本熔断预警线（用量/预算 ≥ 0.8 播报一次，CLI/飞书）。 */
export const BUDGET_WARN_RATIO = 0.8;
/** 待 owner 校准：成本熔断撞线（≥ 1.0 该维度降级为审批模式并播报）。 */
export const BUDGET_TRIP_RATIO = 1.0;

/** 预算熔断后 task.start 的前置 L3 审批 capability（永不可授权免问）。 */
export const CAPABILITY_L3_BUDGET_OVERRIDE = "l3:budget-override";

// ── adjudication tables (待 owner 校准) ────────────────────────
// 以下 L2/L3 分类模式均为确定性保守匹配，集中在 policy.ts 顶部，
// 待 owner 校准（误报代价 = 多一次一键确认；漏报代价 = 外发/不可逆
// 操作绕过审批，故宁可保守）。项目级「同类免问」授权持久化在
// product-store（policy_grants 表），只覆盖 L2，L3 永远需要人工。

// L3 outbound detection lives in bash-guard.ts (structured per-command
// analysis: git push, npm publish, docker push/run, ssh/scp/sftp,
// nc/ncat/socat/telnet, dig/nslookup/host, curl/wget mutating methods,
// cloud CLIs, gh publishing surfaces). These narrower labels remain useful
// for approval provenance, while all other bash calls fall back to l3:bash.

/** L3: destructive / irreversible filesystem or git operations. */
const L3_DELETE_PATTERNS: ReadonlyArray<RegExp> = [
  /\brm\b/,
  /\brmdir\b/,
  /\bfind\b[\s\S]*\s-delete(?:\s|$)/,
  /\b(?:python3?|node|ruby|perl)\b[\s\S]*\b(?:unlink|rmtree|removesync|rmsync)\s*\(/,
  /\b(?:powershell|pwsh)\b[\s\S]*\bremove-item\b/,
  /(?:^|[;&|]\s*)(?:del|erase)\s+(?:\/[^\s]+\s+)*[^\s]/,
  /\bgit\s+clean\b/,
  /\bgit\s+rm\b/,
  /\bgit\s+reset\s+--hard\b/,
];

/** Dependency-install detector retained for the future sandboxed broker. */
const L2_INSTALL_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|i)\b/,
  /\bpip3?\s+install\b/,
  /\bbrew\s+install\b/,
  /\bcargo\s+(?:install|add)\b/,
];

/** Grant keys (policy_grants.grant_key / approvals.capability). */
export const GRANT_MODIFY_EXISTING = "l2:modify-existing";
/** @deprecated Unbrokered bash is disabled and cannot consume install grants. */
export const GRANT_INSTALL_DEPS = "l2:install-deps";
export const CAPABILITY_L3_BASH = "l3:bash";
export const CAPABILITY_L3_OUTBOUND = "l3:outbound";
export const CAPABILITY_L3_DELETE = "l3:delete";
export const CAPABILITY_L3_WEB = "l3:web";
export const CAPABILITY_L3_MCP = "l3:mcp";

// ── policy profile ────────────────────────────────────────────

/**
 * The single 0.4 policy profile. One tool surface (read/write/edit/bash +
 * host skills/goal tools); the chat/work label selects only the jail root,
 * never the capability ladder. Bash runs behind the four-level gate: read-only
 * probes are L1, workspace mutations are L2, outbound/destructive verbs are
 * L3 (never grantable), and jail/credential references are L4.
 */
export interface PolicyProfileSpec {
  /** File-tool surface assembled into the kernel for this mode. */
  fileTools: ReadonlyArray<"read" | "write" | "edit" | "bash">;
  /** Host-side tools exposed to the kernel in this mode. */
  hostTools: ReadonlyArray<string>;
  /** Whether shell execution exists at all in this mode. */
  allowsBash: boolean;
  /** Turn ceiling for one episode / conversation beat. */
  maxTurns: number;
  /** Episode ceilings; null means that dimension is unbounded. */
  budget: {
    maxDurationMs: number | null;
    maxTokens: number | null;
    maxToolFailures: number;
  };
}

/**
 * The single 0.4 policy profile. One tool surface (read/write/edit/bash +
 * host skills/goal tools); the chat/work label selects only the jail root,
 * never the capability ladder. Bash runs behind the four-level gate: read-only
 * probes are L1, workspace mutations are L2, outbound/destructive verbs are
 * L3 (never grantable), and jail/credential references are L4.
 */
export const POLICY_PROFILE: PolicyProfileSpec = {
  fileTools: ["read", "write", "edit", "bash"],
  hostTools: [],
  allowsBash: true,
  maxTurns: CHAT_MAX_TURNS,
  budget: {
    maxDurationMs: CHAT_MAX_DURATION_MS,
    maxTokens: CHAT_MAX_TOKENS,
    maxToolFailures: CHAT_MAX_TOOL_FAILURES,
  },
};

// ── decisions ──────────────────────────────────────────────────

/** The four-level adjudication (审批四级制, design §5/§9). */
export type ApprovalLevel = "L1" | "L2" | "L3" | "L4";

export type PolicyDecisionCode =
  | "allowed"
  /** Generic refusal (unknown tool, sensitive path, …). */
  | "policy_denied"
  /**
   * The conversation is not anchored to a project but the operation needs
   * one (e.g. writing a project memory note). The caller anchors or the
   * owner confirms; there is no separate "work mode" capability class.
   */
  | "needs_work_mode"
  /** L2: reversible but workspace-affecting - one-click confirm (grantable). */
  | "needs_confirm"
  /** L3: outbound / irreversible - mandatory human decision (never grantable). */
  | "needs_approval"
  /** L4: beyond the task boundary (jail escape, credential paths) - refused. */
  | "l4_denied";

/** The L2/L3 approval payload: what the owner is asked to decide on. */
export interface PolicyApprovalRequest {
  /**
   * The capability / grant key ("l2:modify-existing", "l3:bash",
   * "l3:outbound", "l3:delete"). L2 keys are grantable per project
   * (同类免问); L3 keys always require a human.
   */
  capability: string;
  /** Human-readable description of the concrete operation. */
  action: string;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  code: PolicyDecisionCode;
  /** The adjudication level this decision belongs to. */
  level: ApprovalLevel;
  /** Present for needs_confirm (L2) / needs_approval (L3) decisions. */
  approval?: PolicyApprovalRequest;
}

/** Extra context the gate needs beyond the workspace root. */
export interface PolicyContext {
  /**
   * Explicit runtime-owned roots the model may read even when they are
   * outside the workspace jail. This is intentionally separate from write
   * authority: for example, memory is readable but not generically writable.
   */
  assistantReadRoots?: string[];
  /**
   * Explicit runtime-owned roots the model may mutate. Production kernels
   * provide only dataDir/drafts/<conversationId>; never the shared drafts
   * parent or the whole Penglai data directory.
   */
  assistantWriteRoots?: string[];
  /**
   * Host-owned namespace roots. Generic file tools cannot read or mutate
   * these unless the exact target is covered by one of the narrow roots
   * above. The production kernel protects the whole dataDir so future
   * runtime files fail closed by default.
   */
  protectedRoots?: string[];
  /** Host-side tool names registered on this kernel (allowed by name). */
  hostTools?: string[];
  /**
   * Per-project L2 grant lookup (product-store policy_grants). A granted
   * key turns that L2 kind into L1 for the project (同类免问). L3 is never
   * grantable.
   */
  hasGrant?: (grantKey: string) => boolean;
}

/** Tools that only read (no side effects). */
const READ_TOOLS = new Set(["read"]);
/** Tools that mutate files (excluding bash, gated separately). */
const FILE_WRITE_TOOLS = new Set(["write", "edit"]);
/** Tools that mutate files or run commands. */
const WRITE_TOOLS = new Set(["write", "edit", "bash"]);

const ALLOWED = (reason: string, level: ApprovalLevel = "L1"): PolicyDecision => ({
  allowed: true,
  code: "allowed",
  level,
  reason,
});
/**
 * Hard-boundary refusals (unknown tool, sensitive path, jail escape,
 * out-of-scope access). All are L4-class: beyond the permitted boundary.
 */
const DENIED = (code: PolicyDecisionCode, reason: string): PolicyDecision => ({
  allowed: false,
  code,
  level: "L4",
  reason,
});
/** An L2/L3 approval request (the owner decides; the run pauses). */
const NEEDS_DECISION = (
  code: "needs_confirm" | "needs_approval",
  level: "L2" | "L3",
  approval: PolicyApprovalRequest,
  reason: string,
): PolicyDecision => ({
  allowed: false,
  code,
  level,
  approval,
  reason,
});

/** Extract the `path` argument used by read/write/edit, if present. */
function extractPath(args: Record<string, unknown>): string | null {
  const p = args.path;
  return typeof p === "string" ? p : null;
}

/**
 * Whether a filesystem path is a sensitive key/credential path that must be
 * denied under all profiles (constitution §7.2).
 *
 * Matches (case-insensitive on the basename / path segments):
 *   - mykey.py, mykey.json
 *   - the .ssh directory (anywhere in the path)
 *   - id_rsa, id_ed25519, id_ecdsa (no extension)
 *   - .env and .env.* files
 *   - *.key, *.pem
 *   - credentials (no extension)
 */
export function isSensitivePath(rawPath: string): boolean {
  const p = rawPath.replace(/\\/g, "/").toLowerCase();
  const base = path.basename(p);
  const parts = p.split("/");

  // .ssh directory anywhere in the path
  if (parts.includes(".ssh")) return true;
  // common secret dirs
  if (parts.includes(".gnupg") || parts.includes(".aws") || parts.includes(".kube")) return true;

  // .env / .env.* (e.g. .env.local)
  if (base === ".env" || base.startsWith(".env.")) return true;

  // mykey.py / mykey.json
  if (base === "mykey.py" || base === "mykey.json") return true;

  // Penglai product secrets / DB / channel credentials under ~/.penglai
  if (
    base === "credentials" ||
    base === "credentials.json" ||
    base === "application_default_credentials.json" ||
    base === ".netrc" ||
    base === ".npmrc" ||
    base === ".pypirc" ||
    base === "host.token" ||
    base === "profiles.json" ||
    base === "mcp.json" ||
    base === "channels.json" ||
    base === "wechat-token.json" ||
    base === "product.db" ||
    base === "product.db-wal" ||
    base === "product.db-shm" ||
    base.endsWith(".db") ||
    base.endsWith(".sqlite") ||
    base.endsWith(".sqlite3")
  ) {
    return true;
  }
  // conversation transcripts are owner-private
  if (parts.includes("conversations") && (base.endsWith(".jsonl") || base === "meta.json" || base === "goal.json")) {
    return true;
  }

  // SSH private keys (no extension)
  if (
    base === "id_rsa" ||
    base === "id_ed25519" ||
    base === "id_ecdsa" ||
    base === "id_dsa"
  ) {
    return true;
  }

  // *.key / *.pem / pkcs
  if (
    base.endsWith(".key") ||
    base.endsWith(".pem") ||
    base.endsWith(".p12") ||
    base.endsWith(".pfx") ||
    base.endsWith(".kdbx")
  ) {
    return true;
  }

  return false;
}

/**
 * Conservative scan of a bash command string for references to sensitive key
 * paths. Shell parsing is imperfect, so this is defense-in-depth: it flags
 * clearly sensitive filenames appearing as tokens. It may miss obfuscated
 * references; the Boundary still enforces workspace containment for the
 * process cwd.
 */
function commandReferencesSensitivePath(command: string): boolean {
  const c = command.toLowerCase();
  // .env / .env.* as a path token
  if (/(^|[\s'"\/\\])\.env(\.[a-z0-9]+)?\b/.test(c)) return true;
  // mykey.py / mykey.json
  if (/mykey\.(py|json)\b/.test(c)) return true;
  // .ssh directory token
  if (/(^|[\s'"\/\\])\.ssh\b/.test(c)) return true;
  if (/(^|[\s'"\/\\])\.(?:aws|kube|gnupg)\b/.test(c)) return true;
  // SSH private keys
  if (/\bid_(rsa|ed25519|ecdsa|dsa)\b/.test(c)) return true;
  // credentials (no extension) + common secret files
  if (/(^|[\s'"\/\\])credentials(?:\.json)?\b/.test(c)) return true;
  if (/(^|[\s'"\/\\])(?:\.netrc|\.npmrc|\.pypirc|host\.token|profiles\.json|mcp\.json|channels\.json|wechat-token\.json|product\.db|\.git-credentials|\.zsh_history|\.bash_history)\b/.test(c))
    return true;
  // *.key / *.pem / pkcs / sqlite
  if (/\b[a-z0-9._-]+\.(key|pem|p12|pfx|kdbx|db|sqlite|sqlite3)\b/.test(c)) return true;
  return false;
}

/**
 * Deterministic L3 detector for outbound / irreversible bash operations
 * (design §5: 越狱/外发/不可逆 = L3 强制确认). Routes the call through the
 * approval flow (the run pauses at awaiting_approval). Implemented as
 * structured per-command analysis in bash-guard.ts (see H2 fix).
 */
export function isOutboundCommand(command: string): boolean {
  return bashIsOutbound(command);
}

/** Whether a bash command is destructive / irreversible (L3). */
export function isDeleteCommand(command: string): boolean {
  return L3_DELETE_PATTERNS.some((pattern) =>
    pattern.test(command.toLowerCase()),
  );
}

/** Whether a bash command installs dependencies (future broker classifier). */
export function isInstallCommand(command: string): boolean {
  return L2_INSTALL_PATTERNS.some((pattern) =>
    pattern.test(command.toLowerCase()),
  );
}

/** One-line, length-capped excerpt of a command/path for approval display. */
function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Lexical namespace containment, intentionally without following symlinks.
 * Protected roots use lexical OR resolved containment: a symlink located
 * under dataDir must not erase the fact that the caller addressed a
 * Host-owned pathname, while a workspace symlink into dataDir must also be
 * caught by the resolved check.
 */
function isLexicallyWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

/** Resolve one literal shell token to a path when it is statically knowable. */
function resolveLiteralShellPath(
  token: string,
  workspaceRoot: string,
): string | null {
  let value = token.trim();
  if (!value || /^(?:https?|ftp|ws|wss|git|ssh):\/\//i.test(value)) {
    return null;
  }
  if (value.includes("$(") || value.includes("`") || value.includes("<(") || value.includes(">(")) {
    return null;
  }

  // Common --flag=/path and glued short flag forms (for example -C../dir).
  if (value.startsWith("-") && value.includes("=")) {
    value = value.slice(value.indexOf("=") + 1);
  } else if (/^-[A-Za-z][./~]/.test(value)) {
    value = value.slice(2);
  } else if (value.startsWith("-")) {
    return null;
  }

  const home = os.homedir();
  const knownVars: Record<string, string> = {
    HOME: home,
    PWD: workspaceRoot,
    PENGLAI_WORKSPACE: workspaceRoot,
  };
  value = value.replace(/\$\{?(HOME|PWD|PENGLAI_WORKSPACE)\}?/g, (_whole, name: string) =>
    knownVars[name] ?? _whole,
  );
  if (value.includes("$")) return null;
  if (value === "~") value = home;
  else if (value.startsWith("~/")) value = path.join(home, value.slice(2));
  else if (value.startsWith("~")) return null;

  // Trim punctuation introduced by simple inline calls such as open('/x').
  value = value.replace(/^[('"\[]+/, "").replace(/[)'",\];]+$/, "");
  if (!value) return null;
  return path.resolve(workspaceRoot, value);
}

/**
 * Defense-in-depth hard refusal for statically visible references to
 * Host-owned data. This deliberately does not claim to parse arbitrary shell
 * programs; variable-built/eval/interpreter-obfuscated paths remain a W3
 * process-sandbox requirement.
 */
function commandReferencesProtectedRoot(
  command: string,
  workspaceRoot: string,
  protectedRoots: ReadonlyArray<string>,
  allowedRoots: ReadonlyArray<string>,
  depth = 0,
): string | null {
  if (protectedRoots.length === 0 || depth > 3) return null;

  const isAllowed = (candidate: string): boolean =>
    allowedRoots.some((root) => isWithinWorkspace(root, candidate));
  const protectedMatch = (candidate: string): string | null => {
    const root = protectedRoots.find((entry) =>
      isLexicallyWithin(entry, candidate) ||
      isWithinWorkspace(entry, candidate),
    );
    return root && !isAllowed(candidate) ? candidate : null;
  };

  // Extract obvious embedded path literals (for example
  // `python -c "open('/x/y')"`) without treating the whole protected parent
  // as the target; a literal inside the allowed conversation draft must stay
  // admissible.
  const embeddedPaths = command.match(
    /(?:\$\{?HOME\}?\/|~\/|\/)[^\s'"`),;\]]+/g,
  ) ?? [];
  for (const token of embeddedPaths) {
    const candidate = resolveLiteralShellPath(token, workspaceRoot);
    if (candidate) {
      const match = protectedMatch(candidate);
      if (match) return match;
    }
  }

  const inlineInterpreters = new Set([
    "sh",
    "bash",
    "zsh",
    "dash",
    "ksh",
    "fish",
    "python",
    "python3",
    "node",
    "perl",
    "ruby",
  ]);
  for (const segment of tokenizeBash(command)) {
    const tokens = [...segment.argv, ...segment.redirects];
    for (const token of tokens) {
      const candidate = resolveLiteralShellPath(token, workspaceRoot);
      if (candidate) {
        const match = protectedMatch(candidate);
        if (match) return match;
      }
    }

    const executable = path.basename(segment.argv[0] ?? "").toLowerCase();
    const flag = executable === "node" || executable === "perl" || executable === "ruby"
      ? "-e"
      : "-c";
    if (
      inlineInterpreters.has(executable) &&
      segment.argv[1] === flag &&
      segment.argv[2]
    ) {
      const nested = commandReferencesProtectedRoot(
        segment.argv.slice(2).join(" "),
        workspaceRoot,
        protectedRoots,
        allowedRoots,
        depth + 1,
      );
      if (nested) return nested;
    }
  }
  return null;
}

// ── the single tool gate ────────────────────────────────────────

/**
 * The one tool-adjudication gate. There is no chat/work capability split:
 * narrow assistant read/write roots are explicitly allowed, protected Host
 * namespaces fail closed, project-jail writes follow the L1-L4 ladder, and
 * everything outside the jail + explicit roots is L4-denied.
 */
function checkToolPolicy(
  toolName: string,
  target: string | null,
  args: Record<string, unknown>,
  workspaceRoot: string,
  context: PolicyContext,
): PolicyDecision {
  const readRoots = context.assistantReadRoots ?? [];
  const writeRoots = context.assistantWriteRoots ?? [];
  const protectedRoots = context.protectedRoots ?? [];
  const inReadRoot =
    target !== null &&
    [...readRoots, ...writeRoots].some((root) => isWithinWorkspace(root, target));
  const inWriteRoot =
    target !== null && writeRoots.some((root) => isWithinWorkspace(root, target));
  const inProtectedRoot =
    target !== null &&
    protectedRoots.some(
      (root) =>
        isLexicallyWithin(root, target) ||
        isWithinWorkspace(root, target),
    );

  // Protected namespace is adjudicated before generic jail/ground shortcuts.
  // Only exact, conversation-scoped exceptions are admitted.
  if (inProtectedRoot) {
    if (toolName === "read" && inReadRoot) {
      return ALLOWED("explicit assistant read root");
    }
    if (FILE_WRITE_TOOLS.has(toolName) && inWriteRoot) {
      return ALLOWED("conversation-scoped draft write");
    }
    return DENIED(
      "l4_denied",
      `l4_denied: '${target}' belongs to a Host-protected namespace`,
    );
  }

  // Explicit assistant roots may live outside the project jail.
  if (toolName === "read" && inReadRoot) {
    return ALLOWED("explicit assistant read root");
  }
  if (FILE_WRITE_TOOLS.has(toolName) && inWriteRoot) {
    return ALLOWED("conversation-scoped draft write");
  }

  // L4 first: jail containment. Escaping the project jail is a hard refusal.
  // This is also the anti-pollution spatial rule: global memory (~/.penglai)
  // is outside the jail, so a project-anchored session can never write it
  // through file tools (the assistant-ground exception above is the only door).
  if (target !== null && !isWithinWorkspace(workspaceRoot, target)) {
    return DENIED(
      "l4_denied",
      `l4_denied: '${target}' is outside the workspace jail`,
    );
  }

  if (toolName === "bash") {
    const command = typeof args.command === "string" ? args.command : "";
    const protectedTarget = commandReferencesProtectedRoot(
      command,
      workspaceRoot,
      protectedRoots,
      writeRoots,
    );
    if (protectedTarget) {
      return DENIED(
        "l4_denied",
        `l4_denied: bash command references Host-protected path '${protectedTarget}'`,
      );
    }
    // L4: bash must not escape the workspace jail through path args,
    // redirects, or cd-family.
    const escape = bashCommandEscapesJail(command, workspaceRoot);
    if (escape.escaped) {
      return DENIED(
        "l4_denied",
        `l4_denied: ${escape.reason ?? "bash command escapes the workspace jail"}`,
      );
    }
    // Cloud metadata endpoints are credential-exfiltration surfaces: L3.
    if (isCloudMetadataCommand(command)) {
      return NEEDS_DECISION(
        "needs_approval",
        "L3",
        { capability: CAPABILITY_L3_OUTBOUND, action: `bash: ${excerpt(command)}` },
        "needs_approval: command references a cloud metadata endpoint (L3)",
      );
    }
    // L3: outbound / destructive verbs always need a human (never grantable).
    if (isOutboundCommand(command) || isDeleteCommand(command)) {
      const cap = isDeleteCommand(command)
        ? CAPABILITY_L3_DELETE
        : CAPABILITY_L3_OUTBOUND;
      return NEEDS_DECISION(
        "needs_approval",
        "L3",
        { capability: cap, action: `bash: ${excerpt(command)}` },
        "needs_approval: outbound or destructive command requires L3 human approval",
      );
    }

    // Static shell classification cannot prove that an apparently harmless
    // command is read-only: interpreters, package scripts, git hooks/config,
    // command substitution, and dynamically-built paths can all execute
    // arbitrary code. The current runtime scrubs the environment and enforces
    // visible jail paths, but it is not an OS sandbox. Therefore every bash
    // invocation that survives the L4/outbound/delete checks requires an
    // explicit, non-grantable Owner L3 decision. This may only be relaxed when
    // a tested cross-platform process broker is the actual execution boundary.
    return NEEDS_DECISION(
      "needs_approval",
      "L3",
      {
        capability: CAPABILITY_L3_BASH,
        action: `bash: ${excerpt(command)}`,
      },
      "needs_approval: shell execution is unsandboxed and requires explicit Owner approval (L3)",
    );
  }

  if (FILE_WRITE_TOOLS.has(toolName)) {
    // L2 常规确认: overwriting an existing file (write to an existing path,
    // or edit, which modifies by definition). Writing a NEW file is a
    // draft - L1. A per-project grant turns overwrites into L1.
    const isOverwrite =
      toolName === "edit" || (target !== null && fs.existsSync(target));
    if (isOverwrite) {
      if (context.hasGrant?.(GRANT_MODIFY_EXISTING)) {
        return ALLOWED(`allowed by project grant '${GRANT_MODIFY_EXISTING}' (同类免问)`, "L2");
      }
      return NEEDS_DECISION(
        "needs_confirm",
        "L2",
        {
          capability: GRANT_MODIFY_EXISTING,
          action: `${toolName}: ${target === null ? "(unknown path)" : excerpt(target)}`,
        },
        `needs_confirm: '${toolName}' overwrites an existing file (L2; grantable per project)`,
      );
    }
    return ALLOWED("new-file draft write (L1)");
  }

  // read: L1.
  return ALLOWED("read (L1)");
}

/**
 * Check whether a tool call is allowed. There is one tool gate (no mode
 * branching): the chat/work label only selects the jail root, never the
 * capability ladder.
 *
 * Evaluation order:
 *   1. Registered host-side tools -> document/skills are L1; Web is L3.
 *   2. Unknown tools -> denied (L4-class).
 *   3. Sensitive key path (path arg, or bash command token) -> denied (L4).
 *   4. protected Host namespace -> deny unless an exact read/write exception.
 *   5. explicit assistant read/write root -> allowed.
 *   6. jail escape -> l4_denied; every other bash call requires L3 until an
 *      OS process sandbox ships; overwriting existing files -> needs_confirm
 *      (L2, per-project grantable 同类免问); new-file drafts / reads -> L1.
 *
 * @param toolName       one of read/write/edit/bash or a registered host tool
 * @param args           the tool call arguments (path / command / ...)
 * @param workspaceRoot  absolute workspace root for containment checks
 * @param context        protected/read/write roots + registered host tool
 *                      names + the per-project L2 grant lookup
 */
export function checkPolicy(
  toolName: string,
  args: Record<string, unknown>,
  workspaceRoot: string,
  context: PolicyContext = {},
): PolicyDecision {
  // 1. Registered host-side tools are deterministic brokers. Local document
  //    and skill tools are L1; Web has explicit L3 handling below.
  //    MCP mounts (mcp_*) must NOT get an unconditional L1 pass — their
  //    effects are declared by a third party and may leave the jail. Every
  //    call is L3 and can never be remembered or auto-approved.
  if (context.hostTools?.includes(toolName)) {
    if (toolName === "web_search" || toolName === "web_fetch") {
      const action = toolName === "web_search"
        ? `web search: ${excerpt(typeof args.query === "string" ? args.query : "")}`
        : `web fetch: ${excerpt(typeof args.url === "string" ? args.url : "")}`;
      return NEEDS_DECISION(
        "needs_approval",
        "L3",
        { capability: CAPABILITY_L3_WEB, action },
        "needs_approval: public web access requires L3 human approval",
      );
    }
    if (toolName.startsWith("mcp_")) {
      return NEEDS_DECISION(
        "needs_approval",
        "L3",
        { capability: CAPABILITY_L3_MCP, action: `mcp: ${toolName}` },
        "needs_approval: every MCP call requires an L3 human decision",
      );
    }
    return ALLOWED(`host-side tool '${toolName}'`);
  }

  // 2. Unknown tools are denied by default.
  if (!READ_TOOLS.has(toolName) && !WRITE_TOOLS.has(toolName)) {
    return DENIED("policy_denied", `policy_denied: unknown tool '${toolName}'`);
  }

  // 3a. Sensitive path check on the `path` argument (read/write/edit).
  // Relative paths are interpreted against the workspace root (the kernel's
  // cwd) BEFORE any containment test, so the assistant ground cannot
  // accidentally claim a workspace-relative path.
  const rawTarget = extractPath(args);
  if (toolName !== "bash" && rawTarget === null) {
    return DENIED(
      "policy_denied",
      `policy_denied: '${toolName}' requires an explicit path`,
    );
  }
  const target =
    rawTarget === null
      ? null
      : path.isAbsolute(rawTarget)
        ? rawTarget
        : path.resolve(workspaceRoot, rawTarget);
  if (target !== null && isSensitivePath(target)) {
    return DENIED(
      "policy_denied",
      `policy_denied: '${target}' is a sensitive key path (constitution §7.2)`,
    );
  }

  // 3b. Bash command scan for sensitive filenames (defense-in-depth).
  // Runs before the jail containment guard so a command that both escapes the
  // jail AND references a credential is refused with the credential reason.
  if (toolName === "bash") {
    const command = typeof args.command === "string" ? args.command : "";
    if (commandReferencesSensitivePath(command)) {
      return DENIED(
        "policy_denied",
        "policy_denied: bash command references a sensitive key path (constitution §7.2)",
      );
    }
  }

  // 4/5. The single tool gate (assistant-ground -> jail -> L1-L4 ladder).
  return checkToolPolicy(toolName, target, args, workspaceRoot, context);
}
