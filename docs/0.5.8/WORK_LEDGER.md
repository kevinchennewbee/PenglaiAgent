# Penglai 0.5.8 preview work ledger

> Branch: `0.5.8-preview`. Updated: 2026-08-29. A completed source row is not a
> package, native, installed, live, or public-release pass.

## State vocabulary

- `DONE`: source work and its stated source checks are complete.
- `IN_PROGRESS`: implementation has started; no completion claim.
- `READY`: evidence and ownership permit work now.
- `BLOCKED_NPM`: requires the matching official npm package closure.
- `BLOCKED_NATIVE`: requires a target-native package or machine.
- `BLOCKED_OWNER_LIVE`: requires Owner account/credential interaction.
- `NOT_STARTED`: within scope but not begun.

## Execution ledger

| ID | Work | Evidence class | State | Current result / next gate |
| --- | --- | --- | --- | --- |
| P058-001 | Verify repository identity, branch, base, remote, and clean state | Source | DONE | `0.5.8-preview` tracks its remote; base is main `143482bf…` |
| P058-002 | Fix DSH source baseline | Source | DONE | alpha.1 tag bound to `cd5ef814…`, tree and archive digest recorded |
| P058-003 | Clean upstream frozen install | Source | DONE | PASS on macOS arm64 with Node 22.22.2/pnpm 11.7.0 |
| P058-004 | Full upstream source build | Source | DONE | Host, Client, CLI, and Web build PASS |
| P058-005 | Split source and package gates | Governance | DONE | source work open; DSH dependency integration remains blocked |
| P058-006 | Upstream-to-Penglai migration matrix | Source/design | DONE | direct consumers and acceptance gates assigned; refine during implementation |
| P058-007 | Repository asset classification | Source/design | IN_PROGRESS | primary DSH, release, WhatsApp, and independent-fix assets classified |
| P058-008 | Preview invariant verifier | Source/CI | DONE | local and remote preview gate PASS; protects release/public surfaces and DSH pins |
| P058-009 | Enable Source CI on preview branch | Source/CI | DONE | first preview Source CI PASS on `602f684b`; no main workflow run or release action |
| P058-010 | Remove WhatsApp active source and identity | Source | DONE | package, adapter, channel/route identity, credential, risk-owner Remote, UI card/copy, tests, and workspace references removed; historical 0.5.7 surfaces preserved |
| P058-011 | Remove WhatsApp dependency/lock/license closure | Package-source | DONE | frozen install PASS with 34 workspaces; lock/SBOM/notices/plugin staging contain none of four retired runtime identities; DSH pins unchanged |
| P058-012 | Contain Feishu asynchronous media callback failures | Source | DONE | callback stays bounded; rejection resolves to redacted durable terminal state; focused tests PASS |
| P058-013 | Map all ApiProxy callers to owner Remotes | Source/design | DONE | 9 operational/support references and exact create/modelCatalog/selectModel ownership are frozen by the executable census |
| P058-014 | Implement owner Remote migration | Package/source | BLOCKED_NPM | exact published declarations/generated clients required |
| P058-015 | Map all `dsh-client-runtime` consumers | Source/design | DONE | 8 plugin manifests and 8 packager rows are frozen; exact replacement graph remains P058-026 |
| P058-016 | Quarantine unsupported legacy channel rows | Source/upgrade | DONE | startup revokes unsupported route/binding activity without deleting audit rows; bot lists hide unsupported rows and reject new unknown filters |
| P058-026 | Implement narrow client package graph | Package/source | BLOCKED_NPM | published exports and generated artifacts required |
| P058-017 | Overlay-to-slot map | Source/design/CI | DONE | 12 mapped dispositions cover all 4 patched files and 5 brand assets; 4 narrow upstream gaps remain; executable gate PASS |
| P058-018 | One-time browser-token integration | Source/package/native | IN_PROGRESS | private exact-authority token exchange, cookie proof, proxy injection, rc.2 compatibility, redaction, and real child fixture pass in source; exact alpha package and native first navigation remain |
| P058-019 | Packaged DSH child supervision repair | Source/native | IN_PROGRESS | child/owner lifetimes, bounded hang/port-loss recovery, authenticated alpha-style health, structured diagnostics, exact exhaustion, and non-stranding actions pass locally; three-target native/installed proof remains |
| P058-028 | Isolated rc.2 → alpha.1 DSH Home generation | Source/package/native | IN_PROGRESS | private bounded copy, one-writer journal, disk/file-type/mode gates, health-bound atomic activation, rejection, rollback, and rc.2 JSONL replay pass in source; installed corpus, SQLite, Windows ACL, runtime wiring, and native rollback remain |
| P058-020 | Session title projection in IM | Package/source | BLOCKED_NPM | official Session list/projection Remote required |
| P058-021 | Official image Attachment handoff | Package/live | BLOCKED_NPM | callback/download safety can proceed; final DSH admission needs packages |
| P058-022 | Feishu real media permission/download proof | Live | BLOCKED_OWNER_LIVE | perform only with privacy-safe Owner account evidence |
| P058-023 | Memory curator internal-job lifecycle | Source/package | IN_PROGRESS | false Agent/Session lifecycle replaced by a bounded internal queue and official no-tools LLM request; Budget accounting, redacted audit/retry, npm reconciliation, and installed/live proof remain |
| P058-024 | Three-target installed acceptance | Native/installed | BLOCKED_NATIVE | only after clean candidate from one source SHA |
| P058-025 | Formal 0.5.8 release/public readback | Public | NOT_STARTED | requires Owner publication authorization after all gates |
| P058-027 | Executable DSH migration census | Source/CI | DONE | ApiProxy, client-runtime, Workspace, and supervisor owner surfaces are machine-readable and composed into the preview gate |

## Protected facts during preview preparation

- `main` and its public bytes are untouched.
- `v0.5.7`, its ten assets, and existing release metadata are untouched.
- `release-contract.json` remains the 0.5.7 contract.
- all active product DSH dependency pins remain `0.1.1-rc.2`.
- no source checkout, Git URL, copied upstream build, or private tarball enters
  the Penglai package graph.
- no pull request, tag, package publish, Release, or website deployment is
  authorized by this ledger.

## Checkpoint policy

Push a checkpoint to `origin/0.5.8-preview` only when it is internally coherent,
has focused tests, passes the preview invariant, and does not include unrelated
owner work. Record the commit and CI result here after remote readback. Do not
use a partial broken push merely to create activity.

## Published checkpoints

| Commit | Scope | Remote verification |
| --- | --- | --- |
| `602f684b399e7ad7d0b11b3ccb1bf74342ff6832` | fixed DSH source baseline, migration/inventory ledgers, preview invariant and CI | branch readback PASS; [Source CI 33239599306](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33239599306) PASS |
| `759dc64667a5375dd0377e361592ebff3a5d1877` | contain Feishu asynchronous inbound failures with durable redacted terminal state | branch readback PASS; [Source CI 33239795129](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33239795129) PASS |
| `449d1f95718eea3d4d933cbfac76e66eb52f6e56` | remove WhatsApp active source, identity, dependency closure, and unsupported legacy activation | branch readback PASS; [Source CI 33240554668](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33240554668) PASS |
| `54cf32ccc0e497318d26699a75afd8a0d3af7e6a` | machine-readable DSH migration seam census and preview drift gate | branch readback PASS; [Source CI 33240938258](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33240938258) PASS |
| `8d7b2585f5c8ff357f2ef20ca54b66749ddb21b2` | make the Windows helper observe DSH child exit as well as desktop-owner stop | branch readback PASS; [Source CI 33241174183](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33241174183) PASS |
| `9da7e7677461ce118f29f72420c2b498a4b5abcc` | keep one live desktop supervisor and preserve its proxy-facing port across automatic restart | branch readback PASS; [Source CI 33241435767](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33241435767) PASS |
| `24f5854480afd7d7317e2d72b5f4e44008100c66` | gate the complete rc.2 overlay-to-alpha.1 slot disposition map and four explicit source gaps | branch readback PASS; [Source CI 33241802491](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33241802491) PASS |
| `6d559a2dfb049ed196e98f52b4fc459c4e163088` | detect a lost or hung DSH official-document route and recover through the existing bounded same-port supervisor | branch readback PASS; [Source CI 33242242970](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33242242970) PASS |
| `6ef566ace20fd9610a742287227aaec4c3fe49e2` | move Memory curator maintenance off false Agent/Session/subagent lifecycle into a bounded internal queue | branch readback PASS; [Source CI 33243163029](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33243163029) PASS |
| `4e8dc373b1fb49f2ba0c1ca9914d403f6c5eb808` | bound restart failure accounting and expose a non-stranding terminal recovery surface with redacted diagnostics | branch readback PASS; [Source CI 33244301234](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33244301234) PASS |
| `dd0afd9def6371abe5119867cc253a8ae5c6ff5d` | authenticate alpha-style DSH startup privately while preserving the rc.2 open-root path | branch readback PASS; [Source CI 33245579034](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33245579034) PASS |

## Publication reconciliation placeholder

When official packages appear, add one dated reconciliation section containing:

- package inventory and integrities;
- fixed-source equivalence result;
- generated artifact result;
- clean frozen-lock result;
- license/SBOM result;
- exact migration delta still required; and
- explicit decision to open or keep closed Gate P0.

This placeholder is not a monitor and is not evidence that publication occurred.
