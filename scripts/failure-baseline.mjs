import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { ROOT, readJson, readText } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";

const MUST_CLOSE = [
  "FB-IDENTITY",
  "FB-REGISTRY",
  "FB-FUSES-EXIT",
  "FB-FANOUT",
  "FB-STALE-ALPHA",
  "FB-VERSIONS",
  "FB-AGGREGATOR",
  "FB-PUBLICATION",
];

function result(id, status, detail, proof) {
  if (status !== "REPRODUCED" && status !== "CLOSED") {
    throw new Error(`${id} illegal status ${status}`);
  }
  return { id, status, detail, proof };
}

async function loadIdentity() {
  return import(pathToFileURL(join(ROOT, "packages/release-identity/src/index.ts")).href);
}

async function probeIdentity() {
  const { assertReleaseIdentity, emptyIdentity } = await loadIdentity();
  let rejected = false;
  try {
    assertReleaseIdentity({
      ...emptyIdentity("ba5ba3dd65602a30a4b9fb815472d9abdc4805e5", false),
      artifactSha256: "c19e393e5d9b85190e60286e4fca30dbeb242799013baf605cf3615782683c79",
    });
  } catch {
    rejected = true;
  }
  if (!rejected) {
    return result("FB-IDENTITY", "REPRODUCED", "unfrozen identity still accepts stale artifact hash", { rejected });
  }
  return result("FB-IDENTITY", "CLOSED", "unfrozen identity rejects stale artifact hash", { rejected });
}

async function probeRegistry() {
  const { parseAcceptanceIds, assertRegistryConsistent, documentDeclaredHardCount, isStaleCompletionMap } = await loadIdentity();
  const md = readText("docs/ACCEPTANCE.md");
  const ids = parseAcceptanceIds(md);
  const declared = documentDeclaredHardCount(md);
  let consistent = true;
  try {
    assertRegistryConsistent(md);
  } catch {
    consistent = false;
  }
  const ok =
    consistent &&
    ids.length === declared &&
    new Set(ids).size === declared &&
    ids.every((id) => id.startsWith("R50-")) &&
    !isStaleCompletionMap(declared);
  if (!ok) {
    return result("FB-REGISTRY", "REPRODUCED", "registry is not a unique dynamic R50 set matching the document", {
      count: ids.length,
      declared,
    });
  }
  return result("FB-REGISTRY", "CLOSED", "ACCEPTANCE.md parses as a unique dynamic R50 Hard registry", { count: ids.length, declared });
}

function probeFusesExit() {
  const r = spawnSync(process.execPath, ["--input-type=module", "--eval", "import { finish } from './scripts/lib/exit-contract.mjs'; finish('INCOMPLETE', { command: 'verify:fuses', reason: 'baseline' });"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  const text = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const incomplete = /INCOMPLETE/.test(text);
  if (!incomplete || r.status === 0) {
    return result("FB-FUSES-EXIT", "REPRODUCED", "verify:fuses INCOMPLETE still exits 0", {
      status: r.status,
      incomplete,
    });
  }
  return result("FB-FUSES-EXIT", "CLOSED", "verify:fuses INCOMPLETE exits non-zero", { status: r.status });
}

async function probeFanout() {
  const { assertNoFanOut } = await loadIdentity();
  let rejected = false;
  try {
    assertNoFanOut([
      {
        acceptanceId: "R50-TRUTH-001",
        runnerId: "smoke",
        testId: "one",
        assertionId: "same",
        status: "PASS",
        candidateSourceSha: "a".repeat(40),
        startedAt: "t",
        endedAt: "t",
        exitCode: 0,
        resultDigest: "d",
      },
      {
        acceptanceId: "R50-LIVE-001",
        runnerId: "smoke",
        testId: "one",
        assertionId: "same",
        status: "PASS",
        candidateSourceSha: "a".repeat(40),
        startedAt: "t",
        endedAt: "t",
        exitCode: 0,
        resultDigest: "d",
      },
    ]);
  } catch {
    rejected = true;
  }
  if (!rejected) {
    return result("FB-FANOUT", "REPRODUCED", "one assertion can still PASS many Hard IDs", { rejected });
  }
  return result("FB-FANOUT", "CLOSED", "one-assertion-to-many-ID fan-out is rejected", { rejected });
}

async function probeStaleAlpha() {
  const { assertArtifactNotStale } = await loadIdentity();
  let rejected = false;
  try {
    assertArtifactNotStale({
      artifactSha256: "c19e393e5d9b85190e60286e4fca30dbeb242799013baf605cf3615782683c79",
      path: "dist/Penglai_0.2.0-alpha.3_macos_aarch64.dmg",
    });
  } catch {
    rejected = true;
  }
  if (!rejected) {
    return result("FB-STALE-ALPHA", "REPRODUCED", "alpha.3 artifact hash still accepted", { rejected });
  }
  return result("FB-STALE-ALPHA", "CLOSED", "alpha.3 artifact hash is STALE_INVALIDATED", { rejected });
}

function probeVersions() {
  const root = readJson("package.json");
  const info = readJson("release-info.json");
  const ok = root.version === "0.5.5" && info.productVersion === "0.5.5";
  if (!ok) {
    return result("FB-VERSIONS", "REPRODUCED", "workspace/release-info not 0.5.5", {
      packageVersion: root.version,
      productVersion: info.productVersion,
    });
  }
  return result("FB-VERSIONS", "CLOSED", "root and release-info are 0.5.5", { version: root.version });
}

async function probeAggregator() {
  const { HARD_SUBGATES, evaluateReleaseAggregation, REQUIRED_SUBGATE_KINDS } = await loadIdentity();
  const kinds = new Set(HARD_SUBGATES.map((g) => g.kind));
  const listed = REQUIRED_SUBGATE_KINDS.every((k) => kinds.has(k));
  const injected = evaluateReleaseAggregation({
    records: HARD_SUBGATES.map((g) => ({
      name: g.name,
      exit: g.name === "verify:identity" ? 1 : 0,
      verdict: g.name === "verify:identity" ? "FAIL" : "PASS",
    })),
    summaryVerdict: "PASS",
  });
  const ok = listed && injected.verdict === "FAIL" && injected.exitCode !== 0;
  if (!ok) {
    return result("FB-AGGREGATOR", "REPRODUCED", "release aggregator does not list/propagate all hard gates", {
      listed,
      injected,
    });
  }
  return result("FB-AGGREGATOR", "CLOSED", "release aggregator lists required kinds and propagates FAIL", {
    kinds: [...kinds],
  });
}

function probePublication() {
  const info = readJson("release-info.json");
  const pub = info.publication ?? {};
  const ok =
    pub.repo === "kevinchennewbee/PenglaiAgent" &&
    pub.tag === "v0.5.5" &&
    pub.release === "v0.5.5" &&
    pub.channel === "stable-v0.5.5";
  if (!ok) {
    return result("FB-PUBLICATION", "REPRODUCED", "publication fields do not match the owner-authorized destination", { pub });
  }
  return result("FB-PUBLICATION", "CLOSED", "public repo/tag/release and stable publication channel are exact", { pub });
}

function probeOnboarding() {
  const src = existsSync(join(ROOT, "packages/plugin-center/src/onboarding.ts"))
    ? readFileSync(join(ROOT, "packages/plugin-center/src/onboarding.ts"), "utf8")
    : "";
  const client = existsSync(join(ROOT, "packages/plugin-center/src/client.ts"))
    ? readFileSync(join(ROOT, "packages/plugin-center/src/client.ts"), "utf8")
    : "";
  const officialUi = /settings\.onboarding/.test(client) && /contributeOnboarding|onboarding\.register/.test(client);
  if (!officialUi) {
    return result("FB-ONBOARDING", "REPRODUCED", "onboarding is not a complete official DSH client UI flow", {
      officialUi,
      helperPresent: /welcome-v1/.test(src),
    });
  }
  return result("FB-ONBOARDING", "CLOSED", "onboarding registers official DSH client steps", { officialUi });
}

function probeUsableFixture() {
  const host = readText("packages/plugin-center/src/index.ts");
  const desktop = readText("apps/desktop/src/electron-main.ts");
  const present = /\/penglai\/usable-fixture/.test(host) || /\/penglai\/usable-fixture/.test(desktop);
  if (present) {
    return result("FB-USABLE-FIXTURE", "REPRODUCED", "production still registers /penglai/usable-fixture", { present });
  }
  return result("FB-USABLE-FIXTURE", "CLOSED", "production usable-fixture endpoint is gone", { present });
}

function probeWeixin() {
  const client = readText("packages/im/src/client.ts");
  const hasQrUi = /qrImage|qrcode|need-verification|QR_WAITING/.test(client);
  if (!hasQrUi) {
    return result("FB-WEIXIN", "REPRODUCED", "Weixin client UI does not render QR lifecycle", { hasQrUi });
  }
  return result("FB-WEIXIN", "CLOSED", "Weixin client renders QR lifecycle", { hasQrUi });
}

function probeFeishu() {
  const src = readText("packages/channel-feishu/src/index.ts");
  const client = readText("packages/im/src/client.ts");
  const persisted = /adapter_configs|credentials\.set|app-secret/.test(src);
  const wizard = /创建企业自建应用|configureFeishu/.test(client);
  const device = /beginDeviceFlow|device_code/.test(src);
  if (device || !persisted || !wizard) {
    return result("FB-FEISHU", "REPRODUCED", "Feishu App ID persistence/wizard is incomplete", {
      persisted,
      wizard,
      device,
    });
  }
  return result("FB-FEISHU", "CLOSED", "Feishu wizard persists App ID/Secret ref without Device Flow", {
    persisted,
    wizard,
    device,
  });
}

function probePeerRef() {
  const im = `${readText("packages/im/src/index.ts")}\n${readText("packages/im/src/host.ts")}`;
  const usesPeer = /pumpOutbox\([^)]*peerRef|send\([^)]*peerRef/.test(im);
  if (usesPeer) {
    return result("FB-PEERREF", "REPRODUCED", "IM still pumps outbox with hashed peerRef as send address", { usesPeer });
  }
  return result("FB-PEERREF", "CLOSED", "IM send uses stored vendor reply target", { usesPeer });
}

function probeCausalShortcut() {
  const remote = readText("packages/im/src/remote.ts");
  const host = readText("packages/plugin-center/src/index.ts");
  const present = /proveCausalRoute/.test(remote) || /proveCausalRoute/.test(host);
  if (present) {
    return result("FB-CAUSAL-SHORTCUT", "REPRODUCED", "proveCausalRoute remains a product/control-plane shortcut", {
      present,
    });
  }
  return result("FB-CAUSAL-SHORTCUT", "CLOSED", "proveCausalRoute is not on the product surface", { present });
}

function probeArm64Hardcode() {
  const embed = readText("scripts/embed-runtime.mjs");
  const hardcoded = /node-v22\.22\.2-darwin-arm64/.test(embed) && !/--target/.test(embed);
  if (hardcoded) {
    return result("FB-ARM64", "REPRODUCED", "embed-runtime still hardcodes darwin-arm64 Node tarball", { hardcoded });
  }
  return result("FB-ARM64", "CLOSED", "embed-runtime is target-aware", { hardcoded });
}

function probeUpdater() {
  const has = existsSync(join(ROOT, "packages/runtime/src/update.ts")) || existsSync(join(ROOT, "apps/desktop/src/update.ts"));
  if (!has) {
    return result("FB-UPDATER", "REPRODUCED", "0.5 assisted updater module does not exist", { has });
  }
  return result("FB-UPDATER", "CLOSED", "assisted updater module exists", { has });
}

function probeUninstall() {
  const has =
    existsSync(join(ROOT, "packages/runtime/src/uninstall.ts")) ||
    existsSync(join(ROOT, "apps/desktop/src/uninstall.ts"));
  if (!has) {
    return result("FB-UNINSTALL", "REPRODUCED", "uninstall/data wizard module does not exist", { has });
  }
  return result("FB-UNINSTALL", "CLOSED", "uninstall module exists", { has });
}

function probePublicExport() {
  const has = existsSync(join(ROOT, "scripts/prepare-public-export.mjs"));
  if (!has) {
    return result("FB-PUBLIC-EXPORT", "REPRODUCED", "prepare:public-export does not exist", { has });
  }
  return result("FB-PUBLIC-EXPORT", "CLOSED", "public-export script exists", { has });
}

const probes = {
  "FB-IDENTITY": probeIdentity,
  "FB-REGISTRY": probeRegistry,
  "FB-FUSES-EXIT": probeFusesExit,
  "FB-FANOUT": probeFanout,
  "FB-STALE-ALPHA": probeStaleAlpha,
  "FB-VERSIONS": probeVersions,
  "FB-AGGREGATOR": probeAggregator,
  "FB-PUBLICATION": probePublication,
  "FB-ONBOARDING": probeOnboarding,
  "FB-USABLE-FIXTURE": probeUsableFixture,
  "FB-WEIXIN": probeWeixin,
  "FB-FEISHU": probeFeishu,
  "FB-PEERREF": probePeerRef,
  "FB-CAUSAL-SHORTCUT": probeCausalShortcut,
  "FB-ARM64": probeArm64Hardcode,
  "FB-UPDATER": probeUpdater,
  "FB-UNINSTALL": probeUninstall,
  "FB-PUBLIC-EXPORT": probePublicExport,
};

const out = [];
for (const [id, fn] of Object.entries(probes)) {
  const row = await fn();
  if (row.id !== id) throw new Error(`probe ${id} returned ${row.id}`);
  out.push(row);
  console.log(`${id} ${row.status} ${row.detail}`);
}

const mustCloseFail = out.filter((r) => MUST_CLOSE.includes(r.id) && r.status !== "CLOSED");
const dir = join(ROOT, "evidence", "generated");
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "failure-baseline.json"),
  JSON.stringify({ schema: 3, version: "0.5.5", probes: out, mustClose: MUST_CLOSE }, null, 2),
);
console.log(
  "failure-baseline",
  out.filter((r) => r.status === "REPRODUCED").length,
  "reproduced",
  out.filter((r) => r.status === "CLOSED").length,
  "closed",
);
if (mustCloseFail.length) {
  finish("FAIL", { command: "test:failure-baseline", stillOpen: mustCloseFail.map((r) => r.id) });
}
finish("PASS", {
  command: "test:failure-baseline",
  reproduced: out.filter((r) => r.status === "REPRODUCED").map((r) => r.id),
});
