# -*- coding: utf-8 -*-
"""Penglai Feishu launcher.

This wrapper keeps upstream `frontends/fsapp.py` untouched and layers Penglai
runtime behavior on top of it.  It is intentionally small: import upstream,
patch Feishu ask_user rendering, then delegate to upstream main().
"""
import asyncio
import argparse
import json
import os
import queue as Q
import sys
import threading
import time
import traceback
import uuid

ROOT = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, ROOT)
sys.path.insert(1, os.path.join(ROOT, "frontends"))
os.chdir(ROOT)

from penglai_feishu_ask import (  # noqa: E402
    build_ask_user_elements,
    extract_ask_user_event,
    render_ask_user_text,
    resolve_choice,
)


_ASK_STATE = {}
_ASK_BY_MENU = {}
_ASK_LOCK = threading.Lock()


def _patch_lark_ws_card_dispatch():
    """Work around lark-oapi WebSocket clients that drop CARD frames.

    Some 1.x releases accept register_p2_card_action_trigger(), but return
    before dispatching MessageType.CARD in the long-connection client.  Keep the
    fix in Penglai's wrapper layer so GA and the third-party package stay
    untouched.
    """
    try:
        import inspect
        import lark_oapi.ws.client as ws_client
    except Exception as e:
        print(f"[WARN] 飞书卡片回调兼容检查失败: {e}", flush=True)
        return False
    method = getattr(ws_client.Client, "_handle_data_frame", None)
    if getattr(method, "_penglai_card_dispatch_patch", False):
        return True
    try:
        src = inspect.getsource(method)
    except Exception:
        src = ""
    if "MessageType.CARD" in src and "_do_without_validation(pl)" in src and "elif message_type == MessageType.CARD" not in src:
        return True
    if "MessageType.CARD" in src and "return" not in src:
        return True

    async def _handle_data_frame(self, frame):
        hs = frame.headers
        msg_id = ws_client._get_by_key(hs, ws_client.HEADER_MESSAGE_ID)
        trace_id = ws_client._get_by_key(hs, ws_client.HEADER_TRACE_ID)
        sum_ = ws_client._get_by_key(hs, ws_client.HEADER_SUM)
        seq = ws_client._get_by_key(hs, ws_client.HEADER_SEQ)
        type_ = ws_client._get_by_key(hs, ws_client.HEADER_TYPE)

        pl = frame.payload
        if int(sum_) > 1:
            pl = self._combine(msg_id, int(sum_), int(seq), pl)
            if pl is None:
                return

        message_type = ws_client.MessageType(type_)
        ws_client.logger.debug(self._fmt_log(
            "receive message, message_type: {}, message_id: {}, trace_id: {}, payload: {}",
            message_type.value, msg_id, trace_id, pl.decode(ws_client.UTF_8)))

        resp = ws_client.Response(code=ws_client.http.HTTPStatus.OK)
        try:
            start = int(round(ws_client.time.time() * 1000))
            if message_type in (ws_client.MessageType.EVENT, ws_client.MessageType.CARD):
                result = self._event_handler._do_without_validation(pl)
            else:
                return
            end = int(round(ws_client.time.time() * 1000))
            header = hs.add()
            header.key = ws_client.HEADER_BIZ_RT
            header.value = str(end - start)
            if result is not None:
                resp.data = ws_client.base64.b64encode(
                    ws_client.JSON.marshal(result).encode(ws_client.UTF_8))
        except Exception as e:
            ws_client.logger.error(self._fmt_log(
                "handle message failed, message_type: {}, message_id: {}, trace_id: {}, err: {}",
                message_type.value, msg_id, trace_id, e))
            resp = ws_client.Response(code=ws_client.http.HTTPStatus.INTERNAL_SERVER_ERROR)

        frame.payload = ws_client.JSON.marshal(resp).encode(ws_client.UTF_8)
        await self._write_message(frame.SerializeToString())

    _handle_data_frame._penglai_card_dispatch_patch = True
    ws_client.Client._handle_data_frame = _handle_data_frame
    print("[penglai feishu] 已启用 lark-oapi WebSocket CARD 回调兼容补丁", flush=True)
    return True


def _remember_ask(chat_key, event, *, menu_id=None, receive_id=None, receive_id_type="open_id"):
    with _ASK_LOCK:
        _ASK_STATE[chat_key] = event
        if menu_id:
            _ASK_BY_MENU[menu_id] = {
                "chat_key": chat_key,
                "event": event,
                "receive_id": receive_id or chat_key,
                "receive_id_type": receive_id_type,
            }


def _pop_choice(chat_key, text):
    with _ASK_LOCK:
        event = _ASK_STATE.get(chat_key)
        choice = resolve_choice(text, event)
        if choice is not None:
            _ASK_STATE.pop(chat_key, None)
            for menu_id, item in list(_ASK_BY_MENU.items()):
                if item.get("chat_key") == chat_key:
                    _ASK_BY_MENU.pop(menu_id, None)
        return choice


def _pop_menu_choice(menu_id, index):
    with _ASK_LOCK:
        item = _ASK_BY_MENU.pop(menu_id, None)
        if not item:
            return None
        event = item.get("event") or {}
        candidates = event.get("candidates") or []
        try:
            idx = int(index)
        except Exception:
            idx = -1
        if not (0 <= idx < len(candidates)):
            return None
        chat_key = item.get("chat_key")
        if chat_key:
            _ASK_STATE.pop(chat_key, None)
        return {
            "chat_key": chat_key,
            "choice": candidates[idx],
            "receive_id": item.get("receive_id") or chat_key,
            "receive_id_type": item.get("receive_id_type") or "open_id",
        }


def _cancel_ask(chat_key):
    with _ASK_LOCK:
        _ASK_STATE.pop(chat_key, None)
        for menu_id, item in list(_ASK_BY_MENU.items()):
            if item.get("chat_key") == chat_key:
                _ASK_BY_MENU.pop(menu_id, None)


def _patch(fs):
    if getattr(fs, "_PENGLAI_FEISHU_PATCHED", False):
        return
    fs._PENGLAI_FEISHU_PATCHED = True

    orig_handle_message = fs.handle_message
    orig_run_agent = fs.FeishuApp.run_agent
    orig_handle_command = fs.FeishuApp.handle_command

    def _finish_ask_card(card, raw, event, menu_id):
        text = fs._display_text(raw)
        elements = build_ask_user_elements(text, event, menu_id=menu_id, include_buttons=True)
        card.status = "🧭 等待选择"
        card.final = None
        rendered = fs._card_raw(elements)
        ok = fs._patch_card(card.msg_id, rendered) if card.msg_id else False
        if not ok:
            fs.send_message(card.rid, render_ask_user_text(text, event), receive_id_type=card.rtype)

    def _make_penglai_task_hook(card, task_id, on_final, on_ask):
        def hook(ctx):
            try:
                if getattr(ctx.get("self").parent, "_fs_active_task_id", None) != task_id:
                    return
                if ctx.get("exit_reason"):
                    resp = ctx.get("response")
                    raw = resp.content if hasattr(resp, "content") else str(resp)
                    event = extract_ask_user_event(ctx)
                    if event:
                        on_ask(raw, event)
                    else:
                        on_final(raw)
                elif ctx.get("summary"):
                    detail = fs._build_step_detail(ctx.get("response"), ctx.get("tool_calls") or [])
                    card.step(ctx["summary"], detail)
            except Exception as e:
                print(f"[penglai fs hook] error: {e}")
        return hook

    async def run_agent(self, chat_id, text, *, receive_id=None, receive_id_type="open_id", images=None, **_):
        if self.user_tasks:
            await self.send_text(chat_id, "当前会话已有任务在运行，请等待完成或发送 /stop 后再试。",
                                 receive_id=receive_id, receive_id_type=receive_id_type)
            return
        state = {"running": True}
        self.user_tasks[chat_id] = state
        rid = receive_id or chat_id
        task_id = f"{chat_id}_{uuid.uuid4().hex}"
        hook_key = f"fs_{task_id}"
        card = fs._TaskCard(rid, receive_id_type)
        result = {"raw": None, "sent": False, "ask": None}
        finish_lock = threading.Lock()

        def _finish(raw):
            with finish_lock:
                if result["sent"]:
                    return
                result["raw"] = raw
                result["sent"] = True
            _cancel_ask(chat_id)
            card.done(fs._display_text(raw))
            fs._send_generated_files(rid, raw, receive_id_type=receive_id_type)

        def _ask(raw, event):
            with finish_lock:
                if result["sent"]:
                    return
                result["raw"] = raw
                result["sent"] = True
                result["ask"] = event
            _remember_ask(chat_id, event, menu_id=task_id, receive_id=rid, receive_id_type=receive_id_type)
            _finish_ask_card(card, raw, event, task_id)

        try:
            await asyncio.to_thread(card.start)
            if not hasattr(self.agent, "_turn_end_hooks"):
                self.agent._turn_end_hooks = {}
            self.agent._turn_end_hooks[hook_key] = _make_penglai_task_hook(card, task_id, _finish, _ask)
            self.agent._fs_active_task_id = task_id
            dq = self.agent.put_task(f"{fs.FILE_HINT}\n\n{text}", source=self.source, images=images or None)
            start = time.time()
            while state["running"] and not result["sent"]:
                try:
                    item = await asyncio.to_thread(dq.get, True, 1)
                except Q.Empty:
                    item = None
                if item and "done" in item:
                    await asyncio.to_thread(_finish, item.get("done", ""))
                    break
                if time.time() - start > fs.AGENT_TIMEOUT_SEC:
                    self.agent.abort()
                    await asyncio.to_thread(card.fail, "任务超时")
                    break
            if not state["running"] and not result["sent"]:
                self.agent.abort()
                await asyncio.to_thread(card.fail, "已停止")
        except Exception as e:
            traceback.print_exc()
            await asyncio.to_thread(card.fail, f"错误: {e}")
        finally:
            if getattr(self.agent, "_fs_active_task_id", None) == task_id:
                try:
                    delattr(self.agent, "_fs_active_task_id")
                except AttributeError:
                    pass
            if hasattr(self.agent, "_turn_end_hooks"):
                self.agent._turn_end_hooks.pop(hook_key, None)
            self.user_tasks.pop(chat_id, None)

    async def handle_command(self, chat_id, cmd, **ctx):
        s = (cmd or "").strip()
        if s == "/review" or s.startswith("/review ") or s.startswith("/review\t"):
            from frontends import review_cmd

            body = s[len("/review"):].strip()
            out = Q.Queue()
            prompt = review_cmd.handle(self.agent, body, out)
            if prompt is None:
                try:
                    item = out.get_nowait()
                    if "done" in item:
                        await self.send_text(chat_id, item["done"], **ctx)
                except Q.Empty:
                    pass
                return
            await self.run_agent(chat_id, prompt, **ctx)
            return
        return await orig_handle_command(self, chat_id, cmd, **ctx)

    def handle_message(data):
        event, message, sender = data.event, data.event.message, data.event.sender
        message_id = getattr(message, "message_id", "") or ""
        if not fs._claim_message_once(message_id):
            print(f"忽略重复飞书消息: {message_id}")
            return
        open_id = sender.sender_id.open_id
        chat_id = message.chat_id
        if not fs.PUBLIC_ACCESS and open_id not in fs.ALLOWED_USERS:
            print(f"未授权用户: {open_id}")
            return
        user_input, image_paths = fs._build_user_message(message)
        receive_id = chat_id or open_id
        receive_id_type = "chat_id" if chat_id else "open_id"
        chat_key = receive_id
        choice = _pop_choice(chat_key, user_input)
        if choice is not None:
            user_input = choice
        if not user_input:
            if chat_id:
                fs.send_message(chat_id, f"⚠️ 暂不支持处理此类飞书消息：{message.message_type}",
                                receive_id_type="chat_id")
            else:
                fs.send_message(open_id, f"⚠️ 暂不支持处理此类飞书消息：{message.message_type}")
            return
        print(f"收到消息 [{open_id}] ({message.message_type}, {len(image_paths)} images): {user_input[:200]}")
        if message.message_type == "text" and user_input.startswith("/") and choice is None:
            threading.Thread(
                target=fs._run_async,
                args=(fs.get_app().handle_command(chat_key, user_input,
                                                  receive_id=receive_id,
                                                  receive_id_type=receive_id_type),),
                daemon=True,
            ).start()
            return
        threading.Thread(
            target=fs._run_async,
            args=(fs.get_app().run_agent(chat_key, user_input,
                                         receive_id=receive_id,
                                         receive_id_type=receive_id_type,
                                         images=image_paths),),
            daemon=True,
        ).start()

    def handle_card_action(data):
        from lark_oapi.event.callback.model.p2_card_action_trigger import (
            P2CardActionTriggerResponse,
        )

        def resp(kind, content):
            return P2CardActionTriggerResponse({"toast": {"type": kind, "content": content}})

        try:
            event = getattr(data, "event", None)
            action = getattr(event, "action", None)
            operator = getattr(event, "operator", None)
            open_id = getattr(operator, "open_id", "") or ""
            if not fs.PUBLIC_ACCESS and open_id not in fs.ALLOWED_USERS:
                return resp("error", "未授权")
            value = getattr(action, "value", None) or {}
            if value.get("penglai_action") != "ask_user":
                return resp("warning", "未知操作")
            picked = _pop_menu_choice(value.get("menu_id"), value.get("index"))
            if not picked:
                return resp("warning", "这个选项已失效，请重新发消息。")
            threading.Thread(
                target=fs._run_async,
                args=(fs.get_app().run_agent(
                    picked["chat_key"],
                    picked["choice"],
                    receive_id=picked["receive_id"],
                    receive_id_type=picked["receive_id_type"],
                ),),
                daemon=True,
            ).start()
            return resp("success", f"已选择：{picked['choice']}")
        except Exception as e:
            traceback.print_exc()
            return resp("error", f"处理失败: {e}")

    fs.FeishuApp.run_agent = run_agent
    fs.FeishuApp.handle_command = handle_command
    fs.handle_message = handle_message
    fs.handle_card_action = handle_card_action
    fs._orig_penglai_feishu_run_agent = orig_run_agent
    fs._orig_penglai_feishu_handle_command = orig_handle_command
    fs._orig_penglai_feishu_handle_message = orig_handle_message


def main():
    import frontends.fsapp as fs

    _patch(fs)
    parser = argparse.ArgumentParser(description="Penglai Feishu frontend")
    parser.add_argument("--check", action="store_true", help="只检查飞书配置，不启动长连接")
    parser.add_argument("--check-agent", action="store_true", help="检查配置并初始化 Agent/LLM")
    args = parser.parse_args()
    if args.check or args.check_agent:
        print(json.dumps(fs.check_config(init_agent=args.check_agent), ensure_ascii=False, indent=2), flush=True)
        return None
    fs.APP_ID, fs.APP_SECRET, fs.ALLOWED_USERS, fs.PUBLIC_ACCESS, fs.CONFIG_PATH = fs._feishu_config()
    if not fs.APP_ID or not fs.APP_SECRET:
        print(f"错误: 请在 mykey 配置中填写 fs_app_id 和 fs_app_secret\n配置文件: {fs.CONFIG_PATH}", flush=True)
        sys.exit(1)
    builder = fs.lark.EventDispatcherHandler.builder("", "").register_p2_im_message_receive_v1(fs.handle_message)
    if hasattr(builder, "register_p2_card_action_trigger"):
        builder = builder.register_p2_card_action_trigger(fs.handle_card_action)
        _patch_lark_ws_card_dispatch()
    else:
        print("[WARN] 当前 lark-oapi 不支持 register_p2_card_action_trigger，飞书按钮将只能用文字回复兜底",
              flush=True)
    handler = builder.build()
    retry_delay = 5
    while True:
        try:
            fs.client = fs.create_client()
            cli = fs.lark.ws.Client(fs.APP_ID, fs.APP_SECRET, event_handler=handler,
                                    log_level=fs.lark.LogLevel.INFO)
            print("=" * 50 + "\n飞书 Agent 已启动（长连接模式）\n"
                  + f"App ID: {fs.APP_ID}\n配置: {fs.CONFIG_PATH}\n等待消息...\n"
                  + "=" * 50, flush=True)
            cli.start()
            retry_delay = 5
        except KeyboardInterrupt:
            raise
        except Exception as e:
            print(f"[WARN] 飞书长连接断开或启动失败: {e}", flush=True)
            traceback.print_exc()
        print(f"[INFO] {retry_delay}s 后重连飞书长连接...", flush=True)
        time.sleep(retry_delay)
        retry_delay = min(retry_delay * 2, 120)


if __name__ == "__main__":
    main()
