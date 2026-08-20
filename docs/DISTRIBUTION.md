# Penglai 0.5.0 Apple Silicon 发行合同

## 1. 候选定位

0.5.0 先在私有库完成 exact candidate，再把 deterministic public-export 和同一 Apple Silicon DMG 同步到开源 `PenglaiAgent`。Owner 已明确授权本轮公开发布。

固定 trust tier：

- `community-verified`
- macOS：ad-hoc seal、Hardened Runtime 可按包配置验证，但无 Developer ID/notarization/staple
- installer/updater/manifest/checksums：SHA-256 与可用的独立签名；0.5.0 DMG 本身是 ad-hoc，不伪装 Developer ID/notary

用户已接受该边界。验证器必须证明“没有 OS publisher trust 且文案诚实”，不能把 notary/Authenticode 伪造为 PASS 或用 `WAIVED` 掩盖。

## 2. canonical 输入

一次 release set 的不可变输入：

- clean private `main` 的 `candidateSourceSha` 与 git tree。
- deterministic `publicExportTreeSha256`。
- `pnpm-lock.yaml` 和每个 workspace version `0.5.0`。
- machine-readable release contract。
- pinned Electron、Node、DSH、Cordis、Pi/Models、飞书 SDK、微信参考合同、SenseVoice/sherpa-onnx、MOSS-TTS-Nano/ONNX Runtime、SILK/Opus 音频转换依赖。
- Apple Silicon Electron/Node downloads 的 exact URL、size、SHA-256。
- profile seed、Penglai overlay、first-party plugin tarballs 和 checksums。
- Apple Silicon voice native closure、模型 manifest/index、模型来源/许可证/hash；大模型权重不进入 DMG，由用户明确同意后按固定 manifest 下载。
- Context document extraction/SQLite closure与Context/Memory/Budget/Companion tarballs、schemas和licenses；不得依赖系统LibreOffice或旧Penglai Host。
- icons、DMG background、NSIS resources、zh/en locale catalogs。
- updater public key/key id；final private key只通过外部 secret 注入。

任何输入变化产生新的 candidate/build id，之前 app/installers/evidence/signatures 全部 stale。不能 patch 已封签 app 或安装包。

## 3. 用户安装包

exact 一件：

```text
Penglai_0.5.0_macos_aarch64.dmg
```

平台与 runner 规则以 `docs/PLATFORM_MATRIX.md` 为准。DMG/Setup 是用户安装包；signature、manifest、SBOM、notices、checksums 与 updater payload 是配套发行资产。

## 4. bundle 结构

### macOS

```text
Penglai.app/Contents/
├─ Info.plist
├─ MacOS/Penglai
├─ Frameworks/                  # exact darwin target Electron frameworks
└─ Resources/
   ├─ app.asar                  # Electron main/preload/static bootstrap
   ├─ app.asar.unpacked/        # only audited native/runtime files
   ├─ runtime/node/bin/node
   ├─ dsh/
   ├─ profile-seed/
   ├─ plugins/*.tgz
   ├─ voice-runtime/            # exact darwin arch native engines/codecs; no model weights
   ├─ model-manifests/          # signed/pinned metadata only
   ├─ integrity.json
   ├─ release-info.json
   ├─ licenses/
   ├─ SBOM.cdx.json
   └─ THIRD_PARTY_NOTICES.txt
```

### Windows（future target，非 0.5.0 Release）

```text
%LOCALAPPDATA%\Programs\Penglai\
├─ Penglai.exe
├─ resources\
│  ├─ app.asar
│  ├─ app.asar.unpacked\
│  ├─ runtime\node.exe
│  ├─ dsh\
│  ├─ profile-seed\
│  ├─ plugins\*.tgz
│  ├─ voice-runtime\           # exact win32-x64 native engines/codecs; no model weights
│  ├─ model-manifests\
│  ├─ integrity.json
│  ├─ release-info.json
│  ├─ licenses\
│  ├─ SBOM.cdx.json
│  └─ THIRD_PARTY_NOTICES.txt
└─ Uninstall Penglai.exe
```

具体 Electron layout 由 pinned maker 决定，验证器按 contract 读取，不能把上面示意当字符串匹配。

## 5. build pipeline

固定顺序：

1. 确认 `HEAD=origin/main`、dirty=false，记录 source/tree。
2. 从 allowlist 生成 clean public-export，记录 export tree hash。
3. 在 clean temp root 执行 lockfile-only install；禁止 postinstall 下载未固定 binary。
4. 跑 format/type/unit/contract/integration/security/closure/profile/voice/context-memory-budget-companion/public-export gates。
5. 按 target 获取并重验 Electron/Node/runtime/voice-native inputs。
6. 构建 app code、DSH closure、profile seed、八个first-party plugins、voice runtime、document extraction closure 与 model manifests。
7. 在 staging 中验证 platform/arch、packlist、licenses、SBOM、secret/owner path。
8. 组装 target app，写 unfrozen `release-info`；此时 artifact hash 字段必须为空。
9. 启动 packaged app 做 pre-installer smoke 与 fuses/process/official DSH handshake。
10. 封签 app：macOS ad-hoc seal；Windows 记录 no Authenticode community identity。
11. 从 sealed app 生成 DMG/NSIS；安装包生成后不修改。
12. 从 exact installer fresh install，完成 installed E2E、voice round-trip、Context/Memory/Budget/Companion、IM audio、upgrade/uninstall suites。
13. 生成 per-target artifact/evidence manifest 并导入 release set。
14. Apple Silicon target验收后生成 SBOM/notices/release manifest/SHA256SUMS。
15. 用 Owner updater signing key签 installer/manifest/checksums；无 final key 时先用 fixture 跑完并停在精确 AWAITING。
16. 重验 exact asset set，冻结 release manifest，更新 STATE 并回交 Codex。

build 不通过 shell 插入 secret；日志对环境变量只记录“present/absent”和 key id，不记录值。

## 6. release identity phases

### UNFROZEN

- 已知 source/export/target/input hashes。
- artifact hash、signature、installed evidence 可以为空。
- 若携带旧 artifact hash 或 READY 状态，verifier 必须失败。

### TARGET_BUILT

- 单 target app/installer 已生成。
- 绑定 source/export/build/target/input。
- 只有命中当前唯一 target 后才能进入完整 release set。

### TARGET_ACCEPTED

- exact target installer installed E2E、lifecycle、security、native flag 完整。
- artifact/signature/evidence 同源。

### RELEASE_SET_FROZEN

- Apple Silicon target 已 TARGET_ACCEPTED。
- exact-set、SBOM、notices、signatures、live、public-export 完整。
- `HEAD=origin/main`、dirty=false。
- 只允许写 `READY_FOR_CODEX_0_5_ACCEPTANCE`，不允许写 published。

冻结后任何源文件、lock、resource、manifest、signature、artifact 或 evidence 变化都使状态回到 UNFROZEN。

## 7. app-private bootstrap

首次启动：

1. 解析 0.5 generation layout。
2. 检查 legacy 0.4.1，只读显示 clean-install 边界。
3. 创建 userData/DSH_HOME/credential/IM/update directories 并应用权限/ACL。
4. 校验 bundle integrity、runtime target、DSH closure、profile seed、八个first-party plugins、voice/document native closure 与 model manifests。
5. staging profile → loader dry-run → inventory/schema verify → atomic commit。
6. 用 absolute embedded Node 启动 owned DSH。
7. official HTTP/WebSocket/typert handshake 健康后加载 DSH Web。
8. 未完成 onboarding 时经认证代理同源加载 pre-DSH `/wizard`（ADR 0030）；ledger COMPLETE 后切换 official DSH Web 并恢复 Workspace/Session。

失败显示有限恢复页：错误类、redacted diagnostics、重试、打开日志、重建 0.5 profile（明确影响）。不得 fallback repo/global DSH。

## 8. profile 与 plugin migration

profile schema、Center catalog、IM DB、onboarding、update ledger 分别版本化。事务必须有：

- from/to 和 compatibility range。
- staging/backup/journal/verify/commit/rollback。
- crash injection 与重放测试。
- failure 后旧 active profile 可启动或明确 repair required。
- backup 不复制明文 credential 到新的非受控位置。

0.4.1 不在 migration range；检测到未知 generation fail closed，不猜测兼容。

## 9. fuses 与 Electron hardening

至少验证：

- `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`（确需例外必须 ADR）。
- renderer 无任意 IPC、filesystem、process、shell、updater、credential access。
- preload capability allowlist、schema validation、origin/window binding。
- Electron fuses 真正写入 packaged binary；verifier 读取实际 binary，不读配置字符串。
- 生产无 devtools/remote debugging/test fixture endpoint；诊断模式需本地显式开关和 redaction。
- navigation/window-open/download/CSP/session permissions fail closed。

`verify:fuses` 看到 INCOMPLETE 必须 non-zero；不能再出现“日志说失败、进程 exit 0”。

## 10. macOS DMG

每个 arch 独立执行：

- `CFBundleName=Penglai`、display/name/executable/About/version/bundle id 正确。
- app 内所有 Mach-O 与 target arch 匹配；无另一个 arch 的 runtime 偷混。
- ad-hoc seal 后 `codesign --verify --deep --strict` PASS，记录 `signatureKind=adhoc`。
- DMG 为只读压缩格式，volume/layout/Applications symlink 正确。
- `hdiutil verify`、只读挂载、从挂载卷重新验 app seal/integrity。
- 把 app 安装到 clean user Applications 后从该路径跑 installed E2E。
- no Developer ID/notary/staple/spctl trust 不能写 PASS；release identity明确 false。

未来增加 x64 时，arm64 和 x64 artifact hash、runtime hash、evidence 必须分开，不能用一个 app 复制改名。

## 11. Windows NSIS（future target）

- x64 Electron、embedded `node.exe`、DSH closure、voice native engines/codecs 全部 target exact。
- current-user install、SimpChinese/English、start menu、可选 desktop shortcut、Apps & Features entry。
- 安装/repair/downgrade/running-process/路径含空格中文测试。
- Windows Job Object/等价机制保证 owned process tree 退出，无孤儿 node.exe。
- credentials/current data root 使用当前用户 ACL，拒绝 junction/reparse escape。
- 默认卸载保留 userData；complete delete 按 signed deletion plan 精确执行。
- 无 Authenticode 时 identity 记录 false，UI/docs 诚实；不能用 minisign 冒充 publisher。

NSIS silent flags只供自动化 clean fixture 使用；产品默认必须有用户可见确认。测试脚本不能把 silent install 的成功冒充普通 UI/语言/卸载体验已经人工看过。

## 12. artifact manifest

每个 target manifest 至少包含：

```json
{
  "schemaVersion": 1,
  "product": "Penglai",
  "version": "0.5.0",
  "candidateKind": "public-publication-candidate",
  "trustTier": "community-verified",
  "candidateSourceSha": "...",
  "sourceTree": "...",
  "publicExportTreeSha256": "...",
  "target": "darwin-aarch64",
  "buildId": "...",
  "installer": "Penglai_0.5.0_macos_aarch64.dmg",
  "installerSha256": "...",
  "installerSize": 0,
  "signatureKind": "minisign",
  "signatureKeyId": "...",
  "osCodeSignature": "adhoc",
  "notarized": false,
  "authenticode": false,
  "runtimeManifestSha256": "...",
  "sbomSha256": "...",
  "installedEvidenceSha256": "...",
  "runnerNative": true
}
```

字段必须来自实际检查，不能从期望 config 抄写。0.5.0 release set manifest 只列 Apple Silicon target，并验证 source/export/version/trust 一致。

## 13. hard failure

- dirty source、HEAD 与 origin/main 不同、source/export hash mismatch。
- unfrozen identity 携带旧 artifact/live/READY。
- 目标 closure 含错误 OS/arch 或未固定下载。
- voice native closure 混入其他 target、模型下载未校验签名/hash、模型权重被偷偷打进安装包，或生产依赖系统 Python/ffmpeg/PATH。
- app 依赖 PATH/repo/global/node_modules/first-run install。
- bundle 存在 fixture/private key/secret/owner path/未许可 binary。
- fuses/signing/installer/installed/voice/Context/Memory/Budget/Companion/IM-audio/upgrade/uninstall 任一 INCOMPLETE 却 exit 0。
- translated/emulated evidence 冒充 native。
- 三安装包少一个、多一个、空文件、改名复用或不属同一 release set。
- 0.4.1 data 被读取迁移或删除。
- community candidate 被写成 notarized/Authenticode/public release。

## 14. 公开边界

本合同结束在 private release set freeze。开源同步的未来步骤见 `docs/PUBLICATION_0.5.0.md`；没有用户新授权，不得执行。
