import { createHash } from "node:crypto";
import {
  PENGLAI_ASR_MODEL_STATES,
  PenglaiError,
  type ErrorClass,
  type PenglaiAsrClient,
  type PenglaiMossTtsClient,
  type PenglaiTtsLocale,
} from "@penglai/contracts";
import { decodeFeishuOggOpus, encodeFeishuOggOpus, normalizeWavMono } from "@penglai/audio-codecs";
import type { InboundFailureDiagnostic } from "@penglai/routing-core";

export class FeishuMediaFailure extends PenglaiError {
  constructor(
    errorClass: ErrorClass,
    readonly diagnostic: InboundFailureDiagnostic,
  ) {
    super(
      errorClass,
      `FEISHU_MEDIA_${diagnostic.phase.toUpperCase().replaceAll("-", "_")}_${diagnostic.reason.toUpperCase().replaceAll("-", "_")}`,
    );
  }
}

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
  opts: {
    authorized: boolean;
    claimed: boolean;
    privateChat: boolean;
    operationId: string;
    onPhase?: (phase: "validating" | "transcoding" | "transcribing") => void;
  },
): Promise<{ text: string; digest: string; language?: string; emotion?: string }> {
  opts.onPhase?.("validating");
  let normalized: { data: Buffer };
  try {
    opts.onPhase?.("transcoding");
    normalized = buf.subarray(0, 4).toString("ascii") === "OggS"
      ? await decodeFeishuOggOpus(buf)
      : normalizeWavMono(buf, 16_000);
  } catch (error) {
    if (error instanceof FeishuMediaFailure) throw error;
    throw new FeishuMediaFailure(
      error instanceof PenglaiError ? error.errorClass : "INVALID_INPUT",
      { phase: "resource-validation", reason: "unsupported-codec" },
    );
  }
  opts.onPhase?.("transcribing");
  const capability = asr.describeCapability?.();
  if (capability && !(PENGLAI_ASR_MODEL_STATES as readonly string[]).includes(capability.model)) {
    throw new FeishuMediaFailure("STORE_CORRUPT", {
      phase: "transcription",
      reason: "client-unavailable",
    });
  }
  if (capability?.model !== undefined && capability.model !== "ready") {
    throw new FeishuMediaFailure("DSH_UNAVAILABLE", {
      phase: "transcription",
      reason: "model-not-ready",
    });
  }
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
  if (result.draft.noSpeech || !result.draft.text.trim()) {
    throw new FeishuMediaFailure("INVALID_INPUT", {
      phase: "transcription",
      reason: "no-speech",
    });
  }
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
