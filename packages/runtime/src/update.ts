import { spawn } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { PenglaiError } from "@penglai/contracts";

export const UPDATE_STATES = [
  "IDLE",
  "CHECKING",
  "CURRENT",
  "FAILED",
  "AVAILABLE",
  "DOWNLOADING",
  "VERIFYING",
  "READY_FOR_USER",
  "INSTALL_REQUESTED",
  "DRAINING_DSH",
  "DATA_BACKUP_READY",
  "HANDOFF_TO_INSTALLER",
  "RESTART_PENDING",
  "POST_UPDATE_VERIFY",
  "COMMITTED",
  "ROLLED_BACK",
  "RECOVERY_REQUIRED",
] as const;

export type UpdateState = (typeof UPDATE_STATES)[number];

export interface UpdateManifest {
  schemaVersion: 1;
  channel: "desktop-v0.5";
  version: string;
  minimumVersion: string;
  publishedAt: string;
  notesUrl: string;
  signatureKeyId: string;
  candidateSourceSha: string;
  publicExportTreeSha256: string;
  releaseManifestSha256: string;
  migration: {
    generation: "0.5";
    fromVersion: string;
    throughVersion: string;
    toVersion: string;
  };
  platforms: Record<string, UpdateAsset>;
}

export interface UpdateAsset {
  target: string;
  kind: "dmg" | "setup";
  version: string;
  url: string;
  sha256: string;
  signature: string;
  size: number;
  minimumOsVersion: string;
  candidateSourceSha: string;
  publicExportTreeSha256: string;
  releaseManifestSha256: string;
}

export interface UpdateManifestPolicy {
  trustedKeyId?: string;
  expectedCandidateSourceSha?: string;
  expectedPublicExportTreeSha256?: string;
  allowedAssetHosts?: string[];
  allowCurrentCheck?: boolean;
  currentOsVersion?: string;
}

const UPDATE_TARGETS = ["darwin-aarch64", "darwin-x86_64", "win32-x86_64"] as const;

function assertSha(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value) || /^0{64}$/.test(value)) {
    throw new PenglaiError("SECURITY_POLICY", `${label} sha256 invalid`);
  }
}

function decodeSignature(value: unknown, label: string): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new PenglaiError("SECURITY_POLICY", `${label} signature invalid`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== value) {
    throw new PenglaiError("SECURITY_POLICY", `${label} signature invalid`);
  }
  return decoded;
}

function immutableHttpsUrl(value: unknown, label: string, allowCanonicalLatest = false): URL {
  if (typeof value !== "string") throw new PenglaiError("SECURITY_POLICY", `${label} URL invalid`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PenglaiError("SECURITY_POLICY", `${label} URL invalid`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    (!allowCanonicalLatest && /(^|[/_.-])latest([/_.-]|$)/i.test(parsed.pathname))
  ) {
    throw new PenglaiError("SECURITY_POLICY", `mutable or non-https ${label} URL`);
  }
  return parsed;
}

export function assertCanonicalManifestUrl(actual: string, canonical?: string): void {
  const got = immutableHttpsUrl(actual, "manifest", false);
  if (got.hostname !== "github.com" && got.hostname !== "api.github.com") {
    throw new PenglaiError("SECURITY_POLICY", "non-canonical update manifest host");
  }
  if (!got.pathname.includes("/kevinchennewbee/PenglaiAgent/releases/")) {
    throw new PenglaiError("SECURITY_POLICY", "non-canonical update manifest path");
  }
  if (canonical) {
    const expected = immutableHttpsUrl(canonical, "canonical manifest", false);
    if (got.href !== expected.href) {
      throw new PenglaiError("SECURITY_POLICY", "non-canonical update manifest URL");
    }
  }
}

export function assertUpdateManifest(
  raw: unknown,
  currentVersion: string,
  target: string,
  policy: UpdateManifestPolicy = {},
): UpdateManifest {
  if (!raw || typeof raw !== "object") throw new PenglaiError("INVALID_INPUT", "manifest");
  const o = raw as UpdateManifest;
  if (o.schemaVersion !== 1) throw new PenglaiError("INVALID_INPUT", "manifest schema");
  if (o.channel !== "desktop-v0.5") throw new PenglaiError("SECURITY_POLICY", "wrong channel");
  if (!(UPDATE_TARGETS as readonly string[]).includes(target)) {
    throw new PenglaiError("SECURITY_POLICY", "unsupported update target");
  }
  parseSemver(o.version);
  parseSemver(o.minimumVersion);
  if (!o.platforms?.[target]) throw new PenglaiError("INVALID_INPUT", "platform missing");
  const asset = o.platforms[target]!;
  immutableHttpsUrl(asset.url, "asset");
  const versionOrder = compareSemver(o.version, currentVersion);
  if (versionOrder < 0 || (versionOrder === 0 && !policy.allowCurrentCheck)) {
    throw new PenglaiError("SECURITY_POLICY", "downgrade or same-version replay");
  }
  if (compareSemver(currentVersion, o.minimumVersion) < 0) {
    throw new PenglaiError("SECURITY_POLICY", "below minimum");
  }
  const currentCore = parseSemver(currentVersion).core;
  const nextCore = parseSemver(o.version).core;
  if (currentCore[0] !== 0 || currentCore[1] !== 5 || nextCore[0] !== 0 || nextCore[1] !== 5) {
    throw new PenglaiError("SECURITY_POLICY", "update crossed clean-generation boundary");
  }
  if (!o.signatureKeyId || o.signatureKeyId.length > 128) {
    throw new PenglaiError("SECURITY_POLICY", "manifest signing key id missing");
  }
  if (policy.trustedKeyId && o.signatureKeyId !== policy.trustedKeyId) {
    throw new PenglaiError("SECURITY_POLICY", "wrong manifest signing key id");
  }
  if (!Number.isFinite(Date.parse(o.publishedAt))) {
    throw new PenglaiError("INVALID_INPUT", "manifest publishedAt invalid");
  }
  immutableHttpsUrl(o.notesUrl, "release notes");
  assertSha(o.candidateSourceSha, "candidate source");
  assertSha(o.publicExportTreeSha256, "public export tree");
  assertSha(o.releaseManifestSha256, "release manifest");
  if (policy.expectedCandidateSourceSha && o.candidateSourceSha !== policy.expectedCandidateSourceSha) {
    throw new PenglaiError("SECURITY_POLICY", "candidate source identity mismatch");
  }
  if (policy.expectedPublicExportTreeSha256 && o.publicExportTreeSha256 !== policy.expectedPublicExportTreeSha256) {
    throw new PenglaiError("SECURITY_POLICY", "public export identity mismatch");
  }
  if (
    o.migration?.generation !== "0.5" ||
    o.migration.toVersion !== o.version
  ) {
    throw new PenglaiError("SECURITY_POLICY", "update migration identity mismatch");
  }
  parseSemver(o.migration.fromVersion);
  parseSemver(o.migration.throughVersion);
  if (
    compareSemver(o.migration.fromVersion, currentVersion) > 0 ||
    compareSemver(o.migration.throughVersion, currentVersion) < 0 ||
    compareSemver(o.migration.fromVersion, o.migration.throughVersion) > 0
  ) {
    throw new PenglaiError("SECURITY_POLICY", "current version outside migration range");
  }
  if (asset.target !== target || asset.version !== o.version) {
    throw new PenglaiError("SECURITY_POLICY", "asset target/version mismatch");
  }
  const expectedKind = target.startsWith("darwin-") ? "dmg" : target === "win32-x86_64" ? "setup" : undefined;
  if (!expectedKind || asset.kind !== expectedKind) {
    throw new PenglaiError("SECURITY_POLICY", "asset installer kind mismatch");
  }
  const expectedFilename = target === "darwin-aarch64"
    ? `Penglai_${o.version}_macos_aarch64.dmg`
    : target === "darwin-x86_64"
      ? `Penglai_${o.version}_macos_x64.dmg`
      : `Penglai_${o.version}_windows_x64_setup.exe`;
  const assetUrl = immutableHttpsUrl(asset.url, "asset");
  if (policy.allowedAssetHosts?.length && !policy.allowedAssetHosts.includes(assetUrl.hostname)) {
    throw new PenglaiError("SECURITY_POLICY", "asset host not allowlisted");
  }
  if (!assetUrl.pathname.includes(`/releases/download/v${o.version}/`)) {
    throw new PenglaiError("SECURITY_POLICY", "asset URL is not version-immutable");
  }
  if (!assetUrl.pathname.endsWith(`/${expectedFilename}`)) {
    throw new PenglaiError("SECURITY_POLICY", "asset filename does not match target identity");
  }
  assertSha(asset.sha256, "asset");
  decodeSignature(asset.signature, "asset");
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 8 * 1024 * 1024 * 1024) {
    throw new PenglaiError("SECURITY_POLICY", "asset size invalid");
  }
  const minimumOs = parseDottedVersion(asset.minimumOsVersion, "minimum OS");
  if (policy.currentOsVersion) {
    const currentOs = parseDottedVersion(policy.currentOsVersion, "current OS");
    if (compareDottedVersion(currentOs, minimumOs) < 0) {
      throw new PenglaiError("SECURITY_POLICY", "current OS is below update minimum");
    }
  }
  if (
    asset.candidateSourceSha !== o.candidateSourceSha ||
    asset.publicExportTreeSha256 !== o.publicExportTreeSha256 ||
    asset.releaseManifestSha256 !== o.releaseManifestSha256
  ) {
    throw new PenglaiError("SECURITY_POLICY", "asset release identity mismatch");
  }
  return o;
}

function parseDottedVersion(value: unknown, label: string): number[] {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){1,3}$/.test(value)) {
    throw new PenglaiError("INVALID_INPUT", `${label} version invalid`);
  }
  return value.split(".").map(Number);
}

function compareDottedVersion(a: number[], b: number[]): number {
  const width = Math.max(a.length, b.length);
  for (let i = 0; i < width; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function parseSemver(value: string): { core: [number, number, number]; prerelease: string[] } {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match) throw new PenglaiError("INVALID_INPUT", `invalid semver ${value}`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? [],
  };
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa.core[i]! > pb.core[i]!) return 1;
    if (pa.core[i]! < pb.core[i]!) return -1;
  }
  if (!pa.prerelease.length && pb.prerelease.length) return 1;
  if (pa.prerelease.length && !pb.prerelease.length) return -1;
  for (let i = 0; i < Math.max(pa.prerelease.length, pb.prerelease.length); i += 1) {
    const av = pa.prerelease[i];
    const bv = pb.prerelease[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av === bv) continue;
    const an = /^\d+$/.test(av) ? Number(av) : undefined;
    const bn = /^\d+$/.test(bv) ? Number(bv) : undefined;
    if (an !== undefined && bn !== undefined) return an > bn ? 1 : -1;
    if (an !== undefined) return -1;
    if (bn !== undefined) return 1;
    return av > bv ? 1 : -1;
  }
  return 0;
}

function publicKey(publicKeyHex: string) {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) {
    throw new PenglaiError("SECURITY_POLICY", "trusted updater public key required");
  }
  return createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyHex, "hex")]),
    format: "der",
    type: "spki",
  });
}

export function verifyDetached(data: Buffer, signature: Buffer, publicKeyHex: string, label: string): void {
  if (signature.length !== 64 || !verify(null, data, publicKey(publicKeyHex), signature)) {
    throw new PenglaiError("SECURITY_POLICY", `${label} signature mismatch`);
  }
}

export function verifyPayload(buf: Buffer, sha256: string, signature: Buffer, publicKeyHex: string): void {
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== sha256) throw new PenglaiError("SECURITY_POLICY", "payload hash mismatch");
  verifyDetached(buf, signature, publicKeyHex, "payload");
}

export function verifyManifestBytes(input: {
  bytes: Buffer;
  signature: Buffer;
  publicKeyHex: string;
  currentVersion: string;
  target: string;
  policy?: UpdateManifestPolicy;
}): { manifest: UpdateManifest; digest: string } {
  verifyDetached(input.bytes, input.signature, input.publicKeyHex, "manifest");
  let raw: unknown;
  try {
    raw = JSON.parse(input.bytes.toString("utf8"));
  } catch {
    throw new PenglaiError("INVALID_INPUT", "manifest JSON invalid");
  }
  return {
    manifest: assertUpdateManifest(raw, input.currentVersion, input.target, input.policy),
    digest: createHash("sha256").update(input.bytes).digest("hex"),
  };
}

export interface UpdateJournal {
  operationId: string;
  state: UpdateState;
  version?: string;
  payloadSha256?: string;
  manifestSha256?: string;
  target?: string;
  previousVersion?: string;
  backupPath?: string;
  errorClass?: string;
  drained: boolean;
}

export interface UpdateLedger {
  schema: 1;
  version: string;
  manifestSha256: string;
  signatureKeyId: string;
  committedAt: string;
}

export type UpdateEvent =
  | "check"
  | "current"
  | "found"
  | "download"
  | "verify"
  | "verified"
  | "confirm"
  | "fail"
  | "drain"
  | "backup"
  | "handoff"
  | "restart"
  | "postverify"
  | "commit"
  | "rollback"
  | "recover";

export function nextUpdateState(current: UpdateState, event: UpdateEvent): UpdateState {
  if (event === "fail") return current === "CHECKING" || current === "DOWNLOADING" || current === "VERIFYING" ? "FAILED" : "RECOVERY_REQUIRED";
  if (event === "rollback") return "ROLLED_BACK";
  if (event === "recover") return "RECOVERY_REQUIRED";
  if (current === "IDLE" && event === "check") return "CHECKING";
  if (current === "CHECKING" && event === "current") return "CURRENT";
  if (current === "CHECKING" && event === "found") return "AVAILABLE";
  if (current === "AVAILABLE" && event === "download") return "DOWNLOADING";
  if (current === "DOWNLOADING" && event === "verify") return "VERIFYING";
  if (current === "VERIFYING" && (event === "verified" || event === "confirm")) return "READY_FOR_USER";
  if (current === "READY_FOR_USER" && event === "confirm") return "INSTALL_REQUESTED";
  if (current === "INSTALL_REQUESTED" && event === "drain") return "DRAINING_DSH";
  if (current === "DRAINING_DSH" && event === "backup") return "DATA_BACKUP_READY";
  if ((current === "DRAINING_DSH" || current === "DATA_BACKUP_READY") && event === "handoff") return "HANDOFF_TO_INSTALLER";
  if (current === "HANDOFF_TO_INSTALLER" && event === "restart") return "RESTART_PENDING";
  if (current === "RESTART_PENDING" && event === "postverify") return "POST_UPDATE_VERIFY";
  if ((current === "HANDOFF_TO_INSTALLER" || current === "POST_UPDATE_VERIFY") && event === "commit") return "COMMITTED";
  throw new PenglaiError("INVALID_INPUT", `illegal update transition ${current}/${event}`);
}

export function assertStagingNotExecutable(mode: number): void {
  if ((mode & 0o111) !== 0) throw new PenglaiError("SECURITY_POLICY", "update staging must not be executable");
}

export function writeUpdateJournal(dir: string, journal: UpdateJournal): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dest = join(dir, "update-journal.json");
  const tmp = join(dir, `.update-journal.${process.pid}.${Date.now().toString(36)}.tmp`);
  writeFileSync(tmp, JSON.stringify(journal), { mode: 0o600 });
  renameSync(tmp, dest);
  return dest;
}

export function readUpdateJournal(dir: string): UpdateJournal | undefined {
  const path = join(dir, "update-journal.json");
  if (!existsSync(path)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new PenglaiError("STORE_CORRUPT", "update journal unreadable");
  }
  const journal = raw as UpdateJournal;
  if (
    !journal.operationId ||
    !(UPDATE_STATES as readonly string[]).includes(journal.state) ||
    typeof journal.drained !== "boolean"
  ) {
    throw new PenglaiError("STORE_CORRUPT", "update journal invalid");
  }
  return journal;
}

export function readUpdateLedger(path: string): UpdateLedger | undefined {
  if (!existsSync(path)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new PenglaiError("STORE_CORRUPT", "update ledger unreadable");
  }
  const ledger = raw as UpdateLedger;
  if (
    ledger.schema !== 1 ||
    !ledger.signatureKeyId ||
    !Number.isFinite(Date.parse(ledger.committedAt))
  ) {
    throw new PenglaiError("STORE_CORRUPT", "update ledger invalid");
  }
  parseSemver(ledger.version);
  assertSha(ledger.manifestSha256, "update ledger manifest");
  return ledger;
}

export function assertUpdateLedgerAllows(
  ledger: UpdateLedger | undefined,
  version: string,
  manifestSha256: string,
  signatureKeyId: string,
): void {
  assertSha(manifestSha256, "manifest");
  if (!ledger) return;
  if (compareSemver(version, ledger.version) <= 0 || manifestSha256 === ledger.manifestSha256) {
    throw new PenglaiError("SECURITY_POLICY", "update ledger rejected rollback or manifest replay");
  }
  if (signatureKeyId !== ledger.signatureKeyId) {
    throw new PenglaiError("SECURITY_POLICY", "update signing key rotation is not authorized");
  }
}

export function writeUpdateLedger(path: string, ledger: UpdateLedger): void {
  assertUpdateLedgerAllows(undefined, ledger.version, ledger.manifestSha256, ledger.signatureKeyId);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger), { mode: 0o600 });
  renameSync(tmp, path);
}

export function assertProductionHasNoFixtureKey(source: string): void {
  if (/PENGLAI_FIXTURE_UPDATER_PRIVATE|BEGIN OPENSSH PRIVATE KEY|minisign sk/.test(source)) {
    throw new PenglaiError("SECURITY_POLICY", "fixture updater private key leaked into production");
  }
}

interface VerifiedInstallerReceipt {
  operationId: string;
  path: string;
  sha256: string;
  size: number;
  signature: Buffer;
  kind: "dmg" | "setup";
}

/**
 * Main-process-only, one-shot handoff for an installer that was verified against
 * the Owner update key. Renderer RPCs may provide only an opaque operation id.
 */
export class VerifiedInstallerHandoff {
  readonly #stagingRoot: string;
  readonly #publicKeyHex: string;
  readonly #receipts = new Map<string, VerifiedInstallerReceipt>();

  constructor(stagingRoot: string, publicKeyHex: string) {
    if (!isAbsolute(stagingRoot)) throw new PenglaiError("SECURITY_POLICY", "update staging root must be absolute");
    if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) throw new PenglaiError("SECURITY_POLICY", "trusted updater public key required");
    this.#stagingRoot = resolve(stagingRoot);
    this.#publicKeyHex = publicKeyHex.toLowerCase();
  }

  register(input: {
    operationId: string;
    path: string;
    sha256: string;
    size: number;
    signature: Buffer;
  }): { operationId: string; kind: "dmg" | "setup"; ready: true } {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.operationId)) {
      throw new PenglaiError("INVALID_INPUT", "invalid update operation id");
    }
    const path = resolve(input.path);
    const relativePath = relative(this.#stagingRoot, path);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new PenglaiError("SECURITY_POLICY", "installer outside trusted update staging");
    }
    if (!/^[0-9a-f]{64}$/.test(input.sha256)) throw new PenglaiError("SECURITY_POLICY", "installer sha256 required");
    const kind = path.endsWith(".dmg") ? "dmg" : path.endsWith(".exe") ? "setup" : undefined;
    if (!kind) throw new PenglaiError("INVALID_INPUT", "unknown installer kind");
    this.#verifyFile(path, input.size, input.sha256, input.signature);
    this.#receipts.set(input.operationId, {
      ...input,
      path,
      signature: Buffer.from(input.signature),
      kind,
    });
    return { operationId: input.operationId, kind, ready: true };
  }

  open(
    operationId: string,
    opts: { silent?: boolean; open?: (path: string, kind: "dmg" | "setup") => void } = {},
  ): { opened: true; silent: false; kind: "dmg" | "setup"; operationId: string } {
    if (opts.silent) throw new PenglaiError("SECURITY_POLICY", "silent update forbidden");
    const receipt = this.#receipts.get(operationId);
    if (!receipt) throw new PenglaiError("SECURITY_POLICY", "unknown or consumed verified installer operation");
    this.#verifyFile(receipt.path, receipt.size, receipt.sha256, receipt.signature);
    if (opts.open) opts.open(receipt.path, receipt.kind);
    else spawnVerifiedInstaller(receipt.path, receipt.kind);
    this.#receipts.delete(operationId);
    return { opened: true, silent: false, kind: receipt.kind, operationId };
  }

  #verifyFile(path: string, size: number, sha256: string, signature: Buffer): void {
    if (!existsSync(path)) throw new PenglaiError("INVALID_INPUT", "verified installer missing");
    const lst = lstatSync(path);
    if (lst.isSymbolicLink() || !lst.isFile()) throw new PenglaiError("SECURITY_POLICY", "installer must be a regular file");
    if (statSync(path).size !== size) throw new PenglaiError("SECURITY_POLICY", "installer size changed");
    verifyPayload(readFileSync(path), sha256, signature, this.#publicKeyHex);
  }
}

export function spawnVerifiedInstaller(path: string, kind: "dmg" | "setup"): void {
  if (kind === "dmg") {
    spawn("open", [path], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn(path, [], { detached: true, stdio: "ignore" }).unref();
}

export function applyUpdateOutcome(state: UpdateState, verified: boolean): UpdateState {
  if (state !== "HANDOFF_TO_INSTALLER" && state !== "VERIFYING") {
    throw new PenglaiError("INVALID_INPUT", `cannot commit from ${state}`);
  }
  return verified ? "COMMITTED" : "ROLLED_BACK";
}

export function replayUpdateCrash(state: UpdateState): UpdateState {
  if (!(UPDATE_STATES as readonly string[]).includes(state)) {
    throw new PenglaiError("INVALID_INPUT", "unknown update state");
  }
  return state;
}
