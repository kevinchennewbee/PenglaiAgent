; Penglai 0.5.2 current-user NSIS Setup.
; Cross-compiled / compiled only on Windows x64. This source is the contract
; for install identity, bilingual UI, default-preserve userData, and
; capability-bound complete delete. Native PASS is reserved for win-x64.

!ifndef PENGLAI_VERSION
  !define PENGLAI_VERSION "0.5.2"
!endif
!ifndef PENGLAI_OUTFILE
  !define PENGLAI_OUTFILE "Penglai_0.5.2_windows_x64_setup.exe"
!endif

Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
Name "Penglai"
BrandingText "Penglai ${PENGLAI_VERSION}"
OutFile "${PENGLAI_OUTFILE}"
InstallDir "$LOCALAPPDATA\Penglai\app\0.5"
InstallDirRegKey HKCU "Software\Penglai\0.5" "InstallDir"

!define APP_ID "Penglai.DSH.0.5"
!define UPGRADE_CODE "8F3C1A62-0B77-4D2E-9C41-6A1F2E7B9D50"
!define PRODUCT_PUBLISHER "Penglai"
!define USERDATA "$LOCALAPPDATA\Penglai\0.5"
!define UPDATE_CACHE "$LOCALAPPDATA\Penglai\0.5\cache\updates"
!define HELPER "$INSTDIR\runtime\helpers\penglai-windows-host.exe"
!define CAPABILITY "${USERDATA}\uninstall\deletion-capability.json"

!ifdef PENGLAI_ICON
  !define MUI_ICON "${PENGLAI_ICON}"
  !define MUI_UNICON "${PENGLAI_ICON}"
  Icon "${PENGLAI_ICON}"
  UninstallIcon "${PENGLAI_ICON}"
!endif

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "WinVer.nsh"
!include "x64.nsh"

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!ifndef PENGLAI_LICENSE
  !define PENGLAI_LICENSE "license.rtf"
!endif
!insertmacro MUI_PAGE_LICENSE "${PENGLAI_LICENSE}"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

LangString DESC_Desktop ${LANG_SIMPCHINESE} "桌面快捷方式"
LangString DESC_Desktop ${LANG_ENGLISH} "Desktop shortcut"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Penglai 0.5.2 requires 64-bit Windows."
    Abort
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayVersion"
  ${If} $0 != ""
    ; Compare version numbers numerically, not lexicographically: a plain
    ; string compare would treat "0.10.0" as older than "0.5.0".
    ${VersionCompare} "$0" "${PENGLAI_VERSION}" $R0
    ${If} $R0 == 1
      MessageBox MB_ICONSTOP "Penglai refuses downgrade from $0 to ${PENGLAI_VERSION}."
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

Section "Penglai" SecApp
  SetOutPath "$INSTDIR"
!ifndef PENGLAI_PAYLOAD
  !define PENGLAI_PAYLOAD "..\..\dist\runtime-staging-win32-x86_64\payload"
!endif
  File /r "${PENGLAI_PAYLOAD}\*.*"
  CreateDirectory "$SMPROGRAMS\Penglai"
  CreateShortCut "$SMPROGRAMS\Penglai\Penglai.lnk" "$INSTDIR\Penglai.exe"
  WriteRegStr HKCU "Software\Penglai\0.5" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Penglai\0.5" "UpgradeCode" "${UPGRADE_CODE}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayName" "Penglai"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayVersion" "${PENGLAI_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "NoRepair" 1
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section /o "$(DESC_Desktop)" SecDesktop
  CreateShortCut "$DESKTOP\Penglai.lnk" "$INSTDIR\Penglai.exe"
SectionEnd

Section "un.Penglai" SectionUninstall
  ; Default uninstall: app, shortcuts, uninstall registry, update cache.
  ; UserData is preserved unless a one-shot capability file exists.
  Delete "$SMPROGRAMS\Penglai\Penglai.lnk"
  Delete "$DESKTOP\Penglai.lnk"
  RMDir "$SMPROGRAMS\Penglai"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
  DeleteRegKey HKCU "Software\Penglai\0.5"
  RMDir /r "${UPDATE_CACHE}"
  IfFileExists "${CAPABILITY}" 0 skip_data
    IfFileExists "${HELPER}" 0 skip_data
      nsExec::ExecToLog '"${HELPER}" delete-plan --file "${CAPABILITY}" --token capability --root "${USERDATA}"'
      Delete "${CAPABILITY}"
  skip_data:
  ; Only recursively remove the app tree when it is the exact default install
  ; location. A custom install directory must not be blindly RMDir /r'd.
  StrCpy $R0 "$INSTDIR"
  StrCpy $R1 "$LOCALAPPDATA\Penglai\app\0.5"
  ${If} $R0 S== $R1
    RMDir /r "$INSTDIR"
  ${Else}
    DetailPrint "Keeping custom install directory $INSTDIR (not the default app tree)."
  ${EndIf}
SectionEnd
