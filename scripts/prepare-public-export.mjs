import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, gitState } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";

const pe = await import(pathToFileURL(join(ROOT, "packages/release-identity/src/public-export.ts")).href);
const pins = await import(pathToFileURL(join(ROOT, "packages/release-identity/src/pins.ts")).href);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git" || name === "evidence" || name.startsWith(".tmp")) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    const rel = relative(ROOT, abs).replaceAll("\\", "/");
    const denied = pe.PUBLIC_EXPORT_DENY.some((d) => rel === d || rel.startsWith(`${d}/`));
    if (denied) continue;
    if (st.isDirectory()) {
      walk(abs, acc);
      continue;
    }
    if (!pe.pathAllowed(rel)) continue;
    acc.push(rel);
  }
  return acc;
}

const files = walk(ROOT).sort();
const entries = [];
const scanHits = [];
for (const rel of files) {
  const buf = readFileSync(join(ROOT, rel));
  const entry = {
    path: rel,
    size: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
    mode: "0644",
    license: pe.classifyLicense(rel),
  };
  entries.push(entry);
  if (rel.endsWith(".png") || rel.endsWith(".jpg") || rel.endsWith(".tgz") || rel.endsWith(".wasm")) continue;
  try {
    pe.scanExportText(rel, buf.toString("utf8"));
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

const tree = pe.publicExportTreeSha256(entries);
const git = gitState();
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
  for (const rel of files) {
    const to = join(dest, rel);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(ROOT, rel), to);
  }
  const install = spawnSync("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], {
    cwd: dest,
    encoding: "utf8",
    env: { ...process.env },
  });
  const typecheck = install.status === 0
    ? spawnSync("pnpm", ["exec", "tsc", "-b", "--pretty", "false", "--force"], { cwd: dest, encoding: "utf8", env: { ...process.env } })
    : null;
  const scriptCheck = spawnSync(process.execPath, ["--check", join(dest, "scripts/prepare-public-export.mjs")], {
    encoding: "utf8",
  });
  cleanRoom = {
    executed: true,
    dest: ".tmp-public-export/tree",
    installStatus: install.status,
    typecheckStatus: typecheck?.status ?? null,
    scriptCheckStatus: scriptCheck.status,
    reason:
      install.status === 0 && (typecheck?.status ?? 1) === 0 && scriptCheck.status === 0
        ? "lock-only install and typecheck passed"
        : "clean-room install or typecheck failed",
    installTail: String(install.stderr || install.stdout || "").slice(-800),
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
  privateCandidateSourceSha: git.head,
  treeDirty: git.dirty,
  cleanRoom,
  publication,
  publicationExecuted: false,
};
writeFileSync(join(generated, "public-export.json"), JSON.stringify(out, null, 2));
writeFileSync(join(generated, "public-export-manifest.json"), JSON.stringify({ publicExportTreeSha256: tree, files: entries }, null, 2));
writeFileSync(
  join(generated, "publication-manifest-draft.json"),
  JSON.stringify(pe.buildPublicationDraft({ privateCandidateSourceSha: git.head, publicExportTreeSha256: tree, files: entries.length }), null, 2),
);
if (!existsSync(join(ROOT, "LICENSE"))) finish("FAIL", { command: "prepare:public-export", reason: "LICENSE missing" });
if (cleanRoom.executed === true) {
  finish("PASS", { command: "prepare:public-export", tree, files: entries.length, cleanRoom });
}
finish("INCOMPLETE", {
  command: "prepare:public-export",
  tree,
  files: entries.length,
  reason: "allowlist export and scans passed; clean-room lock-only install not executed",
});
