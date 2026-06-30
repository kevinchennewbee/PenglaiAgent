import frontends.conductor as conductor


def test_conductor_token_check_rejects_missing_token():
    assert conductor._token_ok("") is False


def test_conductor_index_bootstraps_token():
    resp = conductor.index()
    assert "window.__PENGLAI_CONDUCTOR_TOKEN__" in resp.body.decode("utf-8")


def test_conductor_rejects_non_loopback_origin():
    assert conductor._is_loopback_origin("http://127.0.0.1:8900") is True
    assert conductor._is_loopback_origin("https://evil.example") is False
