import frontends.conductor as conductor


def test_conductor_token_check_rejects_missing_token():
    assert conductor._token_ok("") is False


def test_conductor_index_bootstraps_token():
    resp = conductor.index()
    assert "window.__PENGLAI_CONDUCTOR_TOKEN__" in resp.body.decode("utf-8")


def test_conductor_rejects_non_loopback_origin():
    assert conductor._is_loopback_origin("http://127.0.0.1:8900") is True
    assert conductor._is_loopback_origin("https://evil.example") is False


def test_conductor_index_page_does_not_accept_query_token_in_url():
    """0.3.5：root 页面不再把 token 放进 URL query，避免 history/referer 泄漏。

    index() 返回的 HTML 应通过 window.__PENGLAI_CONDUCTOR_TOKEN__ 注入 token，
    而不是 ?token=... 形式。同时 __main__ 启动不应再用 ?token= 打开浏览器。
    """
    import inspect

    body = conductor.index().body.decode("utf-8")
    # 注入式 token 存在
    assert "window.__PENGLAI_CONDUCTOR_TOKEN__" in body
    # HTML 里不应出现 ?token= 这种 query 传参写法
    assert "?token=" not in body
    assert "location.search" not in body

    # __main__ 启动行不应再用 ?token= 打开浏览器
    source = inspect.getsource(conductor)
    main_block = source[source.rfind('if __name__ == "__main__":'):]
    assert "?token=" not in main_block, "conductor __main__ must not open browser with ?token= query"


def test_conductor_ws_protocol_token_parses_subprotocol():
    """WebSocket 改用 sec-websocket-protocol 子协议传 token，不再走 query。"""

    class FakeWS:
        def __init__(self, headers):
            self.headers = headers

    # 正常子协议形式 penglai.<token>
    ws = FakeWS({"sec-websocket-protocol": "penglai.abc123, chat"})
    assert conductor._ws_protocol_token(ws) == "abc123"

    # 没有子协议头
    ws = FakeWS({})
    assert conductor._ws_protocol_token(ws) == ""

    # 子协议头但无 penglai. 前缀
    ws = FakeWS({"sec-websocket-protocol": "chat, json"})
    assert conductor._ws_protocol_token(ws) == ""


def test_conductor_auth_middleware_ignores_query_token():
    """conductor_auth 中间件不应再从 query params 读 token（0.3.5 收紧）。

    验证源码里中间件分支不包含 req.query_params.get('token')。
    """
    import inspect

    src = inspect.getsource(conductor.conductor_auth)
    assert "query_params" not in src, (
        "conductor_auth must not read token from query params; "
        "only X-Penglai-Bridge-Token header is accepted"
    )
    assert "X-Penglai-Bridge-Token" in src

