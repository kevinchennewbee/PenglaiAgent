import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, cpSync, copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { ROOT } from "./lib/repo.mjs";

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
  readFileSync(join(ROOT, "docs/0.5.10/DSH_ALPHA_PACKAGED_BYTES.json"), "utf8"),
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
  JSON.stringify({ name: "penglai", version: "0.5.10", type: "module", main: "electron-main.js" }, null, 2),
);
console.log("bundle-desktop", outDir);
