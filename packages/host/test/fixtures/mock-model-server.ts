/**
 * Scripted mock model endpoint (OpenAI-compatible SSE) — tests only.
 *
 * This is the only mocked boundary in the eval harness: the model API
 * itself. Everything above it — kernel assembly, the policy
 * gate, host tools, the jail, runners, checkpoints, the usage ledger, the
 * RPC surface — runs the exact production code. The endpoint never leaves
 * the loopback interface and is never mounted on the product path.
 *
 * Replay model: each episode is keyed by its first user message (the
 * prompt). `register(prompt, turns)` scripts the assistant's turns in
 * order; every provider request inside that episode pops the next scripted
 * turn. Requests beyond the script get a deterministic out-of-script reply
 * (and are visible in `requests` for debugging).
 */

import * as http from "node:http";

export interface MockToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** One scripted assistant turn (one provider request/response). */
export interface MockTurn {
  /** Assistant text for this turn (streamed as deltas). */
  text?: string;
  /** Tool calls for this turn; finish_reason becomes "tool_calls". */
  toolCalls?: MockToolCall[];
  /** Provider-reported token usage for this turn (defaults to 10/5). */
  usage?: { input: number; output: number };
}

export interface RecordedRequest {
  /** The episode key: text of the first user message. */
  prompt: string;
  /** Raw request body as received (messages, tools, …). */
  body: {
    model?: string;
    messages?: Array<{ role?: string; content?: unknown; tool_calls?: unknown }>;
    [key: string]: unknown;
  };
  /** The scripted turn index served for this request. */
  turnIndex: number;
}

/** Extract plain text from an OpenAI message content field. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? ((part as { text: string }).text)
          : "",
      )
      .join("");
  }
  return "";
}

function sseChunk(id: string, model: string, delta: Record<string, unknown>, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: 1_700_000_000,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

/**
 * Wire-inspection helper for tests and evals: the concatenated
 * text of every tool-result message in one recorded request body.
 */
export function toolResultsTextOf(body: {
  messages?: Array<{ role?: string; content?: unknown }>;
}): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages
    .filter((m) => m?.role === "tool")
    .map((m) => contentText(m.content))
    .join("\n");
}

export class MockModelServer {
  private readonly scripts = new Map<string, MockTurn[]>();
  /** Prefix-keyed scripts (episodes whose prompt only STARTS with the key —
   *  e.g. the distillation review prompt, whose transcript excerpt varies). */
  private readonly prefixScripts: Array<{ prefix: string; turns: MockTurn[] }> = [];
  private readonly progress = new Map<string, number>();
  private server: http.Server | null = null;
  private requestSeq = 0;
  private port = 0;
  /** When set, requests without this exact bearer key get a 401. */
  private requiredApiKey: string | null = null;
  /** Artificial response delay (smoke-test timeout drills). */
  private responseDelayMs = 0;
  /** GET /models 的应答列表（null = 未注册，走 404）。 */
  private modelIds: string[] | null = null;

  /** Every request the endpoint served, in order (observability for evals). */
  readonly requests: RecordedRequest[] = [];

  /** Every GET /models call served, in order（目录校准 / 向导探测的观测面）。 */
  readonly modelsRequests: Array<{ authorization: string }> = [];

  /** Script one episode: prompt text (exact match of the first user message). */
  register(prompt: string, turns: MockTurn[]): void {
    this.scripts.set(prompt, turns);
    this.progress.delete(prompt);
  }

  /**
   * Script episodes keyed by prompt PREFIX (first user message starts with
   * `prefix`). Checked before exact matches; the episode's own progress is
   * keyed by the full prompt. Used for the distillation review (复盘) whose
   * user message embeds a variable transcript excerpt.
   */
  registerPrefix(prefix: string, turns: MockTurn[]): void {
    this.prefixScripts.push({ prefix, turns });
  }

  /** Demand an exact bearer key (null clears); mismatches get HTTP 401. */
  requireApiKey(key: string | null): void {
    this.requiredApiKey = key;
  }

  /** 注册 GET /models 的应答列表（null = 恢复 404 未知路由行为）。 */
  registerModelIds(ids: string[] | null): void {
    this.modelIds = ids;
  }

  /** Delay every response (smoke-test timeout drills); 0 clears. */
  setResponseDelay(ms: number): void {
    this.responseDelayMs = Math.max(0, ms);
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}/v1`;
  }

  /** Requests served for one episode prompt. */
  requestsFor(prompt: string): RecordedRequest[] {
    return this.requests.filter((r) => r.prompt === prompt);
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = this.server.address();
    this.port = typeof addr === "object" && addr ? addr.port : 0;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    // GET {base}/models — 实时模型列表（向导 /models 探测用；未注册时 404，
    // 与真实 OpenAI 兼容端点的「无此路由」行为一致）。
    if (req.method === "GET" && (req.url ?? "").endsWith("/models")) {
      this.modelsRequests.push({ authorization: req.headers.authorization ?? "" });
      if (this.requiredApiKey !== null) {
        const auth = req.headers.authorization ?? "";
        if (auth !== `Bearer ${this.requiredApiKey}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "mock model: invalid api key" } }));
          return;
        }
      }
      if (this.modelIds === null) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "mock model: unknown route" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: this.modelIds.map((id) => ({ id, object: "model", created: 1_700_000_000, owned_by: "mock" })),
        }),
      );
      return;
    }
    if (req.method !== "POST" || !(req.url ?? "").endsWith("/v1/chat/completions")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "mock model: unknown route" } }));
      return;
    }
    if (this.requiredApiKey !== null) {
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${this.requiredApiKey}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "mock model: invalid api key" } }));
        return;
      }
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const respond = (): void => {
        let body: RecordedRequest["body"] = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as RecordedRequest["body"];
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "mock model: bad json" } }));
          return;
        }
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const firstUser = messages.find((m) => m?.role === "user");
        const prompt = contentText(firstUser?.content);
        const prefixHit = this.prefixScripts.find((entry) => prompt.startsWith(entry.prefix));
        const script = this.scripts.get(prompt) ?? prefixHit?.turns;
        const turnIndex = this.progress.get(prompt) ?? 0;
        this.progress.set(prompt, turnIndex + 1);
        const turn: MockTurn = script?.[turnIndex] ?? {
          text: "（mock 模型：脚本之外的一回合，episode 应已结束）",
        };
        this.requests.push({ prompt, body, turnIndex });
        if (body.stream === false) {
          // 非流式调用（蒸馏复盘 / 审计等一次性请求）：单个 JSON completion。
          this.serveJsonCompletion(res, body.model ?? "mock-model", turn);
          return;
        }
        this.serveTurn(res, body.model ?? "mock-model", turn);
      };
      if (this.responseDelayMs > 0) {
        setTimeout(respond, this.responseDelayMs);
      } else {
        respond();
      }
    });
    req.on("error", () => {
      res.destroy();
    });
  }

  /** Non-streaming chat completion (stream:false callers, e.g. the review). */
  private serveJsonCompletion(res: http.ServerResponse, model: string, turn: MockTurn): void {
    this.requestSeq += 1;
    const usage = turn.usage ?? { input: 10, output: 5 };
    const text = turn.text ?? "";
    const toolCalls = turn.toolCalls ?? [];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: `chatcmpl-mock-${this.requestSeq}`,
        object: "chat.completion",
        created: 1_700_000_000,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: text,
              ...(toolCalls.length > 0
                ? {
                    tool_calls: toolCalls.map((call, index) => ({
                      id: `call_mock_${this.requestSeq}_${index}`,
                      type: "function",
                      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                    })),
                  }
                : {}),
            },
            finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
          },
        ],
        usage: {
          prompt_tokens: usage.input,
          completion_tokens: usage.output,
          total_tokens: usage.input + usage.output,
        },
      }),
    );
  }

  private serveTurn(res: http.ServerResponse, model: string, turn: MockTurn): void {
    this.requestSeq += 1;
    const id = `chatcmpl-mock-${this.requestSeq}`;
    const usage = turn.usage ?? { input: 10, output: 5 };
    const parts: string[] = [];

    if (turn.text && turn.text.length > 0) {
      // Stream in small deltas so streaming accumulation is exercised too.
      const step = 12;
      for (let i = 0; i < turn.text.length; i += step) {
        parts.push(sseChunk(id, model, { role: i === 0 ? "assistant" : undefined, content: turn.text.slice(i, i + step) }, null));
      }
    }
    const toolCalls = turn.toolCalls ?? [];
    toolCalls.forEach((call, index) => {
      parts.push(
        sseChunk(
          id,
          model,
          {
            tool_calls: [
              {
                index,
                id: `call_mock_${this.requestSeq}_${index}`,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              },
            ],
          },
          null,
        ),
      );
    });
    parts.push(sseChunk(id, model, {}, toolCalls.length > 0 ? "tool_calls" : "stop"));
    parts.push(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created: 1_700_000_000,
        model,
        choices: [],
        usage: {
          prompt_tokens: usage.input,
          completion_tokens: usage.output,
          total_tokens: usage.input + usage.output,
        },
      })}\n\n`,
    );
    parts.push("data: [DONE]\n\n");

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.end(parts.join(""));
  }
}
