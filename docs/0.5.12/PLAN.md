# Penglai 0.5.12 implementation and verification plan

Status: active development. This document does not assert release or test
completion. Public identity remains **0.5.11** until immutable `v0.5.12`
GitHub Release bytes exist and are read back.

## Objective and authority

Deliver Penglai 0.5.12 from public `main`
`87f6aec04b2b77d45a5c2b280d1b75332a80eb33`. Owner authorization in this
session covers upstream upgrade and adaptation, repair of every reproduced
defect, local development, independent review, acceptance, commit, push, PR
merge, three-target native builds, the exact immutable asset set, README and
existing gh-pages/pages.dev website update, and public readback. Codex is
product-manager coordination only. Implementation, tests and review are Grok
Build work. Published **v0.5.10** and **v0.5.11** tags and assets stay
immutable. Owner-authored `AGENTS.md` and `docs/0.5.7/RELEASE_RUNBOOK.md`
stay uncommitted.

The Owner excludes the two-hour installed soak. Deterministic `test:soak` and
all other applicable normal checks remain required. Missing live-account
credentials stay `LIVE_NOT_RUN`; they are not fixture PASS and are not a new
release blocker.

`TODO.md` is the completion ledger. A row closes only with the named behavior
plus captured evidence.

## Product outcome

DSH remains the only Agent, model, Workspace, Session, Turn, tool, approval
and conversation system. Penglai owns installation, private runtime
lifecycle, reviewed plugins and product presentation. Office and Memory stay
required; Messaging, ASR, TTS and Companion stay optional and initially
disabled.

0.5.12 combines:

1. Honest Windows upgrade/uninstall evidence: uninstaller effect is proven
   before test cleanup; Defender is not disabled to manufacture PASS;
   activation is transactional with verified rollback; process stop is bound
   to the target install/data root.
2. Digest-bound, user-visible PDF page preview on all three targets, with
   explicit missing/failure/resource limits. Text is never treated as image
   proof.
3. A consistent 0.5.12 ledger. 0.5.11 development-tree documents are
   historical snapshots plus a final published ruling.
4. Official DSH at the **latest consumable official npm/tag** (re-checked
   at freeze; currently `0.1.3-alpha.2` / `82a5fd61…`). Complete dependency
   graph with registry integrity. First-party plugins, Home/session APIs,
   three-target install/upgrade/old-data migrate/error recovery. Do not
   keep an older DSH only because it is easier to pass gates. A real
   blocker needs evidence and a fix, not a verbal incompatibility drop.
   Package count is discovered, not assumed 254. Mixed generations,
   Git/source-path substitutes and local repacks are forbidden.
5. Justified Node, Electron, Mnemon and production SDK upgrades with exact
   identity and regression evidence.
6. Re-verification of first-party plugins, Remote, IM, Memory, session
   projections, Home generation, and old-session migrate/rollback against
   the frozen cohort.
7. README full content and visual redesign: rich, calm, product-grade.
   English first, Chinese second. Real workflows, DSH relationship,
   plugins, privacy, install/upgrade/recovery, FAQ, honest limits, real
   screenshots. GitHub Markdown only; no fake JS. Not badge spam.
8. Existing `website/` plus gh-pages/pages.dev full visual redesign:
   mature art direction, real product frames, typography, colour, space,
   responsive layout, visible but restrained motion (respect
   `prefers-reduced-motion`, keyboard, contrast, performance). Same public
   URLs. Downloads stay on published bytes until v0.5.12 readback.
9. Installer and first-run flow visual redesign: macOS DMG presentation,
   Windows NSIS install/upgrade UI, Electron wizard (folder, credentials,
   progress, success, error recovery, Back/retry). Same approvals, same
   DSH-only core, no skipped recovery. Real Electron/NSIS/DMG UI, not a
   mock.

## Implementation order

1. Ledger and historical rulings (this directory, constitution, D-068).
2. Reproduce and repair I01–I06 with tests that fail on the old defects.
3. Independent Grok 4.6 xhigh review of remaining 0.5.11 gaps and affected
   production code; repair, then re-review. Reviewers are general-purpose
   (inherit xhigh); do not use explore/medium.
4. Reconstruct the latest official DSH npm graph; freeze; adapt
   plugins/session/Remote/Home atomically with identity.
5. README, website, DMG/NSIS/wizard visual redesign with independent
   visual QA and real rendered screenshots (desktop + mobile).
6. Source gates, then PR/merge, three-target native, publication, website
   origin readback.

## Verification layers

| Layer | Required proof |
| --- | --- |
| Source | Formatting, typecheck, unit/contract/integration/E2E/security/chaos, deterministic `test:soak`, meaningful negatives |
| Dependencies | Frozen install if needed, exact pins/cohort, registry integrity, licenses/notices/SBOM, secret scan |
| Runtime | Fixed DSH loader/profile, required/optional plugin modes, Office-real, Memory-real |
| Artifacts | Target architecture, complete runtime closure, clean clone, manifests/signatures |
| Native | Matching Apple Silicon, Intel Mac and Windows x64 install/lifecycle/upgrade/uninstall |
| Accounts | Only observed model/IM workflows count as live; unrun stays explicit |
| Public | Immutable exact assets, digest/signature readback, bilingual README/site matching released bytes |
| Presentation | README GitHub render, website desktop+mobile, reduced-motion/keyboard, installer/wizard real UI, before/after screenshots. Visual QA may iterate; “beautified” is not a close. |

## 中文

0.5.12 从已发布 main 继续：先修独立核查缺陷，再按实际完整 npm 队列升级
DSH，并完成正常测试、三端原生、不可变发布与官网回读。0.5.10/0.5.11 公开
字节不可改写。两小时安装等待测试排除；`test:soak` 保留。真实账号缺凭据
时记 `LIVE_NOT_RUN`，不升为新的发布阻断。
