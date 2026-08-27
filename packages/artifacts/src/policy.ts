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

export const ARTIFACT_SOURCES = ["composer", "office", "im", "memory", "generated"] as const;
export const ARTIFACT_SCOPES = ["turn", "workspace", "memory-source"] as const;
export const ARTIFACT_KINDS = ["image", "document", "audio", "file"] as const;

export type ArtifactSource = (typeof ARTIFACT_SOURCES)[number];
export type ArtifactScope = (typeof ARTIFACT_SCOPES)[number];
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

const ADMIT: Record<string, { mediaType: string; kind: ArtifactKind; family: "text" | "pdf" | "ooxml-word" | "ooxml-sheet" | "ooxml-deck" }> = {
  ".docx": {
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "document",
    family: "ooxml-word",
  },
  ".xlsx": {
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "document",
    family: "ooxml-sheet",
  },
  ".pptx": {
    mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "document",
    family: "ooxml-deck",
  },
  ".pdf": { mediaType: "application/pdf", kind: "document", family: "pdf" },
  ".txt": { mediaType: "text/plain", kind: "file", family: "text" },
  ".md": { mediaType: "text/markdown", kind: "file", family: "text" },
  ".csv": { mediaType: "text/csv", kind: "file", family: "text" },
};

const REJECT_EXT = [
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

const MACRO_NAMES = /vba(project|data)|macrosheets|(^|\/)activeX\//i;
const EMBEDDED_NAMES = /(^|\/)(embeddings|externalLinks)\//i;
const ENCRYPT_NAMES = /encryptioninfo|encryptedpackage|strongencryption/i;
const NESTED_ARCHIVE = /\.(zip|7z|rar|tar|tgz|gz|jar)$/i;

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
  if (admitted.family === "text") assertText(bytes);
  else if (admitted.family === "pdf") assertPdf(bytes);
  else assertOoxml(bytes, admitted.family);
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

function assertPdf(bytes: Buffer): void {
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_MAGIC");
  }
  const head = bytes.subarray(0, Math.min(bytes.length, 16 * 1024)).toString("latin1");
  if (head.includes("/Encrypt")) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_ENCRYPTED");
}

function assertOoxml(bytes: Buffer, family: "ooxml-word" | "ooxml-sheet" | "ooxml-deck"): void {
  const names = listZipNames(bytes);
  const marker =
    family === "ooxml-word" ? "word/" : family === "ooxml-sheet" ? "xl/" : "ppt/";
  if (!names.some((name) => name.replaceAll("\\", "/").startsWith(marker))) {
    throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_MAGIC");
  }
}

function listZipNames(buf: Buffer): string[] {
  if (buf.length < 22 || !buf.subarray(0, 4).equals(Buffer.from("PK\u0003\u0004", "binary"))) {
    throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_MAGIC");
  }
  const eocd = findEocd(buf);
  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_ZIP");
  if (entries > ARTIFACT_LIMITS.maxZipEntries) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_ZIP");
  if (cdOff === 0xffffffff || cdSize === 0xffffffff) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_ZIP");
  if (cdOff + cdSize > eocd) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_ZIP");
  const names: string[] = [];
  let i = cdOff;
  const folded = new Set<string>();
  for (let n = 0; n < entries; n += 1) {
    if (!buf.subarray(i, i + 4).equals(Buffer.from("PK\u0001\u0002", "binary"))) {
      throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_ZIP");
    }
    const flags = buf.readUInt16LE(i + 8);
    const method = buf.readUInt16LE(i + 10);
    const nameLen = buf.readUInt16LE(i + 28);
    const extraLen = buf.readUInt16LE(i + 30);
    const commentLen = buf.readUInt16LE(i + 32);
    const uncomp = buf.readUInt32LE(i + 24);
    if (flags & 0x0001) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_ENCRYPTED");
    if (method !== 0 && method !== 8) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_ZIP");
    if (uncomp === 0xffffffff) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_ZIP");
    if (nameLen === 0 || nameLen > ARTIFACT_LIMITS.maxZipNameBytes) {
      throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_ZIP");
    }
    const name = buf.subarray(i + 46, i + 46 + nameLen).toString("utf8");
    if (name.includes("\0") || name.includes("..") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
      throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_ZIP");
    }
    const lower = name.toLowerCase();
    if (folded.has(lower)) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_ZIP");
    folded.add(lower);
    if (MACRO_NAMES.test(name)) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_MACRO");
    if (EMBEDDED_NAMES.test(name) && !name.endsWith("/")) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_EMBEDDED_OBJECT");
    if (ENCRYPT_NAMES.test(name)) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_ENCRYPTED");
    if (NESTED_ARCHIVE.test(name)) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_NESTED_ARCHIVE");
    names.push(name);
    i += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.subarray(i, i + 4).equals(Buffer.from("PK\u0005\u0006", "binary"))) {
      const comment = buf.readUInt16LE(i + 20);
      if (i + 22 + comment === buf.length) return i;
    }
  }
  throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_ZIP");
}
