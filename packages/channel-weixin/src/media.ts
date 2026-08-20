import { createHash } from "node:crypto";
import {
  PenglaiError,
  type PenglaiAsrClient,
  type PenglaiMossTtsClient,
  type PenglaiTtsLocale,
} from "@penglai/contracts";
import { decodeWeixinSilkToWav, normalizeWavMono } from "@penglai/audio-codecs";

export type VoicePolicy = "text" | "voice" | "text+voice" | "mirror";

export interface MediaTranscript {
  text: string;
  mediaType: string;
  digest: string;
  language?: string;
  emotion?: string;
}

export async function inboundVoiceToText(
  buf: Buffer,
  asr: PenglaiAsrClient,
  opts: { authorized: boolean; claimed: boolean; privateChat: boolean; operationId: string; sampleRate?: number },
): Promise<MediaTranscript> {
  const normalized = buf.subarray(0, 4).toString("ascii") === "RIFF"
    ? normalizeWavMono(buf, 16_000)
    : await decodeWeixinSilkToWav(buf, opts.sampleRate);
  const handle = await asr.stageAudio(normalized.data, {
    source: "im",
    ownerOperation: opts.operationId,
    mediaType: "audio/wav",
  });
  const result = await asr.transcribe(handle, {
    authorized: opts.authorized,
    claimed: opts.claimed,
    privateChat: opts.privateChat,
  }, opts.operationId);
  if (result.draft.noSpeech) throw new PenglaiError("INVALID_INPUT", "asr no-speech");
  if (!result.draft.text.trim()) throw new PenglaiError("INVALID_INPUT", "asr no-speech");
  return {
    text: result.draft.text.trim(),
    mediaType: handle.mediaType,
    digest: handle.digest,
    ...(result.draft.language ? { language: result.draft.language } : {}),
    ...(result.draft.emotion ? { emotion: result.draft.emotion } : {}),
  };
}

export async function outboundTtsAttachment(
  input: {
    finalText: string;
    sourceFinalId: string;
    operationId: string;
    voiceId?: string;
    locale?: PenglaiTtsLocale;
  },
  policy: VoicePolicy,
  tts: PenglaiMossTtsClient,
): Promise<{ text?: string; audio?: { wav: Buffer; voiceId: string; digest: string }; mode: VoicePolicy }> {
  if (policy === "text") return { text: input.finalText, mode: policy };
  const finalDigest = createHash("sha256").update(input.finalText).digest("hex");
  const synthesized = await tts.synthesize({
    operationId: input.operationId,
    sourceFinalId: input.sourceFinalId,
    finalText: input.finalText,
    finalDigest,
    voiceId: input.voiceId ?? "moss-zh-default",
    locale: input.locale ?? "zh",
  });
  try {
    const wav = await tts.readOutput(synthesized.handle, input.operationId);
    if (
      createHash("sha256").update(wav).digest("hex") !== synthesized.handle.digest ||
      wav.length !== synthesized.handle.bytes
    ) {
      throw new PenglaiError("STORE_CORRUPT", "TTS output handle mismatch");
    }
    const audio = {
      wav,
      voiceId: synthesized.handle.voiceId,
      digest: synthesized.handle.digest,
    };
    if (policy === "voice") return { audio, mode: policy };
    return { text: input.finalText, audio, mode: policy };
  } finally {
    await tts.releaseOutput(synthesized.handle.id);
  }
}

export function weixinVisibleAudioFallback(attachment: { wav: Buffer; digest: string }): {
  itemType: "file";
  filename: string;
  contentType: "audio/wav";
  data: Buffer;
  bytes: number;
  digest: string;
} {
  return {
    itemType: "file",
    filename: `penglai-${attachment.digest.slice(0, 12)}.wav`,
    contentType: "audio/wav",
    data: attachment.wav,
    bytes: attachment.wav.length,
    digest: attachment.digest,
  };
}
