# Penglai 0.5.3 三端平台矩阵

## 1. 固定矩阵

0.5.3 声明三个 desktop target。每个 target 的“支持”必须同时包含正确 closure、可安装产物、installed E2E 和 native smoke。缺 runner 时该行是 `BLOCKED`，不是 PASS。

| key | OS/arch | 用户安装包 | embedded Node | Electron | final runner |
| --- | --- | --- | --- | --- | --- |
| `darwin-aarch64` | macOS 13+ / Apple Silicon | `Penglai_0.5.3_macos_aarch64.dmg` | `node-v22.22.2-darwin-arm64` | pinned darwin-arm64 | Apple Silicon Mac |
| `darwin-x86_64` | macOS 13+ / Intel | `Penglai_0.5.3_macos_x64.dmg` | `node-v22.22.2-darwin-x64` | pinned darwin-x64 | Intel Mac（Rosetta 不能替代） |
| `win32-x86_64` | Windows 10+ / x64 | `Penglai_0.5.3_windows_x64_setup.exe` | `node-v22.22.2-win-x64` | pinned win32-x64 | Windows x64 native runner |

0.5.0 已发布资产仍只有 Apple Silicon DMG。0.5.3 不得把 ARM Electron 改名成 x64，也不得把 Windows 预检写成 native PASS。

`release-info.json` / `MINIMUM_MACOS` / Info.plist `LSMinimumSystemVersion` 一律 `13.0`。打包脚本会把 Electron 默认的 `14.0` 改写为 `13.0`，不得再分叉。

版本可以由 RC1 的兼容探针更新，但一旦冻结必须在 release contract、lock、runtime manifest、SBOM、artifact 和 evidence 中完全一致。禁止使用 `latest` URL 或构建时动态选择版本。

## 2. machine-readable contract

Grok 必须新增单一 `release-contract.json`（具体路径由实现固定），至少包含：

```json
{
  "schemaVersion": 1,
  "product": "Penglai",
  "version": "0.5.3",
  "candidateKind": "public-community-release",
  "trustTier": "community-verified",
  "electronVersion": "43.4.0",
  "nodeVersion": "22.22.2",
  "dshVersion": "0.1.1-rc.1",
  "targets": [
    {
      "key": "darwin-aarch64",
      "platform": "darwin",
      "arch": "arm64",
      "installer": "Penglai_0.5.3_macos_aarch64.dmg"
    }
  ]
}
```

实际 0.5.0 contract 还必须钉死 Apple Silicon 输入的 canonical URL、SHA-256、archive type、expected executable、Electron download、Node download、DSH/profile/plugin closure hash、sherpa/ONNX Runtime/SILK/Opus closure、voice model manifest、installer maker/version、updater channel、embedded public key id 和 artifact exact-set。

`verify:versions` 必须比较 root/workspace packages、desktop metadata、runtime manifest、installer metadata、release manifest、updater manifest 与 contract。版本不一致直接失败，不能自动改写后继续。

## 3. closure 构建

每个 target 使用独立 clean staging，不共享另一个 target 解压目录：

```text
staging/<build-id>/<target>/
├─ input/
├─ electron/
├─ node/
├─ app/
├─ dsh/
├─ profile-seed/
├─ plugins/
├─ licenses/
├─ sbom/
└─ manifest.json
```

规则：

- 下载先落临时文件，校验 exact hash 后原子进入 cache；cache hit 仍重验 hash。
- archive 解包拒绝绝对路径、`..`、symlink escape、case collision、reserved Windows names 和 unexpected executable。
- target staging 只允许 contract 中的 OS/arch 输入；darwin-arm64 Node 进入 x64 包、或 win32 Electron 进入 darwin 包都必须在 pre-package 阶段失败。
- DSH/npm closure 由 lockfile 和 packlist 构建，不复制开发仓 `node_modules`；production dependencies 与 optional native modules 需按 target 验证。
- 第一方插件使用已打包 tarball + checksum，不让 app 首启执行 `pnpm install`。
- 八个Penglai first-party plugins的code随包；sherpa-onnx、ONNX Runtime、SILK/Opus和document extraction/SQLite等native closure按target固定并随包；SenseVoice/MOSS模型权重不随安装器，只发布signed/pinned manifest。
- voice verifier 必须实际加载 target native engine 并完成 deterministic fixture round-trip；只检查文件名、package.json 或用开发机全局 Python/ffmpeg 运行不算。
- bundle 内不放测试 fixture、evidence、源码仓 `.git`、owner 配置、私钥、真实日志或旧 artifact。

## 4. 路径抽象

所有生产路径由一个 platform layout module 解析，禁止业务包自己拼接 `$HOME`、反斜杠或 `/Applications`。

### macOS

```text
app bundle     /Applications/Penglai.app
userData       ~/Library/Application Support/Penglai/0.5
DSH_HOME       ~/Library/Application Support/Penglai/0.5/dsh-home
logs           ~/Library/Logs/Penglai/0.5
update cache   ~/Library/Caches/Penglai/0.5/updates
```

### Windows

```text
install root   %LOCALAPPDATA%\Programs\Penglai
userData       %LOCALAPPDATA%\Penglai\0.5
DSH_HOME       %LOCALAPPDATA%\Penglai\0.5\dsh-home
logs           %LOCALAPPDATA%\Penglai\0.5\logs
update cache   %LOCALAPPDATA%\Penglai\0.5\updates
```

实际路径以 Electron `app.getPath()` 和 installer contract 为基础，以上是目标形态。tests 必须覆盖空格、中文用户名、长路径、只读目录、UNC 拒绝策略、Windows drive letter 大小写、macOS case-insensitive 文件系统。

不得触碰用户 `~/.dsh`。0.4.1 legacy root 只能经只读 detector 访问；用户 Workspace 的真实源码目录永远不属于 app-managed data。

## 5. 进程合同

Electron main 是唯一 owner：

1. 解析 bundle 内 absolute embedded Node 路径。
2. 设置 app-private `DSH_HOME` 和最小环境。
3. spawn 固定 DSH entry，不经过 shell，不继承危险 PATH/npm 配置。
4. 等待随机 loopback port、一次性 capability 与 official health/WS handshake。
5. BrowserWindow 只加载认证代理后的 official DSH Web。
6. 退出、升级、注销、卸载准备时有界 drain，再终止 owned process tree。

Windows 必须用 job object 或等价受测进程树监管，不能只 kill 父 `node.exe` 留孤儿。macOS 必须根据 spawned process ownership/PGID 验证，不扫描并杀死其他 DSH 实例。

`process.arch`、embedded runtime arch、Electron binary arch、release target 四者必须一致。运行时 mismatch 显示安全恢复页并停止，不能 fallback 系统 Node。

## 6. 文件权限

### macOS

- user root、DSH_HOME、IM DB 目录：0700。
- `.credentials.yaml`：0600，原子 replace 后再次校验 owner/mode。
- bundle：签名后只读，运行时不得自修改。

### Windows

- userData/DSH_HOME/credentials 设置显式 DACL，只允许当前用户、SYSTEM 和必要管理员主体。
- 测试创建第二个普通用户/受限 token 或使用 ACL inspection 反证 `Everyone`/`Users` 不具读权限。
- junction、symlink、reparse point 不得被 migration/delete 跟随。
- credential 原子写使用同目录唯一 temp、flush、rename/replace；失败保留旧文件。

## 7. 打包器选择门

0.5.3 使用三端受控 pipeline；每个平台仍必须遵守：

- Windows后续格式预定为current-user NSIS；Squirrel只可作为官方更新机制研究，不能静默替换用户确认的NSIS Setup。
- 可以采用electron-builder/NSIS、Forge packager加受控NSIS maker，或继续受控自研pipeline，但必须解释为何更适合，并钉死依赖、下载、checksum、license、hook和安全面。
- 不允许同时维持两套 canonical maker；旧 `package-mac.mjs` 若保留只能作为被新 contract 调用的实现细节或 historical tool。
- 选择不得改变 Electron + DSH 产品架构，也不得为了打包迁移回 Tauri 0.4.1。

0.5.3 必须分别在 Apple Silicon、Intel Mac 与 Windows x64 原生 runner 真实生成并验收对应安装包；staging、交叉编译与 Rosetta 不能升级为本版支持声明。

## 8. 本地 runner 协议

统一命令形态（名称可在实现时固定，但语义不可变）：

```text
pnpm run runner:preflight -- --target <key>
pnpm run build:target -- --target <key> --source-manifest <path>
pnpm run test:installed -- --target <key> --artifact <absolute-path>
pnpm run evidence:export -- --target <key> --candidate <id>
pnpm run evidence:import -- --bundle <path>
```

preflight 记录但不泄露：OS build、kernel、CPU、native/emulated、filesystem、Node/pnpm/Rust/installer-tool versions、磁盘空间、Rosetta、Windows build tools。环境不符必须 fail closed。

evidence bundle 是内容寻址 tar/zip，包含 runner JSON/JUnit、artifact hash、source/export hash、环境摘要、命令/exit code 和签名；不含安装包本体、secret、QR、正文、用户名或绝对 owner path。导入器重验 schema/hash/signature/target，拒绝重复、旧 candidate 或伪装 native 的 emulated 结果。

## 9. 每平台 installed suites

每个 target 必须从该平台 exact installer 开始；以下清单三端适用，平台差异单独记录：

1. 在干净 OS user/profile 安装。
2. 验 product name、publisher/trust tier 声明、安装位置、快捷方式/Applications link。
3. 启动并完成真实 UI 引导 fixture：zh 默认、主题、provider/model、credential descriptor、API test、Workspace、official Turn、IM offer。
4. 重启验证 onboarding、locale/theme、Workspace、loader inventory、IM config 持久化。
5. 测试 DSH crash、Electron crash、端口冲突、sleep/wake、offline/reconnect。
6. 运行 Center transaction、IM mock adapter、strict causal route；production UI/Remote 不得出现 test endpoint。
7. 验 bundle/input closure、进程树、用户数据路径、文件权限/ACL、日志/diagnostics secret clean。
8. 在只装随包 native voice runtime、未装模型时验证优雅降级；再从 pinned local fixture/source 安装模型，完成麦克风/文件 ASR、MOSS 合成、48k 音频播放/导出和清理。
9. 用 IM fixture 完成微信 SILK/可播放音频附件与飞书原生 audio 的收发、转写、文本/语音/双发模式和不支持类型拒绝。
10. 完成Context grant/index/query/citation/revoke、Memory scope/consent、Budget warn/block、Companion virtual-clock text/voice/disable suite。
11. 执行 0.5 fixture assisted upgrade、失败回滚和重启恢复，包括进行中的 voice/index/distill/schedule job。
12. 执行默认卸载与完整数据删除两条路径，确认 Workspace、授权源目录、legacy data 与未选 local voices/memory 不动。
13. 只有 feature freeze、短门和 exact artifact 均通过后才开始 offline/sleep/wake/crash/restart/2h soak。

`darwin-aarch64` 在当前机器全量执行。Rosetta 的 x64 结果仍只能标记 `translated=true`，Windows ARM emulation 只能标记 `emulated=true`；二者都不能反向改写 0.5.3 支持矩阵。

## 10. 平台出错即停的条件

- embedded binary 与 contract arch 不一致。
- 打包需从互联网下载未固定或未验 hash 的可执行文件。
- production 启动依赖 shell、PATH、全局 Node、repo 或首次 npm install。
- Windows installer 需要管理员权限却未在合同声明，或卸载器能递归越过 app data root。
- macOS DMG 中 app seal/挂载后验证失败，或 Windows Setup 安装后 hash/版本/进程不一致。
- native runner evidence 不能证明来自 exact artifact/source/export tree。
