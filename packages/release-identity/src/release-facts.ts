import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PRODUCT_VERSION } from "./pins.js";

/**
 * Documentation-versus-release-fact inspection.
 *
 * The 0.6.x line's most repeated defect was a document describing a different
 * release than the one in the repository: eight documents claimed 0.6.3 was
 * unpublished after it had been published and read back, and `docs/PRODUCT.md`
 * cited `Penglai_0.6.5_uos_loong64.deb` for a 0.6.3 release. Source gates stayed
 * green through all of it, because nothing compared prose against facts.
 *
 * This module performs the comparisons and returns findings.
 * `release-facts.test.ts` is the only emitter. A red finding becomes a FAIL
 * assertion, never a missing one: a document contradicting the release is the
 * defect being asserted against, and a FAIL blocks the release.
 */

export interface DocFinding {
  /** Registered acceptance id this finding belongs to. */
  id: string;
  /** Documents inspected for this id. */
  documents: string[];
  /** Problems found. Empty means the documents agree with the facts. */
  problems: string[];
  /** What was compared, recorded as evidence detail. */
  detail: string;
}

const ROOT = join(import.meta.dirname, "..", "..", "..");

/** Documents carrying the current release's user-facing facts. */
export const RELEASE_FACING_DOCS = [
  "README.md",
  "docs/PRODUCT.md",
  "docs/RELEASE_NOTES_0.6.3.md",
  "docs/PUBLICATION_MANIFEST_0.6.3.md",
  "docs/ACCEPTANCE.md",
] as const;

/** Documents that must disclose the excluded scope to a reader. */
export const EXCLUSION_FACING_DOCS = [
  "README.md",
  "docs/PRODUCT.md",
  "docs/RELEASE_NOTES_0.6.3.md",
] as const;

/** Modules and targets this version excludes from the product runtime. */
export const EXCLUDED_SCOPE = ["LibreOffice", "Office/PDF", "Budget", "Companion"] as const;

export function readDoc(rel: string): string {
  const path = join(ROOT, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export interface ReleaseContractShape {
  version: string;
  targets: { key: string; installer: string }[];
}

/**
 * Read the release contract as the authority for version and installer names.
 *
 * This deliberately does not import `assertReleaseContract`: the contract's
 * schema is already validated by its own gate, and a documentation check that
 * fails closed on an unrelated schema problem would report the wrong defect.
 */
export function readContract(rel = "release-contract.json"): ReleaseContractShape {
  const source = readDoc(rel);
  if (!source) throw new Error(`release contract ${rel} is missing`);
  const raw = JSON.parse(source) as { version?: unknown; targets?: unknown };
  const targets = Array.isArray(raw.targets) ? raw.targets : [];
  return {
    version: String(raw.version ?? ""),
    targets: targets.map((row) => {
      const rec = row as { key?: unknown; installer?: unknown };
      return { key: String(rec.key ?? ""), installer: String(rec.installer ?? "") };
    }),
  };
}

/** Installer filenames of the form Product_version_platform_arch.ext. */
const INSTALLER_RE = /\bPenglai_(\d+\.\d+\.\d+)_[A-Za-z0-9]+_[A-Za-z0-9_]+\.(?:dmg|exe|deb|zip)\b/g;

/**
 * Every installer filename a current-release document names must be an installer
 * this version actually produces.
 *
 * The defect this catches is a document that kept naming a different version's
 * installer, which is exactly what `Penglai_0.6.5_uos_loong64.deb` was.
 */
export function inspectInstallerFilenames(contract: ReleaseContractShape): DocFinding {
  const documents = [...RELEASE_FACING_DOCS];
  const allowed = new Set(contract.targets.map((t) => t.installer));
  const problems: string[] = [];
  const cited = new Set<string>();
  for (const rel of documents) {
    const source = readDoc(rel);
    if (!source) {
      problems.push(`${rel} is missing`);
      continue;
    }
    for (const match of source.matchAll(INSTALLER_RE)) {
      const filename = match[0];
      cited.add(filename);
      if (!allowed.has(filename)) {
        problems.push(`${rel} cites installer ${filename}, which is not a current release target`);
      }
    }
  }
  if (cited.size === 0) {
    problems.push("no release-facing document names any installer, so the check inspected nothing");
  }
  return {
    id: "R50-DOC-002",
    documents,
    problems,
    detail: `cited ${cited.size} installer filename(s) against ${allowed.size} contract target(s)`,
  };
}

/**
 * No release-facing document may claim a Penglai release the repository has no
 * publication record for.
 *
 * This replaces an earlier draft that compared every bare `x.y.z` in the prose
 * against the declared version. That draft flagged `README.md` for citing Node
 * `22.23.2` and pnpm `11.11.0` — dependency versions, not product versions — so
 * the check now identifies product claims structurally: a version written as
 * `Penglai <version>` or `v<version>`.
 */
export function inspectVersionAgreement(contract: ReleaseContractShape): DocFinding {
  const documents = [...RELEASE_FACING_DOCS];
  const problems: string[] = [];
  if (PRODUCT_VERSION !== contract.version) {
    problems.push(`pins declare ${PRODUCT_VERSION} but release-contract.json declares ${contract.version}`);
  }
  const recorded = new Set(recordedReleaseVersions());
  const claimed = new Set<string>();
  for (const rel of documents) {
    const source = readDoc(rel);
    if (!source) continue;
    // A product claim is a version written as `Penglai 0.6.3` or as a tag
    // reference `v0.6.3` that is NOT the tail of an upstream tag such as
    // `dsh-v0.1.6-alpha.2`. Matching these two forms structurally is what stops
    // unrelated dependency versions (Node `22.23.2`, pnpm `11.11.0`) from being
    // read as product claims.
    for (const match of source.matchAll(/Penglai\s+v?(\d+\.\d+\.\d+)/g)) {
      const found = match[1]!;
      claimed.add(found);
      if (!recorded.has(found)) {
        problems.push(`${rel} claims Penglai ${found}, which has no publication record`);
      }
    }
    for (const match of source.matchAll(/(?:^|[\s(])v(\d+\.\d+\.\d+)\b/gm)) {
      const found = match[1]!;
      claimed.add(found);
      if (!recorded.has(found)) {
        problems.push(`${rel} references release tag v${found}, which has no publication record`);
      }
    }
  }
  return {
    id: "R50-DOC-001",
    documents,
    problems,
    detail: `declared ${PRODUCT_VERSION}, contract ${contract.version}, ${claimed.size} claimed version(s) checked against ${recorded.size} record(s)`,
  };
}

/** Release versions the repository holds both release notes and a manifest for. */
export function recordedReleaseVersions(): string[] {
  const dir = join(ROOT, "docs");
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir);
  const notes = new Set(
    names
      .map((n) => /^RELEASE_NOTES_(\d+\.\d+\.\d+)\.md$/.exec(n)?.[1])
      .filter((v): v is string => Boolean(v)),
  );
  const manifests = new Set(
    names
      .map((n) => /^PUBLICATION_MANIFEST_(\d+\.\d+\.\d+)\.md$/.exec(n)?.[1])
      .filter((v): v is string => Boolean(v)),
  );
  return [...notes].filter((v) => manifests.has(v));
}


/**
 * The offline half of the `published-facts` drift probe. The probe asks GitHub
 * what is published; this asserts the repository's own account of the release is
 * internally consistent, so the check still runs with no network.
 */
export function inspectPublishedClaims(contract: ReleaseContractShape): DocFinding {
  const documents = [...RELEASE_FACING_DOCS];
  const problems: string[] = [];
  const notes = "docs/RELEASE_NOTES_0.6.3.md";
  const manifest = "docs/PUBLICATION_MANIFEST_0.6.3.md";
  for (const rel of [notes, manifest]) {
    if (!readDoc(rel)) problems.push(`${rel} is missing`);
  }
  for (const rel of documents) {
    const source = readDoc(rel);
    if (!source) continue;
    for (const status of source.matchAll(/Status:\s*`([A-Z_]+)`/g)) {
      const value = status[1]!;
      if (value === "UNPUBLISHED" || value === "BLOCKED") {
        problems.push(`${rel} declares Status: ${value} for version ${contract.version}`);
      }
    }
    for (const sentence of source.split(/[.\n]/)) {
      if (
        sentence.includes(contract.version) &&
        /has not been published|not yet published|\bunpublished\b/i.test(sentence)
      ) {
        problems.push(`${rel} claims ${contract.version} is unpublished`);
      }
    }
  }
  return {
    id: "R50-DOC-003",
    documents,
    problems,
    detail: `repository's own account of ${contract.version} publication`,
  };
}

/**
 * Every excluded module must be named as excluded by the documents a user reads.
 *
 * This is the readable half of the reverse-existence assertion: the runtime,
 * profile, SBOM and installer surfaces are asserted absent by
 * `R50-ABSENT-001`; this asserts a reader is told about it.
 */
export function inspectExclusionDisclosure(): DocFinding {
  const documents = [...EXCLUSION_FACING_DOCS];
  const problems: string[] = [];
  for (const rel of documents) {
    const source = readDoc(rel);
    if (!source) {
      problems.push(`${rel} is missing`);
      continue;
    }
    for (const term of EXCLUDED_SCOPE) {
      if (!source.includes(term)) problems.push(`${rel} does not disclose the exclusion of ${term}`);
    }
  }
  return {
    id: "R50-DOC-004",
    documents,
    problems,
    detail: `disclosure required for ${EXCLUDED_SCOPE.join(", ")}`,
  };
}

/**
 * Version-stamped release records must name the version whose bytes were
 * published, and the frozen installer list must still agree with the contract.
 *
 * A published release record is immutable, so the check is agreement rather than
 * regeneration: these files must not silently follow the tree to a new version.
 */
export function inspectStampedRecords(contract: ReleaseContractShape): DocFinding {
  const documents = ["docs/RELEASE_NOTES_0.6.3.md", "docs/PUBLICATION_MANIFEST_0.6.3.md"];
  const problems: string[] = [];
  const stamp = PRODUCT_VERSION;
  for (const rel of documents) {
    const source = readDoc(rel);
    if (!source) {
      problems.push(`${rel} is missing`);
      continue;
    }
    if (!source.includes(stamp)) problems.push(`${rel} does not name version ${stamp}`);
  }
  const notes = readDoc("docs/RELEASE_NOTES_0.6.3.md");
  if (notes && !/PUBLIC_READBACK_PASS/.test(notes)) {
    problems.push("release notes do not record the public readback status of the published bytes");
  }
  // The frozen records must name the same installers the contract selects.
  const manifest = readDoc("docs/PUBLICATION_MANIFEST_0.6.3.md");
  for (const target of contract.targets) {
    if (manifest && target.installer && !manifest.includes(target.installer)) {
      problems.push(`publication manifest does not record ${target.installer}`);
    }
  }
  return {
    id: "R50-DOC-005",
    documents,
    problems,
    detail: `stamped records agree with ${stamp} across ${contract.targets.length} target(s)`,
  };
}


/** Run every documentation check against the current release. */
export function inspectReleaseFacts(): DocFinding[] {
  const contract = readContract();
  return [
    inspectVersionAgreement(contract),
    inspectInstallerFilenames(contract),
    inspectPublishedClaims(contract),
    inspectExclusionDisclosure(),
    inspectStampedRecords(contract),
  ];
}
