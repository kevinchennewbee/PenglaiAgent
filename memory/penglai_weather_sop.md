# 天气查询 SOP（蓬莱 · 免 key · 无头服务器可用）

用户问天气/气温/下不下雨/要不要带伞/穿什么时，用 **code_run** 跑下面的 Python
（Open-Meteo 免费、免 key、不需要浏览器——这是 SOP 不是工具，复用 GA 的 code_run，
蓬莱层零新增代码，守形态梯度「能用 SOP 就不造工具」）：

```python
import urllib.request, urllib.parse, json
city = "北京"   # 换成用户问的城市；用户没指定就用记忆里他的常驻城市
def _get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "penglai"})
    return json.loads(urllib.request.urlopen(req, timeout=15).read().decode())
g = _get("https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&name="
         + urllib.parse.quote(city))
r0 = (g.get("results") or [None])[0]
if not r0:
    print("找不到城市：", city)
else:
    lat, lon = r0["latitude"], r0["longitude"]
    f = _get(f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
             "&timezone=auto&forecast_days=3&current=temperature_2m,weather_code"
             "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
             "&wind_speed_unit=kmh&temperature_unit=celsius")
    print(json.dumps(f, ensure_ascii=False))
```

- **WMO weather_code 速查**：0 晴 ｜ 1-3 少云/多云 ｜ 45-48 雾 ｜ 51-67 小到大雨/冻雨 ｜
  71-77 雪 ｜ 80-82 阵雨 ｜ 95-99 雷暴
- 拿到 JSON 后，**你（主力 LLM）把它说成一句自然、对用户有用的话**（穿衣/带伞/出行建议），
  别只甩数字。
- Open-Meteo 偶发不可达 → 兜底同样免 key 的 wttr.in：
  `code_run` 跑 `import urllib.request; print(urllib.request.urlopen("https://wttr.in/北京?format=j1", timeout=15).read().decode())`
- 安全：只读公开天气 API、不写盘、不外发文件，红线/出站白名单照常生效。
