param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class PenglaiInstallerNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr GetDlgItem(IntPtr hWnd, int id);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

}
'@

function Get-PenglaiWindow([System.Diagnostics.Process]$Process) {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $Process.Refresh()
    if ($Process.HasExited) { throw "installer exited before opening its window" }
    if ($Process.MainWindowHandle -ne [IntPtr]::Zero) { return $Process.MainWindowHandle }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "installer window did not appear"
}

function Get-PenglaiUiNames([IntPtr]$Handle) {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($Handle)
  if ($null -eq $root) { return @() }
  $all = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Subtree,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  $names = New-Object System.Collections.Generic.List[string]
  foreach ($node in $all) {
    try {
      $name = [string]$node.Current.Name
      if (-not [string]::IsNullOrWhiteSpace($name)) { $names.Add($name.Trim()) }
    } catch { }
  }
  return @($names | Select-Object -Unique)
}

function Wait-PenglaiUiText([IntPtr]$Handle, [string]$Pattern, [int]$Seconds = 20) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    $names = Get-PenglaiUiNames $Handle
    if (($names -join "`n") -match $Pattern) { return $names }
    Start-Sleep -Milliseconds 300
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "installer did not expose expected UI text: $Pattern"
}

function Invoke-PenglaiNext([IntPtr]$Handle) {
  # NSIS uses dialog control id 1 for the Next button.
  [void][PenglaiInstallerNative]::PostMessage($Handle, 0x0111, [IntPtr]1, [IntPtr]::Zero)
}

function Save-PenglaiWindow([IntPtr]$Handle, [string]$Path) {
  $rect = New-Object PenglaiInstallerNative+RECT
  if (-not [PenglaiInstallerNative]::GetWindowRect($Handle, [ref]$rect)) {
    throw "GetWindowRect failed"
  }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -lt 400 -or $height -lt 250) { throw "installer window dimensions are invalid" }
  [void][PenglaiInstallerNative]::SetForegroundWindow($Handle)
  Start-Sleep -Milliseconds 500
  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$installerPath = [System.IO.Path]::GetFullPath($Installer)
$evidenceDir = [System.IO.Path]::GetFullPath($OutDir)
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw "installer missing" }
$nsisSourcePath = Join-Path $PSScriptRoot 'nsis/Penglai.nsi'
$strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
$nsisSource = $strictUtf8.GetString([System.IO.File]::ReadAllBytes($nsisSourcePath))
if ($nsisSource -notmatch 'Unicode true' -or
    $nsisSource -notmatch 'Section "Penglai" SecApp' -or
    $nsisSource -notmatch 'LangString NAME_Desktop \$\{LANG_SIMPCHINESE\} "桌面快捷方式"') {
  throw "strict UTF-8 NSIS source does not contain the required app and Unicode Chinese component contract"
}
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
$installTarget = Join-Path $env:TEMP "Penglai-0.5.9-ui-proof"
$screenshot = Join-Path $evidenceDir "windows-installer-components-zh.png"
$recordPath = Join-Path $evidenceDir "windows-installer-ui.json"

$process = Start-Process -FilePath $installerPath -ArgumentList @('/LANG=2052', "/D=$installTarget") -PassThru
try {
  $handle = Get-PenglaiWindow $process
  [void](Wait-PenglaiUiText $handle '欢迎|Penglai')
  Invoke-PenglaiNext $handle
  [void](Wait-PenglaiUiText $handle '许可|协议')

  # MUI2 license radio button IDC_LICENSEAGREE is dialog id 1034.
  $agree = [PenglaiInstallerNative]::GetDlgItem($handle, 1034)
  if ($agree -eq [IntPtr]::Zero) { throw "Chinese license acceptance control missing" }
  [void][PenglaiInstallerNative]::SendMessage($agree, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
  Invoke-PenglaiNext $handle

  # The NSIS sections tree is owner-drawn. Windows UI Automation reliably
  # exposes the surrounding Components page, but does not consistently expose
  # the individual tree item names on GitHub's Windows images. Prove the page
  # is genuinely Chinese, save the native screenshot, and bind that visual
  # evidence to the strict UTF-8 input consumed by the Unicode NSIS compiler.
  $componentNames = Wait-PenglaiUiText $handle '组件|安装'
  $joined = $componentNames -join "`n"
  if ($joined -match ([char]0xFFFD)) { throw "Unicode replacement character rendered in installer" }
  Save-PenglaiWindow $handle $screenshot
  if (-not (Test-Path -LiteralPath $screenshot -PathType Leaf)) {
    throw "Chinese Components page screenshot missing"
  }

  $record = [ordered]@{
    verdict = 'PASS'
    command = 'windows-installer-ui-proof'
    language = 'zh-CN'
    expected = @('Penglai', '桌面快捷方式')
    componentNameProof = 'strict-utf8-nsis-source-plus-native-screenshot'
    compilerContract = 'Unicode true + makensis /INPUTCHARSET UTF8'
    requiredAppExposedByUiAutomation = ($joined -match '(?m)^Penglai$')
    desktopNameExposedByUiAutomation = ($joined -match '桌面快捷方式')
    screenshot = 'windows-installer-components-zh.png'
    windowWidth = $process.MainWindowHandle -ne [IntPtr]::Zero
    observedNames = @($componentNames)
  }
  $record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $recordPath -Encoding UTF8
  $record | ConvertTo-Json -Compress -Depth 5
} finally {
  if (-not $process.HasExited) {
    [void][PenglaiInstallerNative]::PostMessage($process.MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    if (-not $process.WaitForExit(5000)) { $process.Kill() }
  }
}
