# 官网重构风格笔记（0.3 → 0.4）

研读对象：`PenglaiAgent/README.md`（0.3.6，中英双语）、gh-pages 旧站 `index.html` / `en/index.html` / `styles/main.css`。

## 叙事 DNA（继承）

- **双语镜像**：README 单文件双锚点互链；网站 `index.html`（中）与 `en/`（英）同构互链，导航「中 / EN」。新站保持同构、逐段对应。
- **徽章行**：shields flat-square 语义色徽章（License / 平台 / 内核 / 官网），居顶，一眼交代血统。
- **缘起叙事是品牌标志**：「一个不会写代码的人，和他的 AI 管家」——第一人称、具体、不装。0.4 续写「为什么重写」一章，同一口吻。
- **「为什么叫蓬莱」**：史记三神山、徐福入海；海上的雾 = API / 终端 / 配置文件；「把仙山搬进聊天窗」。仙气要有，玄学不要。
- **「八仙过海，各显神通」**：多模型多渠道，各展所长，服务同一个人。
- **诚实工程文化**：未实测的渠道如实标「Pending real-device」；能力清单注明「不是 roadmap」；limitation 公开写。新站延续：飞书卡片标「界面示意」、能力只写真实存在的。

## 合规模式（License & Brand，照搬）

- 代码 MIT；上游版权声明完整保留（0.3 是 GenericAgent zero-diff，0.4 是致谢「基因」）。
- 品牌「Penglai / 蓬莱」名称、logo、banner 视觉资产**保留所有权利**，不在代码许可证内，商用冠名需书面授权。
- 致谢逐条带协议：GenericAgent (MIT) · Pi 内核 @earendil-works/pi-agent-core (MIT) · SenseVoice (MIT) · sherpa-onnx (Apache-2.0) · Tauri (MIT/Apache-2.0)。
- 安全与隐私边界一节 + SECURITY 链接 + 官方渠道声明（防钓鱼）。

## 视觉 DNA（继承）

- 水墨米白底色纵向渐变（`#FAFAF7 → #D5D0C4`，fixed）。
- 仙山雾气：三层 SVG 山脊线叠底（rgba 灰绿）。
- Perlin 流场粒子 canvas：青蓝白为主、金/朱砂点缀、鼠标吸引、拖尾。
- 朱砂印章「蓬」方块（`#C44531`，圆角，衬线白字）。
- 字体：衬线标题（Noto Serif SC / Songti）+ 系统无衬线正文 + JetBrains Mono 代码。
- 品牌三色：朱砂 `#C44531` / 青 `#1685A9` / 金 `#B98A2E`。
- 滚动 reveal（IntersectionObserver 渐显）、克制圆角与柔和阴影。

## 0.4 重构方向（升级）

- 深浅色随系统（`prefers-color-scheme`），粒子/山雾/印章在深色下反相为「夜色仙山」。
- 更大留白、更窄行宽、移动端优先响应式；删繁：去掉计数器、安装 tabs、手绘 mockup。
- 真实 UI 截图（shots/）取代一切手绘示意；飞书卡片诚实标注「界面示意」。
- 叙事换轴：Runtime Hub / 微信扫码 / 多渠道矩阵 → 0.4.0「住在飞书里 · 完全属于你 · 越用越懂你」+ 单一核心 + 项目锚定边界 + 主权 + 进化。
