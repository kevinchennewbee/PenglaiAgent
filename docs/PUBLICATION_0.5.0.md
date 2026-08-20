# PenglaiAgent 0.5.0 公开发布合同

## 1. 当前授权与范围

2026-08-20，Owner 明确授权把经过脱敏、隐私、安全、许可证和 clean-room 检查的 0.5.0 public export 同步到公开仓库 `kevinchennewbee/PenglaiAgent` 的 `main`，更新 README 与官网，并发布 `v0.5.0`。

本次只有一个用户安装包：

```text
Penglai_0.5.0_macos_aarch64.dmg
```

它面向 Apple Silicon（M 系列）Mac。Intel macOS 与 Windows 保留为后续路线，不是 0.5.0 的发布资产或支持承诺。公开发布不得改写 Git 历史；用普通提交替换 `main` 当前树，旧版本仍可从历史 tag/Release 查阅。

## 2. public-export 是唯一公开源树

私有仓库含状态、执行合同、验收原始记录和本机操作材料，不能整库推送。`prepare:public-export` 必须：

1. 从 clean private `main` 的 exact `candidateSourceSha` 按 allowlist 导出产品源码、锁文件、构建脚本、公开文档、许可与公开测试。
2. 规范 mode、mtime、路径顺序和换行，生成逐文件 `public-export-manifest.json` 与稳定 `publicExportTreeSha256`。
3. 拒绝 `.git`、dist/cache、raw evidence、日志、截图、QR、聊天正文、真实音频、token、cookie、App Secret、API key、私钥、Owner 绝对路径和无 provenance 的第三方内容。
4. 在隔离目录执行 lock-only install、构建、测试、secret/license/SBOM 检查，证明不依赖私有仓路径。
5. 发布仓当前树必须与该 export tree 内容等价；公开 Release 使用已验收的同一 DMG bytes，不在上传前重建偷换。

private/public Git SHA 可以不同，但必须记录 private source SHA、public export tree hash、public commit SHA 和安装包 SHA-256。

## 3. 公开源码与发行资产

公开树至少包含 MIT `LICENSE`、README、SECURITY、CONTRIBUTING、锁文件、release contract、runtime manifests、SBOM/notices 生成器、DSH overlay 的版本/校验/ADR/parity tests，以及可运行的公开测试。workspace 包保持 `private:true` 只用于防止误发 npm，不代表闭源。

v0.5.0 Release 的 canonical asset set：

```text
Penglai_0.5.0_macos_aarch64.dmg
release-manifest.json
SBOM.cdx.json
THIRD_PARTY_NOTICES.txt
SHA256SUMS
public-export-manifest.json
```

0.5.0 不发布 `desktop-v0.5` updater channel，也不使用测试 fixture key 伪造正式签名。后续版本只有在 Owner 提供独立正式签名密钥、manifest 与 payload 验签链完成后，才可启用 assisted update channel。

## 4. 必须公开说明的边界

- `trustTier=community-verified`；app ad-hoc sealed，没有 Developer ID、notarization 或 staple。
- SHA-256、SBOM、notices 与可审计源码用于完整性和供应链核对，不等于 Apple 发行者认证。
- 0.4.1 → 0.5.0 是 fresh install；不迁移、读取或删除旧会话、凭据和设置。
- fresh 默认只启用 DSH core 与 Penglai Center；IM、ASR、MOSS-TTS、Context、Memory、Budget、Companion 由用户按需安装、启用和配置。
- 微信私聊文字与入站 SILK → 本地 SenseVoice → DSH → 文字回复已完成真实链路；不把当前未稳定实证的微信原生绿色语音气泡写成能力。
- 飞书、MOSS 出站语音以及各组合能力只按实际验证范围描述，不能以 fixture 或 UI 卡片冒充 live PASS。
- secret 存在本机 app-private credentials YAML；renderer 不可读取明文。同 OS 用户的高权限进程仍可能读取本地文件。
- 无 Penglai 云账户、同步或遥测；Context 只索引授权目录且不改源文件；Companion 默认关闭并禁止无人值守工具。
- 不提供关闭 Gatekeeper 的指导。首次打开可能出现系统信誉提示。

## 5. 发布顺序

1. clean private main 完成源码、测试、secret、license、SBOM 与 public-export 门。
2. 从该 source 构建、封装、校验并安装验证 exact Apple Silicon DMG。
3. 把 exact DMG 复制到 Owner 下载目录供人工复测；Owner 已授权本轮在自动门通过后继续公开发布。
4. 在干净公开 clone 中，用 normal commit 把 `main` 当前树替换为 exact public export；不触碰来源不明的旧本地 checkout。
5. 从公开 commit clean clone 重跑 source-equivalence、build/test/secret/license。
6. 更新并推送保留现有视觉风格的 `gh-pages` 官网。
7. 创建 `v0.5.0` Release，上传 exact asset set；重新下载并逐项核对名称、大小与 SHA-256。
8. 回读公开仓库、Release、下载链接和官网。任一步失败都停止，不覆盖已有 tag/asset。

## 6. 完成口径

只有当 private source、public export、public `main`、Release asset 和下载回读全部同源，secret/privacy/license 扫描干净，且公开文案与真实支持边界一致，才可声明 0.5.0 已发布。Intel/Windows、正式 OS 签名、updater channel 与未完成 live 能力留在后续路线。
