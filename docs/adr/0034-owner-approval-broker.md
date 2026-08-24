# ADR 0034 — Owner Approval Broker

- Status: Accepted
- Date: 2026-08-24
- Version: Penglai 0.5.6 implementation
- Requirements: R56-OWN-001 .. R56-OWN-008

## Context

0.5.5 high-impact actions still treat DSH `ask` or local grants as enough Owner proof. Under some Agent policies `ask` never appears. Office, Memory, Plugin Center, and IM therefore need one Main-owned confirmation path that cannot be filled by renderer-supplied paths or replayed receipts.

## Decision

1. Plugins and models create an immutable Proposal only. They do not commit.
2. Renderer calls a narrow `requestOwnerApproval(actionId)`. It cannot submit a substitute path, permission set, or result body.
3. Electron Main rereads the canonical intent from a trusted proposal store and shows a native bilingual dialog.
4. An approved Receipt is HMAC-MAC'd in Main, expires in 120 seconds, and is consumed once. The HMAC key never leaves Main.
5. The commit service returns receipt plus current intent digest to Main `consumeApproval()`. Main atomically moves `approved` to `reserved` and later `committed`. A crash after `reserved` must resolve the idempotent operation id; if the real result cannot be proven, create a new Proposal.
6. Deny, expiry, replay, object mutation, and Workspace drift have zero side effects. Changing a Proposal mints a new actionId and invalidates old receipts.
7. The Broker is not a sandbox against the same OS user or a shared-process malicious plugin. UI and docs must say so.

Migration order: Broker store, then Office, Memory, Plugin Center disable/rollback, IM bind/rebind/remove/group. Required plugins cannot be ordinarily disabled.

## Consequences

- DSH `ask` may remain as conversation UX. It is not the only Owner proof.
- Each action needs deny/expiry/replay/mismatch/workspace-switch tests.
- Logs keep ids, action, time, digest, and result only. No secret or body.
