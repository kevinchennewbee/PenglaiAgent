import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, cpSync, copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { ROOT } from "./lib/repo.mjs";

const tsc = spawnSync(
  process.execPath,
  [join(ROOT, "node_modules/typescript/bin/tsc"), "-b", "--pretty", "false", "--force"],
  { cwd: ROOT, stdio: "inherit" },
);
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

const outDir = join(ROOT, "dist/desktop-bundle");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  absWorkingDir: ROOT,
  entryPoints: [join(ROOT, "apps/desktop/src/electron-main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: join(outDir, "electron-main.js"),
  external: ["electron"],
  sourcemap: false,
  logLevel: "info",
});

await build({
  absWorkingDir: ROOT,
  entryPoints: [join(ROOT, "apps/desktop/src/preload-bridge.ts")],
  bundle: true,
  platform: "node",
  // Sandboxed Electron preload scripts are loaded with require(), so they must be
  // CommonJS even though the app package.json declares "type": "module".
  format: "cjs",
  target: "node22",
  outfile: join(outDir, "preload-bridge.cjs"),
  external: ["electron"],
  sourcemap: false,
  logLevel: "info",
});

const staticSrc = join(ROOT, "apps/desktop/static");
if (existsSync(staticSrc)) cpSync(staticSrc, join(outDir, "static"), { recursive: true });
const packagedBytes = JSON.parse(
  readFileSync(join(ROOT, "docs/0.6.1/DSH_PACKAGED_BYTES.json"), "utf8"),
);
const brandDest = join(outDir, "static", "penglai-brand");
mkdirSync(brandDest, { recursive: true });
for (const asset of packagedBytes.brandAssets ?? []) {
  const source = join(ROOT, asset.source);
  const bytes = readFileSync(source);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== asset.sha256) throw new Error(`Penglai brand asset drift ${asset.name}`);
  copyFileSync(source, join(brandDest, asset.name));
}
writeFileSync(
  join(outDir, "package.json"),
  JSON.stringify({ name: "penglai", version: "0.6.1", type: "module", main: "electron-main.js" }, null, 2),
);
const bundledMain = readFileSync(join(outDir, "electron-main.js"), "utf8");
if (
  !bundledMain.includes(".dsh-module-fallback") ||
  !bundledMain.includes('startsWith("profiles/node_modules/")')
) {
  console.error(
    "bundle-desktop refused: packaged DSH home skip is stale; @penglai/runtime dist was not rebuilt into electron-main.js",
  );
  process.exit(1);
}
console.log("bundle-desktop", outDir);
