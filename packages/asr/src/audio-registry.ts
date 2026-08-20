import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { PenglaiError } from "@penglai/contracts";

export type AudioSource = "mic" | "im" | "attachment" | "fixture";

export interface AudioHandle {
  id: string;
  digest: string;
  mediaType: string;
  bytes: number;
  durationMs: number;
  source: AudioSource;
  ownerOperation: string;
  expiresAt: number;
}

interface AudioRecord extends AudioHandle {
  filename: string;
}

export interface StageAudioInput {
  mediaType: string;
  durationMs: number;
  source: AudioSource;
  ownerOperation: string;
  ttlMs?: number;
}

const OPERATION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const HANDLE_ID = /^[0-9a-f-]{36}$/;
const HANDLE_FILE = /^[0-9a-f-]{36}\.audio$/;
const MAX_TTL_MS = 30 * 60_000;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_DURATION_MS = 180_000;
const SOURCES = new Set<AudioSource>(["mic", "im", "attachment", "fixture"]);

function digest(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function ensurePrivateRoot(root: string): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "ASR audio temp root must be a real directory");
  }
}

export class AudioHandleRegistry {
  private readonly records = new Map<string, AudioRecord>();
  private readonly ledgerPath: string;
  private initialized = false;
  private disposed = false;

  constructor(private readonly root: string, private readonly now: () => number = Date.now) {
    ensurePrivateRoot(root);
    this.ledgerPath = join(root, "handles.json");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (!existsSync(this.ledgerPath)) return;
    let raw: unknown;
    try {
      const info = lstatSync(this.ledgerPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024) {
        throw new Error("unsafe ASR handle ledger");
      }
      raw = JSON.parse(readFileSync(this.ledgerPath, "utf8")) as unknown;
    } catch {
      throw new PenglaiError("STORE_CORRUPT", "ASR audio handle ledger corrupt");
    }
    if (!Array.isArray(raw)) {
      throw new PenglaiError("STORE_CORRUPT", "ASR audio handle ledger shape invalid");
    }
    for (const value of raw) {
      if (!this.isRecord(value)) {
        throw new PenglaiError("STORE_CORRUPT", "ASR audio handle row invalid");
      }
      const record = value as unknown as AudioRecord;
      if (!this.validRecord(record)) {
        throw new PenglaiError("STORE_CORRUPT", "ASR audio handle row invalid");
      }
      const path = this.pathFor(record.filename);
      if (record.expiresAt > this.now()) {
        const info = await lstat(path).catch(() => undefined);
        if (
          !info ||
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.size !== record.bytes ||
          digest(await readFile(path)) !== record.digest
        ) {
          throw new PenglaiError("STORE_CORRUPT", "ASR audio handle file corrupt");
        }
      }
      this.records.set(record.id, record);
    }
    await this.reapExpired();
  }

  async stage(buf: Buffer, input: StageAudioInput): Promise<AudioHandle> {
    await this.initialize();
    this.assertUsable();
    if (!buf.length || buf.length > MAX_AUDIO_BYTES) {
      throw new PenglaiError("INVALID_INPUT", "ASR audio size rejected");
    }
    if (!OPERATION_ID.test(input.ownerOperation)) {
      throw new PenglaiError("INVALID_INPUT", "invalid ASR audio owner operation");
    }
    if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(input.mediaType)) {
      throw new PenglaiError("INVALID_INPUT", "invalid ASR audio media type");
    }
    if (
      !Number.isSafeInteger(input.durationMs) ||
      input.durationMs <= 0 ||
      input.durationMs > MAX_AUDIO_DURATION_MS
    ) {
      throw new PenglaiError("INVALID_INPUT", "invalid ASR audio duration");
    }
    if (!SOURCES.has(input.source)) {
      throw new PenglaiError("INVALID_INPUT", "invalid ASR audio source");
    }
    const ttl = input.ttlMs ?? 15 * 60_000;
    if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_TTL_MS) {
      throw new PenglaiError("INVALID_INPUT", "invalid ASR audio TTL");
    }
    const id = randomUUID();
    const filename = `${id}.audio`;
    const record: AudioRecord = {
      id,
      digest: digest(buf),
      mediaType: input.mediaType,
      bytes: buf.length,
      durationMs: input.durationMs,
      source: input.source,
      ownerOperation: input.ownerOperation,
      expiresAt: this.now() + ttl,
      filename,
    };
    const dest = this.pathFor(filename);
    const part = `${dest}.${randomUUID()}.part`;
    const handle = await open(part, "wx", 0o600);
    try {
      await handle.writeFile(buf);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(part, dest);
    this.records.set(id, record);
    try {
      this.persist();
    } catch (error) {
      this.records.delete(id);
      await unlink(dest).catch(() => undefined);
      throw error;
    }
    return this.publicHandle(record);
  }

  async resolve(handle: AudioHandle, operationId: string): Promise<Buffer> {
    await this.initialize();
    this.assertUsable();
    if (!OPERATION_ID.test(operationId) || handle.ownerOperation !== operationId) {
      throw new PenglaiError("UNAUTHORIZED", "ASR audio handle owner mismatch");
    }
    const record = this.records.get(handle.id);
    if (!record || !this.sameHandle(record, handle)) {
      throw new PenglaiError("INVALID_INPUT", "ASR audio handle missing or stale");
    }
    if (record.expiresAt <= this.now()) {
      await this.release(record.id);
      throw new PenglaiError("INVALID_INPUT", "ASR audio handle expired");
    }
    const path = this.pathFor(record.filename);
    const info = await lstat(path).catch(() => undefined);
    if (
      !info ||
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size !== record.bytes
    ) {
      throw new PenglaiError("SECURITY_POLICY", "ASR audio handle file rejected");
    }
    const buf = await readFile(path);
    if (digest(buf) !== record.digest) {
      throw new PenglaiError("SECURITY_POLICY", "ASR audio handle digest mismatch");
    }
    return buf;
  }

  async release(id: string): Promise<boolean> {
    await this.initialize();
    const record = this.records.get(id);
    if (!record) return false;
    const path = this.pathFor(record.filename);
    if (existsSync(path)) {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new PenglaiError("SECURITY_POLICY", "ASR audio cleanup target rejected");
      }
      await unlink(path);
    }
    this.records.delete(id);
    this.persist();
    return true;
  }

  async reapExpired(): Promise<number> {
    let count = 0;
    for (const record of [...this.records.values()]) {
      if (record.expiresAt > this.now()) continue;
      if (await this.release(record.id)) count += 1;
    }
    return count;
  }

  describe(): { active: number; nextExpiry?: number } {
    const expiries = [...this.records.values()].map((record) => record.expiresAt);
    return {
      active: this.records.size,
      ...(expiries.length ? { nextExpiry: Math.min(...expiries) } : {}),
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.initialize();
    for (const id of [...this.records.keys()]) await this.release(id);
    this.disposed = true;
  }

  private persist(): void {
    const part = `${this.ledgerPath}.${randomUUID()}.part`;
    writeFileSync(part, JSON.stringify([...this.records.values()], null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(part, this.ledgerPath);
  }

  private pathFor(filename: string): string {
    if (!HANDLE_FILE.test(filename)) {
      throw new PenglaiError("SECURITY_POLICY", "invalid ASR audio handle filename");
    }
    const path = join(this.root, filename);
    const rel = relative(this.root, path);
    if (!rel || rel.startsWith("..") || resolve(path) !== path) {
      throw new PenglaiError("SECURITY_POLICY", "ASR audio handle escaped temp root");
    }
    return path;
  }

  private sameHandle(record: AudioRecord, handle: AudioHandle): boolean {
    return (
      record.id === handle.id &&
      record.digest === handle.digest &&
      record.mediaType === handle.mediaType &&
      record.bytes === handle.bytes &&
      record.durationMs === handle.durationMs &&
      record.source === handle.source &&
      record.ownerOperation === handle.ownerOperation &&
      record.expiresAt === handle.expiresAt
    );
  }

  private publicHandle(record: AudioRecord): AudioHandle {
    const { filename: _filename, ...handle } = record;
    return handle;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  private validRecord(record: AudioRecord): boolean {
    return (
      HANDLE_ID.test(record.id) &&
      record.filename === `${record.id}.audio` &&
      /^[0-9a-f]{64}$/.test(record.digest) &&
      Number.isSafeInteger(record.bytes) &&
      record.bytes > 0 &&
      record.bytes <= MAX_AUDIO_BYTES &&
      Number.isSafeInteger(record.durationMs) &&
      record.durationMs > 0 &&
      record.durationMs <= MAX_AUDIO_DURATION_MS &&
      SOURCES.has(record.source) &&
      OPERATION_ID.test(record.ownerOperation) &&
      Number.isSafeInteger(record.expiresAt)
    );
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new PenglaiError("DSH_UNAVAILABLE", "ASR audio handle registry disposed");
    }
  }
}
