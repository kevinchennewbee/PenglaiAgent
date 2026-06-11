# -*- coding: utf-8 -*-
"""蓬莱插件：出站文件白名单（F-004 防本机任意文件外发）。

模型回复里的 `[FILE:/绝对/路径]` 会被飞书前端解析并直接上传给聊天用户
（fsapp `_send_generated_files` → `_send_local_file`）。提示注入或模型误输出
`[FILE:/.../mykey.py]`、`~/.ssh/id_rsa`、`.env` 等路径时，密钥/隐私会被外发——
这是 IM Agent 的核心泄露面，且飞书是发行版默认部署面（systemd/docker 跑 fsapp）。

修法（蓬莱层 monkeypatch，GA/前端文件零改动，同 penglai_redline 套路）：
运行时包装 `frontends.fsapp._send_local_file`，仅允许外发【工作目录/临时目录】内的
文件——这正是 agent 生成产物（图表/报告/媒体）与下载媒体的落点；绝对路径、`..`、
软链接越界、密钥目录一律拒绝并提示用户。realpath 解析后做前缀校验，自动覆盖
穿越与软链接。

挂载时机：fsapp.py 第 81 行 `from agentmain import ...` 会触发插件加载，此时 fsapp
模块尚在执行（`_send_local_file` 定义在第 555 行，还没到），故不能在 import 期直接打
补丁。改为注册 `agent_before` 钩子（agent_loop.py:49，每次跑 agent 开头触发，远早于
任务结束后才发文件的 `_send_generated_files`）里幂等延迟挂载。

仅覆盖飞书（默认面、真实暴露面）。微信/企微是 opt-in 且不在默认 systemd/docker 部署
面，其 `[FILE:]`/媒体路径穿越记为上游 PR 候选，不在此层包装（未经真机验证不上）。
"""
import os
import sys

from plugins.hooks import register
from plugins.penglai_redline import audit

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _allowed_roots():
    """允许外发的根目录（realpath）：workspace + 仓库 temp + 系统 temp。
    懒计算——GA_WORKSPACE_ROOT 由 systemd/docker 在进程启动前注入。"""
    roots = []
    ws = os.environ.get("GA_WORKSPACE_ROOT")
    if ws:
        roots.append(ws)
    roots.append(os.path.expanduser("~/penglai-work"))   # 非 systemd（penglai start）默认工作区
    roots.append(os.path.join(_REPO_ROOT, "temp"))       # 仓库 temp/（含 feishu_media 下载落点）
    import tempfile
    roots.append(tempfile.gettempdir())
    out = []
    for r in roots:
        try:
            out.append(os.path.realpath(r))
        except Exception:
            pass
    return out


def _is_outbound_allowed(file_path):
    """返回 (允许?, 原因)。realpath 解析软链接与 ..，越界即拒。"""
    try:
        rp = os.path.realpath(str(file_path))
    except Exception:
        return False, "路径解析失败"
    if not os.path.isfile(rp):
        return False, "文件不存在"
    for root in _allowed_roots():
        if rp == root or rp.startswith(root + os.sep):
            return True, ""
    return False, "不在允许的工作目录内（仅可外发 workspace/temp 内文件）"


_orig_send_local_file = None


def _guarded_send_local_file(receive_id, file_path, receive_id_type="open_id"):
    ok, why = _is_outbound_allowed(file_path)
    if not ok:
        audit("send_file", {"path": str(file_path)}, blocked=True, reason=f"外发拦截:{why}")
        try:
            import frontends.fsapp as _fs
            _fs.send_message(receive_id, f"⛔ 蓬莱安全策略：拒绝外发该文件（{why}）",
                             receive_id_type=receive_id_type)
        except Exception:
            pass
        return False
    return _orig_send_local_file(receive_id, file_path, receive_id_type)


_PATCHED = False


def _try_patch():
    """幂等延迟挂载。仅当 frontends.fsapp 已在 sys.modules（=在 fsapp 进程内）才打补丁，
    绝不主动 import 它——避免在 scheduler/wechat 进程里误触发飞书启动。"""
    global _PATCHED, _orig_send_local_file
    if _PATCHED:
        return True
    mod = sys.modules.get("frontends.fsapp")
    if mod is None:
        return False
    if getattr(mod, "_penglai_fileguard", False):
        _PATCHED = True
        return True
    orig = getattr(mod, "_send_local_file", None)
    if orig is None:
        return False   # fsapp 还没执行到定义处，下次钩子再试
    _orig_send_local_file = orig
    mod._send_local_file = _guarded_send_local_file
    mod._penglai_fileguard = True
    _PATCHED = True
    sys.stderr.write("[penglai_fileguard] 出站文件白名单已挂载（fsapp._send_local_file）\n")
    return True


@register("agent_before")
def _mount_on_agent_before(ctx):
    _try_patch()
    return ctx


# import 期最佳努力（fsapp 多半还没定义到 _send_local_file，正常返回 False，靠钩子兜住）
_try_patch()
