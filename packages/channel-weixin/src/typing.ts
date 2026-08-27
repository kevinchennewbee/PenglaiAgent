/** Best-effort Weixin typing over Penglai iLink. Failures never affect the reply. */

const KEEPALIVE_MS = 4_000;

export interface WeixinTypingTransport {
  getTypingTicket(token: string, toUserId: string, contextToken?: string): Promise<string | undefined>;
  sendTyping(token: string, toUserId: string, typingTicket: string, status: 1 | 2): Promise<boolean>;
}

export class WeixinTypingSession {
  private ticket: string | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;

  constructor(
    private readonly transport: WeixinTypingTransport,
    private readonly token: string,
    private readonly toUserId: string,
    private readonly contextToken?: string,
  ) {}

  async start(): Promise<void> {
    try {
      this.ticket = await this.transport.getTypingTicket(this.token, this.toUserId, this.contextToken);
      if (!this.ticket || this.stopped) return;
      await this.transport.sendTyping(this.token, this.toUserId, this.ticket, 1);
      this.timer = setInterval(() => {
        if (!this.ticket || this.stopped) return;
        void this.transport.sendTyping(this.token, this.toUserId, this.ticket, 1);
      }, KEEPALIVE_MS);
      this.timer.unref?.();
    } catch {
      /* typing is optional */
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const ticket = this.ticket;
    this.ticket = undefined;
    if (!ticket) return;
    try {
      await this.transport.sendTyping(this.token, this.toUserId, ticket, 2);
    } catch {
      /* typing is optional */
    }
  }
}
