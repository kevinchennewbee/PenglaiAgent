# Penglai 0.5.1 findings ledger

Baseline: branch `0.5.1`. Local source work only; **do not push, tag, or publish** until Owner review.

Status in this ledger is evidence-backed. Source tests are not packaged, installed, or release-plane evidence. Missing Intel/Windows runners, PluginRegistry, immutable Releases, or key backup are **BLOCKED** / **NOT_RUN**, not accepted residuals.

| ID | Severity | Evidence | Owner decision | Status | Acceptance |
| --- | --- | --- | --- | --- | --- |
| P51-TREE-001 | blocker | plugin-registry/plugin-pilot `package.json` were excluded locally | `git add -f`; public-export reads git index blobs | source PASS | tracked tree, no Owner home path |
| P51-CORE-001 | blocker | `profilePluginEnabled` YAML parse | keep structured YAML parse | source PASS | optional plugins absent/disabled/enabled |
| P51-AUTH-001 | blocker | Context used `extra.sessionId` | bind `exec.agent.id` via DSH ToolRunContext | source PASS | forged extra.sessionId fail closed |
| P51-SUPPLY-001 | blocker | PPDP/1 host: GitHub immutable discovery, streaming hash, tar policy, CAS cache, install disabled | production refresh rejects renderer URL/key | source PASS; packaged/installed **NOT_RUN** | tamper/downgrade/tar fail closed |
| P51-SUPPLY-002 | blocker | Plugin Center mapped only FIRST_PARTY_CARDS | remote catalog rows + bundled; remote loader row via profile tx | source PASS; live GitHub **BLOCKED** | remote source/version/DSH/permissions/signature/state |
| P51-DESKTOP-001 | blocker | packaged Electron ignored `PENGLAI_RESOURCES` only when harness env unset | packaged always ignores overlay | source PASS; exact DMG **NOT_RUN** | polluted env still uses sealed runtime |
| P51-DESKTOP-002 | blocker | `PENGLAI_ALLOW_TEST_HARNESS` bypassed packaged debug refusal | removed from production | source PASS; exact DMG **NOT_RUN** | packaged debug flags exit non-zero |
| P51-OWNER-001 | blocker | deletion used renderer `{confirmed:true}` | native `dialog.showMessageBox` required | source PASS; installed **NOT_RUN** | no renderer-only delete |
| P51-OWNER-002 | blocker | plugin enable used renderer remotes only | native one-shot plugin capability bound to id/version/sha256/permissionDigest | source PASS; installed **NOT_RUN** | enable/update/installDisabled consume capability |
| P51-ONBOARD-001 | blocker | wizard trusted JSON `COMPLETE` | recompute from credential YAML, official workspace.json, nonce file, sessions, first conversation | source PASS; installed **NOT_RUN** | JSON-only / deleted credential / deleted workspace / stale nonce / missing first conversation cannot skip |
| P51-ONBOARD-002 | blocker | six-step machine skipped Workspace + first Turn | `workspace-v1` + `first-turn-v1` in ONBOARDING_STEPS; official registry/create + Agent/Turn | source PASS; installed E2E **NOT_RUN** | restart enters DSH Web from official facts |
| P51-IM-001 | high | outbox CAS without claim token | claim token + exclusive claim | source PASS | dual worker send-once |
| P51-UPDATE-001 | high | updater always fetched `v0.5.1` own manifest | PUDP/1 discovers highest immutable semver; GitHub 302 then Range; no zero SHA | source PASS; live GitHub **BLOCKED** | evil repo/latest.json fail |
| P51-WINDOWS-001 | blocker | Windows helper unreleased | three-target contract; non-native builder must exit 4 | **BLOCKED** pending win32-x64 runner | PE AMD64 Setup + installed E2E |
| P51-INTEL-001 | blocker | ensure-electron was host-only | `--target` + Mach-O walk | **BLOCKED** pending darwin-x86_64 runner | Intel DMG native PASS |
| P51-MIGRATE-001 | high | rc.8 → rc.1 user-data migrate missing | versioned backup + idempotent marker + fail-closed restore | source PASS; live 0.5.0 copy **NOT_RUN** | credentials/workspace/session/settings/desired preserved |
| P51-SIGN-001 | medium | sign/read-back/rotation tools | scripts added | source PASS; live Release **BLOCKED** | read-back after Owner publish |
| P51-LOCAL-001 | high | inner DSH loopback may bypass proxy | residual | residual | documented; no fake token |
| P51-QR-001 | high | QR challenge may leak vendor ref | deferred | deferred | guess/replay fail |

## Residual risks (not accepted as 0.5.1 native PASS)

- **P51-LOCAL-001:** DSH has no official bearer/UDS seam. Same-OS-user process that discovers the inner 127.0.0.1 port remains a residual risk.
- **P51-WINDOWS-001 / P51-INTEL-001:** in-scope for 0.5.1. Status is **BLOCKED** until a matching native runner produces exact installers and installed E2E. They are not deferred extras and not an Apple Silicon-only support claim.
- Plugin `permissions` are review/confirm metadata, not an OS sandbox.
- Offline clients cannot learn new revocations until the next successful signed catalog fetch.
- `kevinchennewbee/PenglaiPluginRegistry` and PenglaiAgent immutable Releases are not published. Live PPDP/PUDP remain **BLOCKED**.

## Commands (source)

```bash
pnpm typecheck
pnpm test:unit
pnpm test:security
pnpm test:contract
pnpm verify:identity   # UNFROZEN identity may pass off main
pnpm verify:contracts
pnpm verify:clean-clone
pnpm package:windows   # must exit 4 on macOS
```

## Packaged / installed / release-plane

| Surface | Status |
| --- | --- |
| exact `Penglai_0.5.1_macos_aarch64.dmg` | **NOT_RUN** |
| exact Intel DMG / Windows Setup | **BLOCKED** (no native runner) |
| Plugin Center installed UI | **NOT_RUN** |
| PPDP live GitHub catalog | **BLOCKED** (registry missing) |
| PUDP live higher semver Release | **BLOCKED** |
| public-export clean-room `--clean-room` | **NOT_RUN** this session |
| push / tag / GitHub Release | **not authorized** |
