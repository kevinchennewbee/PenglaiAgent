# Penglai 0.5.8 planning baseline

> Status: planning branch only. This directory records the product intent,
> upstream migration review, runtime findings, implementation order, and
> acceptance gates for Penglai 0.5.8. It does not change the current 0.5.7
> release contract and it is not evidence that 0.5.8 development or release is
> complete.

## Branch purpose

- Branch: `codex/0.5.8-planning`
- Base: public `kevinchennewbee/PenglaiAgent` `main`
- Base commit: `143482bf799b98734a70f74d38acb8932ed7864f`
- Created: 2026-08-28
- Product-code changes in this baseline: none
- Remote publication in this baseline: none

This branch preserves the results of the owner-led 0.5.7 installed-product
walkthrough and the adversarial review of the next official DeepSeek Harness
(DSH) line. The branch exists so those observations remain reviewable and do
not depend on chat history or one local note.

## Owner intent for 0.5.8

0.5.8 is not a feature-expansion release. Its purpose is to take the functions
already promised or bundled in 0.5.7, exercise them as a normal user would,
find the real failures, repair them at their correct ownership boundary, and
ship a stable Penglai distribution on the latest complete and consumable
official DSH release.

The governing principles are:

1. Official DSH remains the only Agent, Session, Workspace, Turn, tool,
   approval, model, and base Web UI core.
2. Penglai adapts to upstream; it does not fork DSH or build a parallel core.
3. A UI card, package file, QR, accepted callback, or passing source test is not
   proof that a capability is installed, active, usable, recovered, or live.
4. Bugs first observed on Penglai 0.5.7 must be reproduced again after the DSH
   migration before implementation, because the upstream architecture changed
   substantially.
5. The release fixes capability classes and lifecycle contracts, not individual
   screenshots, input strings, or timing coincidences.
6. No release claim is made without native installed evidence on Apple Silicon,
   Intel macOS, and Windows x64 from one clean source commit.

## What is frozen and what is not

The following may be frozen now:

- the 0.5.8 product intent;
- the observed 0.5.7 bug and usability ledger;
- the no-parallel-core boundary;
- the migration-first implementation order;
- the differential and adversarial acceptance strategy; and
- the rule that 0.5.8 consumes the latest complete official DSH package set.

The following must not be frozen yet:

- the exact new DSH npm version;
- its lockfile closure and integrity values;
- the final Remote and client-module package names;
- the final compatibility matrix; or
- release dates and native package claims.

As of the review snapshot on 2026-08-28, `dsh-v0.1.2-alpha.1` exists as an
official GitHub prerelease and source tag, but `@deepseek-ai/dsh` has not
published `0.1.2-alpha.1` to npm. Both npm `latest` and `next` still resolve to
`0.1.1-rc.2`. A source tag alone is not a consumable, reproducible Penglai
dependency closure.

## Documents

- [DSH_UPGRADE_REVIEW.md](./DSH_UPGRADE_REVIEW.md) records the old/new DSH
  comparison, the upstream ownership map, breaking seams, and anti-duplication
  decisions.
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) records the installed
  symptoms, evidence-backed root causes, severity, planned remediation,
  implementation phases, gates, and native acceptance plan.

## Start-work gate

Product implementation may begin only after the owner approves the exact DSH
baseline and the following read-only checks are complete:

- the official tag resolves to an immutable commit;
- `@deepseek-ai/dsh` and every required first-party package are published at a
  mutually compatible exact version;
- npm dist-tags and versions are not in a partial or retracted state;
- a clean frozen-lockfile installation succeeds;
- generated Remote/client artifacts are present in published packages; and
- the official release notes and source contracts have been re-reviewed against
  this plan.

Before that gate, continued 0.5.7 exploratory testing is useful. New findings
should be added to the ledger with a reproduction and should not trigger an
old-DSH-specific patch unless the owner explicitly decides to issue a 0.5.7
hotfix.

## Explicit non-goals for this planning baseline

- no dependency bump;
- no DSH source modification;
- no overlay rebase;
- no product-code change;
- no build, release, tag, or deployment;
- no claim that an upstream capability automatically fixes Penglai integration;
- no GitHub push or pull request without separate owner approval.
