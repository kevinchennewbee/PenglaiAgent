import assert from "node:assert/strict";
import test from "node:test";
import { partitionGitArchivePaths } from "./git-archive-chunks.mjs";

test("git archive paths are partitioned below Windows command-line limits", () => {
  const paths = Array.from({ length: 251 }, (_, index) => `third_party/dsh/package-${index}.tgz`);
  const chunks = partitionGitArchivePaths(paths, { maxFiles: 40, maxArgumentChars: 1_000 });

  assert.deepEqual(chunks.flat(), paths);
  assert.ok(chunks.every((chunk) => chunk.length <= 40));
  assert.ok(chunks.every((chunk) => chunk.reduce((sum, path) => sum + path.length, 0) <= 1_000));
});

test("git archive path partitioning rejects an unrepresentable path", () => {
  assert.throws(
    () => partitionGitArchivePaths(["too-long"], { maxArgumentChars: 4 }),
    /exceeds the per-command character limit/,
  );
});
