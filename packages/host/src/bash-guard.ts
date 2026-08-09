/**
 * bash-guard.ts
 *
 * Deterministic static analysis of `bash` tool commands.
 *
 * Two responsibilities:
 *   1. Path containment (jail): every path-like argument / redirect target in
 *      the command must resolve inside the workspace jail. Escapes are L4 -
 *      the same hard refusal as the file tools (never grantable).
 *   2. Outbound classification: structured per-command L3 detection for
 *      publish / remote-shell / mutating-network commands, replacing the old
 *      brittle regex table (which missed `curl --request POST`, `npx publish`,
 *      `telnet`, `socat`, …).
 *
 * This is defense-in-depth, not a shell sandbox. Bash grammar is not fully
 * parsable statically: commands that fully obfuscate their intent (unknown
 * `$VAR` prefixes, `eval $(…)`, inline scripts that string-build paths)
 * cannot be proven safe here. The sensitive-path scan in policy.ts and the
 * approval dial remain the backstops; the documented hard boundary is
 * process-level isolation (future macOS seatbelt / container).
 */

import * as os from "node:os";
import * as path from "node:path";
import { isWithinWorkspace } from "./jail.js";

export interface BashSegment {
  argv: string[];
  redirects: string[];
}

/**
 * Lightweight shell tokenizer.
 *
 * Splits a command into segments on `;`, `&&`, `||`, `|`, `&` (with
 * `2>&1` / `&>` / `&&` special-cased) and newlines; tracks single/double
 * quotes, backslash escapes, `$(…)` command substitution and backticks so
 * quoted separators never split a segment. Redirect targets (`>`, `>>`,
 * `<`, `2>`, `&>`) are collected separately so the path guard can check
 * them like any other path.
 */
export function tokenizeBash(command: string): BashSegment[] {
  const segments: BashSegment[] = [];
  let argv: string[] = [];
  let redirects: string[] = [];
  let word = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let redirectNext = false;

  const flushWord = (): void => {
    if (word.length > 0) {
      if (redirectNext) redirects.push(word);
      else argv.push(word);
      word = "";
      redirectNext = false;
    } else if (redirectNext) {
      // A redirect token with an empty target (e.g. `>` alone): keep the
      // flag set so the NEXT whitespace-separated word becomes the target.
      redirectNext = true;
    }
  };
  const flushSegment = (): void => {
    flushWord();
    if (argv.length > 0 || redirects.length > 0) {
      segments.push({ argv, redirects });
    }
    argv = [];
    redirects = [];
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1];

    if (escaped) {
      word += ch;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && (next === '"' || next === "\\" || next === "$" || next === "`")) {
        word += ch; // keep the backslash so $VARS still expand
        escaped = true;
      } else word += ch;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "'") {
      quote = "'";
      continue;
    }
    if (ch === '"') {
      quote = '"';
      continue;
    }
    // $(…) command substitution: treat the whole span as one opaque token.
    if (ch === "$" && next === "(") {
      let depth = 1;
      let j = i + 2;
      while (j < command.length && depth > 0) {
        if (command[j] === "(") depth++;
        else if (command[j] === ")") depth--;
        j++;
      }
      word += command.slice(i, j);
      i = j - 1;
      continue;
    }
    // `…` backticks: one opaque token.
    if (ch === "`") {
      const close = command.indexOf("`", i + 1);
      const j = close === -1 ? command.length : close;
      word += command.slice(i, j + 1);
      i = j;
      continue;
    }
    // Redirects (>, >>, <, <<, >|, <>, &>). A pure-digit prefix (2>err) is a
    // file-descriptor, not an argument.
    if (ch === ">" || ch === "<") {
      if (/^\d+$/.test(word)) word = "";
      flushWord();
      let j = i;
      while (j + 1 < command.length && (command[j + 1] === ">" || command[j + 1] === "<")) j++;
      redirectNext = true;
      i = j;
      continue;
    }
    if (ch === "&") {
      if (next === "&") {
        flushSegment();
        i++;
        continue;
      }
      if (next === ">") {
        redirectNext = true;
        i++;
        continue;
      }
      // 2>&1 style fd duplication: `&` followed by a digit stays in the word.
      if (next !== undefined && /\d/.test(next)) {
        word += "&";
        continue;
      }
      flushSegment();
      continue;
    }
    if (ch === "|") {
      if (next === "|") {
        flushSegment();
        i++;
        continue;
      }
      flushSegment();
      continue;
    }
    if (ch === ";" || ch === "\n") {
      flushSegment();
      continue;
    }
    if (ch === " " || ch === "\t") {
      flushWord();
      continue;
    }
    word += ch;
  }
  flushSegment();
  return segments;
}

/** Wrapper prefixes that do not change the command's classification. */
const WRAPPER_COMMANDS = new Set(["sudo", "env", "nohup", "time", "command", "setsid", "nice", "exec"]);

function stripWrappers(argv: string[]): string[] {
  const out = [...argv];
  while (out.length > 0 && WRAPPER_COMMANDS.has(out[0].toLowerCase())) out.shift();
  return out;
}

/**
 * Resolve a path-like token against the workspace, expanding `~` and known
 * environment variables. Returns the absolute resolved path, or null when the
 * token is not statically resolvable (relative without `./`/`..`, unknown
 * `$VAR`, dynamic `$(…)`) or not path-like at all.
 */
function resolveToken(
  token: string,
  workspaceRoot: string,
  homeDir: string,
): string | null {
  if (token.includes("$(") || token.includes("`")) return null; // dynamic
  let t = token;
  const knownVars: Record<string, string> = {
    HOME: homeDir,
    PENGLAI_WORKSPACE: workspaceRoot,
    PWD: workspaceRoot,
  };
  t = t.replace(/\$\{?(\w+)\}?/g, (whole, name: string) =>
    name in knownVars ? knownVars[name] : whole,
  );
  if (t.includes("$")) return null; // unresolved variable: cannot prove safe
  if (t === "~") t = homeDir;
  else if (t.startsWith("~/")) t = path.join(homeDir, t.slice(2));
  else if (t.startsWith("~")) return null; // ~user form: rare, skip
  const isPathish =
    t.startsWith("/") ||
    t.startsWith("./") ||
    t.startsWith("../") ||
    t.startsWith("..") ||
    t.includes("/../");
  if (!isPathish) return null;
  return path.resolve(workspaceRoot, t);
}

function isUrlLike(token: string): boolean {
  return /^(?:https?|ftp|ws|wss|git|ssh):\/\//i.test(token);
}

function checkPathToken(
  token: string,
  workspaceRoot: string,
  homeDir: string,
): { escaped: boolean; reason?: string } {
  if (isUrlLike(token)) return { escaped: false }; // URLs go through the outbound gate
  const resolved = resolveToken(token, workspaceRoot, homeDir);
  if (resolved !== null && !isWithinWorkspace(workspaceRoot, resolved)) {
    return { escaped: true, reason: `'${token}' resolves outside the workspace jail` };
  }
  return { escaped: false };
}

function checkRedirect(
  target: string,
  workspaceRoot: string,
  homeDir: string,
): { escaped: boolean; reason?: string } {
  if (/^&\d+$/.test(target)) return { escaped: false }; // fd duplication (2>&1)
  return checkPathToken(target, workspaceRoot, homeDir);
}

/**
 * H1: whether a bash command can escape the workspace jail through a
 * path-like argument, redirect target, `cd`/`pushd`/`popd`, or a wrapped
 * `sh -c` / `bash -c` inline script.
 */
export function bashCommandEscapesJail(
  command: string,
  workspaceRoot: string,
  homeDir: string = os.homedir(),
): { escaped: boolean; reason?: string } {
  const segments = tokenizeBash(command);
  for (const seg of segments) {
    const argv = stripWrappers(seg.argv);
    const redirects = seg.redirects;

    if (argv.length === 0) {
      for (const r of redirects) {
        const res = checkRedirect(r, workspaceRoot, homeDir);
        if (res.escaped) return res;
      }
      continue;
    }

    const cmd = path.basename(argv[0]).toLowerCase();

    // Recurse into `sh -c '…'` / `bash -c '…'` inline scripts, and into
    // interpreter `-c`/`-e` snippets (python3 -c, node -e, perl -e, …).
    // The snippet string is treated as a nested command: path references
    // inside it are checked the same way (defense-in-depth; obfuscated
    // string-building escapes this and is documented as out of scope).
    const INLINE_INTERPRETERS = new Set([
      "sh", "bash", "zsh", "dash", "ksh", "fish",
      "python", "python3", "node", "perl", "ruby",
    ]);
    const inlineFlag = cmd === "node" || cmd === "perl" || cmd === "ruby" ? "-e" : "-c";
    if (INLINE_INTERPRETERS.has(cmd) && argv[1] === inlineFlag && argv[2] !== undefined) {
      const inner = bashCommandEscapesJail(
        argv.slice(2).join(" "),
        workspaceRoot,
        homeDir,
      );
      if (inner.escaped) return inner;
      // fall through: also check the remaining positional args
    }

    // cd-family: the target must stay inside the jail (a bare `cd`, `cd ~`
    // or `cd -` jumps outside it).
    if (cmd === "cd" || cmd === "pushd" || cmd === "popd") {
      const target = argv[1];
      if (target === undefined || target === "~" || target === "-") {
        return {
          escaped: true,
          reason: `'${cmd}' would change directory outside the workspace`,
        };
      }
      const resolved = resolveToken(target, workspaceRoot, homeDir);
      if (resolved !== null) {
        if (!isWithinWorkspace(workspaceRoot, resolved)) {
          return {
            escaped: true,
            reason: `'${cmd} ${target}' leaves the workspace jail`,
          };
        }
      } else if (
        target.startsWith("/") ||
        target.startsWith("~") ||
        target.includes("..")
      ) {
        // Absolute / home-anchored / parent-traversing targets cannot be
        // proven to stay inside; a plain relative subdir (src, ./sub) is fine.
        return {
          escaped: true,
          reason: `'${cmd} ${target}' leaves the workspace jail`,
        };
      }
      continue;
    }

    for (const arg of argv.slice(1)) {
      if (arg === "-" || arg.length === 0) continue;
      // `del` / `erase` are Windows commands whose switches use `/` (for
      // example `del /s /q build\\*`).  On a POSIX host those switches look
      // like absolute paths; treating `/s` as a filesystem target turns a
      // correctly classified L3 deletion into a misleading L4 jail escape.
      if ((cmd === "del" || cmd === "erase") && /^\/[a-z?]+$/i.test(arg)) {
        continue;
      }
      if (arg.startsWith("-")) {
        // --flag=value: check the value part.
        if (arg.includes("=")) {
          const value = arg.slice(arg.indexOf("=") + 1);
          const res = checkPathToken(value, workspaceRoot, homeDir);
          if (res.escaped) return res;
        } else if (arg.length > 2) {
          // Glued short-flag value (curl -o/tmp/x, tar -C../..).
          const value = arg.slice(2);
          if (value.length > 0 && (value.startsWith("/") || value.startsWith("~") || value.startsWith("."))) {
            const res = checkPathToken(value, workspaceRoot, homeDir);
            if (res.escaped) return res;
          }
        }
        continue;
      }
      const res = checkPathToken(arg, workspaceRoot, homeDir);
      if (res.escaped) return res;
    }
    for (const r of redirects) {
      const res = checkRedirect(r, workspaceRoot, homeDir);
      if (res.escaped) return res;
    }
  }
  return { escaped: false };
}

// ── H2: structured outbound classification ───────────────────────

/** Curl uploads / explicit non-GET methods are mutating network. */
function hasMutatingCurlFlag(argv: string[]): boolean {
  let method: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-d" || a === "--data" || a.startsWith("--data-") || a.startsWith("--data=")) return true;
    if (a === "-F" || a === "--form" || a.startsWith("--form=")) return true;
    if (a === "-T" || a === "--upload-file" || a.startsWith("--upload-file=")) return true;
    if (a === "-X" || a === "--request") {
      method = (argv[i + 1] ?? "").toUpperCase();
    } else if (a.startsWith("--request=")) {
      method = a.slice("--request=".length).toUpperCase();
    } else if (a.length > 2 && a[0] === "-" && a[1] === "X") {
      // Glued form: -XPOST
      method = a.slice(2).toUpperCase();
    }
  }
  return method !== null && method !== "" && method !== "GET" && method !== "HEAD";
}

/** Whether a single command (argv) is an L3 outbound operation. */
function classifyOutbound(argv: string[]): boolean {
  const cmd = path.basename(argv[0]).toLowerCase();
  const rest = argv.slice(1);

  // Recurse into `sh -c '…'` / `bash -c '…'`.
  if (
    ["sh", "bash", "zsh", "dash", "ksh"].includes(cmd) &&
    rest[0] === "-c" &&
    rest[1] !== undefined
  ) {
    return isOutboundCommand(rest.slice(1).join(" "));
  }

  switch (cmd) {
    case "git":
      return rest[0] === "push";
    case "npm":
    case "pnpm":
    case "yarn":
    case "bun":
    case "corepack":
    case "npx":
    case "dlx":
      return rest[0] === "publish";
    case "docker":
    case "podman":
    case "nerdctl":
      return ["push", "run", "exec", "build", "login", "logout"].includes(rest[0] ?? "");
    case "ssh":
    case "scp":
    case "sftp":
    case "telnet":
    case "rlogin":
    case "rsh":
      return true;
    case "nc":
    case "ncat":
    case "netcat":
    case "socat":
      return true;
    // DNS tools can act as covert exfil / probing channels; elevate so the
    // owner sees them (never silent L1).
    case "dig":
    case "nslookup":
    case "host":
      return true;
    case "rsync":
      return rest.some((a) => /^[^:\s]+:/.test(a) && !a.startsWith("--"));
    case "curl":
      return hasMutatingCurlFlag(argv);
    case "wget":
      return rest.some((a, i) => {
        if (a.startsWith("--post-data=") || a.startsWith("--post-file=")) return true;
        if (a === "--post-data" || a === "--post-file" || a === "--method") {
          const value = rest[i + 1] ?? "";
          if (a === "--method") {
            const m = value.toUpperCase();
            return m !== "" && m !== "GET" && m !== "HEAD";
          }
          return true;
        }
        if (a.startsWith("--method=")) {
          const m = a.slice("--method=".length).toUpperCase();
          return m !== "GET" && m !== "HEAD";
        }
        return false;
      });
    // Cloud / bulk-transfer CLIs are always outbound.
    case "aws":
    case "gcloud":
    case "az":
    case "rclone":
    case "kubectl":
    case "helm":
      return true;
    // gh/glab: publishing surfaces only; read-only queries stay local.
    case "gh":
    case "glab":
      return /(^|\s)(release\s+|pr\s+create|issue\s+create|repo\s+create|gist\s+create|workflow\s+run)/.test(
        rest.join(" ").toLowerCase(),
      );
    default:
      return false;
  }
}

/**
 * H2: whether a bash command performs an L3 outbound operation (publish,
 * remote shell, mutating network, cloud CLI, covert channel).
 */
export function isOutboundCommand(command: string): boolean {
  const segments = tokenizeBash(command);
  return segments.some((seg) => {
    const argv = stripWrappers(seg.argv);
    return argv.length > 0 && classifyOutbound(argv);
  });
}

// ── cloud metadata (credential exfiltration surface) ─────────────

const CLOUD_METADATA_PATTERNS: ReadonlyArray<RegExp> = [
  /\b169\.254\.169\.254(?![\w.])/, // AWS / GCP / Azure IMDS (host literal)
  /\b169\.254\.170\.2(?![\w.])/, // ECS task credentials
  /\b100\.100\.100\.200(?![\w.])/, // Alibaba Cloud
  /\bmetadata\.google\.internal\b/i,
  /\binstance-data(?:\.ec2\.internal)?\b/i,
];

/** Whether a command references a cloud metadata endpoint (L3, never silent). */
export function isCloudMetadataCommand(command: string): boolean {
  const c = command.toLowerCase();
  return CLOUD_METADATA_PATTERNS.some((p) => p.test(c));
}
