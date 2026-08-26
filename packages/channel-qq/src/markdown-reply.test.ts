import assert from "node:assert/strict";
import test from "node:test";
import {
  applyC2cPassiveQuota,
  chunkMarkdownText,
  isMarkdownRejection,
  markdownPayload,
  nextMessageSeq,
  plainPayload,
  QQ_C2C_PASSIVE_REPLY_LIMIT,
  QQ_PARTIAL_REPLY_NOTICE,
  safeSliceIndex,
} from "./markdown-reply.js";

test("QQ markdown chunks keep fences and GFM tables intact", () => {
  const code = "```js\nconsole.log(1);\n```";
  const text = `${"A".repeat(80)}\n\n${code}\n\n${"B".repeat(80)}`;
  const chunks = chunkMarkdownText(text, 120);
  assert.equal(chunks.some((chunk) => chunk.includes(code)), true);
  for (const chunk of chunks) assert.ok(chunk.length <= 120);
  const table = ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n");
  const tableChunks = chunkMarkdownText(`${"x".repeat(90)}\n${table}`, 100);
  assert.equal(tableChunks.some((chunk) => chunk.includes("| a | b |") && chunk.includes("| 1 | 2 |")), true);
});

test("QQ markdown uses unique seq and falls back only on platform rejection", () => {
  assert.equal(nextMessageSeq(0), 1);
  assert.equal(nextMessageSeq(7), 8);
  const first = markdownPayload("hello", 1);
  const second = markdownPayload("hello", 2);
  assert.equal(first.msgType, 2);
  assert.notEqual(first.extra.msg_seq, second.extra.msg_seq);
  assert.equal(plainPayload("hello", 3).msgType, 0);
  assert.equal(isMarkdownRejection({ code: 40_034_090, message: "markdown rejected" }), true);
  assert.equal(isMarkdownRejection(new Error("timeout")), false);
});

test("QQ C2C passive quota keeps four messages and a continue notice", () => {
  const long = "x".repeat(20_000);
  const chunks = chunkMarkdownText(long, 4_500);
  assert.ok(chunks.length > QQ_C2C_PASSIVE_REPLY_LIMIT);
  const quota = applyC2cPassiveQuota(chunks);
  assert.equal(quota.truncated, true);
  assert.equal(quota.chunks.length, QQ_C2C_PASSIVE_REPLY_LIMIT);
  assert.equal(quota.chunks.at(-1), QQ_PARTIAL_REPLY_NOTICE);
  const within = applyC2cPassiveQuota(["a", "b"]);
  assert.equal(within.truncated, false);
  assert.deepEqual(within.chunks, ["a", "b"]);
});

test("QQ markdown hard-split does not cut a surrogate pair", () => {
  const pair = "\uD83D\uDE00";
  const text = `${"a".repeat(7)}${pair}${"b".repeat(7)}`;
  const index = safeSliceIndex(text, 8);
  assert.equal(index, 7);
  const chunks = chunkMarkdownText(text, 8);
  for (const chunk of chunks) {
    assert.equal(chunk.includes("\uD83D") && !chunk.includes(pair), false);
  }
});
