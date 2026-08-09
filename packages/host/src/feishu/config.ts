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

import * as fs from "node:fs";
import * as path from "node:path";
import { FEISHU_DEFAULT_DOMAIN } from "./protocol.js";

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
    parsed = JSON.parse(fs.readFileSync(channelsFilePath(dataDir), "utf-8"));
  } catch {
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
    domain:
      typeof feishu.domain === "string" && feishu.domain
        ? feishu.domain
        : FEISHU_DEFAULT_DOMAIN,
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
    domain: envDomain || fromFile?.domain || FEISHU_DEFAULT_DOMAIN,
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
  const file = channelsFilePath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const payload: ChannelsFile = {
    schemaVersion: 1,
    feishu: {
      appId: config.appId,
      appSecret: config.appSecret,
      domain: config.domain ?? FEISHU_DEFAULT_DOMAIN,
      enabled: config.enabled ?? true,
    },
  };
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best-effort permission hardening */
  }
  return file;
}
