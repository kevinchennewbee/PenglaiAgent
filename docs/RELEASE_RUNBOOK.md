# Penglai 0.5.0 Apple Silicon 发布 Runbook

本 runbook 对应 Owner 于 2026-08-20 授权的 **`v0.5.0` 历史公开发布**。唯一已发布客户端资产是 `Penglai_0.5.0_macos_aarch64.dmg`。0.5.1 三端候选见 `docs/0.5.1/RELEASE_RUNBOOK.md`，不要把本文件当成现行 0.5.1 合同。

## 1. 私有源冻结

```bash
git status --short --branch
git fetch origin
git pull --ff-only origin main
git rev-parse HEAD
git rev-parse origin/main
```

要求 branch=`main`、HEAD=origin/main、无未知 dirty/untracked。发布合同、README、公开文档与代码门完成后，运行 format/type/unit/contract/integration/security/chaos、versions/contracts/dependencies、secret/license/SBOM。失败即停止，不 stash/reset/clean/force。

## 2. deterministic public export

1. `prepare:public-export --clean-room` 按 allowlist 生成 `.tmp-public-export/tree`。
2. 检查逐文件 mode/size/SHA-256/license 与稳定 `publicExportTreeSha256`。
3. 拒绝私有 state/handoff/evidence、日志、QR、聊天/语音、token/cookie/key/App Secret、Owner path、未许可二进制和 private key。
4. 在 export tree lock-only 安装、typecheck，并对公开树再次执行 secret/license/SBOM。
5. 记录 private source SHA、private Git tree 与 export tree hash。

## 3. 构建唯一 target

在 Apple Silicon native macOS runner：

1. 从 exact source/export input 读取 pinned Node 22.22.2、Electron 43.4.0、DSH 0.1.0-rc.8、profile seed、插件 tarballs 和 target-native closure。
2. 执行 build、pack plugins、closure/profile/arch/fuses/integrity/license/SBOM 检查。
3. 对 `.app` ad-hoc seal；seal 后不得修改。
4. `codesign --verify --deep --strict`，创建只读 DMG，`hdiutil verify`。
5. 只读挂载并核对 volume、Applications link、arm64 Mach-O、embedded Node/DSH、release identity 与 app seal。
6. canonical 文件名只能是：

```text
Penglai_0.5.0_macos_aarch64.dmg
```

## 4. exact installed 验证

从 DMG 安装到隔离 Applications/test userData，启动 packaged app 并观察真实 BrowserWindow、official DSH HTTP/WebSocket、进程树、loader inventory 与资源清理。至少验证：

- fresh 向导、中文默认、中英切换、light/dark/system、BYOK、Workspace、真实 Turn。
- fresh profile 只有 DSH core + Center；全部可选插件默认 absent/disabled。
- Center 真实安装/启用/停用/卸载与 loader actual 一致，设置子菜单与模型下载进度可见。
- 微信私聊文字链和入站 SILK → 本地 ASR → exact DSH Turn → 原渠道回复。
- ASR 内部 metadata 只进入 model pre-step，不作为用户正文显示。
- app quit 后 owned DSH、worker、socket、timer、DB handle 与临时音频为零。
- trust 文案诚实显示 ad-hoc/not notarized；不声称 Developer ID 或 silent auto-update。

真实 key/token、QR、身份、正文、语音与模型输出不得写入 evidence，只保留 digest、bytes、duration、codec、opaque route/operation id 与状态。

## 5. 发行配套资产

生成并冻结：

```text
Penglai_0.5.0_macos_aarch64.dmg
release-manifest.json
SBOM.cdx.json
THIRD_PARTY_NOTICES.txt
SHA256SUMS
public-export-manifest.json
```

`SHA256SUMS` 覆盖其余资产的 exact bytes。0.5.0 不上传 fixture 签名、不发布 `latest.json` 或 `desktop-v0.5` updater channel。正式 updater key 缺失不是本次手动下载 Release 的伪签理由。

## 6. 公开 main

1. 使用干净 public clone；来源不明的旧本地 checkout 保持不动。
2. `git fetch` / `pull --ff-only`，确认 remote 未漂移、`v0.5.0` 不存在。
3. 只删除公开仓当前 tracked tree，保留 `.git` 与历史；复制 exact public export。
4. 以普通 `main` commit 提交，重跑 public clean-clone type/test/secret/license/SBOM/source-equivalence。
5. 再次 pull --ff-only 后普通 push，不 force，不改写旧 tag/release。

## 7. 官网与 GitHub Release

- 官网保留现有视觉风格，更新为 DSH-only 架构、Apple Silicon 下载、插件组合、隐私与 community trust 边界。
- README、官网、release notes、About/Update 文案必须一致。
- 创建 `v0.5.0` Release，上传 exact asset set；资产从私有验收目录复制，不重新构建。
- 从 GitHub 重新下载所有资产，验证名称、数量、size 与 SHA-256；回读 tag→public commit、Release latest 状态和官网链接。

任何已存在 tag/asset、远端非快进、secret 命中、hash 漂移或下载回读不一致都停线，不覆盖、不删除、不用更强手段重试。

## 8. 完成与后续

完成记录必须区分 source gates、exact DMG、installed/live、public main、Release 回读和官网在线状态。0.5.0 发布后，Intel/Windows、Developer ID/notarization、正式 updater signing/channel、更多 reviewed DSH 插件进入后续版本，不反向扩张本次声明。
