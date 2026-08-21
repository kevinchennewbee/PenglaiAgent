import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finish } from "./lib/exit-contract.mjs";
import { PluginDistributionClient } from "../packages/plugin-registry/src/index.ts";

const expectedTag = process.argv[2] || "plugin-catalog-v1.000001";
const root = mkdtempSync(join(tmpdir(), "penglai-live-plugin-catalog-"));
const shared = {
  cacheRoot: join(root, "cas"),
  trustPath: join(root, "trust-state.json"),
  lastGoodPath: join(root, "last-good-catalog.json"),
  penglaiVersion: "0.5.1",
  dshExact: "0.1.1-rc.1",
  target: "darwin-aarch64",
};

let record;
try {
  const online = new PluginDistributionClient(shared);
  const snapshot = await online.refresh();
  const entry = snapshot.catalog.entries.find((row) => row.id === "@penglai/plugin-pilot");
  const pkg = await online.downloadPackage("@penglai/plugin-pilot");
  const offline = new PluginDistributionClient({
    ...shared,
    fetchImpl: async () => {
      throw new Error("offline verification path");
    },
  });
  const lastGood = await offline.refresh();
  const ok = Boolean(
    snapshot.source === "github-immutable" &&
      snapshot.tag === expectedTag &&
      snapshot.sequence >= 1 &&
      snapshot.signatureOk &&
      entry?.defaultEnabled === false &&
      entry.nativeCode === false &&
      entry.dsh.exact === "0.1.1-rc.1" &&
      pkg.id === entry.id &&
      pkg.version === entry.version &&
      pkg.sha256 === entry.artifacts[0]?.sha256 &&
      pkg.manifest.id === entry.id &&
      pkg.manifest.version === entry.version &&
      pkg.files.includes("package/index.js") &&
      pkg.files.includes("package/package.json") &&
      lastGood.source === "last-good-offline" &&
      lastGood.sequence === snapshot.sequence &&
      lastGood.digest === snapshot.digest &&
      lastGood.signatureOk,
  );
  record = {
    command: "verify-live-plugin-catalog",
    verdict: ok ? "PASS" : "FAIL",
    source: snapshot.source,
    tag: snapshot.tag,
    sequence: snapshot.sequence,
    digest: snapshot.digest,
    signatureOk: snapshot.signatureOk,
    plugin: {
      id: pkg.id,
      version: pkg.version,
      sha256: pkg.sha256,
      size: pkg.size,
      defaultEnabled: entry?.defaultEnabled,
      nativeCode: entry?.nativeCode,
      dsh: entry?.dsh.exact,
      files: pkg.files,
    },
    offlineLastGood: {
      source: lastGood.source,
      sequence: lastGood.sequence,
      digest: lastGood.digest,
      signatureOk: lastGood.signatureOk,
    },
  };
} catch (error) {
  record = {
    command: "verify-live-plugin-catalog",
    verdict: "FAIL",
    reason: error instanceof Error ? error.message : String(error),
  };
} finally {
  rmSync(root, { recursive: true, force: true });
}

finish(record.verdict, record);
