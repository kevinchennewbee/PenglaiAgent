# ADR 0046 — Optional Darwin-only iMessage private text channel

- Status: Accepted
- Date: 2026-09-10
- Relates: D-071, D-072, PRODUCT_CONSTITUTION current 0.6.1 boundary

## Context

Reviewed dsh-im v4.18.0 added a macOS Messages.app private-text adapter
(`ff865f9c` / `017f6fb1`). Penglai's four packaged targets include Windows
and UOS loong64, which have no Messages.app. Owner later authorized adapting
this channel inside the existing first-party `@penglai/im` architecture as a
Mac-only optional feature. A four-target release does not forbid a Darwin-only
optional channel.

Immutable 0.5.x and 0.6.0 history is not rewritten.

## Decision

1. Penglai 0.6.1 may ship one optional iMessage connector in `@penglai/im`.
2. Default is OFF. The channel is private TEXT only. Groups, images, files,
   attachments, rich text, and SMS are rejected.
3. One local macOS identity is explicit (`macos-messages`). The forbidden
   unscoped `${channel}-default` account is never used.
4. No Messages `chat.db` read and no Messages AppleScript run until the current
   user explicitly enables/configures the channel and grants Full Disk Access
   plus Automation (Apple Events). Permission-denied and not-configured never
   count as connected.
5. Fresh first-enable cursor is the latest iMessage row. Received-only rows
   are processed. Own replies carry a durable body marker so restart cannot
   loop. Disabled teardown stops polling immediately.
6. Windows and UOS expose honest unsupported/hidden state and never invoke
   macOS helpers.
7. Packaging may add Apple Events purpose text only. No automatic TCC
   manipulation, no extra entitlements, no unreviewed native dependency.
8. Native/live Messages evidence is `LIVE_NOT_RUN`. Fixture databases and
   injected process seams are not native messaging proof.

## Consequences

- Control remains Typert `penglaiIm` on official Connection `/api`.
- dsh-im's second management HTTP surface, LAN trust broadening, Office-as-IM,
  WhatsApp, wecom-app callbacks, DOM injection, and alternate agent core stay
  excluded.
- Tests must not touch real `~/Library/Messages`, Contacts, Messages.app,
  live AppleScript, or TCC prompts.
