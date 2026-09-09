# Penglai 0.6.0 publication

Recorded after immutable public readback of tag `v0.6.0`.

Penglai 0.6.0 publishes four installers and seven required metadata files. [The complete public byte manifest](PUBLICATION_MANIFEST_0.6.0.md) records their sizes and SHA-256 values. [Release notes](RELEASE_NOTES_0.6.0.md) describe the DSH 0.1.5-alpha.1 adaptation, UOS packaging, upgrade behavior and known boundaries.

The installer build source is `7dd68b4ab08bbe4edf4dfac7f82abb6b164cb316`. [Source CI](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34376782684) and [CodeQL](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34376781577) passed on that source. Native run [34376799819](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34376799819) built the four installers (target jobs SUCCESS). Its GitHub aggregate job FAILED while looking for `.native/linux-loong64/Penglai_0.6.0_uos_loong64.deb`; the uploaded artifact stored `dist/Penglai_0.6.0_uos_loong64.deb`. That aggregate job is not PASS and is not waived. Local collection of those unchanged artifacts produced `verify:release` PASS bound to the freeze SHA. The signed mutable draft was then completed, published once, and all eleven immutable public assets were downloaded.

The later README, security entry, bilingual website, collector-path repair and publication documents are documentation and publication-scope changes. Their commit is not the installer's build source. Website deployment independently verifies publication-only changes and exact download facts; its final readback checks every deployed file at both [Cloudflare Pages](https://penglai.pages.dev/) and [GitHub Pages](https://kevinchennewbee.github.io/PenglaiAgent/). Deployment completion is established by that workflow's actual result.

Signed Plugin Center distribution reused live catalog `plugin-catalog-v1.000006` after [catalog mode PASS](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34415171352) against DSH `0.1.5-alpha.1`. This release supplies the complete signed update set with sequence 9. macOS remains not notarized and Windows has no Authenticode. Native UOS remains `OWNER_POST_RELEASE`. Electron 31.7.7 / Chromium 126 is not a Mac/Windows security-parity claim. No private account journey is inferred from automated tests. Published 0.5.10, 0.5.11 and 0.5.12 tags were not rewritten.

## 中文

0.6.0 已公开四个安装器和七项配套文件，精确公开字节见上方清单。安装包源码是 `7dd68b4ab08bbe4edf4dfac7f82abb6b164cb316`。源码 CI、CodeQL、四端目标作业、完整草稿验证和不可变公网回读均绑定该 SHA。GitHub 汇总作业因 UOS 收集路径失败，不能标 PASS。

README、安全入口、双语官网、收集路径修复和发布记录属于随后独立提交的公开文档，不能把文档提交写成安装包来源。官网部署另行核对仅有允许的文档差异、真实下载信息，并逐文件回读两个公网站点；以该部署任务的实际结果确认上线。

macOS 未公证、Windows 无 Authenticode；UOS 真机为 Owner 发布后测试。无凭据自动检查不代表私人账号或真实模型回复已验证。
