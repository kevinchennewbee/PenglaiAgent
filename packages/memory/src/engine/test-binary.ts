import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = `#!/usr/bin/env node
const { mkdirSync, readFileSync, writeFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const args = process.argv.slice(2);
if (args.includes("--version") && !args.some((a) => ["remember","search","recall","forget","viz","status"].includes(a))) {
  process.stdout.write("mnemon version 0.2.4\\n");
  process.exit(0);
}
function take(flag) {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
const dataDir = take("--data-dir");
if (!dataDir) { console.error("data-dir required"); process.exit(2); }
take("--store");
take("--embed-model");
if (args[0] === "--readonly") args.shift();
const command = args.shift();
function storePath() { return join(dataDir, "penglai-fake-mnemon.json"); }
function load() {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (!existsSync(storePath())) return { insights: [], edges: [] };
  return JSON.parse(readFileSync(storePath(), "utf8"));
}
function save(db) { writeFileSync(storePath(), JSON.stringify(db)); }
if (command === "--version" || command === undefined && args.includes("--version")) {
  process.stdout.write("mnemon version 0.2.4\\n");
  process.exit(0);
}
if (command === "version") { process.stderr.write("unknown command\\n"); process.exit(2); }
const db = load();
if (command === "remember") {
  const cat = take("--cat") || "fact";
  const tags = (take("--tags") || "").split(",").filter(Boolean);
  take("--source");
  take("--imp");
  take("--entities");
  take("--entity-mode");
  const content = args.filter((a) => !a.startsWith("-")).join(" ") || "";
  const row = { id: randomUUID(), content, category: cat, tags, forgotten: false };
  db.insights.push(row);
  save(db);
  process.stdout.write(JSON.stringify({ action: "added", id: row.id, content, category: cat, tags }) + "\\n");
  process.exit(0);
}
if (command === "search" || command === "recall") {
  take("--limit");
  take("--basic");
  take("--cat");
  take("--source");
  take("--intent");
  const q = (args.filter((a) => !a.startsWith("-")).join(" ") || "").toLowerCase();
  const rows = db.insights.filter((r) => !r.forgotten && r.content.toLowerCase().includes(q));
  if (command === "search") process.stdout.write(JSON.stringify(rows.map((r) => ({ id: r.id, content: r.content, category: r.category, tags: r.tags, score: 1 }))) + "\\n");
  else process.stdout.write(JSON.stringify({ results: rows.map((r) => ({ id: r.id, content: r.content })) }) + "\\n");
  process.exit(0);
}
if (command === "related") {
  process.stdout.write(JSON.stringify({ id: args[0], related: [] }) + "\\n");
  process.exit(0);
}
if (command === "forget") {
  const id = args[0];
  const row = db.insights.find((r) => r.id === id);
  if (row) row.forgotten = true;
  save(db);
  process.stdout.write(JSON.stringify({ id, forgotten: true }) + "\\n");
  process.exit(0);
}
if (command === "status") {
  const active = db.insights.filter((r) => !r.forgotten);
  process.stdout.write(JSON.stringify({ total_insights: active.length, db_path: join(dataDir, "mnemon.db") }) + "\\n");
  process.exit(0);
}
if (command === "viz") {
  const active = db.insights.filter((r) => !r.forgotten);
  let dot = "digraph G {\\n";
  for (const row of active) dot += '  "' + row.id + '" [label="' + String(row.content).slice(0, 40).replace(/"/g, "") + '"];\\n';
  dot += "}\\n";
  process.stdout.write(dot);
  process.exit(0);
}
if (command === "link") { process.stdout.write("ok\\n"); process.exit(0); }
if (command === "log") { process.stdout.write("TIME OP\\n"); process.exit(0); }
if (command === "receipt") { process.stdout.write(JSON.stringify({ schema: "mnemon.memory.receipt.v1", events: [] }) + "\\n"); process.exit(0); }
if (command === "import") { process.stdout.write(JSON.stringify({ imported: 0 }) + "\\n"); process.exit(0); }
process.stderr.write("unknown command " + command + "\\n");
process.exit(2);
`;

export function createTestMnemonBinary(dir?: string): string {
  const ownedDir = dir ?? mkdtempSync(join(tmpdir(), "penglai-fake-mnemon-"));
  if (dir) mkdirSync(ownedDir, { recursive: true, mode: 0o700 });
  const jsPath = join(ownedDir, "mnemon.js");
  writeFileSync(jsPath, SCRIPT.replace(/^#!.*\n/, ""), { encoding: "utf8", mode: 0o644 });
  if (process.platform === "win32") {
    return jsPath;
  }
  const path = join(ownedDir, "mnemon");
  writeFileSync(
    path,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(jsPath)} "$@"\n`,
    { encoding: "utf8", mode: 0o755 },
  );
  chmodSync(path, 0o755);
  return path;
}
