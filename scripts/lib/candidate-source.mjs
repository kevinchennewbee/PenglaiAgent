import { gitState } from "./repo.mjs";

/**
 * Public freeze still requires clean main at origin/main.
 * 0.5.7 local candidate packaging may run on a clean feature branch; it must
 * never claim a frozen public source.
 */
export function requireCleanCandidateSource() {
  const git = gitState();
  if (git.dirty) {
    return { ok: false, git, frozen: false, localCandidate: false, reason: "dirty tree" };
  }
  const frozen = git.branch === "main" && git.head === git.originMain;
  return {
    ok: true,
    git,
    frozen,
    localCandidate: !frozen,
    reason: frozen ? "frozen origin/main" : "local unfrozen candidate",
  };
}
