import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readlinkSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { readDshSourceClosureContract } from "./lib/dsh-source-closure.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { ROOT } from "./lib/repo.mjs";
import { readVerifiedRegularFile } from "./lib/verified-file.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function inventory(root, current = "") {
  const rows = [];
  for (const name of readdirSync(join(root, current)).sort()) {
    const path = current ? `${current}/${name}` : name;
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) rows.push(...inventory(root, path));
    else if (stat.isSymbolicLink()) rows.push({ path, type: "symlink", target: readlinkSync(absolute) });
    else if (stat.isFile()) {
      const verified = readVerifiedRegularFile(absolute);
      rows.push({ path, type: "file", mode: Number(verified.stat.mode & 0o777n), size: verified.bytes.length, sha256: sha256(verified.bytes) });
    } else throw new Error(`${absolute} has an unsupported entry type`);
  }
  return rows;
}

function closurePath(value, contract) {
  const path = resolve(ROOT, value);
  const promoted = resolve(ROOT, contract.transport.promotedRoot);
  if (path === promoted) return path;
  const cache = resolve(ROOT, contract.transport.outputRoot);
  const rel = relative(cache, path);
  if (!rel || rel.startsWith("..") || rel.includes("../") || rel.includes("..\\")) {
    throw new Error(`closure replay path must be the promoted closure or a child of ${contract.transport.outputRoot}`);
  }
  return path;
}

const { values } = parseArgs({
  options: {
    left: { type: "string" },
    right: { type: "string" },
  },
  allowPositionals: false,
});
const contract = readDshSourceClosureContract(ROOT);
const left = closurePath(
  values.left ?? `${contract.transport.outputRoot}/${contract.upstream.commit.slice(0, 12)}`,
  contract,
);
const right = closurePath(values.right ?? `${contract.transport.outputRoot}/replay`, contract);

try {
  const leftInventory = inventory(left);
  const rightInventory = inventory(right);
  if (JSON.stringify(leftInventory) !== JSON.stringify(rightInventory)) {
    const leftByPath = new Map(leftInventory.map((row) => [row.path, row]));
    const rightByPath = new Map(rightInventory.map((row) => [row.path, row]));
    const paths = [...new Set([...leftByPath.keys(), ...rightByPath.keys()])].sort();
    const changed = paths.filter(
      (path) => JSON.stringify(leftByPath.get(path)) !== JSON.stringify(rightByPath.get(path)),
    );
    finish("FAIL", {
      command: "verify:dsh-source-replay",
      reason: "source closures are not recursively byte-identical",
      changed: changed.slice(0, 64),
      changedCount: changed.length,
    });
  }
  finish("PASS", {
    command: "verify:dsh-source-replay",
    files: leftInventory.length,
    bytes: leftInventory.reduce((sum, row) => sum + (row.size ?? 0), 0),
    inventorySha256: sha256(Buffer.from(JSON.stringify(leftInventory))),
  });
} catch (error) {
  finish("FAIL", { command: "verify:dsh-source-replay", reason: String(error) });
}
