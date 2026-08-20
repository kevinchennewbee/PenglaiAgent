# ADR 0019 — Penglai branding, Chinese-first onboarding and DSH parity

- 状态：ACCEPTED
- 日期：2026-08-16

## Decision

用户可见 product identity 为 Penglai/蓬莱：app/menu/window/HTML title/sidebar/welcome/onboarding。Powered by DeepSeek Harness、exact version、licenses 保留在 About/diagnostics/legal。

fresh profile 默认 zh，但 zh/en selector/dictionaries 保留。official DSH light/dark/system 及 system dynamic response、Models、Workspace/Session、conversation、tools、approvals、permissions、settings 全部保持同版本 parity。

官方 title/locale/slots/modules 优先。sidebar wordmark/internal notice 若无 seam，使用 exact DSH version UI-only overlay；manifest 记录 target/patch/reverse hashes。Agent/runtime/network packages 不 overlay，版本不匹配 fail build。

## Amendment 2026-08-19

官方 `@deepseek-ai/dsh-system-prompt` 的固定开场白是 `You are an AI agent powered by DeepSeek Harness.`。蓬莱作为发行层通过 official `system-prompt/assemble` waterfall 改写 `harness:identity`，让模型自称蓬莱/Penglai。这不是第二套 Agent/prompt runtime，也不把该段标成 `complete`。About/diagnostics 仍保留 Powered by DeepSeek Harness。对话 chrome、Models、Workspace、Session、tools、approvals 仍是 official DSH Web。

## Consequences

建立 machine-readable upstream capability baseline、installed DOM/behavior parity、theme/system/locale regression。Penglai 二次开发只能加品牌/引导/插件，不能删 DSH 能力。
