# Penglai 0.5.1 findings ledger

Baseline: `kevinchennewbee/PenglaiAgent` `main` / `v0.5.0` / `ebfea25`.
Spec: owner-provided Penglai 0.5.1 signed plugin ecosystem plan (local path omitted from the public tree).
Owner decision for this pass: implement locally; **do not push or publish** until Owner review.

Status in this ledger is evidence-backed. Source tests are not packaged, installed, or release-plane evidence.

| ID | Severity | Evidence | Owner decision | Status | Acceptance |
| --- | --- | --- | --- | --- | --- |
| P51-TREE-001 | blocker | plugin-registry/plugin-pilot `package.json` were excluded locally | `git add -f`; public-export reads git index blobs | source PASS | tracked tree, no Owner home path |
| P51-CORE-001 | blocker | `profilePluginEnabled` YAML parse | keep structured YAML parse | source PASS | optional plugins absent/disabled/enabled |
| P51-AUTH-001 | blocker | Context used `extra.sessionId` | bind `exec.agent.id` via DSH rc.8 ToolRunContext | source PASS | forged extra.sessionId fail closed |
| P51-SUPPLY-001 | blocker | PPDP/1 host: GitHub immutable discovery, streaming hash, tar policy, CAS cache, install disabled | production refresh rejects renderer URL/key | source PASS; packaged/installed **NOT_RUN** | tamper/downgrade/tar fail closed |
| P51-SUPPLY-002 | blocker | Plugin Center mapped only FIRST_PARTY_CARDS | UI lists remote catalog rows + bundled | source PASS; installed UI **NOT_RUN** | remote source/version/DSH/permissions/signature/state |
| P51-DESKTOP-001 | blocker | packaged Electron ignored `PENGLAI_RESOURCES` only when harness env unset | packaged always ignores overlay | source PASS; exact DMG **NOT_RUN** | polluted env still uses sealed runtime |
| P51-DESKTOP-002 | blocker | `PENGLAI_ALLOW_TEST_HARNESS` bypassed packaged debug refusal | removed from production | source PASS; exact DMG **NOT_RUN** | packaged debug flags exit non-zero |
| P51-OWNER-001 | blocker | deletion used renderer `{confirmed:true}` | native `dialog.showMessageBox` required | source PASS; installed **NOT_RUN** | no renderer-only delete |
| P51-ONBOARD-001 | blocker | wizard trusted JSON `COMPLETE` | recompute from credential YAML, workspace dir, nonce file, sessions, first conversation | source PASS; installed **NOT_RUN** | JSON-only / deleted credential / deleted workspace / stale nonce / missing first conversation cannot skip |
| P51-IM-001 | high | outbox CAS without claim token | claim token + exclusive claim; late callback cannot overwrite delivered | source PASS | dual worker send-once |
| P51-COMP-001 | high | Companion schema 2→3 one-shot | migrate once; corrupt schema_meta fail closed | source PASS | morning/idle/manual same turn |
| P51-BUDGET-001 | high | `releaseTurn` history | unchanged this pass | source PASS | cancel/retry conservation |
| P51-LOCAL-001 | high | inner DSH loopback may bypass proxy | residual | residual | documented; no fake token |
| P51-QR-001 | high | QR challenge may leak vendor ref | deferred | deferred | guess/replay fail |
| P51-UPDATE-001 | high | updater always fetched `v0.5.1` own manifest | PUDP/1 discovers highest immutable semver from PenglaiAgent Releases API | source PASS; live GitHub **NOT_RUN** | evil repo/latest.json fail |
| P51-REPRO-001 | high | public-export walked the working tree | git ls-files / git archive index | source PASS; clean-clone gate **NOT_RUN** this session | archive/clone frozen install |
| P51-GATE-001 | medium | `--report` vs enforcement | split report/gate | partial | non-PASS gate nonzero |
| P51-EVIDENCE-001 | medium | official candidate writes | refuse until freeze | source PASS | cannot write v0.5.1 evidence as PASS |
| P51-WINDOWS-001 | medium | Windows helper unreleased | keep NOT_RELEASED | accepted | Apple Silicon only |
| P51-PILOT-001 | high | plugin-pilot `(args, exec)` threw | execute(args, exec) succeeds; pack wired | source PASS; signed catalog/E2E **NOT_RUN** | refresh→download→install disabled→enable→tool→disable→rollback |
| P51-SIGN-001 | medium | sign/read-back/rotation tools | scripts added | source PASS; live Release **NOT_RUN** | read-back after Owner publish |

## Residual risks accepted for 0.5.1

- **P51-LOCAL-001:** DSH rc.8 has no official bearer/UDS seam. Same-OS-user process that discovers the inner 127.0.0.1 port remains a residual risk.
- **P51-WINDOWS-001:** Windows/Intel packaging is engineering-only.
- Plugin `permissions` are review/confirm metadata, not an OS sandbox.
- Offline clients cannot learn new revocations until the next successful signed catalog fetch.
- Official ToolRuntime.execute still requires a full DSH inject graph; Context unit tests bind `exec.agent.id` through official Agent/Workspace types and ToolRuntime's public execute/register surface.
- Exact DMG, live GitHub Releases, and PenglaiPluginRegistry publication were **not run**.

## Commands (source)

```bash
pnpm typecheck          # exit 0
pnpm test:unit          # 405 pass, exit 0
pnpm test:security      # 15 pass, exit 0
pnpm test:e2e           # 61 pass, exit 0
pnpm test:contract      # 57 pass, exit 0
pnpm verify:clean-clone # NOT_RUN this session (git archive + frozen install + typecheck + build + unit)
pnpm test:e2e:installed # NOT_RUN (no exact Penglai_0.5.1_macos_aarch64.dmg)
```

## Packaged / installed / release-plane

| Surface | Status |
| --- | --- |
| exact `Penglai_0.5.1_macos_aarch64.dmg` | **NOT_RUN** |
| Info.plist / SBOM / runtime-manifest 0.5.1 on artifact | **NOT_RUN** (source paths updated) |
| Plugin Center installed UI | **NOT_RUN** |
| PPDP live GitHub catalog | **NOT_RUN** |
| PUDP live higher semver Release | **NOT_RUN** |
| plugin-pilot signed publish + installed E2E | **NOT_RUN** |
| public-export clean-room `--clean-room` | **NOT_RUN** |
| push / tag / GitHub Release | **not authorized** |
