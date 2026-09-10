import { PenglaiError, parseClosedEnum } from "@penglai/contracts";

export const CHANNEL_IDS = [
  "weixin",
  "feishu",
  "dingtalk",
  "wecom",
  "qq",
  "slack",
  "telegram",
  "discord",
  "imessage",
] as const;

export type ChannelId = (typeof CHANNEL_IDS)[number];
export const NATIVE_CHANNEL_IDS = ["weixin", "feishu"] as const;
export type NativeChannelId = (typeof NATIVE_CHANNEL_IDS)[number];
export const CONNECTION_METHODS = ["qr", "oauth", "manifest", "token", "device-link", "manual-fallback"] as const;
export type ConnectionMethod = (typeof CONNECTION_METHODS)[number];
export const CHANNEL_ADAPTER_MODES = ["native", "bundled-sidecar"] as const;
export type ChannelAdapterMode = (typeof CHANNEL_ADAPTER_MODES)[number];
export const CHANNEL_RELEASE_EVIDENCE = ["source-only", "installed", "owner-live", "public-release"] as const;
export type ChannelReleaseEvidence = (typeof CHANNEL_RELEASE_EVIDENCE)[number];
export const CHANNEL_CAPABILITY_EVIDENCE = ["source-tested", "not-proven", "not-supported"] as const;
export type ChannelCapabilityEvidenceLevel = (typeof CHANNEL_CAPABILITY_EVIDENCE)[number];
export const CHANNEL_WORKFLOW_CAPABILITIES = [
  "authentication",
  "inboundText",
  "outboundText",
  "file",
  "voice",
  "question",
  "approval",
  "recovery",
  "image",
  "audio",
  "reconnect",
  "exit",
] as const;
export type ChannelWorkflowCapability = (typeof CHANNEL_WORKFLOW_CAPABILITIES)[number];

export interface ChannelCapabilityEvidence {
  authentication: ChannelCapabilityEvidenceLevel;
  inboundText: ChannelCapabilityEvidenceLevel;
  outboundText: ChannelCapabilityEvidenceLevel;
  file: ChannelCapabilityEvidenceLevel;
  voice: ChannelCapabilityEvidenceLevel;
  question: ChannelCapabilityEvidenceLevel;
  approval: ChannelCapabilityEvidenceLevel;
  recovery: ChannelCapabilityEvidenceLevel;
  image: ChannelCapabilityEvidenceLevel;
  audio: ChannelCapabilityEvidenceLevel;
  reconnect: ChannelCapabilityEvidenceLevel;
  exit: ChannelCapabilityEvidenceLevel;
}

export interface ChannelManifestV1 {
  readonly id: ChannelId;
  readonly displayName: { readonly en: string; readonly zh: string };
  readonly connectionMethods: readonly ConnectionMethod[];
  readonly entryAvailable: true;
  readonly adapterMode: ChannelAdapterMode;
  readonly runtimeBundled: true;
  readonly releaseEvidence: ChannelReleaseEvidence;
  readonly capabilityEvidence: Readonly<ChannelCapabilityEvidence>;
  readonly connectionHint: { readonly en: string; readonly zh: string };
  readonly limits: { readonly textChars: number; readonly fileBytes: number; readonly requestsPerMinute: number };
  readonly defaultEnabled: boolean;
  readonly docsUrl: string;
}

const SOURCE_TEXT: ChannelCapabilityEvidence = {
  authentication: "source-tested",
  inboundText: "source-tested",
  outboundText: "source-tested",
  file: "not-supported",
  voice: "not-supported",
  question: "not-supported",
  approval: "not-supported",
  recovery: "not-proven",
  image: "not-supported",
  audio: "not-supported",
  reconnect: "not-proven",
  exit: "not-proven",
};

const SOURCE_MEDIA: ChannelCapabilityEvidence = {
  ...SOURCE_TEXT,
  file: "source-tested",
  voice: "source-tested",
  image: "source-tested",
  audio: "source-tested",
};

function manifest(row: ChannelManifestV1): ChannelManifestV1 {
  parseClosedEnum(row.adapterMode, CHANNEL_ADAPTER_MODES, "CHANNEL_ADAPTER_MODE", "SECURITY_POLICY");
  parseClosedEnum(row.releaseEvidence, CHANNEL_RELEASE_EVIDENCE, "CHANNEL_RELEASE_EVIDENCE", "SECURITY_POLICY");
  for (const capability of CHANNEL_WORKFLOW_CAPABILITIES) {
    parseClosedEnum(
      row.capabilityEvidence[capability],
      CHANNEL_CAPABILITY_EVIDENCE,
      `CHANNEL_CAPABILITY_${capability}`,
      "SECURITY_POLICY",
    );
  }
  const expectedMode = (NATIVE_CHANNEL_IDS as readonly string[]).includes(row.id) ? "native" : "bundled-sidecar";
  if (row.adapterMode !== expectedMode) throw new PenglaiError("SECURITY_POLICY", "CHANNEL_ADAPTER_MODE_MISMATCH");
  if (!row.connectionHint.en.trim() || !row.connectionHint.zh.trim()) {
    throw new PenglaiError("SECURITY_POLICY", "CHANNEL_CONNECTION_HINT");
  }
  return Object.freeze({
    ...row,
    displayName: Object.freeze({ ...row.displayName }),
    connectionMethods: Object.freeze([...row.connectionMethods]),
    capabilityEvidence: Object.freeze({ ...row.capabilityEvidence }),
    connectionHint: Object.freeze({ ...row.connectionHint }),
    limits: Object.freeze({ ...row.limits }),
  });
}

export const CHANNEL_MANIFESTS: Record<ChannelId, ChannelManifestV1> = {
  weixin: manifest({
    id: "weixin",
    displayName: { en: "Weixin", zh: "微信" },
    connectionMethods: ["qr", "device-link"],
    entryAvailable: true,
    adapterMode: "native",
    runtimeBundled: true,
    releaseEvidence: "source-only",
    capabilityEvidence: {
      ...SOURCE_MEDIA,
      question: "source-tested",
      approval: "source-tested",
      recovery: "source-tested",
      exit: "source-tested",
    },
    connectionHint: {
      en: "Scan the official Weixin QR. Unknown senders do not consume the receive cursor. Questions and approvals are official durable requests, not generic chat consent.",
      zh: "扫描官方微信二维码。未知发送者不会推进接收游标。提问和审批是官方持久请求，不是普通聊天同意。",
    },
    limits: { textChars: 4000, fileBytes: 8 * 1024 * 1024, requestsPerMinute: 20 },
    defaultEnabled: false,
    docsUrl: "https://developers.weixin.qq.com/",
  }),
  feishu: manifest({
    id: "feishu",
    displayName: { en: "Feishu", zh: "飞书" },
    connectionMethods: ["qr", "manifest"],
    entryAvailable: true,
    adapterMode: "native",
    runtimeBundled: true,
    releaseEvidence: "source-only",
    capabilityEvidence: {
      ...SOURCE_MEDIA,
      question: "source-tested",
      approval: "source-tested",
      recovery: "source-tested",
    },
    connectionHint: {
      en: "Create the Feishu app, then scan or paste official credentials. Card replies must match the exact request identity and expire; replayed or foreign-account cards are rejected.",
      zh: "创建飞书应用，然后扫码或粘贴官方凭据。卡片回复必须匹配精确请求身份并会过期；重放或他号卡片会被拒绝。",
    },
    limits: { textChars: 8000, fileBytes: 8 * 1024 * 1024, requestsPerMinute: 20 },
    defaultEnabled: false,
    docsUrl: "https://open.feishu.cn/app",
  }),
  dingtalk: manifest({
    id: "dingtalk",
    displayName: { en: "DingTalk", zh: "钉钉" },
    connectionMethods: ["qr", "oauth", "manifest"],
    entryAvailable: true,
    adapterMode: "bundled-sidecar",
    runtimeBundled: true,
    releaseEvidence: "source-only",
    capabilityEvidence: SOURCE_TEXT,
    connectionHint: {
      en: "Scan the official DingTalk device QR, or paste Client ID and Secret into Vault. Official questions and approvals are not supported on this channel.",
      zh: "扫描官方钉钉设备二维码，或把 Client ID 和 Secret 写入保险库。此通道不支持官方提问和审批。",
    },
    limits: { textChars: 4000, fileBytes: 8 * 1024 * 1024, requestsPerMinute: 20 },
    defaultEnabled: false,
    docsUrl: "https://open.dingtalk.com/",
  }),
  wecom: manifest({
    id: "wecom",
    displayName: { en: "WeCom", zh: "企业微信" },
    connectionMethods: ["qr", "oauth", "manifest"],
    entryAvailable: true,
    adapterMode: "bundled-sidecar",
    runtimeBundled: true,
    releaseEvidence: "source-only",
    capabilityEvidence: { ...SOURCE_TEXT, inboundText: "not-proven" },
    connectionHint: {
      en: "Scan the official WeCom intelligent-bot QR, or paste Bot ID and Secret. Inbound text is not yet proven; questions and approvals are not supported.",
      zh: "扫描官方企业微信智能机器人二维码，或粘贴 Bot ID 和 Secret。入站文本尚未取证；不支持提问和审批。",
    },
    limits: { textChars: 4000, fileBytes: 8 * 1024 * 1024, requestsPerMinute: 20 },
    defaultEnabled: false,
    docsUrl: "https://developer.work.weixin.qq.com/",
  }),
  qq: manifest({
    id: "qq",
    displayName: { en: "QQ", zh: "QQ" },
    connectionMethods: ["qr", "oauth", "token"],
    entryAvailable: true,
    adapterMode: "bundled-sidecar",
    runtimeBundled: true,
    releaseEvidence: "source-only",
    capabilityEvidence: { ...SOURCE_TEXT, inboundText: "not-proven" },
    connectionHint: {
      en: "Scan with mobile QQ to create an official bot. Do not simulate a personal QQ login. Questions and approvals are not supported.",
      zh: "用手机 QQ 扫码创建官方机器人。不要模拟个人号登录。不支持提问和审批。",
    },
    limits: { textChars: 4000, fileBytes: 8 * 1024 * 1024, requestsPerMinute: 20 },
    defaultEnabled: false,
    docsUrl: "https://bot.q.qq.com/",
  }),
  slack: manifest({
    id: "slack",
    displayName: { en: "Slack", zh: "Slack" },
    connectionMethods: ["oauth", "manifest", "token"],
    entryAvailable: true,
    adapterMode: "bundled-sidecar",
    runtimeBundled: true,
    releaseEvidence: "source-only",
    capabilityEvidence: { ...SOURCE_TEXT, reconnect: "source-tested" },
    connectionHint: {
      en: "There is no QR shortcut. Create a Slack app from the official manifest, install with OAuth, and paste the bot token into Vault.",
      zh: "没有二维码捷径。用官方 Manifest 创建 Slack 应用，通过 OAuth 安装，并把 Bot Token 写入保险库。",
    },
    limits: { textChars: 4000, fileBytes: 8 * 1024 * 1024, requestsPerMinute: 20 },
    defaultEnabled: false,
    docsUrl: "https://api.slack.com/authentication/oauth-v2",
  }),
  telegram: manifest({
    id: "telegram",
    displayName: { en: "Telegram", zh: "Telegram" },
    connectionMethods: ["token"],
    entryAvailable: true,
    adapterMode: "bundled-sidecar",
    runtimeBundled: true,
    releaseEvidence: "source-only",
    capabilityEvidence: { ...SOURCE_TEXT, recovery: "source-tested" },
    connectionHint: {
      en: "Talk to BotFather, copy the HTTP API token once, and paste it into Vault. Operation keys include chat identity so the same vendor id in another chat is a different request. Questions and approvals are not supported.",
      zh: "在 BotFather 创建机器人，复制一次 HTTP API Token 并写入保险库。操作键包含会话身份，另一聊天中的相同厂商 ID 是不同请求。不支持提问和审批。",
    },
    limits: { textChars: 4000, fileBytes: 8 * 1024 * 1024, requestsPerMinute: 20 },
    defaultEnabled: false,
    docsUrl: "https://core.telegram.org/bots/tutorial",
  }),
  discord: manifest({
    id: "discord",
    displayName: { en: "Discord", zh: "Discord" },
    connectionMethods: ["token"],
    entryAvailable: true,
    adapterMode: "bundled-sidecar",
    runtimeBundled: true,
    releaseEvidence: "source-only",
    capabilityEvidence: { ...SOURCE_TEXT, outboundText: "not-proven", exit: "source-tested" },
    connectionHint: {
      en: "There is no QR shortcut. Create a bot with the minimum intents in the Discord Developer Portal and paste the token into Vault. Outbound text is not yet proven.",
      zh: "没有二维码捷径。在 Discord Developer Portal 用最小 intents 创建 Bot，并把 Token 写入保险库。出站文本尚未取证。",
    },
    limits: { textChars: 2000, fileBytes: 8 * 1024 * 1024, requestsPerMinute: 20 },
    defaultEnabled: false,
    docsUrl: "https://discord.com/developers/docs/quick-start/getting-started",
  }),
  imessage: manifest({
    id: "imessage",
    displayName: { en: "iMessage", zh: "iMessage" },
    connectionMethods: ["manual-fallback"],
    entryAvailable: true,
    adapterMode: "bundled-sidecar",
    runtimeBundled: true,
    releaseEvidence: "source-only",
    capabilityEvidence: {
      ...SOURCE_TEXT,
      authentication: "source-tested",
      inboundText: "source-tested",
      outboundText: "source-tested",
      file: "not-supported",
      voice: "not-supported",
      image: "not-supported",
      audio: "not-supported",
      question: "not-supported",
      approval: "not-supported",
      recovery: "source-tested",
      reconnect: "source-tested",
      exit: "source-tested",
    },
    connectionHint: {
      en: "macOS only, private text, default off. Enable after granting Full Disk Access and Messages automation. This version does not read images, files, or group chats, and never uses a legacy default account. Native live evidence is not claimed.",
      zh: "仅 macOS、仅私聊文本、默认关闭。请先授予完全磁盘访问和 Messages 自动化再启用。本版不读图片、文件或群聊，也不使用未限定的默认账户。真机 live 未取证。",
    },
    limits: { textChars: 4000, fileBytes: 8 * 1024 * 1024, requestsPerMinute: 20 },
    defaultEnabled: false,
    docsUrl: "https://github.com/xmanrui/dsh-im/blob/v4.18.0/docs/imessage.md",
  }),
};

export function requireChannelId(value: string): ChannelId {
  return parseClosedEnum(value, CHANNEL_IDS, "CHANNEL_ID", "INVALID_INPUT");
}

export function getChannelManifest(id: string): ChannelManifestV1 {
  return CHANNEL_MANIFESTS[requireChannelId(id)];
}

export function listChannelManifests(): ChannelManifestV1[] {
  return CHANNEL_IDS.map((id) => CHANNEL_MANIFESTS[id]);
}

export function isNativeChannel(id: string): id is NativeChannelId {
  return (NATIVE_CHANNEL_IDS as readonly string[]).includes(id);
}

export function refuseFakeQr(id: string, method: string): void {
  const manifest = getChannelManifest(id);
  const wanted = parseClosedEnum(method, CONNECTION_METHODS, "CONNECTION_METHOD", "INVALID_INPUT");
  if (wanted === "qr" && !manifest.connectionMethods.includes("qr")) {
    throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NO_QR");
  }
  if (!manifest.connectionMethods.includes(wanted)) {
    throw new PenglaiError("SECURITY_POLICY", "CHANNEL_METHOD_UNSUPPORTED");
  }
}

export const GUIDED_STEPS: Record<ChannelId, { en: string[]; zh: string[] }> = {
  weixin: { en: ["Scan the official Weixin QR."], zh: ["扫描官方微信二维码。"] },
  feishu: { en: ["Create the Feishu app, then scan or paste the app credentials."], zh: ["创建飞书应用，然后扫码或粘贴应用凭据。"] },
  dingtalk: {
    en: [
      "Scan the official DingTalk device QR, or paste Client ID and Secret.",
      "Penglai stores credentials in Vault, not a second config store.",
    ],
    zh: ["扫描官方钉钉设备二维码，或粘贴 Client ID 和 Secret。", "凭据进入蓬莱保险库，不使用第二套配置存储。"],
  },
  wecom: {
    en: ["Scan the official WeCom intelligent-bot QR, or paste Bot ID and Secret."],
    zh: ["扫描官方企业微信智能机器人二维码，或粘贴 Bot ID 和 Secret。"],
  },
  qq: {
    en: ["Scan with mobile QQ to create an official bot. Do not simulate a personal QQ login."],
    zh: ["用手机 QQ 扫码创建官方机器人。不要模拟个人号登录。"],
  },
  slack: {
    en: ["Create a Slack app from the official manifest.", "Install it with OAuth to one workspace.", "Paste the bot token into Vault. There is no QR shortcut."],
    zh: ["用官方 Manifest 创建 Slack 应用。", "通过 OAuth 安装到一个 Workspace。", "把 Bot Token 写入保险库。没有二维码捷径。"],
  },
  telegram: {
    en: ["Talk to BotFather and create a bot.", "Copy the HTTP API token once.", "Paste it into Vault. The token is never shown again."],
    zh: ["在 BotFather 创建机器人。", "复制一次 HTTP API Token。", "写入保险库后不再回显。"],
  },
  discord: {
    en: ["Open the Discord Developer Portal.", "Create a bot with the minimum intents.", "Paste the bot token into Vault. There is no QR shortcut."],
    zh: ["打开 Discord Developer Portal。", "用最小 intents 创建 Bot。", "把 Bot Token 写入保险库。没有二维码捷径。"],
  },
  imessage: {
    en: [
      "This channel is macOS only and default off.",
      "In System Settings grant Penglai Full Disk Access and allow it to control Messages.",
      "Enable only after those permissions exist, then bind the exact peer to a Workspace and Session.",
      "Private text only. Old history is not replayed. Native live proof is not claimed.",
    ],
    zh: [
      "此通道仅 macOS，默认关闭。",
      "在系统设置中授予蓬莱完全磁盘访问，并允许控制 Messages。",
      "权限就绪后再启用，并把精确对端绑定到工作区和会话。",
      "仅私聊文本。不会回放旧历史。真机 live 未取证。",
    ],
  },
};
