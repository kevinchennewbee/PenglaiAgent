# Penglai 0.3.0 朋友测试版安装说明

这份说明只用于朋友测试 0.3.0 桌面端。它不是正式公开发布版。

当前测试包是 unsigned 包：

- macOS 没有 Apple Developer ID 签名和公证，所以首次打开需要手动放行。
- Windows 没有 Authenticode 签名，所以可能出现“未知发布者”或 SmartScreen 提示。
- 桌面端会在首次启动时自动初始化本机 PenglaiAgent 运行时。

## 正常测试流程

1. 下载对应系统的安装包。
2. 安装并启动 Penglai。
3. 首次启动页点击“自动初始化并启动”。
4. 保持默认勾选“启用语音转写”即可下载 SenseVoice 本地模型。
5. “启用语音输出”会下载 MOSS-TTS-Nano 本地模型，体积更大，默认不勾选。

自动初始化会做这些事：

- 下载 `codex/0.3.0-runtime-hub` 分支源码到 `~/PenglaiAgent`。
- 准备 uv 托管 Python。
- 创建 `.venv`。
- 安装基础依赖，国内优先清华 PyPI 镜像。
- 运行 `install-check`。
- 自动写入桌面启动配置。
- 按勾选项安装语音能力模型。

## macOS 桌面端

当前 macOS 朋友测试包只覆盖 Apple Silicon，即 M1/M2/M3/M4。

1. 下载 `Penglai_0.3.0_qa_unsigned_macos_aarch64.dmg`。
2. 打开 DMG，把 `Penglai.app` 拖到 `Applications`。
3. 如果提示“Penglai 已损坏”或“无法打开”，在“终端”运行：

```bash
xattr -dr com.apple.quarantine /Applications/Penglai.app
```

4. 再从“应用程序”打开 Penglai。
5. 在首次启动页点击“自动初始化并启动”。

## Windows 桌面端

1. 下载 `Penglai_0.3.0_qa_unsigned_windows_x64_setup.exe`。
2. 双击安装。若出现 SmartScreen：
   - 点“更多信息”
   - 点“仍要运行”
3. 启动 Penglai。
4. 在首次启动页点击“自动初始化并启动”。

## 备用命令

如果桌面内自动初始化失败，可以先用命令行完成运行时初始化，再重新打开 Penglai。

macOS：

```bash
curl -fsSLO https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/refs/heads/codex/0.3.0-runtime-hub/install.sh
PENGLAI_BRANCH=codex/0.3.0-runtime-hub PENGLAI_INSTALL_DEPS=1 PENGLAI_INSTALL_VERIFY=1 PENGLAI_SKIP_SETUP=1 sh install.sh
```

Windows PowerShell：

```powershell
$env:PENGLAI_BRANCH = "codex/0.3.0-runtime-hub"
$env:PENGLAI_INSTALL_VERIFY = "1"
Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/refs/heads/codex/0.3.0-runtime-hub/install.ps1 | Invoke-Expression
```

运行时初始化完成后，桌面端会自动寻找 `~/PenglaiAgent`。也可以在启动页的高级路径里手动填写：

- macOS Python：`/Users/你的用户名/PenglaiAgent/.venv/bin/python`
- macOS 项目目录：`/Users/你的用户名/PenglaiAgent`
- Windows Python：`C:\Users\你的用户名\PenglaiAgent\.venv\Scripts\python.exe`
- Windows 项目目录：`C:\Users\你的用户名\PenglaiAgent`

## 已验证内容

GitHub Actions 的真实 Windows runner 会验证：

- NSIS 安装器构建成功
- 静默安装成功
- 已安装的 `Penglai.exe` 能启动
- 桌面桥 `http://127.0.0.1:14168` 能返回 token
- Runtime Hub 状态接口可用
- `install-check` 通过桌面桥执行成功
- 静默卸载成功
- 卸载后注册表和端口无残留

GitHub Actions 的 macOS runner 会验证：

- DMG 能构建
- DMG 布局正确
- App bundle 身份和版本正确

## 不能承诺的内容

因为这个版本不花钱签名，所以不能承诺：

- macOS 双击下载包后完全无拦截。
- Windows 完全无 SmartScreen/未知发布者提示。
- Intel Mac 可用。
- LLM API key、飞书、微信等账号级配置自动完成。

这些限制要等正式签名、公证和桌面原生配置向导完成后才能解除。
