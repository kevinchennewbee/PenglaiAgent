# Penglai 0.6.0 acceptance delta

This delta is for Penglai **0.6.0**. It does not replace
`docs/0.5.12/ACCEPTANCE_DELTA.md`, `docs/0.5.11/ACCEPTANCE_DELTA.md`, or
`docs/0.5.10/ACCEPTANCE_DELTA.md`. Published **v0.5.10**, **v0.5.11**, and
**v0.5.12** tags and assets stay immutable.

Owner authorization: 2026-09-09. Codex is PM and GUI acceptance operator.
Grok 4.6 xhigh owns implementation and technical review. This supersedes
the previous no-new-release boundary and the UOS exclusion **for 0.6.0
only**.

Public README/website download tables remain **0.5.12** until immutable
`v0.6.0` GitHub Release bytes exist and are read back.

## In scope

- Official DSH successor freeze: complete npm `0.1.5-alpha.1` with exact
  registry integrity. Package count is discovered from the actual graph.
  Mixed DSH generations are forbidden.
- Session log V3: upgrade supported historical sessions into new log files
  while **preserving originals**. Downgrade reads are not supported.
  Never silently discard existing sessions or Home state.
- Plugin Agent API: `ctx.agent` removed; callers pass Agent explicitly.
  Inbox is a type-only interface (`agent.inbox`). Re-evidence RemoteError,
  session projections, Home generation, connection lifecycle, and every
  first-party plugin.
- DSH IM `@xmanrui/dsh-im@4.17.1` inspect and **faithful** integration
  into `@penglai/im`. Do not install the dsh-im runtime, `cordis.patch.yml`,
  WhatsApp, or a second Office as Penglai product surface.
- Repair of reproduced 0.5.12 live defects: custom-model image
  `inputModalities` via official DeepSeek settings; AUTH 401 classified
  as `UNAUTHORIZED` for wizard `errorAuth`; stale workspace error cleared
  on path/id change. No model-id regex exceptions.
- Four actual installer targets from one clean `main` SHA: Apple Silicon,
  Intel Mac, Windows x64, and Loongson UnionTech UOS 20 Professional 1070
  (`linux-loong64`, kernel 4.19.0-loongson-3-desktop, old-world; not V25).
  A feasibility note, another platform, or a missing `.deb` is not the
  UOS deliverable.
- **UOS 20 native install, startup, and functional acceptance** are
  Owner post-publication testing (Owner, 2026-09-09). They are **not**
  pre-publication blockers and must be labeled `OWNER_POST_RELEASE`,
  never PASS. Do not request remote access or require native execution
  evidence before publication. Pre-publication still requires the actual
  `Penglai_0.6.0_uos_loong64.deb` with architecture/ABI/dependency/
  packaging/closure checks, honest Chromium/Node generation disclosure,
  and no sandbox weakening. Mac/Windows retain their existing native
  gates.
- Linux desktop packaging class: layout, `.deb`, desktop integration,
  storage, secrets, updates, uninstall, runtime closure, and mandatory
  Office/Memory semantics. Do not disable required plugins or sandbox
  to show a window. No unsolicited OS upgrade and no second Agent core.
  `node-addon-require-builtin` is official optional internals probing,
  not a required loong64 native. Do not invent
  `node-addon-require-builtin-linux-loong64-gnu`. Product web profile
  uses official `patchReload: startup`. Flock, pty, koffi, and sharp
  remain required native capability.
- Deterministic source gates. Owner excludes the two-hour installed soak.
  `test:soak` remains required.
- Exact asset set updated for four installers, then sealed from one clean
  `main` SHA. Both public sites EN then ZH, desktop/mobile/reduced-motion,
  version links read back against exact public bytes.

## Out of scope until separately evidenced

- Rewriting published v0.5.10, v0.5.11, or v0.5.12 tags or assets.
- Treating fixtures as live model/IM PASS.
- Promoting missing live credentials into a new release blocker.
- A second Agent core, mixed DSH generations, or enabling Budget
  enforcement merely to show usage.
- Two-hour installed soak / timed wait gates.
- I05 packaged PDF page-image preview and bundled Poppler
  (**DEFERRED_BY_OWNER / OUT_OF_SCOPE**, not PASS). Pre-existing PDF
  inspect, digest-bound text preview, and optional host `pdftoppm` when
  present remain. Do not pull this into 0.6.0 without a new explicit
  Owner request.
- Linux amd64 / Windows ARM as additional official targets.
- Labeling UOS native install/startup/functions PASS, or substituting a
  report for the actual `.deb`. Public notes must state that UOS native
  acceptance is pending Owner post-release testing.

## Cohort freeze (development)

Development pins now match `packages/release-identity/src/pins.ts`,
`release-contract.json`, `release-info.json`, and
`docs/0.6.0/DSH_NPM_COHORT.json`: official DSH `0.1.5-alpha.1` /
`5dda764e…` / 272 packages. F05 retitled `PRODUCT_VERSION` to `0.6.0`
and `RELEASE_TARGETS` to four installers including
`Penglai_0.6.0_uos_loong64.deb`. Mac/Windows native install/lifecycle
remain required; UOS native install/startup/function is
`OWNER_POST_RELEASE`. Public README/website/release notes stay on
published DSH `0.1.3-alpha.2` and 0.5.12 download tables until public
v0.6.0 bytes exist.

## PM GUI (ARM, isolated)

Authoritative PM live findings (PM-owned evidence file; not in this tree).
Do not relabel 0.5.12 native evidence as 0.6.0 runtime acceptance.

- Candidate `6d7b5917` zip `59738af2…`, codesign `--deep --strict` valid:
  same-path original 0.5.12 userdata upgrade PASS (sessions, custom Flash 4.1,
  migrated credentials, attachment preview, quit/relaunch).
- f8ca9446 fresh install PASS: invalid credential recovery, workspace error
  clearance, custom Flash 4.1 vision, restart persistence. Reusable for
  unaffected paths.
- Intel Mac / Windows native/lifecycle still required from the **frozen**
  four-target SHA after UOS payload integration. Do not dispatch
  `native-release-candidate.yml` from this prep change.

Electron 31.7.7 UOS pin remains **not maintained**. PM selected option B
(2026-09-09): ship those bytes with explicit Chromium 126 / unproven
maintenance disclosure and no security parity with Mac/Windows. UOS
`.deb` payload addons including architecture-built Mnemon 0.2.8 are in
`native/linux-loong64-oldworld/`. Native UOS stays `OWNER_POST_RELEASE`.
MOSS-TTS is not enableable on this target until an old-world ONNX engine
exists.

Facts already observed (2026-09-09):

- npm dist-tags: `alpha=0.1.5-alpha.1`, `latest=next=0.1.2-rc.1`.
  GitHub `/releases/latest` 404 is expected for prereleases and is not
  “no release”.
- `@deepseek-ai/dsh@0.1.5-alpha.1` integrity
  `sha512-AUjywjrPnhXcAdAjRNgyQa1QCnplFTNYZ+XpR9uCZdbg2FiCb06pHyoDUB2Wxuddzid9D7pVwEiU1OTl4Oshsg==`,
  shasum `5d008b33af044fcc726383112c36581f73138d2d`, tarball SHA-256
  `c75e7e9168500eca90d27813d6d2b02eab124152c995f43bfa5c6a2504ac79e0`.
- GitHub tag `dsh-v0.1.5-alpha.1` is a lightweight tag on commit
  `5dda764ed3aa172535a7967b06ff95d9cbfe536a`, published 2026-09-08T16:16:04Z.
  Default branch is not `main`. Compare
  `dsh-v0.1.3-alpha.2...dsh-v0.1.5-alpha.1`. npm has no `0.1.4`.
- Discovered complete npm graph: **272** packages (258 DSH + 9 vendor +
  5 `node-addon-system@0.1.2`). Not 254 or 263. Do not mix leftover
  Landlock `0.1.1` from 0.5.12. This graph is now the development pin.
- Session V3: Home copy keeps `session.jsonl` and every
  `session.vN.jsonl*`. Official DSH 0.1.5 refuses v0/v2 logs whose first
  surface arrives before `step/start` (`SessionFormatUnsupportedError`,
  same class as DSH `expectedUnsupported`) and does not write a successor
  or mutate the original. Rollback restores the previous Home pointer.
  That is fail-closed preservation, not replay PASS.

## Conditional records

- Live model/IM: `LIVE_NOT_RUN` when credentials are absent.
- Hosted Windows Defender-on: `I02_HOST_UNAVAILABLE` is honest, not a
  fake PASS and not a product defect. Do not weaken Defender or treat
  default-off as normal OS.
- UOS native PASS requires the confirmed UOS 20 Professional 1070 /
  3A6000-HV / kernel 4.19 host (old-world). QEMU on Mac is not native
  proof. V25 is not this target.

## 中文

本增量约束 `grok/0.6.0`。不改写已发布 0.5.10/0.5.11/0.5.12。0.6.0 消费可
证明完整的官方 DSH `0.1.5-alpha.1` npm 队列；包数以实际图为准。会话 V3
必须保留原日志，禁止静默丢弃。DSH IM 4.17.1 按审查结果忠实接入
`@penglai/im`，不得把 dsh-im runtime、WhatsApp 或第二套办公当成产品。
第四目标是龙芯统信 UOS，可行性备忘或三端交叉编译不能冒充四端发布。
PDF 页预览/Poppler 仍为 Owner 延期，不是 PASS。公开下载在 v0.6.0 回读前
仍指向 0.5.12。
