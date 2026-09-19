# Penglai 0.6.5 release notes

Status: draft for an unpublished version. The public readback record is added by
the release process after the immutable bytes exist; until then nothing here
claims a published artifact.

English first, Chinese second. Known limitations are stated rather than omitted.

---

## English

### Penglai 0.6.5

A fix release. The upstream baseline is unchanged from 0.6.3 — official DSH
`0.1.6-alpha.2` (tag `dsh-v0.1.6-alpha.2`, commit
`ddefc45fbc7f8e46dd73185e68295696d1297887`, 307-package npm cohort). No features
are added, and nothing that was excluded returns.

Most of this release is one kind of repair. Several parts of Penglai had frozen
an assumption about something outside the repository, and nothing ever re-checked
it, so the gates stayed green while the product was broken.

#### WeChat works again

WeChat could not be connected at all, for eight releases. Tencent serves the whole
iLink bot surface as `Content-Type: application/octet-stream` while the body is
the documented JSON envelope, and a content-type allowlist added on 2026-08-24
rejected that as a policy violation. The QR code was being generated correctly by
Tencent the entire time; Penglai refused to read it.

The content-type gate is replaced by per-endpoint response validation, which
checks the body rather than a claim about the body and is strictly stronger. Two
related misreports are fixed: a refused QR request used to be reported as an
expired credential, and the error text told you to check your network for a
refusal that was ours. The Tencent channel build we announce moves from 2.4.6 to
2.4.9, after confirming the endpoint set is identical across the two builds and
that both are accepted.

#### Software updates work again

"Check for updates" had been failing since 0.6.0. The check compared versions
against a rule that was correct when written and silently stopped matching when
the version number changed. Every attempt failed, and the window showed only
"Update operation failed".

The data generation is now declared by the signed manifest instead of inferred
from a version number, so this cannot recur at the next version.

#### Known limitations

- **On 0.6.0 through 0.6.3, the built-in updater cannot reach 0.6.5.** That defect
  lives in the installed client, so it cannot be fixed by an update the client is
  unable to find. Install 0.6.5 once by hand; later versions update normally.
- **UOS / LoongArch has no update channel.** The `.deb` is published and installs
  by hand, but it is not carried in the update manifest: native install, startup
  and function on that platform are `OWNER_POST_RELEASE` and have never been run
  on real hardware. Carrying it would create an automatic update path on a
  platform whose installer nobody has executed. Checking for updates there reports
  "current" rather than failing.
- **iMessage can miss messages whose body is stored only as rich text.** macOS
  keeps most modern message bodies in `attributedBody` rather than the `text`
  column, and the channel reads only `text`. A known gap, not a regression, and
  not fixed here.
- **The DingTalk channel can drop a message without telling you.** If DingTalk
  rotates the reply webhook to a shape the allowlist does not recognise, the
  message is discarded and DingTalk is told it was delivered. A known gap, not a
  regression, and not fixed here.
- UOS native install, startup and function remain `OWNER_POST_RELEASE`.
- The 0.6.3 to 0.6.5 installed-upgrade journey is `OWNER_EXCLUDED`.
- macOS builds are ad-hoc signed and not notarized. Windows builds carry no
  Authenticode signature.

#### Verification

Source, contract, security, chaos, soak, end-to-end and release-identity gates are
green at one clean commit. The WeChat and update regression tests were confirmed
to fail against the old code, so they cover the defects rather than restating the
fixes. Drift probes report their result in this release's record; a red probe does
not block a release, it blocks the release from claiming everything is fine.

---

## 中文

### 蓬莱 0.6.5

这是一个修复版本。上游基线与 0.6.3 相同 —— 官方 DSH `0.1.6-alpha.2`（tag
`dsh-v0.1.6-alpha.2`、commit `ddefc45fbc7f8e46dd73185e68295696d1297887`，307 包
npm cohort）。不新增功能，已排除的能力也不回归。

这个版本的大部分内容是同一种修复。蓬莱有几处把对外部现实的假设冻结在了代码里，
而没有任何东西再去核对它，于是门禁保持全绿，产品却是坏的。

#### 微信可以用了

微信此前完全无法连接，持续八个版本。腾讯把整个 iLink bot 接口以
`Content-Type: application/octet-stream` 返回，而响应体是文档化的 JSON 信封；
2026-08-24 加入的内容类型白名单把它当成策略违规拒绝了。腾讯一直在正常生成二维码，
是蓬莱拒绝读取它。

内容类型门被替换为逐端点的响应校验 —— 校验的是响应体本身，而不是关于响应体的声明，
因此严格更强。同时修掉两处误报：被拒绝的二维码请求此前被报成"凭据已过期"，而错误
文案会让你去检查网络，检查一个其实是蓬莱自己造成的拒绝。我们声明的腾讯渠道构建号
从 2.4.6 升到 2.4.9，升级前已确认两版端点集合一致、且服务器对两版都正常响应。

#### 自动升级可以用了

"检查更新"自 0.6.0 起一直失败。它用一条版本号规则做比较 —— 那条规则写的时候是对的，
在产品版本号变化的那一刻静默失效了。每次尝试都失败，而界面只显示"更新操作失败"。

现在数据代际由签名清单声明，而不是从版本号推断，所以下个版本不会再复发。

#### 已知限制

- **在 0.6.0 到 0.6.3 上，内置更新器无法到达 0.6.5。** 该缺陷在已安装的客户端里，
  无法通过它自己找不到的更新来修复。请手动安装一次 0.6.5；之后的版本可以正常更新。
- **UOS / 龙芯没有更新通道。** `.deb` 随包发布、手动安装，但不进入更新清单：该平台的
  真机安装、启动与功能为 `OWNER_POST_RELEASE`，从未在真实硬件上执行过。放进去等于给
  一个安装器从未被运行过的平台创建自动升级路径。在该平台检查更新会报告"当前已是最新"，
  而不是报错。
- **iMessage 会漏掉正文只存为富文本的消息。** macOS 把现代消息正文大多存在
  `attributedBody` 而非 `text` 列，而该渠道只读 `text`。已知缺口，不是回归，本版未修。
- **钉钉渠道可能在不告知的情况下丢弃消息。** 当钉钉轮换回复 webhook 到白名单不认识的
  形状时，消息被丢弃，而钉钉被告知投递成功。已知缺口，不是回归，本版未修。
- UOS 真机安装、启动与功能仍为 `OWNER_POST_RELEASE`。
- 0.6.3 到 0.6.5 的安装版升级为 `OWNER_EXCLUDED`。
- macOS 安装包为 ad-hoc 签名、未公证。Windows 安装包无 Authenticode 签名。

#### 验证

源码、契约、安全、混沌、浸泡、端到端与 release-identity 门禁在同一个干净提交上全绿。
微信与自动升级的回归测试已确认对旧代码会失败，因此它们覆盖的是缺陷本身，而不是复述
修复后的代码。漂移探针的结论记录在本版的发布记录中；探针变红不阻塞发布，但阻塞
"声称一切正常"。
