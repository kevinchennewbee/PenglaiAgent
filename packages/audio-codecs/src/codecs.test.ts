import assert from "node:assert/strict";
import test from "node:test";
import { encode as encodeSilk } from "silk-wasm";
import {
  decodeFeishuOggOpus,
  decodePcm16Wav,
  decodeWeixinSilkToWav,
  encodeFeishuOggOpus,
  encodePcm16Wav,
  encodeWavToWeixinSilk,
} from "./index.js";

function toneWav(sampleRate = 48_000, durationMs = 1_000): Buffer {
  const frames = Math.round(sampleRate * durationMs / 1000);
  const pcm = new Int16Array(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    const value = Math.round(8_000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    pcm[i * 2] = value;
    pcm[i * 2 + 1] = value;
  }
  return encodePcm16Wav(pcm, sampleRate, 2);
}

test("R50-VOICE-005 real WASM Ogg Opus round-trip is mono 16 kHz without system tools", async () => {
  const encoded = await encodeFeishuOggOpus(toneWav());
  assert.equal(encoded.data.subarray(0, 4).toString("ascii"), "OggS");
  assert.equal(encoded.codec, "ogg-opus");
  assert.equal(encoded.sampleRate, 16_000);
  assert.equal(encoded.channels, 1);
  const decoded = await decodeFeishuOggOpus(encoded.data);
  const wav = decodePcm16Wav(decoded.data);
  assert.equal(wav.sampleRate, 16_000);
  assert.equal(wav.channels, 1);
  assert.ok(Math.abs(wav.durationMs - 1_000) <= 2);
  assert.ok(wav.pcm.some((sample) => Math.abs(sample) > 100));
});

test("R50-VOICE-014 real silk-wasm decodes a pinned-format Weixin SILK fixture", async () => {
  const wav = toneWav(24_000, 400);
  const silk = await encodeSilk(wav, 0);
  assert.ok(silk.data.byteLength > 0);
  const decoded = await decodeWeixinSilkToWav(Buffer.from(silk.data), 24_000);
  const parsed = decodePcm16Wav(decoded.data);
  assert.equal(parsed.sampleRate, 24_000);
  assert.equal(parsed.channels, 1);
  assert.ok(Math.abs(parsed.durationMs - 400) <= 120);
  assert.ok(parsed.pcm.some((sample) => Math.abs(sample) > 100));
});

test("Weixin outbound WAV is normalized and encoded as verified SILK", async () => {
  const encoded = await encodeWavToWeixinSilk(toneWav(48_000, 400));
  assert.equal(encoded.codec, "weixin-silk");
  assert.equal(encoded.sampleRate, 24_000);
  assert.equal(encoded.channels, 1);
  const decoded = await decodeWeixinSilkToWav(encoded.data, encoded.sampleRate);
  assert.ok(Math.abs(decoded.durationMs - 400) <= 120);
});

test("Ogg checksum and non-SILK inputs fail closed", async () => {
  const encoded = await encodeFeishuOggOpus(toneWav(16_000, 200));
  const corrupt = Buffer.from(encoded.data);
  corrupt[corrupt.length - 1] ^= 0xff;
  await assert.rejects(() => decodeFeishuOggOpus(corrupt), /checksum/);
  await assert.rejects(() => decodeWeixinSilkToWav(Buffer.from("not silk")), /SILK magic/);
});
