import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from penglai_feishu_ask import (
    build_ask_user_elements,
    extract_ask_user_event,
    render_ask_user_text,
    resolve_choice,
)
from penglai_feishu_app import (
    _ASK_BY_MENU,
    _ASK_STATE,
    _PENDING_QUEUE,
    _enqueue_pending,
    _pop_pending,
    _pop_menu_choice,
    _remember_ask,
    _redact_log_text,
)


def _ctx(question="下一步？", candidates=None, result="EXITED"):
    return {
        "exit_reason": {
            "result": result,
            "data": {
                "status": "INTERRUPT",
                "intent": "HUMAN_INTERVENTION",
                "data": {
                    "question": question,
                    "candidates": candidates if candidates is not None else ["继续", "停止"],
                },
            },
        }
    }


def test_extract_ask_user_event_keeps_candidates():
    event = extract_ask_user_event(_ctx())
    assert event == {"question": "下一步？", "candidates": ["继续", "停止"]}


def test_extract_ask_user_event_ignores_non_interrupt():
    assert extract_ask_user_event(_ctx(result="CURRENT_TASK_DONE")) is None
    assert extract_ask_user_event({"exit_reason": {"result": "EXITED", "data": {"status": "ok"}}}) is None


def test_render_ask_user_text_preserves_base_text_and_options():
    text = render_ask_user_text("我把发现落盘了。再问您：", extract_ask_user_event(_ctx()))
    assert "我把发现落盘了。再问您：" in text
    assert "**下一步？**" in text
    assert "1. 继续" in text
    assert "2. 停止" in text
    assert "回复序号" in text
    assert "点击按钮" not in text


def test_build_elements_can_include_buttons():
    event = extract_ask_user_event(_ctx(candidates=["探深", "先停"]))
    elements = build_ask_user_elements("我把发现落盘了。再问您：", event, menu_id="m1")
    assert elements[0]["tag"] == "markdown"
    assert "点击按钮" in elements[0]["content"]
    buttons = [e for e in elements if e["tag"] == "button"]
    assert [b["text"]["content"] for b in buttons] == ["1. 探深", "2. 先停"]
    assert buttons[0]["behaviors"] == [{
        "type": "callback",
        "value": {"penglai_action": "ask_user", "menu_id": "m1", "index": 0},
    }]
    assert "value" not in buttons[0]


def test_card_menu_choice_consumes_pending_state():
    _ASK_STATE.clear()
    _ASK_BY_MENU.clear()
    event = extract_ask_user_event(_ctx(candidates=["探深", "先停"]))
    _remember_ask("chat1", event, menu_id="m1", receive_id="chat1", receive_id_type="chat_id")
    picked = _pop_menu_choice("m1", 1)
    assert picked == {
        "chat_key": "chat1",
        "choice": "先停",
        "receive_id": "chat1",
        "receive_id_type": "chat_id",
    }
    assert "chat1" not in _ASK_STATE
    assert "m1" not in _ASK_BY_MENU


def test_invalid_card_menu_choice_keeps_pending_state():
    _ASK_STATE.clear()
    _ASK_BY_MENU.clear()
    event = extract_ask_user_event(_ctx(candidates=["探深", "先停"]))
    _remember_ask("chat1", event, menu_id="m1", receive_id="chat1", receive_id_type="chat_id")
    assert _pop_menu_choice("m1", 99) is None
    assert "chat1" in _ASK_STATE
    assert "m1" in _ASK_BY_MENU


def test_pending_queue_is_fifo_and_numbered():
    _PENDING_QUEUE.clear()
    assert _enqueue_pending({"text": "first"}) == 1
    assert _enqueue_pending({"text": "second"}) == 2
    assert _pop_pending()["text"] == "first"
    assert _pop_pending()["text"] == "second"
    assert _pop_pending() is None


def test_redact_log_text_masks_common_secrets():
    text = _redact_log_text("API Key: abc123 token=secret Bearer live-token sk-testsecret")
    assert "abc123" not in text
    assert "token=secret" not in text
    assert "Bearer live-token" not in text
    assert "sk-testsecret" not in text
    assert "API Key: ***" in text
    assert "token=***" in text
    assert "Bearer ***" in text
    assert "sk-***" in text


def test_resolve_choice_by_number_or_exact_text():
    event = extract_ask_user_event(_ctx(candidates=["探深", "先停"]))
    assert resolve_choice("1", event) == "探深"
    assert resolve_choice("2", event) == "先停"
    assert resolve_choice("先停", event) == "先停"
    assert resolve_choice("3", event) is None
    assert resolve_choice("随便聊聊", event) is None
