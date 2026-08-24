# Penglai 0.5.6 implementation ledger

Working ledger, not a public PASS claim. Evidence classes: A architecture, S source, C contract, N native, I installed, L live, P public, D docs, F fuzz.

Status values: `not-started` / `in-progress` / `source-pass` / `native-pass` / `installed-pass` / `live-pass` / `public-pass` / `blocked`.

Baseline HEAD: `d1f61ef61eb3d86f33a4d7e1c05a2137b36c7b22` (`main` / `v0.5.5`). Working branch: `feat/0.5.6` local only.

## Owner decisions

| ID | Decision | Status |
|---|---|---|
| OD-FILE | Wait for DSH generic-file API, or shrink 0.5.6 so composer files are not claimed | OPEN; spike BLOCKED |
| OD-CURATOR-SCHEMA | Accept host JSON validation, or wait for provider `json_schema` | OPEN; recommend host validation |
| OD-IM-SCOPE | Keep nine platforms or shrink after a legal/account gap | OPEN; not yet reached |
| OD-PUBLISH | Push / PR / tag / Release / site / real IM | CLOSED: forbidden unless Owner later authorizes |

## Phase 0 close

| Item | Result | Evidence |
|---|---|---|
| Repo identity | origin is `kevinchennewbee/PenglaiAgent` | `docs/0.5.6/BASELINE.md` |
| ADR Owner Broker | Accepted | `docs/adr/0034-owner-approval-broker.md` |
| ADR Artifact | Accepted | `docs/adr/0035-artifact-service.md` |
| ADR Memory | Accepted | `docs/adr/0036-memory-candidate-recall.md` |
| ADR IM Registry | Accepted | `docs/adr/0037-im-registry-multibot.md` |
| ADR Update identity | Accepted | `docs/adr/0038-update-manifest-identity.md` |
| File intake spike | BLOCKED | `packages/dsh-bridge/src/r56-file-intake-spike.ts` |
| Memory curator spike | PARTIAL | `packages/dsh-bridge/src/r56-memory-curator-spike.ts` |

Missing evidence for Phase 0: N/I/L/P = NOT RUN. A/S/C for the two spikes = source/contract only.

## R56 register

### Core / Owner

| ID | Status | Source | Tests | Missing evidence |
|---|---|---|---|---|
| R56-CORE-001 | not-started | official DSH remains only core | existing R55 DSH tests | I |
| R56-CORE-002 | source-pass | `packages/release-identity/src/pins.ts` | `packages/dsh-bridge/src/capability-baseline.test.ts` | P |
| R56-CORE-003 | source-pass | `packages/runtime/src/inventory-proof.ts` | `inventory-proof.test.ts` | I |
| R56-CORE-004 | source-pass | exactPluginId; no substring includes | `inventory-proof.test.ts` | I |
| R56-CORE-005 | source-pass | `refuseRequiredPluginDisable`; remotes disable before catalog lookup | `inventory-proof.test.ts`; `remotes-security.test.ts` | I |
| R56-CORE-006 | not-started | desktop splash | | N,I |
| R56-CORE-007 | not-started | dsh supervisor | | C,N,I |
| R56-CORE-008 | not-started | supervisor intent | | C,N |
| R56-CORE-009 | not-started | recovery page | | N,I |
| R56-CORE-010 | not-started | dsh-bridge cancel | | S,C,N |
| R56-OWN-001 | source-pass | broker + office HMAC/broker adapter | `owner-broker.test.ts`; `owner-adapter.test.ts`; `tools.test.ts` | I; native dialog N |
| R56-OWN-002 | not-started | Memory accept/personal/correct/forget | | C,I |
| R56-OWN-003 | source-pass | disable/rollback grants; Center client uses `confirmPluginAction` | `plugin-owner.test.ts`; `remotes-security.test.ts` | I |
| R56-OWN-004 | not-started | IM bind | | C,I,L |
| R56-OWN-005 | source-pass | deny/expiry/replay/mutation/workspace drift | `owner-broker.test.ts`; `owner-adapter.test.ts` | I |
| R56-OWN-006 | source-pass | broker dialog port never calls DSH `ask` | `owner-broker.test.ts` | I; policy=never installed |
| R56-OWN-007 | source-pass | Main `requestOwnerApproval` IPC + HMAC | `owner-broker.test.ts`; `electron-main.ts` | N dialog click |
| R56-OWN-008 | source-pass | destination labels refuse paths/secrets; honest notice | `owner-broker.test.ts` | I,D user docs |

### Security / Office

| ID | Status | Source | Tests | Missing evidence |
|---|---|---|---|---|
| R56-SEC-001 | source-pass | `packages/runtime/src/generation-migrate.ts` | `generation-migrate.test.ts` | I |
| R56-SEC-002 | source-pass | historical backup secret cleanup | `generation-migrate.test.ts` | I; Owner restore not auto-applied |
| R56-SEC-003 | source-pass | `packages/runtime/src/private-mode.ts` | `private-mode.test.ts` | N |
| R56-SEC-004 | not-started | Windows ACL | | N,I |
| R56-SEC-005 | source-pass | `packages/contracts/src/bounded-http.ts` | `bounded-http.test.ts`; IM/registry reuse | I |
| R56-SEC-006 | source-pass | `packages/plugin-registry/src/archive-policy.ts` | `registry.test.ts` | I |
| R56-SEC-007 | source-pass | `scripts/lib/secret-scan.mjs` | `secret-scan.test.mjs` | I |
| R56-SEC-008 | source-pass | report is rule/file/line/category only | `secret-scan.test.mjs` | I |
| R56-SEC-009 | source-pass | `packages/contracts/src/closed-enum.ts`; persistence maps | `closed-enum.test.ts`; `persistence.test.ts` | I |
| R56-SEC-010 | source-pass | `packages/channel-feishu/src/index.ts` | `feishu.test.ts` | L |
| R56-SEC-011 | source-pass | Weixin receive loop degrades without throwing | `weixin.test.ts` | L |
| R56-SEC-012 | source-pass | `Store.redactExpiredPayloads`; IM host on construct | `persistence.test.ts` | N,I; WAL/backup historical copies remain |
| R56-SEC-013 | source-pass | `assertSha256` in `sendFileToBoundRoute` | `closed-enum.test.ts`; `im.test.ts` | I |
| R56-SEC-014 | source-pass | catalog sequence floor 6; revocation severity already closed | `registry.test.ts` | I |
| R56-SEC-015 | source-pass | `assertHonestTrustCopy` refuses isolated-plugin claims | `contracts.test.ts` | I |
| R56-OFF-001 | source-pass | `packages/office/src/zip.ts` EOCD/central first | `zip.test.ts` | F |
| R56-OFF-002 | source-pass | stream inflate caps, CRC/size/ratio fail closed | `zip.test.ts` | F |
| R56-OFF-003 | source-pass | `OfficeJobStore` concurrent/retain/TTL/wipe | `jobs.test.ts` | N |
| R56-OFF-004 | source-pass | backup name = operation+revision+digest | `jobs.test.ts` | I |
| R56-OFF-005 | source-pass | preview digest frozen; commit/export check | `jobs.test.ts` | I |
| R56-OFF-006 | source-pass | dest bound after first commit; tools refuse model paths | `jobs.test.ts`; `tools.test.ts` | |

### Voice

| ID | Status | Source | Tests | Missing evidence |
|---|---|---|---|---|
| R56-VOICE-001 | source-pass | shared `createAudioPlaybackController` | `playback-controller.test.ts`; `settings-ui.test.ts` | I/L three-target audio |
| R56-VOICE-002 | source-pass | preview and read use the same controller | `dsh-client.js`; `settings-ui.test.ts` | I/L |
| R56-VOICE-003 | source-pass | await `audio.play()`, generation, revoke on end/error | `playback-controller.ts` | I |
| R56-VOICE-004 | source-pass | `beginMicrophoneRequest` nonce; audio-only media | `microphone-grant.ts` | I/L system permission |
| R56-VOICE-005 | source-pass | ASR calls nonce before `getUserMedia({ audio: true })` | `settings-ui.test.ts` | I |
| R56-VOICE-006 | source-pass | camera/video/unknown mediaTypes denied | `microphone-grant.test.ts` | N Electron details |
| R56-VOICE-007 | source-pass | read button says original text, not translation | `dsh-client.js` | I |
| R56-VOICE-008 .. 014 | not-started | installed/live audio matrix | | I/L |

### Memory

| ID | Status | Source | Tests | Missing evidence |
|---|---|---|---|---|
| R56-MEM-001 | not-started | memory UI | | I |
| R56-MEM-002 | not-started | modes | | S,C,I |
| R56-MEM-003 | not-started | personal receipt | | C,I |
| R56-MEM-004 | not-started | turn queue | | S,C,L |
| R56-MEM-005 | source-pass | `packages/dsh-bridge/src/r56-memory-curator-spike.ts` | `r56-memory-curator-spike.test.ts` | C live Agent, L |
| R56-MEM-006 | not-started | fail open | spike failOpen helper only | C,I,L |
| R56-MEM-007 | not-started | governance | | S,C |
| R56-MEM-008 | not-started | injection | | S,C |
| R56-MEM-009 | not-started | candidate isolation | | S,C,L |
| R56-MEM-010 | not-started | workspace isolation | existing R55 tests | L |
| R56-MEM-011 | not-started | recall set | | S,C,L |
| R56-MEM-012 | not-started | 20/2048 | | S,C |
| R56-MEM-013 | not-started | N-used UI | | I,L |
| R56-MEM-014 | not-started | conflict | | S,C,L |
| R56-MEM-015 | not-started | negative ledger | | S,C |
| R56-MEM-016 | not-started | real list/count | `memory/src/index.ts` list() currently throws | S,C,I |
| R56-MEM-017 | not-started | 0.5.5 migrate | | C,I |
| R56-MEM-018 | not-started | forget GC | | S,C,I |
| R56-MEM-019 | not-started | four object kinds | | S,C |
| R56-MEM-020 | not-started | fail open turn | | C,I,L |

### File / Artifact

| ID | Status | Source | Tests | Missing evidence |
|---|---|---|---|---|
| R56-FILE-001 | blocked | no official file Turn API | `r56-file-intake-spike.test.ts` | I blocked |
| R56-FILE-002 | blocked | same | same | I,L |
| R56-FILE-003 | source-pass | `@penglai/artifacts` ArtifactRef, no path | `packages/artifacts/src/service.test.ts` | I |
| R56-FILE-004 | source-pass | bytes/path intake → hash/magic/admit/CAS | `service.test.ts` | I picker/drag-drop |
| R56-FILE-005 | source-pass | O_NOFOLLOW; refuse symlink/device/dir | `service.test.ts` | |
| R56-FILE-006 | source-pass | extension/magic mismatch | `service.test.ts` | |
| R56-FILE-007 | source-pass | 8 MiB / 5 files / 24 MiB turn caps | `service.test.ts` | I |
| R56-FILE-008 | source-pass | macro/encrypt/exe/nested archive | `service.test.ts` | I |
| R56-FILE-009 | not-started | installed controlled read of admit list | | I,L |
| R56-FILE-010 | not-started | DSH native images unchanged | | C,I |
| R56-FILE-011 | source-pass | turn TTL 24h; GC CAS/index/staging | `service.test.ts` | I |
| R56-FILE-012 | source-pass | persist workspace/memory-source needs actionId | `service.test.ts` | I |
| R56-FILE-013 | source-pass | workspace/session mismatch cannot read | `service.test.ts` | I |
| R56-FILE-014 | not-started | disabled Office still shows old Turn refs | | C,I |
| R56-FILE-015 | not-started | filename/type/size/scope UI | | I |
| R56-FILE-016 | blocked | `bindComposerTurn` throws `DSH_NO_GENERIC_FILE_TURN_API` | spike + `service.test.ts` | A complete; composer GO false |

FILE-003..015 may proceed for Office/IM ArtifactRef. Composer send stays blocked.

### IM / Channels / Update / Dist

| ID | Status | Missing evidence |
|---|---|---|
| R56-IM-001 .. 020 | not-started | S/C now; I/L later |
| R56-CH-WX | not-started | L |
| R56-CH-FS | not-started | L |
| R56-CH-DT | not-started | L |
| R56-CH-WC | not-started | L |
| R56-CH-QQ | not-started | L |
| R56-CH-SL | not-started | L |
| R56-CH-TG | not-started | L |
| R56-CH-DC | not-started | L |
| R56-CH-WA | not-started | L; default off |
| R56-UPD-001 | not-started | S,C |
| R56-UPD-002 | not-started | S,C |
| R56-UPD-003 | not-started | I,L |
| R56-UPD-004 | not-started | I,L |
| R56-UPD-005 | not-started | N,I |
| R56-UPD-006 | not-started | I |
| R56-UPD-007 | not-started | I |
| R56-DIST-001 | not-started | N,P |
| R56-DIST-002 | not-started | I,L Apple Silicon |
| R56-DIST-003 | not-started | I,L Intel |
| R56-DIST-004 | not-started | I,L Windows |
| R56-DIST-005 | not-started | C,P; 12-asset contract is Phase 11 |
| R56-DIST-006 | not-started | S,C,P |
| R56-DIST-007 | not-started | C,P |
| R56-DIST-008 | not-started | P |
| R56-DIST-009 | not-started | P |
| R56-DIST-010 | not-started | P |
| R56-DIST-011 | not-started | P |
| R56-DIST-012 | not-started | L,P |

## Migrations / rollback

None in Phase 0. Schema work starts with Phase 1 backups and Phase 2 broker store.

## Next

Voice 2.0 playback controller and microphone nonce are source-pass. Live three-target audio remains I/L. Next local capability: Memory 2.0 list/candidates/governance. Do not bump product version. Do not publish.
