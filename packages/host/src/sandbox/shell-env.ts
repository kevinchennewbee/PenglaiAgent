/**
 * Safe shell execution environment for the Pi bash tool.
 *
 * Two jobs:
 *   1. Scrub the environment so BYOK keys / Feishu secrets / host tokens never
 *      reach a model-driven child process (the C2 class of leak).
 *   2. Classify a command into an approval level so the policy gate can treat
 *      read-only probes as L1, workspace mutations as L2, outbound/destructive
 *      actions as L3, and jail/credential references as L4.
 *
 * Phase 1 runs the child directly with the scrubbed env. Phase 2 will route
 * execution through the Rust sandbox sidecar (Seatbelt / bubblewrap); the
 * `prepareBashExecution` seam here is where that broker plugs in without
 * touching the kernel factory or the policy gate.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Environment variables that are safe to expose to a model-driven shell. */
const ENV_ALLOWLIST = new Set([
  // Locale / terminal basics
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TERM",
  "TERM_PROGRAM",
  "COLORTERM",
  // Shell / user identity (non-secret)
  "USER",
  "LOGNAME",
  "SHELL",
  "TZ",
  // Paths required for tools to work
  "PATH",
  "PATHEXT", // Windows
  "TMPDIR",
  "TEMP",
  "TMP",
  // Build systems read these (CPU count, parallelism)
  "MAKEFLAGS",
  "CMAKE_BUILD_PARALLEL_LEVEL",
  // npm/node respect these; they do not carry secrets
  "npm_config_registry",
  "npm_config_cache",
  "NODE_OPTIONS",
  // Git identity (non-secret; avoids "please tell me who you are")
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  // pnpm/yarn
  "COREPACK_ENABLE_DOWNLOAD_PROMPT",
  // Code page on Windows
  "CHCP",
]);

/** Variables that are never inherited even if present, as defense in depth. */
const ENV_DENYLIST = new Set([
  // Penglai secrets
  "PENGLAI_TOKEN",
  "PENGLAI_FEISHU_APP_SECRET",
  "PENGLAI_FEISHU_APP_ID",
  // Common API key conventions
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "MOONSHOT_API_KEY",
  "DASHSCOPE_API_KEY",
  "ZHIPU_API_KEY",
  "GLM_API_KEY",
  "MINIMAX_API_KEY",
  "HUNYUAN_API_KEY",
  "GROK_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "TAVILY_API_KEY",
  "FIRECRAWL_API_KEY",
  "TINYFISH_API_KEY",
  "WEB_SEARCH_API_KEY",
  // Generic secrets
  "API_KEY",
  "SECRET_KEY",
  "ACCESS_TOKEN",
  "BEARER_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "DOCKER_PASSWORD",
  "NPM_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  // Feishu/Lark
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "LARK_APP_ID",
  "LARK_APP_SECRET",
  // WeChat
  "WX_BOT_TOKEN",
]);

/**
 * Build the scrubbed environment for a bash child. We start from an empty
 * object (NOT process.env) and copy only allow-listed variables. The denylist
 * is belt-and-suspenders in case an allowlist entry ever overlaps.
 */
export function scrubbedShellEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined && value !== "") out[key] = value;
  }
  for (const key of ENV_DENYLIST) {
    delete out[key];
  }
  // Provide a sane TMPDIR if the host has none (Pi bash writes truncation here).
  if (!out.TMPDIR && !out.TEMP && !out.TMP) {
    out.TMPDIR = process.platform === "win32" ? process.env.TEMP ?? "" : "/tmp";
  }
  return out;
}

export interface BashExecution {
  command: string;
  cwd: string;
  env: Record<string, string>;
  inheritEnv: boolean;
}

/**
 * Pi bash-tool `prepare` hook. Mutates the BashExecution to:
 *   - force inheritEnv off and install the scrubbed allowlist env
 *   - (Phase 2) route the command through the sandbox sidecar.
 *
 * The policy gate has already decided allow/ask/deny before this runs; this
 * is purely an execution-environment control.
 */
export function prepareBashExecution(execution: BashExecution): void {
  const shellHome = path.join(os.tmpdir(), `penglai-shell-home-${process.pid}`);
  fs.mkdirSync(shellHome, { recursive: true, mode: 0o700 });
  fs.chmodSync(shellHome, 0o700);
  execution.inheritEnv = false;
  execution.env = {
    ...scrubbedShellEnv(),
    // Never expose the owner's ~/.ssh, ~/.gitconfig, ~/.netrc or XDG config
    // through an otherwise innocuous command.
    HOME: shellHome,
    XDG_CACHE_HOME: path.join(shellHome, ".cache"),
    XDG_CONFIG_HOME: path.join(shellHome, ".config"),
    XDG_DATA_HOME: path.join(shellHome, ".local", "share"),
    // Non-secret trace id for audit correlation.
    PENGLAI_SHELL: "1",
  };
}

// ── Command classification (L1/L2/L3/L4) ──────────────────────

export type BashLevel = "read" | "write" | "danger" | "unknown";

/**
 * First command word → classification. This is a conservative heuristic; the
 * static classifier is NOT a security boundary (the L4 jail/path checks in
 * policy.ts are), but it lets the policy gate auto-allow read-only probes and
 * escalate obvious outbound/destructive verbs to L3. Unknown verbs fall
 * through to L2 by default (reversible workspace mutation needs a confirm).
 */
const READ_ONLY_COMMANDS = new Set([
  // file inspection
  "ls", "dir", "cat", "head", "tail", "less", "more", "bat", "nl", "wc",
  "file", "stat", "du", "df", "tree", "find", "fd", "locate", "which",
  "whereis", "realpath", "readlink", "basename", "dirname",
  // search
  "grep", "rg", "ag", "ack", "jq", "yq", "awk", "sed", "cut", "sort",
  "uniq", "comm", "diff", "cmp", "tr", "tee", "column", "paste",
  // version / help / status (read-only)
  "echo", "printf", "true", "false", "whoami", "id", "uname", "hostname",
  "pwd", "date", "cal", "env", "printenv", "uptime", "ps", "top", "htop",
  "lsof", "ss", "netstat", "ifconfig", "ip", "ping", "dig", "nslookup",
  "host", "traceroute", "getent",
  // VCS read-only
  "git", "hg", "svn", "bzr",
  // language runtimes in read/eval mode (best-effort; flags reclassify)
  "node", "python", "python3", "ruby", "perl", "php", "deno", "bun",
  // package managers (read-only subcommands handled by flag inspection)
  "npm", "pnpm", "yarn", "bun", "cargo", "go",
  // build systems: may write targets, so conservatively not read-only
  // (make/cmake/ninja/gradle/mvn/tsc/vite/vitest/jest/pytest are handled
  //  below — test runners are read-only, build runners are L2.)
]);

/**
 * Verbs that are always L3: outbound network, deletion, publication,
 * privilege, or process control. The exact command still runs through the
 * jail/path L4 checks first.
 */
const DANGEROUS_COMMANDS = new Set([
  // outbound / transfer
  "curl", "wget", "nc", "ncat", "netcat", "ssh", "scp", "sftp", "rsync",
  "ftp", "telnet", "rsh", "mqtt", "mosquitto_pub",
  // destructive
  "rm", "rmdir", "shred", "unlink", "srm",
  // privilege / system mutation
  "sudo", "su", "doas", "pkexec", "chmod", "chown", "chgrp", "mount",
  "umount", "kill", "pkill", "killall", "shutdown", "reboot", "halt",
  "poweroff", "launchctl", "systemctl", "service",
  // package mutation (installing/removing software)
  "apt", "apt-get", "brew", "port", "dnf", "yum", "pacman", "apk",
  "nix", "pip", "pip3",
]);

/** Flags/verbs that push an otherwise-read-only command into write/L2. */
const MUTATING_FLAGS = new Set([
  "-i", "--in-place", // sed -i
  "-o", "--output", ">", ">>", // redirect (handled separately)
]);

/** Git subcommands that are L3 (network or destructive). */
const GIT_DANGER_SUBCOMMANDS = new Set([
  "push", "pull", "fetch", "clone", "reset", "clean", "rebase", "merge",
  "remote", "submodule", "filter-branch", "gc", "prune",
]);
const GIT_WRITE_SUBCOMMANDS = new Set([
  "add", "commit", "mv", "rm", "stash", "tag", "branch", "checkout",
  "switch", "restore", "merge", "rebase", "cherry-pick", "revert",
  "notes", "sparse-checkout", "config", "apply",
]);

/** Package-manager subcommands that are L3 (publish/auth/network-only). */
const PM_DANGER_SUBCOMMANDS = new Set([
  "publish", "unpublish", "login", "logout", "adduser", "owner", "team",
  "deprecate", "dist-tag", "token",
]);
/** Package-manager subcommands that mutate the workspace (L2). */
const PM_WRITE_SUBCOMMANDS = new Set([
  "install", "i", "add", "remove", "rm", "uninstall", "update", "upgrade",
  "link", "unlink", "ci", "run", "exec", "dlx", "init", "fix",
]);
/** Package-manager subcommands that are read-only (L1). */
const PM_READ_SUBCOMMANDS = new Set([
  "list", "ls", "view", "show", "info", "outdated", "audit", "doctor",
  "status", "why", "dedupe", "ping", "search", "cache", "test",
]);

/** Cargo subcommands that touch the network. */
const CARGO_DANGER_SUBCOMMANDS = new Set(["publish", "install", "search", "login", "owner"]);
const CARGO_READ_SUBCOMMANDS = new Set(["--version", "-V", "metadata", "tree", "search"]);

/** Classify a single shell command string. */
export function classifyBashCommand(command: string): BashLevel {
  const trimmed = command.trim();
  if (!trimmed) return "unknown";

  // Redirects / heredocs imply file writes (L2) unless the target is outside
  // the jail (policy.ts L4 catches that separately).
  if (/(^|\s)(>>?|>)\s*\S/.test(trimmed)) return "write";
  if (/\$\(|\`|&&|\|\||\bsudo\b/.test(trimmed) && /\bcurl\b|\bwget\b|\bssh\b|\brm\b/.test(trimmed)) {
    return "danger";
  }

  // Tokenize the first pipeline segment (best-effort, not a full parser).
  const firstSegment = trimmed.split(/[|;&]/)[0]!.trim();
  const argv = firstSegment.split(/\s+/).filter(Boolean);
  if (argv.length === 0) return "unknown";

  // Strip env-var prefixes (FOO=bar cmd ...).
  let i = 0;
  while (i < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i]!)) i++;
  const cmd = argv[i];
  const sub = argv[i + 1];
  if (!cmd) return "unknown";
  // Strip path prefix (/usr/bin/ls → ls).
  const base = path.basename(cmd).toLowerCase();

  // In-place mutation flags.
  if (argv.some((a) => MUTATING_FLAGS.has(a))) return "write";

  // Dangerous verb.
  if (DANGEROUS_COMMANDS.has(base)) return "danger";

  // Git subcommand classification.
  if (base === "git" && sub) {
    const s = sub.toLowerCase();
    if (GIT_DANGER_SUBCOMMANDS.has(s)) return "danger";
    if (GIT_WRITE_SUBCOMMANDS.has(s)) return "write";
    return "read"; // status/log/diff/show etc.
  }

  // Package managers: classify by subcommand.
  if (base === "npm" || base === "pnpm" || base === "yarn" || base === "bun") {
    if (sub && PM_DANGER_SUBCOMMANDS.has(sub.toLowerCase())) return "danger";
    if (sub && PM_WRITE_SUBCOMMANDS.has(sub.toLowerCase())) return "write";
    if (sub && PM_READ_SUBCOMMANDS.has(sub.toLowerCase())) return "read";
    // Unknown npm/pnpm subcommand: conservatively L2.
    return "write";
  }
  if (base === "cargo" && sub) {
    const s = sub.toLowerCase();
    if (CARGO_DANGER_SUBCOMMANDS.has(s)) return "danger";
    if (s === "build" || s === "test" || s === "run" || s === "fix" || s === "clean") return "write";
    if (CARGO_READ_SUBCOMMANDS.has(s)) return "read";
    return "write";
  }
  if (base === "go" && sub) {
    const s = sub.toLowerCase();
    if (s === "install" || s === "get" || s === "mod" || s === "run") return "write";
    if (s === "version" || s === "env" || s === "list" || s === "doc") return "read";
    return "write";
  }
  if ((base === "pip" || base === "pip3") && sub) {
    const s = sub.toLowerCase();
    if (s === "install" || s === "uninstall" || s === "download") return "danger";
    if (s === "list" || s === "show" || s === "freeze" || s === "check") return "read";
    return "write";
  }

  // Build/test tools write target/ but stay inside the workspace → L2.
  if (READ_ONLY_COMMANDS.has(base)) {
    // Node/python with -e / -c can do anything; conservatively L2.
    if ((base === "node" || base === "python" || base === "python3" || base === "ruby" ||
         base === "perl" || base === "deno" || base === "bun") &&
        (argv.includes("-e") || argv.includes("-c") || argv.includes("--eval"))) {
      return "write";
    }
    // sed without -i is read-only; awk/etc are filters → read-only.
    if (base === "sed" && !argv.includes("-i")) return "read";
    return "read";
  }

  // Unknown command: treat as L2 (ask), never silent L1.
  return "unknown";
}
