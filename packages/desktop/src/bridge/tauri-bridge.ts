/**
 * Tauri bridge: every Host call crosses the native shell. The loopback
 * credential never reaches renderer JS — RPCs go through the `host_rpc`
 * command, event channels through the native WS forwarder (`host_subscribe`
 * → `host-event` Tauri events → `host_unsubscribe`).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RuntimeHandshake } from "@penglai/protocol";
import { ResilientSubscription } from "./resilient.js";
import {
  BridgeError,
  toBridgeError,
  type HostEventListener,
  type HostStatusInfo,
  type PenglaiBridge,
  type SubscriptionState,
} from "./types.js";

interface NativeHostStatus {
  ok: boolean;
  error?: string | null;
  handshake?: RuntimeHandshake | null;
}

/** One `host-event` frame from the native forwarder thread. */
interface NativeHostEvent {
  channelId: string;
  data: string | null;
  closed: boolean;
  error: string | null;
}

export class TauriBridge implements PenglaiBridge {
  readonly kind = "tauri" as const;
  /** channelId → listeners; one global Tauri listener fans out. */
  private readonly channels = new Map<
    string,
    { onEvent: HostEventListener; onClosed: (reason: string | null) => void }[]
  >();
  private globalListener: Promise<UnlistenFn> | null = null;

  async status(): Promise<HostStatusInfo> {
    try {
      const status = await invoke<NativeHostStatus>("host_status");
      return {
        ok: status.ok,
        error: status.error ?? undefined,
        handshake: status.handshake ?? undefined,
      };
    } catch (error) {
      return { ok: false, error: `无法调用桌面运行时：${String(error)}` };
    }
  }

  async rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    try {
      return await invoke<T>("host_rpc", { method, params });
    } catch (error) {
      throw toBridgeError(error);
    }
  }

  async home(): Promise<string | null> {
    try {
      return await invoke<string>("penglai_home");
    } catch (error) {
      throw toBridgeError(error);
    }
  }

  async subscribe(
    channelId: string,
    onEvent: HostEventListener,
    onState?: (state: SubscriptionState) => void,
  ): Promise<() => void> {
    this.ensureGlobalListener();
    const subscription = new ResilientSubscription(
      (dispatch, onClosed) => {
        const entry = { onEvent: dispatch, onClosed };
        const list = this.channels.get(channelId) ?? [];
        list.push(entry);
        this.channels.set(channelId, list);
        return {
          connect: async () => {
            // Idempotent native-side per channel; frames fan out via the
            // global listener registered in ensureGlobalListener.
            await invoke("host_subscribe", { channelId });
          },
          close: () => {
            const current = this.channels.get(channelId);
            if (!current) return;
            const next = current.filter((item) => item !== entry);
            if (next.length === 0) {
              this.channels.delete(channelId);
              void invoke("host_unsubscribe", { channelId }).catch(() => undefined);
            } else {
              this.channels.set(channelId, next);
            }
          },
        };
      },
      onEvent,
      onState,
    );
    return subscription.start().then(() => () => subscription.close());
  }

  /** One app-wide `host-event` listener; frames fan out by channelId. */
  private ensureGlobalListener(): void {
    if (this.globalListener) return;
    this.globalListener = listen<NativeHostEvent>("host-event", (event) => {
      const frame = event.payload;
      const entries = this.channels.get(frame.channelId);
      if (!entries || entries.length === 0) return;
      if (frame.closed) {
        // The native forwarder thread exited (socket closed or failed):
        // every logical subscription on this channel reconnects.
        for (const entry of [...entries]) entry.onClosed(frame.error);
        return;
      }
      if (frame.data === null) return;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(frame.data) as Record<string, unknown>;
      } catch {
        return;
      }
      for (const entry of entries) entry.onEvent(parsed);
    });
  }
}
