import { PenglaiError } from "@penglai/contracts";
import type { CredentialVault } from "@penglai/channel-weixin";

export const WEIXIN_TOKEN_REF = "PENGLAI_WEIXIN_TOKEN";
export const FEISHU_SECRET_REF = "PENGLAI_FEISHU_APP_SECRET";
export const CHANNEL_CREDENTIAL_REFS = {
  weixin: WEIXIN_TOKEN_REF,
  feishu: FEISHU_SECRET_REF,
  dingtalk: "PENGLAI_DINGTALK_CLIENT",
  wecom: "PENGLAI_WECOM_BOT",
  qq: "PENGLAI_QQ_BOT",
  slack: "PENGLAI_SLACK_BOT",
  telegram: "PENGLAI_TELEGRAM_TOKEN",
  discord: "PENGLAI_DISCORD_TOKEN",
  whatsapp: "PENGLAI_WHATSAPP_SESSION",
} as const;
export const WHATSAPP_DATAKEY_REF = "PENGLAI_WHATSAPP_DATAKEY";

// Mirrors the official dsh-credentials REF_PATTERN; kept local so an invalid
// ref is rejected before it can poison the whole .credentials.yaml document.
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertOfficialCredentialRef(ref: string): void {
  if (!REF_PATTERN.test(ref)) {
    throw new PenglaiError("INVALID_INPUT", `credential ref must match ${REF_PATTERN}`);
  }
}

export interface CredentialsLike {
  set(ref: string, value: string): Promise<void>;
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable?: boolean; value?: unknown }>;
  resolve(ref: string): Promise<{ value: string; source?: string } | undefined>;
  unset(ref: string): Promise<void>;
}

export class CredentialsServiceVault implements CredentialVault {
  constructor(
    private readonly credentials: CredentialsLike | undefined,
    private readonly defaultRef = WEIXIN_TOKEN_REF,
  ) {}

  async write(ref: string, secret: string): Promise<void> {
    if (!this.credentials) {
      throw new PenglaiError("SECURITY_POLICY", "MemoryVault/env is not a production secret path");
    }
    assertOfficialCredentialRef(ref || this.defaultRef);
    await this.credentials.set(ref || this.defaultRef, secret);
  }

  async read(ref: string): Promise<string | undefined> {
    if (!this.credentials) return undefined;
    const resolved = await this.credentials.resolve(ref || this.defaultRef);
    return resolved?.value;
  }

  async delete(ref: string): Promise<void> {
    if (!this.credentials) return;
    await this.credentials.unset(ref || this.defaultRef);
  }

  async migrate(fromRef: string, toRef: string): Promise<boolean> {
    if (!this.credentials) return false;
    const source = await this.credentials.resolve(fromRef).catch(() => undefined);
    if (!source?.value) return false;
    await this.credentials.set(toRef, source.value);
    await this.credentials.unset(fromRef).catch(() => {
      /* leaving the legacy ref behind must not break the canonical one */
    });
    return (await this.credentials.describe(toRef)).configured;
  }

  async describe(ref = this.defaultRef): Promise<{ configured: boolean; source?: string; writable?: boolean }> {
    if (!this.credentials) return { configured: false, writable: false };
    const info = await this.credentials.describe(ref);
    if ("value" in info && info.value !== undefined) {
      throw new PenglaiError("SECURITY_POLICY", "credentials.describe must not return value");
    }
    return { configured: info.configured, ...(info.source ? { source: info.source } : {}), writable: info.writable !== false };
  }
}
