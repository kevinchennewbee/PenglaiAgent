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

export interface ChannelCapabilityEvidence {
  authentication: ChannelCapabilityEvidenceLevel;
  inboundText: ChannelCapabilityEvidenceLevel;
  outboundText: ChannelCapabilityEvidenceLevel;
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
  readonly limits: { readonly textChars: number; readonly fileBytes: number; readonly requestsPerMinute: number };
  readonly defaultEnabled: boolean;
  readonly docsUrl: string;
}

const SOURCE_TEXT: ChannelCapabilityEvidence = {
  authentication: "source-tested",
  inboundText: "source-tested",
  outboundText: "source-tested",
  image: "not-supported",
  audio: "not-supported",
  reconnect: "not-proven",
  exit: "not-proven",
};

const SOURCE_MEDIA: ChannelCapabilityEvidence = {
  ...SOURCE_TEXT,
  image: "source-tested",
  audio: "source-tested",
};

function manifest(row: ChannelManifestV1): ChannelManifestV1 {
  parseClosedEnum(row.adapterMode, CHANNEL_ADAPTER_MODES, "CHANNEL_ADAPTER_MODE", "SECURITY_POLICY");
  parseClosedEnum(row.releaseEvidence, CHANNEL_RELEASE_EVIDENCE, "CHANNEL_RELEASE_EVIDENCE", "SECURITY_POLICY");
  for (const [capability, evidence] of Object.entries(row.capabilityEvidence)) {
    parseClosedEnum(evidence, CHANNEL_CAPABILITY_EVIDENCE, `CHANNEL_CAPABILITY_${capability}`, "SECURITY_POLICY");
  }
  const expectedMode = (NATIVE_CHANNEL_IDS as readonly string[]).includes(row.id) ? "native" : "bundled-sidecar";
  if (row.adapterMode !== expectedMode) throw new PenglaiError("SECURITY_POLICY", "CHANNEL_ADAPTER_MODE_MISMATCH");
  return Object.freeze({
    ...row,
    displayName: Object.freeze({ ...row.displayName }),
    connectionMethods: Object.freeze([...row.connectionMethods]),
    capabilityEvidence: Object.freeze({ ...row.capabilityEvidence }),
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
    capabilityEvidence: { ...SOURCE_MEDIA, exit: "source-tested" },
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
    capabilityEvidence: SOURCE_MEDIA,
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
    capabilityEvidence: SOURCE_TEXT,
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
    limits: { textChars: 2000, fileBytes: 8 * 1024 * 1024, requestsPerMinute: 20 },
    defaultEnabled: false,
    docsUrl: "https://discord.com/developers/docs/quick-start/getting-started",
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
};
