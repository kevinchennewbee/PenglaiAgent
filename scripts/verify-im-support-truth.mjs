#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const failures = [];

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function requireTokens(label, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) failures.push(`${label} lost ${token}`);
  }
}

const registry = read("packages/im/src/registry.ts");
const host = read("packages/im/src/host.ts");
const client = read("packages/im/src/dsh-client.js");
const adapter = read("packages/im/src/channel-adapter.ts");
const bridge = read("packages/im/src/adapters/channel-bridge.ts");
const sidecars = ["dingtalk", "wecom", "qq", "slack", "telegram", "discord"].map((id) => [
  `channel-${id}`,
  read(`packages/channel-${id}/src/index.ts`),
]);

requireTokens("registry", registry, [
  'NATIVE_CHANNEL_IDS = ["weixin", "feishu"]',
  'CHANNEL_ADAPTER_MODES = ["native", "bundled-sidecar"]',
  'CHANNEL_RELEASE_EVIDENCE = ["source-only", "installed", "owner-live", "public-release"]',
  'CHANNEL_CAPABILITY_EVIDENCE = ["source-tested", "not-proven", "not-supported"]',
  "entryAvailable: true",
  "runtimeBundled: true",
  'releaseEvidence: "source-only"',
  "capabilityEvidence",
]);
requireTokens("host", host, [
  "entryAvailable: manifest.entryAvailable",
  "adapterMode: manifest.adapterMode",
  "runtimeBundled: manifest.runtimeBundled",
  "releaseEvidence: manifest.releaseEvidence",
  "capabilityEvidence: manifest.capabilityEvidence",
]);
requireTokens("client", client, [
  "data-penglai-im-entry",
  "data-penglai-im-adapter-mode",
  "data-penglai-im-runtime-bundled",
  "data-penglai-im-release-evidence",
  "data-penglai-im-capability-evidence",
  "source evidence only",
]);
requireTokens("adapter", adapter, [
  'connection: "connecting"',
  "runtimeBundled: manifest.runtimeBundled",
  "capabilityEvidence()",
]);
requireTokens("bridge", bridge, [
  "runtimeBundled: true",
  'connection: "connecting"',
  "capabilityEvidence: () => manifest.capabilityEvidence",
]);

for (const [label, source] of sidecars) {
  requireTokens(label, source, ["runtimeBundled: true", "connection: this.connection"]);
}

for (const [label, source] of [["registry", registry], ["host", host], ["client", client], ["adapter", adapter], ["bridge", bridge], ...sidecars]) {
  const forbidden = [
    ["supportLevel", /\bsupportLevel\b/],
    ["data-penglai-im-live", /data-penglai-im-live/],
    [".live", /\.live\b/],
    ["live property", /(?:^|[,{;]\s*)live\s*:/m],
  ];
  for (const [name, pattern] of forbidden) {
    if (pattern.test(source)) failures.push(`${label} retains ambiguous support token ${name}`);
  }
}

if (failures.length > 0) {
  console.error(JSON.stringify({ schema: 1, gate: "Penglai-IM-support-truth", result: "FAIL", failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema: 1,
  gate: "Penglai-IM-support-truth",
  result: "PASS",
  channels: 8,
  nativeChannels: 2,
  releaseEvidence: "source-only",
  capabilityEvidence: ["source-tested", "not-proven", "not-supported"],
}, null, 2));
