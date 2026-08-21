import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/repo.mjs";

const keys = join(homedir(), "Library", "Application Support", "PenglaiReleaseKeys", "plugin-catalog-ed25519-private.pem");
const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error("usage: node scripts/sign-catalog.mjs <catalog.json>");
  process.exit(2);
}
const { canonicalizeBytes, privateKeyFromPem, signBytes } = await import(
  pathToFileURL(join(ROOT, "packages/plugin-registry/src/index.ts")).href
);
const json = JSON.parse(readFileSync(jsonPath, "utf8"));
const signature = signBytes(canonicalizeBytes(json), privateKeyFromPem(readFileSync(keys, "utf8")));
writeFileSync(`${jsonPath}.sig`, signature);
console.log(`wrote ${jsonPath}.sig`);
