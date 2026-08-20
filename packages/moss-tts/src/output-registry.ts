import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { PenglaiError } from "@penglai/contracts";

export interface TtsAudioHandle {
  id: string;
  digest: string;
  bytes: number;
  durationMs: number;
  voiceId: string;
  sourceFinalDigest: string;
  ownerOperation: string;
  expiresAt: number;
}

interface StoredOutput extends TtsAudioHandle { file: string }

const HANDLE_ID = /^[0-9a-f-]{36}$/;
const OPERATION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const DEFAULT_TTL_MS = 30 * 60_000;
const MAX_TTL_MS = 24 * 60 * 60_000;

export class TtsOutputRegistry {
  private readonly records = new Map<string, StoredOutput>();
  private readonly ledger: string;
  private disposed = false;

  constructor(
    private readonly root: string,
    private readonly now: () => number = Date.now,
  ) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const info = lstatSync(root);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new PenglaiError("SECURITY_POLICY", "TTS output root must be a real directory");
    }
    this.ledger = join(root, "outputs.json");
    this.restore();
  }

  async initialize(): Promise<void> {
    await this.reapExpired();
  }

  async stage(
    wav: Buffer,
    input: {
      durationMs: number;
      voiceId: string;
      sourceFinalDigest: string;
      ownerOperation: string;
      ttlMs?: number;
    },
  ): Promise<TtsAudioHandle> {
    this.assertUsable();
    if (
      wav.length < 44 || wav.length > MAX_OUTPUT_BYTES ||
      wav.subarray(0, 4).toString("ascii") !== "RIFF" ||
      !Number.isSafeInteger(input.durationMs) || input.durationMs <= 0 ||
      !OPERATION_ID.test(input.ownerOperation) || !SHA256.test(input.sourceFinalDigest) ||
      !input.voiceId || Buffer.byteLength(input.voiceId, "utf8") > 128
    ) {
      throw new PenglaiError("INVALID_INPUT", "TTS output staging input rejected");
    }
    const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_TTL_MS) {
      throw new PenglaiError("INVALID_INPUT", "TTS output TTL rejected");
    }
    const id = randomUUID();
    const file = `${id}.wav`;
    const destination = join(this.root, file);
    const part = `${destination}.${randomUUID()}.part`;
    const output = await open(part, "wx", 0o600);
    try {
      await output.writeFile(wav);
      await output.sync();
    } finally {
      await output.close();
    }
    await rename(part, destination);
    const record: StoredOutput = {
      id,
      file,
      digest: createHash("sha256").update(wav).digest("hex"),
      bytes: wav.length,
      durationMs: input.durationMs,
      voiceId: input.voiceId,
      sourceFinalDigest: input.sourceFinalDigest,
      ownerOperation: input.ownerOperation,
      expiresAt: this.now() + ttl,
    };
    this.records.set(id, record);
    this.persist();
    return this.publicHandle(record);
  }

  async resolve(handle: TtsAudioHandle, ownerOperation: string): Promise<Buffer> {
    this.assertUsable();
    const record = this.records.get(handle.id);
    if (!record || record.ownerOperation !== ownerOperation || record.expiresAt <= this.now()) {
      throw new PenglaiError("UNAUTHORIZED", "TTS output handle unavailable");
    }
    if (JSON.stringify(this.publicHandle(record)) !== JSON.stringify(handle)) {
      throw new PenglaiError("SECURITY_POLICY", "TTS output handle metadata mismatch");
    }
    const path = join(this.root, record.file);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== record.bytes) {
      throw new PenglaiError("STORE_CORRUPT", "TTS output file invalid");
    }
    const wav = readFileSync(path);
    if (createHash("sha256").update(wav).digest("hex") !== record.digest) {
      throw new PenglaiError("STORE_CORRUPT", "TTS output digest mismatch");
    }
    return wav;
  }

  async release(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    const path = join(this.root, record.file);
    if (existsSync(path)) {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new PenglaiError("SECURITY_POLICY", "TTS output cleanup target unsafe");
      }
      await unlink(path);
    }
    this.records.delete(id);
    this.persist();
  }

  async reapExpired(): Promise<number> {
    let count = 0;
    for (const [id, record] of this.records) {
      if (record.expiresAt > this.now()) continue;
      await this.release(id);
      count += 1;
    }
    return count;
  }

  describe(): { active: number; bytes: number } {
    return {
      active: this.records.size,
      bytes: [...this.records.values()].reduce((sum, record) => sum + record.bytes, 0),
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    for (const id of [...this.records.keys()]) await this.release(id);
    this.disposed = true;
  }

  private restore(): void {
    if (!existsSync(this.ledger)) return;
    try {
      const info = lstatSync(this.ledger);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024) throw new Error("ledger unsafe");
      const raw = JSON.parse(readFileSync(this.ledger, "utf8")) as unknown;
      if (!Array.isArray(raw)) throw new Error("ledger shape");
      for (const value of raw) {
        if (!this.valid(value)) throw new Error("ledger row");
        const record = value as StoredOutput;
        this.records.set(record.id, record);
      }
      const allowed = new Set(["outputs.json", ...[...this.records.values()].map((record) => record.file)]);
      for (const entry of readdirSync(this.root)) {
        if (!allowed.has(entry)) throw new Error("unknown output file");
      }
    } catch {
      throw new PenglaiError("STORE_CORRUPT", "TTS output ledger corrupt");
    }
  }

  private valid(value: unknown): value is StoredOutput {
    if (!value || typeof value !== "object") return false;
    const row = value as StoredOutput;
    return (
      HANDLE_ID.test(row.id) && row.file === `${row.id}.wav` && SHA256.test(row.digest) &&
      Number.isSafeInteger(row.bytes) && row.bytes >= 44 && row.bytes <= MAX_OUTPUT_BYTES &&
      Number.isSafeInteger(row.durationMs) && row.durationMs > 0 &&
      typeof row.voiceId === "string" && row.voiceId.length > 0 && row.voiceId.length <= 128 &&
      SHA256.test(row.sourceFinalDigest) && OPERATION_ID.test(row.ownerOperation) &&
      Number.isSafeInteger(row.expiresAt) && row.expiresAt > 0
    );
  }

  private persist(): void {
    const temp = `${this.ledger}.${randomUUID()}.part`;
    writeFileSync(temp, JSON.stringify([...this.records.values()], null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temp, this.ledger);
  }

  private publicHandle(record: StoredOutput): TtsAudioHandle {
    const { file: _file, ...handle } = record;
    return { ...handle };
  }

  private assertUsable(): void {
    if (this.disposed) throw new PenglaiError("DSH_UNAVAILABLE", "TTS output registry disposed");
  }
}
