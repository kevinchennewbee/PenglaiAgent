<div align="center">

<img src=".github/assets/banner.png" alt="Penglai 蓬莱" width="100%"/>

# Penglai · 蓬莱

### A self-hosted AI butler for Feishu, WeChat, and the terminal

**八仙过海，各显神通** · _each immortal crosses the sea in their own way_

[![License](https://img.shields.io/badge/code-MIT-22c55e?style=flat-square)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Channels](https://img.shields.io/badge/channels-Feishu%20%C2%B7%20WeChat%20%C2%B7%20Terminal-07C160?style=flat-square&logo=wechat&logoColor=white)](#)
[![Kernel](https://img.shields.io/badge/powered%20by-GenericAgent-8b5cf6?style=flat-square)](https://github.com/lsdefine/GenericAgent)
[![Website](https://img.shields.io/badge/%F0%9F%8C%90-Website-3fbaa6?style=flat-square)](https://kevinchennewbee.github.io/PenglaiAgent/)

[中文](README.md) · **English** · [Website](https://kevinchennewbee.github.io/PenglaiAgent/)

</div>

> **Official channels:** this GitHub repository · [kevinchennewbee.github.io/PenglaiAgent](https://kevinchennewbee.github.io/PenglaiAgent/) · PyPI [`penglai`](https://pypi.org/project/penglai). Do not enter API keys, bot tokens, or account credentials on unofficial sites or bots.

---

**Penglai** is a self-hosted AI butler that runs on your own machine. It connects to Feishu, WeChat, and the terminal; understands voice and images; remembers useful context; searches the web; writes code; runs tasks; and can proactively reach out under deterministic safety gates.

Bring a VPS, a Mac mini, or a Linux box, plus one LLM API key. The setup wizard gets you to a long-running personal AI butler in about ten minutes. Your memory, config, logs, and channel credentials stay on your machine.

## Origin

I spent ten years in networking, security, and operations, but I could not write code. Every line in this project was spoken into existence with AI coding tools.

Penglai exists because AI agents should not belong only to people who can write code, operate terminals, and edit config files. CLI agents are powerful. Desktop agents are useful. But for ordinary users, the interface they open every day is the chat app. If you can send a WeChat message, you should be able to use an agent.

Penglai is not another toy chatbot. It puts a working agent into Feishu and WeChat so it can be called during a commute, between meetings, before sleep, or from anywhere your phone already is. When you opt in, it can also proactively handle the small but important things: weather warnings, reminders, emotional follow-ups, and check-ins.

The name comes from Penglai, the legendary immortal island in Chinese mythology. For ancient people, Penglai was a magical place hidden behind the sea mist. For many ordinary people today, AI is hidden behind APIs, terminals, config files, and English docs. Penglai tries to move that island into your chat window.

## What It Can Do

- **Feishu and WeChat by QR code**: Feishu long connection without a public IP; personal WeChat QR login; terminal TUI included. The 0.3.0 preview has focused validation on Feishu; WeChat is enabled after local account binding.
- **One butler across entries**: Feishu, WeChat, and terminal share one memory and one execution path.
- **Voice emotion recognition**: local SenseVoice transcription with emotion signals such as happy, sad, angry, and fearful; this is an optional local capability that depends on the model and runtime engine being installed.
- **Image understanding path**: IM images are treated as vision tasks instead of guessed from filename, EXIF, or OCR-only text.
- **Four-layer file memory**: index, facts, skills, and raw sessions are stored as auditable Markdown.
- **Deterministic safety rails**: dangerous commands, sensitive paths, memory writes, outbound files, and logs are checked by rules, not model goodwill.
- **Web search out of the box**: works on headless servers; enhanced multi-source search can be enabled later.
- **Proactive companion**: weather alerts, voice-emotion follow-ups, morning/evening anchors, and long-silence check-ins with quiet hours and frequency gates; this is an opt-in long-running service.
- **Local skill marketplace**: reminders, email, parcel tracking, WeChat article fetch, office documents, market research, and more.
- **One-command install and headless service**: clean-machine install, China-network fallback, VPS-friendly long-running service paths.
- **Operational commands**: `penglai doctor`, `penglai status`, `penglai update`, and `penglai version` for health, services, upgrades, and release identity.

## What Changed in the New Architecture

Penglai's new architecture turns "many chat entries connected to one agent" into a coherent runtime. Instead of each channel acting as a separate wrapper, Feishu, WeChat, terminal, voice, files, and proactive events now pass through one Penglai runtime layer before reaching the GenericAgent execution core.

What users actually feel:

- **Fewer lost messages**: follow-up messages queue while a task is running, then continue automatically.
- **More coherent context**: proactive companion events, IM replies, and terminal conversations share one context event path.
- **More reliable file delivery**: images, videos, PDFs, Markdown, and Office documents are sent by real artifact type, while sensitive suffixes remain blocked.
- **Safer logs**: API keys, tokens, secrets, and authorization-like values are redacted consistently before logs and history.
- **Clearer service status**: Feishu, WeChat, scheduler, companion, and the Runtime Hub control service report separately.
- **Auditable runtime**: Runtime Hub records standard `TaskRun` state, so queueing, permission, cancellation, failures, and run history can be checked by doctor/selfcheck/audit.
- **Trustworthy version identity**: CLI, doctor, and IM `/version` report version, source, branch or commit, and build metadata.

This is not a rename. It moves Penglai from "an agent wired into chat apps" to "a multi-entry, operable, auditable personal-agent runtime."

## Quick Start

One command on a fresh machine:

```bash
curl -fsSL https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/main/install.sh | sh
```

From mainland China:

```bash
curl -fsSL https://gh-proxy.com/https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/main/install.sh | sh
```

Manual install:

```bash
git clone https://github.com/kevinchennewbee/PenglaiAgent.git
cd PenglaiAgent
python3 penglai setup
```

Daily commands:

```bash
penglai                         # chat in the terminal
penglai setup                   # rerun the setup wizard
penglai doctor                  # health check
penglai status                  # Feishu / WeChat / scheduler / companion status
penglai logs                    # recent logs
penglai channels                # channel matrix
penglai abilities               # voice / companion / search / critic overview
penglai enable voice|companion|intel|critic
penglai skill list              # local skill marketplace
penglai migrate                 # migrate from Hermes/OpenClaw
penglai version                 # version, install source, build identity
penglai update                  # safe upgrade
```

## Channels and Abilities

| Entry | How it connects | Status |
|---|---|---|
| Feishu | setup wizard, QR-created app, long connection | field-tested |
| WeChat personal account | setup wizard, QR login | wrapper routed through Runtime Hub; enable after local account binding |
| Terminal TUI | run `penglai` | field-tested |
| DingTalk / QQ / WeCom | `penglai enable <channel>` | wrapped, field validation ongoing |
| Telegram / Discord | paste bot token | wrapped, field validation ongoing |

| Ability | Description | 0.3.0 preview status |
|---|---|---|
| Voice | local transcription, emotion labels, WeChat silk decoding | optional; Tencent Cloud validation has verified SenseVoice ready, while incomplete installs are still reported honestly by doctor/install-check |
| Vision | IM images enter vision tasks instead of filename guessing | entry rules are in place; answer quality depends on the configured vision model |
| Memory | file-based long-term memory with write-time safety checks | core capability; memory hygiene and runtime-noise blocking are part of the hub checks |
| Search | free Bing fallback, optional multi-source search | default search works; TinyFish/Tavily/Firecrawl are opt-in enhancements |
| Proactive companion | weather, emotion follow-up, check-ins, quiet-hour gates | opt-in long-running service; gate logic is tested, Tencent Cloud validation has verified systemd active plus heartbeat gates |
| Critic | local tripwire plus optional cross-vendor review for memory writes | local tripwire is always available; cross-vendor review requires `penglai enable critic` and a second model |
| Skills | local SOP marketplace with install-time safety scan | installed on demand, not a Runtime Hub completion gate |
| Safety | command/path red lines, outbound-file checks, log redaction | enabled by default as deterministic guardrails |

## Penglai vs. GenericAgent

[GenericAgent](https://github.com/lsdefine/GenericAgent) is Penglai's execution core. It provides a clean agent loop: context in, LLM reasoning, tool execution, result flow back.

Penglai does not replace GenericAgent or fork its kernel into a private system. Penglai adds the layer ordinary users need to actually run it day to day:

| Dimension | GenericAgent | Penglai |
|---|---|---|
| Role | agent execution core | complete personal AI butler distribution |
| Setup | dependency and config knowledge required | one-command install plus guided wizard |
| Entries | terminal and upstream frontends | Feishu, WeChat, terminal, more IM wrappers |
| Voice / images | bring your own integration | distro-level voice, emotion, and image rules |
| Memory | core memory mechanism | memory hygiene, migration, skill index, audit boundary |
| Safety | basic | deterministic checks for commands, paths, logs, files, memory writes |
| Operations | mostly manual | doctor / status / logs / update / version |

Think of GenericAgent as the kernel. Penglai turns that kernel into something an ordinary person can install, connect, run, upgrade, and audit.

## Safety and Privacy

- Your API keys, chat records, memory, and channel credentials stay on your own machine by default.
- The public distribution does not include personal memory, logs, runtime history, tokens, or private config.
- Safety rails reduce risk; they are not an absolute security guarantee. Run Penglai on a server you control.
- Do not enter credentials on unofficial install sources, websites, or bots.
- Please redact sensitive data before reporting vulnerabilities. See [SECURITY.md](SECURITY.md).

## Latest Version

**2026-06-25 · v0.3.0**

v0.3.0 officially releases the Runtime Hub — a unified execution layer that normalizes all entry points (Feishu, WeChat, terminal, desktop) into consistent events and execution models. It ships native Mac (Apple Silicon) and Windows (x64) desktop clients with a full graphical setup wizard, multi-session chat workspace, system tray, channel & ability management panel, one-click update, and integrated diagnostics — feature-complete with the CLI install.

**Desktop downloads**: [GitHub Releases](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.3.0)

| Platform | Download | Notes |
|----------|----------|-------|
| macOS (Apple Silicon) | `Penglai_0.3.0_macos_aarch64.dmg` | Drag to Applications, then System Settings → Privacy & Security → Open Anyway |
| Windows (x64) | `Penglai_0.3.0_windows_x64_setup.exe` | Run installer, SmartScreen → More Info → Run Anyway |

**Command-line install** (Linux / macOS / Windows):
```bash
curl -fsSL https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/main/install.sh | sh
```

**Docker has been removed from the support matrix**: starting with 0.3.0, Penglai no longer ships Dockerfile, docker-compose, docker-install, GHCR image, or container deployment support. Use the desktop installers, command-line installer, PyPI bootstrap, or source install instead.

v0.3.0 does not mean every optional ability is enabled by default. Voice, TTS, companion, cross-vendor critic, intel enhancement, and IM channels are all enabled, diagnosed, and validated through `penglai abilities` / `penglai channels` state.

Recent highlights:

- **v0.3.0**: Runtime Hub full release. Mac/Windows native desktop clients (complete setup wizard + chat workspace + system tray + channel/ability management + supplementary config + integrated diagnostics). Feishu QR auto-creation, MOSS-TTS-Nano local speech synthesis, `penglai update` with auto-backup and rollback; Docker is fully removed from supported distribution paths.
- v0.2.27: install-network fallback hotfix; constrained networks fall back more reliably to mirrors or local source builds.
- v0.2.25: dependency-install network hotfix; one-line install now times out and retries with the Tsinghua PyPI mirror when the default PyPI index stalls.
- v0.2.24: GA-core boundary correction; LLM log redaction moved from the GenericAgent core file into a Penglai plugin, restoring the "do not modify upstream core" release boundary.
- v0.2.23: non-interactive install-boundary hotfix; installer output redirected to logs, CI, or remote automation no longer falls into the setup wizard.
- v0.2.22: install-idempotency hotfix; one-line install can be rerun after the first Python/dependency download is interrupted.
- v0.2.21: install-network hotfix; one-line install and the PyPI bootstrap fall back to source tarballs when the GitHub homepage or default mirror is unavailable.
- v0.2.20: new-architecture release with unified multi-entry runtime, message queueing, context events, file delivery, log redaction, service status, and version identity.
- v0.2.10: Feishu workflow fixes, button interaction, busy-message queueing, artifact delivery.
- v0.2.9: privacy/compliance cleanup, public asset notices, security docs.
- v0.2.8: Feishu human-intervention buttons, macOS launchd, WeChat wrapper commands, network fallback.
- v0.2.7: macOS supervision, image entry fix, key-leak prevention, voice error messages.
- v0.2.5: first local skill marketplace.
- v0.2.0: web search, proactive companion.

Full timeline: [website changelog](https://kevinchennewbee.github.io/PenglaiAgent/#changelog).

## License and Brand

- Code is released under [MIT](LICENSE).
- Upstream GenericAgent copyright notices are preserved.
- The "Penglai / 蓬莱" name, logo, and visual brand assets are reserved and are not covered by the code license.
- Third-party asset and high-permission tooling boundaries are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Thanks

Penglai stands on [GenericAgent](https://github.com/lsdefine/GenericAgent), and on everyone trying to make AI tools more ordinary, usable, and safe.
