# Penglai 0.6.2 first-party plugin inventory

All first-party plugins are rebuilt against official DSH `0.1.5-rc.2`. A
settings card is not proof that a plugin loaded; native evidence checks the
installed package, exact digest, loader state, permissions, restart, and
disable behavior.

| Surface | Fresh install | 0.6.2 decision |
| --- | --- | --- |
| Penglai Office | on | Required. DOCX, XLSX, PPTX, and PDF inspect/create/preview/export stay behind action-bound write confirmation. |
| Penglai Memory | on | Required. Workspace isolation and explicit personal-memory choice remain. Mnemon `0.2.8` is packaged. |
| Mobile Messaging | off | Keep eight connectors under `@penglai/im`; Weixin and Feishu inbound files use the bound official Session. WhatsApp remains absent. |
| macOS iMessage | off | Optional private text on Mac only. Requires Full Disk Access, Messages automation, and an exact peer binding. Windows and UOS are unsupported. Native live remains `LIVE_NOT_RUN`. |
| Speech Recognition | off | Keep local SenseVoice flow and opt-in model download. |
| Voice Generation | off | Keep local MOSS-TTS on Mac and Windows. It is unavailable and cannot be enabled on LoongArch. |
| Companion | off | Keep opt-in scheduling, quiet hours, daily limits, and one bound IM route. |
| Plugin Center | on | Accept only signed catalog artifacts with exact identity, digest, permission, DSH compatibility, and rollback checks. |

Plugins share the local DSH process. They are not a security boundary from the
core, so the catalog and permission review remain part of installation.
