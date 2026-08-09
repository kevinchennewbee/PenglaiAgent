#!/bin/sh
# PenglaiAgent 0.4 public cutover guard.
#
# The Python bootstrap that previously lived at this path installs the 0.3
# product line and is intentionally preserved only by the signed v0.3.6 tag.
# Running it from 0.4 main would report success while installing the wrong
# runtime, so this entry point fails closed until a verified 0.4 headless
# installer exists.
set -eu

cat >&2 <<'EOF'
Penglai 0.4 is not installed by the legacy Python bootstrap.

Desktop / 桌面版:
  https://github.com/kevinchennewbee/PenglaiAgent/releases

Penglai 0.3.6 legacy source installer / 旧版源码安装器:
  https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/v0.3.6/install.sh

The 0.4 headless installer is not published yet. Do not copy this main-branch
script into an automated install until the 0.4 release notes provide a verified
artifact and SHA-256.

0.4 无头安装器尚未发布。在 0.4 Release notes 给出已验证产物与 SHA-256 前，
请勿把 main 分支脚本用于自动安装。
EOF

exit 64
