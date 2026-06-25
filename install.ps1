param(
    [string]$OwnerRepo = $env:PENGLAI_REPO,
    [string]$Branch = $env:PENGLAI_BRANCH,
    [string]$Target = $env:PENGLAI_DIR,
    [string]$Proxy = $env:PENGLAI_GH_PROXY
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($OwnerRepo)) { $OwnerRepo = "kevinchennewbee/PenglaiAgent" }
if ([string]::IsNullOrWhiteSpace($Branch)) { $Branch = "main" }
if ([string]::IsNullOrWhiteSpace($Target)) { $Target = Join-Path $HOME "PenglaiAgent" }
if ($null -eq $Proxy) { $Proxy = "https://gh-proxy.com/" }
if ($Proxy -and -not $Proxy.EndsWith("/")) { $Proxy = "$Proxy/" }

$CoreDeps = @("requests", "beautifulsoup4", "bottle", "aiohttp", "lark-oapi", "qrcode", "pillow", "pyyaml")
$PipIndex = if ($env:PENGLAI_PIP_INDEX) { $env:PENGLAI_PIP_INDEX } else { "https://pypi.tuna.tsinghua.edu.cn/simple" }
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

function Say([string]$Message) {
    Write-Host $Message
}

function Test-GithubDirect {
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "https://github.com" -Method Head -TimeoutSec 6 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Download-FileWithFallback([string[]]$Urls, [string]$Destination) {
    foreach ($url in $Urls) {
        try {
            Say "  Downloading $url"
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $Destination -TimeoutSec 180
            return
        } catch {
            Say "  Download failed: $($_.Exception.Message)"
        }
    }
    throw "All download URLs failed."
}

function Copy-ExpandedSource([string]$ZipPath, [string]$Destination) {
    $extract = Join-Path ([IO.Path]::GetTempPath()) ("penglai-src-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $extract | Out-Null
    try {
        Expand-Archive -Path $ZipPath -DestinationPath $extract -Force
        $root = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
        if (-not $root) { throw "Archive did not contain a source directory." }
        New-Item -ItemType Directory -Force -Path $Destination | Out-Null
        Get-ChildItem -LiteralPath $root.FullName -Force | Copy-Item -Destination $Destination -Recurse -Force
    } finally {
        Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Find-Uv {
    $cmd = Get-Command uv -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $local = Join-Path $HOME ".local\bin\uv.exe"
    if (Test-Path $local) { return $local }
    return $null
}

function Install-Uv([string]$Mirror) {
    $arch = if ([Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") {
        "aarch64-pc-windows-msvc"
    } else {
        "x86_64-pc-windows-msvc"
    }
    $uvZip = Join-Path ([IO.Path]::GetTempPath()) ("uv-" + [Guid]::NewGuid().ToString("N") + ".zip")
    $extract = Join-Path ([IO.Path]::GetTempPath()) ("uv-" + [Guid]::NewGuid().ToString("N"))
    $urls = @()
    if ($Mirror) {
        $urls += "${Mirror}https://github.com/astral-sh/uv/releases/latest/download/uv-$arch.zip"
    }
    $urls += "https://github.com/astral-sh/uv/releases/latest/download/uv-$arch.zip"
    try {
        Download-FileWithFallback $urls $uvZip
        New-Item -ItemType Directory -Force -Path $extract | Out-Null
        Expand-Archive -Path $uvZip -DestinationPath $extract -Force
        $uvExe = Get-ChildItem -LiteralPath $extract -Recurse -Filter "uv.exe" | Select-Object -First 1
        if (-not $uvExe) { throw "uv.exe not found in downloaded archive." }
        $bin = Join-Path $HOME ".local\bin"
        New-Item -ItemType Directory -Force -Path $bin | Out-Null
        Copy-Item $uvExe.FullName (Join-Path $bin "uv.exe") -Force
        return Join-Path $bin "uv.exe"
    } finally {
        Remove-Item -LiteralPath $uvZip -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Write-BuildInfo([string]$Root) {
    $info = [ordered]@{
        schema = 1
        source = "archive"
        branch = $Branch
        commit = "unknown"
        dirty = $false
        remote = "release"
        remote_url = "https://github.com/$OwnerRepo.git"
        build_commit = "unknown"
        build_time = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
    $info | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $Root ".penglai-build.json") -Encoding UTF8
}

Say "Penglai Windows installer bootstrap"

$mirror = ""
if (-not (Test-GithubDirect)) {
    if ([string]::IsNullOrWhiteSpace($Proxy)) {
        throw "GitHub is not reachable and PENGLAI_GH_PROXY is empty."
    }
    $mirror = $Proxy
    Say "  GitHub direct access is limited; using mirror: $mirror"
}

if ((Test-Path (Join-Path $Target "penglai")) -and (Test-Path (Join-Path $Target "agent_loop.py"))) {
    Say "  Source tree already exists: $Target"
} elseif ((Test-Path $Target) -and ((Get-ChildItem -LiteralPath $Target -Force -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0)) {
    throw "Target is not empty and is not a PenglaiAgent source tree: $Target"
} else {
    Say "  Fetching PenglaiAgent source: $OwnerRepo@$Branch"
    $zipPath = Join-Path ([IO.Path]::GetTempPath()) ("penglai-" + [Guid]::NewGuid().ToString("N") + ".zip")
    $urls = @()
    if ($mirror) {
        $urls += "${mirror}https://github.com/$OwnerRepo/archive/refs/heads/$Branch.zip"
    }
    $urls += "https://codeload.github.com/$OwnerRepo/zip/refs/heads/$Branch"
    $urls += "https://github.com/$OwnerRepo/archive/refs/heads/$Branch.zip"
    try {
        Download-FileWithFallback $urls $zipPath
        Copy-ExpandedSource $zipPath $Target
    } finally {
        Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    }
}

Set-Location $Target
Write-BuildInfo $Target

$uv = Find-Uv
if (-not $uv) {
    Say "  Installing uv-managed Python runtime..."
    $uv = Install-Uv $mirror
}

if ($mirror) {
    $env:UV_PYTHON_INSTALL_MIRROR = "${mirror}https://github.com/astral-sh/python-build-standalone/releases/download"
}

$venvPy = Join-Path $Target ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    & $uv venv ".venv" --python 3.11 --quiet
}
if (-not (Test-Path $venvPy)) {
    throw "Python virtual environment was not created: $venvPy"
}

Say "  Installing Penglai dependencies..."
& $uv pip install --python $venvPy --quiet -i $PipIndex -e . @CoreDeps

if ($env:PENGLAI_INSTALL_VERIFY -eq "1") {
    Say "  Running install-check..."
    & $venvPy ".\penglai" "install-check" "--json"
    if ($LASTEXITCODE -ne 0) { throw "install-check failed." }
}

$settings = @{
    python_path = $venvPy
    project_dir = $Target
}
$settings | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $HOME ".penglai_desktop_settings.json") -Encoding UTF8

Say "Penglai runtime ready: $Target"
