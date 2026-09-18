# Penglai 0.6.3 first-party plugin inventory

All first-party plugins are rebuilt against official DSH `0.1.6-alpha.2`. A
settings card is not proof that a plugin loaded; native evidence checks the
installed package, exact digest, loader state, permissions, restart, and
disable behavior.

Source-level compatibility is required in this phase. Installed loader,
restart, rollback, and native platform observations remain `NOT_RUN` until the
three-target phase.

| Surface | Fresh install | 0.6.3 decision |
| --- | --- | --- |
| Penglai Memory | on | Bundled and default-on. The Owner may disable it without removing its package or data; Workspace isolation and explicit personal-memory choice remain. Mnemon `0.2.8` is packaged. |
| Mobile Messaging | on | Bundled and active by default. Keep eight established connectors under `@penglai/im`; no channel or account connects until the user configures it. Weixin and Feishu inbound files use the bound official Session. WhatsApp remains absent. |
| macOS iMessage | off | Optional private text on Mac only. Requires Full Disk Access, Messages automation, and an exact peer binding. Windows and UOS are unsupported. Native live remains `LIVE_NOT_RUN`. |
| Speech Recognition | off | Plugin, UI, service, and Sherpa/WASM runtime are bundled; the pinned SenseVoice weights remain an opt-in model download. |
| Voice Generation | off | Plugin, UI, service, ONNX Runtime, SentencePiece, and execution code are bundled on Mac and Windows; pinned model weights remain an opt-in download. It is unavailable and cannot be enabled on LoongArch because no supported native ONNX Runtime exists. |
| Plugin management | on | Penglai Center owns one exact official DSH alpha.2 manager instance. Official UI/tool can inspect, install, cancel, remove, enable/disable, and separately approve build scripts. Package operations use bundled Node/pnpm `11.11.0`; no global pnpm fallback or signed-catalog ecosystem allowlist. |

Office/PDF, LibreOffice Kit, Budget, and Companion are explicitly excluded
from the 0.6.3 workspace, profile, catalog, product runtime closure, installers,
and acceptance. Their source history is not a shipped or supported product
capability. The upstream cohort ledger still records the exact packages that
exist upstream so the adoption decision remains auditable.

Plugins share the local DSH process. They are not a security boundary from the
core. Package inspection and explicit build-script approval are trust decisions;
a successful settings mutation is not evidence of live activation until the
manager reports it or the required restart has completed.
