export type PenglaiLocale = "zh" | "en";

export const PENGLAI_I18N = {
  zh: {
    appName: "蓬莱",
    appNameFull: "蓬莱 Penglai",
    centerTitle: "蓬莱插件中心",
    imTitle: "蓬莱消息",
    asrTitle: "蓬莱语音识别",
    ttsTitle: "蓬莱语音合成",
    aboutTitle: "关于蓬莱",
    aboutVersion: "版本 0.5.1",
    aboutDsh: "核心：DeepSeek Harness 0.1.1-rc.1",
    aboutTrust: "社区验证发行：macOS ad-hoc 未公证，Windows 无 Authenticode。不是静默自动更新。DSH 插件与本地 DSH 进程共享权限；蓬莱只分发逐版本审核并签名的插件。权限字段不是操作系统沙箱。",
    aboutData: "数据位于本机 Penglai/0.5，密钥写入 app-private YAML。",
    aboutLicense: "许可证见应用内 NOTICE 与 LICENSE。",
    welcome: "欢迎使用蓬莱",
    continue: "继续",
    later: "稍后",
    privacyTitle: "隐私与本地存储",
    privacyYaml: "API 密钥、微信令牌和飞书 App Secret 只写入本机 app-private official YAML。渲染进程不能读回明文。同一操作系统用户下的本地进程仍可能读取该文件；这不是 Keychain 或硬件隔离。",
    privacyIm: "微信与飞书只转发已绑定的私聊文本和语音。二维码、聊天正文和密钥不会进入日志或证据。",
    privacyContinue: "我已了解，继续",
    appearanceTitle: "语言与外观",
    appearanceHint: "默认中文。可随时切换 English，以及浅色、深色或跟随系统。这些能力来自 official DSH，不会被蓬莱删除。",
    appearanceOpen: "打开 official 语言与外观设置",
    modelsTitle: "选择模型供应商",
    modelsHint: "供应商与模型来自 official DSH/Pi catalog。密钥只通过 official Models 写入 YAML，蓬莱界面不收集明文。",
    modelsOpen: "打开 official 模型设置",
    workspaceTitle: "工作区",
    workspaceHint: "使用 official Workspace 选择或创建目录。不可写路径会失败并停在此步。",
    workspaceOpen: "打开 official Workspace",
    coreReadyTitle: "完成首次对话",
    coreReadyHint: "必须通过 official DSH nonce Turn 得到模型回复后，核心才算就绪。健康检查或模型列表不能代替这一步。",
    imOfferTitle: "连接消息渠道",
    imOfferHint: "插件默认已激活。可现在连接微信、配置飞书，或稍后在设置中完成。稍后不会禁用 IM。",
    imWeixin: "连接微信",
    imFeishu: "配置飞书",
    updateTitle: "更新",
    uninstallTitle: "存储与卸载",
    pluginSharedProcess: "DSH 插件与本地 DSH 进程共享权限；权限列表用于审核与确认，不是沙箱。",
    pluginNoArbitraryInstall: "0.5.1 只安装蓬莱签名目录中的插件，不提供任意 URL、npm 或 Git 安装。",
  },
  en: {
    appName: "Penglai",
    appNameFull: "Penglai",
    centerTitle: "Penglai Plugin Center",
    imTitle: "Penglai Messages",
    asrTitle: "Penglai Speech Recognition",
    ttsTitle: "Penglai Speech Synthesis",
    aboutTitle: "About Penglai",
    aboutVersion: "Version 0.5.1",
    aboutDsh: "Core: DeepSeek Harness 0.1.1-rc.1",
    aboutTrust: "Community-verified: macOS ad-hoc not notarized, Windows no Authenticode. This is not silent auto-update. DSH plugins share the local DSH process; Penglai only distributes version-reviewed signed plugins. Permission fields are not an OS sandbox.",
    aboutData: "Data stays in local Penglai/0.5. Secrets use app-private YAML.",
    aboutLicense: "See in-app NOTICE and LICENSE.",
    welcome: "Welcome to Penglai",
    continue: "Continue",
    later: "Later",
    privacyTitle: "Privacy and local storage",
    privacyYaml: "API keys, Weixin tokens, and Feishu App Secrets are written only to this machine's app-private official YAML. The renderer cannot read secrets back. A local process running as the same OS user may still read that file. This is not Keychain or hardware isolation.",
    privacyIm: "Weixin and Feishu forward bound private text and voice only. QR payloads, chat bodies, and secrets never enter logs or evidence.",
    privacyContinue: "I understand, continue",
    appearanceTitle: "Language and appearance",
    appearanceHint: "Chinese is the fresh default. English, plus light, dark, and system appearance, stay available. Those are official DSH capabilities and Penglai does not remove them.",
    appearanceOpen: "Open official language and appearance settings",
    modelsTitle: "Choose a model provider",
    modelsHint:
      "Providers and models come from the official DSH/Pi catalog. Keys are written only through official Models into YAML. Penglai does not collect the secret here.",
    modelsOpen: "Open official Models settings",
    workspaceTitle: "Workspace",
    workspaceHint: "Use the official Workspace chooser to select or create a directory. Unwritable paths fail and stay on this step.",
    workspaceOpen: "Open official Workspace",
    coreReadyTitle: "Finish the first conversation",
    coreReadyHint: "Core is ready only after an official DSH nonce Turn returns a model final. A health check or model list cannot mark this step passed.",
    imOfferTitle: "Connect messaging",
    imOfferHint: "The IM plugin is already active. Connect Weixin, configure Feishu, or continue later from settings. Later does not disable IM.",
    imWeixin: "Connect Weixin",
    imFeishu: "Configure Feishu",
    updateTitle: "Updates",
    uninstallTitle: "Storage and uninstall",
    pluginSharedProcess: "DSH plugins share the local DSH process. Permission lists are for review and confirmation, not a sandbox.",
    pluginNoArbitraryInstall: "0.5.1 installs only plugins from the Penglai-signed catalog. Arbitrary URL, npm, or Git install is not offered.",
  },
} as const;

export type PenglaiI18nKey = keyof (typeof PENGLAI_I18N)["zh"];

export function t(locale: PenglaiLocale, key: PenglaiI18nKey): string {
  return PENGLAI_I18N[locale][key];
}

export function assertCatalogComplete(): void {
  const zh = Object.keys(PENGLAI_I18N.zh);
  const en = Object.keys(PENGLAI_I18N.en);
  if (zh.length !== en.length || zh.some((k) => !en.includes(k))) {
    throw new Error("zh/en catalog keys diverge");
  }
}

const LIE = /notarized|Authenticode signed|silent auto-update|已公证|静默自动升级/i;

export function assertHonestTrustCopy(text: string): void {
  if (LIE.test(text) && !/not notarized|no Authenticode|不是静默|not silent/i.test(text)) {
    throw new Error("trust copy claims OS publisher trust or silent auto-update");
  }
}
