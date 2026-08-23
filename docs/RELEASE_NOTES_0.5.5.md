# Penglai 0.5.5 release notes

Status: released. The immutable bilingual [`v0.5.5`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.5)
Release was published from source commit `2136ff691afa8bdbefa3079236426a72a3851237`.
All three native targets passed and the ten public assets were downloaded and
verified again after publication.

Trust tier: `community-verified`. This is not silent auto-update.

## English

Penglai 0.5.5 moves from official DeepSeek Harness `0.1.1-rc.1` to
`0.1.1-rc.2`. DSH remains the only agent core. Apple Silicon
(`darwin-aarch64`), Intel Mac (`darwin-x86_64`), and Windows x64
(`win32-x86_64`) were built from one merged source commit.

### The short version

- Penglai Office and Penglai Memory are now bundled, required, and enabled on a
  fresh profile.
- Mobile Messaging, SenseVoice speech recognition, MOSS-TTS voice generation,
  and Companion are bundled but remain opt-in.
- The old Office Reader and separate Personal Context product surfaces are gone.
- Weixin and Feishu use one text/image/file/audio adapter contract.
- Enabling ASR adds desktop microphone input; enabling TTS adds local preview
  and supported audio output. Their large model weights still download on
  demand.
- Plugin Center can consume later signed rc.2 catalog Releases without requiring
  a new desktop build merely to change the plugin list.

### Penglai Office

The old read-only catalog plugin is replaced by a first-party Office plugin. Its
typed operation set covers DOCX, XLSX, PPTX, and PDF inspection, creation,
planned edits, preview, commit, and undo. It includes templates and an OFL
Chinese font for PDF output.

Models cannot supply arbitrary host paths, run macros, or silently commit a
write. Workspace scope, opaque handles, action-specific confirmation, and
host-side validation remain part of the operation. LibreOffice is an external
acceptance tool, not a user dependency.

### Penglai Memory

Memory now presents one DSH plugin and one settings surface. It combines:

- personal facts that the user deliberately keeps;
- memory isolated to the current official Workspace;
- session candidates that are not silently promoted;
- explicitly authorised local folders with provenance and revocation;
- graph visualisation, correction, forgetting, export/import migration, and
  SOP promotion to the official DSH Skills location.

Mnemon 0.2.4 is the only recall engine and is included in the installer. A
Workspace never selects or reads another Workspace's memory. Global memory,
forgetting, migration commit, and reusable SOP changes require the relevant
visible confirmation.

### Messaging, attachments, and voice

Mobile Messaging handles Weixin and Feishu through one adapter registry. Text,
images, files, and audio all enter the official DSH Session pipeline. Images use
the official DSH image store. Office files and audio use opaque Penglai handles
instead of being disguised as image attachments.

SenseVoice and MOSS-TTS are present as code in every installer but default off.
Their model pages explain the download before fetching pinned weights. Missing
weights or a disabled voice plugin cannot prevent ordinary DSH conversation.

### Desktop reliability

- The first-run guide covers language, privacy, official provider/model
  selection, a real credential test, official Workspace selection, and the
  first official DSH Turn.
- Back, retry, restart/resume, invalid Workspace rejection, and an empty-key
  honest stop are executable acceptance cases.
- Updater discovery runs in the desktop main process, not the renderer. It uses
  immutable versioned manifests, exact hashes, Penglai signatures, and explicit
  user confirmation.
- Windows NSIS source is compiled as UTF-8 and has a native screenshot gate for
  Simplified Chinese component labels.
- Plugin actions show a normal install/enable or disable path. Loader phases,
  hashes, permissions, diagnostics, update, and rollback remain under the
  advanced disclosure.

### What is inside the installer

Each native installer contains nine first-party code packages: Plugin Center,
Mobile Messaging, the hidden reference fixture, ASR, MOSS-TTS, Memory, Office,
the hidden advanced budget control, and Companion. Users do not download these
nine packages separately. Only the large ASR/TTS weights download on demand.

Office and Memory stay active across restart. Optional plugins have installed
tests for default-off, enable, restart, disable, and restart. The internal
reference fixture and budget card are not presented as ordinary products.

### Upgrade paths

- 0.5.1, 0.5.2, and 0.5.3 can use **Settings → Penglai → Updates** after the
  signed 0.5.5 manifest exists, or install a same-platform manual overlay.
- 0.5.0 requires a manual overlay because it predates the production updater
  trust path.
- External Workspaces and the `Penglai/0.5` data generation are preserved.
- Updates are never silent and still pass through the operating-system
  installer.

### Catalog transition

The signed [`plugin-catalog-v1.000006`](https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/tag/plugin-catalog-v1.000006) contains no replacement download.
It revokes the old `@penglai/office-reader` exact artifact because full Penglai
Office now ships in the desktop application. Catalog 000006 must not be
published only after the immutable 0.5.5 desktop Release existed. The historical
catalog Releases remain immutable.

### Verification and known limits

The matching [native workflow](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/32656584336)
passed on Apple Silicon, Intel Mac, and Windows x64. Every target used the same
638-file clean public-export tree and passed exact installer identity, packaged
Electron fuses, installed welcome/process smoke, Office and Memory defaults,
and optional plugin enable/restart/disable/restart. The Windows runner also
captured the real Simplified Chinese NSIS component page.

The immutable Release contains exactly ten assets. Public read-back verified
the tag-to-source binding, byte sizes, SHA-256 values, public-export tree,
sequence-4 update manifest, manifest signature, and all three installer
signatures. Real Weixin/Feishu accounts remain a separate external-credential
limit. macOS is ad-hoc signed and not notarized; Windows has no Authenticode.
Penglai signatures protect updater and plugin bytes, not operating-system
publisher identity.

## 中文

蓬莱 0.5.5 把唯一核心从官方 DeepSeek Harness `0.1.1-rc.1` 更新到
`0.1.1-rc.2`。Apple Silicon、Intel Mac 和 Windows x64 三个原生安装包已由同一个
合并后的源码提交分别构建。

### 一句话版本

- 蓬莱办公和蓬莱记忆随安装包提供，全新 profile 必装、默认启用。
- 蓬莱手机消息、SenseVoice 语音识别、MOSS-TTS 语音生成和主动陪伴随包提供，
  但默认关闭。
- 旧的办公阅读器和单独的个人上下文产品入口已经删除。
- 微信与飞书统一使用文字、图片、文件、语音 adapter contract。
- 启用 ASR 后电脑会话出现麦克风入口；启用 TTS 后提供本地试听和受支持的语音输出。
  大模型权重仍然按需下载。
- 以后可以只发布新的 rc.2 签名插件目录，不必为了列表变化再打一个桌面版本。

### 蓬莱办公

旧的只读远程插件被第一方蓬莱办公替代。它用封闭的 typed operation 覆盖 DOCX、
XLSX、PPTX、PDF 的检查、创建、修改计划、预览、提交与撤销，包含模板，并为 PDF
输出内置 OFL 中文字体。

模型不能提交任意主机路径、运行宏或静默写入。Workspace 范围、不透明句柄、与动作
绑定的确认和 Host 侧校验都属于操作本身。LibreOffice 只是独立验收工具，不是用户
运行依赖。

### 蓬莱记忆

记忆现在只有一个 DSH 插件和一个设置入口，里面融合了：

- 用户明确保留的个人事实；
- 只属于当前 official Workspace 的项目记忆；
- 不会自动升级的 session candidate；
- 用户明确授权、可追溯和可撤销的本地资料；
- 知识图谱、更正、遗忘、导入导出迁移，以及把 SOP 写到 official DSH Skills。

Mnemon 0.2.4 是唯一召回引擎，并且已经放进安装包。一个 Workspace 不能选择或读取
另一个 Workspace 的记忆。全局记忆、遗忘、迁移提交和可复用 SOP 修改，都必须经过
对应的可见确认。

### 手机消息、附件与语音

蓬莱手机消息用一套 adapter registry 管理微信与飞书。文字、图片、文件和音频进入
相同的 official DSH Session 流程。图片使用 official DSH 图片存储；办公文件和音频
使用不透明蓬莱句柄，不再伪装成图片附件。

SenseVoice 与 MOSS-TTS 的代码在三个安装包中都有，但默认关闭。模型页会先说明下载，
再获取固定版本的权重。没有权重或停用语音插件时，普通 DSH 会话仍然必须正常。

### 桌面可靠性

- 首次引导覆盖语言、隐私、official 供应商与模型、真实密钥测试、official Workspace
  和第一条 official DSH Turn。
- 返回、重试、重启续接、非法 Workspace 拒绝、空密钥诚实停住都是可执行验收项。
- 升级发现位于桌面 main process，不在 renderer；它只接受不可变版本 manifest、
  精确摘要、蓬莱签名和用户明确确认。
- Windows NSIS 以 UTF-8 编译，并有原生截图门禁检查简体中文组件名称。
- 插件普通路径只有安装并启用或停用；Loader 阶段、摘要、权限、诊断、更新和回滚
  放在高级区域。

### 安装包里有什么

每个原生安装包都包含 9 个第一方代码包：插件中心、手机消息、隐藏 reference 测试件、
ASR、MOSS-TTS、记忆、办公、隐藏高级预算控制和主动陪伴。用户不需要分别下载 9 个
代码包，只有体积较大的 ASR/TTS 权重按需下载。

办公和记忆在重启后保持 active。可选插件有默认关闭、启用、重启、停用、再次重启的
安装测试。内部 reference 测试件和预算卡片不会作为普通产品展示。

### 升级路径

- 0.5.1、0.5.2、0.5.3 在签名 0.5.5 manifest 发布后，可以从 **设置 → 蓬莱 →
  更新** 升级，也可以使用同平台安装包手动覆盖。
- 0.5.0 早于生产升级信任链，只能手动覆盖。
- 外部 Workspace 与 `Penglai/0.5` 数据代际会保留。
- 升级绝不静默，最后仍然要经过操作系统安装器。

### 插件目录过渡

已发布的签名 [`plugin-catalog-v1.000006`](https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/tag/plugin-catalog-v1.000006)
不提供替代下载。它按精确身份撤销旧
`@penglai/office-reader`，因为完整蓬莱办公已经随客户端提供。目录 000006 必须等
不可变 0.5.5 桌面 Release 真实存在后才发布；旧目录 Release 保持不可变。

### 验收与已知限制

对应的[三端原生工作流](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/32656584336)
已在 Apple Silicon、Intel Mac 和 Windows x64 全部通过。三个目标使用同一份 638 文件
clean public-export 树，并通过安装包精确身份、Electron fuse、安装后首次启动与进程、
办公和记忆默认启用，以及可选插件启用/重启/停用/再次重启。Windows runner 还保存了
真实简体中文 NSIS 组件页截图。

不可变 Release 严格包含十个资产。公网回读重新验证了 tag 到源码、字节大小、SHA-256、
公开源码树、序号 4 的升级 manifest、manifest 签名和三个安装包签名。真实微信/飞书账号
仍是单独的外部凭据边界。macOS 为 ad-hoc 签名且未公证，Windows 没有 Authenticode。
蓬莱签名保护升级和插件字节，不代表操作系统发布者身份。
