import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MNEMON_CATEGORIES } from "../engine/categories.js";
import { CANDIDATE_KINDS } from "./governance.js";
import {
  CANDIDATE_KIND_TO_MNEMON_CATEGORY,
  nativeCategoryForCandidateKind,
  nativeMaterializationTags,
} from "./native-category.js";

test("CandidateKind maps exhaustively onto pinned Mnemon categories", () => {
  assert.deepEqual(Object.keys(CANDIDATE_KIND_TO_MNEMON_CATEGORY).sort(), [...CANDIDATE_KINDS].sort());
  assert.equal(Object.keys(CANDIDATE_KIND_TO_MNEMON_CATEGORY).length, CANDIDATE_KINDS.length);
  for (const kind of CANDIDATE_KINDS) {
    const cat = nativeCategoryForCandidateKind(kind);
    assert.equal(cat, CANDIDATE_KIND_TO_MNEMON_CATEGORY[kind]);
    assert.equal(MNEMON_CATEGORIES.includes(cat), true);
  }
  assert.equal(nativeCategoryForCandidateKind("preference"), "preference");
  assert.equal(nativeCategoryForCandidateKind("decision"), "decision");
  assert.equal(nativeCategoryForCandidateKind("project_fact"), "fact");
  assert.equal(nativeCategoryForCandidateKind("person_fact"), "fact");
  assert.equal(nativeCategoryForCandidateKind("constraint"), "context");
  const used = new Set(Object.values(CANDIDATE_KIND_TO_MNEMON_CATEGORY));
  assert.equal(used.has("general"), false);
  assert.equal(used.has("insight"), false);
  assert.throws(() => nativeCategoryForCandidateKind("insight"), /UNKNOWN_MEMORY_KIND/);
  assert.throws(() => nativeCategoryForCandidateKind("general"), /UNKNOWN_MEMORY_KIND/);
  assert.throws(() => nativeCategoryForCandidateKind("project_factx"), /UNKNOWN_MEMORY_KIND/);
});

test("materialization tags keep the original CandidateKind", () => {
  const tags = nativeMaterializationTags({
    candidateId: "161cf2ed-1308-4e92-920a-c37aec8fa022",
    kind: "project_fact",
  });
  assert.equal(tags, "candidate:161cf2ed-1308-4e92-920a-c37aec8fa022,kind:project_fact");
  assert.match(tags, /kind:project_fact/);
  assert.doesNotMatch(tags, /kind:fact/);
});

test("durable materializeCandidate maps kind and does not send CandidateKind as --cat", () => {
  const src = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  assert.match(src, /nativeCategoryForCandidateKind\(candidate\.kind\)/);
  assert.match(src, /nativeMaterializationTags\(candidate\)/);
  assert.doesNotMatch(src, /cat:\s*candidate\.kind/);
  assert.match(src, /source: personal \? "owner-accepted-curator" : "auto-curator"/);
  const applySrc = src.slice(src.indexOf("export function apply"));
  assert.doesNotMatch(applySrc, /allowUnpinnedTestBinary/);
});
