import { PenglaiError } from "@penglai/contracts";
import { classifyArtifact } from "@penglai/artifacts";
import { OFFICE_ZIP_LIMITS, readZip } from "./zip.js";

export const MAX_OFFICE_BYTES = OFFICE_ZIP_LIMITS.archiveBytes;
export const MAX_UNCOMPRESSED_BYTES = OFFICE_ZIP_LIMITS.totalUncompressedBytes;

export function assertAuthorizedBytes(bytes: Buffer): void {
  if (!bytes?.length) throw new PenglaiError("INVALID_INPUT", "office bytes required");
  if (bytes.length > MAX_OFFICE_BYTES) throw new PenglaiError("SECURITY_POLICY", "office attachment too large");
  if (bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    classifyArtifact("office.pdf", bytes);
    return;
  }
  if (bytes.subarray(0, 2).toString("binary") === "PK") {
    const entries = readZip(bytes);
    const names = entries.map((entry) => entry.name.replaceAll("\\", "/"));
    const format = names.some((name) => name.startsWith("word/"))
      ? "docx"
      : names.some((name) => name.startsWith("xl/"))
        ? "xlsx"
        : names.some((name) => name.startsWith("ppt/"))
          ? "pptx"
          : undefined;
    if (!format) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_MAGIC");
    classifyArtifact(`office.${format}`, bytes);
    for (const entry of entries) {
      const name = entry.name.replaceAll("\\", "/");
      // OOXML generators commonly include empty directory entries such as
      // `ppt/embeddings/`.  A directory is not active content; files below one
      // of these paths are.  Treating the directory itself as an embedded
      // object made every pptfast presentation fail its own security gate.
      if (!name.endsWith("/") && /(^|\/)(activeX|embeddings|macrosheets|externalLinks)\//i.test(name)) {
        throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_EMBEDDED_OBJECT");
      }
      if (/\.rels$/i.test(name)) {
        const xml = entry.data.toString("utf8");
        if (/TargetMode\s*=\s*["']External["']/i.test(xml) || /Target\s*=\s*["'](?:https?|file|ftp):/i.test(xml)) {
          throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_EXTERNAL_LINK");
        }
      }
    }
    return;
  }
  throw new PenglaiError("INVALID_INPUT", "unsupported office format");
}

export function assertWorkspace(jobWorkspace: string | undefined, ctxWorkspace: string | undefined): void {
  if (jobWorkspace && ctxWorkspace && jobWorkspace !== ctxWorkspace) {
    throw new PenglaiError("SECURITY_POLICY", "office workspace isolation");
  }
}
