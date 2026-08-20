# Penglai 0.5 能力迁移台账

所有增强能力都必须以DSH插件进入；0.5.0 未达到“host + client + lifecycle + migration + security + Apple Silicon installed/live evidence”完整标准前，不进入catalog或用户UI。Intel/Windows parity 是后续发布门。

| 能力 | 0.5决定 | DSH归属 | 本轮动作 | 完成门 |
| --- | --- | --- | --- | --- |
| Agent/Workspace/Session/Turn | REUSE | official DSH | 不复制 | Apple Silicon parity |
| Pi Models/BYOK/default model | REUSE | official DSH | credentials-local YAML | real UI/Turn |
| 桌面安装/监管/Doctor | BUILD | Penglai distribution | Apple Silicon DMG | native installed |
| 品牌/zh-en/theme | COMPOSE | official client seams | Penglai overlay/addition | parity/visual |
| 首次引导 | COMPOSE | official onboarding/settings | 完整UI编排 | BYOK/Workspace/Turn |
| Plugin Center | BUILD | `@penglai/plugin-center` | 真实事务/inventory | rollback/installed |
| 统一IM core | BUILD | `@penglai/im` | Remote/UI/DB/supervisor | causal/recovery |
| 微信私聊文本+语音 | BUILD | IM adapter + ASR/TTS services | QR/收发/SILK/恢复/注销 | conformance/live |
| 飞书私聊文本+语音 | BUILD | IM adapter + ASR/TTS services | app向导/SDK WS/audio收发 | conformance/live |
| SenseVoice ASR | BUILD | `@penglai/asr` DSH plugin | mic/attachment/IM、本地模型管理 | native engine+installed/live |
| MOSS-TTS-Nano | BUILD | `@penglai/moss-tts` DSH plugin | DSH朗读/voices/IM、本地模型管理 | native engine+installed/live |
| 个人上下文/来源卡 | BUILD | `@penglai/context` DSH plugin | 授权目录、FTS5、检索/深读、current/stale/revoked来源 | scope/index/citation/installed/live |
| global/Workspace记忆 | BUILD | `@penglai/memory` DSH plugin | L1、候选蒸馏、Owner确认、official Skill沉淀 | anti-pollution/consent/delete |
| 用量/预算 | BUILD | `@penglai/budget` DSH plugin | official TokenMeter ledger/warn/block/lift | concurrency/clock/desktop+IM |
| 主动陪伴 | BUILD | `@penglai/companion` DSH plugin | official Schedule/Turn、quiet hours、text/voice IM | opt-in/no-tools/dedupe/live |
| Goal/Todo/Skills/MCP/Web/Attachments/Schedule/TokenMeter | REUSE | official DSH | installed parity与Penglai帮助/IM命令组合 | Apple Silicon parity，无duplicate runtime |
| 0.5后续升级 | BUILD | Penglai distribution | signed assisted update | native update/rollback |
| 卸载/数据管理 | BUILD | Penglai distribution | Win uninstaller/Mac向导 | exact delete gates |
| 0.4.1迁移 | REJECT_0_5 | legacy | 只读检测、fresh提示 | old data不变 |
| Keychain credentials | HISTORICAL | 无 | 不pack/load/catalog/export | artifact反证 |
| 飞书Device Flow | DEFER | future user-scope | 无基础连接入口 | 新功能+ADR |
| 群聊/图片/普通文件/视频/富卡片 | DEFER | IM future | 不显示 | 独立隐私/协议版本 |
| 云账户/同步/遥测 | REJECT_0_5 | future decision | 不实现 | 新宪法/信任评估 |
| 任意远程插件市场 | REJECT_0_5 | future Center | 不实现 | 签名/review/sandbox完整 |

## 后续顺序

1. Grok完整完成0.5 private publication candidate。
2. Codex对 exact Apple Silicon 候选独立验收。
3. Owner 已授权同步开源 repo、官网并发布 0.5.0。
4. ASR/MOSS-TTS/Context/Memory/Budget/Companion 已由用户纳入0.5；每个都必须完整实现，不能用空卡、静态设置或旧Host源码存在冒充。
5. 每个新能力先补manifest、permissions、data ownership、migration、uninstall和验收矩阵，再编码。

`packages/credentials-keychain`与`packages/plugin-smoke`若暂留历史源码，必须标记historical/not-product；它们不能被pack、load、catalog、public-export或release tests当作0.5产品能力。
