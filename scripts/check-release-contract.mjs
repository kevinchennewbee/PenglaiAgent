#!/usr/bin/env node

import * as fs from "node:fs";
import {
  REPO_ROOT,
  assertReleaseTag,
  assertRepositoryVersions,
  loadReleaseContract,
  releaseMatrix,
} from "../packages/desktop/updater/release-contract.mjs";

function parseArgs() {
  const args = { tag: null, repository: null, platform: null, target: null, runnerOs: null, runnerArch: null, githubOutput: null };
  for (let index = 2; index < process.argv.length; index++) {
    const value = process.argv[index];
    if (value === "--tag") args.tag = process.argv[++index];
    else if (value === "--repository") args.repository = process.argv[++index];
    else if (value === "--platform") args.platform = process.argv[++index];
    else if (value === "--target") args.target = process.argv[++index];
    else if (value === "--runner-os") args.runnerOs = process.argv[++index];
    else if (value === "--runner-arch") args.runnerArch = process.argv[++index];
    else if (value === "--github-output") args.githubOutput = process.argv[++index];
    else throw new Error(`unknown argument: ${value}`);
  }
  return args;
}

function main() {
  const args = parseArgs();
  const contract = loadReleaseContract();
  const versions = assertRepositoryVersions(undefined, contract);
  if (args.tag) assertReleaseTag(args.tag, contract);
  if (args.repository && args.repository !== contract.repository) {
    throw new Error(
      `release repository mismatch: contract=${contract.repository}, workflow=${args.repository}`,
    );
  }
  const releaseNotes = fs.readFileSync(`${REPO_ROOT}/${contract.releaseNotes}`, "utf8");
  if (!releaseNotes.split("\n", 1)[0].includes(contract.version)) {
    throw new Error(`release notes heading is not bound to ${contract.version}: ${contract.releaseNotes}`);
  }
  const runtimeBuilder = fs.readFileSync(
    `${REPO_ROOT}/packages/host/scripts/build-runtime.mjs`,
    "utf8",
  );
  const bundledNodeVersion = runtimeBuilder.match(
    /const BUNDLED_NODE_VERSION = "([^"]+)"/,
  )?.[1];
  if (bundledNodeVersion !== contract.bundledNodeVersion) {
    throw new Error(
      `bundled Node version drift: contract=${contract.bundledNodeVersion}, builder=${bundledNodeVersion ?? "<missing>"}`,
    );
  }

  if (args.platform || args.target || args.runnerOs || args.runnerArch) {
    if (!args.platform || !args.target || !args.runnerOs || !args.runnerArch) {
      throw new Error("matrix assertion requires platform, target, runner-os, and runner-arch");
    }
    const expected = contract.platforms.find((platform) => platform.key === args.platform);
    if (!expected) throw new Error(`unknown release platform: ${args.platform}`);
    const actual = {
      target: args.target,
      runnerOs: args.runnerOs,
      runnerArch: args.runnerArch.toUpperCase(),
    };
    for (const field of ["target", "runnerOs", "runnerArch"]) {
      if (actual[field] !== expected[field]) {
        throw new Error(
          `${args.platform} ${field} mismatch: expected ${expected[field]}, received ${actual[field]}`,
        );
      }
    }
  }

  if (args.githubOutput) {
    fs.appendFileSync(
      args.githubOutput,
      `version=${contract.version}\nmatrix=${JSON.stringify(releaseMatrix(contract))}\nchannel=${contract.channelTag}\nnotes=${contract.releaseNotes}\nnode=${contract.bundledNodeVersion}\nrust=${contract.rustToolchain}\n`,
    );
  }
  console.log(
    `[release-contract] PASS ${contract.version}; ${versions.size} version surfaces; ${contract.platforms.length} platforms; channel ${contract.channelTag}`,
  );
}

try {
  main();
} catch (error) {
  console.error(`[release-contract] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
