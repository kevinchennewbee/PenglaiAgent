/** Classify Windows uninstall leftovers before any test cleanup. */

import { existsSync, lstatSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const UNINSTALLER_ONLY = new Set(["uninstall.exe", "uninstall.exe.nsis", "uninstall.log"]);

export function listInstallTreeFiles(root) {
  if (!existsSync(root)) return [];
  const out = [];
  function walk(dir, prefix) {
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const path = join(dir, name);
      try {
        const st = lstatSync(path);
        if (st.isSymbolicLink()) {
          out.push(rel);
          continue;
        }
        if (st.isDirectory()) walk(path, rel);
        else out.push(rel);
      } catch {
        /* racing deletes */
      }
    }
  }
  walk(root, "");
  return out;
}

export function classifyUninstallResidue(names) {
  const leftover = [...new Set((Array.isArray(names) ? names : []).map((name) => String(name ?? "").replace(/^[\\/]+/u, "")))].filter(Boolean);
  const payload = leftover.filter((name) => {
    const base = name.split(/[\\/]/u).pop() ?? name;
    if (UNINSTALLER_ONLY.has(base.toLowerCase())) return false;
    return true;
  });
  const uninstallerOnly = leftover.filter((name) => {
    const base = name.split(/[\\/]/u).pop() ?? name;
    return UNINSTALLER_ONLY.has(base.toLowerCase());
  });
  const payloadRemoved = payload.length === 0;
  return {
    leftover,
    payload,
    uninstallerOnly,
    payloadRemoved,
    uninstallRemovedApp: payloadRemoved,
  };
}

export function allowedTestCleanupNames(residue) {
  if (!residue?.payloadRemoved) return [];
  return residue.uninstallerOnly.slice();
}

export function removeUninstallerResidualOnly(root, residue) {
  if (!residue?.payloadRemoved) {
    throw new Error("refusing to clean an install tree that still has app payload");
  }
  for (const rel of allowedTestCleanupNames(residue)) {
    const path = join(root, ...rel.split("/"));
    if (existsSync(path)) unlinkSync(path);
  }
  function removeEmpty(dir) {
    if (!existsSync(dir)) return;
    const st = lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) return;
    for (const name of readdirSync(dir)) removeEmpty(join(dir, name));
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  }
  if (existsSync(root)) removeEmpty(root);
}
