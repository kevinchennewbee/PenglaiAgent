import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const origins = ["https://penglai.pages.dev/", "https://kevinchennewbee.github.io/PenglaiAgent/"];
const index = process.argv.indexOf("--directory");
const directory = resolve(index < 0 ? "website" : process.argv[index + 1]);
const releaseSha = process.env.RELEASE_SHA;
if (!/^[0-9a-f]{40}$/.test(releaseSha ?? "")) throw new Error("RELEASE_SHA must be the verified release commit");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function walk(path = "") {
  return readdirSync(join(directory, path), { withFileTypes: true }).flatMap((entry) => {
    const name = path ? `${path}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`website symlink refused: ${name}`);
    if (entry.isDirectory()) return walk(name);
    if (!entry.isFile()) throw new Error(`website special file refused: ${name}`);
    return [{ name, sha256: digest(readFileSync(join(directory, name))) }];
  });
}
const files = walk().sort((a, b) => a.name.localeCompare(b.name));
for (const name of ["index.html", "en/index.html"]) {
  const html = readFileSync(join(directory, name), "utf8");
  if (!html.includes(releaseSha) || !html.includes("Penglai 0.5.10")) throw new Error(`${name} is not release-linked`);
}
const record = { command: "readback-website", verdict: "FAIL", releaseSha, siteSourceSha: process.env.GITHUB_SHA ?? null, origins: [] };
const output = resolve("evidence/generated/website-public-readback.json");
mkdirSync(resolve("evidence/generated"), { recursive: true });
const deadline = Date.now() + 8 * 60_000;
try {
  for (const origin of origins) {
    const result = { origin, verdict: "FAIL", files: [] };
    record.origins.push(result);
    let pending = files;
    // Retry CDN propagation; a timeout or mismatch always remains a failure.
    for (let attempt = 1; pending.length && attempt <= 20; attempt += 1) {
      const retry = [];
      for (const file of pending) {
        if (Date.now() >= deadline) throw new Error("public website verification deadline exceeded");
        const url = new URL(file.name.replace(/(^|\/)index\.html$/, "$1"), origin);
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "Cache-Control": "no-cache" } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          if (new URL(response.url).origin !== new URL(origin).origin) throw new Error("cross-origin redirect refused");
          const bytes = Buffer.from(await response.arrayBuffer());
          if (digest(bytes) !== file.sha256) throw new Error("public SHA-256 mismatch");
          result.files.push({ ...file, size: bytes.length, url: url.href });
        } catch (error) {
          retry.push(file);
          console.error(`${origin}${file.name}: ${error.message}`);
        }
      }
      pending = retry;
      if (pending.length && attempt < 20) await delay(15_000);
    }
    if (pending.length) throw new Error(`${origin} did not converge: ${pending.map((file) => file.name).join(", ")}`);
    result.verdict = "PASS";
    console.log(`${origin}: ${result.files.length} public files match the sealed website`);
  }
  record.verdict = "PASS";
} catch (error) {
  record.reason = error.message;
  process.exitCode = 1;
} finally {
  writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ verdict: record.verdict, releaseSha, reason: record.reason, output }));
}
