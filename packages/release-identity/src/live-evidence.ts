import type { VerifierVerdict } from "./exit.js";

export const LIVE_CHANNELS = [
  "weixin",
  "feishu",
  "dingtalk",
  "wecom",
  "qq",
  "slack",
  "telegram",
  "discord",
] as const;

const CHANNELS = new Set<string>(LIVE_CHANNELS);
const RELEASE_TARGETS = new Set(["darwin-aarch64", "darwin-x86_64", "win32-x86_64"]);
const HEX_40 = /^[0-9a-f]{40}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "scope",
  "productVersion",
  "sourceSha",
  "nativeInstallers",
  "officialModel",
  "redacted",
  "cases",
]);
const NATIVE_INSTALLER_KEYS = new Set(["target", "installerSha256"]);
const OFFICIAL_MODEL_KEYS = new Set([
  "target",
  "runnerClass",
  "runnerVersion",
  "runId",
  "startedAt",
  "completedAt",
  "installerSha256",
  "credentialNoEcho",
  "nonceDigest",
  "apiTestFinalDigest",
  "firstMessageDigest",
  "firstTurnFinalDigest",
  "officialSessionDigest",
  "evidenceSha256",
]);
const CASE_DIGEST_KEYS = [
  "challengeDigest",
  "connectionDigest",
  "inboundDigest",
  "workspaceSessionDigest",
  "outboundDigest",
  "restartDigest",
  "logoutDigest",
] as const;
const CASE_KEYS = new Set([
  "platform",
  "target",
  "runnerClass",
  "runnerVersion",
  "runId",
  "startedAt",
  "completedAt",
  "installerSha256",
  "evidenceSha256",
  ...CASE_DIGEST_KEYS,
]);

export interface LiveExpectedBinding {
  sourceSha: string;
  nativeInstallers: Readonly<Record<string, string>>;
}

export interface LiveEvidenceEvaluation {
  verdict: VerifierVerdict;
  reason: string;
  acceptedPlatforms: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function validRunWindow(startedAt: unknown, completedAt: unknown): boolean {
  if (typeof startedAt !== "string" || typeof completedAt !== "string") return false;
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  return Number.isFinite(started) && Number.isFinite(completed) && completed > started && completed - started <= 24 * 3600_000;
}

function validDigestSet(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const values = keys.map((key) => value[key]);
  return values.every((digest) => typeof digest === "string" && HEX_64.test(digest)) && new Set(values).size === values.length;
}

export function evaluateLiveEvidence(
  raw: unknown,
  expectedVersion: string,
  expected?: LiveExpectedBinding,
): LiveEvidenceEvaluation {
  if (!isRecord(raw)) return { verdict: "FAIL", reason: "live evidence must be an object", acceptedPlatforms: [] };
  if (raw.productVersion !== expectedVersion) {
    return { verdict: "STALE", reason: `live evidence is not ${expectedVersion}`, acceptedPlatforms: [] };
  }
  if (raw.schemaVersion !== 3 || raw.scope !== "release-native-live-set") {
    return { verdict: "FAIL", reason: "unsupported live evidence schema or scope", acceptedPlatforms: [] };
  }
  if (raw.redacted !== true || !hasOnlyKeys(raw, TOP_LEVEL_KEYS)) {
    return { verdict: "FAIL", reason: "live evidence is not safely redacted", acceptedPlatforms: [] };
  }
  if (typeof raw.sourceSha !== "string" || !HEX_40.test(raw.sourceSha)) {
    return { verdict: "FAIL", reason: "live evidence source SHA is invalid", acceptedPlatforms: [] };
  }
  if (expected && raw.sourceSha !== expected.sourceSha) {
    return { verdict: "STALE", reason: "live evidence source SHA is not the release candidate", acceptedPlatforms: [] };
  }
  if (!Array.isArray(raw.nativeInstallers) || raw.nativeInstallers.length !== RELEASE_TARGETS.size) {
    return { verdict: "INCOMPLETE", reason: "live evidence does not bind all three native installers", acceptedPlatforms: [] };
  }
  const nativeInstallers = new Map<string, string>();
  for (const entry of raw.nativeInstallers) {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, NATIVE_INSTALLER_KEYS) ||
      typeof entry.target !== "string" ||
      !RELEASE_TARGETS.has(entry.target) ||
      typeof entry.installerSha256 !== "string" ||
      !HEX_64.test(entry.installerSha256) ||
      nativeInstallers.has(entry.target)
    ) {
      return { verdict: "FAIL", reason: "live evidence native installer set is invalid", acceptedPlatforms: [] };
    }
    if (expected && expected.nativeInstallers[entry.target] !== entry.installerSha256) {
      return { verdict: "STALE", reason: `live evidence installer is stale for ${entry.target}`, acceptedPlatforms: [] };
    }
    nativeInstallers.set(entry.target, entry.installerSha256);
  }
  if ([...RELEASE_TARGETS].some((target) => !nativeInstallers.has(target))) {
    return { verdict: "INCOMPLETE", reason: "live evidence native installer set is incomplete", acceptedPlatforms: [] };
  }

  if (!isRecord(raw.officialModel) || !hasOnlyKeys(raw.officialModel, OFFICIAL_MODEL_KEYS)) {
    return { verdict: "FAIL", reason: "official model live evidence is invalid", acceptedPlatforms: [] };
  }
  const model = raw.officialModel;
  const modelDigests = [
    "nonceDigest",
    "apiTestFinalDigest",
    "firstMessageDigest",
    "firstTurnFinalDigest",
    "officialSessionDigest",
    "evidenceSha256",
  ];
  if (
    typeof model.target !== "string" ||
    !nativeInstallers.has(model.target) ||
    model.installerSha256 !== nativeInstallers.get(model.target) ||
    model.runnerClass !== "owner-live-account" ||
    model.runnerVersion !== "installed-live-v1" ||
    model.credentialNoEcho !== true ||
    typeof model.runId !== "string" ||
    !UUID.test(model.runId) ||
    !validRunWindow(model.startedAt, model.completedAt) ||
    !validDigestSet(model, modelDigests)
  ) {
    return { verdict: "FAIL", reason: "official model evidence lacks a bound runner transcript", acceptedPlatforms: [] };
  }

  if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
    return { verdict: "INCOMPLETE", reason: "no platform live runner records", acceptedPlatforms: [] };
  }
  const acceptedPlatforms: string[] = [];
  const runIds = new Set<string>([String(model.runId)]);
  for (const entry of raw.cases) {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, CASE_KEYS) ||
      typeof entry.platform !== "string" ||
      !CHANNELS.has(entry.platform) ||
      typeof entry.target !== "string" ||
      !nativeInstallers.has(entry.target) ||
      entry.installerSha256 !== nativeInstallers.get(entry.target)
    ) {
      return { verdict: "FAIL", reason: "live evidence contains an invalid platform binding", acceptedPlatforms: [] };
    }
    if (acceptedPlatforms.includes(entry.platform)) {
      return { verdict: "FAIL", reason: `duplicate live case for ${entry.platform}`, acceptedPlatforms: [] };
    }
    if (
      entry.runnerClass !== "owner-live-account" ||
      entry.runnerVersion !== "im-live-v1" ||
      typeof entry.runId !== "string" ||
      !UUID.test(entry.runId) ||
      runIds.has(entry.runId) ||
      !validRunWindow(entry.startedAt, entry.completedAt) ||
      !validDigestSet(entry, [...CASE_DIGEST_KEYS, "evidenceSha256"])
    ) {
      return { verdict: "FAIL", reason: `live case for ${entry.platform} lacks a bound runner transcript`, acceptedPlatforms: [] };
    }
    runIds.add(entry.runId);
    acceptedPlatforms.push(entry.platform);
  }

  if (acceptedPlatforms.length !== LIVE_CHANNELS.length) {
    const missing = LIVE_CHANNELS.filter((platform) => !acceptedPlatforms.includes(platform));
    return {
      verdict: "INCOMPLETE",
      reason: `live evidence is missing supported platform cases: ${missing.join(",")}`,
      acceptedPlatforms: [],
    };
  }

  return {
    verdict: "PASS",
    reason: `accepted ${acceptedPlatforms.length} redacted owner live runner record(s)`,
    acceptedPlatforms,
  };
}
