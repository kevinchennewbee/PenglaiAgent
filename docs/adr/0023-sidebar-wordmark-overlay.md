# ADR 0023 — Sidebar wordmark needs exact-version UI overlay

- 状态：SUPERSEDED BY ADR 0031（rc.8 已提供 official brand slots）
- 日期：2026-08-16

## Context

RC1 isolated probe of `@deepseek-ai/dsh@0.1.0-rc.6` found official seams for title suffix (`DocumentTitle` projects session title in front of the shell `document.title`), locale, theme, onboarding, and plugin tabs.

`@deepseek-ai/dsh-client-ui-primitives` `BrandWordmark` only accepts `size`/`className`. `@deepseek-ai/dsh-client-ui-sidebar` hard-wires that component. There is no product-name or logo slot.

## Decision

RC2 may apply a UI-only overlay to exact DSH `0.1.0-rc.6` sidebar/wordmark/internal-notice surfaces. The overlay manifest must record target file hashes, patch hash, reverse patch, and DOM tests. Agent/runtime/network packages are not overlay targets. Hash or version mismatch fails the build.

## Amendment 2026-08-18

Current product overlay tree is `overlays/dsh-0.1.0-rc.7/` (ADR 0029). The UI-only rule is unchanged: title, sidebar wordmark, welcome copy only; Agent/runtime/network packages stay official.

## Amendment 2026-08-19

The official empty-session hero in `@deepseek-ai/dsh-client-ui-conversation` hard-wires DeepSeek `FishLogo`, `hero.headline` (“探索未至之境” / “Into the Unknown”), and `hero.preview` (“预览版” / “Preview”). There is still no product-name slot. The same exact-version UI-only overlay may replace that hero wordmark and copy with Penglai identity, including the Owner-provided logo and a light/dark ink-wash background that still follows official appearance. Models, Workspace, Session, conversation, tools, approvals, permissions, and settings stay official.

Brand binaries (`overlays/dsh-0.1.0-rc.7/brand/*`) are hash-pinned in `manifest.brand` and copied only after SHA-256 equality. Reverse patch for JS/HTML overlay files is the vendored `upstream/` blob; apply fails closed unless the target matches `upstreamSha256` or is already `patchedSha256`.

## Amendment 2026-08-20

DSH rc.8 已声明 `sidebar.brand.mark`、`sidebar.brand.name` 与 `conversation.hero.brand.mark` official single slots。Penglai 改用 slots；sidebar direct patch 与 hero icon replacement 从 current overlay 删除。本 ADR 只保留 rc.6/rc.7 历史。

## Consequences

Penglai brand can appear in the sidebar without forking DSH. Overlay work is deferred to RC2 implementation; this ADR only records the missing seam.
