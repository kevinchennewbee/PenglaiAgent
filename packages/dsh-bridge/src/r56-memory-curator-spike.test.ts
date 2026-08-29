import assert from "node:assert/strict";
import test from "node:test";
import { PINNED_DSH } from "./index.js";
import {
  CURATOR_MAX_CANDIDATES,
  MEMORY_CURATOR_SPIKE_ID,
  failOpenCuratorParse,
  parseCuratorOutput,
  probeOfficialMemoryCurator,
} from "./r56-memory-curator-spike.js";

test("R56-MEM-005 official curator path is a one-shot LLM request plus host schema", () => {
  const report = probeOfficialMemoryCurator();
  assert.equal(report.requirement, MEMORY_CURATOR_SPIKE_ID);
  assert.equal(report.dsh, PINNED_DSH);
  assert.equal(report.verdict, "GO");
  assert.equal(report.officialLlmStream, true);
  assert.equal(report.officialCreateUserMessage, true);
  assert.equal(report.providerJsonSchema, false);
  assert.equal(report.purposeSupportsCurator, false);
  assert.equal(report.createsAgent, false);
  assert.equal(report.createsSession, false);
  assert.equal(report.toolsDisabledBy, "empty-tools-list");
  assert.equal(report.alphaJobsDecision, "REJECT_USER_VISIBLE");
  assert.equal(report.hostJsonSchema, true);
  assert.ok(report.generateOptionKeys.includes("tools"));
  assert.ok(report.generateOptionKeys.includes("signal"));
  assert.equal(report.generateOptionKeys.includes("responseFormat"), false);
});

test("R56-MEM-005 host schema accepts a closed candidate object", () => {
  const parsed = parseCuratorOutput(
    JSON.stringify({
      candidates: [
        {
          kind: "project_fact",
          text: "The current Workspace uses official DSH as the only agent core.",
          rationale: "User stated the product boundary.",
          sensitivity: "normal",
          confidence: 0.9,
          suggestedScope: "workspace",
        },
      ],
    }),
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.candidates.length, 1);
    assert.equal(parsed.candidates[0]?.kind, "project_fact");
    assert.equal(parsed.candidates[0]?.suggestedScope, "workspace");
  }
});

test("R56-MEM-005 host schema rejects extra fields, unknown enums, and oversize arrays", () => {
  assert.equal(parseCuratorOutput("not-json").ok, false);
  assert.equal(parseCuratorOutput(JSON.stringify({ candidate: [] })).ok, false);
  assert.equal(
    parseCuratorOutput(
      JSON.stringify({
        candidates: [
          {
            kind: "secret",
            text: "x",
            rationale: "y",
            sensitivity: "normal",
            confidence: 1,
            suggestedScope: "workspace",
          },
        ],
      }),
    ).ok,
    false,
  );
  assert.equal(
    parseCuratorOutput(
      JSON.stringify({
        candidates: [
          {
            kind: "preference",
            text: "keep replies short",
            rationale: "user asked",
            sensitivity: "normal",
            confidence: 0.8,
            suggestedScope: "personal",
            path: "/Users/owner/private",
          },
        ],
      }),
    ).ok,
    false,
  );
  assert.equal(
    parseCuratorOutput(JSON.stringify({ candidates: Array.from({ length: CURATOR_MAX_CANDIDATES + 1 }, () => ({
      kind: "preference",
      text: "x",
      rationale: "y",
      sensitivity: "normal",
      confidence: 0.1,
      suggestedScope: "workspace",
    })) })).ok,
    false,
  );
});

test("R56-MEM-005 curator failures fail open", () => {
  const failed = failOpenCuratorParse("{");
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.failOpen, true);
    assert.equal(failed.code, "CURATOR_JSON_INVALID");
  }
});
