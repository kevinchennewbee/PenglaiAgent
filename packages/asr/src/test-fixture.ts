import type { TranscribeEngine } from "./engine.js";
import type { TranscriptDraft } from "./service.js";

/** Test-only deterministic seam. This module is not exported by the production plugin. */
export class FixtureAsrEngine implements TranscribeEngine {
  constructor(private readonly text = "licensed fixture transcript") {}

  async transcribe(pcm: Int16Array): Promise<TranscriptDraft> {
    if (!pcm.length) return { text: "", confirmed: false, noSpeech: true };
    let sum = 0;
    for (const sample of pcm) sum += sample * sample;
    if (Math.sqrt(sum / pcm.length) < 30) {
      return {
        text: "",
        confirmed: false,
        noSpeech: true,
        language: "zh",
      };
    }
    return { text: this.text, confirmed: false, language: "zh" };
  }
}
