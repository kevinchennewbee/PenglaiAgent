import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import {
  acceptMonotonic,
  assertInstallAllowed,
  assertManifestMatchesCatalog,
  canonicalize,
  compareSemver,
  inspectPluginEntries,
  parseAppUpdateManifest,
  parseSignedPluginCatalog,
  publicKeyHexFromKey,
  readTrustState,
  selectHighestAppRelease,
  selectHighestCatalogRelease,
  signBytes,
  verifySignedCatalog,
} from "./index.js";

test("version comparison uses a linear numeric-prefix parser", () => {
  assert.equal(compareSemver("0.5.1", "0.5.0"), 1);
  assert.equal(compareSemver("0.5.1-rc.1", "0.5.1"), 0);
  assert.equal(compareSemver(`1.${"/".repeat(100_000)}x.0`, "1.0.0"), 0);
});

function keys() {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyHex = publicKeyHexFromKey(pair.publicKey);
  return { ...pair, publicKeyHex, signingKeyId: publicKeyHex.slice(0, 24) };
}

function catalogJson(overrides: Record<string, unknown> = {}) {
  return {
    schema: "penglai.plugin-catalog.v1",
    catalogId: "stable",
    sequence: 2,
    issuedAt: "2026-08-21T00:00:00.000Z",
    expiresAt: "2026-09-21T00:00:00.000Z",
    centerProtocol: 1,
    signingKeyId: "abc",
    entries: [
      {
        id: "@penglai/plugin-pilot",
        version: "1.0.0",
        title: { en: "Pilot", "zh-CN": "试点" },
        summary: { en: "Echo.", "zh-CN": "回显。" },
        publisher: "Penglai",
        provenanceClass: "community-reviewed",
        license: "MIT",
        dsh: { exact: "0.1.1-rc.1" },
        minPenglai: "0.5.1",
        capabilities: ["pilot-echo"],
        permissions: [],
        defaultEnabled: false,
        entry: "dist/index.js",
        targets: ["any"],
        nativeCode: false,
        networkOrigins: [],
        dataPaths: [],
        artifacts: [
          {
            target: "any",
            releaseTag: "plugin-pilot-v1.0.0",
            assetId: 1,
            url: "https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/download/plugin-pilot-v1.0.0/penglai-plugin-pilot-1.0.0-any.tgz",
            size: 12,
            sha256: "a".repeat(64),
            signatureAsset: "penglai-plugin-pilot-1.0.0-any.tgz.sig",
          },
        ],
        migration: "none",
        rollback: "last-good-profile",
      },
    ],
    revocations: [],
    ...overrides,
  };
}

test("P51-UPDATE-001 PUDP identity refuses zero SHA placeholders", () => {
  assert.throws(
    () =>
      parseAppUpdateManifest({
        schema: "penglai.app-update.v1",
        sequence: 2,
        version: "0.5.2",
        channel: "stable",
        releaseTag: "v0.5.2",
        issuedAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2026-10-01T00:00:00.000Z",
        signingKeyId: "k",
        minimumSourceVersion: "0.5.1",
        notesUrl: "https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.2",
        candidateSourceSha: "0".repeat(64),
        publicExportTreeSha256: "b".repeat(64),
        platforms: {
          "darwin-aarch64": {
            assetId: 1,
            url: "https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.2/Penglai_0.5.2_macos_aarch64.dmg",
            size: 10,
            sha256: "a".repeat(64),
            signature: "c2ln",
          },
        },
        migration: { fromSchema: 5, toSchema: 6, backupRequired: true, rollbackCompatible: true },
      }),
    /real digest|sha256/,
  );
});

test("P51-SUPPLY-001 signed catalog verifies canonical bytes and rejects tamper", () => {
  const identity = keys();
  const json = catalogJson({ signingKeyId: identity.signingKeyId });
  const bytes = Buffer.from(canonicalize(json), "utf8");
  const signature = signBytes(bytes, identity.privateKey);
  const verified = verifySignedCatalog({
    json,
    signature,
    publicKeyHex: identity.publicKeyHex,
    signingKeyId: identity.signingKeyId,
    nowMs: Date.parse("2026-08-22T00:00:00.000Z"),
  });
  assert.equal(verified.catalog.sequence, 2);
  const tampered = { ...json, sequence: 3 };
  assert.throws(
    () =>
      verifySignedCatalog({
        json: tampered,
        signature,
        publicKeyHex: identity.publicKeyHex,
        signingKeyId: identity.signingKeyId,
        nowMs: Date.parse("2026-08-22T00:00:00.000Z"),
      }),
    PenglaiError,
  );
});

test("P51-SUPPLY-001 rejects latest.json, expired, defaultEnabled, and DSH drift", () => {
  assert.throws(
    () =>
      parseSignedPluginCatalog(
        catalogJson({
          entries: [
            {
              ...catalogJson().entries[0],
              artifacts: [
                {
                  ...catalogJson().entries[0]!.artifacts[0],
                  url: "https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/download/latest/x.tgz",
                  releaseTag: "latest",
                },
              ],
            },
          ],
        }),
      ),
    /latest|immutable/,
  );
  assert.throws(
    () => parseSignedPluginCatalog(catalogJson({ expiresAt: "2020-01-01T00:00:00.000Z" })),
    /expired|timestamps/,
  );
  assert.throws(
    () =>
      parseSignedPluginCatalog(
        catalogJson({
          entries: [{ ...catalogJson().entries[0], defaultEnabled: true }],
        }),
      ),
    /defaultEnabled/,
  );
  assert.throws(
    () =>
      parseSignedPluginCatalog(
        catalogJson({
          entries: [{ ...catalogJson().entries[0], dsh: { exact: "0.1.0-rc.7" } }],
        }),
      ),
    /DSH/,
  );
});

test("P51-SUPPLY-001 trust ledger refuses downgrade and same-sequence digest change", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-trust-"));
  const path = join(dir, "trust-state.json");
  acceptMonotonic({ path, kind: "plugin-catalog", sequence: 2, keyEpoch: 1, digest: "a".repeat(64) });
  assert.throws(
    () => acceptMonotonic({ path, kind: "plugin-catalog", sequence: 1, keyEpoch: 1, digest: "b".repeat(64) }),
    /rollback/,
  );
  assert.throws(
    () => acceptMonotonic({ path, kind: "plugin-catalog", sequence: 2, keyEpoch: 1, digest: "c".repeat(64) }),
    /different digest/,
  );
});

test("P51-SUPPLY-001 archive policy rejects native code, scripts, and permission drift", () => {
  assert.throws(
    () =>
      inspectPluginEntries([
        { path: "package.json", kind: "file", data: Buffer.from("{}") },
        { path: "addon.node", kind: "file", data: Buffer.from("x") },
      ]),
    /native/,
  );
  assert.throws(
    () =>
      inspectPluginEntries([
        {
          path: "package.json",
          kind: "file",
          data: Buffer.from(
            JSON.stringify({ scripts: { postinstall: "curl evil" }, penglaiPlugin: { schema: 2, nativeCode: false } }),
          ),
        },
      ]),
    /lifecycle/,
  );
  const manifest = inspectPluginEntries([
    {
      path: "package.json",
      kind: "file",
      data: Buffer.from(
        JSON.stringify({
          penglaiPlugin: {
            schema: 2,
            id: "@penglai/plugin-pilot",
            version: "1.0.0",
            dshExact: "0.1.1-rc.1",
            centerProtocol: 1,
            entry: "dist/index.js",
            capabilities: ["pilot-echo"],
            permissions: [],
            nativeCode: false,
            installScripts: false,
            targets: ["any"],
            networkOrigins: [],
            dataPaths: [],
            license: "MIT",
          },
        }),
      ),
    },
  ]).manifest;
  assert.throws(
    () =>
      assertManifestMatchesCatalog({
        catalogId: "@penglai/plugin-pilot",
        catalogVersion: "1.0.0",
        catalogPermissions: ["workspace-write"],
        catalogCapabilities: ["pilot-echo"],
        catalogDsh: "0.1.1-rc.1",
        manifest,
      }),
    /permissions/,
  );
});

test("P51-SUPPLY-001 critical revocation blocks install", () => {
  const catalog = parseSignedPluginCatalog(
    catalogJson({
      revocations: [
        {
          id: "@penglai/plugin-pilot",
          version: "1.0.0",
          sha256: "a".repeat(64),
          severity: "critical",
          reason: "test",
          advisory: "stop",
        },
      ],
    }),
    Date.parse("2026-08-22T00:00:00.000Z"),
  );
  assert.throws(() => assertInstallAllowed(catalog, "@penglai/plugin-pilot", "1.0.0", "a".repeat(64)), /revoked/);
});

test("P51-UPDATE-001 PUDP/1 rejects latest.json and mutable releases", () => {
  assert.throws(
    () =>
      parseAppUpdateManifest({
        schema: "penglai.app-update.v1",
        sequence: 2,
        version: "0.5.2",
        channel: "stable",
        releaseTag: "v0.5.2",
        issuedAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2026-10-01T00:00:00.000Z",
        signingKeyId: "k",
        minimumSourceVersion: "0.5.1",
        notesUrl: "https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.2",
        candidateSourceSha: "a".repeat(64),
        publicExportTreeSha256: "b".repeat(64),
        platforms: {
          "darwin-aarch64": {
            assetId: 1,
            url: "https://github.com/kevinchennewbee/PenglaiAgent/releases/download/desktop-v0.5/latest.json",
            size: 10,
            sha256: "a".repeat(64),
            signature: "sig",
          },
        },
        migration: { fromSchema: 5, toSchema: 6, backupRequired: true, rollbackCompatible: true },
      }),
    /immutable|latest/,
  );
  const chosen = selectHighestAppRelease(
    [
      { tag_name: "v0.5.2", draft: false, prerelease: false, immutable: true, assets: [] },
      { tag_name: "v0.5.3", draft: false, prerelease: false, immutable: false, assets: [] },
    ],
    "0.5.1",
  );
  assert.equal(chosen?.tag, "v0.5.2");
  assert.throws(
    () =>
      selectHighestCatalogRelease([
        { tag_name: "plugin-catalog-v1.000001", draft: false, prerelease: false, immutable: false, assets: [] },
      ]),
    /immutable/,
  );
});

test("canonical JSON is key-order insensitive", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), canonicalize({ a: 2, b: 1 }));
});

test("corrupt trust ledger fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-trust-corrupt-"));
  const path = join(dir, "trust-state.json");
  writeFileSync(path, "{not json");
  assert.throws(() => readTrustState(path), /STORE_CORRUPT|unreadable|malformed/);
  writeFileSync(path, JSON.stringify({ schema: 1, kind: "plugin-catalog" }));
  assert.throws(() => readTrustState(path), /malformed/);
});

test("malicious tar corpus is rejected before install", async () => {
  const { inspectTarGz } = await import("./tar.js");
  const { gzipSync } = await import("node:zlib");
  const block = Buffer.alloc(512);
  block.write("../evil.js");
  block[156] = 0x30;
  const size = Buffer.from("00000000001 ");
  size.copy(block, 124);
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += i >= 148 && i < 156 ? 0x20 : block[i] ?? 0;
  Buffer.from(sum.toString(8).padStart(6, "0") + "\0 ").copy(block, 148);
  const tar = Buffer.concat([block, Buffer.alloc(512), Buffer.alloc(1024)]);
  assert.throws(() => inspectTarGz(gzipSync(tar)), /escape|unsafe|forbidden|checksum/);
});

test("last-good catalog without original signature bytes is unusable", async () => {
  const { PluginDistributionClient } = await import("./host.js");
  const dir = mkdtempSync(join(tmpdir(), "penglai-lkg-"));
  writeFileSync(
    join(dir, "last-good.json"),
    JSON.stringify({
      source: "github-immutable",
      catalog: catalogJson(),
      digest: "a".repeat(64),
    }),
  );
  const client = new PluginDistributionClient({
    cacheRoot: join(dir, "cas"),
    trustPath: join(dir, "trust.json"),
    lastGoodPath: join(dir, "last-good.json"),
    penglaiVersion: "0.5.1",
  });
  assert.throws(() => client.snapshot(), /signature bytes|unusable/);
});

test("PPDP/1 host refresh uses embedded keys and last-good offline", async () => {
  const { PluginDistributionClient } = await import("./host.js");
  const identity = keys();
  const json = catalogJson({ signingKeyId: identity.signingKeyId });
  const bytes = Buffer.from(canonicalize(json), "utf8");
  const signature = signBytes(bytes, identity.privateKey);
  const dir = mkdtempSync(join(tmpdir(), "penglai-ppdp-"));
  const fetchImpl = (async (input) => {
    const url = String(input);
    if (url.includes("/releases") && !url.includes("/assets/")) {
      return new Response(
        JSON.stringify([
          {
            tag_name: "plugin-catalog-v1.000002",
            draft: false,
            prerelease: false,
            immutable: true,
            assets: [
              {
                id: 11,
                name: "plugin-catalog-v1.json",
                browser_download_url:
                  "https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/download/plugin-catalog-v1.000002/plugin-catalog-v1.json",
                size: bytes.length,
              },
              {
                id: 12,
                name: "plugin-catalog-v1.json.sig",
                browser_download_url:
                  "https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/download/plugin-catalog-v1.000002/plugin-catalog-v1.json.sig",
                size: signature.length,
              },
            ],
          },
        ]),
        { status: 200 },
      );
    }
    if (url.endsWith("/releases/assets/11") || url.endsWith("plugin-catalog-v1.json")) {
      return new Response(bytes, { status: 200 });
    }
    if (url.endsWith("/releases/assets/12") || url.endsWith("plugin-catalog-v1.json.sig")) {
      return new Response(signature, { status: 200 });
    }
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  const client = new PluginDistributionClient({
    cacheRoot: join(dir, "cas"),
    trustPath: join(dir, "trust.json"),
    lastGoodPath: join(dir, "last-good.json"),
    penglaiVersion: "0.5.1",
    fetchImpl,
    nowMs: () => Date.parse("2026-08-22T00:00:00.000Z"),
  });
  await assert.rejects(() => client.refresh(), /embedded plugin key|signingKeyId|signature mismatch/);
});

test("GitHub 302 to official asset host is followed and hashed", async () => {
  const { downloadVerifiedBytes } = await import("./download.js");
  const body = Buffer.from("penglai-asset");
  const sha = createHash("sha256").update(body).digest("hex");
  const hops: string[] = [];
  const fetchImpl = (async (input) => {
    hops.push(String(input));
    if (String(input).includes("github.com/kevinchennewbee/PenglaiPluginRegistry/releases/download/")) {
      return new Response(null, {
        status: 302,
        headers: {
          location:
            "https://objects.githubusercontent.com/github-production-release-asset-2e65be/file?token=1",
        },
      });
    }
    if (String(input).includes("objects.githubusercontent.com")) {
      return new Response(body, { status: 200, headers: { "content-length": String(body.length) } });
    }
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  const got = await downloadVerifiedBytes({
    url: "https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/download/plugin-pilot-v1.0.0/penglai-plugin-pilot-1.0.0-any.tgz",
    sha256: sha,
    size: body.length,
    assetId: 123,
    ownerRepo: "kevinchennewbee/PenglaiPluginRegistry",
    maxBytes: 1024,
    fetchImpl,
  });
  assert.equal(got.equals(body), true);
  assert.equal(hops.length, 2);
  assert.equal(hops[0]?.startsWith("https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/download/"), true);
  assert.equal(hops.some((url) => url.includes("api.github.com/repos/")), false);
});

test("GitHub 302 to a non-GitHub host is refused", async () => {
  const { downloadVerifiedBytes } = await import("./download.js");
  const fetchImpl = (async () =>
    new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/steal" },
    })) as typeof fetch;
  await assert.rejects(
    () =>
      downloadVerifiedBytes({
        url: "https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/download/plugin-pilot-v1.0.0/penglai-plugin-pilot-1.0.0-any.tgz",
        sha256: "a".repeat(64),
        size: 12,
        maxBytes: 1024,
        skipHash: true,
        fetchImpl,
      }),
    /host not allowed/,
  );
});

void sign;
void createHash;
