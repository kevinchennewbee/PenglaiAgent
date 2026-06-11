# 生成技能 SOP（穷人版内容生成：SVG/海报/网页/视频）

触发场景：用户要图片/海报/卡片/图表/小动画/短视频，但没有绘图或视频生成 API。
思路：LLM 自己就是生成器——直接写 SVG/HTML，再用浏览器渲染成图，ffmpeg 拼成视频。

## 先探测环境（结果记入 working memory，别每次重测）
- `which ffmpeg`：无则提示用户 `sudo apt install ffmpeg`（视频必需，图片不需要）
- 渲染器三选一，按序探测：python `cairosvg`（SVG→PNG 最轻）→ `playwright`/无头浏览器
  （HTML→截图）→ 都没有则只交付 SVG/HTML 源文件并说明在浏览器打开即可看
- 中文显示豆腐块 → 缺 CJK 字体：`fc-list :lang=zh` 验证，缺则 `sudo apt install fonts-noto-cjk`

## 操作
1. **静态图/图表**：直接 file_write 写 SVG（矢量、可控、无依赖）。固定画布如
   `viewBox="0 0 1080 1440"`（海报竖版）。文字必须显式 `font-family="Noto Sans CJK SC"`。
2. **精排海报/卡片**：HTML+CSS 排版能力 > 手写 SVG。写 HTML → 无头浏览器定宽截图。
3. **短视频**：写一个带 JS 参数的 HTML 动画页（接受 `?t=帧号` 或 JS 变量控制进度）→
   循环截图出帧序列 `frame_%04d.png` → `ffmpeg -framerate 30 -i frame_%04d.png -pix_fmt yuv420p out.mp4`。
   先 3 秒 90 帧小样给用户确认，再出全片。
4. **交付**：成品放 cwd 下，通过当前渠道发文件给用户；交付前自己先渲染/截图检查一遍。

## 坑
- 跳过环境探测直接写代码 → 渲染时才发现缺 ffmpeg/字体，返工。
- SVG 里用了系统没有的字体名 → 静默回退成豆腐块，必须用 fc-list 验证过的字体名。
- 一次性渲染几千帧 → 磁盘/时间爆炸，先小样后全片。
- ffmpeg 输出忘加 `-pix_fmt yuv420p` → 微信/飞书播放器打不开。
