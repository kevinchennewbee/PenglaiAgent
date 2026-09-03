# Penglai 0.5.10 publication

Recorded after immutable public readback: 2026-09-03T16:52:18.350923+00:00.

Penglai 0.5.10 publishes three native installers and all seven required metadata files. [The complete public byte manifest](PUBLICATION_MANIFEST_0.5.10.md) records their sizes and SHA-256 values. [Release notes](RELEASE_NOTES_0.5.10.md) describe the rc.1 adaptation, upgrade behavior and known boundaries.

The build source is `c5c0bcb022c5ae47cca242deb27fe1d30444c41d`. [Native build and installed checks](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33775824578) and [main Source CI](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33775804473) passed on that source. [Publication](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33780754033) verified the signed mutable draft, sealed its asset identities, published it once, and downloaded all ten immutable public assets.

The later README, security entry, bilingual website and publication documents are documentation changes. Their commit is not the installer's build source. Website deployment independently verifies publication-only changes and exact download facts; its final readback checks every deployed file at both [Cloudflare Pages](https://penglai.pages.dev/) and [GitHub Pages](https://kevinchennewbee.github.io/PenglaiAgent/). Deployment completion is established by that workflow's actual result.

The older 0.5.9 release's missing metadata remains recorded as a historical defect; no published old asset or tag was replaced. This release supplies the complete signed update set with sequence 6. macOS remains not notarized and Windows has no Authenticode. No private account journey is inferred from automated tests.

## 中文

0.5.10 已公开三个原生安装器和七项配套文件，精确公开字节见上方清单。三端安装与升级检查、源码 CI、完整草稿验证和不可变公网回读均绑定安装包源码 `c5c0bcb022c5ae47cca242deb27fe1d30444c41d`。

README、安全入口、双语官网和发布记录属于随后独立提交的公开文档，不能把文档提交写成安装包来源。官网部署另行核对仅有允许的文档差异、真实下载信息，并逐文件回读两个公网站点；以该部署任务的实际结果确认上线。

0.5.9 缺元数据的历史问题没有通过改写旧发布掩盖。0.5.10 提供完整签名更新组，序号为 6。macOS 未公证、Windows 无 Authenticode；无凭据自动检查不代表私人账号或真实模型回复已验证。
