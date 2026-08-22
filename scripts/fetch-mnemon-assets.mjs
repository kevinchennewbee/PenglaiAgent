import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";
import { MNEMON_ASSETS } from "../packages/memory/src/engine/mnemon-provider.ts";

const destRoot = join(ROOT, "third_party", "mnemon");
const only = process.argv.includes("--host-only");
const host =
  process.platform === "darwin"
    ? process.arch === "arm64"
      ? "darwin-aarch64"
      : "darwin-x86_64"
    : process.platform === "win32"
      ? "win32-x86_64"
      : null;
const wanted = MNEMON_ASSETS.filter((asset) => (only ? asset.target === host : true));

mkdirSync(join(destRoot, "cache"), { recursive: true });
mkdirSync(join(ROOT, "evidence/generated"), { recursive: true });

for (const asset of wanted) {
  const url = `https://github.com/mnemon-dev/mnemon/releases/download/v0.2.4/${asset.filename}`;
  const archive = join(destRoot, "cache", asset.filename);
  if (!existsSync(archive)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed ${url} ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(archive));
  }
  const sha = createHash("sha256").update(readFileSync(archive)).digest("hex");
  if (sha !== asset.sha256) throw new Error(`checksum mismatch ${asset.filename} ${sha}`);
  const binDir = join(destRoot, "bin", asset.target);
  mkdirSync(binDir, { recursive: true });
  const extract = join(tmpdir(), `mnemon-${asset.target}`);
  mkdirSync(extract, { recursive: true });
  if (asset.filename.endsWith(".zip")) {
    execFileSync("unzip", ["-o", archive, "-d", extract]);
  } else {
    execFileSync("tar", ["-xzf", archive, "-C", extract]);
  }
  const unpacked = execFileSync("find", [extract, "-name", asset.binary], { encoding: "utf8" })
    .split("\n")
    .find(Boolean);
  if (!unpacked) throw new Error(`binary ${asset.binary} missing from ${asset.filename}`);
  execFileSync("cp", [unpacked, join(binDir, asset.binary)]);
  chmodSync(join(binDir, asset.binary), 0o755);
}

console.log(
  JSON.stringify({
    command: "fetch-mnemon-assets",
    fetched: wanted.map((row) => row.target),
  }),
);
