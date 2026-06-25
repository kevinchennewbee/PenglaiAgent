# Penglai 0.3.0 朋友测试版安装说明

这份说明只用于朋友测试 0.3.0 桌面端。它不是正式公开发布版。

当前测试包是 unsigned 包：

- macOS 没有 Apple Developer ID 签名和公证，所以首次打开需要手动放行。
- Windows 没有 Authenticode 签名，所以可能出现“未知发布者”或 SmartScreen 提示。
- 桌面端当前不是完整自带运行时的单文件产品包；它会启动本机 PenglaiAgent 运行时。

## 先安装 PenglaiAgent 运行时

macOS 朋友先打开“终端”，运行：

```bash
curl -fsSL https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/refs/heads/codex/0.3.0-runtime-hub/install.sh | PENGLAI_BRANCH=codex/0.3.0-runtime-hub sh
```

如果 GitHub 下载慢，可以用镜像：

```bash
curl -fsSL https://gh-proxy.com/https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/refs/heads/codex/0.3.0-runtime-hub/install.sh | PENGLAI_BRANCH=codex/0.3.0-runtime-hub sh
```

Windows 朋友先安装 Python 3.11 和 Git，然后在 PowerShell 运行：

```powershell
git clone --branch codex/0.3.0-runtime-hub --single-branch https://github.com/kevinchennewbee/PenglaiAgent.git "$HOME\PenglaiAgent"
cd "$HOME\PenglaiAgent"
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -e . requests beautifulsoup4 bottle aiohttp lark-oapi qrcode pillow pyyaml
.\.venv\Scripts\python.exe .\penglai install-check --json
```

## macOS 桌面端

当前 macOS 朋友测试包只覆盖 Apple Silicon，即 M1/M2/M3/M4。

1. 下载 `Penglai_0.3.0_qa_unsigned_macos_aarch64.dmg`。
2. 打开 DMG，把 `Penglai.app` 拖到 `Applications`。
3. 如果提示“Penglai 已损坏”或“无法打开”，在“终端”运行：

```bash
xattr -dr com.apple.quarantine /Applications/Penglai.app
```

4. 再从“应用程序”打开 Penglai。
5. 如果出现启动设置页：
   - Python 解释器路径填：`/Users/你的用户名/PenglaiAgent/.venv/bin/python`
   - 项目目录填：`/Users/你的用户名/PenglaiAgent`

## Windows 桌面端

1. 下载 `Penglai_0.3.0_qa_unsigned_windows_x64_setup.exe`。
2. 双击安装。若出现 SmartScreen：
   - 点“更多信息”
   - 点“仍要运行”
3. 启动 Penglai。
4. 如果出现启动设置页：
   - Python 解释器路径填：`C:\Users\你的用户名\PenglaiAgent\.venv\Scripts\python.exe`
   - 项目目录填：`C:\Users\你的用户名\PenglaiAgent`

## 已验证内容

GitHub Actions 的真实 Windows runner 已验证：

- NSIS 安装器构建成功
- 静默安装成功
- 已安装的 `Penglai.exe` 能启动
- 桌面桥 `http://127.0.0.1:14168` 能返回 token
- Runtime Hub 状态接口可用
- `install-check` 通过桌面桥执行成功
- 静默卸载成功
- 卸载后注册表和端口无残留

GitHub Actions 的 macOS runner 已验证：

- DMG 能构建
- DMG 布局正确
- App bundle 身份和版本正确

## 不能承诺的内容

因为这个版本不花钱签名，所以不能承诺：

- macOS 双击下载包后完全无拦截。
- Windows 完全无 SmartScreen/未知发布者提示。
- Intel Mac 可用。
- 桌面端不需要本机 PenglaiAgent 运行时。

这些限制要等正式签名、公证和自带运行时打包完成后才能解除。
