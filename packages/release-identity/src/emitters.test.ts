import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EVIDENCE_EMITTERS, declaredEmitterIds, emitterDomainCounts } from "./evidence-emitters.js";
import { ACCEPTANCE_DOC, HARD_ID_RE } from "./pins.js";
import { assertRegistryConsistent, parseAcceptanceRegistry } from "./registry.js";

/**
 * Anti-regression: every registered Hard id must be able to produce evidence.
 *
 * `docs/ACCEPTANCE.md` declared 330 ids while only 72 were ever passed to
 * `recordAssertion`. 258 ids were therefore unemittable by construction, and
 * because `assertRequiredFamilies` also demanded 38 ids belonging to modules this
 * version excludes, `missing != 0` was guaranteed under every possible run. A
 * registry that can never be satisfied is not a gate; it is a decoration that
 * makes the tokens "PASS" and "330" meaningless.
 *
 * The design decision that matters is *how* emittability is decided. The
 * obvious implementation — "does the id appear as a literal somewhere in the
 * source?" — is what produced the false 89/330 figure: it counts ids that appear
 * in a test *name*, in a comment, or in a fixture object that is never recorded,
 * and it misses ids produced from a computed value. The predicate used here is
 * narrower and stronger:
 *
 *   An id is emittable when a declared emitter file calls `recordAssertion`
 *   (directly, or through the model that this module declares) AND that file
 *   contains an accepted declaration of the id.
 *
 * `acceptanceId: "R50-..."` as a literal is the declaration form accepted for
 * direct call sites, which is what all 72 original call sites use. The DRIFT and
 * DOC ids are emitted from a table lookup and from an inspection loop, so those
 * entries declare their marker explicitly in `EVIDENCE_EMITTERS`.
 *
 * The empirical half of the same guarantee lives in `scripts/verify-evidence.mjs`:
 * the collector suites run with `PENGLAI_EVIDENCE_DIR` set and their emitted ids
 * are ground truth. It cannot be exhaustive here because several ids are emitted
 * only when a sealed native artifact is present, which is correct — claiming
 * installed evidence from a source-only machine would be the defect, not the
 * missing record.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");

function readRepoFile(rel: string): string | undefined {
  const path = join(ROOT, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export interface EmittabilityReport {
  registryIds: string[];
  declaredIds: string[];
  /** Registered ids with no declared emitter. */
  unemittable: string[];
  /** Declared emitters whose id is not registered, so the evidence is orphaned. */
  orphaned: string[];
  /** Emitter entries whose files or markers could not be proven. */
  unproven: string[];
}

export function auditEmittability(registryIds: readonly string[]): EmittabilityReport {
  const registered = new Set(registryIds);
  const declared = declaredEmitterIds();
  const unemittable: string[] = [];
  const unproven: string[] = [];

  for (const entry of EVIDENCE_EMITTERS) {
    const files = entry.files.map((rel) => ({ rel, text: readRepoFile(rel), hasCall: hasRecordAssertion(rel) }));
    const missingFiles = files.filter((f) => f.text === undefined);
    if (missingFiles.length === entry.files.length) {
      unproven.push(`${entry.id}: no emitter file exists (${entry.files.join(",")})`);
      continue;
    }
    const proven = files.some(
      (f) =>
        f.text !== undefined &&
        entry.markers.some((marker) => f.text!.includes(marker)) &&
        f.hasCall,
    );
    if (!proven) {
      unproven.push(
        `${entry.id}: no declared file both declares the id and calls recordAssertion (${entry.files.join(",")})`,
      );
    }
  }

  for (const id of registryIds) {
    if (!declared.includes(id)) unemittable.push(id);
  }
  const orphaned = declared.filter((id) => !registered.has(id));

  return {
    registryIds: [...registryIds],
    declaredIds: declared,
    unemittable: unemittable.sort(),
    orphaned: orphaned.sort(),
    unproven: unproven.sort(),
  };
}

/**
 * Every declared emitter file must actually call `recordAssertion`. This is what
 * separates an emitter from a file that merely names an id: the previous
 * registry had 39 files containing id literals and only 14 that could record one.
 */
function hasRecordAssertion(rel: string): boolean {
  const text = readRepoFile(rel);
  if (text === undefined) return false;
  return /recordAssertion\s*\(/.test(text);
}

/**
 * The requested audit entry point. Throws with every problem, not the first, so a
 * single failing run tells the author everything that must be fixed.
 */
export function assertEveryHardIdEmittable(registryIds: readonly string[]): EmittabilityReport {
  const report = auditEmittability(registryIds);
  const problems: string[] = [];
  if (report.unemittable.length > 0) {
    problems.push(
      `registered but no emitter can produce it (${report.unemittable.length}): ${report.unemittable.join(",")}`,
    );
  }
  if (report.orphaned.length > 0) {
    problems.push(
      `declared emitter but not registered, so its evidence would be orphaned (${report.orphaned.length}): ${report.orphaned.join(",")}`,
    );
  }
  if (report.unproven.length > 0) {
    problems.push(`emitter declaration could not be proved (${report.unproven.length}): ${report.unproven.join(" | ")}`);
  }
  if (problems.length > 0) {
    throw new Error(`acceptance registry is not fully emittable:\n  ${problems.join("\n  ")}`);
  }
  return report;
}

const registryMarkdown = readRepoFile(ACCEPTANCE_DOC) ?? "";
const entries = assertRegistryConsistent(registryMarkdown);
const registryIds = entries.map((e) => e.id);
const report = assertEveryHardIdEmittable(registryIds);

test("every registered Hard id is emittable, and every emitter is registered", () => {
  assert.equal(report.unemittable.length, 0);
  assert.equal(report.orphaned.length, 0);
  assert.equal(report.unproven.length, 0);
  assert.equal(report.registryIds.length, report.declaredIds.length);
});

test("the registry carries no id from an excluded module family", () => {
  // Office/PDF, Budget and Companion are outside the product runtime. An id that
  // requires them can never be satisfied, which is what made `missing` nonzero
  // under every possible run.
  for (const retired of [/^R5[05]-OFFICE-/, /^R5[05]-BUDGET-/, /^R5[05]-COMP-/]) {
    const hits = registryIds.filter((id) => retired.test(id));
    assert.deepEqual(hits, [], `registry must not declare ids for excluded modules (${hits.join(",")})`);
  }
});

test("no registered id targets Intel, which this version excludes", () => {
  const macIntel = registryIds.filter((id) => id === "R50-MAC-010" || /-INTEL-/.test(id));
  assert.deepEqual(macIntel, [], "the registry must not declare Intel ids for a version that excludes Intel");
});

test("the registry declares a DRIFT domain and a DOC domain", () => {
  const counts = emitterDomainCounts();
  assert.ok((counts.DRIFT ?? 0) >= 5, "DRIFT must cover every drift probe");
  assert.ok((counts.DOC ?? 0) >= 4, "DOC must cover documentation-versus-release-fact agreement");
  assert.ok(registryIds.includes("R50-ABSENT-001"), "the excluded scope needs one reverse-existence id");
});

test("every registered id appears in the document as a parseable Hard row", () => {
  const parsed = parseAcceptanceRegistry(registryMarkdown).map((e) => e.id);
  assert.deepEqual([...parsed].sort(), [...registryIds].sort());
  HARD_ID_RE.lastIndex = 0;
  const literalRows = registryMarkdown.match(new RegExp(HARD_ID_RE.source, "g")) ?? [];
  assert.equal(
    literalRows.length,
    registryIds.length,
    "the document must not contain Hard-shaped ids outside a parseable row",
  );
});
