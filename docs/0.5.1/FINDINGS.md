# Penglai 0.5.1 findings ledger

Baseline: `kevinchennewbee/PenglaiAgent` `main` / `v0.5.0` / `ebfea25`.
Spec: `/Users/agent/Downloads/GPT-5 Codex.md`.
Owner decision for this pass: implement Batches A–G locally; **do not push or publish** until Owner review.

| ID | Severity | Evidence | Owner decision | Status | Acceptance |
| --- | --- | --- | --- | --- | --- |
| P51-CORE-001 | blocker | `packages/runtime/src/index.ts` `profilePluginEnabled` uses literal `\\s` in regex | fix with structured YAML parse | implemented | optional plugins absent/disabled/enabled + indent/comment |
| P51-AUTH-001 | blocker | `packages/context/src/index.ts` tools accept model `workspace_id` | Host-injected session workspace only | implemented | cross-session/workspace/forged id fail closed |
| P51-SUPPLY-001 | blocker | bundled catalog only; `source=bundled-first-party` | add PPDP/1 in `@penglai/plugin-registry` | implemented (source) | tamper/downgrade/tar/import-before-verify fail closed |
| P51-SUPPLY-002 | blocker | permissions are metadata | honest UI copy; no arbitrary third-party install | implemented | copy + no URL install surface |
| P51-DESKTOP-001 | blocker | packaged Electron still honors `PENGLAI_RESOURCES` | ignore env overlay when packaged | implemented | polluted env still uses sealed runtime |
| P51-DESKTOP-002 | blocker | production argv can include `--remote-debugging-port` | refuse in packaged app | implemented | packaged flag exits non-zero |
| P51-OWNER-001 | blocker | renderer `{confirmed:true}` is authority | native capability with digest/TTL | implemented | replay/cross-op/expired refuse |
| P51-ONBOARD-001 | blocker | `wizard-gate.ts` trusts `current: COMPLETE` | recompute from facts | implemented | JSON-only COMPLETE cannot skip wizard |
| P51-IM-001 | high | `setOutboxState` unconditional | CAS claim `queued→claimed→sending` | implemented | dual worker no double send |
| P51-COMP-001 | high | `UNIQUE(session_id,turn_no)` + transient→failed | unique includes trigger; transient recoverable | implemented | morning/idle/manual same turn |
| P51-BUDGET-001 | high | `releaseTurn` deletes unsettled reservations | audit release, no history delete | implemented | cancel/retry conservation |
| P51-LOCAL-001 | high | inner DSH loopback may bypass proxy | residual same-user-process risk recorded | residual | documented; no fake token |
| P51-QR-001 | high | QR challenge may leak vendor ref | opaque challenge id | deferred (IM QR already host-side; full opaque map not shipped) | guess/replay fail |
| P51-UPDATE-001 | high | `assertCanonicalManifestUrl(url, url)` | PUDP/1 fixed repo/asset names | implemented | evil repo/latest.json fail |
| P51-REPRO-001 | high | missing `.gitignore` / `.nvmrc` | add exact pin + ignore generated | implemented | public clone smoke |
| P51-GATE-001 | medium | `--report` vs enforcement | split report/gate | partial | non-PASS gate nonzero |
| P51-EVIDENCE-001 | medium | `scripts/write-evidence.mjs` hardcodes PASS | refuse official candidate writes | implemented | cannot write v0.5.1 evidence |
| P51-WINDOWS-001 | medium | Windows helper unreleased | keep NOT_RELEASED in 0.5.1 matrix | accepted | Apple Silicon only |

## Residual risks accepted for 0.5.1

- **P51-LOCAL-001:** DSH rc.8 has no official bearer/UDS seam. Same-OS-user process that discovers the inner 127.0.0.1 port remains a residual risk. Outer proxy still authenticates the renderer. Do not claim a fake inner token.
- **P51-WINDOWS-001:** Windows/Intel packaging code is engineering-only, not a 0.5.1 support claim.
- Plugin `permissions` are review/confirm metadata, not an OS sandbox (P51-SUPPLY-002).
- Offline clients cannot learn new revocations until the next successful signed catalog fetch.

## Commands

```bash
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:security
pnpm audit:secrets
```
