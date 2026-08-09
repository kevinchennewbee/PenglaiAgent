/**
 * penglai CLI — terminal formatting + tiny argv helpers.
 *
 * Codex-style restraint: plain text, readline, no TUI framework. Color is
 * used sparingly (dim for meta, bold for attention) and only on a TTY.
 */

export interface CliIO {
  /** Raw write, no trailing newline (streaming deltas). */
  out: (text: string) => void;
  /** Line write, trailing newline added. */
  line: (text: string) => void;
  /** Error line write. */
  err: (text: string) => void;
  /** True when stdout is an interactive terminal (enables color). */
  tty: boolean;
}

// ── color (TTY only) ───────────────────────────────────────────

export interface Style {
  dim: (text: string) => string;
  bold: (text: string) => string;
  green: (text: string) => string;
  red: (text: string) => string;
  yellow: (text: string) => string;
  cyan: (text: string) => string;
}

export function styleFor(tty: boolean): Style {
  if (!tty) {
    const plain = (text: string): string => text;
    return { dim: plain, bold: plain, green: plain, red: plain, yellow: plain, cyan: plain };
  }
  const wrap = (code: string) => (text: string) => `\u001b[${code}m${text}\u001b[0m`;
  return {
    dim: wrap("2"),
    bold: wrap("1"),
    green: wrap("32"),
    red: wrap("31"),
    yellow: wrap("33"),
    cyan: wrap("36"),
  };
}

// ── time + token formatting ────────────────────────────────────

/** "3s ago" / "4m ago" / "2h ago" / "5d ago" relative to now. */
export function timeAgo(timestamp: number, now: number = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d ago`;
  return "1y+ ago";
}

/** "1,234" grouped thousands. */
export function count(value: number): string {
  return value.toLocaleString("en-US");
}

/** Shorten an id for display: keep it recognizable but compact. */
export function shortId(id: string | null | undefined): string {
  if (id == null || id === "") return "—";
  if (id.length <= 14) return id;
  return `${id.slice(0, 10)}…`;
}

/** Truncate a title/objective to one display line. */
export function oneLine(text: string, max = 72): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

// ── argv helpers ───────────────────────────────────────────────

export interface ParsedArgs {
  /** Positional arguments in order. */
  positionals: string[];
  /** Long flags: --name value | --name=value | --flag (true). */
  flags: Record<string, string | true>;
}

/**
 * Minimal long-flag parser (no short-flag bundles; the CLI surface is
 * small and explicit). "--" ends flag parsing.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  let rest = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (rest) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--") {
      rest = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
        continue;
      }
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[name] = next;
        i += 1;
      } else {
        flags[name] = true;
      }
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags };
}

/** Read a string flag (undefined when absent or boolean). */
export function flagValue(
  flags: Record<string, string | true>,
  name: string,
): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}
