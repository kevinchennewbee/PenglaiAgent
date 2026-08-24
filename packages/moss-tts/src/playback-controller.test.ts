import assert from "node:assert/strict";
import test from "node:test";
import { createAudioPlaybackController, type PlaybackAudio } from "./playback-controller.js";

function fakeIo(play: () => Promise<void> = async () => undefined) {
  const revoked: string[] = [];
  const audios: PlaybackAudio[] = [];
  const io = {
    Audio: class {
      src: string;
      onended: PlaybackAudio["onended"] = null;
      onerror: PlaybackAudio["onerror"] = null;
      onstalled: PlaybackAudio["onstalled"] = null;
      onabort: PlaybackAudio["onabort"] = null;
      constructor(src: string) {
        this.src = src;
        audios.push(this);
      }
      play() {
        return play();
      }
      pause() {}
    },
    createObjectURL() {
      return "blob:penglai-tts";
    },
    revokeObjectURL(url: string) {
      revoked.push(url);
    },
  };
  return { io, revoked, audios };
}

test("R56-VOICE preview and read share one controller generation", async () => {
  const { io, revoked, audios } = fakeIo();
  const player = createAudioPlaybackController(io);
  const first = player.beginSynthesize();
  await player.play(new Blob(["a"]), first);
  assert.equal(player.getState(), "playing");
  const second = player.beginSynthesize();
  await player.play(new Blob(["b"]), second);
  assert.equal(revoked.length >= 1, true);
  audios.at(-1)?.onended?.(undefined);
  assert.equal(player.getState(), "idle");
});

test("R56-VOICE play rejection becomes failed and revokes the object URL", async () => {
  const { io, revoked } = fakeIo(async () => {
    throw new Error("autoplay");
  });
  const player = createAudioPlaybackController(io);
  const token = player.beginSynthesize();
  const result = await player.play(new Blob(["x"]), token);
  assert.equal(result.state, "failed");
  assert.equal(result.errorCode, "TTS_PLAY_REJECTED");
  assert.deepEqual(revoked, ["blob:penglai-tts"]);
  assert.equal(player.getState(), "idle");
});

test("R56-VOICE stale ended events cannot overwrite a newer generation", async () => {
  const { io, audios } = fakeIo();
  const player = createAudioPlaybackController(io);
  const first = player.beginSynthesize();
  await player.play(new Blob(["a"]), first);
  const stale = audios[0];
  const second = player.beginSynthesize();
  await player.play(new Blob(["b"]), second);
  stale?.onended?.(undefined);
  assert.equal(player.getState(), "playing");
});
