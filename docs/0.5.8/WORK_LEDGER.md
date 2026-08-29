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
| P058-029 | Split Penglai bridge by official owner boundary | Source/design | DONE | Agent/Workspace/Session ports, rc.2 ApiProxy containment, Workspace-order plus Session-title join, create-title forwarding, and exact alpha source verifier pass; generated adapter remains P058-014 |
| P058-015 | Map all `dsh-client-runtime` consumers | Source/design | DONE | 8 plugin manifests and 8 packager rows are frozen; exact replacement graph remains P058-026 |
| P058-016 | Quarantine unsupported legacy channel rows | Source/upgrade | DONE | startup revokes unsupported route/binding activity without deleting audit rows; bot lists hide unsupported rows and reject new unknown filters |
| P058-026 | Implement narrow client package graph | Package/source | BLOCKED_NPM | published exports and generated artifacts required |
| P058-017 | Overlay-to-slot map | Source/design/CI | DONE | 12 mapped dispositions cover all 4 patched files and 5 brand assets; 4 narrow upstream gaps remain; executable gate PASS |
| P058-018 | One-time browser-token integration | Source/package/native | IN_PROGRESS | private exact-authority token exchange, cookie proof, proxy injection, rc.2 compatibility, redaction, and real child fixture pass in source; exact alpha package and native first navigation remain |
| P058-019 | Packaged DSH child supervision repair | Source/native | IN_PROGRESS | child/owner lifetimes, bounded hang/port-loss recovery, authenticated alpha-style health, structured diagnostics, exact exhaustion, and non-stranding actions pass locally; three-target native/installed proof remains |
| P058-028 | Isolated rc.2 → alpha.1 DSH Home generation | Source/package/native | IN_PROGRESS | private bounded copy, one-writer journal, disk/file-type/mode gates, health-bound atomic activation, rejection, rollback, and rc.2 JSONL replay pass in source; installed corpus, SQLite, Windows ACL, runtime wiring, and native rollback remain |
| P058-020 | Session title projection in IM | Package/source/UI/live | IN_PROGRESS | bridge, `/会话`, desktop chooser, and binding summary now share Workspace-order plus Session-owner titles; missing labels use localized ordinals while immutable IDs remain selection keys; generated alpha Remote and installed/Owner-live proof remain |
| P058-021 | Official image Attachment handoff | Package/live | BLOCKED_NPM | callback/download safety can proceed; final DSH admission needs packages |
| P058-022 | Feishu real media permission/download proof | Live | BLOCKED_OWNER_LIVE | perform only with privacy-safe Owner account evidence |
| P058-023 | Memory curator internal-job lifecycle | Source/package | IN_PROGRESS | false Agent/Session lifecycle, optional Budget accounting, one closed-transient retry, and bounded digest-only audit are fixed in source; npm reconciliation and installed/live proof remain |
| P058-030 | IM support truth model | Source/UI/package/live | IN_PROGRESS | one closed registry now separates entry, adapter mode, bundled runtime, dynamic connection, release evidence, and per-capability evidence; all current rows are source-only; packaged/installed/Owner-live/public reconciliation remains |
| P058-031 | Feishu media failure diagnostics | Source/live | IN_PROGRESS | request, stream, validation, admission, and transcription now persist closed redacted causes with retry class; exact checklist and durable text-only degradation are source-complete; Owner permission/download and end-to-end image/voice proof remain |
| P058-032 | Feishu durable voice phase ledger | Source/live | IN_PROGRESS | downloading, validation, transcoding, transcription, and atomic queued handoff are closed durable source states; legacy-processing and uncertain DSH write recovery pass locally; Owner voice, vendor download, live ASR, and official Turn proof remain |
| P058-033 | Feishu closed voice failure causes | Source/live | IN_PROGRESS | phase-owned codec, no-speech, duration, model readiness, backpressure, cancellation, deadline, and engine-unavailable causes pass locally without parsing error text; Owner-live proof remains |
| P058-034 | Typed ASR failure contract | Source/live | IN_PROGRESS | ASR service emits five closed operational causes consumed by Feishu; real model/worker/cancel and installed evidence remain |
| P058-035 | Feishu capability verification and text-only degradation | Source/live | IN_PROGRESS | exact text scopes/event/resource route/same-conversation checklist fails closed; resource request/stream failure durably degrades connection until a real non-empty download succeeds; Owner-live proof remains |
| P058-036 | Composer ASR state convergence and recording feedback | Source/native/live | IN_PROGRESS | typed status refresh plus localized permission/recording/timer/transcribing/result/no-speech/error phases and terminal track release pass in source; native microphone, installed locale, and real model proof remain |
| P058-037 | TTS cancellable lifecycle and timing boundaries | Source/native/live | IN_PROGRESS | preview and Read share typed synthesis cancellation plus latest-generation playback; localized queued/synthesizing/buffering/playing/ended/stopped/stalled/error states and source timing boundaries pass locally; streaming/prewarm and native first-sound budget remain |
| P058-038 | Shared IM connection modal | Source/UI/native/live | IN_PROGRESS | all eight platform-owned connection flows render in one labelled page-level modal with focus entry, Escape/Close, internal scrolling, adjacent status/QR/cancel/retry, and no nested dialog; native focus/screen-reader and live QR proof remain |
| P058-039 | Structured IM connection failures | Source/UI/live | IN_PROGRESS | native QR and guided adapter begin/poll failures persist and return one public code/message/action/reference; bounded response-shape failures map to CHANNEL_PROTOCOL and raw exception text is absent from the client; real redacted HTTP status/Content-Type and Owner-live reproduction remain |
| P058-040 | Penglai settings locale and error boundary | Source/UI/native | IN_PROGRESS | ASR/TTS model states plus recovery copy are bilingual; ASR, TTS, IM, Office, Memory Sources, Plugin Center, update, and uninstall no longer render caught exception/catalog error text; exact eight-channel copy passes; typed references, outage deduplication, official DSH labels, and installed readback remain |
| P058-041 | Truthful resource-pressure accounting | Source/UI/native | IN_PROGRESS | Plugin Center separates measured active/queued work and preserves unavailable/failed probes instead of false zero; DSH true subagents/tools/plugin and core Remote requests/open files plus native crash/cancel stress remain |
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
| `3663d2935a6ee653f68901d1df8ff20359613c50` | isolate rc.2-to-alpha.1 DSH Home generation, validation, activation, rejection, and rollback | branch readback PASS; [Source CI 33246379795](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33246379795) PASS |
| `386f368555f64684154e8f38491822541ea227c4` | split bridge composition into Agent, Workspace, and Session owner ports with an rc.2 adapter boundary | branch readback PASS; [Source CI 33246964498](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33246964498) PASS |
| `65a90a7f48429381021cddebda8846d6ee099e2f` | complete Memory Budget reservation/settlement/release and bounded digest-only curator audit, then correct checkpoint identity | branch readback PASS; [Source CI 33247879601](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33247879601) PASS |
| `6d593bc60a827ff9382b6792ffd8ab04cb8347af` | replace ambiguous IM support booleans with separate entry, adapter, bundle, connection, release, and capability evidence across all eight channels | branch readback PASS; [Source CI 33248585975](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33248585975) PASS |
| `1605e58080ff86392111e52cdf00571cbd2f8b84` | record the verified IM support-truth checkpoint in the preview work ledger | branch readback PASS; [Source CI 33248718019](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33248718019) PASS |
| `28e3483f658fb2233ef40b0c9bf7f01f52801135` | preserve closed redacted Feishu media failure phases and causes with retry classification | branch readback PASS; [Source CI 33249032154](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33249032154) PASS |
| `9e9a471f030ec26925b2bb4655f71d7d63ecfe34` | persist closed Feishu voice phases and preserve atomic queued recovery across uncertain DSH handoff | branch readback PASS; [Source CI 33249500231](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33249500231) PASS |
| `ae16e12c955a3f1631dc0c67c54174e52812127e` | record the verified durable Feishu voice phase checkpoint in the preview work ledger | branch readback PASS; [Source CI 33249619124](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33249619124) PASS |
| `16c746b4dffd8a6273a22cb6237c3429e4de52c5` | classify phase-owned Feishu voice codec, no-speech, and closed ASR model-readiness failures without parsing error text | branch readback PASS; [Source CI 33250043373](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33250043373) PASS |
| `307dab5655b52e10a4db2ae0fbc1f2cd22770877` | expose closed ASR operational failures and persist invalid Feishu voice duration without parsing error text | branch readback PASS; [Source CI 33250448312](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33250448312) PASS |
| `3c3894ab66871243a35db124f2ac95d831a81d97` | record the verified typed ASR checkpoint in the preview work ledger | branch readback PASS; [Source CI 33250582236](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33250582236) PASS |
| `b92e84400685a42cda34b8257509a9f2ff451a45` | expose exact Feishu resource capability verification and durable text-only degradation | branch readback PASS; [Source CI 33251000091](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33251000091) PASS |
| `e707018d01aa3f46f3fcda0dccbd3cf3cc825278` | expose localized composer ASR phases, typed model convergence, and terminal microphone-track release | branch readback PASS; [Source CI 33251525002](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33251525002) PASS |
| `cc8e54502d3e803307ea5cba70faaeb49ed5730c` | make TTS preview and Read synthesis cancellable with closed playback states and source timing boundaries | branch readback PASS; [Source CI 33252194016](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33252194016) PASS |
| `0de7a9e8d4a52608afea31117ed8313951536fd1` | focus all eight platform-owned connection flows in one shared page-level modal | branch readback PASS; [Source CI 33252521644](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33252521644) PASS |
| `27823d7cbb0111d5bf9a0b7f6e0627fbfb9ef258` | return one durable structured connection failure to the IM modal without exposing transport internals | branch readback PASS; [Source CI 33253126999](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33253126999) PASS |
| `592b066bd175f7139393a24639f956c9eadbf4dd` | project official Session titles into IM chat and desktop choosers without exposing ID fallbacks | branch readback PASS; [Source CI 33253572361](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33253572361) PASS |
| `bad28348193e0ef13e85cfe98c6519ca6b379226` | contain Penglai-owned settings errors behind localized recovery copy and correct the eight-channel Plugin Center statement | branch readback PASS; [Source CI 33254031693](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33254031693) PASS |

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
