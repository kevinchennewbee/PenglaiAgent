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
// Import the leaf module directly. Importing src/index.ts makes Node resolve the
// index's emitted .js specifiers from inside src/, which does not exist in a
// source checkout even when tsx is registered.
const { privateKeyFromPem, signBytes } = await import(
  pathToFileURL(join(ROOT, "packages/plugin-registry/src/signature.ts")).href
);
const bytes = readFileSync(jsonPath);
const signature = signBytes(bytes, privateKeyFromPem(readFileSync(keys, "utf8")));
writeFileSync(`${jsonPath}.sig`, signature);
console.log(`wrote ${jsonPath}.sig`);
