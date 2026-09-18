import { PenglaiError } from "@penglai/contracts";

export const ARTIFACT_LIMITS = {
  maxFileBytes: 8 * 1024 * 1024,
  maxTurnFiles: 5,
  maxTurnBytes: 24 * 1024 * 1024,
  turnTtlMs: 24 * 60 * 60 * 1000,
  maxNameBytes: 180,
  maxZipEntries: 256,
  maxZipNameBytes: 512,
} as const;

// `office` and `document` are retained only so older persisted artifact rows can
// still be read during upgrade. Current 0.6.3 admission is text/media-only.
export const ARTIFACT_SOURCES = ["composer", "office", "im", "memory", "generated"] as const;
export const ARTIFACT_SCOPES = ["turn", "workspace", "memory-source"] as const;
export const ARTIFACT_KINDS = ["image", "document", "audio", "file"] as const;

export type ArtifactSource = (typeof ARTIFACT_SOURCES)[number];
export type ArtifactScope = (typeof ARTIFACT_SCOPES)[number];
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

const ADMIT: Record<string, { mediaType: string; kind: ArtifactKind; family: "text" }> = {
  ".txt": { mediaType: "text/plain", kind: "file", family: "text" },
  ".md": { mediaType: "text/markdown", kind: "file", family: "text" },
  ".csv": { mediaType: "text/csv", kind: "file", family: "text" },
};

const REJECT_EXT = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".docm",
  ".xlsm",
  ".pptm",
  ".dotm",
  ".xltm",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".js",
  ".mjs",
  ".cjs",
  ".sh",
  ".ps1",
  ".bat",
  ".cmd",
  ".wasm",
  ".wat",
  ".zip",
  ".7z",
  ".rar",
  ".tar",
  ".gz",
  ".tgz",
];

export function displayName(raw: string): string {
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? "";
  if (!base || base.includes("\0") || base === "." || base === "..") {
    throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_NAME");
  }
  if (base.includes("/") || base.includes("\\") || /sk-|token|secret|\/Users\/|\/home\//i.test(base)) {
    throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_NAME");
  }
  const utf = Buffer.from(base, "utf8");
  if (utf.length > ARTIFACT_LIMITS.maxNameBytes) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_NAME");
  return base;
}

export function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_EXTENSION");
  return lower.slice(dot);
}

export function classifyArtifact(name: string, bytes: Buffer): { mediaType: string; kind: ArtifactKind } {
  if (bytes.length <= 0 || bytes.length > ARTIFACT_LIMITS.maxFileBytes) {
    throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_SIZE");
  }
  const ext = extensionOf(name);
  if (REJECT_EXT.includes(ext)) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_FORBIDDEN_KIND");
  const admitted = ADMIT[ext];
  if (!admitted) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_EXTENSION");
  assertText(bytes);
  return { mediaType: admitted.mediaType, kind: admitted.kind };
}

function assertText(bytes: Buffer): void {
  if (bytes.includes(0)) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_TEXT_BINARY");
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return;
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_TEXT_ENCODING");
  }
}
