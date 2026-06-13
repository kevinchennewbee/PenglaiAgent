# -*- coding: utf-8 -*-
"""免 key 搜索兜底回归测试（纯本地，不联网）。
锁住两件事：①无任何 key 时 Bing 兜底仍在、web_search 始终挂载；②Bing HTML 解析正则不漂。
运行: python tests/test_search_fallback.py
"""
import os
import sys
import types

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO not in sys.path:
    sys.path.insert(0, REPO)

# 伪 GA 依赖，隔离导入
for m, attrs in [("plugins.hooks", {"register": lambda e: (lambda f: f)}),
                 ("agent_loop", {"StepOutcome": type("S", (), {"__init__": lambda s, *a, **k: None})}),
                 ("ga", {"GenericAgentHandler": type("H", (), {})})]:
    mod = types.ModuleType(m)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules[m] = mod

import importlib.util
spec = importlib.util.spec_from_file_location("ps", os.path.join(REPO, "plugins", "penglai_search.py"))
ps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ps)

PASS = []
def check(name, cond):
    PASS.append((name, bool(cond)))
    print(("✅" if cond else "❌"), name)

# 1. 无 key 时 Bing 兜底仍在、premium 为空
import builtins
_orig = ps._mykey
ps._mykey = lambda name: ""        # 模拟零配置
check("无key时 enabled_sources 含 Bing", ps.enabled_sources() == ["Bing"])
check("无key时 premium_sources 为空", ps.premium_sources() == [])

# 2. schema 始终注入（不再 gate on key）
ctx = {"tools_schema": []}
ps._inject_search_schema(ctx)
names = [t.get("function", {}).get("name") for t in ctx["tools_schema"]]
check("web_search schema 始终挂载", "web_search" in names)

# 3. Bing HTML 解析正则（固定夹具，锁结构）
_FIXTURE = '''
<ol id="b_results">
<li class="b_algo"><h2 class=""><a target="_blank" href="https://www.weather.com.cn/x.shtml" h="ID=SERP,1">
<strong>北京</strong>天气预报</a></h2><div class="b_caption"><p class="b_lineclamp2">
今天晴，最高 28 度，最低 18 度，东南风。</p></div></li>
<li class="b_algo"><h2><a href="https://example.com/2">第二条结果标题</a></h2>
<p>第二条摘要内容在这里。</p></li>
<li class="b_algo"><h2><a href="javascript:void(0)">无效链接应被跳过</a></h2></li>
</ol>'''
class _FakeResp:
    text = _FIXTURE
ps_requests = types.ModuleType("requests")
ps_requests.get = lambda *a, **k: _FakeResp()
sys.modules["requests"] = ps_requests
rows = ps._bing("北京天气", 8)
check("Bing 解析出 2 条有效结果（跳过 javascript: 链接）", len(rows) == 2)
check("标题解析正确", rows[0]["title"] == "北京天气预报")
check("URL 解析正确", rows[0]["url"] == "https://www.weather.com.cn/x.shtml")
check("摘要解析正确（HTML 标签已去）", "28 度" in rows[0]["snippet"] and "<" not in rows[0]["snippet"])
check("第二条 fallback <p> 摘要", "第二条摘要" in rows[1]["snippet"])

# 4. search() 顶层走 Bing、格式化不报错
res = ps.search("北京天气", n=5)
check("search() 返回结果且无 error", "error" not in res and len(res.get("results", [])) == 2)
check("单源不标 ★（convergent=False）", all(not x["convergent"] for x in res["results"]))

ps._mykey = _orig
failed = [n for n, ok in PASS if not ok]
print(f"\n{len(PASS) - len(failed)}/{len(PASS)} 通过")
sys.exit(1 if failed else 0)
