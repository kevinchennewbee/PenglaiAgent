from penglai_feishu_ask import (
    build_ask_user_elements,
    extract_ask_user_event,
    render_ask_user_text,
    resolve_choice,
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
    assert buttons[0]["value"] == {"penglai_action": "ask_user", "menu_id": "m1", "index": 0}


def test_resolve_choice_by_number_or_exact_text():
    event = extract_ask_user_event(_ctx(candidates=["探深", "先停"]))
    assert resolve_choice("1", event) == "探深"
    assert resolve_choice("2", event) == "先停"
    assert resolve_choice("先停", event) == "先停"
    assert resolve_choice("3", event) is None
    assert resolve_choice("随便聊聊", event) is None
