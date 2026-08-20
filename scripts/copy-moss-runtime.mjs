import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// tsc compiles only .ts files, so the MOSS-TTS Node runtime (a non-TS .mjs)
// and its license never land in packages/moss-tts/dist. Copy them so the
// workspace `dist` build is importable without the pack-plugins staging step.
const src = join(process.cwd(), "packages/moss-tts/src/third_party/moss_tts");
const dest = join(process.cwd(), "packages/moss-tts/dist/third_party/moss_tts");
mkdirSync(dest, { recursive: true });
cpSync(join(src, "runtime.mjs"), join(dest, "runtime.mjs"));
cpSync(join(src, "LICENSE"), join(dest, "LICENSE"));
console.log("copied moss-tts runtime into dist");
