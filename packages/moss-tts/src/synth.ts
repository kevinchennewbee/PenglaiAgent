import { PenglaiError } from "@penglai/contracts";
import { TTS_CHANNELS, TTS_SAMPLE_RATE } from "./engine.js";
import type { SynthesizeInput } from "./service.js";

export { TTS_CHANNELS, TTS_SAMPLE_RATE } from "./engine.js";

export interface PcmResult {
  pcm48kStereo: true;
  digest: string;
  voiceId: string;
  sampleRate: number;
  channels: number;
  pcm: Int16Array;
  wav: Buffer;
}

/**
 * The old synchronous helper generated a sine wave and could be called without
 * the verified model. It remains only as an explicit fail-closed compatibility
 * boundary while channel adapters migrate to the typed async Cordis service.
 */
export function synthesizePcm(_input: SynthesizeInput): PcmResult {
  throw new PenglaiError(
    "DSH_UNAVAILABLE",
    "synchronous TTS is unavailable; use the verified penglaiMossTts service",
  );
}

export function encodeWav(
  pcm: Int16Array,
  sampleRate = TTS_SAMPLE_RATE,
  channels = TTS_CHANNELS,
): Buffer {
  if (
    sampleRate !== TTS_SAMPLE_RATE || channels !== TTS_CHANNELS ||
    pcm.length === 0 || pcm.length % channels !== 0
  ) {
    throw new PenglaiError(
      "DSH_CONTRACT_DRIFT",
      "TTS WAV must be non-empty 48 kHz stereo PCM16",
    );
  }
  const data = Buffer.allocUnsafe(pcm.length * 2);
  for (let index = 0; index < pcm.length; index += 1) {
    data.writeInt16LE(pcm[index] ?? 0, index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
