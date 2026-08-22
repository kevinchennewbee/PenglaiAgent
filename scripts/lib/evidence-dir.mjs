import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, gitState } from "./repo.mjs";
import { PINNED_DSH, PINNED_DSH_COMMIT, PINNED_DSH_TAG } from "./product.mjs";

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

export function evidenceDirFor(sourceSha, target = HOST_TARGET) {
  return join(ROOT, "evidence", "generated", sourceSha, target);
}

export function beginEvidenceRun(input = {}) {
  const git = gitState();
  const target = input.target ?? HOST_TARGET;
  const command = input.command ?? "unspecified";
  const dir = evidenceDirFor(git.head, target);
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
  run.commands.push(row);
  appendFileSync(join(run.dir, "commands.jsonl"), `${JSON.stringify(row)}\n`);
  if (rec.stdout) appendFileSync(join(run.dir, "stdout.log"), rec.stdout.endsWith("\n") ? rec.stdout : `${rec.stdout}\n`);
  if (rec.stderr) appendFileSync(join(run.dir, "stderr.log"), rec.stderr.endsWith("\n") ? rec.stderr : `${rec.stderr}\n`);
}

export function recordArtifact(run, path, mime = "application/octet-stream") {
  if (!existsSync(path)) return;
  const st = statSync(path);
  const row = {
    path,
    sha256: sha256File(path),
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
  writeFileSync(join(run.dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(run.dir, "result.json"), `${JSON.stringify({ verdict: finalVerdict, reason: finalReason, sourceSha: run.git.head }, null, 2)}\n`);
  return manifest;
}
