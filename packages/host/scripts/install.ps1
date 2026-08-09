# 蓬莱 · Penglai 0.4 Host 安装脚本 (Windows)
#
# 安装 TS Host(不是 Tauri 桌面):检查 Node -> npm install -> 构建运行时 ->
# 创建 ~/.penglai -> 安装 penglai-host 命令到 PATH。
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

# 1. Node >= 22 (best-effort install via winget, else instruct)
function Test-NodeOk {
    try {
        $v = (& node -v) 2>$null
        if ([string]::IsNullOrWhiteSpace($v)) { return $false }
        $major = [int]($v -replace '^v(\d+).*', '$1')
        return $major -ge $NeedNode
    } catch { return $false }
}
if (-not (Test-NodeOk)) {
    Say "Node.js >= $NeedNode 未找到,尝试 winget 安装..."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements 2>$null | Out-Null
        # Refresh PATH for this session after a fresh install.
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    }
}
if (-not (Test-NodeOk)) { Die "需要 Node.js >= $NeedNode。安装: https://nodejs.org/" }
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

# 3. build the prebuilt runtime (best-effort; fall back to tsx dev mode)
$RuntimeJs = Join-Path $HostPkg "dist-runtime\src\cli.js"
$UseBuilt = $false
$buildLog = Join-Path $env:TEMP "penglai-host-build.log"
& node (Join-Path $HostPkg "scripts\build-runtime.mjs") *> $buildLog
if ($LASTEXITCODE -eq 0 -and (Test-Path $RuntimeJs)) {
    $UseBuilt = $true
    Say "✓ 预构建运行时: $HostPkg\dist-runtime"
} else {
    Say "⚠ 预构建运行时未生成(源码可能尚未通过类型检查),改用 tsx 开发模式运行。"
    Say "  构建日志: $buildLog"
}

# 4. data directory
New-Item -ItemType Directory -Force -Path $PenglaiDir | Out-Null
Say "✓ 数据目录: $PenglaiDir"

# 5. launcher -> BinDir
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$wrapper = Join-Path $BinDir "penglai-host.cmd"
if ($UseBuilt) {
    $lines = @("@echo off", "node `"$RuntimeJs`" %*")
} else {
    $lines = @("@echo off", "cd /d `"$RepoRoot`"", "node --import tsx packages\host\src\cli.ts %*")
}
Set-Content -Path $wrapper -Encoding ASCII -Value $lines
Say "✓ 启动器: $wrapper"

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
Say "   启动:  penglai-host serve --port 14169"
Say "   (新开终端;当前终端运行: `$env:Path = `"$BinDir;`$env:Path`")"
Say "   Web UI: http://127.0.0.1:14169"
Say "   数据/会话: $PenglaiDir"
