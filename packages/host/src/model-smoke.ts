import { assertSafeProviderBaseUrl } from "./providers/url-safety.js";

/**
 * One-shot model smoke test (setup wizard / `config.smokeTest`).
 *
 * A single non-streaming chat-completions call against an OpenAI-compatible
 * endpoint, with a hard timeout and human-readable, classified failures so
 * the wizard can say WHAT is wrong (key / network / endpoint / model name)
 * instead of dumping a stack trace. Loopback-only callers; the key travels
 * exactly one hop (CLI → host) and is never logged.
 */

export type SmokeFailureKind = "auth" | "network" | "endpoint" | "timeout";

export interface SmokeResult {
  ok: boolean;
  /** Failure class; "ok" when the endpoint answered 2xx (or 429). */
  kind: "ok" | SmokeFailureKind;
  /** Human-readable one-liner (Chinese, wizard-facing). */
  detail: string;
  latencyMs: number;
}

export interface SmokeInput {
  baseUrl: string;
  model: string;
  /** May be empty (some local endpoints need no auth). */
  apiKey: string;
  timeoutMs?: number;
}

const MAX_ERROR_EXCERPT = 120;

async function errorExcerpt(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown }; message?: unknown };
    const message =
      (typeof body?.error?.message === "string" && body.error.message) ||
      (typeof body?.message === "string" && body.message) ||
      "";
    return message.slice(0, MAX_ERROR_EXCERPT);
  } catch {
    return "";
  }
}

export async function smokeTestModel(input: SmokeInput): Promise<SmokeResult> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const url = `${assertSafeProviderBaseUrl(input.baseUrl)}/chat/completions`;
  const startedAt = Date.now();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (input.apiKey.trim()) headers.Authorization = `Bearer ${input.apiKey.trim()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return {
        ok: false,
        kind: "timeout",
        detail: `连接超时（${Math.round(timeoutMs / 1000)}s）——检查网络或端点地址`,
        latencyMs,
      };
    }
    const cause = (error as { cause?: { code?: unknown } })?.cause;
    const code = typeof cause?.code === "string" ? cause.code : "";
    return {
      ok: false,
      kind: "network",
      detail:
        `网络不可达或端点地址错误${code ? `（${code}）` : ""}——` +
        "检查 base URL 与网络连接",
      latencyMs,
    };
  }

  const latencyMs = Date.now() - startedAt;
  if (res.ok) {
    return {
      ok: true,
      kind: "ok",
      detail: `已连通（HTTP ${res.status}，${latencyMs}ms）`,
      latencyMs,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      kind: "auth",
      detail: `API key 无效或被拒绝（HTTP ${res.status}）`,
      latencyMs,
    };
  }
  if (res.status === 404) {
    return {
      ok: false,
      kind: "endpoint",
      detail: "端点路径不存在（HTTP 404）——检查 base URL（OpenAI 兼容端点通常以 /v1 结尾）",
      latencyMs,
    };
  }
  if (res.status === 429) {
    // Rate limiting proves the endpoint AND the key both work.
    return {
      ok: true,
      kind: "ok",
      detail: `已连通（HTTP 429 限流，key 有效；稍后可正常使用）`,
      latencyMs,
    };
  }
  const excerpt = await errorExcerpt(res);
  const hint = res.status === 400 || res.status === 422 ? "——可能是模型名错误" : "";
  return {
    ok: false,
    kind: "endpoint",
    detail:
      `端点返回错误（HTTP ${res.status}）${hint}` + (excerpt ? `：${excerpt}` : ""),
    latencyMs,
  };
}
