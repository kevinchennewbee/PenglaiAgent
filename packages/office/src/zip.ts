import { inflateRawSync, deflateRawSync } from "node:zlib";
import { PenglaiError } from "@penglai/contracts";

export const OFFICE_ZIP_LIMITS = {
  archiveBytes: 8 * 1024 * 1024,
  maxEntries: 256,
  entryUncompressedBytes: 16 * 1024 * 1024,
  totalUncompressedBytes: 32 * 1024 * 1024,
  maxRatio: 100,
  maxNameBytes: 512,
} as const;

const LOCAL_SIG = Buffer.from("PK\u0003\u0004", "binary");
const CENTRAL_SIG = Buffer.from("PK\u0001\u0002", "binary");
const EOCD_SIG = Buffer.from("PK\u0005\u0006", "binary");
const ZIP64_LOCATOR_SIG = Buffer.from("PK\u0006\u0007", "binary");
const ALLOWED_FLAGS = 0x0800;
const ZIP64_EXTRA_ID = 0x0001;

export interface ZipEntry {
  name: string;
  data: Buffer;
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function fail(code: string): never {
  throw new PenglaiError("SECURITY_POLICY", code);
}

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.subarray(i, i + 4).equals(EOCD_SIG)) {
      const comment = buf.readUInt16LE(i + 20);
      if (i + 22 + comment === buf.length) return i;
    }
  }
  fail("OFFICE_ZIP_EOCD");
}

function extraHasZip64(extra: Buffer): boolean {
  let i = 0;
  while (i + 4 <= extra.length) {
    const id = extra.readUInt16LE(i);
    const size = extra.readUInt16LE(i + 2);
    if (id === ZIP64_EXTRA_ID) return true;
    i += 4 + size;
    if (i > extra.length) return true;
  }
  return extra.length > 0 && i !== extra.length;
}

function assertSafeName(name: string, folded: Set<string>): void {
  const raw = Buffer.from(name, "utf8");
  if (raw.length === 0 || raw.length > OFFICE_ZIP_LIMITS.maxNameBytes) fail("OFFICE_ZIP_NAME");
  if (name.includes("\0")) fail("OFFICE_ZIP_NAME");
  if (name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name)) fail("OFFICE_ZIP_PATH");
  const norm = name.replaceAll("\\", "/");
  const trailingDir = norm.endsWith("/");
  const segments = trailingDir ? norm.slice(0, -1).split("/") : norm.split("/");
  if (segments.length === 0 || segments.some((part) => part === "" || part === "." || part === "..")) {
    fail("OFFICE_ZIP_PATH");
  }
  const key = segments.join("/").toLowerCase();
  if (folded.has(key)) fail("OFFICE_ZIP_DUPLICATE");
  folded.add(key);
}

function inflateEntry(payload: Buffer, method: number, declared: number): Buffer {
  if (declared > OFFICE_ZIP_LIMITS.entryUncompressedBytes) fail("OFFICE_ZIP_ENTRY_LIMIT");
  if (method === 0) {
    if (payload.length !== declared) fail("OFFICE_ZIP_SIZE");
    return Buffer.from(payload);
  }
  if (method !== 8) fail("OFFICE_ZIP_METHOD");
  if (payload.length > 0 && declared > payload.length * OFFICE_ZIP_LIMITS.maxRatio) fail("OFFICE_ZIP_RATIO");
  let data: Buffer;
  try {
    data = inflateRawSync(payload, { maxOutputLength: OFFICE_ZIP_LIMITS.entryUncompressedBytes });
  } catch {
    fail("OFFICE_ZIP_INFLATE");
  }
  if (data.length !== declared) fail("OFFICE_ZIP_SIZE");
  if (payload.length > 0 && data.length > payload.length * OFFICE_ZIP_LIMITS.maxRatio) fail("OFFICE_ZIP_RATIO");
  return data;
}

export function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const local = Buffer.concat([
      LOCAL_SIG,
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      compressed,
    ]);
    const central = Buffer.concat([
      CENTRAL_SIG,
      u16(20),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.concat([
    EOCD_SIG,
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, central, end]);
}

export function readZip(buf: Buffer): ZipEntry[] {
  if (!buf?.length) fail("OFFICE_ZIP_EMPTY");
  if (buf.length > OFFICE_ZIP_LIMITS.archiveBytes) fail("OFFICE_ZIP_ARCHIVE_LIMIT");
  const eocd = findEocd(buf);
  if (eocd >= 20 && buf.subarray(eocd - 20, eocd - 16).equals(ZIP64_LOCATOR_SIG)) fail("OFFICE_ZIP_ZIP64");
  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const onDisk = buf.readUInt16LE(eocd + 8);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) fail("OFFICE_ZIP_SPLIT");
  if (total > OFFICE_ZIP_LIMITS.maxEntries) fail("OFFICE_ZIP_ENTRY_COUNT");
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || total === 0xffff) fail("OFFICE_ZIP_ZIP64");
  if (cdOffset + cdSize !== eocd) fail("OFFICE_ZIP_CENTRAL");
  const central = buf.subarray(cdOffset, cdOffset + cdSize);
  const out: ZipEntry[] = [];
  const folded = new Set<string>();
  let cursor = 0;
  let uncompressedTotal = 0;
  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > central.length || !central.subarray(cursor, cursor + 4).equals(CENTRAL_SIG)) {
      fail("OFFICE_ZIP_CENTRAL");
    }
    const flags = central.readUInt16LE(cursor + 8);
    const method = central.readUInt16LE(cursor + 10);
    const crc = central.readUInt32LE(cursor + 16);
    const compSize = central.readUInt32LE(cursor + 20);
    const rawSize = central.readUInt32LE(cursor + 24);
    const nameLen = central.readUInt16LE(cursor + 28);
    const extraLen = central.readUInt16LE(cursor + 30);
    const commentLen = central.readUInt16LE(cursor + 32);
    const localOffset = central.readUInt32LE(cursor + 42);
    const name = central.toString("utf8", cursor + 46, cursor + 46 + nameLen);
    const extra = central.subarray(cursor + 46 + nameLen, cursor + 46 + nameLen + extraLen);
    cursor += 46 + nameLen + extraLen + commentLen;
    if ((flags & ~ALLOWED_FLAGS) !== 0) fail("OFFICE_ZIP_FLAGS");
    if ((flags & 0x0001) !== 0) fail("OFFICE_ZIP_ENCRYPT");
    if (method !== 0 && method !== 8) fail("OFFICE_ZIP_METHOD");
    if (extraHasZip64(extra)) fail("OFFICE_ZIP_ZIP64");
    assertSafeName(name, folded);
    if (localOffset + 30 > buf.length || !buf.subarray(localOffset, localOffset + 4).equals(LOCAL_SIG)) {
      fail("OFFICE_ZIP_LOCAL");
    }
    const localFlags = buf.readUInt16LE(localOffset + 6);
    const localMethod = buf.readUInt16LE(localOffset + 8);
    const localCrc = buf.readUInt32LE(localOffset + 14);
    const localComp = buf.readUInt32LE(localOffset + 18);
    const localRaw = buf.readUInt32LE(localOffset + 22);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const localName = buf.toString("utf8", localOffset + 30, localOffset + 30 + localNameLen);
    const localExtra = buf.subarray(
      localOffset + 30 + localNameLen,
      localOffset + 30 + localNameLen + localExtraLen,
    );
    if (
      localName !== name ||
      localMethod !== method ||
      localCrc !== crc ||
      localComp !== compSize ||
      localRaw !== rawSize
    ) {
      fail("OFFICE_ZIP_HEADER_MISMATCH");
    }
    if ((localFlags & ~ALLOWED_FLAGS) !== 0) fail("OFFICE_ZIP_FLAGS");
    if (extraHasZip64(localExtra)) fail("OFFICE_ZIP_ZIP64");
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > buf.length) fail("OFFICE_ZIP_LOCAL");
    const payload = buf.subarray(dataStart, dataStart + compSize);
    const directory = name.endsWith("/");
    if (directory && rawSize !== 0) fail("OFFICE_ZIP_DIRECTORY");
    const data = directory ? Buffer.alloc(0) : inflateEntry(payload, method, rawSize);
    if (!directory && crc32(data) !== crc) fail("OFFICE_ZIP_CRC");
    uncompressedTotal += data.length;
    if (uncompressedTotal > OFFICE_ZIP_LIMITS.totalUncompressedBytes) fail("OFFICE_ZIP_TOTAL_LIMIT");
    if (!directory) out.push({ name, data });
  }
  if (cursor !== central.length) fail("OFFICE_ZIP_CENTRAL");
  return out;
}

export { crc32 as zipCrc32 };
