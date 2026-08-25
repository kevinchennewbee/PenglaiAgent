import { t, type PenglaiLocale } from "@penglai/contracts";

export const name = "@penglai/im/client";

export function contribute(locale: PenglaiLocale = "zh"): { slot: "settings.section"; title: string; sections: string[] } {
  return {
    slot: "settings.section",
    title: t(locale, "imTitle"),
    sections: locale === "en"
      ? ["Weixin", "Feishu", "DingTalk", "WeCom", "QQ", "Slack", "Telegram", "Discord", "WhatsApp", "Advanced"]
      : ["微信", "飞书", "钉钉", "企业微信", "QQ", "Slack", "Telegram", "Discord", "WhatsApp", "高级"],
  };
}

export const WEIXIN_QR_STATES = [
  "pending",
  "scanned",
  "confirmed",
  "expired",
  "need-verification",
  "failed",
  "cancelled",
] as const;

export function weixinQrLabel(locale: PenglaiLocale, state: (typeof WEIXIN_QR_STATES)[number]): string {
  const zh: Record<(typeof WEIXIN_QR_STATES)[number], string> = {
    pending: "等待扫码",
    scanned: "已扫码",
    confirmed: "已确认",
    expired: "已过期",
    "need-verification": "需要验证码",
    failed: "失败",
    cancelled: "已取消",
  };
  const en: Record<(typeof WEIXIN_QR_STATES)[number], string> = {
    pending: "Waiting for scan",
    scanned: "Scanned",
    confirmed: "Confirmed",
    expired: "Expired",
    "need-verification": "Verification required",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return locale === "en" ? en[state] : zh[state];
}
