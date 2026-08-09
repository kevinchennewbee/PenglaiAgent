# PenglaiAgent 0.4 public cutover guard.
#
# The previous script installed the Python 0.3 product. That implementation is
# preserved by the v0.3.6 tag; keeping it live on 0.4 main would install the
# wrong runtime while appearing successful.
$ErrorActionPreference = "Stop"

$message = @"
Penglai 0.4 is not installed by the legacy Python bootstrap.

Desktop / 桌面版:
  https://github.com/kevinchennewbee/PenglaiAgent/releases

Penglai 0.3.6 legacy source installer / 旧版源码安装器:
  https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/v0.3.6/install.ps1

The 0.4 headless installer is not published yet. Do not copy this main-branch
script into an automated install until the 0.4 release notes provide a verified
artifact and SHA-256.

0.4 无头安装器尚未发布。在 0.4 Release notes 给出已验证产物与 SHA-256 前，
请勿把 main 分支脚本用于自动安装。
"@

[Console]::Error.WriteLine($message)
exit 64
