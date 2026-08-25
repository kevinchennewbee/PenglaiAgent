import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finish } from "./lib/exit-contract.mjs";
import {
  PluginDistributionClient,
  pluginDistributionStatePaths,
} from "../packages/plugin-registry/src/index.ts";
import { quarantineRevokedPlugins } from "../packages/runtime/src/index.ts";

const expectedTag = process.argv[2] || "plugin-catalog-v1.000006";
const retiredPlugin = process.argv[3] || "@penglai/office-reader";
const retiredVersion = process.argv[4] || "0.1.3";
const retiredSha256 =
  process.argv[5] ||
  "db67f2b85a3be99c5a6789d971618c09ea0f7c6497d19a6599389e0b806d507e";
const replacement = "@penglai/office";
const expectedSequenceMatch = /^plugin-catalog-v1\.(\d{6})$/.exec(expectedTag);
if (!expectedSequenceMatch) throw new Error("expected catalog tag is invalid");
const expectedSequence = Number(expectedSequenceMatch[1]);
const root = mkdtempSync(join(tmpdir(), "penglai-live-plugin-catalog-"));
const userDataRoot = join(root, "user-data");
const githubToken = process.env.GITHUB_TOKEN?.trim();
const authenticatedGithubApiFetch = async (input, init = {}) => {
  const requestUrl = new URL(
    input instanceof Request ? input.url : String(input),
  );
  if (!githubToken || requestUrl.hostname !== "api.github.com") {
    return fetch(input, init);
  }
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined,
  );
  new Headers(init.headers).forEach((value, name) =>
    headers.set(name, value),
  );
  headers.set("authorization", `Bearer ${githubToken}`);
  headers.set("x-github-api-version", "2022-11-28");
  return fetch(input, { ...init, headers });
};
const shared = {
  ...pluginDistributionStatePaths(userDataRoot),
  penglaiVersion: "0.5.7",
  dshExact: "0.1.1-rc.2",
  target: "darwin-aarch64",
  fetchImpl: authenticatedGithubApiFetch,
};

let record;
try {
  const online = new PluginDistributionClient(shared);
  const snapshot = await online.refresh();
  const revocation = snapshot.catalog.revocations.find(
    (row) =>
      row.id === retiredPlugin &&
      row.version === retiredVersion &&
      row.sha256 === retiredSha256,
  );
  const retiredEntry = snapshot.catalog.entries.find(
    (row) => row.id === retiredPlugin,
  );

  const profileDir = join(userDataRoot, "dsh-home", "profiles", "web");
  const packageDir = join(
    profileDir,
    "node_modules",
    ...retiredPlugin.split("/"),
  );
  mkdirSync(packageDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(packageDir, "package.json"),
    `${JSON.stringify({ name: retiredPlugin, version: retiredVersion })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    join(profileDir, "cordis.patch.yml"),
    `- insert:\n    - id: penglai-office-reader\n      name: "${retiredPlugin}"\n      disabled: false\n`,
    { mode: 0o600 },
  );
  const quarantine = quarantineRevokedPlugins({ userDataRoot, profileDir });
  const patch = readFileSync(join(profileDir, "cordis.patch.yml"), "utf8");
  const migrationOk =
    quarantine.catalogLoaded === true &&
    quarantine.quarantined.includes(
      `${retiredPlugin}@${retiredVersion}`,
    ) &&
    /name:\s+["']@penglai\/office-reader["'][\s\S]*disabled:\s+true/.test(
      patch,
    );

  const offline = new PluginDistributionClient({
    ...shared,
    fetchImpl: async () => {
      throw new Error("offline verification path");
    },
  });
  const lastGood = await offline.refresh();
  const ok = Boolean(
    (snapshot.source === "github-immutable" ||
      snapshot.source === "github-signed-tag-fallback") &&
      snapshot.tag === expectedTag &&
      snapshot.sequence === expectedSequence &&
      snapshot.signatureOk &&
      retiredEntry === undefined &&
      revocation?.severity === "critical" &&
      revocation.replacement === replacement &&
      migrationOk &&
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
    entries: snapshot.catalog.entries.map((row) => ({
      id: row.id,
      version: row.version,
    })),
    retirement: {
      id: retiredPlugin,
      version: retiredVersion,
      sha256: retiredSha256,
      absentFromCatalog: retiredEntry === undefined,
      severity: revocation?.severity,
      replacement: revocation?.replacement,
      quarantinedOnBoot: migrationOk,
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
