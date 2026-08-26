import assert from "node:assert/strict";
import test from "node:test";
import {
  chunkMarkdownText,
  isMarkdownRejection,
  markdownPayload,
  nextMessageSeq,
  plainPayload,
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
