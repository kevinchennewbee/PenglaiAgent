import { parseClosedEnum } from "@penglai/contracts";
import { MNEMON_CATEGORIES, requireMnemonCategory, type MnemonCategory } from "../engine/categories.js";
import { CANDIDATE_KINDS, type CandidateKind } from "./governance.js";

export { MNEMON_CATEGORIES, requireMnemonCategory, type MnemonCategory };

/**
 * Penglai CandidateKind is a curator/domain taxonomy. Pinned Mnemon 0.2.8
 * `--cat` is a smaller engine taxonomy
 * (preference|decision|fact|insight|context|general). Materialization must map
 * at this boundary and must never send CandidateKind values such as
 * `project_fact` as `--cat`.
 *
 * Original kind stays on the candidate row, journal tags (`kind:<CandidateKind>`),
 * and the Owner result digest. Engine `--cat` is only the native storage slot.
 *
 * Mapping intent:
 * - preference → preference: the same standing preference concept.
 * - decision → decision: the same explicit choice concept.
 * - project_fact → fact: a project fact is an engine fact about the Workspace.
 * - person_fact → fact: a person fact is an engine fact about a person.
 * - constraint → context: a standing operational bound. Mnemon has no
 *   constraint slot; context is the engine category for conditions that frame
 *   later work, distinct from a discrete fact, a preference, or a decision.
 *
 * `insight` and `general` are valid engine categories but are not a dump for
 * unmapped Penglai kinds. Unknown kinds fail closed.
 */
export const CANDIDATE_KIND_TO_MNEMON_CATEGORY = {
  preference: "preference",
  project_fact: "fact",
  decision: "decision",
  constraint: "context",
  person_fact: "fact",
} as const satisfies Record<CandidateKind, MnemonCategory>;

export function nativeCategoryForCandidateKind(kind: string): MnemonCategory {
  const candidateKind = parseClosedEnum(kind, CANDIDATE_KINDS, "MEMORY_KIND", "SECURITY_POLICY");
  return requireMnemonCategory(CANDIDATE_KIND_TO_MNEMON_CATEGORY[candidateKind]);
}

export function nativeMaterializationTags(candidate: { candidateId: string; kind: CandidateKind }): string {
  return `candidate:${candidate.candidateId},kind:${candidate.kind}`;
}
