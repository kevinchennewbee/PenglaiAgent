import { PenglaiError } from "@penglai/contracts";

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

export interface ArchiveEntry {
  name: string;
  type: "file" | "directory" | "symlink";
  linkTarget?: string;
}

export function assertSafeArchiveEntry(entry: ArchiveEntry): void {
  const name = entry.name.replace(/\\/g, "/");
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw new PenglaiError("SECURITY_POLICY", `absolute archive path ${entry.name}`);
  }
  const parts = name.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) {
    throw new PenglaiError("SECURITY_POLICY", `path escape ${entry.name}`);
  }
  if (entry.type === "symlink") {
    throw new PenglaiError("SECURITY_POLICY", `symlink refused ${entry.name}`);
  }
  const base = parts[parts.length - 1] ?? "";
  if (WINDOWS_RESERVED.test(base)) {
    throw new PenglaiError("SECURITY_POLICY", `reserved windows name ${base}`);
  }
}

export function detectCaseCollision(names: readonly string[]): string | undefined {
  const seen = new Map<string, string>();
  for (const name of names) {
    const key = name.replace(/\\/g, "/").toLowerCase();
    const prev = seen.get(key);
    if (prev && prev !== name) return name;
    seen.set(key, name);
  }
  return undefined;
}

export function assertSafeArchive(entries: readonly ArchiveEntry[]): void {
  const names = entries.map((e) => e.name);
  const collision = detectCaseCollision(names);
  if (collision) throw new PenglaiError("SECURITY_POLICY", `case collision ${collision}`);
  for (const entry of entries) assertSafeArchiveEntry(entry);
}
