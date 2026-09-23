# PUBLICATION 0.6.6

Status: `PUBLIC_READBACK_PASS` and `WEBSITE_READBACK_PASS`.

## Published identity

| Field | Value |
| --- | --- |
| Release | [`v0.6.6`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.6), immutable |
| Build source and peeled tag | `519a24be3702257bc7b0e0230d19fe3affd0a31b` |
| Release id | `394313621` |
| Published at | `2026-09-23T05:16:08Z` |
| Asset count | Ten, exactly the set in `release-contract.json` |
| Public asset-set seal | `ecdc9a2d6bdd7f273672bee1c5e191fdb6d542859f0184b2797a37f00bbb8378` |
| Website source | `fa503711d9c7953c4cfc6a28b06f0f3399fb2178` |

## Sequence and evidence

1. [Source PR #219](https://github.com/kevinchennewbee/PenglaiAgent/pull/219) brought the exact official DSH 0.1.7-alpha.2 cohort and non-Office first-party adaptation onto `main`. [Source CI](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35817658763) passed on the build SHA.
2. [Native run 35817677240](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35817677240) built Apple Silicon, Windows x64, and UOS loong64 from that one SHA. The aggregate passed `verify:release` (23 gates) and `verify:evidence` (80 hard ids, none missing or not run). Mac and Windows installed upgrades from 0.6.3 and 0.6.5 preserved user data; UOS package/ABI/closure passed without claiming UOS native function.
3. The mutable draft initially carried only the three exact installers. Assembly downloaded their draft bytes again, matched them to native evidence, signed updater metadata with the offline key, and added the remaining seven exact assets.
4. [Publish run 35821611965](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35821611965) checked all ten draft files and signatures, published the draft once, then downloaded all ten immutable public assets. Sizes, hashes, update signature and installer signatures passed; the public asset-set seal is recorded above.
5. [Publication PR #220](https://github.com/kevinchennewbee/PenglaiAgent/pull/220) updated README, security policy, release notes, manifest, and bilingual website content after the immutable readback. The first post-tag publication commit is `83853b16`; the website verifier confines that tag-to-commit window to publication paths.
6. [Website run 35823305676](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35823305676) verified the public Release again, sealed the site from the exact `fa503711` main commit, deployed it to `gh-pages`, and read both [Cloudflare Pages](https://penglai.pages.dev/) and [GitHub Pages](https://kevinchennewbee.github.io/PenglaiAgent/) back. All 34 sealed files matched on each origin, including the English and Chinese download pages.

## Boundaries

The two-hour installed soak remains `OWNER_EXCLUDED`. UOS native install, startup, UI and functional acceptance remain `OWNER_POST_RELEASE`. Private-account IM/iMessage live delivery was outside publication acceptance. macOS is not notarized; Windows has no Authenticode. Neither current source-secret scanning nor the public-export clean room proves that every historical Git object is free of key-like material.

## 中文

0.6.6 的正式发布顺序为：同一干净源码提交通过源码与三目标原生验收；可修改草稿先核对三个安装包，再补齐签名元数据；十项附件经独立流水线验证后公开，并从公网逐字节回读；随后更新 README 与英中官网，再对 Cloudflare 和 GitHub Pages 各 34 个文件进行公开回读。UOS 真机功能、私人消息账号在线收发、系统发布者签名不在已通过的验收集合内。
