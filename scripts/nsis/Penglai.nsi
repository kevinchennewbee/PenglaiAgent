; Penglai 0.5.11 current-user NSIS Setup.
; Cross-compiled / compiled only on Windows x64. This source is the contract
; for install identity, bilingual UI, and unconditional userData preservation.
; Exact data deletion is completed inside Penglai before the uninstaller runs.
; Native PASS is reserved for win-x64.

!ifndef PENGLAI_VERSION
  !define PENGLAI_VERSION "0.5.11"
!endif
!ifndef PENGLAI_OUTFILE
  !define PENGLAI_OUTFILE "Penglai_0.5.11_windows_x64_setup.exe"
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
!define UPDATE_CACHE "$LOCALAPPDATA\Penglai\0.5\cache\updates"

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

LangString NAME_Desktop ${LANG_SIMPCHINESE} "桌面快捷方式"
LangString NAME_Desktop ${LANG_ENGLISH} "Desktop shortcut"
LangString DESC_App ${LANG_SIMPCHINESE} "安装蓬莱桌面客户端、官方 DSH 核心和内置插件。"
LangString DESC_App ${LANG_ENGLISH} "Install Penglai Desktop, the official DSH core, and bundled plugins."
LangString DESC_Desktop ${LANG_SIMPCHINESE} "在桌面创建蓬莱快捷方式。"
LangString DESC_Desktop ${LANG_ENGLISH} "Create a Penglai shortcut on the desktop."

Function .onInit
  ; Native release automation can force one of the two shipped languages with
  ; /LANG=2052 or /LANG=1033. This is also useful to support teams that run an
  ; English Windows display language but want the Chinese Penglai installer.
  ${GetParameters} $R9
  ${GetOptions} "$R9" "/LANG=" $R8
  ${If} $R8 != ""
    StrCpy $LANGUAGE $R8
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP|MB_SETFOREGROUND "Penglai ${PENGLAI_VERSION} requires 64-bit Windows." /SD IDOK
    Abort
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayVersion"
  ${If} $0 != ""
    ; Compare version numbers numerically, not lexicographically: a plain
    ; string compare would treat "0.10.0" as older than "0.5.0".
    ${VersionCompare} "$0" "${PENGLAI_VERSION}" $R0
    ${If} $R0 == 1
      MessageBox MB_ICONSTOP|MB_SETFOREGROUND "Penglai refuses downgrade from $0 to ${PENGLAI_VERSION}." /SD IDOK
      Abort
    ${EndIf}
    StrCpy $R1 "upgrade"
  ${EndIf}
FunctionEnd

Section "Penglai" SecApp
  ${If} $R1 == "upgrade"
    ${If} $INSTDIR != "$LOCALAPPDATA\Penglai\app\0.5"
      MessageBox MB_ICONSTOP|MB_SETFOREGROUND "Penglai cannot safely upgrade a custom legacy install directory. Uninstall the old version first." /SD IDOK
      Abort
    ${EndIf}
    ; Stage the new payload first. Only replace the live app directory after
    ; the copy succeeds so a failed upgrade keeps the previous program.
    StrCpy $R2 "$INSTDIR.pending"
    RMDir /r "$R2"
    CreateDirectory "$R2"
    SetOutPath "$R2"
!ifndef PENGLAI_PAYLOAD
  !define PENGLAI_PAYLOAD "..\..\dist\runtime-staging-win32-x86_64\payload"
!endif
    File /r "${PENGLAI_PAYLOAD}\*.*"
    IfFileExists "$R2\Penglai.exe" 0 upgrade_copy_failed
    RMDir /r "$INSTDIR.previous"
    ; Stop the running app, then retry the live rename. Explorer, Defender, and
    ; Chromium helpers can keep INSTDIR open after Penglai.exe has already exited.
    StrCpy $R3 "0"
    upgrade_rename_live:
      ExecWait '"$SYSDIR\taskkill.exe" /F /T /IM Penglai.exe' $R4
      ExecWait '"$SYSDIR\taskkill.exe" /F /T /IM "Penglai Helper.exe"' $R4
      Sleep 1000
      ClearErrors
      Rename "$INSTDIR" "$INSTDIR.previous"
      IfErrors 0 upgrade_rename_pending
      IntOp $R3 $R3 + 1
      IntCmp $R3 90 upgrade_rename_fallback upgrade_rename_live upgrade_rename_fallback
    upgrade_rename_pending:
      StrCpy $R3 "0"
    upgrade_rename_pending_retry:
      ClearErrors
      Rename "$R2" "$INSTDIR"
      IfErrors 0 upgrade_rename_ok
      Sleep 1000
      IntOp $R3 $R3 + 1
      IntCmp $R3 90 upgrade_pending_fallback upgrade_rename_pending_retry upgrade_pending_fallback
    upgrade_pending_fallback:
      CreateDirectory "$INSTDIR"
      ExecWait '"$SYSDIR\robocopy.exe" "$R2" "$INSTDIR" /E /IS /IT /R:5 /W:2 /NFL /NDL /NJH /NJS' $R4
      IntCmp $R4 8 upgrade_activate_failed 0 upgrade_activate_failed
      IfFileExists "$INSTDIR\Penglai.exe" 0 upgrade_activate_failed
      RMDir /r "$R2"
      FileOpen $R8 "$TEMP\penglai-setup.log" w
      FileWrite $R8 "phase=pending-copy-fallback r3=$R3 robocopy=$R4$\r$\n"
      FileClose $R8
      Goto upgrade_done
    upgrade_rename_ok:
      IfFileExists "$INSTDIR\Penglai.exe" 0 upgrade_activate_failed
      RMDir /r "$INSTDIR.previous"
      Goto upgrade_done
    upgrade_rename_fallback:
      ; Directory MoveFile can stay blocked (Defender/Search) after Penglai.exe
      ; has exited. Copy the staged payload over the live tree instead of
      ; deleting INSTDIR, and only then drop the pending staging directory.
      CreateDirectory "$INSTDIR.previous"
      CopyFiles /SILENT "$INSTDIR\*.*" "$INSTDIR.previous"
      ExecWait '"$SYSDIR\robocopy.exe" "$R2" "$INSTDIR" /E /IS /IT /R:5 /W:2 /NFL /NDL /NJH /NJS' $R4
      IntCmp $R4 8 upgrade_activate_failed 0 upgrade_activate_failed
      IfFileExists "$INSTDIR\Penglai.exe" 0 upgrade_activate_failed
      RMDir /r "$R2"
      FileOpen $R8 "$TEMP\penglai-setup.log" w
      FileWrite $R8 "phase=activate-copy-fallback r3=$R3 robocopy=$R4$\r$\n"
      FileClose $R8
      Goto upgrade_done
    upgrade_copy_failed:
      RMDir /r "$R2"
      FileOpen $R8 "$TEMP\penglai-setup.log" w
      FileWrite $R8 "phase=copy-failed$\r$\n"
      FileClose $R8
      MessageBox MB_ICONSTOP|MB_SETFOREGROUND "Penglai could not copy the new version. The previous install was left in place." /SD IDOK
      Abort
    upgrade_activate_failed:
      FileOpen $R8 "$TEMP\penglai-setup.log" w
      FileWrite $R8 "phase=activate-failed r3=$R3$\r$\n"
      FileClose $R8
      IfFileExists "$INSTDIR.previous\Penglai.exe" 0 upgrade_abort_keep_live
      RMDir /r "$INSTDIR"
      Rename "$INSTDIR.previous" "$INSTDIR"
      MessageBox MB_ICONSTOP|MB_SETFOREGROUND "Penglai could not activate the new version and restored the previous install." /SD IDOK
      Abort
    upgrade_abort_keep_live:
      MessageBox MB_ICONSTOP|MB_SETFOREGROUND "Penglai could not activate the new version. The previous install was left in place." /SD IDOK
      Abort
    upgrade_done:
  ${Else}
    SetOutPath "$INSTDIR"
!ifndef PENGLAI_PAYLOAD
  !define PENGLAI_PAYLOAD "..\..\dist\runtime-staging-win32-x86_64\payload"
!endif
    File /r "${PENGLAI_PAYLOAD}\*.*"
  ${EndIf}
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

Section /o "$(NAME_Desktop)" SecDesktop
  CreateShortCut "$DESKTOP\Penglai.lnk" "$INSTDIR\Penglai.exe"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecApp} "$(DESC_App)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "$(DESC_Desktop)"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "un.Penglai" SectionUninstall
  ; Default uninstall: app, shortcuts, uninstall registry, update cache.
  ; UserData is always preserved. Penglai's in-app one-shot authorizer performs
  ; any separately confirmed exact category deletion before this uninstaller.
  Delete "$SMPROGRAMS\Penglai\Penglai.lnk"
  Delete "$DESKTOP\Penglai.lnk"
  RMDir "$SMPROGRAMS\Penglai"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
  DeleteRegKey HKCU "Software\Penglai\0.5"
  RMDir /r "${UPDATE_CACHE}"
  ; Only recursively remove the app tree when it is the exact default install
  ; location. A custom install directory must not be blindly RMDir /r'd.
  StrCpy $R0 "$INSTDIR"
  StrCpy $R1 "$LOCALAPPDATA\Penglai\app\0.5"
  ${If} $R0 S== $R1
    ExecWait '"$SYSDIR\taskkill.exe" /F /T /IM Penglai.exe' $R4
    ExecWait '"$SYSDIR\taskkill.exe" /F /T /IM "Penglai Helper.exe"' $R4
    Sleep 1000
    RMDir /r "$INSTDIR.pending"
    RMDir /r "$INSTDIR.previous"
    StrCpy $R3 "0"
    uninstall_rmdir_retry:
      RMDir /r "$INSTDIR"
      IfFileExists "$INSTDIR\Penglai.exe" 0 uninstall_rmdir_done
      Sleep 1000
      IntOp $R3 $R3 + 1
      IntCmp $R3 30 uninstall_rmdir_done uninstall_rmdir_retry uninstall_rmdir_done
    uninstall_rmdir_done:
  ${Else}
    DetailPrint "Keeping custom install directory $INSTDIR (not the default app tree)."
  ${EndIf}
SectionEnd
