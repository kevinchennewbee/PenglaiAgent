import { PenglaiError } from "@penglai/contracts";
import {
  CANDIDATE_KIND,
  CANDIDATE_SOURCE_SHA_NONE,
  CATALOG_SCHEMA,
  FORBIDDEN_READY_STATES,
  GENERATION_ID,
  IDENTITY_PHASE_UNFROZEN,
  IM_SCHEMA,
  PINNED_DSH,
  PINNED_DSH_CLOSURE_MANIFEST_SHA256,
  PINNED_DSH_CLOSURE_PACKAGE_COUNT,
  PINNED_DSH_COMMIT,
  PINNED_DSH_REPOSITORY,
  PINNED_DSH_TAG,
  PINNED_DSH_TARBALL_SHA256,
  PINNED_ELECTRON,
  PINNED_NODE,
  PRODUCT_NAME,
  PRODUCT_VERSION,
  PROFILE_SCHEMA,
  PUBLICATION_TARGET,
  RELEASE_TARGETS,
  STALE_ARTIFACTS,
  TRUST_TIER,
} from "./pins.js";
import { isStaleSha } from "./stale.js";

export type CandidateKind = "public-community-release";
export type TrustTier = "community-verified";
export type IdentityPhase = "UNFROZEN" | "TARGET_BUILT" | "TARGET_ACCEPTED" | "RELEASE_SET_FROZEN";

export interface ReleaseTarget {
  key: string;
  platform: string;
  arch: string;
  installer: string;
}

export interface PublicationBoundary {
  repo: string;
  tag: string;
  release: string;
  channel: string;
}

export interface ReleaseIdentity {
  productName: string;
  productVersion: string;
  buildNumber: number;
  candidateOrdinal: number;
  candidateKind: CandidateKind | string;
  trustTier: TrustTier | string;
  generationId: string;
  phase: IdentityPhase | string;
  signatureKind?: "none" | "adhoc" | "unsigned-app-dir" | "developer-id";
  developerIdSigned?: boolean;
  sourceSha: string;
  treeDirty: boolean;
  targets: ReleaseTarget[];
  electron: string;
  node?: string;
  embeddedNode: string;
  dsh: string;
  dshSource: {
    repository: string;
    tag: string;
    commit: string;
    closureManifestSha256: string;
    cliTarballSha256: string;
    packageCount: number;
  };
  profileSchema: number;
  catalogSchema: number;
  imSchema: number;
  artifactSha256?: string;
  runtimeManifestSha256?: string;
  evidenceRunId?: string;
  liveEvidence?: unknown;
  readyState?: unknown;
  installerSignatures?: unknown;
  signed: boolean;
  notarized: boolean;
  authenticode: boolean;
  publication: PublicationBoundary;
}

export interface GitState {
  head: string;
  originMain: string;
  dirty: boolean;
  branch: string;
}

export function emptyIdentity(sourceSha: string, dirty: boolean): ReleaseIdentity {
  return {
    productName: PRODUCT_NAME,
    productVersion: PRODUCT_VERSION,
    buildNumber: 0,
    candidateOrdinal: 0,
    candidateKind: CANDIDATE_KIND,
    trustTier: TRUST_TIER,
    generationId: GENERATION_ID,
    phase: IDENTITY_PHASE_UNFROZEN,
    signatureKind: "adhoc",
    developerIdSigned: false,
    sourceSha,
    treeDirty: dirty,
    targets: RELEASE_TARGETS.map((t) => ({ ...t })),
    electron: PINNED_ELECTRON,
    node: PINNED_NODE,
    embeddedNode: PINNED_NODE,
    dsh: PINNED_DSH,
    dshSource: {
      repository: PINNED_DSH_REPOSITORY,
      tag: PINNED_DSH_TAG,
      commit: PINNED_DSH_COMMIT,
      closureManifestSha256: PINNED_DSH_CLOSURE_MANIFEST_SHA256,
      cliTarballSha256: PINNED_DSH_TARBALL_SHA256,
      packageCount: PINNED_DSH_CLOSURE_PACKAGE_COUNT,
    },
    profileSchema: PROFILE_SCHEMA,
    catalogSchema: CATALOG_SCHEMA,
    imSchema: IM_SCHEMA,
    signed: false,
    notarized: false,
    authenticode: false,
    publication: { ...PUBLICATION_TARGET },
  };
}

function isHex40(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

function publicationOk(raw: unknown): PublicationBoundary {
  if (!raw || typeof raw !== "object") {
    throw new PenglaiError("INVALID_INPUT", "publication boundary missing");
  }
  const o = raw as Record<string, unknown>;
  for (const k of ["repo", "tag", "release", "channel"] as const) {
    if (o[k] !== PUBLICATION_TARGET[k]) {
      throw new PenglaiError("SECURITY_POLICY", `publication.${k} does not match authorized target`);
    }
  }
  return { ...PUBLICATION_TARGET };
}

function assertTargets(raw: unknown): ReleaseTarget[] {
  if (!Array.isArray(raw) || raw.length !== RELEASE_TARGETS.length) {
    throw new PenglaiError("INVALID_INPUT", `identity must declare the exact ${PRODUCT_VERSION} release targets`);
  }
  const got = raw as ReleaseTarget[];
  for (let i = 0; i < RELEASE_TARGETS.length; i += 1) {
    const expect = RELEASE_TARGETS[i];
    const row = got[i];
    if (!expect || !row) throw new PenglaiError("INVALID_INPUT", "target missing");
    if (row.key !== expect.key || row.platform !== expect.platform || row.arch !== expect.arch || row.installer !== expect.installer) {
      throw new PenglaiError("INVALID_INPUT", `target ${expect.key} mismatch`);
    }
  }
  return got;
}

export function assertCommittedTemplateIdentity(identity: ReleaseIdentity): void {
  if (identity.phase !== IDENTITY_PHASE_UNFROZEN) {
    throw new PenglaiError("INVALID_INPUT", "committed identity template must be UNFROZEN");
  }
  if (identity.sourceSha !== CANDIDATE_SOURCE_SHA_NONE) {
    throw new PenglaiError("INVALID_INPUT", "committed identity template must use sourceSha=NONE");
  }
  assertUnfrozenClean(identity);
}

export function bindCandidateIdentity(template: ReleaseIdentity, sourceSha: string): ReleaseIdentity {
  assertCommittedTemplateIdentity(template);
  if (!isHex40(sourceSha)) {
    throw new PenglaiError("INVALID_INPUT", "candidate sourceSha must be 40-char hex");
  }
  const bound = assertReleaseIdentity({
    ...template,
    phase: "TARGET_BUILT",
    sourceSha,
  });
  if (bound.phase === IDENTITY_PHASE_UNFROZEN) {
    throw new PenglaiError("INVALID_INPUT", "candidate identity must not remain UNFROZEN");
  }
  if (bound.sourceSha === CANDIDATE_SOURCE_SHA_NONE) {
    throw new PenglaiError("INVALID_INPUT", "candidate identity must not remain sourceSha=NONE");
  }
  return bound;
}

export type ReadbackStatus = "PASS" | "FAIL" | "INCOMPLETE" | "NOT_RUN";

const HEX64 = /^[0-9a-f]{64}$/i;

export function assertObservedReleaseFacts(opts: {
  readbackStatus: ReadbackStatus;
  sha?: string;
  bytes?: number | string;
  digest?: string;
}): void {
  const numericBytes =
    typeof opts.bytes === "number"
      ? Number.isFinite(opts.bytes) && opts.bytes > 0
      : typeof opts.bytes === "string" && /^\d+$/.test(opts.bytes) && Number(opts.bytes) > 0;
  const hasSha = typeof opts.sha === "string" && HEX64.test(opts.sha);
  const digest = typeof opts.digest === "string" ? opts.digest.replace(/^sha256:/i, "") : "";
  const hasDigest = digest.length > 0 && HEX64.test(digest);
  if (opts.readbackStatus !== "PASS" && (hasSha || hasDigest || numericBytes)) {
    throw new PenglaiError("SECURITY_POLICY", "observed public SHA/size/digest require readback PASS");
  }
}

export function assertUnfrozenClean(identity: ReleaseIdentity): void {
  if (identity.phase !== "UNFROZEN") return;
  if (typeof identity.artifactSha256 === "string" && identity.artifactSha256.length > 0) {
    throw new PenglaiError("INVALID_INPUT", "UNFROZEN identity cannot carry artifactSha256");
  }
  if (identity.installerSignatures != null) {
    throw new PenglaiError("INVALID_INPUT", "UNFROZEN identity cannot carry installerSignatures");
  }
  if (identity.liveEvidence != null) {
    throw new PenglaiError("INVALID_INPUT", "UNFROZEN identity cannot carry liveEvidence");
  }
  if (identity.readyState != null) {
    throw new PenglaiError("INVALID_INPUT", "UNFROZEN identity cannot carry readyState");
  }
  if (typeof identity.evidenceRunId === "string" && /READY/i.test(identity.evidenceRunId)) {
    throw new PenglaiError("INVALID_INPUT", "UNFROZEN identity cannot carry READY evidence");
  }
}

export function assertReleaseIdentity(raw: unknown): ReleaseIdentity {
  if (!raw || typeof raw !== "object") throw new PenglaiError("INVALID_INPUT", "identity not an object");
  const o = raw as Record<string, unknown>;
  const req = [
    "productName",
    "productVersion",
    "buildNumber",
    "candidateOrdinal",
    "candidateKind",
    "trustTier",
    "generationId",
    "phase",
    "sourceSha",
    "treeDirty",
    "targets",
    "electron",
    "embeddedNode",
    "dsh",
    "profileSchema",
    "catalogSchema",
    "imSchema",
    "signed",
    "notarized",
    "authenticode",
    "publication",
  ];
  for (const k of req) {
    if (!(k in o)) throw new PenglaiError("INVALID_INPUT", `identity missing ${k}`);
  }
  if (o.productName !== PRODUCT_NAME) throw new PenglaiError("INVALID_INPUT", "productName");
  if (o.productVersion !== PRODUCT_VERSION) {
    throw new PenglaiError("INVALID_INPUT", `productVersion must be ${PRODUCT_VERSION}`);
  }
  if (Number(o.imSchema) !== IM_SCHEMA) {
    throw new PenglaiError("INVALID_INPUT", `imSchema must be ${IM_SCHEMA}`);
  }
  if (o.candidateKind !== CANDIDATE_KIND) {
    throw new PenglaiError("INVALID_INPUT", `candidateKind must be ${CANDIDATE_KIND}`);
  }
  if (o.trustTier !== TRUST_TIER) {
    throw new PenglaiError("INVALID_INPUT", `trustTier must be ${TRUST_TIER}`);
  }
  if (o.generationId !== GENERATION_ID) {
    throw new PenglaiError("INVALID_INPUT", `generationId must be ${GENERATION_ID}`);
  }
  if (
    o.phase !== "UNFROZEN" &&
    o.phase !== "TARGET_BUILT" &&
    o.phase !== "TARGET_ACCEPTED" &&
    o.phase !== "RELEASE_SET_FROZEN"
  ) {
    throw new PenglaiError("INVALID_INPUT", "phase");
  }
  const sourceSha = String(o.sourceSha);
  const frozen = typeof o.artifactSha256 === "string" && o.artifactSha256.length > 0;
  if (frozen) {
    if (!isHex40(sourceSha)) {
      throw new PenglaiError("INVALID_INPUT", "frozen sourceSha must be 40-char hex");
    }
  } else if (sourceSha !== "" && sourceSha !== CANDIDATE_SOURCE_SHA_NONE && !isHex40(sourceSha)) {
    throw new PenglaiError("INVALID_INPUT", "sourceSha must be 40-char hex, NONE, or empty until freeze");
  }
  if (isStaleSha(sourceSha) || isStaleSha(typeof o.artifactSha256 === "string" ? o.artifactSha256 : undefined)) {
    throw new PenglaiError("INVALID_INPUT", "identity points at STALE_INVALIDATED alpha hash");
  }
  if (o.electron !== PINNED_ELECTRON) throw new PenglaiError("INVALID_INPUT", "electron pin");
  if (o.embeddedNode !== PINNED_NODE) throw new PenglaiError("INVALID_INPUT", "node pin");
  if (o.node != null && o.node !== PINNED_NODE) throw new PenglaiError("INVALID_INPUT", "node pin");
  if (o.dsh !== PINNED_DSH) throw new PenglaiError("INVALID_INPUT", "dsh pin");
  const dshSource = o.dshSource as Record<string, unknown> | undefined;
  if (
    !dshSource ||
    dshSource.repository !== PINNED_DSH_REPOSITORY ||
    dshSource.tag !== PINNED_DSH_TAG ||
    dshSource.commit !== PINNED_DSH_COMMIT ||
    dshSource.closureManifestSha256 !== PINNED_DSH_CLOSURE_MANIFEST_SHA256 ||
    dshSource.cliTarballSha256 !== PINNED_DSH_TARBALL_SHA256 ||
    dshSource.packageCount !== PINNED_DSH_CLOSURE_PACKAGE_COUNT
  ) {
    throw new PenglaiError("INVALID_INPUT", "dsh source closure pin");
  }
  if (o.signed === true || o.developerIdSigned === true) {
    throw new PenglaiError("SECURITY_POLICY", "community-verified cannot claim Developer ID signed=true");
  }
  if (o.notarized === true) {
    throw new PenglaiError("SECURITY_POLICY", "community-verified cannot claim notarized=true");
  }
  if (o.authenticode === true) {
    throw new PenglaiError("SECURITY_POLICY", "community-verified cannot claim authenticode=true");
  }
  if (o.signatureKind && o.signatureKind !== "adhoc" && o.signatureKind !== "none" && o.signatureKind !== "unsigned-app-dir") {
    throw new PenglaiError("SECURITY_POLICY", "community-verified signatureKind must be adhoc");
  }
  if (typeof o.readyState === "string" && (FORBIDDEN_READY_STATES as readonly string[]).includes(o.readyState)) {
    throw new PenglaiError("SECURITY_POLICY", `identity cannot claim ${o.readyState}`);
  }
  const identity: ReleaseIdentity = {
    productName: PRODUCT_NAME,
    productVersion: PRODUCT_VERSION,
    buildNumber: Number(o.buildNumber),
    candidateOrdinal: Number(o.candidateOrdinal),
    candidateKind: CANDIDATE_KIND,
    trustTier: TRUST_TIER,
    generationId: GENERATION_ID,
    phase: o.phase as IdentityPhase,
    signatureKind: (o.signatureKind as ReleaseIdentity["signatureKind"]) ?? "adhoc",
    developerIdSigned: false,
    sourceSha,
    treeDirty: Boolean(o.treeDirty),
    targets: assertTargets(o.targets),
    electron: PINNED_ELECTRON,
    node: PINNED_NODE,
    embeddedNode: PINNED_NODE,
    dsh: PINNED_DSH,
    dshSource: {
      repository: PINNED_DSH_REPOSITORY,
      tag: PINNED_DSH_TAG,
      commit: PINNED_DSH_COMMIT,
      closureManifestSha256: PINNED_DSH_CLOSURE_MANIFEST_SHA256,
      cliTarballSha256: PINNED_DSH_TARBALL_SHA256,
      packageCount: PINNED_DSH_CLOSURE_PACKAGE_COUNT,
    },
    profileSchema: Number(o.profileSchema),
    catalogSchema: Number(o.catalogSchema),
    imSchema: Number(o.imSchema),
    signed: false,
    notarized: false,
    authenticode: false,
    publication: publicationOk(o.publication),
  };
  if (typeof o.artifactSha256 === "string") identity.artifactSha256 = o.artifactSha256;
  if (typeof o.runtimeManifestSha256 === "string") identity.runtimeManifestSha256 = o.runtimeManifestSha256;
  if (typeof o.evidenceRunId === "string") identity.evidenceRunId = o.evidenceRunId;
  if ("liveEvidence" in o) identity.liveEvidence = o.liveEvidence;
  if ("readyState" in o) identity.readyState = o.readyState;
  if ("installerSignatures" in o) identity.installerSignatures = o.installerSignatures;
  assertUnfrozenClean(identity);
  return identity;
}

export function assertIdentityMatchesGit(identity: ReleaseIdentity, git: GitState): void {
  if (identity.sourceSha === "" || identity.sourceSha === CANDIDATE_SOURCE_SHA_NONE) {
    if (identity.phase !== "UNFROZEN") {
      throw new PenglaiError("INVALID_INPUT", "named phase requires sourceSha");
    }
    if (git.branch !== "main") throw new PenglaiError("INVALID_INPUT", `branch is ${git.branch}`);
    return;
  }
  if (identity.sourceSha !== git.head) {
    throw new PenglaiError("INVALID_INPUT", `sourceSha ${identity.sourceSha} != HEAD ${git.head}`);
  }
  if (identity.sourceSha !== git.originMain) {
    throw new PenglaiError("INVALID_INPUT", `sourceSha != origin/main ${git.originMain}`);
  }
  if (identity.treeDirty !== git.dirty) {
    throw new PenglaiError("INVALID_INPUT", "treeDirty does not match git status");
  }
  if (git.branch !== "main") throw new PenglaiError("INVALID_INPUT", `branch is ${git.branch}`);
}

export function assertTamperedHashRejected(identity: ReleaseIdentity, mutatedSha: string): void {
  if (mutatedSha === identity.sourceSha) throw new PenglaiError("INVALID_INPUT", "mutated sha equals original");
  const copy = { ...identity, sourceSha: mutatedSha, phase: "TARGET_BUILT" as const };
  try {
    assertIdentityMatchesGit(copy, {
      head: identity.sourceSha,
      originMain: identity.sourceSha,
      dirty: identity.treeDirty,
      branch: "main",
    });
  } catch (err) {
    if (err instanceof PenglaiError) return;
    throw err;
  }
  throw new PenglaiError("SECURITY_POLICY", "tampered sourceSha was accepted");
}

export function staleAlphaHashes(): string[] {
  return STALE_ARTIFACTS.flatMap((a) => [a.sha256, a.sourceSha].filter((x) => x.length > 0));
}
