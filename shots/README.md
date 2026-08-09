# shots/ — 官网截图流水线（可复现）

所有截图均为真实 UI / 真实输出的渲染，**无手画 mock**。网页引用的是 `.webp`
（压缩质量 85–88，单张 <300KB），`.png` 为原始母版。

| 文件 | 内容 | 生成方式 |
|---|---|---|
| `desktop-workbench.webp` | 桌面工作台三栏（任务面 + 证据轨） | 真实 Host + 真实 React UI，headless Chrome CDP 截图 |
| `desktop-wizard-provider.webp` | 桌面首次启动向导：供应商选择页（11 家目录 + 自定义端点） | 真实 Host（无 key 可解析档案）+ 真实 React UI，CDP 旅程截图 |
| `desktop-wizard-model.webp` | 桌面首次启动向导：模型选择页（实时 GET /models 合并） | 同上（MockModelServer 应答 /models，零网络） |
| `desktop-wizard-identity.webp` | 桌面首次启动向导：身份诞生页（自我介绍 + 种子 SOP 入树） | 同上（onboarding.birthIdentity 真实落 L1） |
| `cli-wizard.webp` | `penglai` 首次向导（BYOK 供应商目录） | `wizard-walkthrough.mts` 真实输出 → PIL 终端渲染 |
| `desktop-conversation.webp` | 同一对话面：浮动会话与项目锚定共享一个核心 | 真实 Host + 真实 React UI，headless Chrome CDP 截图 |
| `feishu-approval.webp` | 飞书 L3 审批卡片（**界面示意**） | 产品真实卡片 JSON + HTML 高保真渲染 |

## 1. 桌面工作台（desktop-workbench.png）

```bash
SITE=/absolute/path/to/PenglaiAgent-gh-pages
REPO=/absolute/path/to/PenglaiAgent
export PENGLAI_DATA_DIR=/tmp/penglai-demo/data
export PENGLAI_SHOT_BASE=/tmp/penglai-demo
export PENGLAI_SHOT_PORT=14173          # 避开 14169（本机真实 penglai serve）
cd "$REPO"
node --import tsx "$SITE/shots/serve_workbench.mts" &   # Host + MockModel + 种子数据
npm run build -w @penglai/desktop                        # dist（已构建可跳过）
node "$SITE/shots/dev_proxy.mjs" "$REPO/packages/desktop/dist" 1421 &
# 等 http://localhost:1421/penglai-health 与 / 就绪后：
node "$SITE/shots/capture.mjs" http://localhost:1421 \
  "$SITE/shots/desktop-workbench.png" 1600 1000 \
  "document.querySelector('.task-row') && document.querySelector('.task-row').click()" 3500
# 用完 kill 两个后台进程
```

要点：`serve_workbench.mts` 起真实 Host（生产 `server.ts`）+ MockModelServer
（脚本化模型端点，无 key 无网络），通过生产 JSON-RPC 造种子：浮动对话 →
Owner 选择项目并锚定 → task.start → L2 审批批准 → jail 内真实写文件完工。
证据轨里的审批留痕、蒸馏审计、文件变更、
checkpoint 全部来自真实观测。`dev_proxy.mjs` 与 vite dev 代理同语义（token
只由服务端注入 Host 请求头，不进入 URL 或渲染层），换独立端口避免占用本机真实实例。

同一数据集另截一张默认对话面：

```bash
node "$SITE/shots/capture.mjs" http://localhost:1421 \
  "$SITE/shots/desktop-conversation.png" 1600 1000 "" 3500
```

## 2. 桌面首次启动向导三张（desktop-wizard-*.png）

```bash
SITE=/absolute/path/to/PenglaiAgent-gh-pages
REPO=/absolute/path/to/PenglaiAgent
export PENGLAI_DATA_DIR=/tmp/penglai-shot-wizard/data
export PENGLAI_SHOT_BASE=/tmp/penglai-shot-wizard
export PENGLAI_SHOT_PORT=14174          # 避开 14169（真实 serve）与 14173（工作台截图）
cd "$REPO"
node --import tsx "$SITE/shots/serve_wizard.mts" &   # 真实 Host（无 key 可解析档案）+ MockModel
npm run build -w @penglai/desktop                     # dist（已构建可跳过）
node "$SITE/shots/dev_proxy.mjs" "$REPO/packages/desktop/dist" 1422 &
# 等 http://localhost:1422/penglai-health 就绪后：
MOCK_BASE=<serve_wizard 打印的 mock 端点 URL>
node "$SITE/shots/capture_wizard.mjs" http://localhost:1422 "$MOCK_BASE" \
  "$SITE/shots/desktop-wizard" 1600 1120
# 用完 kill 两个后台进程
```

要点：`serve_wizard.mts` 起真实 Host 但**屏蔽内置目录档案的环境变量**——
`config.resolveProfile` 无 key 可解析，桌面连上后自动进入首次启动向导（与
CLI 裸跑 `penglai` 同判据）。`capture_wizard.mjs` 用 CDP 真实驱动 React UI
走完旅程：欢迎 → 供应商页（截）→ 自定义端点填 mock URL → key → 实时
模型列表页（截，`config.listModels` 真实应答）→ 冒烟验证（`config.smokeTest`
真实 200）→ `config.createProfile` 保存 → 起名 → `onboarding.birthIdentity`
真实落 L1 + 种子 SOP 过审入树 → 身份诞生页（截）。除模型端点外全部是生产
代码路径，零网络、零手画。

## 3. CLI 首次向导（cli-wizard.png）

```bash
cd "$REPO"
node --import tsx scripts/wizard-walkthrough.mts > /tmp/wizard.txt
cd "$SITE/shots"
python3 render_terminal.py /tmp/wizard.txt cli-wizard.png \
  --from 11 --drop-last 1 --title "penglai setup — 首次向导"
```

`render_terminal.py`：Menlo + Noto Sans SC（找不到时使用系统苹方）+ Apple
Color Emoji，2x 超采样；也可用 `PENGLAI_CJK_FONT` 与
`PENGLAI_CJK_BOLD_FONT` 指定本机字体文件。
语义着色（节标题金 / ✓ 绿 / › 青）。"--from/--drop-last" 只裁剪 scrollback
区间，不改字。向导 banner 等截屏外内容不进入图片。

## 4. 飞书审批卡片（feishu-approval.png，界面示意）

```bash
cd "$REPO"
node --import tsx "$SITE/shots/feishu_card_data.mts" > "$SITE/shots/feishu-card.js"
cd "$SITE/shots"
node capture.mjs "file://$PWD/feishu-card.html" feishu-approval.png 980 700 "" 1500
```

卡片 JSON 由 `packages/host/src/feishu/protocol.ts` 的 `buildApprovalCard`
真实生成（legacy interactive card 结构）；`feishu-card.html` 按 tag 通用渲染。
网页配文标注「界面示意」。

## 5. 压缩

```bash
python3 - <<'EOF'
from PIL import Image
for name in ["desktop-workbench", "desktop-conversation", "cli-wizard", "feishu-approval"]:
    im = Image.open(f"{name}.png").convert("RGB")
    im.save(f"{name}.webp", "WEBP", quality=86 if name=="desktop-workbench" else 88, method=6)
for name in ["desktop-wizard-provider", "desktop-wizard-model", "desktop-wizard-identity"]:
    im = Image.open(f"{name}.png").convert("RGB")
    im.save(f"{name}.webp", "WEBP", quality=86, method=6)
EOF
```
