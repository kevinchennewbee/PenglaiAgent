import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyInlineTransform } from "./apply-overlay.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAP_PATH = "docs/0.5.8/OVERLAY_TO_SLOT_MAP.json";
const SOURCE_TAG = "dsh-v0.1.2-alpha.1";
const SOURCE_COMMIT = "cd5ef8148158c3a752a658978873241fdf8e2bbc";
const SOURCE_TREE = "a712eec535b48badc4fefb4df5176a7002e4280b";
const LEGACY_DSH = "0.1.1-rc.2";
const LEGACY_MANIFEST = "overlays/dsh-0.1.1-rc.2/manifest.json";
const LEGACY_MANIFEST_SHA256 = "2ba11dd377bf127e4d9be6cbd5cc8a069b1a4ee10c64f5c5f067932721e72be3";
const EXPECTED_STATES = [
  "DROP_NON_SEMANTIC",
  "SOURCE_READY",
  "SOURCE_ROUTE_FOUND_PACKAGE_BUILD_REQUIRED",
  "SOURCE_ROUTE_FOUND_PACKAGE_API_REQUIRED",
  "PENGLAI_COMPOSITE_DESIGN_READY",
  "UPSTREAM_GAP",
];
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relative) {
  return readFileSync(join(ROOT, relative));
}

function readJson(relative) {
  return JSON.parse(read(relative).toString("utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sameSet(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

const map = readJson(MAP_PATH);
if (map.schema !== 1) fail(`overlay map schema is ${map.schema}, expected 1`);
if (map.sourceBaseline?.tag !== SOURCE_TAG) fail("overlay map source tag drifted");
if (map.sourceBaseline?.commit !== SOURCE_COMMIT) fail("overlay map source commit drifted");
if (map.sourceBaseline?.tree !== SOURCE_TREE) fail("overlay map source tree drifted");

const manifestPath = map.legacyOverlay?.manifest;
if (manifestPath !== LEGACY_MANIFEST) fail("overlay map manifest path drifted");
const manifestBytes = typeof manifestPath === "string" ? read(manifestPath) : Buffer.alloc(0);
if (map.legacyOverlay?.manifestSha256 !== LEGACY_MANIFEST_SHA256
  || sha256(manifestBytes) !== LEGACY_MANIFEST_SHA256) {
  fail("legacy overlay manifest digest drifted");
}
const manifest = JSON.parse(manifestBytes.toString("utf8"));
if (manifest.dsh !== LEGACY_DSH || map.legacyOverlay?.dsh !== LEGACY_DSH) {
  fail("legacy overlay DSH identity drifted");
}

const manifestIds = (manifest.files ?? []).map((row) => row.id);
if (!sameSet(manifestIds, map.legacyOverlay?.fileIds ?? [])) {
  fail("legacy overlay file-id inventory drifted");
}
const manifestBrand = (manifest.brand ?? []).map((row) => row.name);
if (!sameSet(manifestBrand, map.legacyOverlay?.brandAssets ?? [])) {
  fail("legacy overlay brand-asset inventory drifted");
}
for (const asset of manifest.brand ?? []) {
  const bytes = read(join("overlays/dsh-0.1.1-rc.2/brand", asset.name));
  if (sha256(bytes) !== asset.sha256) fail(`legacy brand asset ${asset.name} digest drifted`);
}

const artifacts = new Map();
for (const file of manifest.files ?? []) {
  const upstream = read(join("overlays/dsh-0.1.1-rc.2", file.upstream));
  const patched = file.transform
    ? applyInlineTransform(upstream, file.transform)
    : read(join("overlays/dsh-0.1.1-rc.2", file.patched));
  if (sha256(upstream) !== file.upstreamSha256) fail(`${file.id} upstream digest drifted`);
  if (sha256(patched) !== file.patchedSha256) fail(`${file.id} patched digest drifted`);
  artifacts.set(file.id, {
    upstream: upstream.toString("utf8"),
    patched: patched.toString("utf8"),
  });
}

if (!sameSet(map.allowedStates ?? [], EXPECTED_STATES)) fail("overlay disposition vocabulary drifted");
const allowedStates = new Set(EXPECTED_STATES);
const seenItems = new Set();
const coveredFiles = new Set();
const coveredBrand = new Set();
for (const item of map.items ?? []) {
  if (typeof item.id !== "string" || !/^O058-\d{3}$/.test(item.id)) {
    fail(`invalid overlay item id ${JSON.stringify(item.id)}`);
    continue;
  }
  if (seenItems.has(item.id)) fail(`duplicate overlay item ${item.id}`);
  seenItems.add(item.id);
  if (!allowedStates.has(item.state)) fail(`${item.id} has unknown state ${item.state}`);
  for (const field of ["requirement", "officialRoute", "actionNow", "packageGate", "carryForward"]) {
    if (typeof item[field] !== "string" || item[field].trim() === "") {
      fail(`${item.id} is missing ${field}`);
    }
  }
  for (const source of item.alphaSource ?? []) {
    if (typeof source.path !== "string" || source.path.startsWith("/") || source.path.includes("..")) {
      fail(`${item.id} has non-portable alpha source path ${JSON.stringify(source.path)}`);
    }
    if (!/^[0-9a-f]{64}$/.test(source.sha256 ?? "")) {
      fail(`${item.id} alpha source ${source.path ?? "unknown"} lacks a SHA-256 binding`);
    }
    if (!Array.isArray(source.symbols) || source.symbols.length === 0) {
      fail(`${item.id} alpha source ${source.path ?? "unknown"} has no reviewed symbol`);
    }
  }
  const legacy = item.legacy ?? {};
  for (const fileId of legacy.fileIds ?? []) {
    const artifact = artifacts.get(fileId);
    if (!artifact) {
      fail(`${item.id} refers to unknown legacy file ${fileId}`);
      continue;
    }
    coveredFiles.add(fileId);
    for (const needle of legacy.patchedContains ?? []) {
      if (!artifact.patched.includes(needle)) fail(`${item.id} patched artifact ${fileId} lost ${needle}`);
    }
    for (const needle of legacy.upstreamContains ?? []) {
      if (!artifact.upstream.includes(needle)) fail(`${item.id} upstream artifact ${fileId} lost ${needle}`);
    }
    for (const needle of legacy.patchedOmits ?? []) {
      if (artifact.patched.includes(needle)) fail(`${item.id} patched artifact ${fileId} unexpectedly contains ${needle}`);
    }
  }
  for (const name of legacy.brandAssets ?? []) {
    if (!manifestBrand.includes(name)) fail(`${item.id} refers to unknown brand asset ${name}`);
    coveredBrand.add(name);
  }
}

if (!sameSet(coveredFiles, manifestIds)) fail("not every legacy overlay file has a mapped disposition");
if (!sameSet(coveredBrand, manifestBrand)) fail("not every legacy brand asset has a mapped disposition");
if (seenItems.size !== 12) fail(`overlay item count is ${seenItems.size}, expected 12`);

if (failures.length > 0) {
  console.error(JSON.stringify({
    schema: 1,
    gate: "Penglai-0.5.8-overlay-map",
    result: "FAIL",
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema: 1,
  gate: "Penglai-0.5.8-overlay-map",
  result: "PASS",
  sourceBaseline: map.sourceBaseline,
  legacyOverlay: map.legacyOverlay.dsh,
  mappedItems: seenItems.size,
  mappedFiles: coveredFiles.size,
  mappedBrandAssets: coveredBrand.size,
  upstreamGaps: map.items.filter((item) => item.state === "UPSTREAM_GAP").map((item) => item.id),
}, null, 2));
