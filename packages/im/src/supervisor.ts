import { PenglaiError } from "@penglai/contracts";
import type { WeixinAdapter } from "@penglai/channel-weixin";
import type { FeishuAdapter } from "@penglai/channel-feishu";
import type { CredentialsServiceVault } from "./credentials-vault.js";
import { FEISHU_SECRET_REF, WEIXIN_TOKEN_REF } from "./credentials-vault.js";

function nextReconnectAllowed(attempts: number[], now: number, windowMs = 60_000, max = 6): boolean {
  return attempts.filter((stamp) => now - stamp < windowMs).length < max;
}

export class WorkerLease {
  private owner: string | undefined;
  acquire(id: string): void {
    if (this.owner && this.owner !== id) throw new PenglaiError("SECURITY_POLICY", "duplicate active worker");
    this.owner = id;
  }
  release(id: string): void {
    if (this.owner === id) this.owner = undefined;
  }
  get held(): boolean {
    return this.owner !== undefined;
  }
}

export class AdapterSupervisor {
  private ac: AbortController | undefined;
  private pumpTimer: ReturnType<typeof setTimeout> | undefined;
  private owner = 0;
  readonly lease = new WorkerLease();
  private reconnects: number[] = [];

  constructor(
    private readonly weixin: WeixinAdapter,
    private readonly feishu: FeishuAdapter,
    private readonly vault: CredentialsServiceVault,
    private readonly pump: () => Promise<void>,
  ) {}

  get running(): boolean {
    return this.ac !== undefined;
  }

  async start(): Promise<void> {
    if (this.ac) return;
    this.lease.acquire("supervisor");
    this.owner += 1;
    this.ac = new AbortController();
    const signal = this.ac.signal;
    const weixinReady = (await this.vault.describe(WEIXIN_TOKEN_REF)).configured;
    if (weixinReady) {
      void this.weixin.startReceive(undefined, signal);
    }
    const feishuReady = (await this.vault.describe(FEISHU_SECRET_REF)).configured;
    if (feishuReady && typeof this.feishu.connect === "function") {
      const secret = await this.vault.read(FEISHU_SECRET_REF);
      const appId = (this.feishu as { appId?: string }).appId;
      if (secret && appId) void this.feishu.connect(appId, secret);
    }
    void this.pumpLoop(signal);
  }

  async resume(reason: "sleep" | "wake" | "crash" | "offline" | "online"): Promise<void> {
    const now = Date.now();
    if (!nextReconnectAllowed(this.reconnects, now)) return;
    this.reconnects.push(now);
    void reason;
    this.stop();
    await this.start();
  }

  /**
   * Restart only the WeChat receive loop without tearing down the whole
   * supervisor. `start()` is a no-op while running, so after a logout the
   * receive loop never came back; this makes the reconnect button actually
   * re-establish polling once the token is configured again.
   */
  async restartWeixinReceive(): Promise<void> {
    const signal = this.ac?.signal;
    if (!signal) {
      await this.start();
      return;
    }
    this.weixin.stopReceive();
    const configured = (await this.vault.describe(WEIXIN_TOKEN_REF)).configured;
    if (configured) {
      void this.weixin.startReceive(undefined, signal);
    }
  }

  stop(): void {
    this.ac?.abort();
    this.ac = undefined;
    this.weixin.stopReceive();
    this.feishu.stop?.();
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = undefined;
    this.lease.release("supervisor");
  }

  resources(): { running: boolean; timers: number; sockets: number } {
    return {
      running: this.running,
      timers: this.pumpTimer ? 1 : 0,
      sockets:
        this.weixin.health?.().authState === "connected" ||
        this.feishu.status === "connected" ||
        this.feishu.status === "degraded"
          ? 1
          : 0,
    };
  }

  private async pumpLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.pump();
      } catch {
        /* transient pump */
      }
      await new Promise<void>((resolve) => {
        this.pumpTimer = setTimeout(resolve, 750);
        this.pumpTimer.unref?.();
      });
    }
  }
}
