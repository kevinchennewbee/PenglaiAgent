import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rmdir,
  statfs,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { PenglaiError, type ErrorClass } from "@penglai/contracts";

export type TtsModelState =
  | "not_installed"
  | "verifying"
  | "downloading"
  | "paused"
  | "ready"
  | "corrupt"
  | "failed";

export const MOSS_TTS_REPOSITORY = "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX";
export const MOSS_TTS_REVISION = "f52645cb467506d8e18e746ddd59482685b74e58";
export const MOSS_CODEC_REPOSITORY = "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX";
export const MOSS_CODEC_REVISION = "ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae";
export const MOSS_SOURCE_COMMIT = "cc7bdf19c7639c0870dab22045a33b442760f6be";
export const MOSS_BUNDLE_REVISION = "cd877ae87fed8f9d26c237c5038242e796e51389";

export interface TtsModelFileManifest {
  path: string;
  sourceName: string;
  repository: string;
  revision: string;
  url: string;
  sha256: string;
  bytes: number;
}

export interface TtsModelManifest {
  id: string;
  label: string;
  revision: string;
  license: string;
  licenseUrl: string;
  licenseSha256: string;
  attribution: string;
  files: readonly TtsModelFileManifest[];
}

function pinnedFile(
  directory: string,
  repository: string,
  revision: string,
  sourceName: string,
  bytes: number,
  sha256: string,
): TtsModelFileManifest {
  return Object.freeze({
    path: `${directory}/${sourceName}`,
    sourceName,
    repository,
    revision,
    url: `https://huggingface.co/${repository}/resolve/${revision}/${sourceName}?download=true`,
    bytes,
    sha256,
  });
}

const TTS_DIR = "MOSS-TTS-Nano-100M-ONNX";
const CODEC_DIR = "MOSS-Audio-Tokenizer-Nano-ONNX";

export const MOSS_TTS_MANIFEST: TtsModelManifest = Object.freeze({
  id: "moss-tts-nano-onnx",
  label: "MOSS-TTS-Nano 100M ONNX + MOSS Audio Tokenizer Nano ONNX",
  revision: MOSS_BUNDLE_REVISION,
  license: "Apache-2.0",
  licenseUrl: `https://raw.githubusercontent.com/OpenMOSS/MOSS-TTS-Nano/${MOSS_SOURCE_COMMIT}/LICENSE`,
  licenseSha256: "1dc6904a1959e039b44569c6a726a611f75287051284de1b6cc0dc7712b14d11",
  attribution: "OpenMOSS Team, Fudan University, SII and MOSI",
  files: Object.freeze([
    pinnedFile(TTS_DIR, MOSS_TTS_REPOSITORY, MOSS_TTS_REVISION, "browser_poc_manifest.json", 503_354, "097d80e993dc29f0bae427590b4f77084a161cb578b50d82c29f455d5faa9eee"),
    pinnedFile(TTS_DIR, MOSS_TTS_REPOSITORY, MOSS_TTS_REVISION, "tts_browser_onnx_meta.json", 4_487, "3edf25232dcd0af3d061c837e9a968a39e2f8592e06777d740503c4f2244f95c"),
    pinnedFile(TTS_DIR, MOSS_TTS_REPOSITORY, MOSS_TTS_REVISION, "tokenizer.model", 470_897, "c353ee1479b536bf414c1b247f5542b6607fb8ae91320e5af1781fee200fddff"),
    pinnedFile(TTS_DIR, MOSS_TTS_REPOSITORY, MOSS_TTS_REVISION, "moss_tts_decode_step.onnx", 291_483, "698cbc2fc1c2feca16e5895614ed52bbb32ded10f236c076f477b2e69abf32d8"),
    pinnedFile(TTS_DIR, MOSS_TTS_REPOSITORY, MOSS_TTS_REVISION, "moss_tts_global_shared.data", 440_813_568, "bce8312c3df6a44545302cae229b61054fe0672e0b252ba59cba47adeed831dc"),
    pinnedFile(TTS_DIR, MOSS_TTS_REPOSITORY, MOSS_TTS_REVISION, "moss_tts_local_cached_step.onnx", 53_685, "aa9035fefc1c138a951a8bcfc0374fb03a25f1ece67f7f7f53bce349b84a1dd5"),
    pinnedFile(TTS_DIR, MOSS_TTS_REPOSITORY, MOSS_TTS_REVISION, "moss_tts_local_decoder.onnx", 49_231, "51aa754301b38550a5f9adda0ad93bd3dc95819afb511e6dcabf4a90b345a454"),
    pinnedFile(TTS_DIR, MOSS_TTS_REPOSITORY, MOSS_TTS_REVISION, "moss_tts_local_fixed_sampled_frame.onnx", 471_262, "40cdb00efc171c450cf91468e01429caa41b0252222cd308e978f58fe354afa8"),
    pinnedFile(TTS_DIR, MOSS_TTS_REPOSITORY, MOSS_TTS_REVISION, "moss_tts_local_shared.data", 229_678_080, "bae7782032c0fb12490ab42afe009f87ae6c75a0f0596fc7b5c08e4d5ee93916"),
    pinnedFile(TTS_DIR, MOSS_TTS_REPOSITORY, MOSS_TTS_REVISION, "moss_tts_prefill.onnx", 283_305, "d56126dcd0574c2f15d98fc6b35eda68d0386b5bd9c5e38e28548d6f2ea8f3db"),
    pinnedFile(CODEC_DIR, MOSS_CODEC_REPOSITORY, MOSS_CODEC_REVISION, "codec_browser_onnx_meta.json", 17_036, "3e291c883bb7d11ff2fe8e964e3e495519760358859f35c951254c7741592731"),
    pinnedFile(CODEC_DIR, MOSS_CODEC_REPOSITORY, MOSS_CODEC_REVISION, "moss_audio_tokenizer_decode_full.onnx", 681_902, "0fbbafe3fd4afa2a019af5c5ced204af6e2d1db044fa40f021525d2aee95b4ac"),
    pinnedFile(CODEC_DIR, MOSS_CODEC_REPOSITORY, MOSS_CODEC_REVISION, "moss_audio_tokenizer_decode_shared.data", 44_198_912, "e69d52e0f4e84ca27850557ee54face46632d3a5a16c89bd246c7c408466dcad"),
    pinnedFile(CODEC_DIR, MOSS_CODEC_REPOSITORY, MOSS_CODEC_REVISION, "moss_audio_tokenizer_decode_step.onnx", 351_400, "9527c86a29e1837edec1f74db57d5eeaadb3a715af3382703566460afed25855"),
    pinnedFile(CODEC_DIR, MOSS_CODEC_REPOSITORY, MOSS_CODEC_REVISION, "moss_audio_tokenizer_encode.data", 44_507_136, "aa751265b2bab2887eac224484546b194875aa7494b607115439b3dc6b228a2c"),
    pinnedFile(CODEC_DIR, MOSS_CODEC_REPOSITORY, MOSS_CODEC_REVISION, "moss_audio_tokenizer_encode.onnx", 815_775, "eadea4a645abdcf98714c7aead122ee2ce7da6e080f9f80b977cd1ca8e19473a"),
  ]),
});

export interface TtsModelRecord {
  id: string;
  label: string;
  revision: string;
  sources: Array<{ repository: string; revision: string }>;
  license: string;
  licenseUrl: string;
  licenseSha256: string;
  attribution: string;
  bytes: number;
  installedBytes: number;
  state: TtsModelState;
  files: Array<Pick<TtsModelFileManifest, "path" | "sha256" | "bytes">>;
  operation?: TtsModelOperation;
  errorClass?: ErrorClass;
}

export type TtsModelOperationState =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export interface TtsModelOperation {
  operationId: string;
  kind: "download" | "import";
  modelId: string;
  state: TtsModelOperationState;
  completedBytes: number;
  totalBytes: number;
  currentFile?: string;
  validators?: Record<string, string>;
  errorClass?: ErrorClass;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedMossTtsModel {
  revision: string;
  modelRoot: string;
}

type FetchLike = typeof fetch;
type CapabilityResolver = (capabilityRef: string) => Promise<string>;

const OPERATION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const CAPABILITY_REF = /^[A-Za-z0-9_-]{8,160}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_REDIRECTS = 5;
const DISK_SAFETY_BYTES = 128 * 1024 * 1024;

function nowIso(): string {
  return new Date().toISOString();
}

function totalBytes(manifest: TtsModelManifest): number {
  return manifest.files.reduce((sum, file) => sum + file.bytes, 0);
}

function stableErrorClass(error: unknown): ErrorClass {
  if (error instanceof PenglaiError) return error.errorClass;
  if (error instanceof DOMException && error.name === "AbortError") return "DELIVERY_TRANSIENT";
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  if (["ENOSPC", "EROFS", "EACCES", "EPERM"].includes(code)) return "SECURITY_POLICY";
  return "DELIVERY_TRANSIENT";
}

function assertSafeRelativePath(value: string): void {
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (
    !value || value !== normalized || isAbsolute(value) || parts.length < 2 ||
    parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))
  ) {
    throw new PenglaiError("SECURITY_POLICY", "unsafe MOSS model relative path");
  }
}

export function assertCanonicalTtsModelUrl(value: string, file: TtsModelFileManifest): URL {
  let url: URL;
  try { url = new URL(value); } catch {
    throw new PenglaiError("INVALID_INPUT", "invalid MOSS model URL");
  }
  const expectedPath = `/${file.repository}/resolve/${file.revision}/${file.sourceName}`;
  if (
    url.protocol !== "https:" || url.hostname !== "huggingface.co" ||
    url.pathname !== expectedPath || /(?:^|\/)(?:main|master|latest)(?:\/|$)/i.test(url.pathname) ||
    url.username || url.password
  ) {
    throw new PenglaiError("SECURITY_POLICY", "MOSS model URL must use its pinned Hugging Face revision");
  }
  return url;
}

export function assertAllowedTtsModelRedirect(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch {
    throw new PenglaiError("SECURITY_POLICY", "invalid MOSS model redirect");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    !(host === "huggingface.co" || host.endsWith(".hf.co")) ||
    url.username || url.password
  ) {
    throw new PenglaiError("SECURITY_POLICY", "MOSS model redirect host rejected");
  }
  return url;
}

function assertManifest(manifest: TtsModelManifest): void {
  if (!/^[A-Za-z0-9_-]+$/.test(manifest.id) || !/^[0-9a-f]{40}$/.test(manifest.revision)) {
    throw new PenglaiError("SECURITY_POLICY", "invalid MOSS model identity");
  }
  if (
    manifest.license !== "Apache-2.0" || !SHA256.test(manifest.licenseSha256) ||
    !manifest.licenseUrl.includes(`/${MOSS_SOURCE_COMMIT}/LICENSE`) || !manifest.attribution
  ) {
    throw new PenglaiError("SECURITY_POLICY", "MOSS model license provenance invalid");
  }
  const seen = new Set<string>();
  for (const file of manifest.files) {
    assertSafeRelativePath(file.path);
    if (
      seen.has(file.path) || !SHA256.test(file.sha256) || !/^[0-9a-f]{40}$/.test(file.revision) ||
      !Number.isSafeInteger(file.bytes) || file.bytes <= 0
    ) {
      throw new PenglaiError("SECURITY_POLICY", "MOSS model file pin invalid");
    }
    seen.add(file.path);
    assertCanonicalTtsModelUrl(file.url, file);
  }
}

export async function sha256TtsFile(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    if (signal?.aborted) throw signal.reason;
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function ensurePrivateRoot(root: string): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "MOSS model root must be a real directory");
  }
}

export class TtsModelManager {
  private state: TtsModelState = "not_installed";
  private installedBytes = 0;
  private errorClass: ErrorClass | undefined;
  private readonly operations = new Map<string, TtsModelOperation>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly running = new Map<string, Promise<TtsModelOperation>>();
  private initPromise: Promise<void> | undefined;
  private modelOwner: string | undefined;
  private disposed = false;
  private readonly operationsPath: string;

  constructor(
    private readonly root: string,
    readonly manifest: TtsModelManifest = MOSS_TTS_MANIFEST,
    private readonly options: { fetchImpl?: FetchLike; resolveCapability?: CapabilityResolver } = {},
  ) {
    assertManifest(manifest);
    ensurePrivateRoot(root);
    this.operationsPath = join(root, "operations.json");
    this.restoreOperations();
  }

  initialize(): Promise<void> {
    this.initPromise ??= this.verifyInstalled();
    return this.initPromise;
  }

  describeModels(): TtsModelRecord[] {
    const operation = [...this.operations.values()]
      .filter((row) => row.kind === "download" && ["queued", "running", "paused"].includes(row.state))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const sources = [...new Map(this.manifest.files.map((file) => [
      `${file.repository}@${file.revision}`,
      { repository: file.repository, revision: file.revision },
    ])).values()];
    return [{
      id: this.manifest.id,
      label: this.manifest.label,
      revision: this.manifest.revision,
      sources,
      license: this.manifest.license,
      licenseUrl: this.manifest.licenseUrl,
      licenseSha256: this.manifest.licenseSha256,
      attribution: this.manifest.attribution,
      bytes: totalBytes(this.manifest),
      installedBytes: this.installedBytes,
      state: this.state,
      files: this.manifest.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
      ...(operation ? { operation: structuredClone(operation) } : {}),
      ...(this.errorClass ? { errorClass: this.errorClass } : {}),
    }];
  }

  describeCapability(): {
    plugin: "active";
    engine: "onnxruntime-node-1.27.0";
    model: TtsModelState;
  } {
    return { plugin: "active", engine: "onnxruntime-node-1.27.0", model: this.state };
  }

  getOperation(operationId: string): TtsModelOperation | undefined {
    const op = this.operations.get(operationId);
    return op ? structuredClone(op) : undefined;
  }

  async prepareModel(operationId: string): Promise<TtsModelOperation> {
    this.assertUsable();
    this.assertOperationId(operationId);
    await this.initialize();
    const previous = this.operations.get(operationId);
    if (previous?.state === "completed" && this.state === "ready") return structuredClone(previous);
    if (previous && previous.state !== "paused") {
      throw new PenglaiError("INVALID_INPUT", "MOSS model operation id already used");
    }
    const existing = this.running.get(operationId);
    if (existing) return existing;
    if (this.modelOwner && this.modelOwner !== operationId) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "MOSS model install backpressure");
    }
    return this.startDownload(previous ?? this.createOperation(operationId, "download"));
  }

  pauseDownload(operationId: string): TtsModelOperation {
    const op = this.requireOperation(operationId, "download");
    if (op.state !== "running" && op.state !== "queued") {
      throw new PenglaiError("INVALID_INPUT", "MOSS download is not running");
    }
    this.updateOperation(op, { state: "paused" });
    this.state = "paused";
    this.controllers.get(operationId)?.abort("paused");
    return structuredClone(op);
  }

  async resumeDownload(operationId: string): Promise<TtsModelOperation> {
    const op = this.requireOperation(operationId, "download");
    if (op.state !== "paused") throw new PenglaiError("INVALID_INPUT", "MOSS download is not paused");
    await this.running.get(operationId)?.catch(() => undefined);
    return this.startDownload(op);
  }

  async cancelDownload(operationId: string): Promise<TtsModelOperation> {
    const op = this.requireOperation(operationId, "download");
    if (["completed", "failed", "cancelled"].includes(op.state)) {
      throw new PenglaiError("INVALID_INPUT", "MOSS download cannot be cancelled");
    }
    this.updateOperation(op, { state: "cancelled" });
    this.controllers.get(operationId)?.abort("cancelled");
    await this.running.get(operationId)?.catch(() => undefined);
    await this.deleteOperationParts(operationId);
    await this.verifyInstalled();
    return structuredClone(op);
  }

  async importVerifiedModel(operationId: string, capabilityRef: string): Promise<TtsModelOperation> {
    this.assertUsable();
    this.assertOperationId(operationId);
    if (!CAPABILITY_REF.test(capabilityRef)) {
      throw new PenglaiError("SECURITY_POLICY", "MOSS import requires an opaque capability reference");
    }
    if (!this.options.resolveCapability) {
      throw new PenglaiError("DSH_UNAVAILABLE", "MOSS import capability resolver unavailable");
    }
    await this.initialize();
    if (this.operations.has(operationId)) throw new PenglaiError("INVALID_INPUT", "MOSS operation id already used");
    if (this.modelOwner) throw new PenglaiError("DELIVERY_TRANSIENT", "MOSS model install backpressure");
    const op = this.createOperation(operationId, "import");
    this.modelOwner = operationId;
    this.updateOperation(op, { state: "running" });
    this.state = "verifying";
    try {
      const source = resolve(await this.options.resolveCapability(capabilityRef));
      const sourceInfo = await lstat(source);
      if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
        throw new PenglaiError("SECURITY_POLICY", "MOSS import source must be a real directory");
      }
      await this.assertImportTree(source);
      await this.preflightDisk(totalBytes(this.manifest));
      for (const file of this.manifest.files) {
        const sourceFile = join(source, file.path);
        await this.assertVerifiedFile(sourceFile, file);
        await this.installCopy(sourceFile, file, operationId);
        this.updateOperation(op, {
          completedBytes: op.completedBytes + file.bytes,
          currentFile: file.path,
        });
      }
      await this.writeInstalledManifest();
      this.installedBytes = totalBytes(this.manifest);
      this.state = "ready";
      this.errorClass = undefined;
      this.updateOperation(op, { state: "completed", currentFile: undefined });
      return structuredClone(op);
    } catch (error) {
      const errorClass = stableErrorClass(error);
      this.state = "failed";
      this.errorClass = errorClass;
      this.updateOperation(op, { state: "failed", errorClass });
      throw error;
    } finally {
      this.modelOwner = undefined;
    }
  }

  async requireReady(): Promise<ResolvedMossTtsModel> {
    await this.initialize();
    if (this.state !== "ready") throw new PenglaiError("DSH_UNAVAILABLE", "MOSS model not installed");
    return { revision: this.manifest.revision, modelRoot: this.revisionDir() };
  }

  async deleteModel(
    revision: string,
    confirmation: { revision: string; acknowledged: true },
  ): Promise<{ deleted: true; revision: string }> {
    await this.initialize();
    if (
      revision !== this.manifest.revision || confirmation.revision !== revision ||
      confirmation.acknowledged !== true
    ) {
      throw new PenglaiError("SECURITY_POLICY", "MOSS model deletion confirmation mismatch");
    }
    if (this.modelOwner) throw new PenglaiError("DELIVERY_TRANSIENT", "MOSS model is busy");
    const dir = this.revisionDir();
    if (existsSync(dir)) {
      await this.assertExactInstalledTree();
      const files = [...this.manifest.files.map((file) => this.destination(file)), join(dir, "manifest.json")];
      for (const path of files) if (existsSync(path)) await unlink(path);
      for (const nested of [join(dir, TTS_DIR), join(dir, CODEC_DIR)]) if (existsSync(nested)) await rmdir(nested);
      await rmdir(dir);
    }
    this.installedBytes = 0;
    this.state = "not_installed";
    this.errorClass = undefined;
    return { deleted: true, revision };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of this.controllers.values()) controller.abort("disposed");
    await Promise.allSettled([...this.running.values()]);
    this.controllers.clear();
    this.running.clear();
    this.modelOwner = undefined;
  }

  private startDownload(op: TtsModelOperation): Promise<TtsModelOperation> {
    if (this.modelOwner && this.modelOwner !== op.operationId) {
      return Promise.reject(new PenglaiError("DELIVERY_TRANSIENT", "MOSS model install backpressure"));
    }
    this.modelOwner = op.operationId;
    const controller = new AbortController();
    this.controllers.set(op.operationId, controller);
    this.updateOperation(op, { state: "running", errorClass: undefined });
    this.state = "downloading";
    this.errorClass = undefined;
    const promise = this.runDownload(op, controller.signal).finally(() => {
      this.controllers.delete(op.operationId);
      this.running.delete(op.operationId);
      if (this.modelOwner === op.operationId) this.modelOwner = undefined;
    });
    this.running.set(op.operationId, promise);
    return promise;
  }

  private async runDownload(op: TtsModelOperation, signal: AbortSignal): Promise<TtsModelOperation> {
    try {
      await this.preflightDisk(totalBytes(this.manifest) - this.installedBytes);
      this.updateOperation(op, { completedBytes: 0 });
      for (const file of this.manifest.files) {
        if (signal.aborted) throw signal.reason;
        this.updateOperation(op, { currentFile: file.path });
        if (await this.isVerifiedFile(this.destination(file), file, signal)) {
          this.updateOperation(op, { completedBytes: op.completedBytes + file.bytes });
          continue;
        }
        await this.downloadFile(file, op, signal);
      }
      await this.writeInstalledManifest();
      this.installedBytes = totalBytes(this.manifest);
      this.state = "ready";
      this.errorClass = undefined;
      this.updateOperation(op, { state: "completed", currentFile: undefined });
      return structuredClone(op);
    } catch (error) {
      if (op.state === "paused" || op.state === "cancelled") return structuredClone(op);
      const errorClass = stableErrorClass(error);
      this.state = "failed";
      this.errorClass = errorClass;
      this.updateOperation(op, { state: "failed", errorClass });
      throw error;
    }
  }

  private async downloadFile(
    file: TtsModelFileManifest,
    op: TtsModelOperation,
    signal: AbortSignal,
  ): Promise<void> {
    const dest = this.destination(file);
    await this.ensurePrivateDirectory(dirname(dest));
    const part = this.partPath(file, op.operationId);
    let existing = 0;
    if (existsSync(part)) {
      const info = await lstat(part);
      if (!info.isFile() || info.isSymbolicLink() || info.size > file.bytes) {
        throw new PenglaiError("SECURITY_POLICY", "MOSS partial file unsafe");
      }
      existing = info.size;
    }
    const headers: Record<string, string> = { "User-Agent": "Penglai/0.5.1 model-manager" };
    const validator = op.validators?.[file.path];
    if (existing) {
      headers.Range = `bytes=${existing}-`;
      if (validator) headers["If-Range"] = validator;
    }
    const response = await this.fetchPinned(file, headers, signal);
    if (response.status !== 200 && response.status !== 206) {
      throw new PenglaiError(
        response.status >= 500 || response.status === 429 ? "DELIVERY_TRANSIENT" : "DELIVERY_PERMANENT",
        `MOSS model download rejected with status ${response.status}`,
      );
    }
    if (!response.body) throw new PenglaiError("DELIVERY_TRANSIENT", "MOSS download body missing");
    const responseValidator = response.headers.get("x-linked-etag") ?? response.headers.get("etag") ?? undefined;
    if (validator && responseValidator && responseValidator !== validator) {
      throw new PenglaiError("SECURITY_POLICY", "MOSS model validator changed during resume");
    }
    if (responseValidator && !validator) {
      this.updateOperation(op, { validators: { ...(op.validators ?? {}), [file.path]: responseValidator } });
    }
    let append = false;
    if (existing && response.status === 206) {
      const range = response.headers.get("content-range") ?? "";
      if (!range.startsWith(`bytes ${existing}-`) || !range.endsWith(`/${file.bytes}`)) {
        throw new PenglaiError("SECURITY_POLICY", "MOSS Range response mismatch");
      }
      append = true;
    } else if (existing && response.status === 200) {
      existing = 0;
    } else if (!existing && response.status === 206) {
      const range = response.headers.get("content-range") ?? "";
      if (!range.startsWith("bytes 0-") || !range.endsWith(`/${file.bytes}`)) {
        throw new PenglaiError("SECURITY_POLICY", "MOSS unsolicited Range mismatch");
      }
    }
    const length = Number(response.headers.get("content-length") ?? 0);
    if (!Number.isFinite(length) || length < 0 || (length > 0 && existing + length > file.bytes)) {
      throw new PenglaiError("SECURITY_POLICY", "MOSS Content-Length mismatch");
    }
    const handle = await open(part, append ? "a" : "w", 0o600);
    const before = op.completedBytes;
    let written = existing;
    let lastPersisted = existing;
    try {
      for await (const raw of response.body as unknown as AsyncIterable<Uint8Array>) {
        if (signal.aborted) throw signal.reason;
        const chunk = Buffer.from(raw);
        written += chunk.length;
        if (written > file.bytes) throw new PenglaiError("SECURITY_POLICY", "MOSS download exceeds pin");
        await handle.write(chunk);
        if (written - lastPersisted >= 1024 * 1024) {
          this.updateOperation(op, { completedBytes: before + written });
          lastPersisted = written;
        }
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (written !== file.bytes) throw new PenglaiError("DELIVERY_TRANSIENT", "MOSS download truncated");
    await this.assertVerifiedFile(part, file, signal);
    if (existsSync(dest)) {
      const info = await lstat(dest);
      if (!info.isFile() || info.isSymbolicLink()) throw new PenglaiError("SECURITY_POLICY", "MOSS destination unsafe");
      await unlink(dest);
    }
    await rename(part, dest);
    this.updateOperation(op, { completedBytes: before + file.bytes });
  }

  private async fetchPinned(
    file: TtsModelFileManifest,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Response> {
    let url = assertCanonicalTtsModelUrl(file.url, file);
    const fetchImpl = this.options.fetchImpl ?? fetch;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetchImpl(url, {
        headers,
        redirect: "manual",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location || hop === MAX_REDIRECTS) {
        throw new PenglaiError("SECURITY_POLICY", "MOSS redirect limit exceeded");
      }
      url = assertAllowedTtsModelRedirect(new URL(location, url).toString());
    }
    throw new PenglaiError("SECURITY_POLICY", "MOSS redirect loop");
  }

  private async preflightDisk(remaining: number): Promise<void> {
    const info = await statfs(this.root);
    const available = Number(info.bavail) * Number(info.bsize);
    if (!Number.isSafeInteger(available) || available < remaining + DISK_SAFETY_BYTES) {
      throw new PenglaiError("SECURITY_POLICY", "insufficient disk space for MOSS model");
    }
  }

  private async verifyInstalled(): Promise<void> {
    const any = this.manifest.files.some((file) => existsSync(this.destination(file)));
    if (any) this.state = "verifying";
    let installed = 0;
    let corrupt = false;
    for (const file of this.manifest.files) {
      const path = this.destination(file);
      if (!existsSync(path)) continue;
      if (await this.isVerifiedFile(path, file)) installed += file.bytes;
      else corrupt = true;
    }
    this.installedBytes = installed;
    const installedManifestValid = installed === totalBytes(this.manifest)
      ? await this.installedManifestValid()
      : false;
    if (installed === totalBytes(this.manifest) && !corrupt && installedManifestValid) {
      this.state = "ready";
      this.errorClass = undefined;
    } else if (corrupt || installed > 0 || existsSync(join(this.revisionDir(), "manifest.json"))) {
      this.state = "corrupt";
      this.errorClass = "SECURITY_POLICY";
    } else {
      this.state = "not_installed";
      this.errorClass = undefined;
    }
  }

  private async isVerifiedFile(
    path: string,
    file: TtsModelFileManifest,
    signal?: AbortSignal,
  ): Promise<boolean> {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes) return false;
      return (await sha256TtsFile(path, signal)) === file.sha256;
    } catch {
      if (signal?.aborted) throw signal.reason;
      return false;
    }
  }

  private async assertVerifiedFile(
    path: string,
    file: TtsModelFileManifest,
    signal?: AbortSignal,
  ): Promise<void> {
    const info = await lstat(path).catch(() => undefined);
    if (!info || !info.isFile() || info.isSymbolicLink()) {
      throw new PenglaiError("SECURITY_POLICY", "MOSS model file type rejected");
    }
    if (info.size !== file.bytes) throw new PenglaiError("SECURITY_POLICY", "MOSS model size mismatch");
    if ((await sha256TtsFile(path, signal)) !== file.sha256) {
      throw new PenglaiError("SECURITY_POLICY", "MOSS model hash mismatch");
    }
  }

  private async installCopy(
    source: string,
    file: TtsModelFileManifest,
    operationId: string,
  ): Promise<void> {
    const dest = this.destination(file);
    const part = this.partPath(file, operationId);
    await this.ensurePrivateDirectory(dirname(dest));
    await copyFile(source, part);
    const handle = await open(part, "r+");
    try {
      await handle.chmod(0o600);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.assertVerifiedFile(part, file);
    if (existsSync(dest)) {
      const info = await lstat(dest);
      if (!info.isFile() || info.isSymbolicLink()) throw new PenglaiError("SECURITY_POLICY", "MOSS destination unsafe");
      await unlink(dest);
    }
    await rename(part, dest);
  }

  private async writeInstalledManifest(): Promise<void> {
    await this.ensurePrivateDirectory(this.revisionDir());
    const payload = JSON.stringify({
      schema: 1,
      id: this.manifest.id,
      revision: this.manifest.revision,
      license: this.manifest.license,
      licenseUrl: this.manifest.licenseUrl,
      licenseSha256: this.manifest.licenseSha256,
      attribution: this.manifest.attribution,
      sources: [...new Map(this.manifest.files.map((file) => [
        `${file.repository}@${file.revision}`,
        { repository: file.repository, revision: file.revision },
      ])).values()],
      files: this.manifest.files.map(({ path, repository, revision, sha256, bytes }) => ({
        path, repository, revision, sha256, bytes,
      })),
    }, null, 2);
    const dest = join(this.revisionDir(), "manifest.json");
    const part = `${dest}.${randomUUID()}.part`;
    const handle = await open(part, "wx", 0o600);
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(part, dest);
  }

  private createOperation(operationId: string, kind: TtsModelOperation["kind"]): TtsModelOperation {
    const at = nowIso();
    const op: TtsModelOperation = {
      operationId,
      kind,
      modelId: this.manifest.id,
      state: "queued",
      completedBytes: 0,
      totalBytes: totalBytes(this.manifest),
      createdAt: at,
      updatedAt: at,
    };
    this.operations.set(operationId, op);
    this.persistOperations();
    return op;
  }

  private updateOperation(
    op: TtsModelOperation,
    patch: {
      state?: TtsModelOperationState;
      completedBytes?: number;
      currentFile?: string | undefined;
      validators?: Record<string, string> | undefined;
      errorClass?: ErrorClass | undefined;
    },
  ): void {
    Object.assign(op, patch, { updatedAt: nowIso() });
    if (patch.currentFile === undefined && "currentFile" in patch) delete op.currentFile;
    if (patch.errorClass === undefined && "errorClass" in patch) delete op.errorClass;
    this.persistOperations();
  }

  private restoreOperations(): void {
    if (!existsSync(this.operationsPath)) return;
    try {
      const info = lstatSync(this.operationsPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024) throw new Error("unsafe ledger");
      const raw = JSON.parse(readFileSync(this.operationsPath, "utf8")) as unknown;
      if (!Array.isArray(raw)) throw new Error("ledger shape");
      for (const value of raw) {
        if (!this.validOperation(value)) throw new Error("ledger row");
        const op = value as TtsModelOperation;
        if (op.state === "running" || op.state === "queued") op.state = "paused";
        this.operations.set(op.operationId, op);
      }
      this.persistOperations();
    } catch {
      throw new PenglaiError("STORE_CORRUPT", "MOSS model operation ledger corrupt");
    }
  }

  private persistOperations(): void {
    const temp = `${this.operationsPath}.${randomUUID()}.part`;
    writeFileSync(temp, JSON.stringify([...this.operations.values()], null, 2), { mode: 0o600, flag: "wx" });
    renameSync(temp, this.operationsPath);
  }

  private validOperation(value: unknown): value is TtsModelOperation {
    if (!value || typeof value !== "object") return false;
    const op = value as TtsModelOperation;
    return (
      OPERATION_ID.test(op.operationId) && (op.kind === "download" || op.kind === "import") &&
      op.modelId === this.manifest.id &&
      ["queued", "running", "paused", "completed", "cancelled", "failed"].includes(op.state) &&
      Number.isSafeInteger(op.completedBytes) && op.completedBytes >= 0 && op.completedBytes <= op.totalBytes &&
      op.totalBytes === totalBytes(this.manifest) && typeof op.createdAt === "string" &&
      typeof op.updatedAt === "string" &&
      (op.currentFile === undefined || this.manifest.files.some((file) => file.path === op.currentFile)) &&
      (op.validators === undefined || (
        Object.keys(op.validators).every((path) => this.manifest.files.some((file) => file.path === path)) &&
        Object.values(op.validators).every((validator) => typeof validator === "string" && validator.length <= 512)
      ))
    );
  }

  private async deleteOperationParts(operationId: string): Promise<void> {
    for (const file of this.manifest.files) {
      const part = this.partPath(file, operationId);
      if (!existsSync(part)) continue;
      const info = await lstat(part);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new PenglaiError("SECURITY_POLICY", "MOSS partial deletion target unsafe");
      }
      await unlink(part);
    }
  }

  private requireOperation(operationId: string, kind: TtsModelOperation["kind"]): TtsModelOperation {
    this.assertOperationId(operationId);
    const op = this.operations.get(operationId);
    if (!op || op.kind !== kind) throw new PenglaiError("INVALID_INPUT", "MOSS operation not found");
    return op;
  }

  private assertOperationId(operationId: string): void {
    if (!OPERATION_ID.test(operationId)) throw new PenglaiError("INVALID_INPUT", "invalid MOSS operation id");
  }

  private assertUsable(): void {
    if (this.disposed) throw new PenglaiError("DSH_UNAVAILABLE", "MOSS model manager disposed");
  }

  private revisionDir(): string {
    return join(this.root, this.manifest.revision);
  }

  private destination(file: TtsModelFileManifest): string {
    const dest = join(this.revisionDir(), file.path);
    const rel = relative(this.root, dest);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || resolve(dest) !== dest) {
      throw new PenglaiError("SECURITY_POLICY", "MOSS destination escaped root");
    }
    return dest;
  }

  private partPath(file: TtsModelFileManifest, operationId: string): string {
    return `${this.destination(file)}.${operationId}.part`;
  }

  private async ensurePrivateDirectory(path: string): Promise<void> {
    const rel = relative(this.root, path);
    if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(path) !== path) {
      throw new PenglaiError("SECURITY_POLICY", "MOSS directory escaped root");
    }
    let cursor = this.root;
    for (const part of rel.split(sep).filter(Boolean)) {
      cursor = join(cursor, part);
      if (!existsSync(cursor)) await mkdir(cursor, { mode: 0o700 });
      const info = await lstat(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new PenglaiError("SECURITY_POLICY", "MOSS model directory unsafe");
      }
    }
  }

  private async assertExactInstalledTree(): Promise<void> {
    const dir = this.revisionDir();
    const expectedRoot = new Set([TTS_DIR, CODEC_DIR, "manifest.json"]);
    const rootEntries = await readdir(dir);
    if (rootEntries.some((entry) => !expectedRoot.has(entry))) {
      throw new PenglaiError("SECURITY_POLICY", "MOSS model directory contains unknown files");
    }
    for (const nested of [TTS_DIR, CODEC_DIR]) {
      const nestedPath = join(dir, nested);
      if (!existsSync(nestedPath)) continue;
      const info = await lstat(nestedPath);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new PenglaiError("SECURITY_POLICY", "MOSS model directory unsafe");
      }
      const expected = new Set(
        this.manifest.files.filter((file) => file.path.startsWith(`${nested}/`)).map((file) => file.sourceName),
      );
      const entries = await readdir(nestedPath);
      if (entries.some((entry) => !expected.has(entry))) {
        throw new PenglaiError("SECURITY_POLICY", "MOSS model directory contains unknown files");
      }
      for (const entry of entries) {
        const item = await lstat(join(nestedPath, entry));
        if (!item.isFile() || item.isSymbolicLink()) {
          throw new PenglaiError("SECURITY_POLICY", "MOSS deletion target unsafe");
        }
      }
    }
  }

  private async assertImportTree(source: string): Promise<void> {
    const expectedRoot = new Set([TTS_DIR, CODEC_DIR]);
    const rootEntries = await readdir(source);
    if (
      rootEntries.length !== expectedRoot.size ||
      rootEntries.some((entry) => !expectedRoot.has(entry))
    ) {
      throw new PenglaiError("SECURITY_POLICY", "MOSS import must contain the exact pinned file set");
    }
    for (const nested of [TTS_DIR, CODEC_DIR]) {
      const nestedPath = join(source, nested);
      const info = await lstat(nestedPath);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new PenglaiError("SECURITY_POLICY", "MOSS import directory unsafe");
      }
      const expected = new Set(
        this.manifest.files
          .filter((file) => file.path.startsWith(`${nested}/`))
          .map((file) => file.sourceName),
      );
      const entries = await readdir(nestedPath);
      if (
        entries.length !== expected.size ||
        entries.some((entry) => !expected.has(entry))
      ) {
        throw new PenglaiError("SECURITY_POLICY", "MOSS import must contain the exact pinned file set");
      }
      for (const entry of entries) {
        const item = await lstat(join(nestedPath, entry));
        if (!item.isFile() || item.isSymbolicLink()) {
          throw new PenglaiError("SECURITY_POLICY", "MOSS import file unsafe");
        }
      }
    }
  }

  private async installedManifestValid(): Promise<boolean> {
    const path = join(this.revisionDir(), "manifest.json");
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) return false;
      const value = JSON.parse(readFileSync(path, "utf8")) as {
        id?: unknown;
        revision?: unknown;
        licenseSha256?: unknown;
        files?: Array<{ path?: unknown; sha256?: unknown; bytes?: unknown }>;
      };
      return (
        value.id === this.manifest.id &&
        value.revision === this.manifest.revision &&
        value.licenseSha256 === this.manifest.licenseSha256 &&
        Array.isArray(value.files) &&
        value.files.length === this.manifest.files.length &&
        this.manifest.files.every((file) => value.files!.some((row) =>
          row.path === file.path && row.sha256 === file.sha256 && row.bytes === file.bytes
        ))
      );
    } catch {
      return false;
    }
  }
}
