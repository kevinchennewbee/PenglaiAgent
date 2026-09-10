# Penglai 0.6.1 first-party and companion inventory

Official DSH pin: npm `0.1.5-rc.1` / `dsh-v0.1.5-rc.1` /
`183f08e9c6dde7e36cd2318eaee70b0da08fb35e` / 279 packages.

| Surface | Decision | Reason |
| --- | --- | --- |
| Official DSH core | update | Complete registry cohort with integrity; no mixed generations. |
| `@penglai/im` | keep rewrite + 4.18.1/606ced1 delta | Faithful rewrite of reviewed dsh-im 4.17.1, plus current 4.18.1 and unpublished alias HEAD, into `@penglai/im`. No dsh-im runtime, no extra dsh-im `cordis.patch.yml`, no WhatsApp, no second Office, no second management HTTP. Recover completed turns through official inspect / SessionHandle remains the other writer's claim. |
| Eight historical IM adapters | keep | Feishu/DingTalk/Weixin/WeCom/QQ/Slack/Telegram/Discord pins unchanged; no blind majors. Sidecar file/image stay not-supported except Weixin/Feishu native media. |
| Optional iMessage | add Darwin-only | Private TEXT, default off, explicit `macos-messages` identity, user enable + OS permissions required. Windows/UOS unsupported. Native live `LIVE_NOT_RUN`. See ADR 0046. |
| Office | keep + adapt | Required builtin. Action-specific confirmation unchanged. Helper `commit(OfficeJob)` only copies in-memory bytes; production writes still require owner receipt. |
| Memory / Mnemon | keep | Mnemon `0.2.8`; linux-loong64 remains the architecture-built old-world engine. |
| ASR / MOSS | keep | sherpa-onnx `1.13.7`; onnxruntime-node `1.23.2`. MOSS remains not enableable on UOS 20. |
| Companion | keep | Optional, default off. |
| Plugin Center | keep + adapt | Signed catalog identity+digest+DSH compatibility required to preserve a newer overlay. Higher version alone is not enough. |
| Shared types / remotes | update | Consume rc.1 panel and session APIs. Conversation composer slots remain; global panels use `sidebar.panellist` / `main`. |
| Experimental Agent Teams | not enabled | Present in the official npm graph; Penglai profile does not add them. |

Native engine compatibility on all four targets remains decisive. No
`--no-sandbox`, no disabling Office/Memory, and no unconstrained execution to
show a window.
