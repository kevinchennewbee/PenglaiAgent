import { createHash } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import { assertNotSecret } from "../trust/governance.js";

export const MEMORY_MODES = ["off", "suggest", "auto-workspace"] as const;
export type MemoryMode = (typeof MEMORY_MODES)[number];
// 0.5.6 makes useful, Workspace-scoped memory the fresh-profile default.
// Personal/global memory is still never inferred automatically and always
// requires an Owner-broker confirmation.
export const DEFAULT_MEMORY_MODE: MemoryMode = "auto-workspace";

export const CANDIDATE_KINDS = ["preference", "project_fact", "decision", "constraint", "person_fact"] as const;
export const CANDIDATE_SENSITIVITIES = ["normal", "sensitive", "prohibited"] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];
export type CandidateSensitivity = (typeof CANDIDATE_SENSITIVITIES)[number];

const SENSITIVE =
  /身份证|护照|住址|病历|诊断|银行卡|信用卡|社保|medical|passport|ssn|bank account|home address/i;
const EPHEMERAL = /待办|today's todo|build log|tmp\/|一次性|scratch|WIP\b/i;
const PERSONAL_CLAIM = /永远|以后都|所有项目|所有工作区|every workspace|all projects|always remember/i;
const INJECTION = /ignore (all )?previous|system prompt|you are now|覆盖指令|忽略以上/i;

export function classifyMemoryText(text: string): CandidateSensitivity {
  try {
    assertNotSecret(text);
  } catch {
    return "prohibited";
  }
  if (SENSITIVE.test(text)) return "sensitive";
  return "normal";
}

export function refuseProhibitedCandidate(text: string): void {
  if (classifyMemoryText(text) === "prohibited") {
    throw new PenglaiError("SECURITY_POLICY", "MEMORY_CANDIDATE_PROHIBITED");
  }
}

export function isEphemeralFact(text: string): boolean {
  return EPHEMERAL.test(text);
}

export function cannotAutoPersonalize(text: string): boolean {
  return PERSONAL_CLAIM.test(text) || classifyMemoryText(text) !== "normal";
}

export function isUntrustedInjection(text: string): boolean {
  return INJECTION.test(text);
}

export function candidateDedupKey(input: {
  workspaceId: string;
  kind: string;
  text: string;
  sourceDigest: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      workspaceId: input.workspaceId,
      kind: input.kind,
      text: input.text.trim().toLowerCase(),
      sourceDigest: input.sourceDigest,
    }))
    .digest("hex");
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
