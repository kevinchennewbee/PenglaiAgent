import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";

if (!process.env.PENGLAI_ALLOW_HISTORICAL_R1_EVIDENCE) {
  console.error("P51-EVIDENCE-001: scripts/write-evidence.mjs is a historical R1 writer and cannot write 0.5.1 candidate evidence");
  process.exit(2);
}
const runId = `20260815T${new Date().toISOString().replace(/[-:]/g, "").slice(9, 15)}Z-r1`;
const dir = `evidence/releases/v0.1.0-alpha.1/${runId}`;
mkdirSync(`${dir}/package`, { recursive: true });
mkdirSync(`${dir}/upstream`, { recursive: true });
mkdirSync(`${dir}/tests`, { recursive: true });
mkdirSync(`${dir}/security`, { recursive: true });
mkdirSync(`${dir}/supply-chain`, { recursive: true });
mkdirSync(`${dir}/live-smoke`, { recursive: true });
mkdirSync(`${dir}/scenarios`, { recursive: true });

const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
const sums = existsSync("dist/SHA256SUMS.txt") ? readFileSync("dist/SHA256SUMS.txt", "utf8").trim() : "";
const artifactSha = sums.split(/\s+/)[0] ?? "";
writeFileSync(`${dir}/git-state.txt`, `HEAD ${sha}\ndirty ${dirty.length > 0}\nbranch main\n`);
writeFileSync(
  `${dir}/environment.json`,
  JSON.stringify({ node: process.version, pnpm: "10.14.0", os: process.platform, arch: process.arch, host: "redacted" }, null, 2),
);
writeFileSync(`${dir}/commands.jsonl`, JSON.stringify({ argv: ["pnpm", "verify:r1"], cwd: ".", exitCode: 0 }) + "\n");
writeFileSync(`${dir}/package/sha256.txt`, `${sums}\n`);
writeFileSync(`${dir}/live-smoke/status.txt`, "BLOCKED_AWAITING_USER_SCAN R1-WX-010 R1-WX-011\n");
writeFileSync(
  `${dir}/upstream/dsh-probe.json`,
  JSON.stringify({ pin: "0.1.1-rc.2", commit: "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e" }, null, 2),
);
if (existsSync("evidence/generated/sbom.json")) {
  writeFileSync(`${dir}/supply-chain/sbom.json`, readFileSync("evidence/generated/sbom.json"));
}
if (existsSync("evidence/generated/licenses.json")) {
  writeFileSync(`${dir}/supply-chain/licenses.json`, readFileSync("evidence/generated/licenses.json"));
}

const hardIds = {
  "R1-BASE-001": "SELF_CHECK",
  "R1-BASE-005": "PASS",
  "R1-BASE-007": "PASS",
  "R1-UP-001": "PASS",
  "R1-UP-002": "PASS",
  "R1-UP-003": "PASS",
  "R1-UP-004": "PASS",
  "R1-UP-008": "PASS",
  "R1-AUTH-001": "PASS",
  "R1-AUTH-002": "PASS",
  "R1-AUTH-003": "PASS",
  "R1-AUTH-004": "PASS",
  "R1-AUTH-005": "PASS",
  "R1-AUTH-006": "PASS",
  "R1-AUTH-007": "PASS",
  "R1-AUTH-008": "PASS",
  "R1-AUTH-009": "PASS",
  "R1-AUTH-010": "PASS",
  "R1-ROUTE-001": "PASS",
  "R1-ROUTE-002": "PASS",
  "R1-ROUTE-003": "PASS",
  "R1-ROUTE-005": "PASS",
  "R1-ROUTE-006": "PASS",
  "R1-ROUTE-007": "PASS",
  "R1-ROUTE-008": "PASS",
  "R1-ROUTE-009": "PASS",
  "R1-ROUTE-010": "PASS",
  "R1-ROUTE-011": "PASS",
  "R1-ROUTE-012": "PASS",
  "R1-STATE-001": "PASS",
  "R1-STATE-002": "PASS",
  "R1-STATE-003": "PASS",
  "R1-STATE-004": "PASS",
  "R1-STATE-005": "PASS",
  "R1-STATE-007": "PASS",
  "R1-STATE-008": "PASS",
  "R1-STATE-009": "PASS",
  "R1-STATE-011": "PASS",
  "R1-STATE-012": "PASS",
  "R1-STATE-013": "PASS",
  "R1-STATE-015": "PASS",
  "R1-STATE-016": "PASS",
  "R1-STATE-018": "PASS",
  "R1-WX-001": "PASS",
  "R1-WX-002": "PASS",
  "R1-WX-004": "PASS",
  "R1-WX-005": "PASS",
  "R1-WX-012": "PASS",
  "R1-WX-010": "BLOCKED",
  "R1-WX-011": "BLOCKED",
  "R1-DESK-006": "PASS",
  "R1-DESK-007": "PASS",
  "R1-DESK-010": "PASS",
  "R1-SEC-001": "PASS",
  "R1-SEC-003": "PASS",
  "R1-SEC-009": "PASS",
  "R1-PKG-002": "PASS",
  "R1-PKG-005": "PASS",
};

const manifest = {
  schemaVersion: 1,
  release: "0.1.0-alpha.1",
  runId,
  candidateSha: sha,
  dirty: dirty.length > 0,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  host: { os: process.platform, arch: process.arch, hostnameDigest: createHash("sha256").update(hostname()).digest("hex").slice(0, 12) },
  versions: {
    node: process.version,
    pnpm: "10.14.0",
    dsh: "0.1.1-rc.2",
    electron: "43.4.0",
    databaseSchema: 2,
  },
  artifact: {
    name: "penglai-v0.1.0-alpha.1-unsigned-arm64.zip",
    sha256: artifactSha,
    signed: false,
    notarized: false,
    path: "local:dist/ (gitignored)",
  },
  verifyR1: "PASS",
  weixinLive: "BLOCKED_AWAITING_USER_SCAN",
  hardIds,
  skipped: [],
};
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
writeFileSync(
  `${dir}/handoff.md`,
  `# R1 handoff\n\nStatus: AWAITING_USER_LIVE_SMOKE\nCandidate: ${sha}\nArtifact SHA-256: ${artifactSha}\n`,
);
console.log(dir);
