/**
 * 飞书开放平台 REST 客户端（裸 fetch，零新增依赖）。
 *
 * 覆盖渠道适配器需要的最小 API 面：
 *   - tenant_access_token 获取与缓存（过期前 20% 提前刷新）；
 *   - 发消息（text / interactive card），uuid 幂等键（网络重试不重复送达）；
 *   - 更新卡片消息（审批决定后改写原卡片）。
 *
 * 测试缝：fetch / now 均可注入；测试用真实 loopback HTTP mock 打全链路。
 * 失败分类：auth（token 获取失败/401）、api（code != 0）、network（fetch 抛错）。
 */

import type { FeishuCard } from "./protocol.js";

export type FeishuApiErrorKind = "auth" | "api" | "network";

export class FeishuApiError extends Error {
  constructor(
    readonly kind: FeishuApiErrorKind,
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "FeishuApiError";
  }
}

export interface FeishuApiClientOptions {
  appId: string;
  appSecret: string;
  domain: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface TokenCache {
  token: string;
  /** epoch ms；到点即刷新。 */
  expiresAt: number;
}

export class FeishuApiClient {
  private tokenCache: TokenCache | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: FeishuApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private get domain(): string {
    return this.options.domain.replace(/\/+$/, "");
  }

  /** tenant_access_token（缓存；有效期打 8 折提前刷新）。 */
  async tenantAccessToken(): Promise<string> {
    if (this.tokenCache && this.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(
        `${this.domain}/open-apis/auth/v3/tenant_access_token/internal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            app_id: this.options.appId,
            app_secret: this.options.appSecret,
          }),
        },
      );
    } catch (error) {
      throw new FeishuApiError(
        "network",
        `tenant_access_token request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const body = (await res.json().catch(() => null)) as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    } | null;
    if (!res.ok || !body || body.code !== 0 || !body.tenant_access_token) {
      throw new FeishuApiError(
        "auth",
        `tenant_access_token rejected: code=${String(body?.code ?? res.status)} msg=${String(body?.msg ?? "")}`,
        body?.code,
      );
    }
    const expireSeconds =
      typeof body.expire === "number" && body.expire > 60 ? body.expire : 7200;
    this.tokenCache = {
      token: body.tenant_access_token,
      // 提前 20% 刷新，绝不顶着过期点用旧 token。
      expiresAt: this.now() + Math.trunc(expireSeconds * 0.8) * 1000,
    };
    return body.tenant_access_token;
  }

  /** 授权请求；一次 401 内自动刷新 token 重试一次。 */
  private async authedFetch(url: string, init: RequestInit): Promise<Response> {
    const send = async (): Promise<Response> => {
      const token = await this.tenantAccessToken();
      return this.fetchImpl(url, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });
    };
    let res = await send();
    if (res.status === 401) {
      this.tokenCache = null;
      res = await send();
    }
    return res;
  }

  /**
   * 发消息（receive_id_type=chat_id）。uuid 为幂等键：同一 uuid 的重试
   * 飞书侧不重复投递（断线重发安全）。
   */
  async sendMessage(input: {
    chatId: string;
    msgType: "text" | "interactive";
    content: string;
    uuid?: string;
  }): Promise<{ messageId: string }> {
    const body = (await this.callApi(
      `${this.domain}/open-apis/im/v1/messages?receive_id_type=chat_id`,
      {
        receive_id: input.chatId,
        msg_type: input.msgType,
        content: input.content,
        uuid: input.uuid,
      },
    )) as { message_id?: string };
    return { messageId: typeof body.message_id === "string" ? body.message_id : "" };
  }

  async sendText(chatId: string, text: string, uuid?: string): Promise<{ messageId: string }> {
    return this.sendMessage({
      chatId,
      msgType: "text",
      content: JSON.stringify({ text }),
      uuid,
    });
  }

  async sendCard(chatId: string, card: FeishuCard, uuid?: string): Promise<{ messageId: string }> {
    return this.sendMessage({
      chatId,
      msgType: "interactive",
      content: JSON.stringify(card),
      uuid,
    });
  }

  /** 更新卡片消息（审批决定后改写原卡片，移除按钮、留决定溯源）。 */
  async updateCard(messageId: string, card: FeishuCard): Promise<void> {
    // 待真机联调验证：PATCH im/v1/messages/:message_id，body.content 为卡片
    // JSON 字符串（官方文档「更新卡片消息」）。失败仅影响卡片观感，审批决定
    // 本体已落库，由调用方决定是否补发文本确认。
    await this.callApi(`${this.domain}/open-apis/im/v1/messages/${messageId}`, {
      msg_type: "interactive",
      content: JSON.stringify(card),
    }, "PATCH");
  }

  private async callApi(
    url: string,
    payload: Record<string, unknown>,
    method: "POST" | "PATCH" = "POST",
  ): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.authedFetch(url, {
        method,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (error instanceof FeishuApiError) throw error;
      throw new FeishuApiError(
        "network",
        `request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const body = (await res.json().catch(() => null)) as {
      code?: number;
      msg?: string;
      data?: Record<string, unknown>;
    } | null;
    if (!res.ok || !body || body.code !== 0) {
      throw new FeishuApiError(
        res.status === 401 ? "auth" : "api",
        `feishu api error: code=${String(body?.code ?? res.status)} msg=${String(body?.msg ?? "")}`,
        body?.code,
      );
    }
    return body.data ?? {};
  }
}
