#!/usr/bin/env node
/** Real-weight SenseVoice smoke against a WAV file (often MOSS smoke output). */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VoiceService } from "../packages/host/dist/src/voice/service.js";

const input = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!input || !fs.existsSync(input)) {
  throw new Error("usage: node scripts/voice-asr-smoke.mjs <input.wav>");
}
const dataDir = process.env.PENGLAI_DATA_DIR
  ? path.resolve(process.env.PENGLAI_DATA_DIR)
  : path.join(os.homedir(), ".penglai");
const service = new VoiceService({ dataDir, log: (line) => console.error(`[voice] ${line}`) });
const status = service.status();
if (!status.asr.ready) throw new Error(`SenseVoice not ready: ${status.asr.detail}`);
const startedAt = Date.now();
const result = await service.transcribe({
  audioBase64: fs.readFileSync(input).toString("base64"),
  format: path.extname(input).slice(1) || "wav",
});
if (!result.ok || !result.text?.trim()) {
  throw new Error(result.error || "SenseVoice returned no text");
}
console.log(JSON.stringify({
  ok: true,
  input,
  text: result.text,
  emotion: result.emotion,
  language: result.language,
  noSpeech: result.noSpeech,
  elapsedMs: Date.now() - startedAt,
}, null, 2));
