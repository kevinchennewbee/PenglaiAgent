/**
 * Owner-requested diagnostic bundle.
 *
 * The bundle is deliberately narrower than a backup: it contains runtime
 * metadata, Doctor results, and recent text logs only. Product state,
 * conversations, model profiles, credentials, MCP configuration, memories,
 * skills, and databases are never traversed.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import {
  DATABASE_SCHEMA_VERSION,
  PRODUCT_VERSION,
  SCHEMA_VERSION,
} from "@penglai/protocol";
import { runDoctor, type DoctorResult } from "./doctor.js";
import { penglaiDataDir } from "./data-dir.js";
import { redactSensitiveText } from "./security/redaction.js";
import { openRegularFileNoFollow } from "./security/private-file.js";

const MAX_LOG_FILES = 20;
const MAX_LOG_BYTES_EACH = 2 * 1024 * 1024;
const MAX_LOG_BYTES_TOTAL = 5 * 1024 * 1024;
const ALLOWED_LOG_EXTENSIONS = new Set([".log", ".jsonl", ".txt"]);

export interface DiagnosticExportOptions {
  dataDir?: string;
  outputDir?: string;
  doctorResults?: DoctorResult[];
  now?: () => Date;
  randomId?: () => string;
}

export interface DiagnosticExportResult {
  path: string;
  bytes: number;
  includedLogs: number;
  redactions: number;
}

function timestamp(value: Date): string {
  return value.toISOString().replace(/[:.]/g, "-");
}

/** Redact credential-shaped values without trying to understand log syntax. */
export function sanitizeDiagnosticText(input: string, homeDir = os.homedir()): {
  text: string;
  redactions: number;
} {
  return redactSensitiveText(input, homeDir);
}

function recentLogFiles(logDir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(logDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && ALLOWED_LOG_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(logDir, entry.name))
    .filter((file) => {
      try {
        const stat = fs.lstatSync(file);
        return stat.isFile() && !stat.isSymbolicLink();
      } catch {
        return false;
      }
    })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .slice(0, MAX_LOG_FILES);
}

function readLogTail(file: string): Buffer {
  const opened = openRegularFileNoFollow(file);
  const bytes = Math.min(opened.stat.size, MAX_LOG_BYTES_EACH);
  try {
    const buffer = Buffer.alloc(bytes);
    fs.readSync(
      opened.descriptor,
      buffer,
      0,
      bytes,
      Math.max(0, opened.stat.size - bytes),
    );
    return buffer;
  } finally {
    fs.closeSync(opened.descriptor);
  }
}

export async function exportDiagnostics(
  options: DiagnosticExportOptions = {},
): Promise<DiagnosticExportResult> {
  const dataDir = path.resolve(options.dataDir ?? penglaiDataDir());
  const outputDir = path.resolve(options.outputDir ?? path.join(dataDir, "diagnostics"));
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const now = options.now?.() ?? new Date();
  const id = (options.randomId?.() ?? randomUUID()).replace(/[^A-Za-z0-9-]/g, "").slice(0, 12);
  const target = path.join(outputDir, `penglai-diagnostics-${timestamp(now)}-${id}.zip`);

  const doctorResults = options.doctorResults ?? (await runDoctor());
  const files: Record<string, Uint8Array> = {};
  let redactions = 0;
  files["about.json"] = strToU8(JSON.stringify({
    product: "Penglai",
    productVersion: PRODUCT_VERSION,
    protocolSchemaVersion: SCHEMA_VERSION,
    databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    platform: process.platform,
    architecture: process.arch,
    node: process.versions.node,
    note: "No conversations, credentials, model profiles, MCP configuration, memories, skills, or databases are included.",
  }, null, 2));
  const sanitizedDoctor = sanitizeDiagnosticText(JSON.stringify(doctorResults, null, 2));
  files["doctor.json"] = strToU8(sanitizedDoctor.text);
  redactions += sanitizedDoctor.redactions;

  let includedLogs = 0;
  let totalLogBytes = 0;
  for (const file of recentLogFiles(path.join(dataDir, "logs"))) {
    const raw = readLogTail(file);
    if (totalLogBytes + raw.byteLength > MAX_LOG_BYTES_TOTAL) continue;
    const sanitized = sanitizeDiagnosticText(raw.toString("utf-8"));
    files[`logs/${path.basename(file)}`] = strToU8(sanitized.text);
    includedLogs += 1;
    totalLogBytes += raw.byteLength;
    redactions += sanitized.redactions;
  }
  files["manifest.json"] = strToU8(JSON.stringify({
    includedLogs,
    sourceLogBytes: totalLogBytes,
    redactions,
    excludedByDesign: [
      "host.token",
      "profiles.json",
      "product.db",
      "conversations/",
      "memory/",
      "skills/",
      "mcp/",
    ],
  }, null, 2));

  const archive = Buffer.from(zipSync(files, { level: 6 }));
  fs.writeFileSync(target, archive, { flag: "wx", mode: 0o600 });
  return { path: target, bytes: archive.byteLength, includedLogs, redactions };
}
