# ADR 0028 — Official welcome notice needs exact-version UI overlay

- Status: ACCEPTED
- Date: 2026-08-17

## Context

Official DSH `0.1.0-rc.6` registers a first-run notice through `settings.onboarding`. The copy lives inside `@deepseek-ai/dsh-client-ui-settings-models` as “内测声明 / Internal Testing Notice” and there is no product-name slot.

Penglai already uses exact-version UI overlays for title and sidebar wordmark (ADR 0023). Replacing only that notice keeps official onboarding, settings persistence, and `welcomeNoticeVersion` acknowledgement.

A separate Penglai privacy step previously set `#root.inert = true` while rendering inside `#root`, which disabled its own Continue button.

## Decision

Apply a UI-only overlay to the exact DSH `0.1.0-rc.6` welcome-notice copy. The overlay keeps official acknowledgement persistence and attribution, and changes the user-visible title/body to Penglai 0.5.0 community-verified facts.

Render Penglai onboarding chrome on `document.body` so setting `#root` inert cannot disable Penglai Continue.

## Amendment 2026-08-18

The same welcome-copy overlay now targets exact DSH `0.1.0-rc.7`. Penglai `WELCOME_NOTICE_VERSION` is `penglai-0.5.0.2`. After the pre-DSH wizard, this notice should already be acknowledged and must not reappear as an engineer-facing DSH internal-testing notice.

## Amendment 2026-08-20

The exact welcome-copy overlay now targets DSH `0.1.0-rc.8` with `WELCOME_NOTICE_VERSION=penglai-0.5.0.3`. It explicitly discloses community-verified, ad-hoc, and not-notarized trust. Brand marks use rc.8 official slots under ADR 0031.

## Consequences

Fresh install shows a Penglai welcome, then the existing Penglai privacy step. Hash or version mismatch still fails the overlay apply. Agent/runtime/network packages remain untouched.
