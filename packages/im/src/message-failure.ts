import { randomUUID } from "node:crypto";
import {
  officialRemoteFailure as readOfficialRemoteFailure,
  isAgentPresetRemoteCode,
  presetUnavailableCopy,
} from "@penglai/contracts";
import {
  WeixinIlinkResponseError,
  type WeixinIlinkFailureKind,
} from "@penglai/channel-weixin";

/** Public failure objects never include secrets, stacks, or raw SDK objects. */
export const MESSAGE_FAILURE_CODES = [
  "CHANNEL_PERMISSION",
  "CHANNEL_RATE_LIMIT",
  "CHANNEL_DELIVERY",
  "CHANNEL_DELIVERY_UNCERTAIN",
  "CHANNEL_AUTH",
  "CHANNEL_PROTOCOL",
  "CHANNEL_RESPONSE_TOO_LARGE",
  "CHANNEL_NO_QR",
  "PRESET_UNAVAILABLE",
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

const ILINK_FAILURE_CODE_BY_KIND: Readonly<
  Record<WeixinIlinkFailureKind, MessageFailureCode>
> = Object.freeze({
  auth: "CHANNEL_AUTH",
  rate: "CHANNEL_RATE_LIMIT",
  protocol: "CHANNEL_PROTOCOL",
  delivery: "CHANNEL_DELIVERY",
});

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
  CHANNEL_PROTOCOL: {
    // Deliberately does NOT tell the user to check their network or "platform
    // status". The previous copy did, and it was wrong twice over: the response
    // it described was usually refused by Penglai's own content-type gate, and
    // even when the platform really did answer oddly, inspecting the network is
    // not something the user can act on. The reference id is, so that is what
    // the copy asks for.
    zh: "平台返回了蓬莱无法识别的响应。请记下参考号后重试；若持续出现，请把参考号反馈给我们。",
    en: "The platform returned a response Penglai could not recognise. Note the reference id and retry; if it persists, report the reference id to us.",
  },
  CHANNEL_RESPONSE_TOO_LARGE: {
    // A Penglai limit, not a platform fault. Reporting it as a platform anomaly
    // sent users to look in the wrong place.
    zh: "平台的响应超过了蓬莱允许的大小上限，已安全丢弃。请记下参考号后重试。",
    en: "The platform response exceeded the size limit Penglai allows and was discarded safely. Note the reference id and retry.",
  },
  CHANNEL_NO_QR: {
    zh: "这个平台没有官方扫码捷径。请按官方 Token / Manifest 步骤连接。",
    en: "This platform has no official QR shortcut. Use the official token or manifest steps.",
  },
  PRESET_UNAVAILABLE: presetUnavailableCopy(),
  INPUT_INVALID: {
    zh: "这条消息缺少必要字段，已被拒绝。",
    en: "This message is missing required fields and was rejected.",
  },
  INTERNAL_UNKNOWN: {
    zh: "处理失败。请记下参考号后重试。",
    en: "Processing failed. Note the reference id and retry.",
  },
};

export function isMessageFailureCode(value: unknown): value is MessageFailureCode {
  return (MESSAGE_FAILURE_CODES as readonly unknown[]).includes(value);
}

export function messageFailureCopy(
  code: MessageFailureCode,
): Readonly<{ zh: string; en: string }> {
  return COPY[code];
}

export function isMessageFailureReference(value: unknown): value is string {
  return typeof value === "string" && /^MF-[A-F0-9]{8}$/.test(value);
}

export function newReferenceId(): string {
  return `MF-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function officialRemoteFailure(error: unknown): { code: string; message?: string } | undefined {
  return readOfficialRemoteFailure(error);
}

export function classifyMessageFailure(error: unknown): MessageFailure {
  const official = officialRemoteFailure(error);
  if (official) {
    const code: MessageFailureCode = isAgentPresetRemoteCode(official.code)
      ? "PRESET_UNAVAILABLE"
      : "INTERNAL_UNKNOWN";
    return {
      code,
      reason: official.code.slice(0, 64),
      message: COPY[code],
      referenceId: newReferenceId(),
      at: Date.now(),
    };
  }
  const text = error instanceof Error ? `${error.name}:${error.message}` : String(error ?? "");
  const typedIlinkCode: MessageFailureCode | undefined =
    error instanceof WeixinIlinkResponseError
      ? ILINK_FAILURE_CODE_BY_KIND[error.failureKind]
      : undefined;
  const code: MessageFailureCode = typedIlinkCode ?? (/CHANNEL_NO_QR/.test(text)
    ? "CHANNEL_NO_QR"
    // Penglai's own byte bounds are split out from the platform-shape codes.
    // They are this product's limit being hit by a large but legitimate
    // response, so blaming the platform for them was a misreport.
    : /BOUNDED_HTTP_(?:TOO_LARGE|DECLARED_LENGTH)/.test(text)
      ? "CHANNEL_RESPONSE_TOO_LARGE"
    : /BOUNDED_HTTP_(?:MIME|JSON|EMPTY)/.test(text)
      ? "CHANNEL_PROTOCOL"
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
                : "INTERNAL_UNKNOWN");
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
  CHANNEL_PROTOCOL: "retry_with_reference",
  CHANNEL_RESPONSE_TOO_LARGE: "retry",
  CHANNEL_NO_QR: "use_official_token",
  PRESET_UNAVAILABLE: "select_project_new_session",
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
