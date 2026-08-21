import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, git, gitState } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { PRODUCT_VERSION } from "./lib/product.mjs";

const contractsBuild = spawnSync(
  process.execPath,
  [
    join(ROOT, "node_modules", "typescript", "bin", "tsc"),
    "-b",
    "packages/contracts",
    "--pretty",
    "false",
    "--force",
  ],
  { cwd: ROOT, encoding: "utf8", env: { ...process.env } },
);
if (contractsBuild.status !== 0) {
  finish("FAIL", {
    command: "prepare:public-export",
    reason: "could not build the source dependency required by the export policy",
    detail: String(contractsBuild.error || contractsBuild.stderr || contractsBuild.stdout || "").slice(-800),
  });
}

const pe = await import(pathToFileURL(join(ROOT, "packages/release-identity/src/public-export.ts")).href);
const pins = await import(pathToFileURL(join(ROOT, "packages/release-identity/src/pins.ts")).href);

function gitBuffer(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
}

function trackedExportFiles() {
  const names = git(["ls-files", "-z"])
    .split("\0")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((rel) => pe.pathAllowed(rel));
  const modes = new Map();
  for (const line of git(["ls-files", "--stage", "-z"]).split("\0").filter(Boolean)) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const meta = line.slice(0, tab);
    const path = line.slice(tab + 1);
    const mode = meta.split(" ")[0];
    if (path && mode) modes.set(path, mode === "100755" ? "0755" : "0644");
  }
  return names
    .sort()
    .map((rel) => ({ rel, mode: modes.get(rel) ?? "0644" }));
}

const tracked = trackedExportFiles();
const files = tracked.map((row) => row.rel);
const entries = [];
const scanHits = [];
for (const row of tracked) {
  const buf = gitBuffer(["show", `:${row.rel}`]);
  const entry = {
    path: row.rel,
    size: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
    mode: row.mode,
    license: pe.classifyLicense(row.rel),
  };
  entries.push(entry);
  if (row.rel.endsWith(".png") || row.rel.endsWith(".jpg") || row.rel.endsWith(".tgz") || row.rel.endsWith(".wasm")) continue;
  try {
    pe.scanExportText(row.rel, buf.toString("utf8"));
  } catch (err) {
    scanHits.push(String(err));
  }
}

try {
  pe.assertRequiredPublicDocs(files);
  pe.assertExportHasSourceNotOnlyBinary(files);
} catch (err) {
  finish("FAIL", { command: "prepare:public-export", reason: String(err) });
}
if (scanHits.length) {
  finish("FAIL", { command: "prepare:public-export", reason: "export scan failed", hits: scanHits.slice(0, 20) });
}
if (files.includes("packages/plugin-registry/package.json") === false || files.includes("packages/plugin-pilot/package.json") === false) {
  finish("FAIL", {
    command: "prepare:public-export",
    reason: "tracked Git tree is missing plugin-registry/plugin-pilot package.json",
  });
}

const tree = pe.publicExportTreeSha256(entries);
const gitInfo = gitState();
const publication = {
  ...pins.PUBLICATION_TARGET,
};
pe.assertPublicationTarget(publication);

const generated = join(ROOT, "evidence/generated");
mkdirSync(generated, { recursive: true });
const wantCleanRoom = process.argv.includes("--clean-room") || process.env.PENGLAI_PUBLIC_EXPORT_CLEANROOM === "1";
let cleanRoom = { executed: false, reason: "lock-only reinstall reserved for remaining PREP-004" };
if (wantCleanRoom) {
  const dest = join(ROOT, ".tmp-public-export", "tree");
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const indexTree = git(["write-tree"]);
  const archive = spawnSync("git", ["archive", "--format=tar", indexTree, "--", ...files], {
    cwd: ROOT,
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (archive.status !== 0) {
    finish("FAIL", {
      command: "prepare:public-export",
      reason: "git archive of tracked export files failed",
      detail: String(archive.stderr || "").slice(-800),
    });
  }
  const extract = spawnSync("tar", ["-xf", "-", "-C", dest], {
    cwd: ROOT,
    input: archive.stdout,
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (extract.status !== 0) {
    finish("FAIL", {
      command: "prepare:public-export",
      reason: "git archive extract failed",
      detail: String(extract.stderr || "").slice(-800),
    });
  }
  const corepackCli = process.env.COREPACK_ROOT
    ? join(process.env.COREPACK_ROOT, "dist", "corepack.js")
    : "";
  if (!corepackCli || !existsSync(corepackCli)) {
    finish("FAIL", {
      command: "prepare:public-export",
      reason: "clean-room requires the Corepack CLI that launched the pinned pnpm",
    });
  }
  const install = spawnSync(process.execPath, [corepackCli, "pnpm", "install", "--frozen-lockfile", "--ignore-scripts"], {
    cwd: dest,
    encoding: "utf8",
    env: { ...process.env },
  });
  const typecheck =
    install.status === 0
      ? spawnSync(
          process.execPath,
          [join(dest, "node_modules", "typescript", "bin", "tsc"), "-b", "--pretty", "false", "--force"],
          { cwd: dest, encoding: "utf8", env: { ...process.env } },
        )
      : null;
  const scriptCheck = spawnSync(process.execPath, ["--check", join(dest, "scripts/prepare-public-export.mjs")], {
    encoding: "utf8",
  });
  cleanRoom = {
    executed: true,
    dest: ".tmp-public-export/tree",
    source: "git-archive-index",
    productVersion: PRODUCT_VERSION,
    installStatus: install.status,
    typecheckStatus: typecheck?.status ?? null,
    scriptCheckStatus: scriptCheck.status,
    reason:
      install.status === 0 && (typecheck?.status ?? 1) === 0 && scriptCheck.status === 0
        ? "git-archive lock-only install and typecheck passed"
        : "clean-room install or typecheck failed",
    installTail: String(install.error || install.stderr || install.stdout || "").slice(-800),
  };
  if (install.status !== 0 || (typecheck && typecheck.status !== 0) || scriptCheck.status !== 0) {
    writeFileSync(join(ROOT, "evidence/generated/public-export.json"), JSON.stringify({
      schemaVersion: 1,
      publicExportTreeSha256: tree,
      files: entries.length,
      publication,
      publicationExecuted: false,
      cleanRoom,
    }, null, 2));
    finish("FAIL", { command: "prepare:public-export", reason: "clean-room lock-only install failed", cleanRoom });
  }
}

const out = {
  schemaVersion: 1,
  publicExportTreeSha256: tree,
  files: entries.length,
  privateCandidateSourceSha: gitInfo.head,
  treeDirty: gitInfo.dirty,
  source: "git-tracked-index",
  cleanRoom,
  publication,
  publicationExecuted: false,
};
writeFileSync(join(generated, "public-export.json"), JSON.stringify(out, null, 2));
writeFileSync(join(generated, "public-export-manifest.json"), JSON.stringify({ publicExportTreeSha256: tree, files: entries }, null, 2));
writeFileSync(
  join(generated, "publication-manifest-draft.json"),
  JSON.stringify(pe.buildPublicationDraft({ privateCandidateSourceSha: gitInfo.head, publicExportTreeSha256: tree, files: entries.length }), null, 2),
);
if (!existsSync(join(ROOT, "LICENSE"))) finish("FAIL", { command: "prepare:public-export", reason: "LICENSE missing" });
if (cleanRoom.executed === true) {
  rmSync(join(ROOT, ".tmp-public-export", "tree"), { recursive: true, force: true });
  finish("PASS", { command: "prepare:public-export", tree, files: entries.length, cleanRoom });
}
finish("INCOMPLETE", {
  command: "prepare:public-export",
  tree,
  files: entries.length,
  reason: "allowlist export and scans passed from tracked Git index; clean-room lock-only install not executed",
});
