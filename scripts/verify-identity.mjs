import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, gitState, readJson } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";

const git = gitState();
const { assertReleaseIdentity, assertIdentityMatchesGit, isStaleSha } = await import(
  pathToFileURL(join(ROOT, "packages/release-identity/src/index.ts")).href
);

let raw;
try {
  raw = readJson("release-info.json");
} catch (err) {
  finish("FAIL", { command: "verify:identity", reason: String(err) });
}

if (isStaleSha(raw.sourceSha) || isStaleSha(raw.artifactSha256)) {
  finish("STALE", { command: "verify:identity", reason: "release-info points at STALE_INVALIDATED hash" });
}

let identity;
try {
  identity = assertReleaseIdentity(raw);
  if (identity.sourceSha && identity.sourceSha !== "NONE" && identity.phase !== "UNFROZEN") {
    assertIdentityMatchesGit(identity, git);
  }
  if (git.branch !== "main") {
    finish("FAIL", { command: "verify:identity", reason: `branch is ${git.branch}` });
  }
} catch (err) {
  finish("FAIL", { command: "verify:identity", reason: String(err) });
}

mkdirSync(join(ROOT, "evidence/generated"), { recursive: true });
writeFileSync(
  join(ROOT, "evidence/generated/identity.json"),
  JSON.stringify(
    {
      git,
      productVersion: identity.productVersion,
      candidateKind: identity.candidateKind,
      trustTier: identity.trustTier,
      generationId: identity.generationId,
      phase: identity.phase,
      targets: identity.targets,
      publication: identity.publication,
      tamperRejected: true,
    },
    null,
    2,
  ),
);
finish("PASS", {
  command: "verify:identity",
  head: git.head.slice(0, 12),
  productVersion: identity.productVersion,
  dirty: git.dirty,
  phase: identity.phase,
});
