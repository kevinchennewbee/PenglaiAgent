import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PluginDistributionClient, selectCatalogArtifact } from "@penglai/plugin-registry";
import { PINNED_PLUGIN_DSH, runtimePluginTarget } from "./plugin-catalog.js";

export interface BootRevokeResult {
  scanned: number;
  quarantined: string[];
  catalogLoaded: boolean;
}

function scopedPackageJson(profileDir: string, id: string): string | undefined {
  const file = join(profileDir, "node_modules", ...id.split("/"), "package.json");
  return existsSync(file) ? file : undefined;
}

function patchDisable(profileDir: string, pluginId: string): void {
  const patchPath = join(profileDir, "cordis.patch.yml");
  if (!existsSync(patchPath)) return;
  writeFileSync(patchPath, upsertDisabled(readFileSync(patchPath, "utf8"), pluginId), { mode: 0o600 });
}

function upsertDisabled(patchText: string, pluginId: string): string {
  const short = pluginId.replace(/^@/, "").replaceAll("/", "-");
  const endsWithNl = patchText.endsWith("\n");
  const lines = patchText.split("\n");
  const out: string[] = [];
  let block: string[] = [];
  let matches = 0;
  const flush = (): void => {
    if (!block.length) return;
    const text = block.join("\n");
    const hit = text.includes(`name: "${pluginId}"`) || text.includes(`name: '${pluginId}'`) || text.includes(`id: ${short}`);
    if (hit) {
      matches += 1;
      const idLine = block.find((line) => /^\s*-\s+id:\s+/.test(line)) ?? "";
      const idIndent = /^(\s*)/.exec(idLine)?.[1] ?? "    ";
      const fieldIndent = `${idIndent}  `;
      const kept = block.filter((line) => !/^\s*disabled:\s+/.test(line));
      while (kept.length && kept[kept.length - 1] === "") kept.pop();
      kept.push(`${fieldIndent}disabled: true`);
      out.push(...kept);
    } else {
      out.push(...block);
    }
    block = [];
  };
  for (const line of lines) {
    if (/^\s*-\s+id:\s+/.test(line)) flush();
    block.push(line);
  }
  flush();
  if (matches === 0) {
    const row = `    - id: ${short}\n      name: "${pluginId}"\n      disabled: true`;
    out.push(row);
  }
  const joined = out.join("\n");
  return endsWithNl && !joined.endsWith("\n") ? `${joined}\n` : joined;
}

/**
 * Scan installed profile packages against the last-good signed catalog and
 * disable/quarantine revoked versions before DSH loader starts.
 */
export function quarantineRevokedPlugins(opts: {
  userDataRoot: string;
  profileDir: string;
}): BootRevokeResult {
  const lastGoodPath = join(opts.userDataRoot, "plugins", "last-good-catalog.json");
  const trustPath = join(opts.userDataRoot, "plugins", "trust-state.json");
  if (!existsSync(lastGoodPath)) {
    return { scanned: 0, quarantined: [], catalogLoaded: false };
  }
  const client = new PluginDistributionClient({
    cacheRoot: join(opts.userDataRoot, "plugins", "cas"),
    trustPath,
    lastGoodPath,
    penglaiVersion: "0.5.3",
    dshExact: PINNED_PLUGIN_DSH,
  });
  const snap = client.snapshot();
  if (!snap) return { scanned: 0, quarantined: [], catalogLoaded: false };
  const quarantined: string[] = [];
  const nodeModules = join(opts.profileDir, "node_modules");
  const ids = new Set(snap.catalog.entries.map((entry) => entry.id));
  if (existsSync(nodeModules)) {
    for (const scope of readdirSync(nodeModules)) {
      const scoped = join(nodeModules, scope);
      if (scope.startsWith("@")) {
        for (const name of readdirSync(scoped)) ids.add(`${scope}/${name}`);
      } else if (!scope.startsWith(".")) {
        ids.add(scope);
      }
    }
  }
  for (const id of ids) {
    const pkgFile = scopedPackageJson(opts.profileDir, id);
    if (!pkgFile) continue;
    let version = "";
    try {
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as { name?: string; version?: string };
      if (pkg.name !== id || typeof pkg.version !== "string") continue;
      version = pkg.version;
    } catch {
      continue;
    }
    const entry = snap.catalog.entries.find((row) => row.id === id && row.version === version);
    let sha256 = "";
    try {
      if (entry?.artifacts.length) sha256 = selectCatalogArtifact(entry.artifacts, runtimePluginTarget()).sha256;
    } catch {
      sha256 = "";
    }
    if (!sha256) continue;
    if (client.revokedOnBoot(id, version, sha256)) {
      patchDisable(opts.profileDir, id);
      quarantined.push(`${id}@${version}`);
    }
  }
  return { scanned: ids.size, quarantined, catalogLoaded: true };
}
