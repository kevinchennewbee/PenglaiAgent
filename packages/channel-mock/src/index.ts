import type { InboundEnvelope } from "@penglai/contracts";
import type { RoutingControlPlane } from "@penglai/routing-core";

export class MockAdapter {
  readonly sent: { routePeer: string; text: string; key: string }[] = [];
  failNext: "transient" | "permanent" | "auth" | undefined;
  constructor(
    private readonly plane: RoutingControlPlane,
    readonly workerId = "mock",
  ) {}

  async receive(env: InboundEnvelope) {
    return this.plane.submitInbound({ ...env, adapter: "mock" });
  }

  async flush(routeId: string): Promise<void> {
    for (const item of this.plane.dueOutbox(routeId)) {
      const token = this.plane.markSending(item.outboxId, this.workerId);
      if (!token) continue;
      if (this.failNext) {
        const r = this.failNext;
        this.failNext = undefined;
        this.plane.markSendResult(item.outboxId, r, token);
        continue;
      }
      this.sent.push({ routePeer: routeId, text: item.payloadText, key: item.outboxId });
      this.plane.markDelivered(item.outboxId, token);
    }
  }

  lateDeliver(outboxId: string, claimToken: string): void {
    this.plane.markDelivered(outboxId, claimToken);
  }
}
