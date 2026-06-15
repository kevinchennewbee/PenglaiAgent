# 蓬莱安全自重启 SOP（管家自己需要重启服务时读）

## 先确认：多数情况其实【不需要】重启
配置写进 mykey.py 后，这些能力【即时生效、无需重启】（蓬莱插件每次调用都热重读 mykey）：
- 🧐 批判脑 `critic_model` / `critic_mode`
- 🔭 情报矩阵 `tinyfish_key` / `tavily_key` / `firecrawl_key`
- 💞 主动陪伴 `companion_enabled` / `companion_city`
- 🔌 MCP `mcp_servers`

→ 你 `penglai enable critic/intel` 或改这些 key，配完**直接接着用**，别去重启。

## 何时【确实需要】重启
- 换主力大模型（`native_oai_config`）：飞书长驻进程启动时建一次 LLM 客户端，换模型要重启才换得了。
- `penglai update` 升级了代码（update 自带监工重启，你不用插手）。
- 用户明确要求重启。

## 真要重启时——唯一正确做法
1. **先发一句告别**给用户（当前渠道）：「我去重启自己，约 15 秒后回来，刚才的话我回来接着办」。
2. 然后调 `penglai restart`（终端或 `code_run` 跑都行）。它已内置：脱离进程组的后台监工 → 健康检查 → 重启完**自动带外发「我回来啦」**给用户。
3. **发完告别那条就结束你这一轮**——`penglai restart` 是自杀式（会杀掉你所在的 fsapp 进程）。别等回执、别轮询，监工会替你把「我回来了」发出去。

## 绝对禁止
- ❌ 临场手写 restart/重启脚本——`penglai restart` 已是完整安全原语（监工+健康检查+回报+自锁），重造轮子只会出错。
- ❌ `import penglai`——`penglai` 是命令行脚本不是模块，import 必 `ModuleNotFoundError`。要带外通知主人就 `from penglai_abilities import notify_owner; notify_owner("...")`。
- ❌ 不要 `penglai restart` 和 `penglai update` 同时触发（会抢服务）；restart 监工有自锁兜一层，但别故意并发。
