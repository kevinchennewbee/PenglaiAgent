import { PenglaiError } from "@penglai/contracts";

export type AsrModelState =
  | "not_installed"
  | "verifying"
  | "downloading"
  | "paused"
  | "ready"
  | "corrupt"
  | "failed";

export const ASR_MAX_BYTES = 8 * 1024 * 1024;
export const ASR_MAX_DURATION_MS = 180_000;
export const ASR_ALLOWED_MAGIC = ["RIFF", "ID3", "OggS", "ftyp", "#!SILK"] as const;

export interface AudioGateInput {
  authorized: boolean;
  claimed: boolean;
  privateChat: boolean;
  magic: string;
  bytes: number;
  durationMs: number;
}

export interface TranscriptDraft {
  text: string;
  language?: string;
  emotion?: string;
  noSpeech?: boolean;
  confirmed: boolean;
}

export function describeAsrCapability(model: AsrModelState) {
  return {
    plugin: "active",
    model,
    enterTurn: false,
  };
}

export function gateAudio(input: AudioGateInput): { ok: true } {
  if (!input.authorized) throw new PenglaiError("SECURITY_POLICY", "asr unauthorized");
  if (!input.privateChat) throw new PenglaiError("SECURITY_POLICY", "asr rejects group/media before model");
  if (!input.claimed) throw new PenglaiError("INVALID_INPUT", "asr requires durable claim");
  if (!ASR_ALLOWED_MAGIC.some((m) => input.magic.startsWith(m))) {
    throw new PenglaiError("INVALID_INPUT", "asr magic rejected");
  }
  if (input.bytes <= 0 || input.bytes > ASR_MAX_BYTES) throw new PenglaiError("INVALID_INPUT", "asr size rejected");
  if (input.durationMs <= 0 || input.durationMs > ASR_MAX_DURATION_MS) {
    throw new PenglaiError("INVALID_INPUT", "asr duration rejected");
  }
  return { ok: true };
}

export function confirmBeforeTurn(draft: TranscriptDraft): { enterTurn: true; text: string } {
  if (!draft.confirmed) throw new PenglaiError("INVALID_INPUT", "asr transcript not confirmed");
  if (draft.noSpeech || !draft.text.trim()) throw new PenglaiError("INVALID_INPUT", "asr no-speech");
  return { enterTurn: true, text: draft.text.trim() };
}
