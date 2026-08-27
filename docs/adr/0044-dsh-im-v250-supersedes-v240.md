# ADR 0044 — DSH-IM v2.5.0 supersedes the 0.5.7 v2.4.0 pin

- Status: Superseded by ADR 0045 for the current 0.5.7 review baseline
- Date: 2026-08-25
- Supersedes: ADR 0040 for its historical 0.5.7 DSH-IM review baseline
- Related: ADR 0037, ADR 0041

## Context

ADR 0040 pinned unsigned `v2.4.0` /
`7211534aeff01dba4ab78c79a5fa31cb9fa9510f`. Upstream published unsigned
`v2.5.0` the same day: tag object `d910373e1aa77e830bbb4a32544ace972492e79e`,
peeled `aa8fd71b936a0378604bd0f8f277059833ddb8f7`. The delta is six commits,
mainly structured message-failure reporting, Weixin typing, and client error
copy. Penglai still must not install the DSH-IM runtime.

## Decision

1. At the time of this decision, the 0.5.7 DSH-IM review baseline was unsigned `v2.5.0`, peeled
   `aa8fd71b936a0378604bd0f8f277059833ddb8f7`, with tarball SHA-256 in
   `docs/0.5.7/provenance/dsh-im-v2.5.0.md`. ADR 0045 now defines the current
   baseline; ADR 0040 and this ADR remain historical.
2. Users still see one Messaging plugin. Internal `channel-*` packages are not
   user plugins.
3. Port by rewrite only. Absorb structured failure codes/reference ids and
   channel transport ideas. Do not copy `lib/`, `bin/`, `cordis.patch.yml`,
   harness client, config stores, Office, or Weixin/Feishu replacements.
4. Production SDKs Penglai executes are direct, pinned dependencies of the
   matching channel package.

## Consequences

- Two “current pins” must not appear in README, SBOM, NOTICE, or
  `sources.lock.json`.
- Baileys, if executed, is a direct auditable dependency.
- Weixin typing from upstream is optional and capability-gated; failure must
  not block the official Turn reply.
