import { PenglaiError } from "@penglai/contracts";

export const MICROPHONE_NONCE_TTL_MS = 15_000;

export interface MicrophoneNonce {
  nonce: string;
  webContentsId: number;
  origin: string;
  expiresAt: number;
}

export interface MediaPermissionDetails {
  requestingUrl?: string;
  mediaTypes?: string[];
}

export function issueMicrophoneNonce(input: {
  webContentsId: number;
  origin: string;
  now?: number;
  ttlMs?: number;
}): MicrophoneNonce {
  let origin: URL;
  try {
    origin = new URL(input.origin);
  } catch {
    throw new PenglaiError("SECURITY_POLICY", "microphone origin rejected");
  }
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1") {
    throw new PenglaiError("SECURITY_POLICY", "microphone origin rejected");
  }
  const now = input.now ?? Date.now();
  return {
    nonce: `mic_${now.toString(16)}_${Math.random().toString(16).slice(2, 10)}`,
    webContentsId: input.webContentsId,
    origin: `${origin.protocol}//${origin.hostname}${origin.port ? `:${origin.port}` : ""}`,
    expiresAt: now + (input.ttlMs ?? MICROPHONE_NONCE_TTL_MS),
  };
}

export function allowMicrophoneMedia(input: {
  pending: MicrophoneNonce | undefined;
  webContentsId: number;
  details: MediaPermissionDetails;
  now?: number;
}): { allow: boolean; pending?: MicrophoneNonce } {
  const now = input.now ?? Date.now();
  const types = input.details.mediaTypes ?? [];
  if (types.length !== 1 || types[0] !== "audio") {
    return input.pending ? { allow: false, pending: input.pending } : { allow: false };
  }
  if (!input.pending || input.pending.webContentsId !== input.webContentsId || input.pending.expiresAt <= now) {
    return { allow: false };
  }
  let request: URL;
  try {
    request = new URL(input.details.requestingUrl ?? "");
  } catch {
    return input.pending ? { allow: false, pending: input.pending } : { allow: false };
  }
  const origin = `${request.protocol}//${request.hostname}${request.port ? `:${request.port}` : ""}`;
  if (origin !== input.pending.origin) {
    return { allow: false, pending: input.pending };
  }
  return { allow: true };
}
