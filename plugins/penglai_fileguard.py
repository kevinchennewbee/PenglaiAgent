# -*- coding: utf-8 -*-
"""蓬莱插件：出站文件门禁（F-004 防敏感文件自动外发）。

模型回复里的 `[FILE:/绝对/路径]` 会被飞书前端解析并直接上传给聊天用户
（fsapp `_send_generated_files` → `_send_local_file`）。提示注入或模型误输出
`[FILE:/.../mykey.py]`、`~/.ssh/id_rsa`、`.env` 等路径时，密钥/隐私会被外发——
这是 IM Agent 的核心泄露面，且飞书是发行版默认部署面（systemd/docker 跑 fsapp）。

飞书默认暴露面仍走蓬莱层 monkeypatch：运行时包装 `frontends.fsapp._send_local_file`，
默认只按少数敏感后缀拦截：
`.py` / `.env` / `.key` / `.sh` / `.pem`。真实工作产物不再因为落点不在
workspace/temp 被误拦，默认完全不按目录判断。

挂载时机：fsapp.py 第 81 行 `from agentmain import ...` 会触发插件加载，此时 fsapp
模块尚在执行（`_send_local_file` 定义在第 555 行，还没到），故不能在 import 期直接打
补丁。改为注册 `agent_before` 钩子（agent_loop.py:49，每次跑 agent 开头触发，远早于
任务结束后才发文件的 `_send_generated_files`）里幂等延迟挂载。

模块定位：旧部署可能直接 `python frontends/fsapp.py`，此时 fsapp 在 sys.modules 里的名字是
`__main__`；0.2.8 起生产入口是 `penglai_feishu_app.py` 包装器，fsapp 以 `frontends.fsapp`
模块形态导入。两个名字都必须兼容；`__main__` 还要按 __file__ 是否为 fsapp.py 确认身份。
只查其中一种都会让另一种部署静默 fail-open（2026-06-11 真机实测踩过：仓库根的 penglai
脚本被原样外发，journal 无任何拦截记录）。

飞书是默认真实暴露面，本插件负责给 fsapp 挂载发送门禁；其它 IM 通过
`plugins.penglai_artifacts` 复用同一套解析/后缀规则。
"""
import os
import sys

from plugins.hooks import register
from plugins.penglai_artifacts import (
    AUDIO_EXTS,
    BLOCKED_OUTBOUND_SUFFIXES,
    VIDEO_EXTS,
    classify_file_markers,
    is_outbound_allowed,
    is_sensitive_suffix,
    summarize_blocked,
)
from plugins.penglai_redline import audit

_BLOCKED_OUTBOUND_SUFFIXES = BLOCKED_OUTBOUND_SUFFIXES
_MEDIA_EXTS = AUDIO_EXTS | VIDEO_EXTS


def _is_safe_outbound_type(path):
    if is_sensitive_suffix(path):
        return False, "敏感后缀文件禁止自动外发"
    return True, ""


def _is_outbound_allowed(file_path):
    """返回 (允许?, 原因, realpath)。realpath 解析软链接与 ..。
    一并返回解析后的 realpath 供发送时使用——确保「校验的路径 == 发送的路径」，
    堵住校验与发送之间被软链接 swap 的 TOCTOU 窗口。"""
    return is_outbound_allowed(file_path)


_orig_send_local_file = None
_orig_send_generated_files = None
_fsapp_mod = None   # 被挂载的 fsapp 模块对象（frontends.fsapp 或脚本模式下的 __main__）


def _find_fsapp_module():
    """定位运行中的 fsapp 模块。绝不主动 import（避免在 scheduler/wechat 进程里
    误触发飞书启动）。脚本模式（python frontends/fsapp.py）下名字是 __main__。"""
    mod = sys.modules.get("frontends.fsapp")
    if mod is not None:
        return mod
    main = sys.modules.get("__main__")
    f = getattr(main, "__file__", None) or ""
    if os.path.basename(f) == "fsapp.py":
        return main
    return None


def _guarded_send_local_file(receive_id, file_path, receive_id_type="open_id"):
    ok, why, rp = _is_outbound_allowed(file_path)
    if not ok:
        audit("send_file", {"path": str(file_path)}, blocked=True, reason=f"外发拦截:{why}")
        try:
            # 用挂载时定位的模块对象回话——脚本模式下 import frontends.fsapp
            # 会把 fsapp 整个重新执行一遍（双连接），绝不能 import
            _fsapp_mod.send_message(receive_id, f"⛔ 蓬莱安全策略：拒绝外发该文件（{why}）",
                                    receive_id_type=receive_id_type)
        except Exception:
            pass
        return False
    # 用 realpath 解析后的路径发送（=校验时确认的同一路径），堵住校验与发送之间
    # 的软链接 swap（TOCTOU）：合法生成物不是软链、realpath 不变；攻击性软链已在
    # 校验阶段被解析越界拒绝，此处确保发送的就是校验过的那条路径。
    return _send_outbound_file(receive_id, rp, receive_id_type)


def _send_outbound_file(receive_id, file_path, receive_id_type="open_id"):
    ext = os.path.splitext(str(file_path))[1].lower()
    if ext in _MEDIA_EXTS:
        upload = getattr(_fsapp_mod, "_upload_file_sync", None)
        send = getattr(_fsapp_mod, "send_message", None)
        if callable(upload) and callable(send):
            file_key = upload(file_path)
            if file_key:
                import json
                send(receive_id, json.dumps({"file_key": file_key}, ensure_ascii=False),
                     msg_type="media", receive_id_type=receive_id_type)
                return True
    return _orig_send_local_file(receive_id, file_path, receive_id_type)


def _summarize_blocked(blocked):
    return summarize_blocked(blocked)


def _guarded_send_generated_files(receive_id, raw_text, receive_id_type="open_id"):
    base_dir = getattr(_fsapp_mod, "TEMP_DIR", None)
    artifacts = classify_file_markers(raw_text, base_dir=base_dir)
    allowed = [a for a in artifacts if a.status == "allowed"]
    blocked = [a for a in artifacts if a.status in ("blocked", "missing")]
    if not allowed and not blocked:
        return
    for art in allowed:
        _send_outbound_file(receive_id, art.realpath, receive_id_type)
    if blocked:
        reasons, examples = _summarize_blocked(blocked)
        audit("send_files", {"blocked": len(blocked), "sent": len(allowed), "reasons": reasons},
              blocked=True, reason="批量外发预检拦截")
        try:
            sent = f"已发送 {len(allowed)} 个安全文件；" if allowed else ""
            _fsapp_mod.send_message(
                receive_id,
                f"⛔ 蓬莱安全策略：{sent}{len(blocked)} 个文件未外发（{reasons}）。\n{examples}",
                receive_id_type=receive_id_type,
            )
        except Exception:
            pass


_PATCHED = False


def _try_patch():
    """幂等延迟挂载。仅当 fsapp 模块已在 sys.modules（=在 fsapp 进程内）才打补丁。"""
    global _PATCHED, _orig_send_local_file, _orig_send_generated_files, _fsapp_mod
    if _PATCHED:
        return True
    mod = _find_fsapp_module()
    if mod is None:
        return False
    if getattr(mod, "_penglai_fileguard", False):
        _PATCHED = True
        return True
    orig = getattr(mod, "_send_local_file", None)
    if orig is None:
        return False   # fsapp 还没执行到定义处，下次钩子再试
    _orig_send_local_file = orig
    _fsapp_mod = mod
    mod._send_local_file = _guarded_send_local_file
    gen = getattr(mod, "_send_generated_files", None)
    if callable(gen):
        _orig_send_generated_files = gen
        mod._send_generated_files = _guarded_send_generated_files
    mod._penglai_fileguard = True
    _PATCHED = True
    sys.stderr.write("[penglai_fileguard] 出站文件后缀门禁已挂载（fsapp._send_local_file）\n")
    return True


@register("agent_before")
def _mount_on_agent_before(ctx):
    _try_patch()
    return ctx


# import 期最佳努力（fsapp 多半还没定义到 _send_local_file，正常返回 False，靠钩子兜住）
_try_patch()
