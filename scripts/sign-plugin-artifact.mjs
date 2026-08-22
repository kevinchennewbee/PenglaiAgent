import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/repo.mjs";

const keys = join(
  homedir(),
  "Library",
  "Application Support",
  "PenglaiReleaseKeys",
  "plugin-catalog-ed25519-private.pem",
);
const artifactPath = process.argv[2];
if (!artifactPath || !artifactPath.endsWith(".tgz")) {
  console.error("usage: node scripts/sign-plugin-artifact.mjs <plugin.tgz>");
  process.exit(2);
}
const { privateKeyFromPem, signBytes } = await import(
  pathToFileURL(join(ROOT, "packages/plugin-registry/src/signature.ts")).href
);
const signature = signBytes(
  readFileSync(artifactPath),
  privateKeyFromPem(readFileSync(keys, "utf8")),
);
writeFileSync(`${artifactPath}.sig`, signature);
console.log(`wrote ${artifactPath}.sig`);
