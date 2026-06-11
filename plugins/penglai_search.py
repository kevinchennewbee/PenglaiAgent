# -*- coding: utf-8 -*-
"""蓬莱可选增强：情报矩阵（M5 — 多源不为省钱，为求真）。

设计原则（默认即 GA 原版）：
- 不配任何 key → 本工具【不挂载】，agent 用 GA 原生真浏览器 web_scan/web_execute_js（免费、开箱即用）。
- 安装时勾选"增强情报矩阵"并填 key → 本工具挂载，多个独立 API 源并查 + 交叉验证。
  全部是干净结构化 API（非 HTML 抓取）：返回真实 URL，按域名去重，多源收敛标 ★。

支持的源（任配其一即启用，免费优先）：
- TinyFish Search（免费、自有索引、X-API-Key）  mykey: tinyfish_key
- Tavily（免费额度）                            mykey: tavily_key
- Firecrawl（/v1/search）                       mykey: firecrawl_key

挂载：类注入 do_web_search + agent_before 注入 schema（仅当至少一个 key 存在）。GA 内核零改动。
"""
import re
from urllib.parse import urlparse

from plugins.hooks import register
from agent_loop import StepOutcome
from ga import GenericAgentHandler


def _mykey(name):
    try:
        import mykey
        return (getattr(mykey, name, "") or "").strip()
    except Exception:
        return ""

def _clean(t):
    return re.sub(r"\s+", " ", str(t or "")).strip()

def _domain(u):
    try: return urlparse(u).netloc.replace("www.", "")
    except Exception: return ""

def enabled_sources():
    """返回已配置 key 的源名列表；空=未启用增强（agent 走 GA 浏览器）。"""
    s = []
    if _mykey("tinyfish_key"): s.append("TinyFish")
    if _mykey("tavily_key"): s.append("Tavily")
    if _mykey("firecrawl_key"): s.append("Firecrawl")
    return s

# ---- 各源适配（统一返回 [{title,url,snippet,source}]）----
def _tinyfish(query, n):
    import requests
    r = requests.get("https://api.search.tinyfish.ai",
                     params={"query": query}, headers={"X-API-Key": _mykey("tinyfish_key")}, timeout=15)
    return [{"title": _clean(x.get("title")), "url": x.get("url"),
             "snippet": _clean(x.get("snippet")), "source": "TinyFish"}
            for x in r.json().get("results", [])[:n]]

def _tavily(query, n):
    import requests
    r = requests.post("https://api.tavily.com/search",
                      json={"api_key": _mykey("tavily_key"), "query": query, "max_results": n}, timeout=15)
    return [{"title": _clean(x.get("title")), "url": x.get("url"),
             "snippet": _clean(x.get("content")), "source": "Tavily"}
            for x in r.json().get("results", [])[:n]]

def _firecrawl(query, n):
    import requests
    r = requests.post("https://api.firecrawl.dev/v1/search",
                      json={"query": query, "limit": n},
                      headers={"Authorization": f"Bearer {_mykey('firecrawl_key')}"}, timeout=20)
    return [{"title": _clean(x.get("title")), "url": x.get("url"),
             "snippet": _clean(x.get("description")), "source": "Firecrawl"}
            for x in r.json().get("data", [])[:n]]

_ADAPTERS = {"TinyFish": _tinyfish, "Tavily": _tavily, "Firecrawl": _firecrawl}

def search(query, n=8):
    srcs = enabled_sources()
    if not srcs:
        return {"error": "情报矩阵未启用（未配置搜索 API key）。请用 GA 原生浏览器搜索，"
                         "或运行 penglai setup 勾选增强情报矩阵。"}
    results, errors = [], []
    for name in srcs:
        try:
            res = _ADAPTERS[name](query, n)
            if res: results.append(res)
        except Exception as e:
            errors.append(f"{name}({type(e).__name__})")
    if not results:
        return {"error": "所有已配置的搜索源均失败: " + "; ".join(errors)}
    # 按真实域名归并，多源收敛=高可信
    merged = {}
    for res in results:
        for it in res:
            if not it["url"]: continue
            key = _domain(it["url"]) or it["url"]
            if key not in merged:
                merged[key] = {**it, "seen_in": {it["source"]}}
            else:
                merged[key]["seen_in"].add(it["source"])
                if len(it["snippet"]) > len(merged[key]["snippet"]):
                    merged[key]["snippet"] = it["snippet"]
    items = sorted(merged.values(), key=lambda x: (-len(x["seen_in"]), -len(x["snippet"])))
    return {"query": query, "sources_used": len(results), "errors": errors,
            "results": [{"title": x["title"], "url": x["url"], "snippet": x["snippet"][:300],
                         "from": "+".join(sorted(x["seen_in"])),
                         "convergent": len(x["seen_in"]) > 1} for x in items[:10]]}

def _format(r):
    if "error" in r: return r["error"]
    head = f"情报矩阵「{r['query']}」（{r['sources_used']} 源" + \
           (f"，{','.join(r['errors'])}失败" if r["errors"] else "") + "）："
    lines = [head]
    for i, x in enumerate(r["results"], 1):
        mark = "★" if x["convergent"] else " "
        lines.append(f"{mark}{i}. [{x['from']}] {x['title']}\n   {x['url']}\n   {x['snippet']}")
    if r["sources_used"] > 1:
        lines.append("\n[★=多源收敛，可信度较高]。对照各源，发现分歧要明示并说明依据，勿只取单一来源下结论。")
    return "\n".join(lines)

def do_web_search(self, args, response):
    """情报矩阵：多 API 源并查 + 交叉验证。"""
    query = _clean(args.get("query", ""))
    if not query:
        return StepOutcome("[Error] query 不能为空",
                           next_prompt=self._get_anchor_prompt(skip=args.get("_index", 0) > 0))
    yield f"\n[Action] 情报矩阵检索: {query}\n"
    out = _format(search(query, n=int(args.get("n", 8))))
    yield out[:500] + ("...\n" if len(out) > 500 else "\n")
    return StepOutcome(out, next_prompt=self._get_anchor_prompt(skip=args.get("_index", 0) > 0))

GenericAgentHandler.do_web_search = do_web_search

_SCHEMA = {"type": "function", "function": {
    "name": "web_search",
    "description": "情报矩阵：同时查多个独立搜索 API（TinyFish/Tavily 等）并交叉验证，按来源去重、"
                   "多源收敛标 ★（可信度高）。适用于事实核查、要写入记忆/做决策的查证场景——"
                   "比单一来源更能发现分歧、降低幻觉。需要网页正文细节时再用浏览器打开具体链接。",
    "parameters": {"type": "object", "properties": {
        "query": {"type": "string", "description": "搜索查询词"},
        "n": {"type": "integer", "description": "每源结果数，默认 8"}},
        "required": ["query"]}}}

@register("agent_before")
def _inject_search_schema(ctx):
    # 仅当启用了情报矩阵（配了 key）才挂载；否则 agent 用 GA 原生浏览器
    if not enabled_sources():
        return
    ts = ctx.get("tools_schema")
    if isinstance(ts, list) and not any(
            t.get("function", {}).get("name") == "web_search" for t in ts if isinstance(t, dict)):
        ts.append(_SCHEMA)
