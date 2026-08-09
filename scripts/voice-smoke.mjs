#!/usr/bin/env node
/** Real-weight MOSS-TTS release smoke. Run after `npm run build -w @penglai/host`. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VoiceService } from "../packages/host/dist/src/voice/service.js";

const output = path.resolve(
  process.argv[2] ||
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), "penglai-040-moss-smoke-")), "output.wav"),
);
const text = process.argv[3] || "你好，我是蓬莱。语音合成真机验收已经开始。";
const dataDir = process.env.PENGLAI_DATA_DIR
  ? path.resolve(process.env.PENGLAI_DATA_DIR)
  : path.join(os.homedir(), ".penglai");

const service = new VoiceService({ dataDir, log: (line) => console.error(`[voice] ${line}`) });
const status = service.status();
if (!status.tts.ready) {
  throw new Error(`MOSS-TTS not ready: ${status.tts.detail}`);
}
const startedAt = Date.now();
const result = await service.synthesize({ text });
if (!result.ok || !result.wavBase64) {
  throw new Error(result.error || "MOSS-TTS returned no WAV");
}
const wav = Buffer.from(result.wavBase64, "base64");
if (wav.subarray(0, 4).toString("ascii") !== "RIFF" || wav.subarray(8, 12).toString("ascii") !== "WAVE") {
  throw new Error("MOSS-TTS output is not RIFF/WAVE");
}
const channels = wav.readUInt16LE(22);
const sampleRate = wav.readUInt32LE(24);
const bits = wav.readUInt16LE(34);
const dataBytes = wav.readUInt32LE(40);
const frames = dataBytes / (channels * (bits / 8));
const durationSeconds = frames / sampleRate;
let squareSum = 0;
let peak = 0;
let samples = 0;
for (let offset = 44; offset + 1 < wav.length; offset += 2) {
  const value = wav.readInt16LE(offset) / 32768;
  squareSum += value * value;
  peak = Math.max(peak, Math.abs(value));
  samples += 1;
}
const rms = Math.sqrt(squareSum / Math.max(1, samples));
if (channels < 1 || sampleRate < 16_000 || durationSeconds < 0.25 || rms < 0.0001 || peak < 0.001) {
  throw new Error(`invalid/non-audible WAV: channels=${channels} rate=${sampleRate} duration=${durationSeconds} rms=${rms} peak=${peak}`);
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, wav);
console.log(JSON.stringify({
  ok: true,
  output,
  engine: result.engine,
  channels,
  sampleRate,
  bits,
  durationSeconds: Number(durationSeconds.toFixed(3)),
  rms: Number(rms.toFixed(6)),
  peak: Number(peak.toFixed(6)),
  bytes: wav.length,
  elapsedMs: Date.now() - startedAt,
}, null, 2));
