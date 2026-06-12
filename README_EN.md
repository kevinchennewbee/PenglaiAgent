<div align="center">

<img src=".github/assets/banner.png" alt="Penglai 蓬莱" width="100%"/>

# Penglai · 蓬莱

### Your personal AI butler, living in Feishu & WeChat

**八仙过海，各显神通** · _where eight immortals cross the sea, each shows their unique power_

[![License](https://img.shields.io/badge/code-MIT-22c55e?style=flat-square)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Channels](https://img.shields.io/badge/channels-Feishu%20%C2%B7%20WeChat-07C160?style=flat-square&logo=wechat&logoColor=white)](#)
[![Voice](https://img.shields.io/badge/voice-emotion%20aware-f59e0b?style=flat-square)](#)
[![Kernel](https://img.shields.io/badge/powered%20by-GenericAgent-8b5cf6?style=flat-square)](https://github.com/lsdefine/GenericAgent)

[中文](README.md) · **English** · [🌐 Website](https://kevinchennewbee.github.io/PenglaiAgent/)

</div>

---

**Penglai** is a personal AI butler that runs on your own server: scan a QR code to connect your
WeChat, three minutes to connect Feishu (Lark). It hears the emotion in your voice messages,
remembers what you told it, and gets real work done — research, code, scheduled tasks — while
**your memory belongs to you alone**, guarded by deterministic red lines rather than model goodwill.

One $5/month VPS, one LLM API key, a ten-minute wizard — and you have your own butler.

## 🌊 Origin: built by someone who can't code

I spent ten years in network engineering, security, and operations — and **I can't write code.
Not a single line.** Every line in this repository was "spoken" into existence through AI coding tools.
Penglai itself is the proof of its own thesis: **in the AI era, ordinary people can build their
own tools.**

It began with real pain. As an ordinary user determined to embrace this shift, I tried nearly
every agent tool I could get my hands on — and ran into their walls. I watched the CLI era shine
(Claude Code, OpenCode, Kimi CLI), then watched the desktop era mature and spread (Codex desktop,
Qoder, WorkBuddy, Claude Cowork) as agents moved into windows. They are all excellent. And they
all quietly assume the same thing: **you are sitting at a computer.**

I keep thinking about how personal computing actually unfolded: DOS gave computing to people who
could type commands; Windows gave it to anyone who could move a mouse; the mobile internet put it
in everyone's pocket. Agents are walking the same road — **CLI is their DOS, desktop apps are
their Windows, and the next stop is mobile, inside the fragments of your day.** Every vendor's
mobile app will have its own brilliance, but for ordinary people, the most convenient, simplest
tool they genuinely open every day is the chat app. **If you can text, you can use an agent** —
nothing new to learn.

[GenericAgent](https://github.com/lsdefine/GenericAgent) is the cleanest agent kernel I've seen,
so Penglai doesn't reinvent it — the core stands squarely on GA's shoulders. What Penglai adds is
the last mile: run it on any machine you own — a headless VPS, the Mac mini gathering dust in a
corner, Windows on the way — and let it live in your Feishu and WeChat: on your commute, between
meetings, always there.

## 🏝️ Why "Penglai"?

Penglai (蓬莱) is the legendary immortal island of Chinese mythology. The *Records of the Grand
Historian* tells of three sacred mountains in the eastern sea — Penglai among them — where
immortals dwell and the elixir of life is kept. China's first emperor sent the explorer Xu Fu
with three thousand youths to find it; they never reached its shores. For two thousand years,
"Penglai" has been the oldest Chinese name for **a wonderful place you can see but never reach.**

I chose the name because AI today is, for ordinary people, exactly what Penglai was to the
ancients: everyone has heard of its magic, yet few ever set foot on it — APIs, terminals, and
config files are the mist that keeps the island out of reach. **Penglai's mission is to move the
immortal island into your chat window: you don't need to learn to sail — if you can text, you
can come ashore.** The wonders of the AI era should not belong only to those who can code.

And the project motto — *"the Eight Immortals cross the sea, each revealing their unique power"*
(八仙过海，各显神通) — comes from the legend of eight immortals who each crossed to Penglai by
their own magic. That is the project's technical philosophy: many models, many channels, many
experts, each crossing the sea in its own way, all serving the same you.

## ✨ What it does

- 🏮 **Ten-minute setup** — a paged, bilingual (EN/中文) wizard (`penglai setup`): auto-installs deps (China-mirror aware) → pick a model & test connectivity → **one-page channel picker** (scan-to-create your Feishu bot, no console clicking) → name your butler → ability panel that actually activates things (voice on by default; companion/intel opt-in)
- 💬 **Feishu + WeChat, both native** — personal WeChat via QR login with text/voice/image in & out; Feishu over a long connection, no public IP needed
- 🎙️ **Ears that hear emotion** — SenseVoice running locally on CPU (~230MB): transcription + 7 emotion tags (happy/sad/angry/fearful…) + acoustic events (laughter/crying/applause…), arriving as `[voice (emotion: tired): such a long day]`. **Feishu/WeChat out of the box; DingTalk/QQ/WeCom voice added by the distro layer** — upstream frontends drop voice messages, so Penglai wraps voice reception (DingTalk/QQ also layer on local SenseVoice for emotion)
- 🧠 **Four-tier memory** — index / facts / skills / raw sessions as plain auditable markdown; every write passes a threat scan (prompt injection / role hijack / secret leakage), overwrites forbidden
- 🛡️ **Deterministic safety** — red-line blocking of dangerous commands & paths plus a full tool-call audit trail in JSONL — **safety by deterministic checks, not LLM goodwill**
- 🧐 **Double insurance against hallucination** — overconfidence tripwires trigger a second review by a **different vendor's** model (one model can't catch its own hallucinations); fact-finding tasks can fan out to multi-source cross-validated search
- 🌙 **Truly proactive, never spammy** <sub>opt-in</sub> — heartbeat + hard-coded gates: quiet hours, never interrupts a live conversation, frequency caps — like a friend thinking of you, not an alarm going off
- 🎛️ **Turn abilities on anytime** — didn't enable something in the wizard? One command later: `penglai enable voice|companion|intel` for abilities, `penglai enable <channel>` for IMs, `penglai abilities` for the full picture — no need to rerun setup
- ⚙️ **Ops in one command** — `penglai doctor` one-shot health check that **tells you the exact command to enable each inactive item** / `status` / `logs` / `update` one-command upgrade to the latest release

> Every item above runs daily on a real server. This is not a roadmap.

## 🚀 Quick Start

A fresh machine with nothing but an internet connection — **one command**. No Python, no git
required; the script sets up everything automatically:

```bash
curl -fsSL https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/main/install.sh | sh
```

🐳 **Docker, also one line** — pulls the image (falls back to building locally), walks you through
the wizard, then runs as an always-on container (auto-restart, survives reboots). All data lives
in the `penglai-data` volume, so upgrades never lose your config or memory:

```bash
curl -fsSL https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/main/docker-install.sh | sh
```

Prefer doing it by hand? The classic way works too:

```bash
git clone https://github.com/kevinchennewbee/PenglaiAgent.git
cd PenglaiAgent
python3 penglai setup    # wizard: language → deps → model → channel picker → ability panel
```

Day-to-day:

```bash
penglai            # chat with your butler right in the terminal (TUI, shares memory with Feishu/WeChat)
penglai doctor     # health check: env/deps/config/LLM/memory/services/upstream
penglai status     # service status (Feishu / scheduler / companion / WeChat)
penglai logs       # recent logs (penglai logs dingtalk for a specific channel)
penglai channels   # IM channel matrix overview
penglai abilities  # ability overview (voice/companion/intel — inactive ones show the enable command)
penglai enable voice|companion|intel   # turn on abilities you skipped in the wizard
penglai update     # upgrade to the latest Penglai (pulls the release repo, kernel already merged in)
```

> 🇨🇳 China-server friendly: deps via the Tsinghua PyPI mirror, models & code via gh-proxy — the
> wizard handles all of it automatically.

## 💬 Channel matrix: one butler, many doors

The GA kernel ships 7 IM frontends; the Penglai layer wraps them behind one command — `penglai enable <channel>` (deps → credentials → service → evidence-based startup). Every channel shares the same memory: **one butler, many doors**.

| Channel | How to connect | Voice | Status |
|---------|---------------|-------|--------|
| Feishu | `penglai setup` wizard, **scan-to-create app** | ✅ transcribe+emotion | ✅ field-tested |
| WeChat (personal) | `penglai setup` wizard, QR login | ✅ transcribe+emotion (silk) | ✅ field-tested |
| Terminal TUI | just run `penglai` | — | ✅ kernel built-in |
| DingTalk | `penglai enable dingtalk`, **scan-to-create app** | 🔧 wrapped (native ASR) | ⚠️ untested |
| QQ | `penglai enable qq`, **scan-to-create bot** | 🔧 wrapped (wav+emotion) | ⚠️ untested |
| WeCom | `penglai enable wecom`, paste AI-bot credentials | 🔧 wrapped (native ASR) | ⚠️ untested |
| Telegram | `penglai enable telegram`, paste @BotFather token | — | ⚠️ untested |
| Discord | `penglai enable discord`, paste developer-portal token | — | ⚠️ untested |

> Voice column: ✅ = field-verified; 🔧 = distro-layer voice reception (upstream frontends discard voice), pending real-device test; — = no voice on this channel.

> "Untested" = the adapter is upstream GA code and the Penglai wrapper is ready, but we haven't walked the full path on a real machine yet — each one gets promoted to ✅ as it passes. Honesty over polish.

## 🧬 Architecture: standing on a kernel's shoulders

Penglai is built on the [GenericAgent](https://github.com/lsdefine/GenericAgent) (GA) kernel — a
battle-tested ~130-line agent loop: `context → LLM → tools → results flow back`. Penglai is to GA
what Ubuntu is to the Linux kernel:

- **Zero kernel modifications** — the GA kernel files (`ga.py`, `frontends/`, `llmcore.py`, the memory tools …) stay at zero diff, so kernel upgrades merge cleanly; the distro layer only curates the tree on top — dropping upstream docs/demos irrelevant to the distribution and adding Penglai's own front page, CLI, plugins and SOPs;
- **Gradient of forms** — new capabilities prefer SOPs (0 lines of code), then hook plugins, then heartbeat modules, then tools — restraint is a design choice, not laziness;
- **Identity ≠ memory** — factory state ships zero user memory, just one line of identity. Your memory is your private asset and never enters the distribution.

| Penglai layer | Form | What it does |
|---|---|---|
| `penglai` CLI + wizard | entry | install, health check, service management, one-command upgrade |
| WeChat channel service | systemd | QR login; smart expired-token prompts (no blind restarts) |
| Voice + emotion | tool | local SenseVoice transcription + emotion + acoustic events; WeChat silk auto-decode |
| IM voice wrapper | launcher | adds voice reception that upstream DingTalk/QQ/WeCom frontends lack (monkeypatch, zero kernel diff) |
| Ability switches | CLI | `penglai enable/disable/abilities` — turn on voice/companion/intel anytime post-install |
| Redline + audit | hook | deterministic blocking of dangerous ops, full audit trail |
| Memory hygiene | hook | threat scan before writes + no overwrites |
| Critic brain | hook | cross-vendor second review, the hallucination antidote |
| Intelligence matrix <sub>opt-in</sub> | plugin | multi-source cross-validated search |
| Proactive companion <sub>opt-in</sub> | heartbeat | true proactivity inside hard gates |
| Penglai SOP pack | markdown | symbolic checkpoints, traceable compression, generative skills — 0 lines of code |

## 📜 License & Brand

- **Code**: [MIT](LICENSE). Upstream GenericAgent's copyright notice is preserved in full; the Penglai layer is © 2026 Kevin Chen, also released under MIT — use it, change it, sell it. See [NOTICE](NOTICE) for the code/brand boundary.
- **Brand**: the "蓬莱" / "Penglai" name, logo, and banner artwork are **all rights reserved** and not covered by the code license. Please don't use them to name or market your forks, derivatives, or commercial offerings without written permission.
  (The common open-source convention: free code, reserved brand — as practiced by Rust, Docker, and others.)
- **Kernel from upstream**: `ga.py`, `frontends/`, `llmcore.py`, the memory tools, etc. are [GenericAgent](https://github.com/lsdefine/GenericAgent)'s own kernel files (kept at zero diff); Penglai curates and extends on top. The only install entry points are `install.sh` / `docker-install.sh` (both pointing at `kevinchennewbee/PenglaiAgent`).

## 🙏 Acknowledgments

Penglai stands on the shoulders of:

- [GenericAgent](https://github.com/lsdefine/GenericAgent) (MIT) — the kernel itself: the minimalist agent loop, L1-L4 memory, self-evolving skill tree
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) (MIT) — doctor & install experience, channel quality standards, memory hygiene ideas
- [PilotDeck](https://github.com/OpenBMB/PilotDeck) (AGPL, design ideas only) — gate systems and reversibility discipline
- [SenseVoice / FunASR](https://github.com/FunAudioLLM/SenseVoice) · [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — CPU-friendly speech & emotion recognition
