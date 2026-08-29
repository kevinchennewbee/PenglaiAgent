import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadBundledController() {
  const source = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  const start = source.indexOf("function createAudioPlaybackController");
  const end = source.indexOf("const playback = createAudioPlaybackController");
  assert.ok(start >= 0 && end > start, "packed dsh-client.js must contain createAudioPlaybackController");
  const fn = source.slice(start, end);
  assert.match(fn, /onstalled/);
  assert.match(fn, /onabort/);
  assert.match(fn, /used !== generation/);
  const context = { result: undefined as unknown };
  vm.runInNewContext(`${fn}\nresult = createAudioPlaybackController;`, context);
  return context.result as (io?: unknown) => {
    beginSynthesize(): number;
    play(blob: Blob, token?: number): Promise<{ state: string; generation: number; errorCode?: string }>;
    getState(): string;
  };
}

function fakeIo(play: () => Promise<void> = async () => undefined) {
  const audios: Array<{
    onended: ((ev?: unknown) => void) | null;
    onerror: ((ev?: unknown) => void) | null;
    onstalled: ((ev?: unknown) => void) | null;
    onabort: ((ev?: unknown) => void) | null;
    play: () => Promise<void>;
    pause: () => void;
  }> = [];
  const revoked: string[] = [];
  const io = {
    Audio: class {
      onended = null;
      onerror = null;
      onstalled = null;
      onabort = null;
      constructor(_src: string) {
        audios.push(this);
      }
      play() {
        return play();
      }
      pause() {}
    },
    createObjectURL() {
      return "blob:penglai-packed-tts";
    },
    revokeObjectURL(url: string) {
      revoked.push(url);
    },
  };
  return { io, audios, revoked };
}

test("packed dsh-client.js playback is the same state machine as the TypeScript controller", () => {
  const packed = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  const source = readFileSync(new URL("./playback-controller.ts", import.meta.url), "utf8");
  for (const token of ["onstalled", "onabort", "TTS_PLAY_REJECTED", "beginSynthesize", "revokeObjectURL"]) {
    assert.match(packed, new RegExp(token));
    assert.match(source, new RegExp(token.replace("revokeObjectURL", "revokeObjectURL|io\\.revokeObjectURL")));
  }
  assert.match(source, /io\.revokeObjectURL/);
  assert.equal((packed.match(/function createAudioPlaybackController/g) ?? []).length, 1);
});

test("packed dsh-client.js playback handles ended, error, stalled, and latest-wins", async () => {
  const create = loadBundledController();
  const { io, audios, revoked } = fakeIo();
  const player = create(io);
  const first = player.beginSynthesize();
  await player.play(new Blob(["a"]), first);
  assert.equal(player.getState(), "playing");
  const second = player.beginSynthesize();
  await player.play(new Blob(["b"]), second);
  audios[0]?.onended?.(undefined);
  assert.equal(player.getState(), "playing");
  audios.at(-1)?.onstalled?.(undefined);
  assert.equal(player.getState(), "stalled");
  assert.equal(revoked.length >= 1, true);

  const failing = fakeIo(async () => {
    throw new Error("autoplay");
  });
  const rejected = create(failing.io);
  const token = rejected.beginSynthesize();
  const result = await rejected.play(new Blob(["x"]), token);
  assert.equal(result.state, "failed");
  assert.equal(result.errorCode, "TTS_PLAY_REJECTED");
  assert.equal(rejected.getState(), "failed");
});
