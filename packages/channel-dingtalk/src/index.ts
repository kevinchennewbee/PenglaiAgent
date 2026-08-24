import { PenglaiError } from "@penglai/contracts";

export const name = "dingtalk";

export interface DingTalkCredentials {
  clientId: string;
  clientSecret: string;
}

export interface DingTalkInbound {
  messageId: string;
  senderId: string;
  text: string;
}

export interface DingTalkStreamClient {
  connect(): Promise<void> | void;
  disconnect(): Promise<void> | void;
  connected?: boolean;
}

export interface DingTalkStreamFactory {
  (creds: DingTalkCredentials): DingTalkStreamClient;
}

export type DingTalkConnection = "not_configured" | "connecting" | "connected" | "failed" | "disabled";

/**
 * Penglai DingTalk adapter. Uses the official dingtalk-stream SDK when a
 * factory is not injected. It is not a second Agent core and is not live
 * until LIVE_CHANNEL_IDS includes dingtalk after health and send proofs.
 */
export class DingTalkAdapter {
  connection: DingTalkConnection = "not_configured";
  private client: DingTalkStreamClient | undefined;
  readonly inbound: DingTalkInbound[] = [];

  constructor(
    private readonly vault: { resolve(ref: string): DingTalkCredentials | undefined },
    private readonly factory?: DingTalkStreamFactory,
  ) {}

  async beginConnection(input: { credentialRef: string }): Promise<{ qr: false; live: false; connection: DingTalkConnection }> {
    const creds = this.vault.resolve(input.credentialRef);
    if (!creds?.clientId || !creds.clientSecret) {
      this.connection = "not_configured";
      throw new PenglaiError("AUTH_EXPIRED", "dingtalk credentials missing");
    }
    this.connection = "connecting";
    try {
      this.client = this.factory ? this.factory(creds) : await this.createOfficialClient(creds);
      await this.client.connect();
      this.connection = this.client.connected === false ? "failed" : "connected";
    } catch {
      this.connection = "failed";
      throw new PenglaiError("DELIVERY_TRANSIENT", "dingtalk stream connect failed");
    }
    return { qr: false, live: false, connection: this.connection };
  }

  health() {
    return {
      channel: "dingtalk" as const,
      live: false,
      connection: this.connection,
    };
  }

  async sendText(_input: { text: string }): Promise<never> {
    throw new PenglaiError("SECURITY_POLICY", "CHANNEL_NOT_LIVE:dingtalk");
  }

  async disconnect(): Promise<void> {
    await this.client?.disconnect();
    this.client = undefined;
    this.connection = "disabled";
  }

  private async createOfficialClient(creds: DingTalkCredentials): Promise<DingTalkStreamClient> {
    const mod = (await import("dingtalk-stream")) as unknown as {
      DWClient?: new (opts: { clientId: string; clientSecret: string }) => {
        connect(): Promise<void> | void;
        disconnect(): Promise<void> | void;
      };
    };
    if (typeof mod.DWClient !== "function") {
      throw new PenglaiError("DSH_UNAVAILABLE", "dingtalk-stream DWClient missing");
    }
    const raw = new mod.DWClient({ clientId: creds.clientId, clientSecret: creds.clientSecret });
    const client: DingTalkStreamClient = {
      connected: false,
      async connect() {
        await raw.connect();
        client.connected = true;
      },
      async disconnect() {
        await raw.disconnect();
        client.connected = false;
      },
    };
    return client;
  }
}
