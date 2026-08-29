export const PLAYBACK_STATES = [
  "idle",
  "synthesizing",
  "buffering",
  "playing",
  "completed",
  "failed",
  "stalled",
  "stopping",
] as const;

export type PlaybackState = (typeof PLAYBACK_STATES)[number];
export type PlaybackStopReason = "user" | "replaced" | "navigation" | "disable";

export interface PlaybackAudio {
  play(): Promise<void>;
  pause(): void;
  onended: ((this: PlaybackAudio, ev?: unknown) => void) | null;
  onerror: ((this: PlaybackAudio, ev?: unknown) => void) | null;
  onstalled: ((this: PlaybackAudio, ev?: unknown) => void) | null;
  onabort: ((this: PlaybackAudio, ev?: unknown) => void) | null;
}

export interface PlaybackIo {
  Audio: new (src: string) => PlaybackAudio;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export interface PlaybackResult {
  state: PlaybackState;
  generation: number;
  errorCode?: string;
}

export function createAudioPlaybackController(io: PlaybackIo) {
  let generation = 0;
  let state: PlaybackState = "idle";
  let current: { url: string; audio: PlaybackAudio; generation: number } | undefined;
  const listeners = new Set<(state: PlaybackState) => void>();

  const emit = (next: PlaybackState): void => {
    state = next;
    for (const listener of listeners) listener(state);
  };

  const release = (reason: PlaybackStopReason): void => {
    const held = current;
    current = undefined;
    if (!held) return;
    try {
      held.audio.onended = null;
      held.audio.onerror = null;
      held.audio.onstalled = null;
      held.audio.onabort = null;
      held.audio.pause();
    } catch {
      /* player already closed */
    }
    if (reason === "user" || reason === "replaced" || reason === "navigation" || reason === "disable") {
      io.revokeObjectURL(held.url);
    }
  };

  const finish = (token: number, next: PlaybackState, url?: string): void => {
    if (token !== generation || current?.generation !== token) return;
    if (url) io.revokeObjectURL(url);
    current = undefined;
    emit(next);
  };

  return {
    beginSynthesize(): number {
      generation += 1;
      release("replaced");
      emit("synthesizing");
      return generation;
    },
    async play(input: Blob, token = generation): Promise<PlaybackResult> {
      if (token !== generation) return { state, generation };
      release("replaced");
      emit("buffering");
      const url = io.createObjectURL(input);
      const audio = new io.Audio(url);
      current = { url, audio, generation: token };
      audio.onended = () => finish(token, "completed", url);
      audio.onerror = () => finish(token, "failed", url);
      audio.onstalled = () => finish(token, "stalled", url);
      audio.onabort = () => finish(token, "failed", url);
      try {
        await audio.play();
        if (token !== generation || current?.generation !== token) {
          return { state, generation };
        }
        emit("playing");
        return { state: "playing", generation: token };
      } catch {
        finish(token, "failed", url);
        return { state: "failed", generation: token, errorCode: "TTS_PLAY_REJECTED" };
      }
    },
    async stop(reason: PlaybackStopReason): Promise<void> {
      generation += 1;
      emit("stopping");
      release(reason);
      emit("idle");
    },
    getState(): PlaybackState {
      return state;
    },
    getGeneration(): number {
      return generation;
    },
    subscribe(listener: (next: PlaybackState) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type AudioPlaybackController = ReturnType<typeof createAudioPlaybackController>;
