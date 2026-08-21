import { createHash } from "node:crypto";
import { ROOT } from "./lib/repo.mjs";
import { PRODUCT_VERSION } from "./lib/product.mjs";
import { finish } from "./lib/exit-contract.mjs";

const repo = "kevinchennewbee/PenglaiAgent";
const tag = process.argv[2] || `v${PRODUCT_VERSION}`;
const api = `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
const response = await fetch(api, { redirect: "manual" });
if (response.status !== 200) {
  finish("INCOMPLETE", { command: "readback-release", reason: `GitHub ${response.status}`, tag });
}
const release = await response.json();
const assets = Array.isArray(release.assets) ? release.assets : [];
const rows = [];
for (const asset of assets) {
  const body = await fetch(asset.browser_download_url, { redirect: "manual" });
  if (body.status !== 200) {
    finish("FAIL", { command: "readback-release", reason: `asset ${asset.name} ${body.status}` });
  }
  const bytes = Buffer.from(await body.arrayBuffer());
  rows.push({
    name: asset.name,
    size: bytes.length,
    declared: asset.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
finish("PASS", { command: "readback-release", cwd: ROOT, tag, assets: rows });
