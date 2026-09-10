import { cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { PRODUCT_VERSION, RELEASE_TARGETS } from "./lib/product.mjs";

function walkFiles(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(path, output);
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

const nativeRoot = join(ROOT, ".native");
const dist = join(ROOT, "dist");
mkdirSync(dist, { recursive: true });
const collected = [];
for (const target of RELEASE_TARGETS) {
  const targetRoot = join(nativeRoot, target.key);
  let files = [];
  try {
    files = walkFiles(targetRoot);
  } catch {
    throw new Error(`native artifact tree missing for ${target.key}`);
  }
  const matches = files.filter((path) => path.endsWith(target.installer) && statSync(path).size > 0);
  if (matches.length !== 1) {
    throw new Error(`native ${target.key} installer ${target.installer} not found uniquely under .native/${target.key}`);
  }
  const dest = join(dist, target.installer);
  cpSync(matches[0], dest);
  collected.push({ target: target.key, installer: target.installer, source: matches[0], dest });
}
console.log(JSON.stringify({
  verdict: "PASS",
  command: "collect-native-installers",
  productVersion: PRODUCT_VERSION,
  collected,
}, null, 2));
