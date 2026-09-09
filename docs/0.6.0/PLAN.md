# Penglai 0.6.0 implementation and verification plan

Status: active development. This document does not assert release or test
completion. Public identity remains **0.5.12** until immutable `v0.6.0`
GitHub Release bytes exist and are read back.

## Objective and authority

Deliver Penglai 0.6.0 from public `main`
`c3ea3f08822386a0345e8c1900368041302a839c` (PR #167 merged). Owner
authorization 2026-09-09 covers upstream upgrade and adaptation, repair of
every reproduced defect, local development, independent review, acceptance,
commit, push, PR merge, four-target native builds, the exact immutable
asset set, README and existing gh-pages/pages.dev website update, and
public readback. Codex is product-manager coordination and GUI operator.
Implementation, tests and review are Grok 4.6 xhigh work. Published
**v0.5.10**, **v0.5.11**, and **v0.5.12** tags and assets stay immutable.
Owner-authored `AGENTS.md` and `docs/0.5.7/RELEASE_RUNBOOK.md` stay
uncommitted in the public checkout at
`/Volumes/KevinSSD-in/macmini/PenglaiAgent`.

The Owner excludes the two-hour installed soak. Deterministic `test:soak`
and all other applicable normal checks remain required. Missing
live-account credentials stay `LIVE_NOT_RUN`. Hardware, paid hosting, and
missing credentials are not automatically authorized.

`TODO.md` is the completion ledger. A row closes only with the named
behavior plus captured evidence.

## Product outcome

DSH remains the only Agent, model, Workspace, Session, Turn, tool, approval
and conversation system. Penglai owns installation, private runtime
lifecycle, reviewed plugins and product presentation. Office and Memory
stay required; Messaging, ASR, TTS and Companion stay optional and
initially disabled.

0.6.0 combines:

1. Official DSH `0.1.5-alpha.1` complete npm cohort with registry
   integrity, atomic lockfile/profile/plugin/identity move, Session V3
   preserve-originals migration, `ctx.agent` / Inbox API adaptations.
2. Faithful DSH IM 4.17.1 review and port into `@penglai/im` (Connection
   `/api` management for unmodified DSH). No second IM core, no WhatsApp,
   no `cordis.patch.yml` overlay, no second Office.
3. Class-level live repairs from PM 0.5.12 GUI evidence: official
   `inputModalities` control, AUTH 401 → wizard `errorAuth`, stale
   workspace error cleared on folder change.
4. Four-target native: `darwin-aarch64`, `darwin-x86_64`, `win32-x86_64`,
   `linux-loong64` (UnionTech UOS on Loongson New-World). Linux packaging
   class is in-scope now; native UOS PASS is hardware-gated.
5. Reuse the I02 Defender-on class for 0.6 Windows. Do not weaken
   Defender.
6. README/website/installer/wizard remain product-grade; downloads stay
   0.5.12 until v0.6.0 public-byte readback.

## Implementation order

1. Ledger and historical rulings (this directory, constitution, D-070).
2. Carry and independently review 0.5.12 live-capability repairs; source
   tests for those classes.
3. Reconstruct DSH `0.1.5-alpha.1` npm graph; freeze; adapt
   plugins/session/Remote/Home atomically with identity.
4. DSH IM 4.17.1 port of applicable Connection `/api` and channel deltas
   into `@penglai/im`.
5. Linux desktop layout, `.deb` packaging, updater fourth target, sandbox
   mapping. Pin loong64 Node/Electron with license/digest/provenance.
6. Independent Grok 4.6 xhigh review at material milestones.
7. Source gates, then PR/merge, four-target native (UOS on matching
   hardware), publication, website origin readback.

Do not publish 0.6.0 before the four-target contract and gates hold.

## Verification layers

| Layer | Required proof |
| --- | --- |
| Source | Formatting, typecheck, unit/contract/integration/E2E/security/chaos, deterministic `test:soak`, meaningful negatives |
| Dependencies | Frozen install if needed, exact pins/cohort, registry integrity, licenses/notices/SBOM, secret scan |
| Runtime | Fixed DSH loader/profile, required/optional plugin modes, Office-real, Memory-real |
| Artifacts | Target architecture, complete runtime closure, clean clone, manifests/signatures |
| Native | Matching Apple Silicon, Intel Mac, Windows x64, and Loongson UOS install/lifecycle/upgrade/uninstall |
| Accounts | Only observed model/IM workflows count as live; unrun stays explicit |
| Public | Immutable exact assets, digest/signature readback, bilingual README/site matching released bytes |
| Presentation | README GitHub render, website desktop+mobile, reduced-motion/keyboard, installer/wizard real UI |

PM owns GUI/browser retest of the isolated candidate and the published
0.5.12 app. Grok does not AX/HID/browser/profile/credential/log-read those
surfaces or terminate PM apps.

## Hardware critical path (UOS)

Portable/source work continues without waiting. Native UOS functional and
lifecycle gates cannot close until Owner/PM provide:

- Loongson CPU model and New-World confirmation (LSX, `glibc >= 2.38`)
- UnionTech UOS desktop version and package arch (`loong64` vs `loongarch64`)
- Existing remote access alias, if any, with install rights
- Whether a source rebuild of Electron 43.6.0 on that host is available
  (32 GiB RAM / 200 GiB disk class) versus pinning the reviewed
  `darkyzhou/electron-loong64` `v43.4.1` binary

Do not ask the user to diagnose a port. PM already requested CPU/UOS
version and remote alias.

## 中文

0.6.0 从已发布 main 继续：先固化合同与现场缺陷修复，再按实际完整 npm
队列升级 DSH，忠实接入 DSH IM，并完成正常测试、四端原生、不可变发布与
官网回读。0.5.10/0.5.11/0.5.12 公开字节不可改写。两小时安装等待测试排除；
`test:soak` 保留。龙芯 UOS 可先做 Linux 包装与钉死来源，原生 PASS 必须等
匹配硬件。
