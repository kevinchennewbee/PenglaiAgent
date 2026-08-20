export interface MossAudioChunk {
  channels: number;
  sampleRate: number;
  chunkData: Float32Array[];
  isPause?: boolean;
}

export interface MossSynthesisOutput {
  frames: number;
  chunks: MossAudioChunk[];
}

export interface MossSynthesisResult {
  textChunks: string[];
  outputs: MossSynthesisOutput[];
}

export interface MossVoicePreset {
  voice?: string;
  id?: string;
  display_name?: string;
  prompt_audio_codes: number[][];
}

export class BrowserOnnxTtsRuntime {
  constructor(options?: { logger?: ((line: string) => void) | null });
  configure(input: { modelPath: string; threadCount?: number }): Promise<void>;
  ensureManifestLoaded(): Promise<void>;
  listBuiltinVoices(): MossVoicePreset[];
  warmup(): Promise<void>;
  synthesizeVoiceClone(input: {
    text: string;
    voiceName?: string | null;
    streaming?: boolean;
    doSample?: boolean | null;
    sampleMode?: "greedy" | "fixed" | "full" | null;
    voiceCloneMaxTextTokens?: number;
    enableNormalizeTtsText?: boolean;
    enableWeTextProcessing?: boolean;
    onAudioChunk?: ((chunk: MossAudioChunk) => Promise<void>) | null;
    isCancelled?: () => boolean;
  }): Promise<MossSynthesisResult>;
}

export function createBrowserOnnxTtsRuntime(
  options?: ConstructorParameters<typeof BrowserOnnxTtsRuntime>[0],
): BrowserOnnxTtsRuntime;
