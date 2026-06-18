import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _harness import run_tests
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
    _explicit_interaction_event,
    _install_display_cleaners,
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
    event = extract_ask_user_event(_ctx(candidates=[
        {"label": "A", "description": "探深", "value": "deep"},
        {"label": "B", "description": "先停", "value": "stop"},
    ]))
    elements = build_ask_user_elements("我把发现落盘了。再问您：", event, menu_id="m1")
    assert elements[0]["tag"] == "markdown"
    assert "点击按钮" in elements[0]["content"]
    buttons = [e for e in elements if e["tag"] == "button"]
    assert [b["text"]["content"] for b in buttons] == ["1. A: 探深", "2. B: 先停"]
    assert buttons[0]["behaviors"] == [{
        "type": "callback",
        "value": {
            "penglai_action": "interaction_choice",
            "request_id": "m1",
            "menu_id": "m1",
            "index": 0,
        },
    }]
    assert "value" not in buttons[0]


def test_card_menu_choice_consumes_pending_state():
    _ASK_STATE.clear()
    _ASK_BY_MENU.clear()
    event = extract_ask_user_event(_ctx(candidates=[
        {"label": "A", "description": "探深", "value": "deep"},
        {"label": "B", "description": "先停", "value": "stop"},
    ]))
    _remember_ask("chat1", event, menu_id="m1", receive_id="chat1", receive_id_type="chat_id")
    picked = _pop_menu_choice("m1", 1)
    assert picked == {
        "chat_key": "chat1",
        "choice": "stop",
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


def test_install_display_cleaners_keeps_feishu_v5_in_wrapper_layer():
    fs = types.SimpleNamespace(_TRUNC_TAIL=20)

    _install_display_cleaners(fs)

    assert "currently active" in fs.FILE_HINT
    assert fs._clean("LLM Running (Turn 1) ...\n<summary>hidden</summary>\n完成") == "完成"
    assert fs._extract_files("[FILE:/tmp/report.pdf\n") == ["/tmp/report.pdf"]
    assert fs._strip_files("完成\n[FILE:/tmp/report.pdf]") == "完成"
    assert fs._display_text("<summary>hidden</summary>\n完成\n[FILE:/tmp/report.pdf]") == "完成"
    assert fs._display_text("<summary>hidden") == ""
    assert fs._display_text("") == "⚠️ 模型输出被截断或为空"


def test_explicit_feishu_choice_request_becomes_real_interaction_event():
    event = _explicit_interaction_event("问我一个三选一问题，主题关于今晚安排，用飞书选项卡让我选择 A、B、C。")

    assert event == {
        "question": "今晚安排，请选择一个选项：",
        "candidates": ["A", "B", "C"],
    }


def test_explicit_free_text_question_becomes_interaction_event_without_buttons():
    event = _explicit_interaction_event("我现在缺一个城市信息，你先问我缺哪个城市，不要给候选项。")

    assert event == {
        "question": "缺哪个城市：",
        "candidates": [],
    }


def test_normal_file_request_is_not_taken_over_by_interaction_fallback():
    assert _explicit_interaction_event("生成一个 PDF 测试文件并发给我") is None


def test_resolve_choice_by_number_or_exact_text():
    event = extract_ask_user_event(_ctx(candidates=["探深", "先停"]))
    assert resolve_choice("1", event) == "探深"
    assert resolve_choice("2", event) == "先停"
    assert resolve_choice("先停", event) == "先停"
    assert resolve_choice("3", event) is None
    assert resolve_choice("随便聊聊", event) is None


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
