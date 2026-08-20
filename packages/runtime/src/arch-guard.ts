import { PenglaiError } from "@penglai/contracts";

export type ReleaseTargetKey = "darwin-aarch64" | "darwin-x86_64" | "windows-x86_64";

const TARGET_ARCH: Record<ReleaseTargetKey, { platform: "darwin" | "win32"; arch: "arm64" | "x64" }> = {
  "darwin-aarch64": { platform: "darwin", arch: "arm64" },
  "darwin-x86_64": { platform: "darwin", arch: "x64" },
  "windows-x86_64": { platform: "win32", arch: "x64" },
};

export interface ArchFacts {
  target: ReleaseTargetKey;
  electronArch?: string;
  nodeArch?: string;
  processArch?: string;
  manifestTarget?: string;
}

export function expectedArch(target: ReleaseTargetKey): string {
  const spec = TARGET_ARCH[target];
  if (!spec) throw new PenglaiError("INVALID_INPUT", `unknown target ${target}`);
  return spec.arch;
}

export function assertArchConsistent(facts: ArchFacts): void {
  const expect = expectedArch(facts.target);
  const fields: Array<[string, string | undefined]> = [
    ["electron", facts.electronArch],
    ["node", facts.nodeArch],
    ["process", facts.processArch],
    ["manifest", facts.manifestTarget],
  ];
  for (const [label, value] of fields) {
    if (!value) continue;
    const normalized = value === "x86_64" ? "x64" : value === "aarch64" ? "arm64" : value;
    if (normalized !== expect && normalized !== facts.target) {
      throw new PenglaiError("SECURITY_POLICY", `${label} arch ${value} != target ${facts.target}`);
    }
  }
}

export function assertInputMatchesTarget(filename: string, target: ReleaseTargetKey): void {
  const expect = expectedArch(target);
  const spec = TARGET_ARCH[target];
  if (spec.platform === "darwin" && /(^|[^a-z])win32|win-x64/.test(filename)) {
    throw new PenglaiError("SECURITY_POLICY", `${filename} is not a darwin input`);
  }
  if (spec.platform === "win32" && filename.includes("darwin")) {
    throw new PenglaiError("SECURITY_POLICY", `${filename} is not a windows input`);
  }
  if (expect === "arm64" && /x64|x86_64|win-x64|win32-x64/.test(filename) && !filename.includes("arm64")) {
    throw new PenglaiError("SECURITY_POLICY", `${filename} is not arm64`);
  }
  if (expect === "x64" && /arm64|aarch64/.test(filename)) {
    throw new PenglaiError("SECURITY_POLICY", `${filename} is not x64`);
  }
}
