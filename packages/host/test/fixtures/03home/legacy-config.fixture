# ══════════════════════════════════════════════════════════════════════════════
#  0.3 格式 fixture —— 按 mykey_template.py 的格式构造，全部凭证为假值。
#  覆盖：可迁移 OpenAI 兼容条目 ×2 / Anthropic 原生协议条目 / mixin /
#        半成品条目 / 占位 key / 非字面量 / 飞书渠道 / 其他平台渠道。
# ══════════════════════════════════════════════════════════════════════════════

# ── Mixin 故障转移（0.4 无对应机制 → 跳过） ─────────────────────
mixin_config = {
    'llm_nos': ['ds-main', 'relay-gpt'],
    'max_retries': 10,
    'base_delay': 0.5,
}

# ── 可迁移：DeepSeek 官方端点（native oai） ─────────────────────
native_oai_config0 = {
    'name': 'ds-main',
    'apikey': 'sk-fixture0000000000000000000000deadbeef',
    'apibase': 'https://api.deepseek.com',
    'model': 'deepseek-chat',
    'max_retries': 2,
}

# ── 可迁移：自建 OpenAI 兼容网关（apibase 带全后缀，测试规范化） ──
oai_config_relay = {
    'name': 'relay-gpt',
    'apikey': 'sk-relayfixture1111111111111111cafe',
    'apibase': 'https://relay.example.com/v1/chat/completions',
    'model': 'gpt-4o-mini',
    'temperature': 0.3,
    'stream': True,
}

# ── Anthropic 原生协议端点（CC 透传）→ 不映射 0.4 档案 ──────────
native_claude_config0 = {
    'name': 'cc-relay-1',
    'apikey': 'sk-user-fixture2222222222222222beef',
    'apibase': 'https://cc-switch.example.com/claude/office',
    'model': 'claude-opus-4-7',
    'fake_cc_system_prompt': True,
    'thinking_type': 'adaptive',
}

# ── 半成品条目（缺 model）→ 跳过 ────────────────────────────────
oai_config_halfdone = {
    'name': 'half-done',
    'apikey': 'sk-half333333333333333333333333',
    'apibase': 'https://api.example.com/v1',
}

# ── 模板占位 key → 跳过 ─────────────────────────────────────────
oai_config_placeholder = {
    'name': 'placeholder',
    'apikey': 'sk-<your-key-here>',
    'apibase': 'https://api.example.com/v1',
    'model': 'some-model',
}

# ── 非字面量（函数调用）→ unparsable 跳过 ───────────────────────
weird_config = load_key_from_somewhere()

# 全局 HTTP 代理（非会话变量 → 静默忽略）
proxy = 'http://127.0.0.1:2082'

# ── 聊天平台集成 ────────────────────────────────────────────────
fs_app_id = 'cli_fixtureaaaaaaaa'
fs_app_secret = 'fixturesecret0000000000000000ffffffff'
fs_allowed_users = ['ou_fixtureuser0001', 'ou_fixtureuser0002']

tg_bot_token = '123456:fixture-telegram-token'
tg_allowed_users = [123456789]
