# Penglai 0.6.1 dsh-im delta map

Status: development record for the 0.6.1 IM milestone. Not a public download
claim. Adopted rewrite-source remains reviewed
[`@xmanrui/dsh-im@4.17.1`](https://github.com/xmanrui/dsh-im/releases/tag/v4.17.1)
/`464c0a91762ebd0befc2d179f036eaae4864fb0e`. Latest published
[`@xmanrui/dsh-im@4.18.1`](https://github.com/xmanrui/dsh-im/releases/tag/v4.18.1)
is `d01bd3450c6d17db2b3386ec44ffa474fd15b03e`. Unpublished git HEAD
`606ced1b5e4f02fe4a1afc9462014f3db1176396` adds bot aliases and is **not**
npm 4.18.1 bytes. Official DSH stays `0.1.5-rc.1` /
`183f08e9c6dde7e36cd2318eaee70b0da08fb35e`. Do not follow dsh-im's older
`0.1.5-alpha.1` compatibility declaration. `0.1.5-alpha.2` is not newer than
rc.1.

Penglai does not install the dsh-im runtime.

| Id | Upstream | Status | Penglai | Reason |
| --- | --- | --- | --- | --- |
| IM-4181-telegram-rich-draft | [v4.18.1 / 583bfc91](https://github.com/xmanrui/dsh-im/commit/583bfc9160f06893f60309b5603f481efa166d48) + [a3bdbffc](https://github.com/xmanrui/dsh-im/commit/a3bdbffc39515c9769e757bf54e71194be006306) | not-applicable | Keep Telegram text long-poll and official-final outbox. Typing/status unchanged. | Rich Draft is a live preview Penglai never adopted; intermediate reasoning must not stream to IM. |
| IM-4181-rpc-authority-default | [v4.18.1 / 2584fe64](https://github.com/xmanrui/dsh-im/commit/2584fe6441651cfa0d1d08046744289a6d881332) | not-applicable | Authenticated Typert `penglaiIm` on unmodified Connection `/api` remains the control surface. | Copying `/api/dsh-im/*` or trusted-host LAN RPC would be a second public Host API. Equivalence is recorded, not faked. |
| IM-4180-imessage | [v4.18.0](https://github.com/xmanrui/dsh-im/releases/tag/v4.18.0) / [docs/imessage.md](https://github.com/xmanrui/dsh-im/blob/v4.18.0/docs/imessage.md) | adapted | Optional Darwin-only private TEXT channel, default OFF, explicit `macos-messages` identity. | Owner authorized Mac-only optional adaptation. Windows/UOS stay unsupported. Native live is `LIVE_NOT_RUN`. |
| IM-4180-preset-remoteerror | [v4.18.0 / df49f56a](https://github.com/xmanrui/dsh-im/commit/df49f56a0c3287fff33015029cd1f9ddd3b7bd03) | adapted | Classify `agent-preset[-/]*` and `isDSHRemoteError` / `failure.code` through existing IM failure handling. Penglai `/projects` `/new` copy. | Missing-session classification is owned by the other writer. Unknown official codes stay `INTERNAL_UNKNOWN`. |
| IM-HEAD-bot-alias | [git HEAD 606ced1b #188](https://github.com/xmanrui/dsh-im/commit/606ced1b5e4f02fe4a1afc9462014f3db1176396) | adapted | SQLite + Typert `setBotAlias` + native DSH plugin UI. Local display only. | Unpublished on npm 4.18.1. Do not copy dsh-im config/runtime/client DOM files. |
| inbound-files-official-fileblock | Official DSH rc.1 `attachments.saveFile` / `FileBlock` | adapted | WeChat/Feishu admitted non-image bytes become official `FileAttachmentRef` on the bound Session followup. | Distinct from ArtifactService.bindComposerTurn (still unwired) and from the already-working official Web upload. |
| wecom-app | dsh-im 4.16 public callback | not-applicable-forbidden | Absent | Extra HTTP listener vs local signed plugin. |
| whatsapp | dsh-im ships WhatsApp | not-applicable-forbidden | Permanent exclusion | GPL/runtime and Owner ban. |
| office-as-im-channel | dsh-im AI Office channel | not-applicable-forbidden | `@penglai/office` remains required builtin | Other writer owns Office schema/parser. |
| session-title-prefix-dom-logos | 4.15.0 | not-applicable | Unmodified DSH Web | No DOM overlay. |
| UX-live-process | 4.14–4.17 process cards / AI Card / rich live drafts | not-applicable | Official completed-turn outbox | Intentional skip; not reopened as 0.6.1 requirements. |
| timeout-redelivery / snapshotEvents return-file | 4.13 / 4.9 | already-assigned-writer | Official inspect / SessionHandle | Do not duplicate. |
| Agent Teams / default provider change | user conversation reference only | not-applicable | Profile keeps Teams off; official defaults unchanged | Reference document has no authority. |
