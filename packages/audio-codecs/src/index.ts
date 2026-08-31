import { createHash } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import {
  Application,
  Signal,
  createDecoder,
  createEncoder,
} from "libopus-wasm";
import {
  decode as decodeSilk,
  encode as encodeSilk,
  getDuration as getSilkDuration,
  isSilk,
} from "silk-wasm";

export const PINNED_SILK_WASM = "3.7.1";
export const PINNED_LIBOPUS_WASM = "0.2.0";
export const PINNED_LIBOPUS = "1.6.1";
export const WEIXIN_SILK_SAMPLE_RATE = 24_000;
export const FEISHU_OPUS_SAMPLE_RATE = 16_000;
export const CODEC_MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const CODEC_MAX_DURATION_MS = 180_000;

const OPUS_FRAME_SAMPLES = 320;
const OPUS_FRAME_DURATION_MS = 20;
const OGG_CAPTURE = "OggS";

export interface DecodedWav {
  pcm: Int16Array;
  sampleRate: number;
  channels: 1 | 2;
  durationMs: number;
}

export interface ConvertedAudio {
  data: Buffer;
  durationMs: number;
  sampleRate: number;
  channels: 1;
  codec: "wav-pcm16" | "ogg-opus" | "weixin-silk";
}

function invalid(message: string): never {
  throw new PenglaiError("INVALID_INPUT", message);
}

function assertInputSize(buf: Buffer): void {
  if (!buf.length || buf.length > CODEC_MAX_INPUT_BYTES) {
    invalid("audio codec input size rejected");
  }
}

function assertDuration(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > CODEC_MAX_DURATION_MS) {
    invalid("audio codec duration rejected");
  }
}

export function decodePcm16Wav(buf: Buffer): DecodedWav {
  assertInputSize(buf);
  if (buf.length < 44 || buf.subarray(0, 4).toString("ascii") !== "RIFF" || buf.subarray(8, 12).toString("ascii") !== "WAVE") {
    invalid("PCM16 WAV header rejected");
  }
  let offset = 12;
  let format: { channels: 1 | 2; sampleRate: number; bits: number; code: number } | undefined;
  let data: Buffer | undefined;
  while (offset + 8 <= buf.length) {
    const id = buf.subarray(offset, offset + 4).toString("ascii");
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buf.length) invalid("WAV chunk length rejected");
    if (id === "fmt ") {
      if (size < 16) invalid("WAV fmt chunk rejected");
      const code = buf.readUInt16LE(start);
      const channels = buf.readUInt16LE(start + 2);
      const sampleRate = buf.readUInt32LE(start + 4);
      const bits = buf.readUInt16LE(start + 14);
      if (channels !== 1 && channels !== 2) invalid("WAV channel count rejected");
      format = { channels, sampleRate, bits, code };
    } else if (id === "data") {
      data = buf.subarray(start, end);
    }
    offset = end + (size % 2);
  }
  if (!format || !data) invalid("WAV fmt/data chunks required");
  if (format.code !== 1 || format.bits !== 16) invalid("WAV must be PCM16");
  if (![8_000, 12_000, 16_000, 24_000, 32_000, 44_100, 48_000].includes(format.sampleRate)) {
    invalid("WAV sample rate rejected");
  }
  const frameBytes = format.channels * 2;
  if (!data.length || data.length % frameBytes !== 0) invalid("WAV PCM alignment rejected");
  const frames = data.length / frameBytes;
  const durationMs = Math.round((frames * 1000) / format.sampleRate);
  assertDuration(durationMs);
  const copy = Buffer.from(data);
  return {
    pcm: new Int16Array(copy.buffer, copy.byteOffset, copy.byteLength / 2),
    sampleRate: format.sampleRate,
    channels: format.channels,
    durationMs,
  };
}

export function encodePcm16Wav(pcm: Int16Array, sampleRate: number, channels: 1 | 2 = 1): Buffer {
  if (!pcm.length || pcm.length % channels !== 0) invalid("PCM frame alignment rejected");
  if (![8_000, 12_000, 16_000, 24_000, 32_000, 44_100, 48_000].includes(sampleRate)) {
    invalid("PCM sample rate rejected");
  }
  const frames = pcm.length / channels;
  assertDuration(Math.round((frames * 1000) / sampleRate));
  const dataBytes = pcm.byteLength;
  if (dataBytes + 44 > CODEC_MAX_INPUT_BYTES) invalid("PCM output size rejected");
  const out = Buffer.alloc(44 + dataBytes);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * channels * 2, 28);
  out.writeUInt16LE(channels * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(dataBytes, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(out, 44);
  return out;
}

function monoAt(pcm: Int16Array, channels: 1 | 2, frame: number): number {
  if (channels === 1) return pcm[frame] ?? 0;
  const left = pcm[frame * 2] ?? 0;
  const right = pcm[frame * 2 + 1] ?? 0;
  return Math.round((left + right) / 2);
}

function resampleMono(input: DecodedWav, targetRate: number): Int16Array {
  const sourceFrames = input.pcm.length / input.channels;
  const targetFrames = Math.max(1, Math.round((sourceFrames * targetRate) / input.sampleRate));
  const out = new Int16Array(targetFrames);
  if (sourceFrames === 1) {
    out.fill(monoAt(input.pcm, input.channels, 0));
    return out;
  }
  for (let i = 0; i < targetFrames; i += 1) {
    const sourcePosition = (i * input.sampleRate) / targetRate;
    const lo = Math.min(sourceFrames - 1, Math.floor(sourcePosition));
    const hi = Math.min(sourceFrames - 1, lo + 1);
    const mix = sourcePosition - lo;
    const value = monoAt(input.pcm, input.channels, lo) * (1 - mix) + monoAt(input.pcm, input.channels, hi) * mix;
    out[i] = Math.max(-32_768, Math.min(32_767, Math.round(value)));
  }
  return out;
}

export function normalizeWavMono(buf: Buffer, targetRate: number): ConvertedAudio {
  const decoded = decodePcm16Wav(buf);
  const pcm = resampleMono(decoded, targetRate);
  const durationMs = Math.round((pcm.length * 1000) / targetRate);
  return {
    data: encodePcm16Wav(pcm, targetRate),
    durationMs,
    sampleRate: targetRate,
    channels: 1,
    codec: "wav-pcm16",
  };
}

export async function decodeWeixinSilkToWav(
  input: Buffer,
  sampleRate = WEIXIN_SILK_SAMPLE_RATE,
): Promise<ConvertedAudio> {
  assertInputSize(input);
  if (!isSilk(input)) invalid("Weixin SILK magic rejected");
  if (![8_000, 12_000, 16_000, 24_000].includes(sampleRate)) invalid("SILK sample rate rejected");
  const advertisedDuration = getSilkDuration(input);
  assertDuration(advertisedDuration);
  let result: Awaited<ReturnType<typeof decodeSilk>>;
  try {
    result = await decodeSilk(input, sampleRate);
  } catch {
    invalid("Weixin SILK decode failed");
  }
  if (!result.data.byteLength || result.data.byteLength % 2 !== 0) invalid("SILK PCM output rejected");
  const pcmBytes = Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength);
  const pcm = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength / 2);
  const durationMs = Math.round((pcm.length * 1000) / sampleRate);
  assertDuration(durationMs);
  if (Math.abs(durationMs - result.duration) > 120 || Math.abs(durationMs - advertisedDuration) > 120) {
    invalid("SILK duration mismatch");
  }
  return {
    data: encodePcm16Wav(pcm, sampleRate),
    durationMs,
    sampleRate,
    channels: 1,
    codec: "wav-pcm16",
  };
}

export async function encodeWavToWeixinSilk(wav: Buffer): Promise<ConvertedAudio> {
  const normalized = normalizeWavMono(wav, WEIXIN_SILK_SAMPLE_RATE);
  let result: Awaited<ReturnType<typeof encodeSilk>>;
  try {
    result = await encodeSilk(normalized.data, 0);
  } catch {
    invalid("Weixin SILK encode failed");
  }
  const data = Buffer.from(result.data);
  assertInputSize(data);
  if (!isSilk(data)) invalid("Weixin SILK encoder output rejected");
  const advertisedDuration = getSilkDuration(data);
  assertDuration(result.duration);
  assertDuration(advertisedDuration);
  if (
    Math.abs(result.duration - normalized.durationMs) > 120 ||
    Math.abs(advertisedDuration - normalized.durationMs) > 120
  ) {
    invalid("Weixin SILK encoded duration mismatch");
  }
  return {
    data,
    durationMs: normalized.durationMs,
    sampleRate: WEIXIN_SILK_SAMPLE_RATE,
    channels: 1,
    codec: "weixin-silk",
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 0x8000_0000 ? ((value << 1) ^ 0x04c1_1db7) >>> 0 : (value << 1) >>> 0;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function oggCrc(buf: Buffer): number {
  let crc = 0;
  for (const byte of buf) {
    crc = (((crc << 8) >>> 0) ^ (CRC_TABLE[((crc >>> 24) ^ byte) & 0xff] ?? 0)) >>> 0;
  }
  return crc >>> 0;
}

function oggPage(input: {
  packet: Buffer;
  serial: number;
  sequence: number;
  granule: bigint;
  headerType: number;
}): Buffer {
  const lacing: number[] = [];
  let left = input.packet.length;
  while (left >= 255) {
    lacing.push(255);
    left -= 255;
  }
  lacing.push(left);
  if (lacing.length > 255) invalid("Ogg packet too large");
  const header = Buffer.alloc(27 + lacing.length);
  header.write(OGG_CAPTURE, 0);
  header[4] = 0;
  header[5] = input.headerType;
  header.writeBigUInt64LE(input.granule, 6);
  header.writeUInt32LE(input.serial >>> 0, 14);
  header.writeUInt32LE(input.sequence >>> 0, 18);
  header.writeUInt32LE(0, 22);
  header[26] = lacing.length;
  for (let i = 0; i < lacing.length; i += 1) header[27 + i] = lacing[i]!;
  const page = Buffer.concat([header, input.packet]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

function opusHead(preSkip: number): Buffer {
  const out = Buffer.alloc(19);
  out.write("OpusHead", 0);
  out[8] = 1;
  out[9] = 1;
  out.writeUInt16LE(preSkip, 10);
  out.writeUInt32LE(FEISHU_OPUS_SAMPLE_RATE, 12);
  out.writeInt16LE(0, 16);
  out[18] = 0;
  return out;
}

function opusTags(): Buffer {
  const vendor = Buffer.from("Penglai 0.5.9", "utf8");
  const out = Buffer.alloc(8 + 4 + vendor.length + 4);
  out.write("OpusTags", 0);
  out.writeUInt32LE(vendor.length, 8);
  vendor.copy(out, 12);
  out.writeUInt32LE(0, 12 + vendor.length);
  return out;
}

function stableSerial(buf: Buffer): number {
  const value = createHash("sha256").update(buf).digest().readUInt32LE(0);
  return value === 0 ? 1 : value;
}

export async function encodeFeishuOggOpus(wav: Buffer): Promise<ConvertedAudio> {
  const normalized = normalizeWavMono(wav, FEISHU_OPUS_SAMPLE_RATE);
  const decoded = decodePcm16Wav(normalized.data);
  const encoder = await createEncoder({
    sampleRate: FEISHU_OPUS_SAMPLE_RATE,
    channels: 1,
    frameSize: OPUS_FRAME_SAMPLES,
    application: Application.Voip,
    bitrate: 24_000,
    complexity: 10,
    signal: Signal.Voice,
    vbr: true,
    dtx: false,
    fec: false,
  });
  let packets: Buffer[] = [];
  let preSkip = 0;
  try {
    preSkip = encoder.getLookahead();
    if (!Number.isSafeInteger(preSkip) || preSkip < 0 || preSkip > 5_000) {
      invalid("Opus encoder lookahead rejected");
    }
    const paddedSamples = Math.ceil((decoded.pcm.length + preSkip) / OPUS_FRAME_SAMPLES) * OPUS_FRAME_SAMPLES;
    const padded = new Int16Array(paddedSamples);
    padded.set(decoded.pcm);
    for (let offset = 0; offset < padded.length; offset += OPUS_FRAME_SAMPLES) {
      const packet = encoder.encode(padded.subarray(offset, offset + OPUS_FRAME_SAMPLES));
      if (!packet.length || packet.length > 1275) invalid("Opus packet size rejected");
      packets.push(Buffer.from(packet));
    }
  } finally {
    encoder.free();
  }
  if (!packets.length) invalid("Opus encoder produced no packets");
  const serial = stableSerial(normalized.data);
  const pages: Buffer[] = [
    oggPage({ packet: opusHead(preSkip * 3), serial, sequence: 0, granule: 0n, headerType: 2 }),
    oggPage({ packet: opusTags(), serial, sequence: 1, granule: 0n, headerType: 0 }),
  ];
  const finalGranule = BigInt(preSkip * 3 + decoded.pcm.length * 3);
  for (let i = 0; i < packets.length; i += 1) {
    const isLast = i === packets.length - 1;
    const decodedGranule = BigInt((i + 1) * OPUS_FRAME_SAMPLES * 3);
    pages.push(oggPage({
      packet: packets[i]!,
      serial,
      sequence: i + 2,
      granule: isLast ? finalGranule : decodedGranule,
      headerType: isLast ? 4 : 0,
    }));
  }
  packets = [];
  const data = Buffer.concat(pages);
  if (data.length > CODEC_MAX_INPUT_BYTES) invalid("Ogg Opus output size rejected");
  return {
    data,
    durationMs: normalized.durationMs,
    sampleRate: FEISHU_OPUS_SAMPLE_RATE,
    channels: 1,
    codec: "ogg-opus",
  };
}

interface ParsedOgg {
  packets: Buffer[];
  finalGranule: bigint;
}

function parseOgg(input: Buffer): ParsedOgg {
  assertInputSize(input);
  let offset = 0;
  let serial: number | undefined;
  let expectedSequence = 0;
  let finalGranule = 0n;
  let partial: Buffer[] = [];
  const packets: Buffer[] = [];
  while (offset < input.length) {
    if (offset + 27 > input.length || input.subarray(offset, offset + 4).toString("ascii") !== OGG_CAPTURE) {
      invalid("Ogg page capture rejected");
    }
    if (input[offset + 4] !== 0) invalid("Ogg version rejected");
    const segments = input[offset + 26] ?? 0;
    const headerBytes = 27 + segments;
    if (offset + headerBytes > input.length) invalid("Ogg segment table truncated");
    let bodyBytes = 0;
    for (let i = 0; i < segments; i += 1) bodyBytes += input[offset + 27 + i] ?? 0;
    const end = offset + headerBytes + bodyBytes;
    if (end > input.length) invalid("Ogg page body truncated");
    const page = Buffer.from(input.subarray(offset, end));
    const expectedCrc = page.readUInt32LE(22);
    page.writeUInt32LE(0, 22);
    if (oggCrc(page) !== expectedCrc) invalid("Ogg page checksum rejected");
    const pageSerial = input.readUInt32LE(offset + 14);
    const sequence = input.readUInt32LE(offset + 18);
    if (serial === undefined) serial = pageSerial;
    if (pageSerial !== serial || sequence !== expectedSequence) invalid("Ogg stream identity rejected");
    expectedSequence += 1;
    finalGranule = input.readBigUInt64LE(offset + 6);
    let bodyOffset = offset + headerBytes;
    for (let i = 0; i < segments; i += 1) {
      const length = input[offset + 27 + i] ?? 0;
      partial.push(input.subarray(bodyOffset, bodyOffset + length));
      bodyOffset += length;
      if (length < 255) {
        packets.push(Buffer.concat(partial));
        partial = [];
      }
    }
    offset = end;
  }
  if (partial.length || packets.length < 3) invalid("Ogg Opus packets incomplete");
  return { packets, finalGranule };
}

export async function decodeFeishuOggOpus(input: Buffer): Promise<ConvertedAudio> {
  const parsed = parseOgg(input);
  const head = parsed.packets[0]!;
  const tags = parsed.packets[1]!;
  if (head.length < 19 || head.subarray(0, 8).toString("ascii") !== "OpusHead") invalid("OpusHead rejected");
  if (tags.length < 8 || tags.subarray(0, 8).toString("ascii") !== "OpusTags") invalid("OpusTags rejected");
  const version = head[8] ?? 0;
  const channels = head[9] ?? 0;
  const mapping = head[18] ?? 255;
  if (version > 15 || (channels !== 1 && channels !== 2) || mapping !== 0) invalid("Opus stream layout rejected");
  const preSkip48 = head.readUInt16LE(10);
  const decoder = await createDecoder({
    sampleRate: FEISHU_OPUS_SAMPLE_RATE,
    channels,
    maxFrameSize: FEISHU_OPUS_SAMPLE_RATE * 120 / 1000,
  });
  const frames: Int16Array[] = [];
  let totalMonoSamples = 0;
  try {
    for (const packet of parsed.packets.slice(2)) {
      if (!packet.length || packet.length > 1275) invalid("Opus packet rejected");
      let decoded: Int16Array;
      try {
        decoded = decoder.decode(packet);
      } catch {
        invalid("Opus packet decode failed");
      }
      if (!decoded.length || decoded.length % channels !== 0) invalid("Opus decoded frame rejected");
      if (channels === 1) {
        frames.push(decoded);
        totalMonoSamples += decoded.length;
      } else {
        const mono = new Int16Array(decoded.length / 2);
        for (let i = 0; i < mono.length; i += 1) {
          mono[i] = Math.round(((decoded[i * 2] ?? 0) + (decoded[i * 2 + 1] ?? 0)) / 2);
        }
        frames.push(mono);
        totalMonoSamples += mono.length;
      }
      if (totalMonoSamples * 2 + 44 > CODEC_MAX_INPUT_BYTES) invalid("Opus decoded size rejected");
    }
  } finally {
    decoder.free();
  }
  const all = new Int16Array(totalMonoSamples);
  let cursor = 0;
  for (const frame of frames) {
    all.set(frame, cursor);
    cursor += frame.length;
  }
  const preSkip = Math.floor((preSkip48 * FEISHU_OPUS_SAMPLE_RATE) / 48_000);
  const granuleSamples = Number(parsed.finalGranule * BigInt(FEISHU_OPUS_SAMPLE_RATE) / 48_000n);
  if (!Number.isSafeInteger(granuleSamples) || granuleSamples <= preSkip) invalid("Opus granule rejected");
  const playable = granuleSamples - preSkip;
  if (preSkip + playable > all.length) invalid("Opus granule exceeds decoded PCM");
  const pcm = all.slice(preSkip, preSkip + playable);
  const durationMs = Math.round((pcm.length * 1000) / FEISHU_OPUS_SAMPLE_RATE);
  assertDuration(durationMs);
  return {
    data: encodePcm16Wav(pcm, FEISHU_OPUS_SAMPLE_RATE),
    durationMs,
    sampleRate: FEISHU_OPUS_SAMPLE_RATE,
    channels: 1,
    codec: "wav-pcm16",
  };
}
