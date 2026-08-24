import { PenglaiError } from "@penglai/contracts";
import {
  GUIDED_STEPS,
  getChannelManifest,
  refuseFakeQr,
  type ChannelId,
  type ConnectionMethod,
} from "./registry.js";

export interface GuidedConnectionState {
  id: string;
  channel: ChannelId;
  method: ConnectionMethod;
  qr: false;
  live: false;
  steps: { en: string[]; zh: string[] };
  docsUrl: string;
}

export function beginGuidedConnection(input: {
  channel: string;
  method: string;
  riskAck?: boolean;
}): GuidedConnectionState {
  const manifest = getChannelManifest(input.channel);
  refuseFakeQr(manifest.id, input.method);
  if (manifest.risk === "community-protocol" && input.riskAck !== true) {
    throw new PenglaiError("SECURITY_POLICY", "CHANNEL_RISK_ACK");
  }
  if (manifest.live) {
    throw new PenglaiError("INVALID_INPUT", "LIVE_CHANNEL_USES_NATIVE_CONNECT");
  }
  return {
    id: `${manifest.id}:${input.method}`,
    channel: manifest.id,
    method: input.method as ConnectionMethod,
    qr: false,
    live: false,
    steps: GUIDED_STEPS[manifest.id],
    docsUrl: manifest.docsUrl,
  };
}

export function refuseUnliveSend(channel: string): never {
  throw new PenglaiError("SECURITY_POLICY", `CHANNEL_NOT_LIVE:${channel}`);
}
