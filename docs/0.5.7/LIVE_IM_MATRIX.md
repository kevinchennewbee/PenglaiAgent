# Penglai 0.5.7 live IM matrix

`live` in code means the adapter passed release acceptance, not that a given
user enabled it. This table is the only public live-status source. Empty live
columns are `LIVE_NOT_RUN` until a redacted evidence pack exists.

Evidence must not contain QR images, tokens/secrets, user IDs, group names,
chat bodies, phone numbers, or WhatsApp session keys.

| Channel | Connection | Private text in | Official Turn | Private text out | Restart restore | Logout/unbind | Images | Files | Audio | Markdown | Threads | Groups | Live status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Weixin | QR (iLink) | inherited 0.5.6 | inherited 0.5.6 | inherited 0.5.6 | inherited 0.5.6 | inherited 0.5.6 | pending re-verify | pending re-verify | pending re-verify | false | false | false | `LIVE_BLOCKED_OWNER_ACCOUNT` on 0.5.7 bits |
| Feishu | official app QR / credentials | inherited 0.5.6 | inherited 0.5.6 | inherited 0.5.6 | inherited 0.5.6 | inherited 0.5.6 | pending re-verify | pending re-verify | pending re-verify | pending re-verify | false | false | `LIVE_BLOCKED_OWNER_ACCOUNT` on 0.5.7 bits |
| DingTalk | QR device-auth + Stream | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | false | false | false | false | false | false | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| WeCom | QR intelligent bot | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | false | false | false | false | false | false | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| QQ | official QQ Bot QR | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | false | false | false | false | false | false | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| Slack | App Manifest + tokens, no QR | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | false | false | false | false | false | false | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| Telegram | Bot token long-poll, no QR | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | false | false | false | false | false | false | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| Discord | Bot token Gateway, no QR | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | false | false | false | false | false | false | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| WhatsApp | not bundled | false | false | false | false | false | false | false | false | false | false | false | `RUNTIME_NOT_BUNDLED` |

Owner action required for live rows (none completed this candidate):

- Weixin: scan once in the installed 0.5.7 app.
- Feishu: official app scan or local credential entry.
- DingTalk: device-registration scan once.
- WeCom: intelligent-bot scan once.
- QQ: official QQ Bot scan once.
- Slack: paste bot token + app token; re-authorize `reactions:write` if needed.
- Telegram: paste bot token.
- Discord: paste bot token and enable Message Content Intent.

Grok Build does not hold those accounts. 0.5.6 inherited Weixin/Feishu live is
not 0.5.7 live.

WhatsApp compatibility source remains available for future licensing review,
but its community runtime and device-link path are excluded from 0.5.7 artifacts.

A platform without a live row must not be described as fully supported in
README, the website, or a GitHub Release.
