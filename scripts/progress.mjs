#!/usr/bin/env node
// Penglai progress dashboard: git truth, Hard registry count, execution track
// stages, evidence overview, and stale-artifact poison warnings. Read-only.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd) {
  try {
    return execFileSync(cmd[0], cmd.slice(1), { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function line(title) {
  console.log(`\n== ${title} ${"=".repeat(Math.max(2, 64 - title.length))}`);
}

line("git");
const head = run(["git", "rev-parse", "HEAD"]);
const origin = run(["git", "rev-parse", "origin/main"]);
const dirty = run(["git", "status", "--short"]);
console.log(`HEAD        ${head ?? "?"}`);
console.log(`origin/main ${origin ?? "?"}`);
console.log(`sync        ${head && head === origin ? "in-sync" : "DIVERGED/UNPUSHED"}`);
console.log(`tree        ${dirty ? `DIRTY (${dirty.split("\n").length} files)` : "clean"}`);
if (dirty) console.log(dirty.split("\n").slice(0, 12).join("\n"));

line("Hard registry (docs/ACCEPTANCE.md)");
const acceptance = readFileSync(join(root, "docs/ACCEPTANCE.md"), "utf8");
const ids = [...acceptance.matchAll(/^\| `(R50-[A-Z0-9-]+)`/gm)].map((m) => m[1]);
const unique = new Set(ids);
console.log(`rows=${ids.length} unique=${unique.size} ${ids.length === unique.size ? "(no duplicates)" : "(DUPLICATE IDS!)"}`);

line("Execution track (docs/execution-track.json)");
const trackPath = join(root, "docs/execution-track.json");
if (existsSync(trackPath)) {
  const track = JSON.parse(readFileSync(trackPath, "utf8"));
  if (track.currentWorkbench || track.currentPhase) {
    console.log(`workbench  ${track.currentWorkbench ?? "(none)"}`);
    console.log(`phase      ${track.currentPhase ?? "(none)"}`);
    if (Array.isArray(track.workbenchOrder)) {
      console.log(`order      ${track.workbenchOrder.join(" → ")}`);
    }
  }
  for (const s of track.stages ?? []) {
    const mark = s.status === "DONE" ? "x" : s.status === "DOING" ? ">" : " ";
    console.log(` [${mark}] ${s.id}  ${s.status.padEnd(6)} ${s.goal}  (${(s.mapsTo ?? []).join("/")})`);
  }
  const done = (track.stages ?? []).filter((s) => s.status === "DONE").length;
  console.log(`stages: ${done}/${track.stages?.length ?? 0} done`);
} else {
  console.log("MISSING docs/execution-track.json");
}

line("Evidence (evidence/generated)");
const evDir = join(root, "evidence/generated");
if (existsSync(evDir)) {
  const files = readdirSync(evDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) console.log("(empty)");
  for (const f of files) {
    const st = statSync(join(evDir, f));
    console.log(` ${f}  ${st.mtime.toISOString().slice(0, 16).replace("T", " ")}`);
  }
  const stale020 = files.filter((f) => {
    try {
      const document = JSON.parse(readFileSync(join(evDir, f), "utf8"));
      const productVersions = [
        document?.productVersion,
        document?.release,
        document?.metadata?.component?.name === "Penglai"
          ? document.metadata.component.version
          : undefined,
      ];
      return productVersions.includes("0.2.0");
    } catch {
      return false;
    }
  });
  if (stale020.length) console.log(` WARNING stale 0.2.0 content: ${stale020.join(", ")}`);
} else {
  console.log("(directory missing)");
}

line("dist hygiene");
const pluginDir = join(root, "dist/runtime-staging/plugins");
if (existsSync(pluginDir)) {
  const tgz = readdirSync(pluginDir).filter((f) => f.endsWith(".tgz"));
  const forbidden = tgz.filter((f) => /credentials-keychain|plugin-smoke/.test(f));
  const oldVersion = tgz.filter((f) => /-0\.2\.0\.tgz$/.test(f));
  console.log(`packed tgz: ${tgz.length}`);
  if (forbidden.length) console.log(` POISON forbidden packages present: ${forbidden.join(", ")}`);
  if (oldVersion.length) console.log(` WARNING stale 0.2.0 tarballs: ${oldVersion.join(", ")}`);
  if (!forbidden.length && !oldVersion.length && tgz.length) console.log(" clean");
} else {
  console.log(" dist/runtime-staging/plugins absent (rebuild via pnpm pack:plugins)");
}
const dmg = readdirSync(join(root, "dist")).filter((f) => f.endsWith(".dmg"));
for (const d of dmg) console.log(` dmg: ${d}`);

console.log("\nnext: see docs/R3F_EXECUTION_TRACK.md section 4 (session resume protocol)");
