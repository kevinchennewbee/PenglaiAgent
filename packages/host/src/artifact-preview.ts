/** Bounded, read-only artifact preview used by the desktop evidence rail. */

import * as fs from "node:fs";
import * as path from "node:path";
import { readDocument } from "./capabilities/documents.js";

const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".pptx", ".txt", ".md", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml", ".html", ".htm", ".rtf"]);
const SOURCE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".css", ".go", ".h", ".hpp", ".ini", ".java", ".js", ".jsx",
  ".kt", ".log", ".mjs", ".php", ".properties", ".py", ".rb", ".rs", ".sh", ".sql",
  ".swift", ".toml", ".ts", ".tsx", ".vue", ".zsh",
]);
const MAX_SOURCE_BYTES = 512 * 1024;
const DEFAULT_MAX_CHARS = 80_000;

export interface ArtifactPreview {
  path: string;
  name: string;
  format: string;
  text: string;
  truncated: boolean;
}

function readSourcePreview(target: string, maxChars: number): ArtifactPreview {
  const stat = fs.statSync(target);
  if (stat.size > MAX_SOURCE_BYTES) {
    throw new Error(`text artifact exceeds the ${MAX_SOURCE_BYTES} byte preview limit`);
  }
  const buffer = fs.readFileSync(target);
  if (buffer.includes(0)) throw new Error("binary artifact cannot be previewed as text");
  const decoded = buffer.toString("utf-8");
  const truncated = decoded.length > maxChars;
  return {
    path: target,
    name: path.basename(target),
    format: path.extname(target).slice(1).toLowerCase() || "text",
    text: truncated ? decoded.slice(0, maxChars) : decoded,
    truncated,
  };
}

export async function previewArtifactFile(
  workspaceRoot: string,
  target: string,
  maxChars = DEFAULT_MAX_CHARS,
): Promise<ArtifactPreview> {
  const limit = Math.max(1_000, Math.min(DEFAULT_MAX_CHARS, Math.floor(maxChars)));
  const rootReal = fs.realpathSync(workspaceRoot);
  const targetReal = fs.realpathSync(target);
  const relative = path.relative(rootReal, targetReal);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("artifact preview target escapes the workspace");
  }
  const stat = fs.lstatSync(targetReal);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("artifact preview target must be a regular file");
  }
  const extension = path.extname(targetReal).toLowerCase();
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    const preview = await readDocument(rootReal, targetReal, limit);
    return {
      path: preview.path,
      name: path.basename(preview.path),
      format: preview.format,
      text: preview.text,
      truncated: preview.truncated,
    };
  }
  if (SOURCE_EXTENSIONS.has(extension)) return readSourcePreview(targetReal, limit);
  throw new Error(`preview is not available for '${extension || "this file type"}'`);
}
