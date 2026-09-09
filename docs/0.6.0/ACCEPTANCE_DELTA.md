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
- Four actual native targets from one clean `main` SHA: Apple Silicon,
  Intel Mac, Windows x64, and Loongson UnionTech UOS (`linux-loong64`).
  A feasibility note, cross-build, or three-platform set is not a
  completed four-platform release.
- Linux desktop packaging class: layout, `.deb`, desktop integration,
  launch, storage, secrets, updates, uninstall, runtime closure, and
  mandatory Office/Memory semantics. Do not disable required plugins or
  sandbox to show a window.
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
- Advertising a Loongson/UOS download before actual native
  functional/lifecycle evidence on that ABI.

## Cohort freeze (development)

Exact identities will be recorded in `COHORT_FREEZE.json` and must match
`packages/release-identity/src/pins.ts` plus `release-contract.json` after
F03/F04. Until that freeze, shipped pins remain 0.5.12; this delta
authorizes the 0.6.0 retitle only together with the chosen cohort.

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
  Landlock `0.1.1` from 0.5.12. F03 still writes this graph into product
  pins.

## Conditional records

- Live model/IM: `LIVE_NOT_RUN` when credentials are absent.
- Hosted Windows Defender-on: `I02_HOST_UNAVAILABLE` is honest, not a
  fake PASS and not a product defect. Do not weaken Defender or treat
  default-off as normal OS.
- UOS/LoongArch native PASS requires matching hardware (or a signed UOS
  loong64 environment that actually boots that ABI). QEMU on Mac is not
  native Loongson proof.

## 中文

本增量约束 `grok/0.6.0`。不改写已发布 0.5.10/0.5.11/0.5.12。0.6.0 消费可
证明完整的官方 DSH `0.1.5-alpha.1` npm 队列；包数以实际图为准。会话 V3
必须保留原日志，禁止静默丢弃。DSH IM 4.17.1 按审查结果忠实接入
`@penglai/im`，不得把 dsh-im runtime、WhatsApp 或第二套办公当成产品。
第四目标是龙芯统信 UOS，可行性备忘或三端交叉编译不能冒充四端发布。
PDF 页预览/Poppler 仍为 Owner 延期，不是 PASS。公开下载在 v0.6.0 回读前
仍指向 0.5.12。
