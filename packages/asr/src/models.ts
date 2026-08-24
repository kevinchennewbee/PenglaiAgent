import { createHash, randomUUID } from "node:crypto";
import {
  constants,
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
import { basename, dirname, join, relative, resolve } from "node:path";
import { PenglaiError, readExactRegularFile, type ErrorClass } from "@penglai/contracts";
import type { AsrModelState } from "./service.js";

export const SENSEVOICE_MODEL_ID = "sensevoice-int8";
export const SENSEVOICE_REPOSITORY =
  "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17";
export const SENSEVOICE_REVISION =
  "2365baeacb507f821a0c8120fcee3d484dba7a07";

export interface ModelFileManifest {
  filename: string;
  url: string;
  sha256: string;
  bytes: number;
}

export interface ModelManifest {
  id: string;
  label: string;
  repository: string;
  revision: string;
  license: string;
  licenseUrl: string;
  licenseSha256: string;
  attribution: string;
  files: readonly ModelFileManifest[];
}

export const SENSEVOICE_MANIFEST: ModelManifest = Object.freeze({
  id: SENSEVOICE_MODEL_ID,
  label: "SenseVoice int8 zh/en/ja/ko/yue",
  repository: SENSEVOICE_REPOSITORY,
  revision: SENSEVOICE_REVISION,
  license: "FunASR-Model-License-1.1",
  licenseUrl:
    "https://raw.githubusercontent.com/modelscope/FunASR/58830eca4012644aac0c3218c3ccc7d98f003fda/MODEL_LICENSE",
  licenseSha256:
    "7dba975a2069691db4992b0592d70828b330d2f8a30a71450f4e152a554e84f8",
  attribution: "SenseVoiceSmall by FunAudioLLM and Alibaba Group",
  files: Object.freeze([
    Object.freeze({
      filename: "model.int8.onnx",
      url: `https://huggingface.co/${SENSEVOICE_REPOSITORY}/resolve/${SENSEVOICE_REVISION}/model.int8.onnx?download=true`,
      sha256:
        "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
      bytes: 239_233_841,
    }),
    Object.freeze({
      filename: "tokens.txt",
      url: `https://huggingface.co/${SENSEVOICE_REPOSITORY}/resolve/${SENSEVOICE_REVISION}/tokens.txt?download=true`,
      sha256:
        "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
      bytes: 315_894,
    }),
  ]),
});

export interface ModelRecord {
  id: string;
  label: string;
  repository: string;
  revision: string;
  license: string;
  licenseUrl: string;
  licenseSha256: string;
  attribution: string;
  bytes: number;
  installedBytes: number;
  state: AsrModelState;
  files: Array<Pick<ModelFileManifest, "filename" | "sha256" | "bytes">>;
  operation?: ModelOperation;
  errorClass?: ErrorClass;
}

export type ModelOperationState =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export interface ModelOperation {
  operationId: string;
  kind: "download" | "import";
  modelId: string;
  state: ModelOperationState;
  completedBytes: number;
  totalBytes: number;
  currentFile?: string;
  errorClass?: ErrorClass;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedSenseVoiceModel {
  revision: string;
  modelPath: string;
  tokensPath: string;
}

type FetchLike = typeof fetch;
type CapabilityResolver = (capabilityRef: string) => Promise<string>;

const OPERATION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const CAPABILITY_REF = /^[A-Za-z0-9_-]{8,160}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_REDIRECTS = 5;
const DISK_SAFETY_BYTES = 64 * 1024 * 1024;

function nowIso(): string {
  return new Date().toISOString();
}

function totalBytes(manifest: ModelManifest): number {
  return manifest.files.reduce((sum, file) => sum + file.bytes, 0);
}

function stableErrorClass(error: unknown): ErrorClass {
  if (error instanceof PenglaiError) return error.errorClass;
  if (error instanceof DOMException && error.name === "AbortError") {
    return "DELIVERY_TRANSIENT";
  }
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  if (["ENOSPC", "EROFS", "EACCES", "EPERM"].includes(code)) {
    return "SECURITY_POLICY";
  }
  return "DELIVERY_TRANSIENT";
}

function assertSafeLeaf(filename: string): void {
  if (
    !filename ||
    basename(filename) !== filename ||
    filename.includes("\0") ||
    filename === "." ||
    filename === ".."
  ) {
    throw new PenglaiError("SECURITY_POLICY", "unsafe ASR model filename");
  }
}

function assertManifest(manifest: ModelManifest): void {
  if (!manifest.id || !/^[A-Za-z0-9_-]+$/.test(manifest.id)) {
    throw new PenglaiError("INVALID_INPUT", "invalid ASR model id");
  }
  if (!/^[0-9a-f]{40}$/.test(manifest.revision)) {
    throw new PenglaiError("SECURITY_POLICY", "ASR model revision must be immutable");
  }
  if (!manifest.files.length) {
    throw new PenglaiError("INVALID_INPUT", "ASR model manifest has no files");
  }
  if (
    !manifest.license ||
    !SHA256.test(manifest.licenseSha256) ||
    !manifest.attribution ||
    !manifest.licenseUrl.startsWith("https://raw.githubusercontent.com/") ||
    (manifest.id === SENSEVOICE_MODEL_ID &&
      !manifest.licenseUrl.includes(
        "/58830eca4012644aac0c3218c3ccc7d98f003fda/",
      ))
  ) {
    throw new PenglaiError("SECURITY_POLICY", "ASR model license provenance invalid");
  }
  for (const file of manifest.files) {
    assertSafeLeaf(file.filename);
    if (!SHA256.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0) {
      throw new PenglaiError("SECURITY_POLICY", "ASR model file pin invalid");
    }
    assertCanonicalModelUrl(file.url, manifest);
  }
}

export function assertCanonicalModelUrl(
  value: string,
  manifest: ModelManifest = SENSEVOICE_MANIFEST,
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PenglaiError("INVALID_INPUT", "invalid ASR model URL");
  }
  const expectedPrefix = `/${manifest.repository}/resolve/${manifest.revision}/`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "huggingface.co" ||
    !url.pathname.startsWith(expectedPrefix) ||
    /(?:^|\/)(?:main|master|latest)(?:\/|$)/i.test(url.pathname)
  ) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "ASR model URL must use the pinned Hugging Face revision",
    );
  }
  return url;
}

export function assertAllowedModelRedirect(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PenglaiError("SECURITY_POLICY", "invalid ASR model redirect");
  }
  const host = url.hostname.toLowerCase();
  const allowed = host === "huggingface.co" || host.endsWith(".hf.co");
  if (url.protocol !== "https:" || !allowed || url.username || url.password) {
    throw new PenglaiError("SECURITY_POLICY", "ASR model redirect host rejected");
  }
  return url;
}

export async function sha256File(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
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
    throw new PenglaiError("SECURITY_POLICY", "ASR model root must be a real directory");
  }
}

export class AsrModelManager {
  private state: AsrModelState = "not_installed";
  private installedBytes = 0;
  private errorClass: ErrorClass | undefined;
  private readonly operations = new Map<string, ModelOperation>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly running = new Map<string, Promise<ModelOperation>>();
  private initPromise: Promise<void> | undefined;
  private modelOwner: string | undefined;
  private disposed = false;
  private readonly operationsPath: string;

  constructor(
    private readonly root: string,
    readonly manifest: ModelManifest = SENSEVOICE_MANIFEST,
    private readonly options: {
      fetchImpl?: FetchLike;
      resolveCapability?: CapabilityResolver;
    } = {},
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

  describeModels(): ModelRecord[] {
    const operation = [...this.operations.values()]
      .filter((row) => row.kind === "download" && ["queued", "running", "paused"].includes(row.state))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return [
      {
        id: this.manifest.id,
        label: this.manifest.label,
        repository: this.manifest.repository,
        revision: this.manifest.revision,
        license: this.manifest.license,
        licenseUrl: this.manifest.licenseUrl,
        licenseSha256: this.manifest.licenseSha256,
        attribution: this.manifest.attribution,
        bytes: totalBytes(this.manifest),
        installedBytes: this.installedBytes,
        state: this.state,
        files: this.manifest.files.map(({ filename, sha256, bytes }) => ({
          filename,
          sha256,
          bytes,
        })),
        ...(operation ? { operation: { ...operation } } : {}),
        ...(this.errorClass ? { errorClass: this.errorClass } : {}),
      },
    ];
  }

  describeCapability(): {
    plugin: "active";
    engine: "sherpa-onnx-1.13.5";
    model: AsrModelState;
    enterTurn: false;
  } {
    return {
      plugin: "active",
      engine: "sherpa-onnx-1.13.5",
      model: this.state,
      enterTurn: false,
    };
  }

  getOperation(operationId: string): ModelOperation | undefined {
    const op = this.operations.get(operationId);
    return op ? { ...op } : undefined;
  }

  async prepareModel(operationId: string): Promise<ModelOperation> {
    this.assertUsable();
    this.assertOperationId(operationId);
    await this.initialize();
    const previous = this.operations.get(operationId);
    if (previous?.state === "completed" && this.state === "ready") {
      return { ...previous };
    }
    if (previous && previous.state !== "paused") {
      throw new PenglaiError("INVALID_INPUT", "ASR model operation id already used");
    }
    const existing = this.running.get(operationId);
    if (existing) return existing;
    if (this.modelOwner && this.modelOwner !== operationId) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "ASR model install backpressure");
    }
    const op =
      previous ??
      this.createOperation(operationId, "download", totalBytes(this.manifest));
    return this.startDownload(op);
  }

  pauseDownload(operationId: string): ModelOperation {
    const op = this.requireOperation(operationId, "download");
    if (op.state !== "running" && op.state !== "queued") {
      throw new PenglaiError("INVALID_INPUT", "ASR download is not running");
    }
    this.updateOperation(op, { state: "paused" });
    this.state = "paused";
    this.controllers.get(operationId)?.abort("paused");
    return { ...op };
  }

  async resumeDownload(operationId: string): Promise<ModelOperation> {
    const op = this.requireOperation(operationId, "download");
    if (op.state !== "paused") {
      throw new PenglaiError("INVALID_INPUT", "ASR download is not paused");
    }
    await this.running.get(operationId)?.catch(() => undefined);
    return this.startDownload(op);
  }

  async cancelDownload(operationId: string): Promise<ModelOperation> {
    const op = this.requireOperation(operationId, "download");
    if (["completed", "failed", "cancelled"].includes(op.state)) {
      throw new PenglaiError("INVALID_INPUT", "ASR download cannot be cancelled");
    }
    this.updateOperation(op, { state: "cancelled" });
    this.controllers.get(operationId)?.abort("cancelled");
    await this.running.get(operationId)?.catch(() => undefined);
    await this.deleteOperationParts(operationId);
    await this.verifyInstalled();
    return { ...op };
  }

  async importVerifiedModel(
    operationId: string,
    capabilityRef: string,
  ): Promise<ModelOperation> {
    this.assertUsable();
    this.assertOperationId(operationId);
    if (!CAPABILITY_REF.test(capabilityRef)) {
      throw new PenglaiError("SECURITY_POLICY", "ASR import requires an opaque capability reference");
    }
    if (!this.options.resolveCapability) {
      throw new PenglaiError("DSH_UNAVAILABLE", "ASR import capability resolver unavailable");
    }
    await this.initialize();
    if (this.operations.has(operationId)) {
      throw new PenglaiError("INVALID_INPUT", "ASR model operation id already used");
    }
    if (this.modelOwner) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "ASR model install backpressure");
    }
    const op = this.createOperation(operationId, "import", totalBytes(this.manifest));
    this.modelOwner = operationId;
    this.updateOperation(op, { state: "running" });
    this.state = "verifying";
    try {
      const source = resolve(await this.options.resolveCapability(capabilityRef));
      const sourceInfo = await lstat(source);
      if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
        throw new PenglaiError("SECURITY_POLICY", "ASR import source must be a real directory");
      }
      await this.preflightDisk(totalBytes(this.manifest));
      for (const file of this.manifest.files) {
        const sourceFile = join(source, file.filename);
        await this.assertVerifiedFile(sourceFile, file);
        await this.installCopy(sourceFile, file, operationId);
        op.completedBytes += file.bytes;
        this.updateOperation(op, {
          completedBytes: op.completedBytes,
          currentFile: file.filename,
        });
      }
      await this.writeInstalledManifest();
      this.installedBytes = totalBytes(this.manifest);
      this.state = "ready";
      this.errorClass = undefined;
      this.updateOperation(op, { state: "completed", currentFile: undefined });
      return { ...op };
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

  async requireReady(): Promise<ResolvedSenseVoiceModel> {
    await this.initialize();
    if (this.state !== "ready") {
      throw new PenglaiError("DSH_UNAVAILABLE", "ASR model not installed");
    }
    const model = this.manifest.files.find(
      (file) => file.filename === "model.int8.onnx",
    );
    const tokens = this.manifest.files.find(
      (file) => file.filename === "tokens.txt",
    );
    if (!model || !tokens) {
      throw new PenglaiError("STORE_CORRUPT", "SenseVoice model manifest incomplete");
    }
    return {
      revision: this.manifest.revision,
      modelPath: this.destination(model),
      tokensPath: this.destination(tokens),
    };
  }

  async deleteModel(
    revision: string,
    confirmation: { revision: string; acknowledged: true },
  ): Promise<{ deleted: true; revision: string }> {
    await this.initialize();
    if (
      revision !== this.manifest.revision ||
      confirmation.revision !== revision ||
      confirmation.acknowledged !== true
    ) {
      throw new PenglaiError("SECURITY_POLICY", "ASR model deletion confirmation mismatch");
    }
    if (this.modelOwner) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "ASR model is busy");
    }
    const dir = this.revisionDir();
    if (existsSync(dir)) {
      const info = await lstat(dir);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new PenglaiError("SECURITY_POLICY", "ASR model revision path unsafe");
      }
      const allowed = new Set([
        ...this.manifest.files.map((file) => file.filename),
        "manifest.json",
      ]);
      const entries = await readdir(dir);
      const unknown = entries.filter((entry) => !allowed.has(entry));
      if (unknown.length) {
        throw new PenglaiError("SECURITY_POLICY", "ASR model directory contains unknown files");
      }
      for (const entry of entries) {
        const path = join(dir, entry);
        const entryInfo = await lstat(path);
        if (!entryInfo.isFile() || entryInfo.isSymbolicLink()) {
          throw new PenglaiError("SECURITY_POLICY", "ASR model deletion target unsafe");
        }
      }
      for (const entry of entries) await unlink(join(dir, entry));
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

  private startDownload(op: ModelOperation): Promise<ModelOperation> {
    if (this.modelOwner && this.modelOwner !== op.operationId) {
      return Promise.reject(
        new PenglaiError("DELIVERY_TRANSIENT", "ASR model install backpressure"),
      );
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

  private async runDownload(
    op: ModelOperation,
    signal: AbortSignal,
  ): Promise<ModelOperation> {
    try {
      await this.preflightDisk(totalBytes(this.manifest) - this.installedBytes);
      this.updateOperation(op, { completedBytes: 0 });
      for (const file of this.manifest.files) {
        if (signal.aborted) throw signal.reason;
        this.updateOperation(op, { currentFile: file.filename });
        const already = await this.isVerifiedFile(
          this.destination(file),
          file,
          signal,
        );
        if (already) {
          op.completedBytes += file.bytes;
          this.updateOperation(op, { completedBytes: op.completedBytes });
          continue;
        }
        await this.downloadFile(file, op, signal);
      }
      await this.writeInstalledManifest();
      this.installedBytes = totalBytes(this.manifest);
      this.state = "ready";
      this.errorClass = undefined;
      this.updateOperation(op, { state: "completed", currentFile: undefined });
      return { ...op };
    } catch (error) {
      if (op.state === "paused" || op.state === "cancelled") return { ...op };
      const errorClass = stableErrorClass(error);
      this.state = "failed";
      this.errorClass = errorClass;
      this.updateOperation(op, { state: "failed", errorClass });
      throw error;
    }
  }

  private async downloadFile(
    file: ModelFileManifest,
    op: ModelOperation,
    signal: AbortSignal,
  ): Promise<void> {
    const dest = this.destination(file);
    await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
    const part = this.partPath(file, op.operationId);
    const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
    const flags = constants.O_RDWR | constants.O_CREAT | noFollow;
    const handle = await open(part, flags, 0o600);
    const completedBefore = op.completedBytes;
    let written = 0;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > file.bytes) {
        throw new PenglaiError("SECURITY_POLICY", "ASR partial model file unsafe");
      }
      let existing = opened.size;
      const headers: Record<string, string> = {
        "User-Agent": "Penglai/0.5.6 model-manager",
      };
      if (existing) headers.Range = `bytes=${existing}-`;
      const response = await this.fetchPinned(file.url, headers, signal);
      if (response.status !== 200 && response.status !== 206) {
        throw new PenglaiError(
          response.status >= 500 || response.status === 429
            ? "DELIVERY_TRANSIENT"
            : "DELIVERY_PERMANENT",
          `ASR model download rejected with status ${response.status}`,
        );
      }
      if (!response.body) {
        throw new PenglaiError("DELIVERY_TRANSIENT", "ASR model download body missing");
      }
      if (existing && response.status === 206) {
        const range = response.headers.get("content-range") ?? "";
        if (!range.startsWith(`bytes ${existing}-`) || !range.endsWith(`/${file.bytes}`)) {
          throw new PenglaiError("SECURITY_POLICY", "ASR model Range response mismatch");
        }
      } else if (existing && response.status === 200) {
        await handle.truncate(0);
        existing = 0;
      } else if (!existing && response.status === 206) {
        const range = response.headers.get("content-range") ?? "";
        if (!range.startsWith("bytes 0-") || !range.endsWith(`/${file.bytes}`)) {
          throw new PenglaiError("SECURITY_POLICY", "ASR model unsolicited Range mismatch");
        }
      }
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (
        !Number.isFinite(contentLength) ||
        contentLength < 0 ||
        (contentLength > 0 && existing + contentLength > file.bytes)
      ) {
        throw new PenglaiError("SECURITY_POLICY", "ASR model Content-Length mismatch");
      }
      let lastPersisted = existing;
      written = existing;
      for await (const raw of response.body as unknown as AsyncIterable<Uint8Array>) {
        if (signal.aborted) throw signal.reason;
        const chunk = Buffer.from(raw);
        if (written + chunk.length > file.bytes) {
          throw new PenglaiError("SECURITY_POLICY", "ASR model download exceeds pinned size");
        }
        let offset = 0;
        while (offset < chunk.length) {
          const result = await handle.write(chunk, offset, chunk.length - offset, written + offset);
          if (result.bytesWritten <= 0) {
            throw new PenglaiError("DELIVERY_TRANSIENT", "ASR model write made no progress");
          }
          offset += result.bytesWritten;
        }
        written += chunk.length;
        if (written - lastPersisted >= 1024 * 1024) {
          this.updateOperation(op, {
            completedBytes: completedBefore + Math.min(written, file.bytes),
          });
          lastPersisted = written;
        }
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (written !== file.bytes) {
      throw new PenglaiError("DELIVERY_TRANSIENT", "ASR model download truncated");
    }
    await this.assertVerifiedFile(part, file, signal);
    if (existsSync(dest)) {
      const info = await lstat(dest);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new PenglaiError("SECURITY_POLICY", "ASR model destination unsafe");
      }
      await unlink(dest);
    }
    await rename(part, dest);
    this.updateOperation(op, {
      completedBytes: completedBefore + file.bytes,
    });
  }

  private async fetchPinned(
    initial: string,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Response> {
    let url = assertCanonicalModelUrl(initial, this.manifest);
    const fetchImpl = this.options.fetchImpl ?? fetch;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const requestSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(10 * 60_000),
      ]);
      const response = await fetchImpl(url, {
        headers,
        redirect: "manual",
        signal: requestSignal,
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location || hop === MAX_REDIRECTS) {
        throw new PenglaiError("SECURITY_POLICY", "ASR model redirect limit exceeded");
      }
      url = assertAllowedModelRedirect(new URL(location, url).toString());
    }
    throw new PenglaiError("SECURITY_POLICY", "ASR model redirect loop");
  }

  private async preflightDisk(remaining: number): Promise<void> {
    const info = await statfs(this.root);
    const available = Number(info.bavail) * Number(info.bsize);
    if (!Number.isSafeInteger(available) || available < remaining + DISK_SAFETY_BYTES) {
      throw new PenglaiError("SECURITY_POLICY", "insufficient disk space for ASR model");
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
    if (installed === totalBytes(this.manifest) && !corrupt) {
      this.state = "ready";
      this.errorClass = undefined;
    } else if (corrupt || installed > 0) {
      this.state = "corrupt";
      this.errorClass = "SECURITY_POLICY";
    } else {
      this.state = "not_installed";
      this.errorClass = undefined;
    }
  }

  private async isVerifiedFile(
    path: string,
    file: ModelFileManifest,
    signal?: AbortSignal,
  ): Promise<boolean> {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes) return false;
      return (await sha256File(path, signal)) === file.sha256;
    } catch {
      if (signal?.aborted) throw signal.reason;
      return false;
    }
  }

  private async assertVerifiedFile(
    path: string,
    file: ModelFileManifest,
    signal?: AbortSignal,
  ): Promise<void> {
    const info = await lstat(path).catch(() => undefined);
    if (!info || !info.isFile() || info.isSymbolicLink()) {
      throw new PenglaiError("SECURITY_POLICY", "ASR model file type rejected");
    }
    if (info.size !== file.bytes) {
      throw new PenglaiError("SECURITY_POLICY", "ASR model size mismatch");
    }
    if ((await sha256File(path, signal)) !== file.sha256) {
      throw new PenglaiError("SECURITY_POLICY", "ASR model hash mismatch");
    }
  }

  private async installCopy(
    source: string,
    file: ModelFileManifest,
    operationId: string,
  ): Promise<void> {
    const dest = this.destination(file);
    const part = this.partPath(file, operationId);
    await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
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
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new PenglaiError("SECURITY_POLICY", "ASR model destination unsafe");
      }
      await unlink(dest);
    }
    await rename(part, dest);
  }

  private async writeInstalledManifest(): Promise<void> {
    const payload = JSON.stringify(
      {
        schema: 1,
        id: this.manifest.id,
        revision: this.manifest.revision,
        license: this.manifest.license,
        licenseUrl: this.manifest.licenseUrl,
        licenseSha256: this.manifest.licenseSha256,
        attribution: this.manifest.attribution,
        files: this.manifest.files.map(({ filename, sha256, bytes }) => ({
          filename,
          sha256,
          bytes,
        })),
      },
      null,
      2,
    );
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

  private createOperation(
    operationId: string,
    kind: ModelOperation["kind"],
    total: number,
  ): ModelOperation {
    const at = nowIso();
    const op: ModelOperation = {
      operationId,
      kind,
      modelId: this.manifest.id,
      state: "queued",
      completedBytes: 0,
      totalBytes: total,
      createdAt: at,
      updatedAt: at,
    };
    this.operations.set(operationId, op);
    this.persistOperations();
    return op;
  }

  private updateOperation(
    op: ModelOperation,
    patch: {
      state?: ModelOperationState;
      completedBytes?: number;
      totalBytes?: number;
      currentFile?: string | undefined;
      errorClass?: ErrorClass | undefined;
    },
  ): void {
    Object.assign(op, patch, { updatedAt: nowIso() });
    if (patch.currentFile === undefined && "currentFile" in patch) delete op.currentFile;
    if (patch.errorClass === undefined && "errorClass" in patch) delete op.errorClass;
    this.persistOperations();
  }

  private restoreOperations(): void {
    try {
      const bytes = readExactRegularFile(this.operationsPath, 256 * 1024);
      const raw = JSON.parse(bytes.toString("utf8")) as unknown;
      if (!Array.isArray(raw)) throw new Error("operations ledger shape");
      for (const value of raw) {
        if (!value || typeof value !== "object") {
          throw new Error("invalid ASR operation row");
        }
        const op = value as ModelOperation;
        if (!this.validOperation(op)) {
          throw new Error("invalid ASR operation row");
        }
        if (op.state === "running" || op.state === "queued") op.state = "paused";
        this.operations.set(op.operationId, op);
      }
      this.persistOperations();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new PenglaiError("STORE_CORRUPT", "ASR model operation ledger corrupt");
    }
  }

  private persistOperations(): void {
    const temp = `${this.operationsPath}.${randomUUID()}.part`;
    writeFileSync(temp, JSON.stringify([...this.operations.values()], null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temp, this.operationsPath);
  }

  private validOperation(op: ModelOperation): boolean {
    return (
      OPERATION_ID.test(op.operationId) &&
      (op.kind === "download" || op.kind === "import") &&
      op.modelId === this.manifest.id &&
      ["queued", "running", "paused", "completed", "cancelled", "failed"].includes(
        op.state,
      ) &&
      Number.isSafeInteger(op.completedBytes) &&
      op.completedBytes >= 0 &&
      Number.isSafeInteger(op.totalBytes) &&
      op.totalBytes === totalBytes(this.manifest) &&
      typeof op.createdAt === "string" &&
      typeof op.updatedAt === "string" &&
      (op.currentFile === undefined ||
        this.manifest.files.some((file) => file.filename === op.currentFile)) &&
      (op.errorClass === undefined ||
        [
          "INVALID_INPUT",
          "UNAUTHORIZED",
          "BINDING_STALE",
          "DSH_UNAVAILABLE",
          "DSH_CONTRACT_DRIFT",
          "DELIVERY_TRANSIENT",
          "DELIVERY_PERMANENT",
          "AUTH_EXPIRED",
          "STORE_CORRUPT",
          "SECURITY_POLICY",
        ].includes(op.errorClass))
    );
  }

  private async deleteOperationParts(operationId: string): Promise<void> {
    for (const file of this.manifest.files) {
      const part = this.partPath(file, operationId);
      if (!existsSync(part)) continue;
      const info = await lstat(part);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new PenglaiError("SECURITY_POLICY", "ASR partial deletion target unsafe");
      }
      await unlink(part);
    }
  }

  private requireOperation(
    operationId: string,
    kind: ModelOperation["kind"],
  ): ModelOperation {
    this.assertOperationId(operationId);
    const op = this.operations.get(operationId);
    if (!op || op.kind !== kind) {
      throw new PenglaiError("INVALID_INPUT", "ASR model operation not found");
    }
    return op;
  }

  private assertOperationId(operationId: string): void {
    if (!OPERATION_ID.test(operationId)) {
      throw new PenglaiError("INVALID_INPUT", "invalid ASR operation id");
    }
  }

  private assertUsable(): void {
    if (this.disposed) throw new PenglaiError("DSH_UNAVAILABLE", "ASR model manager disposed");
  }

  private revisionDir(): string {
    return join(this.root, this.manifest.revision);
  }

  private destination(file: ModelFileManifest): string {
    const dest = join(this.revisionDir(), file.filename);
    const rel = relative(this.root, dest);
    if (!rel || rel.startsWith("..") || resolve(dest) !== dest) {
      throw new PenglaiError("SECURITY_POLICY", "ASR model destination escaped root");
    }
    return dest;
  }

  private partPath(file: ModelFileManifest, operationId: string): string {
    return `${this.destination(file)}.${operationId}.part`;
  }
}
