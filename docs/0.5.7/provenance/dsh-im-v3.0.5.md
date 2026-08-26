# dsh-im v3.0.5 supply-chain and delta record

This is the current Penglai 0.5.7 DSH-IM review baseline. Penglai does not
install DSH-IM as another Agent core and does not copy its generated `lib/`,
`bin/`, Harness client, config store, Office worker, or runtime.

## Identity

| Field | Value |
|---|---|
| Upstream | `https://github.com/xmanrui/dsh-im` |
| Version | `v3.0.5` |
| Annotated tag object | `63bdfc72be1289097e3c73acb95ba9260531091d` |
| Peeled commit | `64587b3b6162fa34f1c3ddb335a254d4154c9175` |
| Archive URL | `https://codeload.github.com/xmanrui/dsh-im/tar.gz/64587b3b6162fa34f1c3ddb335a254d4154c9175` |
| Archive SHA-256 | `ae4a9727627f55d5a90bff929caf27dc092153c80b8b79fca9cf18a3fa4125f7` |
| Archive bytes | `9835773` |
| License | MIT |
| License SHA-256 | `2e1c6321c5df1830b8758dd6d1cc1c70c41f561129581f1986b408255f67d588` |
| Tag signed | no; `verification.verified=false`, `reason=unsigned` |
| Tagger date | `2026-08-26T10:54:12Z` |
| Fetched | `2026-08-26` |

Official DSH was rechecked at the same time. Git `HEAD`, `master`, tag
`dsh-v0.1.1-rc.2`, npm `latest`, and npm `next` all remain 0.1.1-rc.2 at
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

## v3.0.2 to v3.0.5 review

The range contains eight commits and fourteen changed paths. Generated `lib/`
and release metadata are never ported. The source-level product changes were
reviewed as follows:

| Upstream change | Penglai decision |
|---|---|
| v3.0.3 keeps connection state in the card top-right on narrow layouts | Adopt the layout principle in the Penglai IM card header; independently implemented, no upstream CSS copied. |
| v3.0.3 separates WeCom thinking/tool progress from the answer body | Do not port. Penglai's single IM control plane sends only the durable official DSH final through its outbox; intermediate model thinking is not external-channel content. |
| v3.0.3 adds WhatsApp group mention/reply and group-caller allowlists | Do not port. It conflicts with Penglai's private-only policy and upstream reverted it in v3.0.4. |
| v3.0.5 trusts international `wechat.com` hosts | Selectively port only the exact iLink API host `ilinkai.wechat.com`, alongside `ilinkai.weixin.qq.com`. HTTPS, no credentials, default port, and exact-host checks remain fail-closed; lookalike suffixes stay rejected. |

No new channel, QR mechanism, Office capability, Memory capability, Agent,
Session, or credential store was added in this range. Previous transport
rewrites remain governed by `DSH_IM_PORT_LEDGER.md`.
