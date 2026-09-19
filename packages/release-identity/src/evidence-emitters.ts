/**
 * Emitter registry: which acceptance ids can actually produce evidence, and where.
 *
 * `docs/ACCEPTANCE.md` declared 330 Hard ids while only 72 were ever passed to
 * `recordAssertion`, so 258 ids could not produce evidence under any run. A
 * declaration that cannot be violated by the code is not a release gate, it is
 * decoration. This module is the machine-checkable link between the registry and
 * the code that emits into it, and `emitters.test.ts` asserts both directions.
 *
 * Two layers, because they catch different mistakes:
 *
 *  1. Static, exhaustive (this module). Every registered id must appear here,
 *     every id here must appear in the registry, and every marker below must
 *     literally occur in a file that actually calls `recordAssertion`. This runs
 *     everywhere, including a machine with no native artifacts, so it is the
 *     layer that gates the registry.
 *
 *  2. Empirical (the collector, in `scripts/verify-evidence.mjs`). The collector
 *     suites run with `PENGLAI_EVIDENCE_DIR` set and the ids they emit are the
 *     ground truth for "evidence was produced". This layer is stronger per id but
 *     cannot be exhaustive: several ids are emitted only when a sealed native
 *     artifact is present, which is exactly right — claiming installed evidence
 *     from a source-only machine would be the defect, not the missing record.
 *
 * Known limitation of layer 1, stated rather than hidden: it matches text, so an
 * id emitted from a computed value (a loop over a target table, a template
 * literal) would be reported as unemittable. No emitter in this repository does
 * that today — `acceptanceId:` is a literal at all 72 original call sites — and
 * the reverse direction of the same scan catches the case that actually matters,
 * where a new id is added to the document with no emitter at all.
 */

export type EmitterDomain =
  | "TRUTH"
  | "CORE"
  | "ONB"
  | "UPD"
  | "CENTER"
  | "DIST"
  | "ROUTE"
  | "MAC"
  | "SEC"
  | "E2E"
  | "PREP"
  | "UI"
  | "CRED"
  | "IM"
  | "UN"
  | "DRIFT"
  | "DOC"
  | "ABSENT";

export interface EmitterEntry {
  id: string;
  domain: EmitterDomain;
  /** Repo-relative files that call `recordAssertion` with this id. */
  files: string[];
  /**
   * Literal fragments that must occur in at least one of `files`. Each fragment
   * is anchored on the `acceptanceId` assignment so a bare mention in a comment
   * or a test name does not satisfy the check — that is how 17 ids passed a
   * naive literal scan in the previous registry while being emitted by nothing.
   */
  markers: string[];
  /**
   * True when the emitter can only fire with a sealed native artifact present.
   * Those ids legitimately emit nothing on a source-only machine.
   */
  requiresArtifact?: boolean;
}

const IDENTITY_SUITE = "packages/release-identity/src";

export const EVIDENCE_EMITTERS: readonly EmitterEntry[] = [
  // ---- Truth: version, identity, and evidence-generation integrity ----------
  {
    id: "R50-TRUTH-001",
    domain: "TRUTH",
    files: [`${IDENTITY_SUITE}/identity.test.ts`],
    markers: ['acceptanceId: "R50-TRUTH-001"'],
  },
  {
    id: "R50-TRUTH-002",
    domain: "TRUTH",
    files: [`${IDENTITY_SUITE}/identity.test.ts`],
    markers: ['acceptanceId: "R50-TRUTH-002"'],
  },
  {
    id: "R50-TRUTH-003",
    domain: "TRUTH",
    files: [`${IDENTITY_SUITE}/rc0.test.ts`],
    markers: ['acceptanceId: "R50-TRUTH-003"'],
  },
  {
    id: "R50-TRUTH-004",
    domain: "TRUTH",
    files: [`${IDENTITY_SUITE}/identity.test.ts`],
    markers: ['acceptanceId: "R50-TRUTH-004"'],
  },
  {
    id: "R50-TRUTH-005",
    domain: "TRUTH",
    files: [`${IDENTITY_SUITE}/registry.test.ts`],
    markers: ['acceptanceId: "R50-TRUTH-005"'],
  },
  {
    id: "R50-TRUTH-006",
    domain: "TRUTH",
    files: [`${IDENTITY_SUITE}/evidence-v2.test.ts`],
    markers: ['acceptanceId: "R50-TRUTH-006"'],
  },
  {
    id: "R50-TRUTH-007",
    domain: "TRUTH",
    files: [`${IDENTITY_SUITE}/rc0.test.ts`],
    markers: ['acceptanceId: "R50-TRUTH-007"'],
  },
  {
    id: "R50-TRUTH-008",
    domain: "TRUTH",
    files: [`${IDENTITY_SUITE}/identity.test.ts`],
    markers: ['acceptanceId: "R50-TRUTH-008"'],
  },

  // ---- Core: official DSH is the only agent core ---------------------------
  {
    id: "R50-CORE-001",
    domain: "CORE",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-CORE-001"'],
    requiresArtifact: true,
  },
  {
    id: "R50-CORE-002",
    domain: "CORE",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-CORE-002"'],
    requiresArtifact: true,
  },
  {
    id: "R50-CORE-004",
    domain: "CORE",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-CORE-004"'],
    requiresArtifact: true,
  },
  {
    id: "R50-CORE-005",
    domain: "CORE",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-CORE-005"'],
    requiresArtifact: true,
  },
  {
    id: "R50-CORE-006",
    domain: "CORE",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-CORE-006"'],
    requiresArtifact: true,
  },

  // ---- Onboarding: the wizard must never strand a user ---------------------
  {
    id: "R50-ONB-001",
    domain: "ONB",
    files: [`${IDENTITY_SUITE}/onboarding-contract.test.ts`],
    markers: ['acceptanceId: "R50-ONB-001"'],
  },
  {
    id: "R50-ONB-002",
    domain: "ONB",
    files: [`${IDENTITY_SUITE}/onboarding-contract.test.ts`, `${IDENTITY_SUITE}/installed-evidence.test.ts`, "scripts/verify-installed.mjs"],
    markers: ['acceptanceId: "R50-ONB-002"'],
  },
  {
    id: "R50-ONB-003",
    domain: "ONB",
    files: [`${IDENTITY_SUITE}/onboarding-contract.test.ts`, "scripts/verify-installed.mjs"],
    markers: ['acceptanceId: "R50-ONB-003"'],
  },
  {
    id: "R50-ONB-004",
    domain: "ONB",
    files: [`${IDENTITY_SUITE}/onboarding-contract.test.ts`],
    markers: ['acceptanceId: "R50-ONB-004"'],
  },
  {
    id: "R50-ONB-005",
    domain: "ONB",
    files: [`${IDENTITY_SUITE}/onboarding-contract.test.ts`],
    markers: ['acceptanceId: "R50-ONB-005"'],
  },
  {
    id: "R50-ONB-006",
    domain: "ONB",
    files: [`${IDENTITY_SUITE}/onboarding-contract.test.ts`],
    markers: ['acceptanceId: "R50-ONB-006"'],
  },
  {
    id: "R50-ONB-007",
    domain: "ONB",
    files: [`${IDENTITY_SUITE}/onboarding-contract.test.ts`],
    markers: ['acceptanceId: "R50-ONB-007"'],
  },
  {
    id: "R50-ONB-008",
    domain: "ONB",
    files: [`${IDENTITY_SUITE}/onboarding-contract.test.ts`],
    markers: ['acceptanceId: "R50-ONB-008"'],
  },
  {
    id: "R50-ONB-009",
    domain: "ONB",
    files: [`${IDENTITY_SUITE}/onboarding-contract.test.ts`],
    markers: ['acceptanceId: "R50-ONB-009"'],
  },
  {
    id: "R50-ONB-010",
    domain: "ONB",
    files: [`${IDENTITY_SUITE}/onboarding-contract.test.ts`],
    markers: ['acceptanceId: "R50-ONB-010"'],
  },
  {
    id: "R50-ONB-011",
    domain: "ONB",
    files: [`${IDENTITY_SUITE}/onboarding-contract.test.ts`],
    markers: ['acceptanceId: "R50-ONB-011"'],
  },
  {
    id: "R50-ONB-012",
    domain: "ONB",
    files: [`${IDENTITY_SUITE}/onboarding-contract.test.ts`],
    markers: ['acceptanceId: "R50-ONB-012"'],
  },

  // ---- Update: assisted update is not a dead gate -------------------------
  {
    id: "R50-UPD-001",
    domain: "UPD",
    files: [`${IDENTITY_SUITE}/center-im-update.test.ts`],
    markers: ['acceptanceId: "R50-UPD-001"'],
  },
  {
    id: "R50-UPD-004",
    domain: "UPD",
    files: [`${IDENTITY_SUITE}/center-im-update.test.ts`],
    markers: ['acceptanceId: "R50-UPD-004"'],
  },
  {
    id: "R50-UPD-005",
    domain: "UPD",
    files: [`${IDENTITY_SUITE}/center-im-update.test.ts`, `${IDENTITY_SUITE}/route-update-gates.test.ts`],
    markers: ['acceptanceId: "R50-UPD-005"'],
  },
  {
    id: "R50-UPD-006",
    domain: "UPD",
    files: [`${IDENTITY_SUITE}/route-update-gates.test.ts`],
    markers: ['acceptanceId: "R50-UPD-006"'],
  },
  {
    id: "R50-UPD-007",
    domain: "UPD",
    files: [`${IDENTITY_SUITE}/center-im-update.test.ts`],
    markers: ['acceptanceId: "R50-UPD-007"'],
  },

  // ---- Plugin Center ------------------------------------------------------
  {
    id: "R50-CENTER-001",
    domain: "CENTER",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-CENTER-001"'],
    requiresArtifact: true,
  },
  {
    id: "R50-CENTER-005",
    domain: "CENTER",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-CENTER-005"'],
    requiresArtifact: true,
  },
  {
    id: "R50-CENTER-006",
    domain: "CENTER",
    files: [`${IDENTITY_SUITE}/center-im-update.test.ts`],
    markers: ['acceptanceId: "R50-CENTER-006"'],
  },
  {
    id: "R50-CENTER-007",
    domain: "CENTER",
    files: [`${IDENTITY_SUITE}/center-im-update.test.ts`],
    markers: ['acceptanceId: "R50-CENTER-007"'],
  },
  {
    id: "R50-CENTER-009",
    domain: "CENTER",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-CENTER-009"'],
    requiresArtifact: true,
  },

  // ---- Distribution and artifacts ----------------------------------------
  {
    id: "R50-DIST-001",
    domain: "DIST",
    files: [`${IDENTITY_SUITE}/contract.test.ts`],
    markers: ['acceptanceId: "R50-DIST-001"'],
  },
  {
    id: "R50-DIST-003",
    domain: "DIST",
    files: [`${IDENTITY_SUITE}/contract.test.ts`],
    markers: ['acceptanceId: "R50-DIST-003"'],
  },
  {
    id: "R50-DIST-005",
    domain: "DIST",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-DIST-005"'],
    requiresArtifact: true,
  },
  {
    id: "R50-DIST-008",
    domain: "DIST",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`, "scripts/verify-installed.mjs"],
    markers: ['acceptanceId: "R50-DIST-008"'],
  },

  // ---- Workspace, project, account, and IM route separation ---------------
  {
    id: "R50-ROUTE-001",
    domain: "ROUTE",
    files: [`${IDENTITY_SUITE}/route-update-gates.test.ts`],
    markers: ['acceptanceId: "R50-ROUTE-001"'],
  },
  {
    id: "R50-ROUTE-009",
    domain: "ROUTE",
    files: [`${IDENTITY_SUITE}/route-update-gates.test.ts`],
    markers: ['acceptanceId: "R50-ROUTE-009"'],
  },
  {
    id: "R50-ROUTE-010",
    domain: "ROUTE",
    files: [`${IDENTITY_SUITE}/route-update-gates.test.ts`],
    markers: ['acceptanceId: "R50-ROUTE-010"'],
  },
  {
    id: "R50-IM-001",
    domain: "IM",
    files: [`${IDENTITY_SUITE}/route-update-gates.test.ts`],
    markers: ['acceptanceId: "R50-IM-001"'],
  },

  // ---- macOS native artifact ---------------------------------------------
  {
    id: "R50-MAC-004",
    domain: "MAC",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-MAC-004"'],
    requiresArtifact: true,
  },
  {
    id: "R50-MAC-005",
    domain: "MAC",
    files: ["scripts/verify-fuses.mjs", `${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-MAC-005"'],
    requiresArtifact: true,
  },
  {
    id: "R50-MAC-006",
    domain: "MAC",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-MAC-006"'],
    requiresArtifact: true,
  },
  {
    id: "R50-MAC-007",
    domain: "MAC",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-MAC-007"'],
    requiresArtifact: true,
  },
  {
    id: "R50-MAC-008",
    domain: "MAC",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-MAC-008"'],
    requiresArtifact: true,
  },
  {
    id: "R50-MAC-009",
    domain: "MAC",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`, "scripts/verify-installed.mjs"],
    markers: ['acceptanceId: "R50-MAC-009"'],
    requiresArtifact: true,
  },

  // ---- Electron hardening -------------------------------------------------
  {
    id: "R50-SEC-004",
    domain: "SEC",
    files: ["scripts/verify-fuses.mjs", `${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-SEC-004"'],
    requiresArtifact: true,
  },

  // ---- End-to-end installed journeys -------------------------------------
  {
    id: "R50-E2E-001",
    domain: "E2E",
    files: ["scripts/verify-installed.mjs", `${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-E2E-001"'],
    requiresArtifact: true,
  },
  {
    id: "R50-E2E-002",
    domain: "E2E",
    files: ["scripts/verify-installed.mjs", `${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-E2E-002"'],
    requiresArtifact: true,
  },
  {
    id: "R50-E2E-003",
    domain: "E2E",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-E2E-003"'],
    requiresArtifact: true,
  },
  {
    id: "R50-E2E-004",
    domain: "E2E",
    files: ["scripts/verify-installed.mjs", `${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-E2E-004"'],
    requiresArtifact: true,
  },

  // ---- Public export readiness -------------------------------------------
  {
    id: "R50-PREP-001",
    domain: "PREP",
    files: [`${IDENTITY_SUITE}/public-export.test.ts`],
    markers: ['acceptanceId: "R50-PREP-001"'],
  },
  {
    id: "R50-PREP-002",
    domain: "PREP",
    files: [`${IDENTITY_SUITE}/public-export.test.ts`],
    markers: ['acceptanceId: "R50-PREP-002"'],
  },
  {
    id: "R50-PREP-003",
    domain: "PREP",
    files: [`${IDENTITY_SUITE}/public-export.test.ts`],
    markers: ['acceptanceId: "R50-PREP-003"'],
  },
  {
    id: "R50-PREP-005",
    domain: "PREP",
    files: [`${IDENTITY_SUITE}/public-export.test.ts`],
    markers: ['acceptanceId: "R50-PREP-005"'],
  },
  {
    id: "R50-PREP-006",
    domain: "PREP",
    files: [`${IDENTITY_SUITE}/public-export.test.ts`],
    markers: ['acceptanceId: "R50-PREP-006"'],
  },
  {
    id: "R50-PREP-009",
    domain: "PREP",
    files: [`${IDENTITY_SUITE}/public-export.test.ts`],
    markers: ['acceptanceId: "R50-PREP-009"'],
  },
  {
    id: "R50-PREP-010",
    domain: "PREP",
    files: [`${IDENTITY_SUITE}/public-export.test.ts`],
    markers: ['acceptanceId: "R50-PREP-010"'],
  },

  // ---- Brand and UI -------------------------------------------------------
  {
    id: "R50-UI-001",
    domain: "UI",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-UI-001"'],
    requiresArtifact: true,
  },
  {
    id: "R50-UI-006",
    domain: "UI",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-UI-006"'],
    requiresArtifact: true,
  },

  // ---- Credentials and local data boundary --------------------------------
  {
    id: "R50-CRED-002",
    domain: "CRED",
    files: [`${IDENTITY_SUITE}/installed-evidence.test.ts`],
    markers: ['acceptanceId: "R50-CRED-002"'],
    requiresArtifact: true,
  },

  // ---- Installer lifecycle: default uninstall -----------------------------
  {
    id: "R50-UN-001",
    domain: "UN",
    files: [`${IDENTITY_SUITE}/route-update-gates.test.ts`],
    markers: ['acceptanceId: "R50-UN-001"'],
  },
  {
    id: "R50-UN-002",
    domain: "UN",
    files: [`${IDENTITY_SUITE}/center-im-update.test.ts`],
    markers: ['acceptanceId: "R50-UN-002"'],
  },
  {
    id: "R50-UN-005",
    domain: "UN",
    files: [`${IDENTITY_SUITE}/center-im-update.test.ts`],
    markers: ['acceptanceId: "R50-UN-005"'],
  },
  {
    id: "R50-UN-006",
    domain: "UN",
    files: [`${IDENTITY_SUITE}/center-im-update.test.ts`],
    markers: ['acceptanceId: "R50-UN-006"'],
  },
  {
    id: "R50-UN-007",
    domain: "UN",
    files: [`${IDENTITY_SUITE}/center-im-update.test.ts`],
    markers: ['acceptanceId: "R50-UN-007"'],
  },

  // ---- Drift: does the outside world still match our assumptions? ----------
  {
    id: "R50-DRIFT-001",
    domain: "DRIFT",
    files: ["scripts/verify-drift.mjs"],
    markers: ['"weixin-ilink": "R50-DRIFT-001"'],
  },
  {
    id: "R50-DRIFT-002",
    domain: "DRIFT",
    files: ["scripts/verify-drift.mjs"],
    markers: ['"dsh-upstream": "R50-DRIFT-002"'],
  },
  {
    id: "R50-DRIFT-003",
    domain: "DRIFT",
    files: ["scripts/verify-drift.mjs"],
    markers: ['"dsh-im-channel": "R50-DRIFT-003"'],
  },
  {
    id: "R50-DRIFT-004",
    domain: "DRIFT",
    files: ["scripts/verify-drift.mjs"],
    markers: ['"published-facts": "R50-DRIFT-004"'],
  },
  {
    id: "R50-DRIFT-005",
    domain: "DRIFT",
    files: ["scripts/verify-drift.mjs"],
    markers: ['"opencode-go": "R50-DRIFT-005"'],
  },

  // ---- Docs: prose must agree with release facts --------------------------
  {
    id: "R50-DOC-001",
    domain: "DOC",
    files: [`${IDENTITY_SUITE}/release-facts.ts`, `${IDENTITY_SUITE}/release-facts.test.ts`],
    markers: ['id: "R50-DOC-001"', 'REQUIRED_DOC_IDS'],
  },
  {
    id: "R50-DOC-002",
    domain: "DOC",
    files: [`${IDENTITY_SUITE}/release-facts.ts`, `${IDENTITY_SUITE}/release-facts.test.ts`],
    markers: ['id: "R50-DOC-002"', 'REQUIRED_DOC_IDS'],
  },
  {
    id: "R50-DOC-003",
    domain: "DOC",
    files: [`${IDENTITY_SUITE}/release-facts.ts`, `${IDENTITY_SUITE}/release-facts.test.ts`],
    markers: ['id: "R50-DOC-003"', 'REQUIRED_DOC_IDS'],
  },
  {
    id: "R50-DOC-004",
    domain: "DOC",
    files: [`${IDENTITY_SUITE}/release-facts.ts`, `${IDENTITY_SUITE}/release-facts.test.ts`],
    markers: ['id: "R50-DOC-004"', 'REQUIRED_DOC_IDS'],
  },
  {
    id: "R50-DOC-005",
    domain: "DOC",
    files: [`${IDENTITY_SUITE}/release-facts.ts`, `${IDENTITY_SUITE}/release-facts.test.ts`],
    markers: ['id: "R50-DOC-005"', 'REQUIRED_DOC_IDS'],
  },

  // ---- Reverse existence: the excluded scope must not be shipped -----------
  {
    id: "R50-ABSENT-001",
    domain: "ABSENT",
    files: [`${IDENTITY_SUITE}/excluded-scope-absence.test.ts`],
    markers: ['acceptanceId: "R50-ABSENT-001"'],
  },
];

export function declaredEmitterIds(): string[] {
  return EVIDENCE_EMITTERS.map((entry) => entry.id);
}

export function emitterDomainCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of EVIDENCE_EMITTERS) {
    counts[entry.domain] = (counts[entry.domain] ?? 0) + 1;
  }
  return counts;
}
