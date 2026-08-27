import { randomUUID } from "node:crypto";

/** Public failure objects never include secrets, stacks, or raw SDK objects. */
export const MESSAGE_FAILURE_CODES = [
  "CHANNEL_PERMISSION",
  "CHANNEL_RATE_LIMIT",
  "CHANNEL_DELIVERY",
  "CHANNEL_DELIVERY_UNCERTAIN",
  "CHANNEL_AUTH",
  "CHANNEL_NO_QR",
  "CHANNEL_RISK_ACK",
  "INPUT_INVALID",
  "INTERNAL_UNKNOWN",
] as const;

export type MessageFailureCode = (typeof MESSAGE_FAILURE_CODES)[number];

export interface MessageFailure {
  code: MessageFailureCode;
  reason: string;
  message: { zh: string; en: string };
  referenceId: string;
  at: number;
}

const COPY: Record<MessageFailureCode, { zh: string; en: string }> = {
  CHANNEL_PERMISSION: {
    zh: "平台拒绝了这次发送。请检查机器人权限后重试。",
    en: "The platform refused this send. Check the bot permissions and retry.",
  },
  CHANNEL_RATE_LIMIT: {
    zh: "平台限流。请稍后再试。",
    en: "The platform rate-limited this send. Wait and retry.",
  },
  CHANNEL_DELIVERY: {
    zh: "消息未能送达。请稍后重试。",
    en: "The message was not delivered. Retry later.",
  },
  CHANNEL_DELIVERY_UNCERTAIN: {
    zh: "发送结果不确定，不会自动重试。请在会话里确认是否已发出。",
    en: "Delivery is uncertain and will not be retried blindly. Confirm in the chat whether it was sent.",
  },
  CHANNEL_AUTH: {
    zh: "凭据无效或已过期。请重新连接。",
    en: "Credentials are invalid or expired. Connect again.",
  },
  CHANNEL_NO_QR: {
    zh: "这个平台没有官方扫码捷径。请按官方 Token / Manifest 步骤连接。",
    en: "This platform has no official QR shortcut. Use the official token or manifest steps.",
  },
  CHANNEL_RISK_ACK: {
    zh: "WhatsApp 使用社区协议。请先阅读风险说明并确认。",
    en: "WhatsApp uses a community protocol. Read the risk notice and acknowledge first.",
  },
  INPUT_INVALID: {
    zh: "这条消息缺少必要字段，已被拒绝。",
    en: "This message is missing required fields and was rejected.",
  },
  INTERNAL_UNKNOWN: {
    zh: "处理失败。请记下参考号后重试。",
    en: "Processing failed. Note the reference id and retry.",
  },
};

export function newReferenceId(): string {
  return `MF-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function classifyMessageFailure(error: unknown): MessageFailure {
  const text = error instanceof Error ? `${error.name}:${error.message}` : String(error ?? "");
  const code: MessageFailureCode = /CHANNEL_NO_QR/.test(text)
    ? "CHANNEL_NO_QR"
    : /CHANNEL_RISK_ACK/.test(text)
      ? "CHANNEL_RISK_ACK"
      : /AUTH_EXPIRED|TOKEN_INVALID|credentials missing/.test(text)
        ? "CHANNEL_AUTH"
        : /429|RATE_LIMIT/.test(text)
          ? "CHANNEL_RATE_LIMIT"
          : /403|401|PERMISSION/.test(text)
            ? "CHANNEL_PERMISSION"
            : /UNCERTAIN/.test(text)
              ? "CHANNEL_DELIVERY_UNCERTAIN"
              : /DELIVERY|SEND_FAILED/.test(text)
                ? "CHANNEL_DELIVERY"
                : /INVALID_INPUT|missing/.test(text)
                  ? "INPUT_INVALID"
                  : "INTERNAL_UNKNOWN";
  return {
    code,
    reason: code,
    message: COPY[code],
    referenceId: newReferenceId(),
    at: Date.now(),
  };
}

export function publicMessageFailure(failure: MessageFailure): MessageFailure {
  return {
    code: failure.code,
    reason: failure.reason.slice(0, 64),
    message: {
      zh: failure.message.zh.slice(0, 500),
      en: failure.message.en.slice(0, 500),
    },
    referenceId: failure.referenceId.slice(0, 40),
    at: failure.at,
  };
}

export const RECOVERY_ACTION_BY_CODE: Record<MessageFailureCode, string> = {
  CHANNEL_PERMISSION: "check_permissions",
  CHANNEL_RATE_LIMIT: "wait_retry",
  CHANNEL_DELIVERY: "retry",
  CHANNEL_DELIVERY_UNCERTAIN: "confirm_manually",
  CHANNEL_AUTH: "reconnect",
  CHANNEL_NO_QR: "use_official_token",
  CHANNEL_RISK_ACK: "acknowledge_risk",
  INPUT_INVALID: "fix_input",
  INTERNAL_UNKNOWN: "retry",
};

export type SendOutcome = "delivered" | "failed" | "uncertain";

export function classifySendOutcome(error: unknown): SendOutcome {
  const failure = classifyMessageFailure(error);
  if (failure.code === "CHANNEL_DELIVERY_UNCERTAIN") return "uncertain";
  if (failure.code === "CHANNEL_RATE_LIMIT") return "failed";
  return "failed";
}
