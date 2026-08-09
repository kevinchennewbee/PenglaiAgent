/**
 * Host connection lifecycle: probe → handshake compatibility → online;
 * reconnect polling with distinct error/incompatible phases and host-restart
 * detection via instanceId (a restarted host invalidates every live view).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeHandshake } from "@penglai/protocol";
import type { PenglaiBridge } from "../bridge/types.js";
import { checkHandshake } from "../state/workbench.js";

export type ConnectionPhase =
  | "connecting"
  | "online"
  | "reconnecting"
  | "error"
  | "incompatible";

export interface HostConnection {
  phase: ConnectionPhase;
  handshake: RuntimeHandshake | null;
  error: string | null;
  /** Increments when the host instance changes (restart) while online. */
  generation: number;
  retry: () => void;
}

const DOWN_POLL_MS = 2000;
const UP_POLL_MS = 5000;

export function useHostConnection(bridge: PenglaiBridge): HostConnection {
  const [phase, setPhase] = useState<ConnectionPhase>("connecting");
  const [handshake, setHandshake] = useState<RuntimeHandshake | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const lastInstance = useRef<string | null>(null);
  const probing = useRef(false);

  const probe = useCallback(async () => {
    if (probing.current) return;
    probing.current = true;
    try {
      const status = await bridge.status();
      if (!status.ok || !status.handshake) {
        lastInstance.current = null;
        setHandshake(null);
        setError(status.error ?? "Host 未就绪");
        setPhase((current) => (current === "online" ? "reconnecting" : "error"));
        return;
      }
      const compat = checkHandshake(status.handshake);
      if (!compat.compatible) {
        lastInstance.current = null;
        setHandshake(status.handshake);
        setError(compat.reason);
        setPhase("incompatible");
        return;
      }
      if (
        lastInstance.current !== null &&
        lastInstance.current !== status.handshake.instanceId
      ) {
        // Host restarted underneath us: every subscription died; the app
        // reloads all views off this generation bump.
        setGeneration((value) => value + 1);
      }
      lastInstance.current = status.handshake.instanceId;
      setHandshake(status.handshake);
      setError(null);
      setPhase("online");
    } finally {
      probing.current = false;
    }
  }, [bridge]);

  useEffect(() => {
    void probe();
    const timer = window.setInterval(
      () => void probe(),
      phase === "online" ? UP_POLL_MS : DOWN_POLL_MS,
    );
    return () => window.clearInterval(timer);
  }, [phase, probe]);

  return { phase, handshake, error, generation, retry: () => void probe() };
}
