# -*- coding: utf-8 -*-
import os
import sys
import tempfile
from importlib.machinery import SourceFileLoader


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def test_repair_existing_generated_vision_api():
    import penglai_abilities as pa
    fd, path = tempfile.mkstemp(suffix=".py")
    os.close(fd)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write("import base64, requests\nurl = apibase.rstrip('/') + '/v1/chat/completions'\n")
        assert pa._repair_vision_api(path) == "repaired"
        txt = open(path, encoding="utf-8").read()
        assert "import base64, re, requests" in txt
        assert "_chat_completions_url(apibase)" in txt
        assert "def _chat_completions_url(apibase):" in txt
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def test_repaired_chat_completions_url_respects_versioned_base():
    import penglai_abilities as pa
    fd, path = tempfile.mkstemp(suffix=".py")
    os.close(fd)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(
                "import base64, requests\n"
                "def call(apibase):\n"
                "    return apibase.rstrip('/') + '/v1/chat/completions'\n"
            )
        assert pa._repair_vision_api(path) == "repaired"
        mod = SourceFileLoader("vision_api_repaired_test", path).load_module()
        assert mod.call("https://api.example.com/v1") == \
            "https://api.example.com/v1/chat/completions"
        assert mod.call("https://api.example.com/v2/") == \
            "https://api.example.com/v2/chat/completions"
        assert mod.call("https://api.example.com") == \
            "https://api.example.com/v1/chat/completions"
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def test_select_oai_config_accepts_provider_prefixed_native_config():
    import penglai_abilities as pa

    configs = {
        "mixin_config": {"llm_nos": [1]},
        "critic_model": {"apibase": True, "apikey": True, "model": True, "name": "Other"},
        "minimax_native_oai_config": {
            "apibase": True,
            "apikey": True,
            "model": True,
            "name": "minimax-m3",
        },
    }

    assert pa._select_oai_config_key(configs) == "minimax_native_oai_config"

    configs["native_oai_config"] = {
        "apibase": True,
        "apikey": True,
        "model": True,
        "name": "DeepSeek",
    }
    assert pa._select_oai_config_key(configs) == "native_oai_config"


def test_repair_vision_api_strips_thinking_blocks():
    import penglai_abilities as pa
    fd, path = tempfile.mkstemp(suffix=".py")
    os.close(fd)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(
                "import base64, requests\n"
                "def parse(resp):\n"
                "    return resp.json()['choices'][0]['message']['content']\n"
            )
        assert pa._repair_vision_api(path) == "repaired"
        mod = SourceFileLoader("vision_api_cleaned_test", path).load_module()

        class Resp:
            def json(self):
                return {"choices": [{"message": {"content": "<think>hidden</think>红色"}}]}

        assert mod.parse(Resp()) == "红色"
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


if __name__ == "__main__":
    test_repair_existing_generated_vision_api()
    test_repaired_chat_completions_url_respects_versioned_base()
    test_select_oai_config_accepts_provider_prefixed_native_config()
    test_repair_vision_api_strips_thinking_blocks()
    print("PASS test_vision_api")
