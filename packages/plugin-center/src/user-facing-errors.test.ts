import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const CLIENTS = [
  ["ASR", "../../asr/src/dsh-client.js"],
  ["TTS", "../../moss-tts/src/dsh-client.js"],
  ["Memory sources", "../../context/src/dsh-client.js"],
  ["Office", "../../office/src/dsh-client.js"],
  ["IM", "../../im/src/dsh-client.js"],
  ["Plugin Center", "./dsh-client.js"],
] as const;

test("Penglai-owned settings never render caught exception text", () => {
  for (const [label, path] of CLIENTS) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /String\(error|error instanceof Error \? error\.message|typeof error\.message|String\(entry\.error\)|errorText\(/,
      `${label} must keep raw exceptions behind the user-facing boundary`,
    );
  }
});

test("voice settings localize closed model states and recovery copy", () => {
  for (const path of [
    "../../asr/src/dsh-client.js",
    "../../moss-tts/src/dsh-client.js",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /function modelStateText/);
    assert.match(source, /not_installed: "未安装"/);
    assert.match(source, /not_installed: "Not installed"/);
    assert.match(source, /operationFailed/);
    assert.doesNotMatch(source, /children: \[t\.state, ": ", String\(model\)\]/);
    assert.doesNotMatch(source, /String\(row\.state/);
  }
});

test("Plugin Center copy agrees with the eight-channel registry", () => {
  const source = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(source, /管理八个消息平台/);
  assert.match(source, /connections for eight messaging platforms/);
  assert.doesNotMatch(source, /九个消息平台|nine messaging platforms/);
  assert.match(source, /centerActionRetry/);
});
