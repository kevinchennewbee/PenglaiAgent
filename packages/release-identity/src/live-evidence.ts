import type { VerifierVerdict } from "./exit.js";

const CHANNELS = new Set([
  "weixin",
  "feishu",
  "dingtalk",
  "wecom",
  "qq",
  "slack",
  "telegram",
  "discord",
]);

const REQUIRED_CASE_CHECKS = [
  "connected",
  "inboundPrivateText",
  "boundOfficialWorkspaceSession",
  "outboundReply",
  "restartRestore",
  "safeLogout",
] as const;

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "scope",
  "productVersion",
  "sourceSha",
  "installerSha256",
  "redacted",
  "cases",
]);

const CASE_KEYS = new Set(["platform", "runnerClass", ...REQUIRED_CASE_CHECKS]);

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

export function evaluateLiveEvidence(raw: unknown, expectedVersion: string): LiveEvidenceEvaluation {
  if (!isRecord(raw)) return { verdict: "FAIL", reason: "live evidence must be an object", acceptedPlatforms: [] };
  if (raw.productVersion !== expectedVersion) {
    return { verdict: "STALE", reason: `live evidence is not ${expectedVersion}`, acceptedPlatforms: [] };
  }
  if (raw.schemaVersion !== 1 || raw.scope !== "declared-platform-cases") {
    return { verdict: "FAIL", reason: "unsupported live evidence schema or scope", acceptedPlatforms: [] };
  }
  if (raw.redacted !== true || !hasOnlyKeys(raw, TOP_LEVEL_KEYS)) {
    return { verdict: "FAIL", reason: "live evidence is not safely redacted", acceptedPlatforms: [] };
  }
  if (typeof raw.sourceSha !== "string" || !/^[0-9a-f]{40}$/.test(raw.sourceSha)) {
    return { verdict: "FAIL", reason: "live evidence source SHA is invalid", acceptedPlatforms: [] };
  }
  if (typeof raw.installerSha256 !== "string" || !/^[0-9a-f]{64}$/.test(raw.installerSha256)) {
    return { verdict: "FAIL", reason: "live evidence installer SHA-256 is invalid", acceptedPlatforms: [] };
  }
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
    return { verdict: "INCOMPLETE", reason: "no declared platform live cases", acceptedPlatforms: [] };
  }

  const acceptedPlatforms: string[] = [];
  for (const entry of raw.cases) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, CASE_KEYS) || typeof entry.platform !== "string" || !CHANNELS.has(entry.platform)) {
      return { verdict: "FAIL", reason: "live evidence contains an unknown platform", acceptedPlatforms: [] };
    }
    if (acceptedPlatforms.includes(entry.platform)) {
      return { verdict: "FAIL", reason: `duplicate live case for ${entry.platform}`, acceptedPlatforms: [] };
    }
    if (entry.runnerClass !== "owner-live-account") {
      return { verdict: "FAIL", reason: `live case for ${entry.platform} is not owner-live-account evidence`, acceptedPlatforms: [] };
    }
    const missing = REQUIRED_CASE_CHECKS.filter((key) => entry[key] !== true);
    if (missing.length) {
      return {
        verdict: "INCOMPLETE",
        reason: `live case for ${entry.platform} is missing ${missing.join(",")}`,
        acceptedPlatforms: [],
      };
    }
    acceptedPlatforms.push(entry.platform);
  }

  return {
    verdict: "PASS",
    reason: `accepted ${acceptedPlatforms.length} redacted owner live case(s)`,
    acceptedPlatforms,
  };
}
