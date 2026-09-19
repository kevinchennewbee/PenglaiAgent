import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";
import { PRODUCT_VERSION } from "./lib/product.mjs";
import { inspectPackagedCandidate } from "./lib/packaged-candidate.mjs";

/**
 * Copy the packaged application back out of a collected installer, on a host that
 * received the installer but did not build it.
 *
 * The native evidence emitter inspects `dist/Penglai-v<version>-arm64-from-dmg/
 * Penglai.app` — the name records that the app must come from the mounted
 * installer, not from a staging tree or a rebuilt bundle. The macOS build job
 * does this after it creates the DMG. The aggregate job runs on macOS too and
 * collects only the installer, so without this the emitter's three guards can
 * never pass and the registered assertions stay unemitted:
 *
 *   "exact from-DMG Penglai.app missing"
 *
 * Mounting rather than uploading the app tree is deliberate: a `.app` carries
 * framework symlinks, and `codesign --verify --deep --strict` is checked below so
 * a payload that lost them fails here instead of silently qualifying.
 */
const targetIndex = process.argv.indexOf("--target");
const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : process.env.PENGLAI_DMG_TARGET;
const SPECS = {
  "darwin-arm64": {
    dmg: `dist/Penglai_${PRODUCT_VERSION}_macos_aarch64.dmg`,
    from: `dist/Penglai-v${PRODUCT_VERSION}-arm64-from-dmg`,
    expectedTarget: "darwin-aarch64",
  },
};
if (!target || !SPECS[target]) {
  throw new Error("collect-dmg-payload requires --target darwin-arm64");
}
const spec = SPECS[target];
const dmgPath = join(ROOT, spec.dmg);
if (!existsSync(dmgPath)) {
  throw new Error(`collected installer missing: ${spec.dmg}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr ?? "").trim()}`);
  }
  return result;
}

const mountRoot = mkdtempSync(join(tmpdir(), "penglai-dmg-collect-"));
let copied;
try {
  run("hdiutil", ["attach", dmgPath, "-readonly", "-nobrowse", "-mountpoint", mountRoot]);
  if (!existsSync(join(mountRoot, "Penglai.app/Contents/Info.plist"))) {
    throw new Error("mounted DMG missing Penglai.app");
  }
  if (!lstatSync(join(mountRoot, "Applications")).isSymbolicLink()) {
    throw new Error("mounted DMG missing Applications symlink");
  }
  if (!existsSync(join(mountRoot, ".background", "background.png"))) {
    throw new Error("mounted DMG missing branded background");
  }
  run("codesign", ["--verify", "--deep", "--strict", join(mountRoot, "Penglai.app")]);
  copied = join(ROOT, spec.from, "Penglai.app");
  rmSync(join(ROOT, spec.from), { recursive: true, force: true });
  mkdirSync(join(ROOT, spec.from), { recursive: true });
  // ditto preserves the framework symlinks and extended attributes a plain copy
  // drops, which is what the deep signature verification depends on.
  run("ditto", [join(mountRoot, "Penglai.app"), copied]);
  run("codesign", ["--verify", "--deep", "--strict", copied]);
} finally {
  spawnSync("hdiutil", ["detach", mountRoot, "-force"], { stdio: "ignore" });
  rmSync(mountRoot, { recursive: true, force: true });
}

const packaged = inspectPackagedCandidate({
  app: copied,
  candidateSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  expectedTarget: spec.expectedTarget,
});
if (packaged.verdict !== "PASS") {
  throw new Error(`collected DMG payload is not the exact from-DMG app: ${packaged.verdict} ${packaged.reason}`);
}
console.log(
  JSON.stringify(
    {
      verdict: "PASS",
      command: "collect-dmg-payload",
      target: spec.expectedTarget,
      installer: spec.dmg,
      app: copied,
      sourceSha: packaged.release.sourceSha,
    },
    null,
    2,
  ),
);
