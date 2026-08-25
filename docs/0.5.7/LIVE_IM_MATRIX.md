# Penglai 0.5.7 live IM matrix

`live` in code means the adapter passed release acceptance, not that a given
user enabled it. This table is the only public live-status source. Empty live
columns are `LIVE_NOT_RUN` until a redacted evidence pack exists.

Evidence must not contain QR images, tokens/secrets, user IDs, group names,
chat bodies, phone numbers, or WhatsApp session keys.

| Channel | Connection | Private text in | Official Turn | Private text out | Restart restore | Logout/unbind | Images | Files | Audio | Markdown | Threads | Groups | Live status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Weixin | QR (iLink) | inherited 0.5.6 | inherited 0.5.6 | inherited 0.5.6 | inherited 0.5.6 | inherited 0.5.6 | pending re-verify | pending re-verify | pending re-verify | false | false | false | `LIVE_NOT_RUN` on 0.5.7 bits |
| Feishu | official app QR / credentials | inherited 0.5.6 | inherited 0.5.6 | inherited 0.5.6 | inherited 0.5.6 | inherited 0.5.6 | pending re-verify | pending re-verify | pending re-verify | pending re-verify | false | false | `LIVE_NOT_RUN` on 0.5.7 bits |
| DingTalk | QR device-auth + Stream | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | false | false | false | false | false | false | `LIVE_NOT_RUN` |
| WeCom | QR intelligent bot | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | false | false | false | false | false | false | `LIVE_NOT_RUN` |
| QQ | official QQ Bot QR | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | false | false | false | false | false | false | `LIVE_NOT_RUN` |
| Slack | App Manifest + tokens, no QR | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | false | false | false | false | false | false | `LIVE_NOT_RUN` |
| Telegram | Bot token long-poll, no QR | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | false | false | false | false | false | false | `LIVE_NOT_RUN` |
| Discord | Bot token Gateway, no QR | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | false | false | false | false | false | false | `LIVE_NOT_RUN` |
| WhatsApp | device-link, opt-in | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | `LIVE_NOT_RUN` | false | false | false | false | false | false | `LIVE_NOT_RUN` |

WhatsApp extra gates, all `LIVE_NOT_RUN` until proven: risk acknowledgement
version/time, encrypted private session store, self-echo dedupe, reserved
outbound message IDs, complete logout wipe.

A platform without a live row must not be described as fully supported in
README, the website, or a GitHub Release.
