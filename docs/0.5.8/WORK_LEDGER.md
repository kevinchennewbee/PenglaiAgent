# Penglai 0.5.8 preview work ledger

> Branch: `0.5.8-preview`. Updated: 2026-08-30. A completed source row is not a
> package, native, installed, live, or public-release pass.

## State vocabulary

- `DONE`: source work and its stated source checks are complete.
- `IN_PROGRESS`: implementation has started; no completion claim.
- `READY`: evidence and ownership permit work now.
- `READY_SOURCE_CLOSURE`: fixed source is sufficient; execute the reproducible
  local tarball closure before product integration.
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
| P058-005 | Split source and package gates | Governance | DONE | complete local source closure is the package authority; official npm is neither required nor impersonated |
| P058-006 | Upstream-to-Penglai migration matrix | Source/design | DONE | direct consumers and acceptance gates assigned; refine during implementation |
| P058-007 | Repository asset classification | Source/design/CI | DONE | primary DSH, release, WhatsApp, independent-fix assets, high-risk identity copies, and all 61 verifier/operator scripts have executable classifications and invocation ownership |
| P058-008 | Preview invariant verifier | Source/CI | DONE | integrated gate protects immutable 0.5.7 history and requires the exact alpha source dependency closure |
| P058-009 | Enable Source CI on preview branch | Source/CI | DONE | first preview Source CI PASS on `602f684b`; no main workflow run or release action |
| P058-010 | Remove WhatsApp active source and identity | Source | DONE | package, adapter, channel/route identity, credential, risk-owner Remote, UI card/copy, tests, and workspace references removed; historical 0.5.7 surfaces preserved |
| P058-011 | Remove WhatsApp dependency/lock/license closure | Package-source | DONE | frozen install PASS with 34 workspaces; lock/SBOM/notices/plugin staging contain none of four retired runtime identities |
| P058-012 | Contain Feishu asynchronous media callback failures | Source | DONE | callback stays bounded; rejection resolves to redacted durable terminal state; focused tests PASS |
| P058-013 | Map all ApiProxy callers to owner Remotes | Source/design | DONE | 9 operational/support references and exact create/modelCatalog/selectModel ownership are frozen by the executable census |
| P058-014 | Implement owner Remote migration | Package/source | DONE | active bridge uses alpha SessionController, Agent and Workspace owners; rc.2 ApiProxy remains historical-only; focused migration tests PASS |
| P058-029 | Split Penglai bridge by official owner boundary | Source/design | DONE | Agent/Workspace/Session ports, rc.2 ApiProxy containment, Workspace-order plus Session-title join, create-title forwarding, and exact alpha source verifier pass; generated adapter remains P058-014 |
| P058-015 | Map all `dsh-client-runtime` consumers | Source/design | DONE | 8 plugin manifests and 8 packager rows are frozen; exact replacement graph remains P058-026 |
| P058-016 | Quarantine unsupported legacy channel rows | Source/upgrade | DONE | startup revokes unsupported route/binding activity without deleting audit rows; bot lists hide unsupported rows and reject new unknown filters |
| P058-026 | Implement narrow client package graph | Package/source | DONE | all eight plugin manifests and packed descriptors use audited alpha Remotes, settings and slot packages; no active client-runtime injection remains |
| P058-017 | Overlay-to-slot map | Source/design/CI | DONE | 12 mapped dispositions cover all 4 patched files and 5 brand assets; 4 narrow upstream gaps remain; executable gate PASS |
| P058-018 | One-time browser-token integration | Source/package/native | IN_PROGRESS | private token exchange, proxy injection, HTTP/WebSocket and exact from-installer first navigation pass on local Apple Silicon; Intel and Windows native readback remain |
| P058-019 | Packaged DSH child supervision repair | Source/package/native | IN_PROGRESS | source-built embedded alpha CLI, closure and fresh profile pass after preserving 20 package-local dependency conflicts; three-target native/installed process proof remains |
| P058-028 | Isolated rc.2 → alpha.1 DSH Home generation | Source/package/native | IN_PROGRESS | private bounded copy, one-writer journal, disk/file-type/mode gates, health-bound atomic activation, rejection, rollback, and rc.2 JSONL replay pass in source; installed corpus, SQLite, Windows ACL, runtime wiring, and native rollback remain |
| P058-020 | Session title projection in IM | Package/source/UI/live | IN_PROGRESS | bridge, `/会话`, desktop chooser, and binding summary now share Workspace-order plus Session-owner titles; missing labels use localized ordinals while immutable IDs remain selection keys; generated alpha Remote and installed/Owner-live proof remain |
| P058-021 | Official image Attachment handoff | Package/live | READY_SOURCE_CLOSURE | callback/download safety is source-complete; bind final DSH admission after local alpha.1 closure integration |
| P058-022 | Feishu real media permission/download proof | Live | BLOCKED_OWNER_LIVE | perform only with privacy-safe Owner account evidence |
| P058-023 | Memory curator internal-job lifecycle | Source/package | IN_PROGRESS | alpha source-closure integration, false Agent/Session removal, Budget accounting, retry and digest-only audit pass; installed/live proof remains |
| P058-030 | IM support truth model | Source/UI/package/live | IN_PROGRESS | one closed registry now separates entry, adapter mode, bundled runtime, dynamic connection, release evidence, and per-capability evidence; all current rows are source-only; packaged/installed/Owner-live/public reconciliation remains |
| P058-031 | Feishu media failure diagnostics | Source/live | IN_PROGRESS | request, stream, validation, admission, and transcription now persist closed redacted causes with retry class; exact checklist and durable text-only degradation are source-complete; Owner permission/download and end-to-end image/voice proof remain |
| P058-032 | Feishu durable voice phase ledger | Source/live | IN_PROGRESS | downloading, validation, transcoding, transcription, and atomic queued handoff are closed durable source states; legacy-processing and uncertain DSH write recovery pass locally; Owner voice, vendor download, live ASR, and official Turn proof remain |
| P058-033 | Feishu closed voice failure causes | Source/live | IN_PROGRESS | phase-owned codec, no-speech, duration, model readiness, backpressure, cancellation, deadline, and engine-unavailable causes pass locally without parsing error text; Owner-live proof remains |
| P058-034 | Typed ASR failure contract | Source/live | IN_PROGRESS | ASR service emits five closed operational causes consumed by Feishu; real model/worker/cancel and installed evidence remain |
| P058-035 | Feishu capability verification and text-only degradation | Source/live | IN_PROGRESS | exact text scopes/event/resource route/same-conversation checklist fails closed; resource request/stream failure durably degrades connection until a real non-empty download succeeds; Owner-live proof remains |
| P058-036 | Composer ASR state convergence and recording feedback | Source/native/live | IN_PROGRESS | typed status refresh plus localized permission/recording/timer/transcribing/result/no-speech/error phases and terminal track release pass in source; native microphone, installed locale, and real model proof remain |
| P058-037 | TTS cancellable lifecycle and timing boundaries | Source/native/live | IN_PROGRESS | preview and Read share typed cancellation and latest-generation playback; the verified MOSS runtime now prewarms once after model activation with cold-start fallback and clean failure retry; complete-WAV streaming and native first-sound budget/proof remain |
| P058-038 | Shared IM connection modal | Source/UI/native/live | IN_PROGRESS | all eight platform-owned connection flows render in one labelled page-level modal with focus entry, Escape/Close, internal scrolling, adjacent status/QR/cancel/retry, and no nested dialog; native focus/screen-reader and live QR proof remain |
| P058-039 | Structured IM connection failures | Source/UI/live | IN_PROGRESS | native QR and guided adapter begin/poll failures persist one public code/message/action/reference; Weixin response failures also persist only a closed phase, validated status, and normalized parameter-free media type while typed auth/rate/protocol/delivery classification avoids message parsing; a default-collapsed Advanced section revalidates and reads back that safe observation as explicitly non-causal; restart readback rejects invalid codes/references and reconstructs fixed copy/actions instead of trusting stored text; real Owner-live reproduction remains |
| P058-040 | Penglai settings locale and error boundary | Source/UI/native | IN_PROGRESS | settings no longer render caught exception/catalog text; Plugin Center transactions, ASR/TTS model failures, IM connection failures, and retained core recovery diagnostics expose stable bounded references without leaking private operation identity, exceptions, paths, URLs, or unsafe environment metadata; authoritative outage deduplication, remaining lifecycle references, official DSH labels, and installed readback remain |
| P058-041 | Truthful resource-pressure accounting | Source/UI/native | IN_PROGRESS | ASR 1+7, TTS 1+3, and Memory 1+7 are one executable source/UI job-budget contract; closed within/at/over/unavailable states make an actual breach an alert instead of visible arithmetic; DSH true subagents/tools/plugin and core Remote requests/open files plus native crash/cancel stress remain |
| P058-042 | First causal supervisor diagnostic retention | Source/native | IN_PROGRESS | desktop recovery keeps the first classified process/health trigger over later startup/gateway noise, revalidates logged/copied metadata, and exposes one stable non-causal `CORE-` reference on the recovery page; installed/native crash correlation remains |
| P058-043 | Closed plugin activation diagnostics | Source/UI/package/native | IN_PROGRESS | transaction journal retains bounded closed inventory transitions plus activation/rollback readback and six localized failure causes; alpha event subscription, client-fiber/loader fields, packaged Companion and native proof remain |
| P058-044 | Authoritative release identity copy verification | Source/CI | DONE | version verifier reads the sole `pins.ts` authority and checks all workspace manifests plus release-info product/toolchain/DSH/schema/publication/three-target copies; duplicate authorities fail closed |
| P058-045 | Executable verifier evidence-plane map | Source/design/CI | DONE | 61 source/package/native/installed/Owner-live/public/aggregate/historical scripts are exhaustively mapped to invocation and preview policy; census drift and evidence-plane promotion fail the preview gate |
| P058-046 | Fixed-source local package closure | Source/package-supply | DONE | official profile build PASS; 9 vendor + 241 DSH + 1 Landlock entry tarballs; 251-package clean install and CLI version readback PASS; every promoted byte, identity, version, size, SHA-256, and license is gated |
| P058-047 | Canonical source replay and content-addressed lock | Source/package/CI | IN_PROGRESS | native run `33297379518` proved two macOS 15 builds agree but exposed host-zlib drift against the promoted bytes; all 251 unpacked raw tar payloads were identical, so gzip is now normalized by pinned pure-JavaScript `fflate@0.8.3`; cross-host canonicalization, local promoted replay, lock reseal, and 808 unit tests pass; replacement Source/native CI remains |
| P058-049 | Cross-platform clean public export | Source/CI/native | IN_PROGRESS | Windows run `33299433051` reached the clean export but exceeded the host command-line limit while passing the full allowlist to one `git archive`; tracked paths are now partitioned into bounded archive commands with exact-order and completeness tests; replacement Windows-native CI remains |
| P058-048 | Distribution-owned document title | Source/UI/native | IN_PROGRESS | official DSH packages retain their upstream title while the Penglai preload owns the document title; local Apple Silicon installed welcome/plugin walks observe `蓬莱 Penglai`; Intel and Windows remain |
| P058-024 | Three-target installed acceptance | Native/installed | IN_PROGRESS | local ad-hoc Apple Silicon DMG `b753025c…` passes artifact/runtime/fuses/signing-state/welcome/plugin restart walks with zero leftovers; it is not notarized or release evidence; Intel, Windows, and final main workflow remain |
| P058-025 | Formal 0.5.8 release/public readback | Public | NOT_STARTED | Owner authorization is recorded; execute only after all preceding source, package, native, installed, and live gates pass |
| P058-027 | Executable DSH migration census | Source/CI | DONE | ApiProxy, client-runtime, Workspace, and supervisor owner surfaces are machine-readable and composed into the preview gate |

## Protected facts during preview preparation

- `main` and its public bytes are untouched.
- `v0.5.7`, its ten assets, and existing release metadata are untouched.
- `release-contract.json`, `release-info.json`, manifests and lockfile now form
  the coherent 0.5.8 preview identity; published 0.5.7 contracts and bytes stay
  immutable in their tag and historical documents.
- all active product DSH dependency pins are `0.1.2-alpha.1` and resolve only
  through the audited local source closure.
- no source checkout, Git URL, copied upstream build, partial tarball set, or
  registry fallback enters the Penglai package graph; only the verified complete
  local source closure may replace rc.2 atomically.
- the Owner authorized the complete PR, merge, three-target release, public
  readback, README, bilingual website, release notes, and repository metadata
  flow; none may execute before its preceding hard gates pass.

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
| `260a9b91a48f4a480ec81a2d28654724127fe1aa` | separate exact active/queued plugin work from unavailable DSH runtime pressure evidence without false-zero or probe-failure collapse | branch readback PASS; [Source CI 33254700943](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33254700943) PASS |
| `c3e840edb2a78627c880395b5cbdb646de08fb90` | retain the first classified supervisor process/health diagnostic over later startup or gateway noise | branch readback PASS; [Source CI 33255031669](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33255031669) PASS |
| `3d4e59119784dee47d8a82f89760a1198cf257b9` | enforce one shared ASR/TTS/Memory job-budget matrix in service admission and truthful Plugin Center diagnostics | branch readback PASS; [Source CI 33255578522](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33255578522) PASS |
| `ce79b77047757222c8ea8c1e4eb5a51bfe5d3681` | retain bounded closed plugin activation/rollback diagnostics and bilingual recovery guidance without exposing raw loader failures | branch readback PASS; [Source CI 33256221327](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33256221327) PASS |
| `6eca4378d2d5495e7175c38f785551d40e556d0f` | classify measured plugin job pressure as within, at, over, unbudgeted, or unavailable and alert on a real contract breach | branch readback PASS; [Source CI 33256561898](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33256561898) PASS |
| `a778f707277043361a248383824810c7fdbd3c47` | derive high-risk workspace and release-info identity verification from the sole release pin authority | branch readback PASS; [Source CI 33256880803](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33256880803) PASS |
| `6ff406f7cb3c0a49d777abe986763f5a1e35f230` | classify all 59 verifier and operator scripts by exact evidence plane, preview policy, and invocation ownership | branch readback PASS; [Source CI 33257154372](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33257154372) PASS |
| `32af8c8992ae1ab047cf3848de3682cef06d6b02` | invoke the verified MOSS runtime warmup after model activation, retain cold-start fallback, and discard failed engines for clean retry | branch readback PASS; [Source CI 33257596041](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33257596041) PASS |
| `2753ed0cd2d4ca6e81fa52a6a1b40a1bc0af4215` | expose a stable one-way Plugin Center transaction reference beside closed activation/rollback failure diagnostics | branch readback PASS; [Source CI 33257820641](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33257820641) PASS |
| `43933e65cb872117d530c1651bcb2df99d11d1dc` | persist stable redacted ASR/TTS model-failure references across restart and reject unknown TTS ledger error classes | branch readback PASS; [Source CI 33258325107](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33258325107) PASS |
| `665dc702bf9a08772529d0724859b7fe708ecf77` | persist closed redacted Weixin iLink response evidence and typed transport classification without retaining response bodies, URLs, headers, or MIME parameters | branch readback PASS; [Source CI 33258909346](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33258909346) PASS |
| `b9fd937aabea9662999f85cf3224b950c687562b` | expose the persisted safe transport observation only in default-collapsed Advanced diagnostics with client-side closed-shape validation and an explicit non-root-cause label | branch readback PASS; [Source CI 33259192818](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33259192818) PASS |
| `feec1c32773807d63adf39aa749d9c00633c19cd` | reject malformed persisted IM failure identity, reconstruct fixed copy/actions on readback, and confine iLink observations to Weixin rows | branch readback PASS; [Source CI 33259435231](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33259435231) PASS |
| `db1efb8e9cb9fc1146052c91c9827257b23b4d01` | vendor the deterministic 251-package DSH alpha source closure without upstream patches or npm impersonation | branch readback PASS; [Source CI 33290409118](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33290409118) PASS |
| `d773193ce179b2b14fd3496781f1e4a63c7b392b` | canonicalize the DSH source build path, content-address the same-version local lock, and keep product title ownership in the desktop distribution | branch readback PASS; [Source CI 33295533757](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33295533757) PASS |

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
