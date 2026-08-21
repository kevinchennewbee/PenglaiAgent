import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/repo.mjs";

const keys = join(homedir(), "Library", "Application Support", "PenglaiReleaseKeys", "updater-ed25519-private.pem");
const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error("usage: node scripts/sign-update-manifest.mjs <update-manifest-v1.json>");
  process.exit(2);
}
const { privateKeyFromPem, signBytes } = await import(
  pathToFileURL(join(ROOT, "packages/plugin-registry/src/index.ts")).href
);
const bytes = readFileSync(jsonPath);
const signature = signBytes(bytes, privateKeyFromPem(readFileSync(keys, "utf8")));
writeFileSync(`${jsonPath}.sig`, signature);
console.log(`wrote ${jsonPath}.sig`);
