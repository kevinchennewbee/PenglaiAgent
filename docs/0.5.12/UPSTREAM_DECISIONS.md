# Penglai 0.5.12 upstream decisions

Status: in progress. Not a publication freeze. Public product identity
remains 0.5.11 until F04/F05.

Checked on 2026-09-08. A GitHub tag alone is not a consumable cohort.
Package count is discovered from the registry graph, not copied from 254.

| Dependency | Current pin | Probe (2026-09-08) | Decision |
| --- | --- | --- | --- |
| Official DSH | npm `0.1.2-rc.1` / `dsh-v0.1.2-rc.1` / `a66e4702047846cdaa10c66c9d3df3951f5ea70d` / 254 packages | 2026-09-08 live registry: dist-tags `alpha=0.1.3-alpha.2`, `latest=next=0.1.2-rc.1`. Root `@deepseek-ai/dsh@0.1.3-alpha.2` integrity `sha512-rmf4xgzU9+abvaQ//slyBBhADtPu8fv+SZjxmh4GJwJMZipVa7hNU5m23HgVcB3LNmuGltuQ7jyypuhJ5yU69A==`. GitHub tag `82a5fd61a7cf5c293cec4bdff68f455398d685e9`. Clone discovery: 251 DSH + 9 vendor + 3 landlock = 263. Extra root dep `@deepseek-ai/dsh-http-proxy`. Root tarball SHA-256 `6bced5e2da1000509e6d6a2b12242d4aac6ebdda8f12b7fe142a11c474409551`. Snapshot `docs/0.5.12/DSH_NPM_COHORT.json` digest `1d7380dadb281cdc17ad3df302b2298985c282e813b42d2694626842182000be`. | **Frozen**. Consume official npm `0.1.3-alpha.2` complete 263-package cohort with vendor/landlock independent pins. Lockfile and workspace overrides include `dsh-http-proxy`. Do not mix rc.1. |
| Standalone Node | `22.22.2` | Official nodejs.org index: `v22.23.2` 2026-07-28 `security=true` (LTS Jod). SHASUMS256 darwin-arm64 `61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6`, darwin-x64 `58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026`, win-x64 `1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97`. | **Upgrade to 22.23.2**. Same major, official security release. |
| Electron | `43.4.0` | GitHub: `v43.6.0` 2026-09-04 stable; `v44.2.0` 2026-09-04 is a new major. 43.6.0 SHASUMS256 darwin-arm64 `5183a2b15d013517386edd9f1ea8e3402755f6c3ea17893f92acb20052f3a2e7`, darwin-x64 `27f0ba89978e6a8a2fea212f8be8b114a60f5747df41f42f424b8b0131477ec4`, win32-x64 `4140545d6ed47b59c35900f266dea6c02f4a5496069ece7f6e7bc825e0d959c2`. | **Upgrade to 43.6.0**. Stay on 43.x; do not jump to 44 without a separate ABI review. |
| Mnemon native | `v0.2.4` / `67ed1a2f80de902fd041eeaf3b90e7e3d2480d5b` | GitHub `v0.2.8` 2026-09-05 commit `da9b7da0e3e7f10c84d5f8e9a42e24453c8159bb`; three-target archives present; checksums.txt recorded. | **Upgrade to 0.2.8 after archive/binary hash freeze and Windows `#`/`%`/CJK/old-db evidence**. Not frozen in this pin set until those hashes are written. |
| Feishu `@larksuiteoapi/node-sdk` | `1.73.0` | npm `latest=1.73.3` integrity `sha512-14Zj8r3f5CEIvpRuzb5HSYyp6O092N1kQkGHg6Kwi/c7B0CmXeCHBVM3Pmn0ozP5JvvAQd/PXBzW48rMH6cj4Q==`. GitHub commit that bumps package.json to 1.73.3: `af41737d1e9d0fdb08bdbbbe3019a7c64b3d9513` (`fix(ws): surface inbound frame errors`). npm `gitHead` on 1.73.0–1.73.3 is the stale `1889911f` and is not this pin. | **Upgrade to 1.73.3**. Same 1.73 line. Client / WSClient / EventDispatcher / `im.message.receive_v1` unchanged. Malformed inbound WS frames are logged instead of dropped. |
| sherpa-onnx | `1.13.5` | npm `latest=1.13.7` integrity `sha512-t6fsJmLWG5N51L950kr0u3sqP/bppOoLed0DWAXwJ/l1ziRPTwkvNy28aXb2720g9p8NbYoLLOS/GOf+vJTeZg==`. | **Upgrade to 1.13.7** with the existing three-target native fetch path. |
| onnxruntime-node | `1.23.2` | npm `1.29.0` ships napi-v6 for darwin-arm64, linux, win32; **no darwin-x64**. `1.23.2` still has darwin-arm64 + darwin-x64 + win32-x64. | **Keep 1.23.2**. 1.29.0 would drop Intel Mac native binaries. |
| DingTalk `dingtalk-stream` | `2.1.4` | npm versions: last non-prerelease `2.1.5` (2026-03-19, integrity `sha512-6H3tSc/mE6hMj4RBB5ntkI4ycC498RobmtMxfLS8eBTRPjBZlhUdDYEHA0asOoTLSzC2PHqupr4D4HVoaU7bRQ==`, tag `c979c664099a3bd175ab2f810753db0fc9e3a515`). Dist-tag `latest` is wrongly `2.1.6-beta.1`; `beta` is `2.1.7-beta.1`. DWClient / `TOPIC_ROBOT` / `registerCallbackListener` / `socketCallBackResponse` public types are identical to 2.1.4; 2.1.5 wraps WebSocket construct and connect retry. | **Upgrade to 2.1.5**. Do not consume the beta `latest` tag. |
| `libopus-wasm` | `0.2.0` / `55fe0b6faf9043518b7e1a7ea32e74659ecfbae7` | `0.3.0` 2026-09-05, peeled commit `bd37b907c636705d59cc2b836e6912e317a65a47`, integrity `sha512-2+woONr9rwcSj6HMQDC+cEdCb/WRBDwqHXEc42hhFLRB/jEumgl90ku09Blk6zb0Wd3Sewvk6KJEGhBg3IjApQ==`. Same `createEncoder`/`createDecoder`/`Application`/`Signal` API; Node 22+; rejects `maxPacketBytes` wrap. Owner-path scrub prefix unchanged. | **Upgrade to 0.3.0**. Keep libopus 1.6.1 WASM; refresh packed-module hashes. |
| `qrcode` | `1.5.4` | latest `1.5.4`. | **Keep 1.5.4**. |
| `docx` / `exceljs` / `pdf-lib` / `@pdf-lib/fontkit` / `@liustack/pptfast` | current | already at npm latest (`9.7.1` / `4.4.0` / `1.17.1` / `1.1.1` / `0.20.0`). pptfast is deprecated-renamed to pptpress/pptwise; do not follow a rename without an Office adapter rewrite. | **Keep**. |
| `@wecom/aibot-node-sdk` / `@tencent-connect/qqbot-nodejs` | `1.0.7` / `1.0.4` | already latest. | **Keep**. |
| `silk-wasm` / `sentencepiece-js` | `3.7.1` / `1.1.0` | already latest. | **Keep**. |
| TypeScript / React / pnpm / `@types/node` | `5.9.2` / `18.3.1` / `11.7.0` / `22.16.5` | latest are TS 7, React 19, pnpm 12, `@types/node` 26. | **Keep current majors**. Not an ABI review for 0.5.12. |
| esbuild | `0.25.9` | latest `0.28.2`. Advisory on the 0.25.9 line is the known local-dev server issue; esbuild is a build-time bundler, not a shipped runtime. | **Keep 0.25.9** this stage; do not jump 0.25→0.28 without a bundle retest. |
| tsx / resedit / fflate | `4.20.3` / `3.0.2` / `0.8.3` | tsx `4.23.13`, resedit `3.1.0`, fflate already latest. | **Keep**. Dev/packaging tools; no security-justified product change. |
| mammoth | pin `1.12.1` in `sources.lock.json` | latest `1.12.2`. Not a `package.json` production dependency. | **Keep unused 1.12.1 pin**. Do not add mammoth to the runtime graph. |

## DSH behavioral notes already observed from GitHub releases

alpha.1 (`d347e70`):

- Session persistence owned by lifecycle `SessionHandle`.
- `agentLoop.create()` is async.
- Session lock: at most one process holds a session.
- Session format v2 with immutable adjacent-generation migration from v0/v1.
- Known performance regression on some historical session loads (fixed in later notes).

alpha.2 (`82a5fd6`):

- Persona config split into prefix and suffix.
- Ordinary subprocess handle drops `pid`; terminal handles unchanged.
- Web disconnect auto-recovery.
- Long-session open/resume/continue memory improvements.
- Default tool changes for SDK/Headless/ACP (read/write/edit); Web minimal
  unchanged.
- pi-ai 0.85.1.

Penglai first-party plugins, RemoteError, session projections, Home
generation and IM/Memory/Office paths must be re-evidenced on the frozen
successor. Old Home generations stay preserved until a health-checked
pointer switch.

## 中文

上游结论以本文件的 Decision 列为准。GitHub 标签不能代替完整 npm 队列与
registry integrity。在图重建完成前不得把 0.5.11 的“alpha.1 没有 npm 包”
原句当成 0.5.12 的终裁。
