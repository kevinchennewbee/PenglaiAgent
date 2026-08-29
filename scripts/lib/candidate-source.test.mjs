import assert from "node:assert/strict";
import test from "node:test";
import "./release-pins-source.test.mjs";
import { requireCleanCandidateSource } from "./candidate-source.mjs";
import { gitState } from "./repo.mjs";

test("clean unfrozen 0.5.7 branches are local candidates; dirty trees are not", () => {
  const git = gitState();
  const source = requireCleanCandidateSource();
  if (git.dirty) {
    assert.equal(source.ok, false);
    assert.equal(source.frozen, false);
    assert.equal(source.localCandidate, false);
    assert.match(source.reason, /dirty tree/);
    return;
  }
  const frozen = git.branch === "main" && git.head === git.originMain;
  assert.equal(source.ok, true);
  assert.equal(source.frozen, frozen);
  assert.equal(source.localCandidate, !frozen);
  assert.match(source.reason, frozen ? /frozen origin\/main/ : /local unfrozen candidate/);
});
