# -*- coding: utf-8 -*-
"""蓬莱：网页搜索（M5 — 开箱即用，多源求真）。

设计原则：
- **永远可用**：内置免 key 的 Bing 搜索兜底（HTTP 抓取，无头服务器/无浏览器也能搜）。
  GA 原生 web_scan 依赖真浏览器(Chrome/CDP)，云服务器无头环境用不了——本工具补上这一刀。
- **可叠加增强**：配了 TinyFish/Tavily/Firecrawl 任一 key，则与 Bing 一起多源并查 + 交叉验证，
  按域名去重，多源收敛标 ★（求真，不是省钱）。

源（Bing 始终在；其余配 key 即加入）：
- Bing（免 key，cn.bing.com HTML，开箱即用兜底）
- TinyFish Search（X-API-Key）  mykey: tinyfish_key
- Tavily（免费额度）            mykey: tavily_key
- Firecrawl（/v1/search）       mykey: firecrawl_key

挂载：类注入 do_web_search + agent_before 注入 schema（始终挂载，因 Bing 兜底永远可用）。GA 内核零改动。
"""
import re
import html as _html
from urllib.parse import urlparse, quote

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
    """返回当前可用源；Bing 免 key 始终在，配了 key 的高级源叠加。"""
    s = ["Bing"]
    if _mykey("tinyfish_key"): s.append("TinyFish")
    if _mykey("tavily_key"): s.append("Tavily")
    if _mykey("firecrawl_key"): s.append("Firecrawl")
    return s

def premium_sources():
    """配了 key 的增强源（不含 Bing 兜底）。"""
    return [s for s in enabled_sources() if s != "Bing"]

# ---- 各源适配（统一返回 [{title,url,snippet,source}]）----
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

def _bing(query, n):
    """免 key 兜底：cn.bing.com 结果页抓取。无头服务器可用（不需要浏览器）。"""
    import requests
    r = requests.get("https://cn.bing.com/search",
                     params={"q": query, "setlang": "zh-CN"},
                     headers={"User-Agent": _UA, "Accept-Language": "zh-CN,zh;q=0.9"}, timeout=15)
    out = []
    for b in re.findall(r'<li class="b_algo".*?</li>', r.text, re.S):
        m = re.search(r'<h2[^>]*><a[^>]*href="(https?://[^"]+)"[^>]*>(.*?)</a>', b, re.S)
        if not m:
            continue
        p = (re.search(r'<p class="[^"]*b_lineclamp[^"]*"[^>]*>(.*?)</p>', b, re.S)
             or re.search(r'<p[^>]*>(.*?)</p>', b, re.S))
        out.append({"title": _strip_html(m.group(2)), "url": m.group(1),
                    "snippet": _strip_html(p.group(1)) if p else "", "source": "Bing"})
        if len(out) >= n:
            break
    return out

def _strip_html(t):
    return _html.unescape(re.sub(r"<[^>]+>", "", t or "")).strip()

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

_ADAPTERS = {"Bing": _bing, "TinyFish": _tinyfish, "Tavily": _tavily, "Firecrawl": _firecrawl}

def search(query, n=8):
    srcs = enabled_sources()   # 至少含 Bing，永不为空
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
    multi = r["sources_used"] > 1
    head = f"网页搜索「{r['query']}」（{r['sources_used']} 源" + \
           (f"，{','.join(r['errors'])}失败" if r["errors"] else "") + "）："
    lines = [head]
    for i, x in enumerate(r["results"], 1):
        mark = "★" if x["convergent"] else " "
        lines.append(f"{mark}{i}. [{x['from']}] {x['title']}\n   {x['url']}\n   {x['snippet']}")
    if multi:
        lines.append("\n[★=多源收敛，可信度较高]。对照各源，发现分歧要明示并说明依据，勿只取单一来源下结论。")
    return "\n".join(lines)

def do_web_search(self, args, response):
    """网页搜索：Bing 免 key 兜底 +（配了 key 则）多源交叉验证。"""
    query = _clean(args.get("query", ""))
    if not query:
        return StepOutcome("[Error] query 不能为空",
                           next_prompt=self._get_anchor_prompt(skip=args.get("_index", 0) > 0))
    yield f"\n[Action] 网页搜索: {query}\n"
    out = _format(search(query, n=int(args.get("n", 8))))
    yield out[:500] + ("...\n" if len(out) > 500 else "\n")
    return StepOutcome(out, next_prompt=self._get_anchor_prompt(skip=args.get("_index", 0) > 0))

GenericAgentHandler.do_web_search = do_web_search

_SCHEMA = {"type": "function", "function": {
    "name": "web_search",
    "description": "网页搜索引擎：输入查询词，返回标题/链接/摘要。开箱即用（内置免费 Bing 兜底），"
                   "无头服务器也能搜——需要查实时信息（天气/新闻/事实）就用它，别用浏览器 web_scan"
                   "（无头环境没有浏览器）。配了多个搜索源时会交叉验证、多源收敛标 ★（更可信）。"
                   "需要某个网页的正文细节时，拿到 URL 再用浏览器或 code_run+curl 打开。",
    "parameters": {"type": "object", "properties": {
        "query": {"type": "string", "description": "搜索查询词"},
        "n": {"type": "integer", "description": "每源结果数，默认 8"}},
        "required": ["query"]}}}

@register("agent_before")
def _inject_search_schema(ctx):
    # 始终挂载：Bing 免 key 兜底永远可用（无头服务器的核心搜索能力）
    ts = ctx.get("tools_schema")
    if isinstance(ts, list) and not any(
            t.get("function", {}).get("name") == "web_search" for t in ts if isinstance(t, dict)):
        ts.append(_SCHEMA)
