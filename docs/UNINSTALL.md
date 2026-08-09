# 卸载蓬莱（0.4）

蓬莱是**本地优先**产品：没有账号、没有遥测、没有云端数据。卸载 = 删除应用本体 +
（可选）删除本机数据目录。两步骤都是可逆操作里最普通的文件删除，没有注册表
残留（macOS），Windows 走标准卸载器。

## 1. macOS 桌面客户端

```bash
# ① 退出蓬莱（托盘菜单 → 退出蓬莱；Host 随壳退出，无后台残留）
# ② 删除应用
rm -rf /Applications/Penglai.app

# ③ 删除数据目录（可选——不删则重装后记忆/档案/身份原样回来）
rm -rf ~/.penglai
```

`~/.penglai` 里有什么（删除前可自查）：

| 内容 | 说明 |
|---|---|
| `profiles.json`（0600） | 模型档案与 API key（向导/`penglai setup` 所配） |
| `host.token`（0600） | 本机 Host 的 loopback 凭证，删了下次启动自动重生 |
| `product.db` | 项目/任务/运行/证据/审批/预算/用量账本（SQLite） |
| `conversations/` | 会话 transcript、目标与会话本地状态 |
| `skills/`、`mcp.json` | Owner 安装的声明式 Skill 与 MCP 配置 |
| `models/` | 按需下载的本地 ASR/TTS 模型 |
| `memory/` | 全局记忆 L1、身份（名字+诞生日）、SOP 技能树 |
| `memory/global/.sop-migration-authority`（0600） | 仅用于验证 0.3 迁移产生的 SOP receipt，随数据目录一并删除 |
| `channels.json` | 飞书等渠道配置 |
| `catalog-overlay.json` | 供应商目录校准缓存 |
| `update-backups/` | 每次安全更新前的数据库备份 |
| `update-journal.json` | 更新留痕 |

**凭证说明**：0.4 的凭证**不进 OS keychain**——API key 只在
`~/.penglai/profiles.json`（0600），Host token 只在 `~/.penglai/host.token`
（0600），都随数据目录删除而彻底清除，无钥匙串残留。若 key 用的是
`env:变量名` 引用（本机不留存 key 本体），记得顺带清理 shell 配置里的
环境变量导出行。（0.3 Python 世代的 key 在 `mykey.py`，不属于 0.4 数据目录。）

## 2. Windows 桌面客户端

设置 → 应用 → 已安装的应用 → Penglai → 卸载（NSIS 卸载器）。默认数据目录
与 CLI 使用同一规则：`%USERPROFILE%\.penglai`（或 `PENGLAI_DATA_DIR` 指向的
位置），删除即清凭证与记忆。正式发布前仍须在干净 Windows x64 系统完成真实
静默安装/启动/卸载验收；仓库里的静态检查不能替代这一步。

## 3. CLI

```bash
npm unlink -g @penglai/host   # 或按安装方式移除
rm -rf ~/.penglai             # 可选：同上，删除全部本地数据
```

## 4. 验证卸载干净（开发者）

`scripts/lifecycle-check.mjs` 的卸载阶段即按此验证：退出后无残留进程、
无端口监听（14169/沙盒端口）、隔离目录删除完成。真机手动验证：

```bash
lsof -nP -iTCP:14169 -sTCP:LISTEN   # 应为空
ps aux | grep -i penglai            # 应只剩 grep 自身
```
