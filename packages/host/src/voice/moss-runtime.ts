/**
 * Node adapter for the official MOSS-TTS-Nano ONNX CPU pipeline.
 *
 * The heavy inference algorithm is kept in third_party/moss_tts/runtime.mjs
 * with its Apache-2.0 attribution.  This TypeScript boundary owns filesystem
 * containment, instance reuse, voice selection and channel-interleaved PCM.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  BrowserOnnxTtsRuntime,
  type MossAudioChunk,
} from "./third_party/moss_tts/runtime.mjs";

export interface MossRuntimeResult {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  voice: string;
}

export interface MossRuntimeOptions {
  modelDir: string;
  voice?: string;
  threads?: number;
  log?: (line: string) => void;
}

function safeAssetPath(rootPath: string, relativePath: string): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`MOSS asset escapes model root: ${relativePath}`);
  }
  return target;
}

function interleave(chunks: MossAudioChunk[]): {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
} {
  const first = chunks.find((chunk) => chunk.chunkData.some((channel) => channel.length > 0));
  if (!first) throw new Error("MOSS-TTS returned no audio samples");
  const channels = first.channels;
  const sampleRate = first.sampleRate;
  const frameCount = chunks.reduce((sum, chunk) => {
    if (chunk.channels !== channels || chunk.sampleRate !== sampleRate) {
      throw new Error("MOSS-TTS returned inconsistent audio chunks");
    }
    const length = chunk.chunkData[0]?.length ?? 0;
    if (chunk.chunkData.some((channel) => channel.length !== length)) {
      throw new Error("MOSS-TTS returned unbalanced channel data");
    }
    return sum + length;
  }, 0);
  const samples = new Float32Array(frameCount * channels);
  let frameOffset = 0;
  for (const chunk of chunks) {
    const frames = chunk.chunkData[0]?.length ?? 0;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        samples[(frameOffset + frame) * channels + channel] = chunk.chunkData[channel][frame];
      }
    }
    frameOffset += frames;
  }
  return { samples, sampleRate, channels };
}

export class MossTtsRuntime {
  private runtime: BrowserOnnxTtsRuntime | null = null;
  private preparing: Promise<BrowserOnnxTtsRuntime> | null = null;

  constructor(private readonly options: MossRuntimeOptions) {}

  private async prepare(): Promise<BrowserOnnxTtsRuntime> {
    if (this.runtime) return this.runtime;
    if (this.preparing) return this.preparing;
    this.preparing = (async () => {
      const runtime = new BrowserOnnxTtsRuntime({
        logger: this.options.log ?? null,
        assetReader: {
          readText: async ({ rootPath, relativePath }) =>
            fs.readFileSync(safeAssetPath(rootPath, relativePath), "utf8"),
          readJson: async ({ rootPath, relativePath }) =>
            JSON.parse(fs.readFileSync(safeAssetPath(rootPath, relativePath), "utf8")),
          readBuffer: async ({ rootPath, relativePath }) =>
            new Uint8Array(fs.readFileSync(safeAssetPath(rootPath, relativePath))),
        },
      });
      await runtime.configure({
        modelPath: path.resolve(this.options.modelDir),
        threadCount: Math.max(1, this.options.threads ?? Math.min(4, os.cpus().length)),
      });
      await runtime.ensureManifestLoaded();
      this.runtime = runtime;
      return runtime;
    })();
    try {
      return await this.preparing;
    } finally {
      this.preparing = null;
    }
  }

  async synthesize(text: string): Promise<MossRuntimeResult> {
    const runtime = await this.prepare();
    const voices = runtime.listBuiltinVoices();
    const selected =
      voices.find((voice) =>
        [voice.voice, voice.id, voice.display_name].includes(this.options.voice),
      ) ?? voices[0];
    const voice = selected?.voice ?? selected?.id ?? selected?.display_name;
    if (!voice) throw new Error("MOSS-TTS manifest has no built-in voice preset");
    const result = await runtime.synthesizeVoiceClone({
      text,
      voiceName: voice,
      streaming: false,
      sampleMode: "fixed",
      voiceCloneMaxTextTokens: 75,
      enableNormalizeTtsText: true,
      enableWeTextProcessing: false,
    });
    const audio = interleave(result.outputs.flatMap((output) => output.chunks));
    return { ...audio, voice };
  }
}
