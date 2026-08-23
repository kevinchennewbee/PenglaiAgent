import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import {
  downloadHttps,
  extractArchive,
  findExtractedBinary,
  parseFetchArgs,
  publishArchive,
  publishBinary,
  selectAssets,
  sha256File,
  mnemonReleaseUrl,
} from "./lib/mnemon-fetch.mjs";

const destRoot = join(ROOT, "third_party", "mnemon");

let parsed;
try {
  parsed = parseFetchArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
}

const wanted = selectAssets(parsed);
mkdirSync(join(destRoot, "cache"), { recursive: true, mode: 0o755 });

const fetched = [];
for (const asset of wanted) {
  const url = mnemonReleaseUrl(asset.archiveFilename);
  const archive = join(destRoot, "cache", asset.archiveFilename);
  if (!existsSync(archive) || sha256File(archive) !== asset.archiveSha256 || statSync(archive).size !== asset.archiveBytes) {
    const stage = mkdtempSync(join(tmpdir(), "penglai-mnemon-dl-"));
    try {
      const staged = join(stage, asset.archiveFilename);
      await downloadHttps(url, staged);
      publishArchive(staged, archive, asset);
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }
  const extract = mkdtempSync(join(tmpdir(), `penglai-mnemon-x-${asset.target}-`));
  try {
    extractArchive(archive, extract, asset);
    const unpacked = findExtractedBinary(extract, asset.binaryFilename);
    const dest = join(destRoot, "bin", asset.target, asset.binaryFilename);
    publishBinary(unpacked, dest, asset);
    fetched.push({ target: asset.target, binarySha256: asset.binarySha256 });
  } catch (error) {
    rmSync(join(destRoot, "bin", asset.target), { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(extract, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({ command: "fetch-mnemon-assets", fetched }));
