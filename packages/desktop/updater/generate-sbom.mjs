#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import {
  REPO_ROOT,
  assertRepositoryVersions,
  loadReleaseContract,
  readJson,
} from "./release-contract.mjs";

function parseArgs() {
  const args = { out: null };
  for (let index = 2; index < process.argv.length; index++) {
    const value = process.argv[index];
    if (value === "--out") args.out = path.resolve(process.argv[++index]);
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!args.out) throw new Error("--out is required");
  return args;
}

function npmName(lockPath, entry) {
  if (entry.name) return entry.name;
  const marker = "node_modules/";
  const index = lockPath.lastIndexOf(marker);
  if (index < 0) return null;
  return lockPath.slice(index + marker.length);
}

function licenses(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .map((license) => (typeof license === "string" ? license : license?.type))
    .filter(Boolean)
    .map((id) => ({ license: { id } }));
}

function npmComponents(lock) {
  const components = [];
  for (const [lockPath, entry] of Object.entries(lock.packages ?? {})) {
    if (!lockPath || entry.dev === true || entry.link === true || !entry.version) continue;
    const name = npmName(lockPath, entry);
    if (!name) continue;
    const component = {
      type: "library",
      "bom-ref": `npm:${name}@${entry.version}:${lockPath}`,
      group: name.startsWith("@") ? name.split("/")[0].slice(1) : undefined,
      name: name.startsWith("@") ? name.split("/").slice(1).join("/") : name,
      version: entry.version,
      scope: entry.optional === true ? "optional" : "required",
      licenses: licenses(entry.license ?? entry.licenses),
      properties: [
        { name: "penglai:source", value: "package-lock.json" },
        { name: "penglai:lock-path", value: lockPath },
      ],
    };
    if (component.licenses.length === 0) delete component.licenses;
    if (!component.group) delete component.group;
    components.push(component);
  }
  return components;
}

function cargoComponents(text) {
  const components = [];
  for (const block of text.split("[[package]]").slice(1)) {
    const name = block.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    const version = block.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
    if (!name || !version || name === "penglai-desktop-04") continue;
    const source = block.match(/^\s*source\s*=\s*"([^"]+)"/m)?.[1];
    const checksum = block.match(/^\s*checksum\s*=\s*"([0-9a-f]{64})"/m)?.[1];
    const component = {
      type: "library",
      "bom-ref": `cargo:${name}@${version}:${source ?? "workspace"}`,
      name,
      version,
      hashes: checksum ? [{ alg: "SHA-256", content: checksum }] : undefined,
      properties: [
        { name: "penglai:source", value: "Cargo.lock" },
        ...(source ? [{ name: "penglai:cargo-source", value: source }] : []),
      ],
    };
    if (!component.hashes) delete component.hashes;
    components.push(component);
  }
  return components;
}

export function buildReleaseSbom(root = REPO_ROOT) {
  const contract = loadReleaseContract();
  assertRepositoryVersions(root, contract);
  const lock = readJson(path.join(root, "package-lock.json"));
  const cargoLock = fs.readFileSync(
    path.join(root, "packages/desktop/src-tauri/Cargo.lock"),
    "utf8",
  );
  const components = [
    {
      type: "framework",
      "bom-ref": `runtime:node@${contract.bundledNodeVersion}`,
      name: "Node.js bundled runtime",
      version: contract.bundledNodeVersion,
      properties: [{ name: "penglai:source", value: "pinned official Node distributions" }],
    },
    ...npmComponents(lock),
    ...cargoComponents(cargoLock),
  ].sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"]));

  return {
    $schema: "https://cyclonedx.org/schema/bom-1.6.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": `penglai-desktop@${contract.version}`,
        name: "Penglai Desktop",
        version: contract.version,
        properties: [
          { name: "penglai:release-tag", value: `v${contract.version}` },
          { name: "penglai:update-channel", value: contract.channelTag },
        ],
      },
    },
    components,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const args = parseArgs();
    const sbom = buildReleaseSbom();
    fs.writeFileSync(args.out, `${JSON.stringify(sbom, null, 2)}\n`);
    console.log(`[release-sbom] PASS ${sbom.components.length} locked components -> ${args.out}`);
  } catch (error) {
    console.error(`[release-sbom] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
