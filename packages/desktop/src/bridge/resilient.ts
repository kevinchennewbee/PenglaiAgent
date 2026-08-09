/**
 * Resilient channel subscription: owns the reconnect loop (断线重连) so both
 * bridge transports share one discipline. The transport supplies `connect`
 * (open + wire events) and reports transport closes through the factory's
 * `onClosed` callback.
 */

import {
  reconnectDelayMs,
  type HostEventListener,
  type SubscriptionState,
} from "./types.js";

export interface SubscriptionTransport {
  /** Open the transport; resolve when the Host accepted the subscription. */
  connect(): Promise<void>;
  /** Tear the transport down (best-effort, sync). */
  close(): void;
}

export type TransportFactory = (
  onEvent: HostEventListener,
  onClosed: (reason: string | null) => void,
) => SubscriptionTransport;

export class ResilientSubscription {
  private transport: SubscriptionTransport | null = null;
  private stopped = false;
  private attempt = 0;
  private totalReconnects = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly factory: TransportFactory,
    private readonly onEvent: HostEventListener,
    private readonly onState?: (state: SubscriptionState) => void,
    /** Test seam: deterministic delay computation. */
    private readonly delayMs: (attempt: number) => number = reconnectDelayMs,
  ) {}

  /** Open the first connection; subsequent reconnects are automatic. */
  async start(): Promise<void> {
    await this.open();
  }

  /** Owner-initiated close: no further reconnects. */
  close(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.transport?.close();
    this.transport = null;
    this.onState?.("closed");
  }

  /** Total reconnect attempts so far (monotonic; observability/testing). */
  get reconnects(): number {
    return this.totalReconnects;
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    const transport = this.factory(this.onEvent, () => this.handleClosed());
    this.transport = transport;
    try {
      await transport.connect();
      if (this.stopped) {
        transport.close();
        return;
      }
      this.attempt = 0;
      this.onState?.("open");
    } catch {
      transport.close();
      this.scheduleReconnect();
    }
  }

  private handleClosed(): void {
    if (this.stopped) return;
    // Dispose the dead transport so per-transport registrations (e.g. the
    // native bridge's channel fan-out entries) do not accumulate across
    // reconnects.
    this.transport?.close();
    this.transport = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.onState?.("reconnecting");
    const delay = this.delayMs(this.attempt);
    this.attempt += 1;
    this.totalReconnects += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.open();
    }, delay);
  }
}
