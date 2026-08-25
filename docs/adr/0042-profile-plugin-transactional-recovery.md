# ADR 0042 — Profile and Plugin Center transactional recovery

- Status: Accepted
- Date: 2026-08-25
- Related: ADR 0016

## Context

0.5.6 audit remaining issues include a Plugin Center last-good delete-then-copy
crash window, profile activation that can boot a half profile, IM inbound
duplicate Turns after crash, and Recovery page inline script CSP.

## Decision

1. last-good is an independent immutable snapshot. The active profile is never
   the restore source.
2. Activation and plugin switches use staging, full validation, atomic swap,
   and atomic journal. A crash resumes repair or a complete last-good, never a
   half profile.
3. Community plugins remain disabled unless runtime isolation exists. A signed
   catalog row is not enough to enable unsigned community code.
4. IM inbound uses stable operation IDs, unique vendor-message constraints, and
   claim/Turn lookup before re-delivery. Outbox uses leases; uncertain send is
   not blindly retried.
5. Recovery page scripts move to a separate file or a strict CSP hash.

## Consequences

- SQLite schema increments from the actual current version, not a number copied
  from an audit report. Product `imSchema` moves 3 → 4 with the IM Core commit.
- Rollback to 0.5.6 must not delete 0.5.7 channel rows.
