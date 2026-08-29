#!/usr/bin/env node

import { basename, join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { ROOT } from "./lib/repo.mjs";

const MAP_PATH = "docs/0.5.8/VERIFIER_EVIDENCE_MAP.json";
const CENSUS = /^(?:verify-[^/]+\.(?:mjs|ts|ps1)|probe-[^/]+\.mjs|evidence-[^/]+\.mjs|e2e-installed[^/]*\.mjs|soak-[^/]+\.mjs|package-[^/]+\.mjs|build-local-dmg\.mjs|build-windows-host\.mjs|assemble-release\.mjs|readback-release\.mjs|prepare-public-export\.mjs|write-evidence\.mjs)$/;
const PLANES = new Set([
  "source",
  "package",
  "native",
  "installed",
  "owner-live",
  "public-byte",
  "aggregate",
  "historical",
]);
const POLICIES = new Set([
  "allowed-source",
  "blocked-native",
  "blocked-owner-live",
  "blocked-publication",
  "preserved-only",
]);
const INVOCATIONS = new Set([
  "package-script",
  "composed-script",
  "workflow",
  "internal-script",
  "manual",
  "historical",
]);

function fail(message) {
  process.stderr.write(`P058_EVIDENCE_MAP_FAIL ${message}\n`);
  process.exit(1);
}

function read(relative) {
  return readFileSync(join(ROOT, relative), "utf8");
}

const map = JSON.parse(read(MAP_PATH));
if (map.schema !== 1) fail("map schema must be 1");
if (!Array.isArray(map.entries)) fail("map entries are missing");

const rows = map.entries.map((entry, index) => {
  if (!Array.isArray(entry) || entry.length !== 5)
    fail(`entry ${index} does not match the five-column schema`);
  const [path, evidencePlane, previewPolicy, invocationKind, invocation] = entry;
  if (typeof path !== "string" || !path.startsWith("scripts/"))
    fail(`entry ${index} path is invalid`);
  if (!PLANES.has(evidencePlane)) fail(`${path} has unknown evidence plane ${evidencePlane}`);
  if (!POLICIES.has(previewPolicy)) fail(`${path} has unknown preview policy ${previewPolicy}`);
  if (!INVOCATIONS.has(invocationKind)) fail(`${path} has unknown invocation kind ${invocationKind}`);
  if (typeof invocation !== "string" || !invocation.trim()) fail(`${path} invocation is empty`);
  return { path, evidencePlane, previewPolicy, invocationKind, invocation };
});

const paths = rows.map((row) => row.path);
if (new Set(paths).size !== paths.length) fail("map contains duplicate script paths");
const sortedPaths = [...paths].sort();
if (JSON.stringify(paths) !== JSON.stringify(sortedPaths)) fail("map paths must stay sorted");

const census = readdirSync(join(ROOT, "scripts"))
  .filter((name) => CENSUS.test(name))
  .map((name) => `scripts/${name}`)
  .sort();
const missing = census.filter((path) => !paths.includes(path));
const stale = paths.filter((path) => !census.includes(path));
if (missing.length || stale.length)
  fail(`census drift missing=${missing.join(",") || "none"} stale=${stale.join(",") || "none"}`);

const manifest = JSON.parse(read("package.json"));
const packageScripts = manifest.scripts ?? {};
for (const row of rows) {
  const scriptName = basename(row.path);
  if (row.invocationKind === "package-script") {
    const command = packageScripts[row.invocation];
    if (typeof command !== "string" || !command.includes(scriptName))
      fail(`${row.path} is not invoked by package script ${row.invocation}`);
  } else if (["composed-script", "workflow", "internal-script"].includes(row.invocationKind)) {
    if (!read(row.invocation).includes(scriptName))
      fail(`${row.path} is not referenced by ${row.invocation}`);
  } else if (row.invocationKind === "historical") {
    const activeText = [read("package.json"), read(".github/workflows/source-ci.yml"), read(".github/workflows/native-release-candidate.yml")].join("\n");
    if (activeText.includes(scriptName)) fail(`${row.path} is marked historical but has an active invocation`);
  }

  if (row.previewPolicy === "preserved-only" && row.evidencePlane !== "historical")
    fail(`${row.path} is preserved-only without historical evidence class`);
  if (row.previewPolicy === "blocked-owner-live" && row.evidencePlane !== "owner-live")
    fail(`${row.path} owner-live policy does not match its evidence plane`);
  if (row.previewPolicy === "allowed-source" && ["native", "installed", "owner-live", "public-byte", "historical"].includes(row.evidencePlane))
    fail(`${row.path} cannot run as source evidence for ${row.evidencePlane}`);
}

const byPlane = Object.fromEntries(
  [...PLANES].map((plane) => [plane, rows.filter((row) => row.evidencePlane === plane).length]),
);
process.stdout.write(
  `${JSON.stringify({ verdict: "PASS", command: "verify:058-evidence-map", scripts: rows.length, byPlane })}\n`,
);
