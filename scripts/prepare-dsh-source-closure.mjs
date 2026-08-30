import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  normalizeRepositoryUrl,
  readDshSourceClosureContract,
  resolveClosureOutput,
  sha256,
} from "./lib/dsh-source-closure.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { canonicalizeGzip } from "./lib/deterministic-gzip.mjs";
import { ROOT } from "./lib/repo.mjs";
import { readVerifiedRegularFile } from "./lib/verified-file.mjs";

function capture(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${String(result.status)}`);
  }
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalizeJson(child)]),
  );
}

function treeInventory(root, current = "") {
  const directory = join(root, current);
  const rows = [];
  for (const name of readdirSync(directory).sort()) {
    const relativePath = current ? `${current}/${name}` : name;
    const path = join(root, relativePath);
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      rows.push(...treeInventory(root, relativePath));
    } else if (stat.isSymbolicLink()) {
      rows.push({ path: relativePath, type: "symlink", target: readlinkSync(path) });
    } else if (stat.isFile()) {
      const verified = readVerifiedRegularFile(path);
      rows.push({
        path: relativePath,
        type: "file",
        mode: Number(verified.stat.mode & 0o777n),
        size: Number(verified.stat.size),
        sha256: sha256(verified.bytes),
      });
    } else {
      throw new Error(`${path} has an unsupported archive entry type`);
    }
  }
  return rows;
}

function normalizeTarball(path, contract) {
  const scratch = mkdtempSync(join(tmpdir(), "penglai-dsh-normalize-"));
  try {
    const extracted = join(scratch, "extracted");
    const packed = join(scratch, "packed");
    const roundTrip = join(scratch, "round-trip");
    mkdirSync(extracted);
    mkdirSync(packed);
    mkdirSync(roundTrip);
    run("tar", ["-xzf", path, "-C", extracted], ROOT);
    const packageRoot = join(extracted, "package");
    const packageJsonPath = join(packageRoot, "package.json");
    const packageJson = canonicalizeJson(JSON.parse(readFileSync(packageJsonPath, "utf8")));
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
    const before = treeInventory(packageRoot);
    capture(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", packed, "--json"],
      packageRoot,
      {
        env: {
          ...process.env,
          SOURCE_DATE_EPOCH: String(contract.transport.artifactNormalization.sourceDateEpoch),
        },
      },
    );
    const outputs = readdirSync(packed).filter((name) => name.endsWith(".tgz"));
    if (outputs.length !== 1) throw new Error(`${path} normalization produced ${outputs.length} archives`);
    const normalized = join(packed, outputs[0]);
    run("tar", ["-xzf", normalized, "-C", roundTrip], ROOT);
    const after = treeInventory(join(roundTrip, "package"));
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      throw new Error(`${path} deterministic repack changed package payload bytes, paths or modes`);
    }
    const { bytes: normalizedBytes } = readVerifiedRegularFile(normalized);
    writeFileSync(path, canonicalizeGzip(normalizedBytes));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function normalizeFamily(directory, contract) {
  for (const filename of readdirSync(directory).filter((name) => name.endsWith(".tgz")).sort()) {
    normalizeTarball(join(directory, filename), contract);
  }
}

function verifySource(source, contract) {
  if (!existsSync(join(source, ".git"))) throw new Error(`${source} is not a Git checkout`);
  const head = capture("git", ["rev-parse", "HEAD"], source);
  const tree = capture("git", ["rev-parse", "HEAD^{tree}"], source);
  const tagCommit = capture("git", ["rev-parse", `${contract.upstream.tag}^{commit}`], source);
  const status = capture("git", ["status", "--porcelain=v1", "--untracked-files=no"], source);
  const origin = capture("git", ["remote", "get-url", "origin"], source);
  if (head !== contract.upstream.commit || tagCommit !== contract.upstream.commit) {
    throw new Error(`source commit mismatch: HEAD=${head} tag=${tagCommit}`);
  }
  if (tree !== contract.upstream.tree) throw new Error(`source tree mismatch: ${tree}`);
  if (status !== "") throw new Error("fixed DSH source checkout has tracked modifications");
  if (normalizeRepositoryUrl(origin) !== normalizeRepositoryUrl(contract.upstream.repository)) {
    throw new Error(`source origin mismatch: ${origin}`);
  }

  const archive = execFileSync("git", ["archive", "--format=tar", contract.upstream.commit], {
    cwd: source,
    encoding: "buffer",
    maxBuffer: 512 * 1024 * 1024,
  });
  const archiveSha256 = sha256(archive);
  if (archiveSha256 !== contract.upstream.archiveSha256) {
    throw new Error(`source archive SHA-256 mismatch: ${archiveSha256}`);
  }

  const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  if (manifest.packageManager !== contract.toolchain.packageManager) {
    throw new Error(`source package manager mismatch: ${String(manifest.packageManager)}`);
  }
  if (manifest.engines?.node !== contract.toolchain.nodeRange) {
    throw new Error(`source Node range mismatch: ${String(manifest.engines?.node)}`);
  }
  const cli = JSON.parse(readFileSync(join(source, "apps/cli/package.json"), "utf8"));
  if (cli.name !== "@deepseek-ai/dsh" || cli.version !== contract.upstream.version) {
    throw new Error(`source CLI identity mismatch: ${String(cli.name)}@${String(cli.version)}`);
  }
  return { head, tree, origin, archiveSha256 };
}

function tarballIdentity(bytes, label) {
  const raw = execFileSync("tar", ["-xOf", "-", "package/package.json"], {
    input: bytes,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const manifest = JSON.parse(raw);
  const files = execFileSync("tar", ["-tf", "-"], { input: bytes, encoding: "utf8" }).trim().split("\n");
  if (!files.includes("package/LICENSE")) throw new Error(`${label} is missing package/LICENSE`);
  if (manifest.license !== "MIT" && manifest.license !== "BSD-3-Clause") {
    throw new Error(`${label} has unsupported license ${JSON.stringify(manifest.license)}`);
  }
  return {
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
    repository: manifest.repository,
  };
}

function inventoryFamily(directory, expected, publishOrderRequired) {
  const tarballs = readdirSync(directory).filter((name) => name.endsWith(".tgz")).sort();
  if (tarballs.length !== expected) {
    throw new Error(`${directory} contains ${tarballs.length} tarballs, expected ${expected}`);
  }
  const packages = tarballs.map((filename) => {
    const path = join(directory, filename);
    const { bytes } = readVerifiedRegularFile(path);
    return { filename, ...tarballIdentity(bytes, path), size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  if (new Set(packages.map((row) => row.name)).size !== packages.length) {
    throw new Error(`${directory} contains duplicate package identities`);
  }
  let publishOrder;
  const publishOrderPath = join(directory, "publish-order.txt");
  if (publishOrderRequired) {
    if (!existsSync(publishOrderPath)) throw new Error(`${directory} is missing publish-order.txt`);
    const { bytes } = readVerifiedRegularFile(publishOrderPath);
    publishOrder = {
      filename: "publish-order.txt",
      size: bytes.length,
      sha256: sha256(bytes),
    };
  } else if (existsSync(publishOrderPath)) {
    throw new Error(`${directory} has an unexpected publish-order.txt`);
  }
  const expectedFiles = new Set([
    ...tarballs,
    ...(publishOrder ? [publishOrder.filename] : []),
  ]);
  const extras = readdirSync(directory).filter((name) => !expectedFiles.has(name));
  if (extras.length > 0) throw new Error(`${directory} has unexpected entries: ${extras.join(", ")}`);
  return { packages, ...(publishOrder ? { publishOrder } : {}) };
}

const { values } = parseArgs({
  options: {
    source: { type: "string" },
    out: { type: "string" },
    "contract-only": { type: "boolean", default: false },
    "identity-only": { type: "boolean", default: false },
  },
  allowPositionals: false,
});

const contract = readDshSourceClosureContract(ROOT);
if (values["contract-only"]) {
  finish("PASS", {
    command: "prepare-dsh-source-closure",
    mode: "contract-only",
    stage: contract.stage,
    source: contract.upstream,
    packageCount: [...contract.build.families, ...contract.build.auxiliaryPackages].reduce(
      (sum, family) => sum + family.expectedTarballs,
      0,
    ),
  });
}
let temporaryRoot;
let canonicalRoot;
let source;
let result;
try {
  if (values.source) {
    source = resolve(values.source);
  } else {
    temporaryRoot = mkdtempSync(join(tmpdir(), "penglai-dsh-source-"));
    source = join(temporaryRoot, "source");
    run("git", ["clone", "--depth", "1", "--branch", contract.upstream.tag, contract.upstream.repository, source], ROOT);
  }

  const identity = verifySource(source, contract);
  if (values["identity-only"]) {
    result = { verdict: "PASS", command: "prepare-dsh-source-closure", mode: "identity-only", identity };
  } else {
    if (process.platform !== contract.build.canonicalHost.platform) {
      throw new Error(`full source closure requires ${contract.build.canonicalHost.platform}, received ${process.platform}`);
    }
    const inputSource = source;
    source = resolve(contract.build.canonicalHost.sourceRoot);
    canonicalRoot = dirname(source);
    rmSync(canonicalRoot, { recursive: true, force: true });
    mkdirSync(canonicalRoot, { recursive: true });
    run("git", ["clone", "--no-hardlinks", "--no-checkout", inputSource, source], ROOT);
    run("git", ["checkout", "--detach", contract.upstream.commit], source);
    run("git", ["remote", "set-url", "origin", contract.upstream.repository], source);
    verifySource(source, contract);

    const output = resolveClosureOutput(ROOT, values.out, contract);
    rmSync(output, { recursive: true, force: true });
    mkdirSync(output, { recursive: true });

    const pnpmVersion = capture("corepack", ["pnpm", "--version"], source);
    if (`pnpm@${pnpmVersion}` !== contract.toolchain.packageManager) {
      throw new Error(`Corepack selected pnpm@${pnpmVersion}, expected ${contract.toolchain.packageManager}`);
    }
    const nodeVersion = process.version.replace(/^v/, "");
    if (nodeVersion !== contract.toolchain.verifiedNode) {
      throw new Error(`source closure requires Node ${contract.toolchain.verifiedNode}, received ${nodeVersion}`);
    }
    const npmVersion = capture("npm", ["--version"], source);
    if (`npm@${npmVersion}` !== contract.toolchain.archivePacker) {
      throw new Error(`source closure selected npm@${npmVersion}, expected ${contract.toolchain.archivePacker}`);
    }
    run("corepack", ["pnpm", ...contract.build.install], source);
    run("corepack", ["pnpm", ...contract.build.compile], source);

    const familyOutputs = new Map();
    for (const family of contract.build.families) {
      const destination = join(output, family.id);
      run("corepack", ["pnpm", "run", "release:pack", "--family", family.id, "--out", destination], source);
      familyOutputs.set(family.id, destination);
    }
    for (const auxiliary of contract.build.auxiliaryPackages) {
      const destination = join(output, auxiliary.id);
      mkdirSync(destination, { recursive: true });
      run("corepack", ["pnpm", ...auxiliary.build], source);
      run(
        "corepack",
        ["pnpm", "--dir", auxiliary.directory, "pack", "--pack-destination", destination],
        source,
      );
      familyOutputs.set(auxiliary.id, destination);
    }
    for (const directory of familyOutputs.values()) normalizeFamily(directory, contract);
    run(
      "corepack",
      [
        "pnpm",
        "run",
        "release:verify-packed-install",
        "--family",
        contract.build.packedInstallFamily,
        "--from",
        familyOutputs.get("vendor"),
        "--from",
        familyOutputs.get("dsh"),
        "--from",
        familyOutputs.get("landlock-entry"),
      ],
      source,
      contract.build.packedInstallEnvironment[process.platform] ?? {},
    );

    const families = [...contract.build.families, ...contract.build.auxiliaryPackages].map((family) => ({
      id: family.id,
      ...inventoryFamily(
        familyOutputs.get(family.id),
        family.expectedTarballs,
        family.publishOrder,
      ),
    }));
    const dshFamily = families.find((family) => family.id === "dsh");
    if (
      !dshFamily ||
      dshFamily.packages.some(
        (row) => !row.name.startsWith("@deepseek-ai/dsh") || row.version !== contract.upstream.version,
      )
    ) {
      throw new Error("the DSH family contains a foreign identity or mixed version");
    }
    const landlockFamily = families.find((family) => family.id === "landlock-entry");
    if (
      landlockFamily?.packages[0]?.name !== contract.build.auxiliaryPackages[0].name ||
      landlockFamily.packages[0].license !== "BSD-3-Clause"
    ) {
      throw new Error("the Landlock entry package identity or license differs from the contract");
    }
    const allNames = families.flatMap((family) => family.packages.map((row) => row.name));
    if (new Set(allNames).size !== allNames.length) {
      throw new Error("the complete source closure contains duplicate package identities");
    }
    const clientBuildRecord = JSON.parse(
      readFileSync(join(source, ".dsh-build/client-build-environment.json"), "utf8"),
    );
    const expectedClientEnvironment = {
      DSH_CLIENT_BUILD_PROFILE: contract.officialClientBuild.profile,
      DSH_CLIENT_COMMIT_HASH: contract.upstream.commit.slice(0, 7),
      DSH_CLIENT_TITLE: contract.officialClientBuild.title,
      DSH_CLIENT_VERSION: contract.upstream.version,
    };
    const actualClientEnvironment = clientBuildRecord.environment;
    const normalizedClientEnvironment = (value) =>
      JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
    if (
      normalizedClientEnvironment(actualClientEnvironment) !==
      normalizedClientEnvironment(expectedClientEnvironment)
    ) {
      throw new Error(
        `official client build record mismatch: ${JSON.stringify(actualClientEnvironment)}`,
      );
    }
    const manifest = {
      schemaVersion: 1,
      source: identity,
      version: contract.upstream.version,
      packageManager: contract.toolchain.packageManager,
      archivePacker: contract.toolchain.archivePacker,
      transport: contract.transport.kind,
      officialNpmRequired: false,
      publicNpmPublication: false,
      patched: false,
      artifactNormalization: contract.transport.artifactNormalization,
      buildHost: contract.build.canonicalHost,
      packedInstallReadback: {
        passed: true,
        package: "@deepseek-ai/dsh",
        version: contract.upstream.version,
      },
      officialClientBuild: clientBuildRecord,
      packageCount: families.reduce((sum, family) => sum + family.packages.length, 0),
      families,
    };
    writeFileSync(join(output, "closure-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    result = {
      verdict: "PASS",
      command: "prepare-dsh-source-closure",
      mode: "full",
      output: `${contract.transport.outputRoot}/${basename(output)}`,
      packageCount: manifest.packageCount,
      source: identity,
    };
  }
} catch (error) {
  result = { verdict: "FAIL", command: "prepare-dsh-source-closure", reason: String(error) };
} finally {
  if (canonicalRoot) rmSync(canonicalRoot, { recursive: true, force: true });
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
}
finish(result.verdict, Object.fromEntries(Object.entries(result).filter(([key]) => key !== "verdict")));
