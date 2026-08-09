# 蓬莱 · Penglai 0.4 Host 安装脚本 (Windows)
#
# 安装 TS Host(不是 Tauri 桌面):检查 Node -> npm install -> 构建运行时 ->
# 创建 ~/.penglai -> 安装 penglai 命令到 PATH。
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File packages\host\scripts\install.ps1
#
# 可选环境变量:
#   PENGLAI_DIR     数据目录 (默认 ~/.penglai)
#   PENGLAI_PREFIX  安装前缀 (默认 %LOCALAPPDATA%\penglai)

param(
    [string]$RepoRoot = $env:PENGLAI_REPO_ROOT,
    [string]$PenglaiDir = $env:PENGLAI_DIR,
    [string]$Prefix = $env:PENGLAI_PREFIX
)

$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    # scripts -> host -> packages -> repo root
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
}
if ([string]::IsNullOrWhiteSpace($PenglaiDir)) { $PenglaiDir = Join-Path $HOME ".penglai" }
if ([string]::IsNullOrWhiteSpace($Prefix)) { $Prefix = Join-Path $env:LOCALAPPDATA "penglai" }
$HostPkg = Join-Path $RepoRoot "packages\host"
$BinDir = Join-Path $Prefix "bin"
$NeedNode = 22

function Say([string]$Message) { Write-Host $Message }
function Die([string]$Message) { Write-Host "❌ $Message" -ForegroundColor Red; exit 1 }

Say "🏮 蓬莱 · Penglai 0.4 Host 安装 (Windows)"
Say "   repo: $RepoRoot"

# 1. Node >= 22. Installation stays owner-managed: silently invoking a package
# manager here would mutate the machine outside this repository's release gate.
function Test-NodeOk {
    try {
        $v = (& node -v) 2>$null
        if ([string]::IsNullOrWhiteSpace($v)) { return $false }
        $major = [int]($v -replace '^v(\d+).*', '$1')
        return $major -ge $NeedNode
    } catch { return $false }
}
if (-not (Test-NodeOk)) {
    Die "需要 Node.js >= $NeedNode。请先从 https://nodejs.org/ 安装官方版本，或自行使用已信任的版本管理器。"
}
Say "✓ Node.js $(node -v)"

# 2. npm install (workspace: protocol + host)
Set-Location $RepoRoot
if (Test-Path "package-lock.json") {
    Say "npm ci ..."
    npm ci
} else {
    Say "npm install ..."
    npm install
}

# 3. Build the production runtime. An installer must not report success after
# silently falling back to a source/development execution path.
$RuntimeJs = Join-Path $HostPkg "dist-runtime\src\cli.js"
$buildLog = Join-Path $env:TEMP "penglai-host-build.log"
& node (Join-Path $HostPkg "scripts\build-runtime.mjs") *> $buildLog
if ($LASTEXITCODE -ne 0) { Die "生产运行时构建失败；日志: $buildLog" }
if (-not (Test-Path -LiteralPath $RuntimeJs -PathType Leaf)) { Die "生产运行时缺少入口: $RuntimeJs" }
Say "✓ 预构建运行时: $HostPkg\dist-runtime"

# 4. data directory
New-Item -ItemType Directory -Force -Path $PenglaiDir | Out-Null
Say "✓ 数据目录: $PenglaiDir"

# 5. Canonical launcher plus a compatibility alias -> BinDir
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$lines = @("@echo off", "node `"$RuntimeJs`" %*")
foreach ($command in @("penglai.cmd", "penglai-host.cmd")) {
    $wrapper = Join-Path $BinDir $command
    Set-Content -LiteralPath $wrapper -Encoding ASCII -Value $lines
    Say "✓ 启动器: $wrapper"
}

# 6. ensure BinDir on user PATH (non-fatal)
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $userPath -or -not ($userPath.Split(';') -contains $BinDir)) {
    $newPath = if ($userPath) { "$BinDir;$userPath" } else { $BinDir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$BinDir;$env:Path"
    Say "✓ 已添加到用户 PATH (新终端生效)"
}

Say ""
Say "✅ 安装完成。"
Say "   启动:  penglai serve --port 14169"
Say "   (新开终端;当前终端运行: `$env:Path = `"$BinDir;`$env:Path`")"
Say "   Web UI: http://127.0.0.1:14169"
Say "   数据/会话: $PenglaiDir"
