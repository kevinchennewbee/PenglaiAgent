# Penglai 0.6.2 publication

Recorded after immutable public readback of tag `v0.6.2`.

Penglai 0.6.2 publishes three installers and seven metadata files. The
[complete public byte manifest](PUBLICATION_MANIFEST_0.6.2.md) records every
size and SHA-256 value. The [release notes](RELEASE_NOTES_0.6.2.md) describe
the DSH `0.1.5-rc.2` migration, restored installed upgrade, security repair,
and known boundaries.

All installers were built from source
`83ce4aa3c153b63d9f84c6a5d650a3727e8cfec6`. [Source CI](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34709659692),
[CodeQL](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34709659600),
and the exact three-target [native run](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34709915417)
passed on that SHA. The signed draft was verified, published once, and all ten
immutable public assets passed download readback in [run 34712617415](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34712617415).

The later README, security entry, bilingual website, and these publication
records are a separate public-documentation commit. They do not change the
installer source. Website deployment independently checks that only allowed
publication files changed, binds every download to the immutable release, and
compares every deployed file at Cloudflare Pages and GitHub Pages.

macOS is ad-hoc signed and not notarized. Windows has no Authenticode. UOS
package identity, ABI, dependency closure, plugins, and licenses passed, while
native UOS install, startup, UI, file picker, sleep/resume, and functional use
remain `OWNER_POST_RELEASE`. The two-hour installed soak is `OWNER_EXCLUDED`.

## 中文

Penglai 0.6.2 已公开三个安装包和七项配套文件，精确公开字节见上方清单。所有
安装包来自源码 `83ce4aa3c153b63d9f84c6a5d650a3727e8cfec6`；源码 CI、CodeQL、三目标
原生任务、完整草稿验证与不可变公网回读均绑定该 SHA。

README、安全入口、双语官网和发布记录属于随后独立提交的公开文档，不能把文档
提交写成安装包来源。官网部署会另行核对变更边界、真实下载信息，并逐文件回读
Cloudflare Pages 与 GitHub Pages。

macOS 未公证，Windows 无 Authenticode。UOS 包身份、ABI、依赖闭包、插件与许可
已经通过，真机安装、启动、界面、文件选择器、休眠恢复和功能仍为
`OWNER_POST_RELEASE`。两小时安装版测试为 `OWNER_EXCLUDED`。
