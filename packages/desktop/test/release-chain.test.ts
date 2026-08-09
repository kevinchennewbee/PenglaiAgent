import { afterEach, describe, expect, it } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import {
  CANONICAL_REPOSITORY,
  assertReleaseTag,
  assertReleaseContractIdentity,
  assertRepositoryVersions,
  expectedReleaseAssetNames,
  installerName,
  loadReleaseContract,
  releaseTag,
  unsignedReleaseAssetNames,
  updaterBundleName,
  verifyUpdaterSignature,
} from "../updater/release-contract.mjs";
import { verifyReleaseDirectory } from "../updater/verify-release-assets.mjs";
import { buildReleaseSbom } from "../updater/generate-sbom.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKFLOW_PATH = path.join(ROOT, ".github/workflows/host-release.yml");
const PUBLISH_WORKFLOW_PATH = path.join(ROOT, ".github/workflows/host-publish.yml");
const SIGNING_GATE_PATH = path.join(ROOT, "packages/desktop/scripts/require-release-signing.mjs");
const CONTRACT = loadReleaseContract();
const tempDirectories: string[] = [];

function fixtureSigner() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const keyId = crypto.randomBytes(8);
  const rawPublicKey = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);
  const publicRecord = Buffer.concat([Buffer.from("ED"), keyId, rawPublicKey]);
  const publicText = [
    `untrusted comment: minisign public key: ${Buffer.from(keyId).reverse().toString("hex").toUpperCase()}`,
    publicRecord.toString("base64"),
    "",
  ].join("\n");
  return {
    publicKey: Buffer.from(publicText).toString("base64"),
    sign(data: Buffer): string {
      const payload = crypto.createHash("blake2b512").update(data).digest();
      const signature = crypto.sign(null, payload, privateKey);
      const trustedComment = "timestamp:1\tfile:fixture";
      const globalSignature = crypto.sign(
        null,
        Buffer.concat([signature, Buffer.from(trustedComment)]),
        privateKey,
      );
      const signatureText = [
        "untrusted comment: signature from minisign secret key",
        Buffer.concat([Buffer.from("ED"), keyId, signature]).toString("base64"),
        `trusted comment: ${trustedComment}`,
        globalSignature.toString("base64"),
        "",
      ].join("\n");
      return Buffer.from(signatureText).toString("base64");
    },
  };
}

function write(file: string, value: string | Buffer): void {
  fs.writeFileSync(file, value);
}

function createUnsignedReleaseFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-release-chain-"));
  tempDirectories.push(directory);
  const signer = fixtureSigner();
  const signatures = new Map<string, string>();
  for (const platform of CONTRACT.platforms) {
    const bundle = updaterBundleName(platform, CONTRACT.version);
    const data = Buffer.from(`updater bundle ${bundle}\n`);
    const signature = signer.sign(data);
    write(path.join(directory, bundle), data);
    write(path.join(directory, `${bundle}.sig`), `${signature}\n`);
    signatures.set(platform.key, signature);
    if (platform.os === "macos") {
      const installer = installerName(platform, CONTRACT.version);
      const installerData = Buffer.from(`manual installer ${installer}\n`);
      write(path.join(directory, installer), installerData);
      write(path.join(directory, `${installer}.sig`), `${signer.sign(installerData)}\n`);
    }
  }
  for (const suffix of CONTRACT.standaloneRuntime.archiveSuffixes) {
    const name = `penglai-host-runtime-${CONTRACT.version}-${suffix}`;
    write(path.join(directory, name), `runtime ${name}\n`);
  }
  const platforms = Object.fromEntries(
    CONTRACT.platforms.map((platform) => {
      const bundle = updaterBundleName(platform, CONTRACT.version);
      return [
        platform.key,
        {
          signature: signatures.get(platform.key),
          url: `https://github.com/${CONTRACT.repository}/releases/download/${releaseTag(CONTRACT.version)}/${bundle}`,
        },
      ];
    }),
  );
  write(
    path.join(directory, "latest.json"),
    `${JSON.stringify(
      {
        version: CONTRACT.version,
        notes: "fixture",
        pub_date: "2026-08-01T00:00:00Z",
        platforms,
      },
      null,
      2,
    )}\n`,
  );
  write(
    path.join(directory, "SBOM.cdx.json"),
    `${JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      metadata: { component: { version: CONTRACT.version } },
      components: [{ name: "Node.js bundled runtime" }, { name: "fixture" }],
    })}\n`,
  );
  write(
    path.join(directory, "THIRD_PARTY_NOTICES.txt"),
    `${"Third-party dependency notice. ".repeat(8)}\n`,
  );
  return { directory, signer };
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("0.4 release identity contract", () => {
  it("locks every manifest and asset URL to the canonical public repository", () => {
    expect(CONTRACT.repository).toBe(CANONICAL_REPOSITORY);
    expect(() =>
      assertReleaseContractIdentity({
        ...CONTRACT,
        repository: "kevinchennewbee/PenglaiAgent-typo",
      }),
    ).toThrow(/release repository must remain/);
  });

  it("binds every package/lock/Tauri/Cargo surface to one exact version", () => {
    const versions = assertRepositoryVersions(ROOT, CONTRACT);
    expect(new Set(versions.values())).toEqual(new Set([CONTRACT.version]));
    expect(versions.size).toBeGreaterThanOrEqual(10);
  });

  it("accepts only the exact stable v0.4.x tag", () => {
    expect(assertReleaseTag(releaseTag(CONTRACT.version), CONTRACT)).toBe(CONTRACT.version);
    for (const tag of ["v0.4", "v0.4.0-rc.1", "v0.4.0+build", "v0.40.0", "v0.3.9"]) {
      expect(() => assertReleaseTag(tag, CONTRACT)).toThrow();
    }
  });

  it("uses the current macOS arm runner and exact target matrix", () => {
    expect(CONTRACT.platforms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "darwin-aarch64",
          runner: "macos-15",
          runnerArch: "ARM64",
          target: "aarch64-apple-darwin",
        }),
        expect.objectContaining({
          key: "darwin-x86_64",
          runner: "macos-15-intel",
          target: "x86_64-apple-darwin",
        }),
        expect.objectContaining({
          key: "windows-x86_64",
          runnerArch: "X64",
          target: "x86_64-pc-windows-msvc",
        }),
      ]),
    );
  });

  it("generates a CycloneDX inventory for npm, Cargo, and the bundled Node", () => {
    const sbom = buildReleaseSbom(ROOT) as {
      bomFormat: string;
      specVersion: string;
      metadata: { component: { version: string } };
      components: Array<{ name: string; version: string }>;
    };
    expect(sbom.bomFormat).toBe("CycloneDX");
    expect(sbom.specVersion).toBe("1.6");
    expect(sbom.metadata.component.version).toBe(CONTRACT.version);
    expect(sbom.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Node.js bundled runtime",
          version: CONTRACT.bundledNodeVersion,
        }),
        expect.objectContaining({ name: "tauri" }),
        expect.objectContaining({ name: "pi-agent-core" }),
      ]),
    );
  });
});

describe("cryptographic release asset gate", () => {
  it("verifies the real minisign envelope, exact files, manifest, SBOM, and SHA256SUMS", () => {
    const { directory, signer } = createUnsignedReleaseFixture();
    const written = verifyReleaseDirectory(directory, {
      version: CONTRACT.version,
      writeSha256: true,
      publicKey: signer.publicKey,
    });
    expect(written.assetCount).toBe(unsignedReleaseAssetNames(CONTRACT).length + 1);
    const sums = fs.readFileSync(path.join(directory, "SHA256SUMS"));
    write(path.join(directory, "SHA256SUMS.sig"), `${signer.sign(sums)}\n`);
    expect(
      verifyReleaseDirectory(directory, {
        version: CONTRACT.version,
        publicKey: signer.publicKey,
      }).assetCount,
    ).toBe(expectedReleaseAssetNames(CONTRACT).length);
  });

  it("rejects tampered payloads and unlisted release files", () => {
    const { directory, signer } = createUnsignedReleaseFixture();
    const firstBundle = updaterBundleName(CONTRACT.platforms[0], CONTRACT.version);
    fs.appendFileSync(path.join(directory, firstBundle), "tampered\n");
    expect(() =>
      verifyReleaseDirectory(directory, {
        version: CONTRACT.version,
        writeSha256: true,
        publicKey: signer.publicKey,
      }),
    ).toThrow(/signature verification failed/);

    const second = createUnsignedReleaseFixture();
    write(path.join(second.directory, "unexpected.txt"), "not in the contract\n");
    expect(() =>
      verifyReleaseDirectory(second.directory, {
        version: CONTRACT.version,
        writeSha256: true,
        publicKey: second.signer.publicKey,
      }),
    ).toThrow(/asset set mismatch/);
  });

  it("rejects updater metadata or asset URLs routed through a mutable proxy", () => {
    const { directory, signer } = createUnsignedReleaseFixture();
    const manifestPath = path.join(directory, "latest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      platforms: Record<string, { signature: string; url: string }>;
    };
    const first = CONTRACT.platforms[0].key;
    manifest.platforms[first].url = `https://gh-proxy.com/${manifest.platforms[first].url}`;
    write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(() =>
      verifyReleaseDirectory(directory, {
        version: CONTRACT.version,
        writeSha256: true,
        publicKey: signer.publicKey,
      }),
    ).toThrow(/updater URL is not immutable/);
  });

  it("rejects a signature made by any key other than the embedded release key", () => {
    const one = fixtureSigner();
    const other = fixtureSigner();
    const data = Buffer.from("payload");
    expect(() => verifyUpdaterSignature(data, one.sign(data), other.publicKey)).toThrow(
      /key id does not match/,
    );
  });
});

describe("host-release workflow policy", () => {
  const raw = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const workflow = parse(raw) as Record<string, any>;

  it("has a strict tag-only trigger and can write only a draft", () => {
    expect(workflow.on.push.tags).toEqual(["v0.4.*"]);
    expect(workflow.on.workflow_dispatch).toBeUndefined();
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.release.permissions).toEqual({ contents: "write" });
    expect(workflow.jobs.release.environment).toBe("release");
    expect(raw).toContain("Create draft release only");
    expect(raw).not.toContain("--draft=false");
    expect(raw).not.toContain("gh release upload");
  });

  it("pins every third-party action to a full commit", () => {
    const uses = [...raw.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use.split("@")[1]).toMatch(/^[0-9a-f]{40}$/);
  });

  it("validates signed annotated tag/target before an exact draft release", () => {
    for (const gate of [
      "git verify-tag --raw",
      "primary_fingerprints",
      "VALIDSIG",
      "signing_fingerprint",
      "primary_fingerprint",
      "git cat-file -t",
      'git rev-parse "$GITHUB_REF_NAME^{commit}"',
      "verify-release-assets.mjs",
      "SHA256SUMS.sig",
      "SBOM.cdx.json",
      "codesign --verify --deep --strict",
      "Signature=adhoc",
      "hdiutil verify",
      'readlink "$mountpoint/Applications"',
      "--draft",
      "desktop-v0.4",
    ]) {
      expect(raw).toContain(gate);
    }
    expect(raw).toContain('--repository "$GITHUB_REPOSITORY"');
    expect(raw).toContain('--repo "$GITHUB_REPOSITORY"');
    expect(raw.indexOf("--draft")).toBeLessThan(raw.indexOf("Download draft assets"));
    expect(raw).not.toMatch(/APPLE_(CERTIFICATE|SIGNING|ID)|WINDOWS_(CERTIFICATE|SIGNING)|notari[sz]e/i);
  });
});

describe("manual host-publish workflow policy", () => {
  const raw = fs.readFileSync(PUBLISH_WORKFLOW_PATH, "utf8");
  const workflow = parse(raw) as Record<string, any>;

  it("requires workflow_dispatch, a protected environment, and an exact confirmation", () => {
    expect(workflow.on.push).toBeUndefined();
    expect(workflow.on.workflow_dispatch.inputs.tag.required).toBe(true);
    expect(workflow.on.workflow_dispatch.inputs.confirm.required).toBe(true);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.publish.permissions).toEqual({ contents: "write" });
    expect(workflow.jobs.publish.environment).toBe("release");
    expect(raw).toContain('"publish-$PUBLISH_TAG"');
  });

  it("re-verifies the signed tag and draft assets before publishing", () => {
    for (const gate of [
      "git verify-tag --raw",
      "VALIDSIG",
      "verify-release-assets.mjs",
      "must exist as a non-prerelease draft",
      "Reject updater channel rollback",
      "--draft=false",
      "desktop-v0.4",
    ]) {
      expect(raw).toContain(gate);
    }
    expect(raw.indexOf("verify-release-assets.mjs")).toBeLessThan(raw.indexOf("--draft=false"));
  });

  it("pins every third-party action to a full commit", () => {
    const uses = [...raw.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use.split("@")[1]).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("release signing credential gate", () => {
  function runSigningGate(extraEnv: Record<string, string | undefined>) {
    const env = { ...process.env };
    delete env.TAURI_SIGNING_PRIVATE_KEY;
    delete env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
    for (const [key, value] of Object.entries(extraEnv)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    return spawnSync(process.execPath, [SIGNING_GATE_PATH], {
      env,
      encoding: "utf-8",
    });
  }

  it("fails closed without the private key", () => {
    const result = runSigningGate({});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("TAURI_SIGNING_PRIVATE_KEY");
  });

  it("accepts the same unencrypted-key mode used by the 0.3.6 release", () => {
    const result = runSigningGate({ TAURI_SIGNING_PRIVATE_KEY: "fixture-private-key" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("unencrypted-key mode");
  });

  it("also accepts an encrypted key with its password", () => {
    const result = runSigningGate({
      TAURI_SIGNING_PRIVATE_KEY: "fixture-private-key",
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "fixture-password",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("encrypted updater signing key");
  });
});
