# 蓬莱 SOP：IM 发来的图片 → 真的看图（别凭模型名瞎猜）

**触发**：用户在飞书/微信发来图片（消息含 `[image: 文件名]`，或给你图片路径），需要你看图 / 回答关于图的问题。
（区别于 `vision_sop.md`——那是桌面截图/电脑操控导向；本 SOP 专管"用户主动发来的照片"。）

## 铁律：先实测，再下结论
- **绝不凭模型名（如 MiniMax-M3、或看 `/models` 无 `vl` 后缀）就断定"我没视觉 / 我是纯文本"。** 多数国产主力模型（M3 等）原生多模态，喂对格式就能看图。真机教训：曾凭模型名误判，绕 11 步还答错；用户点破后实测一次就秒回详细图描述。
- 看图前**先做一次最小实测**：成功就正常答；失败再如实说"看不了"。

## 怎么看图（最省事的路径）
0. **先确认这是用户主动发来的图片**：看到 `[Image: source: /绝对路径]` 或 IM 附件路径时，走本 SOP；不要切到桌面截图 / computer-use / `vision_sop.md` 的窗口枚举流程。
1. **图片绝对路径就在用户消息的 `[Image: source: /绝对路径]` 标记里**（GA 把 IM 图存到本地后给你这个标记；别去 file_read 那个路径，直接把它喂给 ask_vision）。你的主力模型多半就能看图，用 GA 现成的 `ask_vision`（它把图按 `image_url` 喂给你的主力模型）：
   ```python
   import sys; sys.path.insert(0, "memory")
   from vision_api import ask_vision
   print(ask_vision("从 [Image: source: ...] 取到的那个绝对路径", "用户关于这张图想知道的（或'详细描述这张图'）", backend="openai"))
   ```
   `backend="openai"` = 用蓬莱已配好的主力模型（`native_oai_config`）看图。
2. 若 `memory/vision_api.py` 不存在：蓬莱向导 / `penglai doctor` 正常会自动构建好（配到主力模型）；没有就按 `vision_sop.md` 的"初次构建"从 `vision_api.template.py` 拷一份，`OPENAI_CONFIG_KEY` 填 `native_oai_config`、`DEFAULT_BACKEND` 填 `openai`。
3. 只 `file_read` 图片**只能拿到 EXIF / 字节，看不到内容**——别用它代替看图；OCR 只适合“截图里有什么文字”这类纯文字问题，不能代替视觉描述。

## 失败兜底（诚实，不编造）
- `ask_vision` 返回 `Error:`（模型非多模态 / 连不通）→ 如实告诉用户"我当前主力模型看不了这张图"，给替代：请用户口述要点、或本地 OCR（`memory/ocr_utils.py`，纯文字截图有用）。
- **绝不凭文件名 / EXIF / 想象编造图片内容。**
