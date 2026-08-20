export const PINNED_LARK_SDK = "1.73.0";
export const PINNED_LARK_COMMIT = "f54b49f3566c52b54c598194b7ed3015e3e24224";
export const FEISHU_RECEIVE_EVENT = "im.message.receive_v1";
export const FEISHU_MIN_SCOPES = ["im:message.p2p_msg:readonly", "im:message:send_as_bot"] as const;
export const FEISHU_EVENT_MODE = "long_connection";
export const FEISHU_APP_TYPE = "enterprise_self_built";
export const FEISHU_DEVELOPER_CONSOLE = "https://open.feishu.cn/app";
export const FEISHU_LONG_CONNECTION_DOC =
  "https://open.feishu.cn/document/develop-an-echo-bot/faq?lang=zh-CN";

export const FEISHU_SETUP_STEPS = [
  "create_enterprise_app",
  "enable_bot_capability",
  "grant_min_p2p_scopes",
  "select_long_connection",
  "subscribe_im.message.receive_v1",
  "create_and_publish_version",
] as const;

export function isBaseBotAuth(kind: string): boolean {
  return kind === "app_id_app_secret";
}

export function isForbiddenBaseAuth(kind: string): boolean {
  return kind === "device_flow" || kind === "oauth" || kind === "user_device_flow";
}

export function isOfficialAppRegistrationQr(kind: string): boolean {
  return kind === "app_registration_qr";
}

export type FeishuDoctorClass =
  | "credential"
  | "bot"
  | "permission"
  | "event"
  | "publish"
  | "tenant"
  | "network";

export interface FeishuDoctorInput {
  hasAppId: boolean;
  hasSecret: boolean;
  botEnabled?: boolean;
  scopes?: readonly string[];
  event?: string;
  published?: boolean;
  tenantOk?: boolean;
  networkOk?: boolean;
}

export function doctorFeishu(input: FeishuDoctorInput): Array<{ class: FeishuDoctorClass; ok: boolean }> {
  return [
    { class: "credential", ok: Boolean(input.hasAppId && input.hasSecret) },
    { class: "bot", ok: input.botEnabled !== false },
    {
      class: "permission",
      ok: !input.scopes || FEISHU_MIN_SCOPES.every((scope) => input.scopes!.includes(scope)),
    },
    { class: "event", ok: !input.event || input.event === FEISHU_RECEIVE_EVENT },
    { class: "publish", ok: input.published !== false },
    { class: "tenant", ok: input.tenantOk !== false },
    { class: "network", ok: input.networkOk !== false },
  ];
}
