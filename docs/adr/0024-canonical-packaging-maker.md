# ADR 0024 — Canonical 0.5 packaging maker

- 状态：ACCEPTED
- 日期：2026-08-16
- RC：RC1

## Context

0.5.0 必须产出两个独立 macOS DMG 和一个 Windows current-user NSIS Setup，每个包带对应 arch 的 Electron、Node、DSH closure。仓库里已有自研 `scripts/package-mac.mjs`（仅 arm64）。Electron 官方教程倾向 Forge；0.4.1 使用 Tauri，不得回退。

现场约束：

- 必须嵌入绝对路径 Node/DSH，不能依赖 Electron 默认 `app.asar` 里再去 PATH 找 runtime。
- Windows 用户安装包已固定为 NSIS，不是 Squirrel.Windows。
- community trust 没有 Developer ID，不能把 Squirrel.Mac autoUpdater 当成产品路径。
- 需要确定性 manifest、SBOM、integrity、public-export 同源，而不是 maker 私有缓存布局。

## Probe

- `electron-builder` / `@electron-forge/*` 不是本仓 production dependency；引入它们会把未钉死的下载/hook 带进 TCB。
- 现有 `package-mac.mjs` + `embed-runtime.mjs` 已证明能组装 Penglai.app，但硬编码 darwin-arm64。
- 在 darwin-arm64 host 上，`windows-x86_64` preflight 必须 BLOCKED，不得交叉产出“native” Setup。
- Squirrel.Windows 只作为官方更新机制研究，不能替换已确认的 NSIS 用户安装包。

## Decision

唯一 canonical maker 是 **Penglai controlled pipeline**：

1. machine-readable `release-contract.json` 描述三 target 的 Electron/Node URL+SHA-256。
2. target-aware embed/package scripts 生成独立 staging（RC2 实施）。
3. macOS：每 arch 一份 ad-hoc sealed `.app` → 只读 DMG，文件名 `Penglai_0.5.0_macos_{aarch64,x64}.dmg`。
4. Windows：current-user NSIS，文件名 `Penglai_0.5.0_windows_x64_setup.exe`，只在 native Windows x64 生成。
5. 旧 `package-mac.mjs` 降为该 pipeline 的 mac 实现细节，不再是第二套 canonical maker。

不采用 electron-builder 或 Forge 作为发布路径。不采用 Squirrel 作为用户安装器。

## Consequences

- RC2 必须删除 darwin-arm64 硬编码。
- Windows NSIS 模板与 uninstaller 在 RC12/RC14 落地；Mac 上只能跑 maker contract / fixture，不能写 native PASS。
- 文档不得声称“三平台 maker 已在本机全部生成”。
