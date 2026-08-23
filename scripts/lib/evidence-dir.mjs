import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { ROOT, gitState } from "./repo.mjs";
import { PINNED_DSH, PINNED_DSH_COMMIT, PINNED_DSH_TAG } from "./product.mjs";
import { sanitizeEvidenceText, sanitizeEvidenceValue, writeEvidenceJson } from "./evidence-json.mjs";

export const HOST_TARGET =
  process.platform === "darwin"
    ? process.arch === "arm64"
      ? "darwin-aarch64"
      : "darwin-x86_64"
    : process.platform === "win32"
      ? "win32-x86_64"
      : `${process.platform}-${process.arch}`;

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function evidenceDirFor(sourceSha, target = HOST_TARGET, command = "unspecified") {
  const safeCommand = String(command).replaceAll(":", "-");
  return join(ROOT, "evidence", "generated", sourceSha, target, safeCommand);
}

export function beginEvidenceRun(input = {}) {
  const git = gitState();
  const target = input.target ?? HOST_TARGET;
  const command = input.command ?? "unspecified";
  const dir = evidenceDirFor(git.head, target, command);
  mkdirSync(join(dir, "artifacts"), { recursive: true });
  writeFileSync(join(dir, "stdout.log"), "", { flag: "a" });
  writeFileSync(join(dir, "stderr.log"), "", { flag: "a" });
  writeFileSync(join(dir, "commands.jsonl"), "", { flag: "a" });
  return {
    git,
    target,
    command,
    dir,
    startedAt: new Date().toISOString(),
    startedMs: Date.now(),
    commands: [],
    artifacts: [],
  };
}

export function recordCommand(run, rec) {
  const row = {
    at: new Date().toISOString(),
    argv: rec.argv,
    cwd: rec.cwd ?? ROOT,
    exitCode: rec.exitCode,
    signal: rec.signal ?? null,
    durationMs: rec.durationMs ?? null,
  };
  const safeRow = sanitizeEvidenceValue(row);
  run.commands.push(safeRow);
  appendFileSync(join(run.dir, "commands.jsonl"), `${JSON.stringify(safeRow)}\n`);
  if (rec.stdout) appendFileSync(join(run.dir, "stdout.log"), `${sanitizeEvidenceText(rec.stdout, 1_048_576)}\n`);
  if (rec.stderr) appendFileSync(join(run.dir, "stderr.log"), `${sanitizeEvidenceText(rec.stderr, 1_048_576)}\n`);
}

export function recordArtifact(run, path, mime = "application/octet-stream") {
  if (!existsSync(path)) return;
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink()) return;
  const digest = sha256File(path);
  const dest = join(run.dir, "artifacts", `${digest.slice(0, 16)}-${basename(path)}`);
  copyFileSync(path, dest);
  if (sha256File(dest) !== digest) throw new Error("evidence artifact copy hash mismatch");
  const row = {
    path: dest.slice(run.dir.length + 1).replaceAll("\\", "/"),
    sha256: digest,
    bytes: st.size,
    mime,
  };
  run.artifacts.push(row);
  return row;
}

export function finishEvidenceRun(run, verdict, reason, extra = {}) {
  const endedAt = new Date().toISOString();
  const officialPass = verdict === "PASS" && run.git.dirty === false;
  const finalVerdict = verdict === "PASS" && run.git.dirty ? "INCOMPLETE" : verdict;
  const finalReason =
    verdict === "PASS" && run.git.dirty ? "working tree dirty; official PASS forbidden" : reason;
  const manifest = {
    sourceSha: run.git.head,
    baseSha: run.git.originMain,
    branch: run.git.branch,
    dirty: run.git.dirty,
    target: run.target,
    command: run.command,
    startedAt: run.startedAt,
    endedAt,
    durationMs: Date.now() - run.startedMs,
    os: process.platform,
    arch: process.arch,
    node: process.version,
    dsh: { exact: PINNED_DSH, tag: PINNED_DSH_TAG, commit: PINNED_DSH_COMMIT },
    commands: run.commands,
    artifacts: run.artifacts,
    verdict: finalVerdict,
    officialPass,
    reason: finalReason,
    ...extra,
  };
  const safeManifest = sanitizeEvidenceValue(manifest);
  writeEvidenceJson(join(run.dir, "manifest.json"), safeManifest);
  writeEvidenceJson(join(run.dir, "result.json"), {
    verdict: finalVerdict,
    reason: finalReason,
    sourceSha: run.git.head,
  });
  return safeManifest;
}
