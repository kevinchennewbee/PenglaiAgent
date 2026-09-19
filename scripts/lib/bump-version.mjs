#!/usr/bin/env node
/**
 * Prepare the 0.6.5 version bump.
 *
 * Usage:
 *   node scripts/lib/bump-version.mjs --to 0.6.5            # dry run, prints the plan
 *   node scripts/lib/bump-version.mjs --to 0.6.5 --write    # applies it
 *
 * Why this is a script and not a global search-and-replace.
 *
 * 121 tracked files carry the current version string, and two of them are
 * publication RECORDS for the version being left behind:
 *
 *   docs/PUBLICATION_MANIFEST_0.6.3.md
 *   docs/RELEASE_NOTES_0.6.3.md
 *
 * Those describe a release that already happened and is immutable. Rewriting
 * their version strings would falsify published history, which the repository
 * forbids outright. A blind `0.6.3 -> 0.6.5` would do exactly that, and the
 * damage would be invisible in a diff of that size.
 *
 * So the exclusions below are the point of this file, not an afterthought.
 *
 * What the bump must also move, and which a version-only replace would miss:
 *   - `UPDATER_SEQUENCE` in pins.ts must advance by exactly one (12 -> 13).
 *     The updater refuses a non-monotonic sequence, so a release that forgets
 *     this cannot be delivered to existing installs.
 *   - `PUBLICATION_TARGET.tag`, `.release` and `.channel` in pins.ts name the
 *     release being published, not the product, and move with it.
 *   - `.github/workflows/` hardcodes the version in several places
 *     (native-release-candidate.yml, publish-release.yml, deploy-website.yml).
 *     `deploy-website.yml` fails the deployment outright if its copy is stale.
 *   - `docs/<version>/UPGRADE_SOURCES.json` must exist: assemble-release.mjs
 *     refuses to assemble without it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "../lib/repo.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const TO = arg("--to");
const WRITE = process.argv.includes("--write");
if (!TO || !/^\d+\.\d+\.\d+$/.test(TO)) {
  console.error("usage: bump-version.mjs --to <x.y.z> [--write]");
  process.exit(2);
}

const current = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const FROM = current;
if (FROM === TO) {
  console.error(`already at ${TO}`);
  process.exit(2);
}

/**
 * Paths that must never be rewritten.
 *
 * Two categories, and the first one was learned the hard way.
 *
 * 1. The record directory of the version being LEFT. Every file inside
 *    `docs/<FROM>/` documents that release, not the one being moved to. The
 *    first version of this list stopped at `0.6.[0-2]` and so left `docs/0.6.3/`
 *    unprotected; the bump then rewrote the 0.6.3 outcome banners to read
 *    "Penglai 0.6.5 was published", inside the directory that documents 0.6.3.
 * 2. Every earlier per-version directory, which is history by construction.
 */
const NEVER_REWRITE = [
  `docs/PUBLICATION_MANIFEST_${FROM}.md`,
  `docs/RELEASE_NOTES_${FROM}.md`,
  // The record directory of the version being left behind. Listed explicitly
  // because a range that stops one short silently misses the current one.
  new RegExp(`^docs/${FROM.replaceAll(".", "\\.")}/`),
  /^docs\/0\.\d+\.\d+\//,
];

/**
 * Sentences that assert something about PUBLICATION STATE and merely happen to
 * contain a version. Rewriting the version inside them flips a true claim to a
 * false one, because the version being moved to has not been published yet.
 *
 * The first bump turned "0.6.3 is the current public release" into "0.6.5 is the
 * current public release" and "0.6.3 was published" into "0.6.5 was published"
 * across README, SECURITY, AGENTS, PRODUCT and the 0.6.3 banners, and left
 * SECURITY.md citing a `docs/PUBLICATION_MANIFEST_0.6.5.md` that does not exist.
 * Those are precisely the false claims this release exists to remove.
 *
 * They are reported, not rewritten. Make them version-agnostic by hand before a
 * bump, so a mechanical replace cannot turn them into lies.
 */
const PUBLICATION_CLAIM = new RegExp(
  [
    `${FROM}\\s+(?:is|was)\\s+the\\s+current\\s+public`,
    `${FROM}\\s+was\\s+published`,
    `当前公开版本为\\s*v?${FROM}`,
    `${FROM}\\s*已发布`,
    `${FROM}\\s*是当前公开`,
    `PUBLICATION_MANIFEST_${FROM}\\.md`,
  ].join("|"),
  "i",
);

function isProtected(path) {
  return NEVER_REWRITE.some((rule) =>
    typeof rule === "string" ? path === rule : rule.test(path),
  );
}

const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);

const edits = [];
const skipped = [];
const claims = [];
for (const path of tracked) {
  if (isProtected(path)) {
    let hits = 0;
    try {
      hits = readFileSync(join(ROOT, path), "utf8").split(FROM).length - 1;
    } catch {
      continue;
    }
    if (hits > 0) skipped.push({ path, hits });
    continue;
  }
  let text;
  try {
    text = readFileSync(join(ROOT, path), "utf8");
  } catch {
    continue;
  }
  const hits = text.split(FROM).length - 1;
  if (hits > 0) {
    // A file may both need the version moved and contain a publication claim.
    // The claim is reported either way, because after the replace it would read
    // as an assertion that the NEW version is published, which is false.
    const claimed = text.split("\n").filter((line) => PUBLICATION_CLAIM.test(line));
    if (claimed.length > 0) claims.push({ path, lines: claimed.length });
    edits.push({ path, hits });
  }
}

// Non-version facts that move with the release and a plain replace would miss.
const pinsPath = join(ROOT, "packages/release-identity/src/pins.ts");
const pins = readFileSync(pinsPath, "utf8");
const seq = Number(/export const UPDATER_SEQUENCE = (\d+);/.exec(pins)?.[1]);
if (!Number.isSafeInteger(seq)) {
  console.error("could not read UPDATER_SEQUENCE from pins.ts");
  process.exit(1);
}
const nextSeq = seq + 1;
const publicationTag = new RegExp(`tag: "v${FROM.replaceAll(".", "\\.")}"`).test(pins);

console.log(`version bump ${FROM} -> ${TO}`);
console.log("");
console.log(`  files carrying "${FROM}": ${edits.length}`);
console.log(`  protected (never rewritten): ${skipped.length}`);
for (const row of skipped) console.log(`      ${row.path}  (${row.hits} occurrences kept)`);
console.log("");
console.log(`  UPDATER_SEQUENCE: ${seq} -> ${nextSeq}`);
console.log(`  PUBLICATION_TARGET names v${FROM}: ${publicationTag ? "yes, must move" : "no"}`);
console.log("");
if (claims.length > 0) {
  console.log(`  !! ${claims.length} file(s) assert something about PUBLICATION STATE while carrying "${FROM}":`);
  for (const row of claims) console.log(`      ${row.path}  (${row.lines} line(s))`);
  console.log("");
  console.log("     Replacing the version there would turn a true claim into a false one:");
  console.log(`     "v${FROM} was published" would become "v${TO} was published", and v${TO}`);
  console.log("     has not been published. Make these lines version-agnostic first.");
  console.log("     This script reports them and refuses to run with --write while any remain.");
  console.log("");
}
console.log("  requires, not done by this script:");
console.log(`    docs/${TO}/UPGRADE_SOURCES.json must exist before assemble:release`);
console.log("    workflow hardcodes in .github/workflows/{native-release-candidate,publish-release,deploy-website}.yml");
console.log("");

if (!WRITE) {
  console.log("dry run. pass --write to apply.");
  process.exit(0);
}

// Refuse to write while a publication claim would be falsified. This is the
// guard the first bump lacked, and the reason it produced eleven false
// statements about a version that has not been published.
if (claims.length > 0) {
  console.error("");
  console.error(`refusing to write: ${claims.length} file(s) would assert that v${TO} was published`);
  for (const row of claims) console.error(`  ${row.path}`);
  console.error("make those lines version-agnostic first, then re-run");
  process.exit(1);
}

let changed = 0;
for (const row of edits) {
  const path = join(ROOT, row.path);
  const before = readFileSync(path, "utf8");
  writeFileSync(path, before.replaceAll(FROM, TO));
  changed += 1;
}

// UPDATER_SEQUENCE advances by one, and only when it is still at the expected value.
const seqNow = Number(/export const UPDATER_SEQUENCE = (\d+);/.exec(readFileSync(pinsPath, "utf8"))?.[1]);
if (seqNow !== seq) {
  console.error(`UPDATER_SEQUENCE moved under us (${seq} -> ${seqNow}); refusing to write it`);
  process.exit(1);
}
writeFileSync(
  pinsPath,
  readFileSync(pinsPath, "utf8").replace(
    /export const UPDATER_SEQUENCE = \d+;/,
    `export const UPDATER_SEQUENCE = ${nextSeq};`,
  ),
);

console.log(`rewrote ${changed} files and advanced UPDATER_SEQUENCE to ${nextSeq}`);
console.log("now update the workflow hardcodes and add docs/<version>/UPGRADE_SOURCES.json");
