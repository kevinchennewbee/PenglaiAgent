# -*- coding: utf-8 -*-
"""蓬莱插件：Critic 批判脑（M1 — 君子日三省乎己，降低单模型幻觉）。

第一性原理：GA 的记忆写入路径(do_start_long_term_update + L0 SOP)已写满"No Execution,
No Memory"的告诫；Critic 不重复告诫，而是补 GA 缺的两件事——
  ① 绊线检测(本地、免费)：模型无视告诫、想把"没有工具结果背书的结论"写进记忆时，抓住它。
  ② 跨厂商复核(可选、默认关闭)：换一个不同厂商的模型复查，单模型查不出自己的幻觉，换厂商才有视差。

范围 = 只审记忆写入(P1 light)：毒进记忆是永久伤害，最高优先。
挂载 = 包装 do_start_long_term_update(与 redline 同款，GA 零改动)。
上游安全 = 跨厂商不碰 GA 的 llmclients，改用 mykey.critic_model + 普通 requests，完全解耦。
"""
import re

from agent_loop import StepOutcome
from ga import GenericAgentHandler

# 绊线信号（i18n，用户可扩展）
_OVERCONFIDENT = re.compile(
    r"(全部|都)(搞定|解决|完成|修好)|应该(可以|没问题|能)了|肯定(是|没问题)|绝对(正确|没错)|"
    r"perfect|all set|should (work|be fine) now|fixed it|definitely|guaranteed", re.I)
# 声称"做了/验证了"却像是未经执行的措辞（弱信号，配合上面用）
_CLAIM_DONE = re.compile(r"(已经?|成功)(验证|确认|测试|跑通|完成)|verified|confirmed|tested", re.I)

def _mykey(name):
    try:
        import mykey
        return getattr(mykey, name, None)
    except Exception:
        return None

def tripwire(text):
    """本地免费绊线。返回命中的风险信号列表（空=未命中）。"""
    hits = []
    if _OVERCONFIDENT.search(text or ""): hits.append("过度自信措辞")
    return hits

def cross_vendor_review(history_text):
    """跨厂商复核（默认关闭）。配了 mykey.critic_model(异厂商)才触发。失败静默。"""
    cfg = _mykey("critic_model")
    if not isinstance(cfg, dict) or not cfg.get("apikey"):
        return None
    try:
        import requests
        q = ("你是批判脑，复核另一个 AI 即将写入长期记忆的内容。原则：只有经工具执行验证过的事实"
             "才允许长期记忆(No Execution, No Memory)。下面是它最近的工作摘要，请判断是否存在"
             "【未经验证就当作事实】的风险。若有风险，一句话指出最可疑的一条；若无，只回复"
             "「无明显风险」。\n\n" + history_text[-2000:])
        r = requests.post(cfg["apibase"].rstrip("/") + "/chat/completions",
                          json={"model": cfg["model"], "messages": [{"role": "user", "content": q}],
                                "max_tokens": 200, "temperature": 0},
                          headers={"Authorization": f"Bearer {cfg['apikey']}"}, timeout=20)
        txt = r.json()["choices"][0]["message"]["content"].strip()
        return None if (not txt or "无明显风险" in txt) else txt
    except Exception:
        return None  # 复核失败绝不阻断主流程

_orig = GenericAgentHandler.do_start_long_term_update

def _guarded_memory_update(self, args, response):
    # 档位(v1 设计的 5 档,当前实现 off/smart 两档;standard/max 在路线图):
    #   off   = 完全关闭(绊线也不跑)
    #   smart = 绊线常开(本地免费),命中才升级跨厂商复核(配了 critic_model 才有)——推荐默认
    if (_mykey("critic_mode") or "smart") == "off":
        return (yield from _orig(self, args, response))
    recent = "\n".join(getattr(self, "history_info", [])[-30:])
    hits = tripwire(recent + " " + (getattr(response, "content", "") or ""))
    outcome = None
    gen = _orig(self, args, response)
    try:
        while True: yield next(gen)
    except StopIteration as e:
        outcome = e.value
    if hits:
        caution = (f"\n\n[蓬莱批判脑] 检测到风险信号（{','.join(hits)}）。结算记忆前请逐条自检："
                   f"每条要写入的事实，是否有【本次任务的工具执行结果】直接背书？"
                   f"没有工具验证的结论一律不得写入长期记忆（No Execution, No Memory）。")
        review = cross_vendor_review(recent)
        if review:
            caution += f"\n[异厂商复核意见] {review}\n请据此重新核对再决定是否写入。"
        if outcome and outcome.next_prompt:
            outcome = StepOutcome(outcome.data, next_prompt=outcome.next_prompt + caution,
                                  should_exit=outcome.should_exit)
    return outcome

GenericAgentHandler.do_start_long_term_update = _guarded_memory_update
