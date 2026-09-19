import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AssistedUpdateCoordinator, type AssistedUpdateConfig } from "./update-coordinator.js";
import { crashSafeUpdate, downloadVerifiedPayload } from "./update-flow.js";
import {
  UPDATE_STATES,
  verifyManifestBytes,
  writeUpdateJournal,
  writeUpdateLedger,
  type UpdateManifest,
  type UpdateState,
} from "./update.js";

const TARGET = "darwin-aarch64";
const CURRENT = "0.5.0";
const NEXT = "0.5.1-test.1";
const MANIFEST_URL = "https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.2/update-manifest-v1.json";
const MANIFEST_SIGNATURE_URL = `${MANIFEST_URL}.sig`;

interface SignedFixture {
  privateKey: KeyObject;
  publicKeyHex: string;
  keyId: string;
  payload: Buffer;
  manifest: UpdateManifest;
  manifestBytes: Buffer;
  manifestSignature: Buffer;
}

function keys(): { privateKey: KeyObject; publicKeyHex: string; keyId: string } {
  const pair = generateKeyPairSync("ed25519");
  const rawPublic = pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  return {
    privateKey: pair.privateKey,
    publicKeyHex: Buffer.from(rawPublic).toString("hex"),
    keyId: createHash("sha256").update(rawPublic).digest("hex").slice(0, 24),
  };
}

/**
 * Data-root generation under test. Every fixture used to hardcode `"0.5"` here
 * *and* a `0.5.x` current version, so no test ever exercised a 0.6.x install.
 * That blind spot is why `update.ts` could require the semver minor to be `5`
 * for four shipped versions without a single failing test.
 */
const GENERATION = "penglai-dsh-v0.5";

function signedFixture(version = NEXT, current = CURRENT): SignedFixture {
  const identity = keys();
  const payload = Buffer.from(`fixture-installer:${version}`);
  const payloadSha = createHash("sha256").update(payload).digest("hex");
  const releaseIdentity = createHash("sha256").update(`release:${version}`).digest("hex");
  const manifest: UpdateManifest = {
    schemaVersion: 1,
    channel: "desktop-v0.5",
    version,
    minimumVersion: current,
    publishedAt: "2026-08-17T00:00:00.000Z",
    notesUrl: `https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v${version}`,
    signatureKeyId: identity.keyId,
    candidateSourceSha: "a".repeat(64),
    publicExportTreeSha256: "b".repeat(64),
    releaseManifestSha256: releaseIdentity,
    migration: {
      generation: GENERATION,
      fromVersion: current,
      throughVersion: current,
      toVersion: version,
    },
    platforms: {
      [TARGET]: {
        target: TARGET,
        kind: "dmg",
        version,
        url: `https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v${version}/Penglai_${version}_macos_aarch64.dmg`,
        sha256: payloadSha,
        signature: sign(null, payload, identity.privateKey).toString("base64"),
        size: payload.length,
        minimumOsVersion: "13.0",
        candidateSourceSha: "a".repeat(64),
        publicExportTreeSha256: "b".repeat(64),
        releaseManifestSha256: releaseIdentity,
      },
    },
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
  return {
    ...identity,
    payload,
    manifest,
    manifestBytes,
    manifestSignature: sign(null, manifestBytes, identity.privateKey),
  };
}

function response(bytes: Buffer, headers: Record<string, string> = {}): Response {
  return new Response(bytes, { status: 200, headers });
}

function fixtureFetch(fixture: SignedFixture): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === MANIFEST_URL) return response(fixture.manifestBytes);
    if (url === MANIFEST_SIGNATURE_URL) {
      return response(Buffer.from(fixture.manifestSignature.toString("base64"), "utf8"));
    }
    if (url === fixture.manifest.platforms[TARGET]?.url) {
      return response(fixture.payload, { "content-length": String(fixture.payload.length) });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function coordinatorConfig(
  root: string,
  fixture: SignedFixture,
  overrides: Partial<AssistedUpdateConfig> = {},
): AssistedUpdateConfig {
  return {
    currentVersion: CURRENT,
    target: TARGET,
    canonicalManifestUrl: MANIFEST_URL,
    canonicalManifestSignatureUrl: MANIFEST_SIGNATURE_URL,
    publicKeyHex: fixture.publicKeyHex,
    signatureKeyId: fixture.keyId,
    updatesRoot: join(root, "updates"),
    journalDir: join(root, "journal"),
    ledgerPath: join(root, "state", "update-ledger.json"),
    backupRoot: join(root, "backups"),
    manifestPolicy: {
      expectedCandidateSourceSha: fixture.manifest.candidateSourceSha,
      expectedPublicExportTreeSha256: fixture.manifest.publicExportTreeSha256,
      allowedAssetHosts: ["github.com"],
      currentOsVersion: "14.6",
      currentGeneration: GENERATION,
    },
    fetchImpl: fixtureFetch(fixture),
    discoverUpdates: false,
    ...overrides,
  };
}

test("R50-UPD-001..009 signed assisted update commits with optional IM disabled after explicit verified handoff", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-update-coordinator-"));
  const fixture = signedFixture();
  const opened: Array<{ path: string; kind: "dmg" | "setup" }> = [];
  const coordinator = new AssistedUpdateCoordinator(coordinatorConfig(root, fixture, {
    openInstaller: (path, kind) => opened.push({ path, kind }),
  }));

  assert.equal((await coordinator.check()).state, "AVAILABLE");
  assert.deepEqual(
    {
      version: coordinator.status().version,
      notesUrl: coordinator.status().notesUrl,
      size: coordinator.status().size,
      trustTier: coordinator.status().trustTier,
      confirmation: coordinator.status().requiresSystemInstallerConfirmation,
    },
    {
      version: NEXT,
      notesUrl: fixture.manifest.notesUrl,
      size: fixture.payload.length,
      trustTier: "community-verified",
      confirmation: true,
    },
  );
  assert.equal((await coordinator.download()).state, "READY_FOR_USER");
  const handedOff = await coordinator.confirmAndHandoff(
    { confirmed: true },
    {
      stopAndDrain: async () => ({
        dshRunning: false,
        asrBusy: false,
        ttsBusy: false,
        indexerBusy: false,
      }),
      backup: async ({ operationId }) => {
        const path = join(root, "backups", operationId);
        mkdirSync(path, { recursive: true });
        return { path };
      },
    },
  );
  assert.equal(handedOff.state, "RESTART_PENDING");
  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.kind, "dmg");
  assert.equal(readFileSync(opened[0]!.path).equals(fixture.payload), true);

  const committed = coordinator.postVerify({
    version: NEXT,
    runtimeIntegrity: true,
    profileReady: true,
    pluginsReady: true,
    dshHealthy: true,
  });
  assert.equal(committed.state, "COMMITTED");
  const ledger = JSON.parse(readFileSync(join(root, "state", "update-ledger.json"), "utf8")) as {
    version: string;
    signatureKeyId: string;
  };
  assert.equal(ledger.version, NEXT);
  assert.equal(ledger.signatureKeyId, fixture.keyId);
});

test("R50-UPD-002/003/004 signed manifest rejects tamper wrong key target replay generation OS and identity drift", () => {
  const fixture = signedFixture();
  const verify = (manifest: UpdateManifest, policy = {}) => {
    const bytes = Buffer.from(JSON.stringify(manifest), "utf8");
    return verifyManifestBytes({
      bytes,
      signature: sign(null, bytes, fixture.privateKey),
      publicKeyHex: fixture.publicKeyHex,
      currentVersion: CURRENT,
      target: TARGET,
      policy: {
        trustedKeyId: fixture.keyId,
        expectedCandidateSourceSha: "a".repeat(64),
        expectedPublicExportTreeSha256: "b".repeat(64),
        allowedAssetHosts: ["github.com"],
        currentOsVersion: "14.6",
        currentGeneration: GENERATION,
        ...policy,
      },
    });
  };

  const tampered = Buffer.from(fixture.manifestBytes);
  tampered[tampered.length - 2] ^= 1;
  assert.throws(
    () => verifyManifestBytes({
      bytes: tampered,
      signature: fixture.manifestSignature,
      publicKeyHex: fixture.publicKeyHex,
      currentVersion: CURRENT,
      target: TARGET,
    }),
    /signature mismatch/,
  );
  const wrong = keys();
  assert.throws(
    () => verifyManifestBytes({
      bytes: fixture.manifestBytes,
      signature: fixture.manifestSignature,
      publicKeyHex: wrong.publicKeyHex,
      currentVersion: CURRENT,
      target: TARGET,
    }),
    /signature mismatch/,
  );
  assert.throws(() => verify({ ...fixture.manifest, schemaVersion: 2 as 1 }), /schema/);
  assert.throws(() => verify({ ...fixture.manifest, signatureKeyId: "rotated-key" }), /signing key/);
  assert.throws(() => verify({ ...fixture.manifest, candidateSourceSha: "c".repeat(64) }), /source identity/);
  assert.throws(
    () => verify({
      ...fixture.manifest,
      migration: { ...fixture.manifest.migration, fromVersion: NEXT },
    }),
    /migration range/,
  );
  assert.throws(
    () => verify(fixture.manifest, { currentOsVersion: "12.6" }),
    /below update minimum/,
  );
  assert.throws(
    () => verifyManifestBytes({
      bytes: fixture.manifestBytes,
      signature: fixture.manifestSignature,
      publicKeyHex: fixture.publicKeyHex,
      currentVersion: CURRENT,
      target: "win32-x86_64",
    }),
    /platform missing/,
  );
  const same = signedFixture(CURRENT);
  assert.throws(
    () => verifyManifestBytes({
      bytes: same.manifestBytes,
      signature: same.manifestSignature,
      publicKeyHex: same.publicKeyHex,
      currentVersion: CURRENT,
      target: TARGET,
    }),
    /same-version replay/,
  );
});

test("R50-UPD-005 downloader fails closed on redirect truncation oversize and wrong resume range", async () => {
  const fixture = signedFixture();
  const asset = fixture.manifest.platforms[TARGET]!;
  const invoke = (root: string, fetchImpl: typeof fetch) => downloadVerifiedPayload({
    url: asset.url,
    destDir: root,
    expectedSha256: asset.sha256,
    expectedSize: asset.size,
    signature: Buffer.from(asset.signature, "base64"),
    publicKeyHex: fixture.publicKeyHex,
    fetchImpl,
    resume: true,
  });

  await assert.rejects(
    invoke(mkdtempSync(join(tmpdir(), "penglai-update-redirect-evil-")), (async () =>
      new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } })) as typeof fetch),
    /host not allowed|redirect refused/,
  );
  const github302 = mkdtempSync(join(tmpdir(), "penglai-update-redirect-ok-"));
  const hops: string[] = [];
  const cdn = "https://objects.githubusercontent.com/github-production-release-asset-2e65be/Penglai.dmg";
  const got = await downloadVerifiedPayload({
    url: asset.url,
    destDir: github302,
    expectedSha256: asset.sha256,
    expectedSize: asset.size,
    signature: Buffer.from(asset.signature, "base64"),
    publicKeyHex: fixture.publicKeyHex,
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      hops.push(`${init?.method ?? "GET"}:${String(input)}`);
      if (String(input) === asset.url) {
        return new Response(null, { status: 302, headers: { location: cdn } });
      }
      if (String(input) === cdn) {
        if (init?.method === "HEAD") return new Response(null, { status: 200, headers: { "content-length": String(asset.size) } });
        return response(fixture.payload, { "content-length": String(fixture.payload.length) });
      }
      return new Response("no", { status: 404 });
    }) as typeof fetch,
  });
  assert.equal(got.bytes, fixture.payload.length);
  assert.ok(hops.some((row) => row.startsWith("HEAD:")));
  assert.ok(hops.some((row) => row.includes("objects.githubusercontent.com")));
  await assert.rejects(
    invoke(mkdtempSync(join(tmpdir(), "penglai-update-short-")), (async () =>
      response(fixture.payload.subarray(0, -1))) as typeof fetch),
    /size mismatch/,
  );
  await assert.rejects(
    invoke(mkdtempSync(join(tmpdir(), "penglai-update-long-")), (async () =>
      response(Buffer.concat([fixture.payload, Buffer.from("x")]))) as typeof fetch),
    /exceeded declared size/,
  );
  const resumeRoot = mkdtempSync(join(tmpdir(), "penglai-update-range-"));
  const prefix = fixture.payload.subarray(0, 4);
  writeFileSync(join(resumeRoot, `${asset.sha256}.dmg.part`), prefix, { mode: 0o600 });
  await assert.rejects(
    invoke(resumeRoot, (async (_input: string | URL | Request, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("range");
      if (init?.method === "HEAD" || !range) {
        return new Response(null, { status: 200, headers: { "content-length": String(asset.size) } });
      }
      assert.equal(range, `bytes=${prefix.length}-`);
      return new Response(fixture.payload.subarray(prefix.length), {
        status: 206,
        headers: {
          "content-range": `bytes 0-${asset.size - 1}/${asset.size}`,
          "content-length": String(asset.size - prefix.length),
        },
      });
    }) as typeof fetch),
    /Content-Range mismatch/,
  );
});

test("R50-UPD-005 cancel is durable and cannot become a ready payload", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-update-cancel-"));
  const fixture = signedFixture();
  const normalFetch = fixtureFetch(fixture);
  let holdPayload = false;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!holdPayload || url !== fixture.manifest.platforms[TARGET]?.url) {
      return normalFetch(input, init);
    }
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    });
  }) as typeof fetch;
  const coordinator = new AssistedUpdateCoordinator(coordinatorConfig(root, fixture, { fetchImpl }));
  await coordinator.check();
  holdPayload = true;
  const pending = coordinator.download();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(
    { state: coordinator.cancel().state, errorClass: coordinator.status().errorClass },
    { state: "FAILED", errorClass: "CANCELLED" },
  );
  await assert.rejects(pending, /cancel|abort/i);
  assert.deepEqual(
    { state: coordinator.status().state, errorClass: coordinator.status().errorClass },
    { state: "FAILED", errorClass: "CANCELLED" },
  );
});

async function readyCoordinator(root: string): Promise<AssistedUpdateCoordinator> {
  const fixture = signedFixture();
  const coordinator = new AssistedUpdateCoordinator(coordinatorConfig(root, fixture, {
    openInstaller: () => undefined,
  }));
  await coordinator.check();
  await coordinator.download();
  return coordinator;
}

test("R50-UPD-007 drain and app-private backup are hard gates", async () => {
  const busy = await readyCoordinator(mkdtempSync(join(tmpdir(), "penglai-update-busy-")));
  await assert.rejects(
    busy.confirmAndHandoff(
      { confirmed: true },
      {
        stopAndDrain: async () => ({
          dshRunning: true,
          asrBusy: false,
          ttsBusy: false,
          indexerBusy: false,
        }),
        backup: async () => ({ path: "/tmp/never-called" }),
      },
    ),
    /still busy/,
  );
  assert.equal(busy.status().state, "RECOVERY_REQUIRED");

  const root = mkdtempSync(join(tmpdir(), "penglai-update-backup-"));
  const escaped = await readyCoordinator(root);
  await assert.rejects(
    escaped.confirmAndHandoff(
      { confirmed: true },
      {
        stopAndDrain: async () => ({
          dshRunning: false,
          asrBusy: false,
          ttsBusy: false,
          indexerBusy: false,
        }),
        backup: async () => ({ path: join(root, "outside-backups") }),
      },
    ),
    /backup escaped/,
  );
  assert.equal(escaped.status().state, "RECOVERY_REQUIRED");
});

test("R50-UPD-004/009/010 ledger and every crash state fail closed", async () => {
  const fixture = signedFixture(CURRENT);
  const root = mkdtempSync(join(tmpdir(), "penglai-update-ledger-"));
  writeUpdateLedger(join(root, "state", "update-ledger.json"), {
    schema: 1,
    version: "0.5.1",
    manifestSha256: "d".repeat(64),
    signatureKeyId: fixture.keyId,
    committedAt: "2026-08-17T00:00:00.000Z",
  });
  const coordinator = new AssistedUpdateCoordinator(coordinatorConfig(root, fixture));
  await assert.rejects(coordinator.check(), /installed app version was rolled back/);
  assert.equal(coordinator.status().state, "FAILED");

  const expected = new Map<UpdateState, UpdateState>([
    ["IDLE", "IDLE"],
    ["CHECKING", "IDLE"],
    ["CURRENT", "CURRENT"],
    ["FAILED", "FAILED"],
    ["AVAILABLE", "IDLE"],
    ["DOWNLOADING", "IDLE"],
    ["VERIFYING", "IDLE"],
    ["READY_FOR_USER", "IDLE"],
    ["INSTALL_REQUESTED", "ROLLED_BACK"],
    ["DRAINING_DSH", "ROLLED_BACK"],
    ["DATA_BACKUP_READY", "ROLLED_BACK"],
    ["HANDOFF_TO_INSTALLER", "RECOVERY_REQUIRED"],
    ["RESTART_PENDING", "RESTART_PENDING"],
    ["POST_UPDATE_VERIFY", "POST_UPDATE_VERIFY"],
    ["COMMITTED", "COMMITTED"],
    ["ROLLED_BACK", "ROLLED_BACK"],
    ["RECOVERY_REQUIRED", "RECOVERY_REQUIRED"],
  ]);
  assert.equal(expected.size, UPDATE_STATES.length);
  for (const state of UPDATE_STATES) {
    assert.equal(crashSafeUpdate({ operationId: "crash-state", state, drained: false }), expected.get(state));
  }

  const supersededRoot = mkdtempSync(join(tmpdir(), "penglai-update-superseded-"));
  writeUpdateJournal(join(supersededRoot, "journal"), {
    operationId: "failed-0.5.2",
    state: "RECOVERY_REQUIRED",
    previousVersion: "0.5.1",
    version: "0.5.2",
    target: TARGET,
    drained: true,
    errorClass: "POST_VERIFY_FAILED",
  });
  const superseded = new AssistedUpdateCoordinator(coordinatorConfig(supersededRoot, fixture, {
    currentVersion: "0.5.3",
  }));
  const reconciled = superseded.recoverOnLaunch();
  assert.equal(reconciled.state, "CURRENT");
  assert.equal(reconciled.version, "0.5.3");
  assert.equal(reconciled.errorClass, undefined);
});

test("completed updates resume normal discovery after launch and reject version regression", async () => {
  const fixture = signedFixture(CURRENT);
  for (const currentVersion of [CURRENT, "0.4.9"]) {
    const root = mkdtempSync(join(tmpdir(), "penglai-update-committed-"));
    writeUpdateJournal(join(root, "journal"), {
      operationId: "completed-upgrade", state: "COMMITTED", version: CURRENT,
      previousVersion: CURRENT, target: TARGET, drained: true,
    });
    const coordinator = new AssistedUpdateCoordinator(coordinatorConfig(root, fixture, { currentVersion }));
    const recovered = coordinator.recoverOnLaunch();
    assert.equal(recovered.state, currentVersion === CURRENT ? "CURRENT" : "RECOVERY_REQUIRED");
    if (currentVersion === CURRENT) assert.equal((await coordinator.check()).state, "CURRENT");
    else await assert.rejects(coordinator.check(), /cannot check update/);
  }
});

test("a 0.6.x install in the same data generation can discover and prepare an update", async () => {
  // Regression pin for the shipped defect. `assertUpdateManifest` required the
  // semver MINOR of both current and target to be `5`, so from the 0.6.0 version
  // bump onward every real update check threw "update crossed clean-generation
  // boundary". The desktop surfaced only the generic localised "更新操作失败" /
  // "Update operation failed" string, and the state machine never reached
  // AVAILABLE. Four releases shipped in that state because every fixture here
  // used a 0.5.x current version.
  const root = mkdtempSync(join(tmpdir(), "penglai-update-generation-"));
  const fixture = signedFixture("0.6.5", "0.6.3");
  const coordinator = new AssistedUpdateCoordinator(
    coordinatorConfig(root, fixture, { currentVersion: "0.6.3" }),
  );

  const checked = await coordinator.check();
  assert.equal(checked.state, "AVAILABLE");
  assert.equal(checked.version, "0.6.5");

  const downloaded = await coordinator.download();
  assert.equal(downloaded.state, "READY_FOR_USER");
  assert.equal(downloaded.version, "0.6.5");
});

test("an update whose manifest declares a different data generation is refused", async () => {
  // The boundary that replaced the version literal must still hold: a manifest
  // from another data generation is rejected even when its version is newer.
  const fixture = signedFixture("0.6.5", "0.6.3");
  const foreign: SignedFixture = {
    ...fixture,
    manifest: {
      ...fixture.manifest,
      migration: { ...fixture.manifest.migration, generation: "penglai-dsh-v0.6" },
    },
  };
  const bytes = Buffer.from(JSON.stringify(foreign.manifest), "utf8");
  await assert.rejects(
    async () =>
      verifyManifestBytes({
        bytes,
        signature: sign(null, bytes, foreign.privateKey),
        publicKeyHex: foreign.publicKeyHex,
        currentVersion: "0.6.3",
        target: TARGET,
        policy: {
          allowedAssetHosts: ["github.com"],
          currentOsVersion: "14.6",
          currentGeneration: GENERATION,
        },
      }),
    /clean-generation boundary/,
  );
});

test("an update check without a known data generation fails closed", async () => {
  // Removing the version literal must not remove the boundary. When the running
  // generation cannot be established the check refuses rather than proceeding.
  const fixture = signedFixture("0.6.5", "0.6.3");
  await assert.rejects(
    async () =>
      verifyManifestBytes({
        bytes: fixture.manifestBytes,
        signature: fixture.manifestSignature,
        publicKeyHex: fixture.publicKeyHex,
        currentVersion: "0.6.3",
        target: TARGET,
        policy: { allowedAssetHosts: ["github.com"], currentOsVersion: "14.6" },
      }),
    /current data generation is unknown/,
  );
});
