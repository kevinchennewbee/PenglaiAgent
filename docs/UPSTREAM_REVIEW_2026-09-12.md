# Post-release upstream review: 2026-09-12

> Historical decision snapshot. Its recommendation not to release 0.6.2 was
> superseded later the same day by Owner decision D-076. The verified upstream
> identities and risk findings remain evidence; the stop decision does not.

## Decision

Keep immutable Penglai **v0.6.1**. Do **not** run the full 0.6.2 release
workflow solely for DeepSeek Harness `0.1.5-rc.2`.

This is a post-release observation, not a new dependency freeze or publication
authorization. No v0.6.1 tag, asset, updater channel, or website byte may be
rewritten from this review.

## Verified observations

| Surface | Current observation | Consequence |
| --- | --- | --- |
| Penglai public release | Immutable v0.6.1, source `7ad7c29ecda5d9e867fdde0fe3fefd5c42d3ab1b`, ten assets; published/read back 2026-09-11 | Preserve it. Retained `OWNER_POST_RELEASE`, `OWNER_EXCLUDED`, and `LIVE_NOT_RUN` items do not become PASS. |
| DSH npm channels | `latest=0.1.5-rc.1`, `next=0.1.5-rc.2`, `alpha=0.1.5-alpha.2` | rc.2 is available but is not the default `latest`. Never follow a mutable dist-tag during a build. |
| DSH rc.2 identity | Tag/commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`; root integrity `sha512-8Xc8hCQHcIWRmTCVU/xZdp6/qMsWMeAd2ObChKDEsfhUPJFXx6H0lgeb1DxUMD86HZrrVN+1bCvn1ppjZ/fOxw==`; downloaded tarball SHA-256 `f4c54839d69e82bf1c3a5a41a910c3ce1405cd9e9d97d753c0c04f406c7d7480` | Any future candidate must pin exact registry integrity and source identity. |
| rc.1 → rc.2 scope | Four commits; same discovered topology: 265 DSH + 9 vendor + 5 native-system packages = 279. Changes are feedback confirmation/category/note UX, delivered-file spacing/cards, and 48 code-file icons. | No identified core Agent, Session persistence, API, security, or packaging fix justifies an emergency release. |
| DSH master | 139 commits ahead of rc.2 at probe time and includes substantial unreleased desktop/runtime/API work | Do not consume master or describe it as released behavior. Review only a later immutable tag/package. |
| dsh-im | Latest npm/GitHub release is 4.20.0, tag commit `1cf1cdb24f62fe7d57fe67501a7c3765d049033e`; HEAD was `03204d2f49ae44a90f067db74e3b3faee8086c1c` | Observe only. Conversation-level Workspace routing and Weixin diagnostics need a separate first-party rewrite review; never install the community runtime. |

Primary sources:

- [Official DSH rc.2 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2)
- [Official rc.1 → rc.2 comparison](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.5-rc.1...dsh-v0.1.5-rc.2)
- [Official DSH npm package](https://www.npmjs.com/package/@deepseek-ai/dsh)
- [dsh-im v4.20.0 release](https://github.com/xmanrui/dsh-im/releases/tag/v4.20.0)

## Privacy consequence

The official Web profile contains feedback and OTel telemetry packages. In the
upstream `FEEDBACK_ONLY` path, explicit feedback can export the canonical
Session prefix; the rc.2 dialog also tells the user that the current
conversation log is included.

Penglai does not operate a telemetry backend. Its production runtime injects
`DSH_TELEMETRY_DISABLED=1` and does not forward a telemetry mode or exporter
URL, so the exporter/provider is not constructed and feedback remains local.
That is the required v0.6.1 boundary.

Before adopting rc.2 feedback UX, one of these must be accepted and tested:

1. upstream provides deployment-aware copy and a visible local-only state;
2. Penglai disables the feedback surface without altering the pinned DSH
   package bytes; or
3. a separately authorized telemetry design gives explicit consent and clearly
   discloses destination, included fields, retention, deletion, and failure
   behavior.

The generic “conversation log will be submitted” text is misleading in a
local-only Penglai deployment and is a reason not to rush rc.2.

## When 0.6.2 becomes justified

Start a 0.6.2 candidate only for a concrete product reason, such as:

- a security or data-integrity fix applicable to Penglai;
- a required Agent/Session/runtime repair;
- an accepted feedback/privacy design;
- a reviewed dsh-im improvement that fixes a reproduced Penglai defect; or
- another Owner-approved product change worth a native release cycle.

If any DSH generation changes, the release must be atomic: exact full cohort,
lockfile, runtime closure, profile, every first-party plugin, Plugin Center,
identity, licenses, native packages, installed lifecycle, publication, and
public-byte readback. A partial package update or installer-only swap is not an
acceptable 0.6.2.

---

# 发布后上游复核 — 2026-09-12

## 结论

继续保留不可变的 Penglai **v0.6.1**。不因为 DSH `0.1.5-rc.2` 单独启动
0.6.2 全流程发布。

rc.2 目前在 npm `next`，`latest` 仍为 rc.1。它相对 rc.1 只有四个提交，包拓扑
仍为 279 个，实际变化集中在点赞/点踩反馈弹窗、分类与备注，以及交付文件排版和
图标；没有发现需要紧急发布的核心 Agent、Session 持久化、API、安全或打包修复。
master 仍有大量未发布提交，不能直接消费，也不能当作已发布事实。

## 隐私边界

上游 rc.2 的通用反馈弹窗说明会附带当前会话记录；官方 `FEEDBACK_ONLY` telemetry
路径在显式反馈时可以导出规范会话前缀。Penglai 不运营 telemetry 后端，生产运行时
固定 `DSH_TELEMETRY_DISABLED=1`，也不传 mode/exporter URL，因此反馈保持本地。
在采用 rc.2 前，必须让反馈文案与真实部署一致、关闭该入口，或另行完成明确同意、
目的地、字段、保留与删除策略的隐私设计和验收。

## 以后发布 0.6.2 的规则

只有出现适用于 Penglai 的安全/数据完整性修复、核心运行时修复、被接受的反馈隐私
设计、能修复已复现问题的 dsh-im 改进，或 Owner 明确批准的其他产品变化时，才建立
0.6.2 候选。一旦更换 DSH 代际，必须原子迁移完整 cohort、lockfile、runtime
closure、profile、全部第一方插件、Plugin Center、release identity，并重跑源码、
原生安装包、installed lifecycle、发布和公网回读门禁；禁止只换部分包或安装包。
