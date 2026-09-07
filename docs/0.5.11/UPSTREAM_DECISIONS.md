# Penglai 0.5.11 upstream decisions

Status: development cohort freeze. Public release identity remains 0.5.10.
See `COHORT_FREEZE.json`. This is not publication authorization.

Checked on 2026-09-07 against official npm metadata, GitHub tags, and this
worktree's lockfile. A GitHub tag alone is not a consumable cohort.

| Dependency | Current pin | Decision | Reason |
| --- | --- | --- | --- |
| Official DSH npm `next` cohort | `0.1.2-rc.1` / `dsh-v0.1.2-rc.1` / `a66e4702047846cdaa10c66c9d3df3951f5ea70d` | **Retain** | `0.1.3-alpha.1` exists as a source tag; npm does not publish a complete matching 254-package cohort with registry integrity. Mixing generations is forbidden. |
| Standalone Node | `22.22.2` | **Retain** | Matches `package.json` engines and the 0.5.10 native runtime. No complete successor evaluated in this tree. |
| Electron | pinned via DSH/desktop packaging | **Retain** | Moves only with the DSH/desktop cohort. |
| Mnemon native | `v0.2.4` / `67ed1a2f80de902fd041eeaf3b90e7e3d2480d5b` | **Retain** | Darwin arm64 CLI `mnemon version 0.2.4` remember/search/recall/forget ran as a functional probe. Official `verify:memory-real` is INCOMPLETE because the tree is dirty. GitHub successor `v0.2.8` (2026-09-05) exists; `v0.2.7` is the first release that claims Windows special-character SQLite URI encoding. Upgrade needs three-target archive identity, runner pin change, old-db copies, rollback, and Windows path evidence. See `MNEMON.md`. |
| Feishu / DingTalk SDKs | current channel pins | **Retain** | No complete successor with matching identity and tests in this pass. |
| sherpa-onnx / ONNX Runtime | current ASR pins | **Retain** | Native asset identity must move with ASR evidence. |
| Office/PDF (`pdf-lib`, `docx`, `exceljs`, `@liustack/pptfast`) | current | **Retain** | First-party PDF inspect/preview repairs use the existing libraries plus optional Poppler raster when present. |
| `@linxin666/dsh-web-all@0.3.14` | not a production dependency | **Reject as production pin** | Package exists; it is a reference plugin, not a Penglai runtime substitute. |
| `@xmanrui/dsh-im@4.9.1` | not a production dependency | **Reject as production pin** | Package exists; Penglai IM remains the first-party control plane over official DSH. |

Release identity, lockfile, profile and plugin catalog stay on the retained
rc.1 cohort until a complete official successor is frozen. Changing the cohort
restarts affected validation.

## 中文

官方 DSH 仍使用可验证的 `0.1.2-rc.1` 完整 npm 队列。源码标签 `0.1.3-alpha.1`
不足以升级。参考插件不是生产依赖。
