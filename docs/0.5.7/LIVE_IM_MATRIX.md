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
| WhatsApp | device-link, opt-in | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | `LIVE_BLOCKED_OWNER_ACCOUNT` | false | false | false | false | false | false | `LIVE_BLOCKED_OWNER_ACCOUNT` |

Owner action required for live rows: scan once (Weixin/Feishu/DingTalk/WeCom/QQ/WhatsApp) or paste a bot token on this machine (Slack/Telegram/Discord). Grok Build does not hold those accounts.

WhatsApp extra gates, all blocked until proven: risk acknowledgement
version/time, encrypted private session store, self-echo dedupe, reserved
outbound message IDs, complete logout wipe.

A platform without a live row must not be described as fully supported in
README, the website, or a GitHub Release.
