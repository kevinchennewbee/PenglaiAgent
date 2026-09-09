# Penglai 0.6.0 upstream decisions

Status: in progress. Not a publication freeze. Public product identity
remains 0.5.12 until F04/F05.

Checked on 2026-09-09. A GitHub tag alone is not a consumable cohort.
Package count is discovered from the registry graph, not copied from
254 or 263.

| Dependency | Published 0.5.12 pin | Probe (2026-09-09) | Decision |
| --- | --- | --- | --- |
| Official DSH | npm `0.1.3-alpha.2` / `dsh-v0.1.3-alpha.2` / `82a5fd61…` / 263 packages | dist-tags `alpha=0.1.5-alpha.1`, `latest=next=0.1.2-rc.1`. Root `@deepseek-ai/dsh@0.1.5-alpha.1` integrity `sha512-AUjywjrPnhXcAdAjRNgyQa1QCnplFTNYZ+XpR9uCZdbg2FiCb06pHyoDUB2Wxuddzid9D7pVwEiU1OTl4Oshsg==`, shasum `5d008b33af044fcc726383112c36581f73138d2d`, tarball SHA-256 `c75e7e9168500eca90d27813d6d2b02eab124152c995f43bfa5c6a2504ac79e0`. Lightweight tag commit `5dda764ed3aa172535a7967b06ff95d9cbfe536a`, published 2026-09-08T16:16:04Z. npm has no 0.1.4. Changelog `dsh-v0.1.3-alpha.2...dsh-v0.1.5-alpha.1`. Session V3, remove `ctx.agent`, Inbox type-only, experimental Sidebar, native prebuilds instead of `fs-ext`. Discovered cohort **272** (258 DSH + 9 vendor + 5 `node-addon-system@0.1.2`). Landlock `0.1.1` is not in this tree. | **Consume 0.1.5-alpha.1** complete 272-package graph. Do not mix alpha.2 or leftover Landlock. F03 still writes the graph into product pins. |
| DSH IM | selective rewrite of `xmanrui/dsh-im` v3.0.5 / `64587b3b…` into `@penglai/im`; runtime not installed | `@xmanrui/dsh-im@4.17.1` MIT, commit `464c0a91762ebd0befc2d179f036eaae4864fb0e`, tarball SHA-256 `607a775b29e1355ab3f2953e45fb217f1102685202e0eca9f121d59abb138fec`, published 2026-09-08T20:13:17Z. Declares unmodified DSH `0.1.5-alpha.1` (and four earlier) compatibility via Connection public `/api`. Ships `cordis.patch.yml`, WhatsApp, and a public AI Office channel. | **Inspect and port** Connection `/api` management and applicable channel deltas into `@penglai/im`. **Do not install** the dsh-im runtime, copy `cordis.patch.yml`, ship WhatsApp, or replace `@penglai/office`. |
| Standalone Node (three existing targets) | `22.23.2` | Still current Node 22. | **Keep 22.23.2**. |
| Standalone Node (loong64) | none | nodejs.org `node-v22.23.2-linux-loong64.tar.gz` HTTP 404. unofficial-builds.nodejs.org same filename HTTP 200, SHA-256 `36d02422cc40211415b394b9e24d2d62c0a346405410a0cbdc13a11f97ec4cd1`, 57 692 301 bytes, 2026-07-29. | **Pin unofficial-builds 22.23.2 loong64** for the UOS target only, with provenance. Not a substitute for official nodejs.org on darwin/win32. |
| Electron (three existing targets) | `43.6.0` | `43-x-y=43.6.0`; latest major `44.x`. Official 43.6.0 has linux-x64/arm64/armv7l, **no loong64**. | **Keep 43.6.0** for Mac/Windows. Do not jump to 44. |
| Electron (loong64) | none | `darkyzhou/electron-loong64` MIT latest `v43.4.1` (2026-09-04). Asset `electron-v43.4.1-linux-loong64.zip` SHA-256 `58c900f8c38d42290fb4bdc0dc3df90a5977efd96aa39f06ce4bf4345a2fc4e9`. Requires glibc >= 2.38 and LSX (New-World). Source-build scripts exist for Electron 43 on a Loong64 host (32 GiB RAM / 200 GiB disk). | **Named community pin 43.4.1** for loong64, with digest/license, until a 43.6.0 loong64 rebuild exists. Disclose the 43.4.1 vs 43.6.0 skew. Trust-tier exception, not a fake core. |
| Mnemon native | `v0.2.8` / `da9b7da0…` three-target | GitHub latest still `v0.2.8`. No linux/loong64 assets. | **Keep 0.2.8** for three targets. loong64 Memory is S05; do not disable Memory. |
| Feishu `@larksuiteoapi/node-sdk` | `1.73.3` | npm `1.73.3` | **Keep**. |
| sherpa-onnx | `1.13.7` | npm `1.13.7` | **Keep**. |
| onnxruntime-node | `1.23.2` | npm `1.29.0` still **no darwin-x64** | **Keep 1.23.2**. |
| DingTalk `dingtalk-stream` | `2.1.5` | last non-prerelease `2.1.5`; dist-tag latest still a beta. dsh-im 4.17.1 depends on `2.1.4`. | **Keep 2.1.5**. Do not follow beta `latest` or downgrade to 2.1.4. |
| libopus-wasm / silk-wasm / sentencepiece-js / Office parsers | as frozen | unchanged vs 0.5.12 | **Keep**. |
| TypeScript / React / pnpm / `@types/node` | `5.9.2` / `18.3.1` / `11.7.0` / `22.16.5` | not an ABI review | **Keep current majors**. |

## DSH 0.1.5-alpha.1 behavioral notes (GitHub release)

- Dynamic system prompt updates without invalidating KV Cache when the
  model declares support.
- Experimental right Sidebar; Detail panel removed.
- **Session format V3:** upgrade supported historical sessions into new
  log files while preserving originals; system prompts in message
  history; legacy PTC/`code` preset migration. Custom readers must adapt.
  **Downgrade reads are not supported.**
- **Agent plugin API:** remove `ctx.agent`; pass Agent explicitly.
- **Inbox:** type-only interface; use `agent.inbox`; `hasPending`/`claim`
  are no longer public.
- fs-ext local compile on macOS/Linux fixed upstream.

Penglai first-party plugins, RemoteError, session projections, Home
generation and IM/Memory/Office paths must be re-evidenced on the frozen
successor. Old Home generations stay preserved until a health-checked
pointer switch. V3 writers must leave the previous session files in
place.

## DSH IM 4.17.1 integration rule

Penglai IM remains `@penglai/im`. 4.17.1 is a DSH plugin that talks to
unmodified DSH over Connection `/api`, which is the class to port. It is
not a drop-in replacement: it vendors `cordis.patch.yml`, includes
WhatsApp (permanently rejected), and ships a public AI Office that would
collide with required `@penglai/office`.

## Freeze rule

After the current inventory is written into `COHORT_FREEZE.json`, stop
chasing newer dist-tags for 0.6.0. A later DSH/IM release needs a new
version authorization.

## 中文

上游结论以 Decision 列为准。GitHub 标签不能代替完整 npm 队列。会话 V3
必须保留原文件。DSH IM 只作审查后的 `@penglai/im` 移植来源，不得当第二
套 IM 核心。龙芯 Node/Electron 允许已审查、带摘要的社区/unofficial-builds
来源，并写明与三端官方钉选的差异。
