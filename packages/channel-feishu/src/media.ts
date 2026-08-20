import { createHash } from "node:crypto";
import {
  PenglaiError,
  type PenglaiAsrClient,
  type PenglaiMossTtsClient,
  type PenglaiTtsLocale,
} from "@penglai/contracts";
import { decodeFeishuOggOpus, encodeFeishuOggOpus, normalizeWavMono } from "@penglai/audio-codecs";

export interface FeishuAudioReply {
  msgType: "audio";
  durationMs: number;
  digest: string;
  contentType: "audio/ogg; codecs=opus";
  filename: string;
  opus: Buffer;
}

export async function inboundFeishuAudioToText(
  buf: Buffer,
  asr: PenglaiAsrClient,
  opts: { authorized: boolean; claimed: boolean; privateChat: boolean; operationId: string },
): Promise<{ text: string; digest: string; language?: string; emotion?: string }> {
  const normalized = buf.subarray(0, 4).toString("ascii") === "OggS"
    ? await decodeFeishuOggOpus(buf)
    : normalizeWavMono(buf, 16_000);
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
    digest: handle.digest,
    ...(result.draft.language ? { language: result.draft.language } : {}),
    ...(result.draft.emotion ? { emotion: result.draft.emotion } : {}),
  };
}

export async function outboundFeishuNativeAudio(
  input: {
    finalText: string;
    sourceFinalId: string;
    operationId: string;
    voiceId?: string;
    locale?: PenglaiTtsLocale;
  },
  tts: PenglaiMossTtsClient,
): Promise<FeishuAudioReply> {
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
    const opus = await encodeFeishuOggOpus(wav);
    return {
      msgType: "audio",
      durationMs: opus.durationMs,
      digest: createHash("sha256").update(opus.data).digest("hex"),
      contentType: "audio/ogg; codecs=opus",
      filename: `penglai-${synthesized.handle.digest.slice(0, 12)}.opus`,
      opus: opus.data,
    };
  } finally {
    await tts.releaseOutput(synthesized.handle.id);
  }
}
