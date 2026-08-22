import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import {
  VerifiedInstallerHandoff,
  assertCanonicalManifestUrl,
  assertUpdateLedgerAllows,
  assertUpdateManifest,
  compareSemver,
  readUpdateJournal,
  readUpdateLedger,
  verifyManifestBytes,
  writeUpdateJournal,
  writeUpdateLedger,
  type UpdateAsset,
  type UpdateJournal,
  type UpdateManifest,
  type UpdateManifestPolicy,
  type UpdateState,
} from "./update.js";
import { crashSafeUpdate, downloadVerifiedPayload, drainOwnedServices } from "./update-flow.js";
import {
  appListUrl,
  discoverSignedAppUpdate,
  EMBEDDED_UPDATER_PUBLIC_KEY,
} from "@penglai/plugin-registry";

export interface OwnedServiceState {
  dshRunning: boolean;
  asrBusy: boolean;
  ttsBusy: boolean;
  indexerBusy: boolean;
  companionArmed: boolean;
}

export interface AssistedUpdateHooks {
  stopAndDrain(): Promise<OwnedServiceState>;
  backup(input: {
    operationId: string;
    fromVersion: string;
    toVersion: string;
  }): Promise<{ path: string }>;
}

export interface PostUpdateFacts {
  version: string;
  runtimeIntegrity: boolean;
  profileReady: boolean;
  pluginsReady: boolean;
  dshHealthy: boolean;
  installerCancelled?: boolean;
}

export interface UpdateCoordinatorStatus {
  state: UpdateState;
  operationId?: string;
  version?: string;
  notesUrl?: string;
  size?: number;
  target: string;
  trustTier: "community-verified";
  requiresSystemInstallerConfirmation: true;
  errorClass?: string;
}

export interface AssistedUpdateConfig {
  currentVersion: string;
  target: string;
  canonicalManifestUrl: string;
  canonicalManifestSignatureUrl: string;
  publicKeyHex: string;
  signatureKeyId: string;
  updatesRoot: string;
  journalDir: string;
  ledgerPath: string;
  backupRoot: string;
  trustPath?: string;
  discoverUpdates?: boolean;
  manifestPolicy?: Omit<UpdateManifestPolicy, "trustedKeyId" | "allowCurrentCheck">;
  fetchImpl?: typeof fetch;
  handoff?: VerifiedInstallerHandoff;
  openInstaller?: (path: string, kind: "dmg" | "setup") => void;
}

function childOf(root: string, child: string): boolean {
  const rel = relative(resolve(root), resolve(child));
  return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel);
}

function decodeManifestSignature(bytes: Buffer): Buffer {
  if (bytes.length === 64) return bytes;
  const encoded = bytes.toString("utf8").trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new PenglaiError("SECURITY_POLICY", "manifest signature encoding invalid");
  }
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== encoded) {
    throw new PenglaiError("SECURITY_POLICY", "manifest signature encoding invalid");
  }
  return decoded;
}

function withoutError(journal: UpdateJournal): UpdateJournal {
  const copy = { ...journal };
  delete copy.errorClass;
  return copy;
}

async function fetchExactBytes(
  url: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const response = await fetchImpl(url, {
    redirect: "manual",
    ...(signal ? { signal } : {}),
  });
  if (
    response.status !== 200 ||
    response.redirected ||
    (response.url && response.url !== url)
  ) {
    throw new PenglaiError(
      response.status >= 300 && response.status < 400 ? "SECURITY_POLICY" : "DELIVERY_TRANSIENT",
      `update metadata fetch refused: ${response.status}`,
    );
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && (!Number.isSafeInteger(Number(declared)) || Number(declared) > maxBytes)) {
    throw new PenglaiError("SECURITY_POLICY", "update metadata exceeded size bound");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) {
    throw new PenglaiError("SECURITY_POLICY", "update metadata size invalid");
  }
  return bytes;
}

export class AssistedUpdateCoordinator {
  readonly #config: AssistedUpdateConfig;
  readonly #handoff: VerifiedInstallerHandoff;
  #manifest: UpdateManifest | undefined;
  #manifestDigest: string | undefined;
  #asset: UpdateAsset | undefined;
  #downloadedPath: string | undefined;
  #abort: AbortController | undefined;
  #journal: UpdateJournal;

  constructor(config: AssistedUpdateConfig) {
    for (const path of [config.updatesRoot, config.journalDir, config.ledgerPath, config.backupRoot]) {
      if (!isAbsolute(path)) throw new PenglaiError("SECURITY_POLICY", "update paths must be absolute");
    }
    if (config.discoverUpdates !== false) {
      const list = new URL(appListUrl());
      if (list.href !== appListUrl()) {
        throw new PenglaiError("SECURITY_POLICY", "non-canonical update discovery URL");
      }
    } else {
      assertCanonicalManifestUrl(config.canonicalManifestUrl, config.canonicalManifestUrl);
      assertCanonicalManifestUrl(config.canonicalManifestSignatureUrl, config.canonicalManifestSignatureUrl);
    }
    if (!config.signatureKeyId || !/^[0-9a-f]{64}$/i.test(config.publicKeyHex)) {
      throw new PenglaiError("SECURITY_POLICY", "trusted updater identity required");
    }
    mkdirSync(config.updatesRoot, { recursive: true, mode: 0o700 });
    mkdirSync(config.journalDir, { recursive: true, mode: 0o700 });
    mkdirSync(config.backupRoot, { recursive: true, mode: 0o700 });
    this.#config = config;
    this.#handoff = config.handoff ?? new VerifiedInstallerHandoff(config.updatesRoot, config.publicKeyHex);
    const prior = readUpdateJournal(config.journalDir);
    this.#journal = prior ?? {
      operationId: `upd_${randomBytes(16).toString("hex")}`,
      state: "IDLE",
      drained: false,
    };
  }

  status(): UpdateCoordinatorStatus {
    const version = this.#manifest?.version ?? this.#journal.version;
    return {
      state: this.#journal.state,
      operationId: this.#journal.operationId,
      ...(version ? { version } : {}),
      ...(this.#manifest ? { notesUrl: this.#manifest.notesUrl } : {}),
      ...(this.#asset ? { size: this.#asset.size } : {}),
      target: this.#config.target,
      trustTier: "community-verified",
      requiresSystemInstallerConfirmation: true,
      ...(this.#journal.errorClass ? { errorClass: this.#journal.errorClass } : {}),
    };
  }

  recoverOnLaunch(): UpdateCoordinatorStatus {
    if (
      this.#journal.state === "RECOVERY_REQUIRED" &&
      this.#journal.version &&
      compareSemver(this.#config.currentVersion, this.#journal.version) > 0
    ) {
      this.#journal = {
        operationId: this.#journal.operationId,
        state: "CURRENT",
        previousVersion: this.#journal.version,
        version: this.#config.currentVersion,
        target: this.#config.target,
        drained: false,
      };
      this.#persist();
      return this.status();
    }
    const recovered = crashSafeUpdate(this.#journal);
    if (recovered !== this.#journal.state) {
      this.#journal = {
        ...this.#journal,
        state: recovered,
        drained: false,
        errorClass: "CRASH_RECOVERY",
      };
      this.#persist();
    }
    return this.status();
  }

  async check(): Promise<UpdateCoordinatorStatus> {
    if (!["IDLE", "CURRENT", "FAILED", "ROLLED_BACK"].includes(this.#journal.state)) {
      throw new PenglaiError("INVALID_INPUT", `cannot check update from ${this.#journal.state}`);
    }
    this.#journal = {
      operationId: `upd_${randomBytes(16).toString("hex")}`,
      state: "CHECKING",
      previousVersion: this.#config.currentVersion,
      target: this.#config.target,
      drained: false,
    };
    this.#persist();
    const controller = new AbortController();
    this.#abort = controller;
    try {
      const fetchImpl = this.#config.fetchImpl ?? fetch;
      let version: string;
      let digest: string;
      let signatureKeyId = this.#config.signatureKeyId;
      if (this.#config.discoverUpdates !== false) {
        const found = await discoverSignedAppUpdate({
          currentVersion: this.#config.currentVersion,
          fetchImpl,
          publicKeyHex: this.#config.publicKeyHex || EMBEDDED_UPDATER_PUBLIC_KEY.publicKeyHex,
          signingKeyId: this.#config.signatureKeyId || EMBEDDED_UPDATER_PUBLIC_KEY.keyId,
          ...(this.#config.trustPath ? { trustPath: this.#config.trustPath } : {}),
        });
        if (!found) {
          this.#journal = {
            ...this.#journal,
            state: "CURRENT",
            version: this.#config.currentVersion,
          };
          this.#persist();
          return this.status();
        }
        const platform = found.manifest.platforms[this.#config.target];
        if (!platform) throw new PenglaiError("INVALID_INPUT", "platform missing");
        version = found.manifest.version;
        const expectedFilename =
          this.#config.target === "darwin-aarch64"
            ? `Penglai_${version}_macos_aarch64.dmg`
            : this.#config.target === "darwin-x86_64"
              ? `Penglai_${version}_macos_x64.dmg`
              : `Penglai_${version}_windows_x64_setup.exe`;
        const githubAsset = found.assets.find((row) => row.name === expectedFilename);
        if (!githubAsset || githubAsset.id !== platform.assetId || githubAsset.size !== platform.size) {
          throw new PenglaiError("SECURITY_POLICY", "update asset identity does not match GitHub release");
        }
        digest = found.digest;
        signatureKeyId = found.manifest.signingKeyId;
        this.#manifestDigest = digest;
        this.#asset = {
          target: this.#config.target,
          kind: this.#config.target.startsWith("darwin-") ? "dmg" : "setup",
          version,
          url: platform.url,
          sha256: platform.sha256,
          signature: platform.signature,
          size: platform.size,
          minimumOsVersion: "13.0",
          candidateSourceSha: found.manifest.candidateSourceSha,
          publicExportTreeSha256: found.manifest.publicExportTreeSha256,
          releaseManifestSha256: digest,
        };
        this.#manifest = {
          schemaVersion: 1,
          channel: "desktop-v0.5",
          version,
          minimumVersion: found.manifest.minimumSourceVersion,
          publishedAt: found.manifest.issuedAt,
          notesUrl: found.manifest.notesUrl,
          signatureKeyId,
          candidateSourceSha: found.manifest.candidateSourceSha,
          publicExportTreeSha256: found.manifest.publicExportTreeSha256,
          releaseManifestSha256: digest,
          migration: {
            generation: "0.5",
            fromVersion: found.manifest.minimumSourceVersion,
            throughVersion: this.#config.currentVersion,
            toVersion: version,
          },
          platforms: { [this.#config.target]: this.#asset },
        };
        assertUpdateManifest(this.#manifest, this.#config.currentVersion, this.#config.target, {
          ...this.#config.manifestPolicy,
          trustedKeyId: signatureKeyId,
          allowCurrentCheck: true,
        });
      } else {
        const [bytes, signatureBytes] = await Promise.all([
          fetchExactBytes(this.#config.canonicalManifestUrl, fetchImpl, 1024 * 1024, controller.signal),
          fetchExactBytes(this.#config.canonicalManifestSignatureUrl, fetchImpl, 1024, controller.signal),
        ]);
        const verified = verifyManifestBytes({
          bytes,
          signature: decodeManifestSignature(signatureBytes),
          publicKeyHex: this.#config.publicKeyHex,
          currentVersion: this.#config.currentVersion,
          target: this.#config.target,
          policy: {
            ...this.#config.manifestPolicy,
            trustedKeyId: this.#config.signatureKeyId,
            allowCurrentCheck: true,
          },
        });
        version = verified.manifest.version;
        digest = verified.digest;
        signatureKeyId = verified.manifest.signatureKeyId;
        this.#manifest = verified.manifest;
        this.#manifestDigest = digest;
        this.#asset = verified.manifest.platforms[this.#config.target]!;
      }
      const ledger = readUpdateLedger(this.#config.ledgerPath);
      if (ledger) {
        if (ledger.signatureKeyId !== this.#config.signatureKeyId && ledger.signatureKeyId !== signatureKeyId) {
          throw new PenglaiError("SECURITY_POLICY", "installed update ledger signing key mismatch");
        }
        const installedOrder = compareSemver(this.#config.currentVersion, ledger.version);
        if (installedOrder < 0) {
          throw new PenglaiError("SECURITY_POLICY", "installed app version was rolled back");
        }
        if (
          installedOrder === 0 &&
          compareSemver(version, this.#config.currentVersion) === 0 &&
          digest !== ledger.manifestSha256
        ) {
          throw new PenglaiError("SECURITY_POLICY", "same-version manifest replay mismatch");
        }
      }
      if (compareSemver(version, this.#config.currentVersion) === 0) {
        this.#journal = {
          ...this.#journal,
          state: "CURRENT",
          version,
          manifestSha256: digest,
        };
        this.#persist();
        return this.status();
      }
      assertUpdateLedgerAllows(ledger, version, digest, signatureKeyId);
      this.#journal = {
        ...this.#journal,
        state: "AVAILABLE",
        version,
        manifestSha256: digest,
        payloadSha256: this.#asset.sha256,
      };
      this.#persist();
      return this.status();
    } catch (error) {
      this.#journal = {
        ...this.#journal,
        state: "FAILED",
        errorClass: controller.signal.aborted
          ? "CANCELLED"
          : error instanceof PenglaiError
            ? error.errorClass
            : "DELIVERY_TRANSIENT",
      };
      this.#persist();
      throw error;
    } finally {
      if (this.#abort === controller) this.#abort = undefined;
    }
  }

  async download(): Promise<UpdateCoordinatorStatus> {
    if (this.#journal.state !== "AVAILABLE" || !this.#manifest || !this.#asset || !this.#manifestDigest) {
      throw new PenglaiError("INVALID_INPUT", "no verified update is available");
    }
    this.#journal = { ...withoutError(this.#journal), state: "DOWNLOADING" };
    this.#persist();
    const controller = new AbortController();
    this.#abort = controller;
    try {
      const result = await downloadVerifiedPayload({
        url: this.#asset.url,
        destDir: resolve(this.#config.updatesRoot, this.#journal.operationId),
        expectedSha256: this.#asset.sha256,
        expectedSize: this.#asset.size,
        signature: Buffer.from(this.#asset.signature, "base64"),
        publicKeyHex: this.#config.publicKeyHex,
        ...(this.#config.fetchImpl ? { fetchImpl: this.#config.fetchImpl } : {}),
        resume: true,
        signal: controller.signal,
      });
      this.#downloadedPath = result.path;
      this.#journal = { ...this.#journal, state: "VERIFYING" };
      this.#persist();
      this.#journal = { ...this.#journal, state: "READY_FOR_USER" };
      this.#persist();
      return this.status();
    } catch (error) {
      this.#journal = {
        ...this.#journal,
        state: "FAILED",
        errorClass: controller.signal.aborted
          ? "CANCELLED"
          : error instanceof PenglaiError
            ? error.errorClass
            : "DELIVERY_TRANSIENT",
      };
      this.#persist();
      throw error;
    } finally {
      if (this.#abort === controller) this.#abort = undefined;
    }
  }

  cancel(): UpdateCoordinatorStatus {
    this.#abort?.abort("user cancelled update operation");
    if (this.#journal.state === "CHECKING" || this.#journal.state === "DOWNLOADING") {
      this.#journal = { ...this.#journal, state: "FAILED", errorClass: "CANCELLED" };
      this.#persist();
    }
    return this.status();
  }

  cancelDownload(): UpdateCoordinatorStatus {
    return this.cancel();
  }

  async confirmAndHandoff(
    input: { confirmed: true },
    hooks: AssistedUpdateHooks,
  ): Promise<UpdateCoordinatorStatus> {
    if (input.confirmed !== true || this.#journal.state !== "READY_FOR_USER" || !this.#asset || !this.#downloadedPath) {
      throw new PenglaiError("SECURITY_POLICY", "verified update requires explicit confirmation");
    }
    try {
      this.#journal = { ...withoutError(this.#journal), state: "INSTALL_REQUESTED" };
      this.#persist();
      this.#journal = { ...this.#journal, state: "DRAINING_DSH" };
      this.#persist();
      const serviceState = await hooks.stopAndDrain();
      drainOwnedServices(serviceState);
      this.#journal = { ...this.#journal, drained: true };
      this.#persist();
      const backup = await hooks.backup({
        operationId: this.#journal.operationId,
        fromVersion: this.#config.currentVersion,
        toVersion: this.#manifest!.version,
      });
      if (!isAbsolute(backup.path) || !childOf(this.#config.backupRoot, backup.path)) {
        throw new PenglaiError("SECURITY_POLICY", "update backup escaped app-private root");
      }
      const backupStat = lstatSync(backup.path);
      if (backupStat.isSymbolicLink() || !backupStat.isDirectory()) {
        throw new PenglaiError("SECURITY_POLICY", "update backup must be a regular directory");
      }
      this.#journal = { ...this.#journal, state: "DATA_BACKUP_READY", backupPath: resolve(backup.path) };
      this.#persist();
      this.#handoff.register({
        operationId: this.#journal.operationId,
        path: this.#downloadedPath,
        sha256: this.#asset.sha256,
        size: this.#asset.size,
        signature: Buffer.from(this.#asset.signature, "base64"),
      });
      this.#journal = { ...this.#journal, state: "HANDOFF_TO_INSTALLER" };
      this.#persist();
      this.#handoff.open(
        this.#journal.operationId,
        this.#config.openInstaller ? { open: this.#config.openInstaller } : {},
      );
      this.#journal = { ...this.#journal, state: "RESTART_PENDING" };
      this.#persist();
      return this.status();
    } catch (error) {
      this.#journal = {
        ...this.#journal,
        state: "RECOVERY_REQUIRED",
        errorClass: error instanceof PenglaiError ? error.errorClass : "DELIVERY_TRANSIENT",
      };
      this.#persist();
      throw error;
    }
  }

  postVerify(facts: PostUpdateFacts): UpdateCoordinatorStatus {
    const expected = this.#journal.version;
    if (!expected || !["RESTART_PENDING", "POST_UPDATE_VERIFY"].includes(this.#journal.state)) {
      return this.status();
    }
    if (facts.installerCancelled && facts.version === this.#journal.previousVersion) {
      this.#journal = { ...this.#journal, state: "ROLLED_BACK", drained: false, errorClass: "INSTALLER_CANCELLED" };
      this.#persist();
      return this.status();
    }
    this.#journal = { ...this.#journal, state: "POST_UPDATE_VERIFY" };
    this.#persist();
    const healthy = facts.version === expected &&
      facts.runtimeIntegrity &&
      facts.profileReady &&
      facts.pluginsReady &&
      facts.dshHealthy;
    if (!healthy || !this.#journal.manifestSha256) {
      this.#journal = { ...this.#journal, state: "RECOVERY_REQUIRED", errorClass: "POST_VERIFY_FAILED" };
      this.#persist();
      return this.status();
    }
    writeUpdateLedger(this.#config.ledgerPath, {
      schema: 1,
      version: expected,
      manifestSha256: this.#journal.manifestSha256,
      signatureKeyId: this.#config.signatureKeyId,
      committedAt: new Date().toISOString(),
    });
    this.#journal = { ...withoutError(this.#journal), state: "COMMITTED", drained: false };
    this.#persist();
    return this.status();
  }

  #persist(): void {
    writeUpdateJournal(this.#config.journalDir, this.#journal);
  }
}
