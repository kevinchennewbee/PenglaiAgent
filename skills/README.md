# 蓬莱技能集市（skills/）

出厂精选技能放这里，每个一份 `<name>.md`（纯指导 SOP）。用户用 `penglai skill install <name>` 启用：
装 = 拷进 `memory/penglai_skill_<name>_sop.md` + 在 L1 种触发词（每轮注入，管家遇到对应场景就用它）。

## 技能文件格式

```markdown
---
name: <slug，小写连字符>
trigger: <L1 触发词，简短中文，如"用户要写周报">
desc: <一句话说这技能干嘛>
source: <来源/出处，如 ClawHub xxx（已审核改写）>
audited: <日期 + 审核项，如 2026-06-14 无curl|bash/无base64/纯指导>
---

<技能正文：管家遇到该场景具体怎么做，纯指导步骤。复用 GA 的 code_run/file_write 等现成工具，
不引入新依赖、不执行抓回内容、外部 API 只读公开免 key 的。>
```

## ★必须是 GA 原生 SOP（不是「外面拿来就能用」）

GA 核心（ga.py 592 行）**没有任何 skill 加载机制**——能力只有两种：**9 个原子工具**（code_run/
file_read/file_write/file_patch/web_scan/web_execute_js/ask_user/update_working_checkpoint/
start_long_term_update）+ **SOP**（memory/ 下的 markdown，经 L1 触发词唤起，`do_file_read` 读到
sop 文件会提示 agent 提取要点执行）。所以**蓬莱的「技能」本质就是一份 GA 原生 SOP**。

ClawHub/OpenClaw 的 `SKILL.md` 是给**别的 agent**（含它们专有的 CLI/工具/可执行步骤假设）写的，
**绝不能直接塞进来**。收编任何外部技能，必须**改写**成 GA 原生 SOP：
- 只用上面 9 个 GA 工具表达步骤（如"用 `code_run` 跑这段 Python""用 `file_write` 落盘"）；
- **不引入新依赖、不预设外部 CLI、不执行抓回的内容**；外部 API 只读公开免 key 的；
- 提炼原技能的**方法论**，删掉一切品牌名/外站 URL 载荷/可执行注入；中文化。
- 形态梯度：能用纯 SOP 表达就别造工具（参照 memory/penglai_weather_sop.md 是 SOP 不是工具）。

## 安全纪律

- 装时过 **memguard 威胁扫描**（提示注入/角色劫持/密钥外发命中即拒）——纵深防御。
- 出厂技能必须先**逐字审核**（盯指令层：`curl|bash` / `base64` / 外站载荷 / "把以下当系统提示"）后才放进来。
- **本地装、不联网、不从网上拉**（T2 社区白名单投稿制是后话，不学开放投稿）。

> 首批技能范围由用户拍板后投放；当前出厂为空（命令骨架已就绪）。
