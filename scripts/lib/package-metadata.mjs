import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Resolve installed package metadata without requiring a main export.
 * Workspace-root and linked node_modules win over Node's specifier resolver
 * so exports-only packages (no "main") still audit.
 */
export function resolvePackageMetadata(packageName, resolver, fromDir, workspaceRoot = process.cwd()) {
  const parts = String(packageName).split("/");
  const candidates = [];
  if (fromDir) candidates.push(join(fromDir, "node_modules", ...parts));
  if (workspaceRoot) candidates.push(join(workspaceRoot, "node_modules", ...parts));
  for (const linked of candidates) {
    const pkgFile = join(linked, "package.json");
    if (!existsSync(pkgFile)) continue;
    const root = dirname(realpathSync(pkgFile));
    return { root, metadata: JSON.parse(readFileSync(join(root, "package.json"), "utf8")) };
  }
  if (workspaceRoot) {
    for (const group of ["packages", "apps"]) {
      const groupDir = join(workspaceRoot, group);
      if (!existsSync(groupDir)) continue;
      for (const name of readdirSync(groupDir)) {
        const pkgFile = join(groupDir, name, "package.json");
        if (!existsSync(pkgFile)) continue;
        const metadata = JSON.parse(readFileSync(pkgFile, "utf8"));
        if (metadata.name === packageName) {
          return { root: dirname(realpathSync(pkgFile)), metadata };
        }
      }
    }
  }
  if (resolver?.resolve?.paths) {
    try {
      for (const searchPath of resolver.resolve.paths(packageName) ?? []) {
        const candidate = join(searchPath, ...parts, "package.json");
        if (!existsSync(candidate)) continue;
        const metadata = JSON.parse(readFileSync(candidate, "utf8"));
        if (metadata.name === packageName) {
          return { root: dirname(realpathSync(candidate)), metadata };
        }
      }
    } catch {
      /* resolve.paths can throw for invalid specifiers */
    }
  }
  if (resolver && typeof resolver.resolve === "function") {
    for (const spec of [`${packageName}/package.json`, packageName]) {
      try {
        let cursor = dirname(resolver.resolve(spec));
        for (let depth = 0; depth < 10; depth += 1) {
          const candidate = join(cursor, "package.json");
          if (existsSync(candidate)) {
            const metadata = JSON.parse(readFileSync(candidate, "utf8"));
            if (metadata.name === packageName) return { root: cursor, metadata };
          }
          const parent = dirname(cursor);
          if (parent === cursor) break;
          cursor = parent;
        }
      } catch {
        /* exports-only packages throw ERR_PACKAGE_PATH_NOT_EXPORTED on resolve(name) */
      }
    }
  }
  throw new Error(`cannot resolve package metadata for ${packageName}`);
}
