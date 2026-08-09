/**
 * 渠道配置（飞书先行）— host 私密配置文件。
 *
 * `<data-dir>/channels.json`（0o600，tmp+rename 原子写，与 profiles.json 同
 * 章法）保存飞书自建应用的 app_id / app_secret / domain / enabled。
 * 环境变量覆盖（部署友好，本机不留密钥本体）：
 *
 *   PENGLAI_FEISHU_APP_ID / PENGLAI_FEISHU_APP_SECRET / PENGLAI_FEISHU_DOMAIN
 *
 * 任一项 env 存在即覆盖文件对应字段；enabled 只来自文件（env 不启用渠道）。
 * 密钥绝不进日志、绝不硬编码；加载对缺失/损坏文件宽容（视为未配置）。
 */

import * as path from "node:path";
import { assertSafeProviderBaseUrl } from "../providers/url-safety.js";
import { atomicWritePrivateJson, readPrivateTextFile } from "../security/private-file.js";
import { FEISHU_DEFAULT_DOMAIN } from "./protocol.js";

const MAX_CHANNELS_FILE_BYTES = 1024 * 1024;

export interface FeishuChannelConfig {
  appId: string;
  appSecret: string;
  domain: string;
  enabled: boolean;
}

interface ChannelsFile {
  schemaVersion: 1;
  feishu?: {
    appId?: unknown;
    appSecret?: unknown;
    domain?: unknown;
    enabled?: unknown;
  };
}

export function channelsFilePath(dataDir: string): string {
  return path.join(dataDir, "channels.json");
}

/** 文件侧配置（无文件 / 损坏 / 字段缺失 → null，视为未配置）。 */
export function loadChannelConfig(dataDir: string): FeishuChannelConfig | null {
  let parsed: ChannelsFile;
  try {
    const file = channelsFilePath(dataDir);
    parsed = JSON.parse(readPrivateTextFile(file, MAX_CHANNELS_FILE_BYTES, true).text);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Private config")) throw error;
    return null;
  }
  const feishu = parsed?.feishu;
  if (
    !feishu ||
    typeof feishu.appId !== "string" ||
    feishu.appId.length === 0 ||
    typeof feishu.appSecret !== "string" ||
    feishu.appSecret.length === 0
  ) {
    return null;
  }
  return {
    appId: feishu.appId,
    appSecret: feishu.appSecret,
    domain: assertSafeProviderBaseUrl(
      typeof feishu.domain === "string" && feishu.domain
        ? feishu.domain
        : FEISHU_DEFAULT_DOMAIN,
    ),
    enabled: feishu.enabled === true,
  };
}

/** 运行时解析：env 覆盖文件字段。文件与 env 均无 → null。 */
export function resolveChannelConfig(dataDir: string): FeishuChannelConfig | null {
  const fromFile = loadChannelConfig(dataDir);
  const envId = process.env.PENGLAI_FEISHU_APP_ID?.trim();
  const envSecret = process.env.PENGLAI_FEISHU_APP_SECRET?.trim();
  const envDomain = process.env.PENGLAI_FEISHU_DOMAIN?.trim();
  if (!fromFile && !envId && !envSecret) return null;
  const appId = envId || fromFile?.appId || "";
  const appSecret = envSecret || fromFile?.appSecret || "";
  if (!appId || !appSecret) return null;
  return {
    appId,
    appSecret,
    domain: assertSafeProviderBaseUrl(envDomain || fromFile?.domain || FEISHU_DEFAULT_DOMAIN),
    enabled: fromFile?.enabled ?? true, // 纯 env 配置视为启用（显式 export 即意图）
  };
}

/**
 * 保存飞书配置（0o600 原子写）。返回文件路径。
 * `enabled` 缺省 true（setup 即启用）；disable 流程显式传 false。
 */
export function saveChannelConfig(
  dataDir: string,
  config: {
    appId: string;
    appSecret: string;
    domain?: string;
    enabled?: boolean;
  },
): string {
  const appId = config.appId.trim();
  const appSecret = config.appSecret.trim();
  if (!appId || appId.length > 512) throw new Error("Feishu appId is empty or too long");
  if (!appSecret || appSecret.length > 4096) throw new Error("Feishu appSecret is empty or too long");
  const domain = assertSafeProviderBaseUrl(config.domain ?? FEISHU_DEFAULT_DOMAIN);
  const file = channelsFilePath(dataDir);
  const payload: ChannelsFile = {
    schemaVersion: 1,
    feishu: {
      appId,
      appSecret,
      domain,
      enabled: config.enabled ?? true,
    },
  };
  atomicWritePrivateJson(file, payload, MAX_CHANNELS_FILE_BYTES);
  return file;
}
